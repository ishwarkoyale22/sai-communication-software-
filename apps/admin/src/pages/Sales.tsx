import { useEffect, useState } from "react";
import { formatCurrency, formatDateTime, generateSimpleInvoicePdf, openRetailTaxInvoice, openBlankInvoiceWindow } from "@sai/shared";
import { supabase, SHOP } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2, X, Printer, Eye } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  phone: string;
  birthday: string | null;
}
interface StaffLite {
  id: string;
  name: string;
}
interface InventoryItem {
  id: string;
  name: string;
  model: string;
  price: number;
  stock: number;
  is_serialized: boolean;
}
interface AvailableUnit {
  id: string;
  imei_1: string | null;
  imei_2: string | null;
  serial_no: string | null;
}

/** Human-readable identifier for a stock unit — IMEI(s) preferred, serial as fallback/extra. */
function unitLabel(u: { imei_1: string | null; imei_2: string | null; serial_no: string | null }): string {
  const parts: string[] = [];
  if (u.imei_1) parts.push(u.imei_1);
  if (u.imei_2) parts.push(u.imei_2);
  if (u.serial_no) parts.push(`SN: ${u.serial_no}`);
  return parts.join(" / ") || "-";
}
interface Sale {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  sale_type: string;
  total_amount: number;
  discount: number;
  final_amount: number;
  payment_method: string;
  payment_status: string;
  notes: string | null;
  created_at: string;
}
interface CartLine {
  /** Unique per cart line — the inventory_id for a merged non-serialized line, or the specific unit_id for a serialized one (each physical unit is its own line). */
  key: string;
  inventory_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  /** Serial No. / IMEI(s) for this line, comma-separated when quantity > 1 — optional, shown on the printed invoice when present. */
  serial_no: string;
  /** Set when this line is one specific serialized inventory_units row — quantity is locked at 1 and serial_no is read-only, sourced from the picked unit. */
  unit_id: string | null;
  /** Original unit shape, kept so removeLine can restore it to the picker exactly (imei_1/imei_2 split intact). */
  unitSnapshot?: AvailableUnit;
}

function nextInvoiceNumber() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [staffList, setStaffList] = useState<StaffLite[]>([]);
  const [staffId, setStaffId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerDob, setCustomerDob] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pickId, setPickId] = useState("");
  const [availableUnits, setAvailableUnits] = useState<AvailableUnit[]>([]);
  const [pickUnitId, setPickUnitId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [invoiceLoadingId, setInvoiceLoadingId] = useState<string | null>(null);

  useEffect(() => {
    load();
    supabase.from("customers").select("id, name, phone, birthday").order("name").then(({ data }) => setCustomers((data as Customer[]) ?? []));
    supabase.from("inventory").select("id, name, model, price, stock, is_serialized").eq("is_active", true).order("name").then(({ data }) => setInventory((data as InventoryItem[]) ?? []));
    supabase.from("staff").select("id, name").eq("is_active", true).order("name").then(({ data }) => setStaffList((data as StaffLite[]) ?? []));
    const channel = supabase
      .channel("sales-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("sales").select("*").order("created_at", { ascending: false });
    setSales((data as Sale[]) ?? []);
  }

  async function loadAvailableUnits(inventoryId: string) {
    const { data } = await supabase
      .from("inventory_units")
      .select("id, imei_1, imei_2, serial_no")
      .eq("inventory_id", inventoryId)
      .eq("status", "in_stock")
      .order("created_at");
    setAvailableUnits((data as AvailableUnit[]) ?? []);
  }

  function onPickItem(id: string) {
    setPickId(id);
    setPickUnitId("");
    const item = inventory.find((i) => i.id === id);
    if (item?.is_serialized) loadAvailableUnits(id);
    else setAvailableUnits([]);
  }

  function addToCart() {
    const item = inventory.find((i) => i.id === pickId);
    if (!item) return;

    if (item.is_serialized) {
      const unit = availableUnits.find((u) => u.id === pickUnitId);
      if (!unit) return; // Add button is disabled until a serial is picked
      setCart((prev) => [
        ...prev,
        {
          key: unit.id,
          inventory_id: item.id,
          item_name: `${item.name} ${item.model}`,
          quantity: 1,
          unit_price: item.price,
          serial_no: unitLabel(unit),
          unit_id: unit.id,
          unitSnapshot: unit,
        },
      ]);
      setAvailableUnits((prev) => prev.filter((u) => u.id !== unit.id));
      setPickUnitId("");
      return;
    }

    setCart((prev) => {
      const existing = prev.find((l) => l.inventory_id === item.id && l.unit_id === null);
      if (existing) {
        return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { key: item.id, inventory_id: item.id, item_name: `${item.name} ${item.model}`, quantity: 1, unit_price: item.price, serial_no: "", unit_id: null }];
    });
    setPickId("");
  }

  function updateQty(key: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, qty) } : l)));
  }

  function updateSerial(key: string, serial_no: string) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, serial_no } : l)));
  }

  function removeLine(key: string) {
    // Returning a serialized unit to the cart's available-serials picker so
    // it isn't lost if the cashier removed it by mistake before completing the sale.
    setCart((prev) => {
      const line = prev.find((l) => l.key === key);
      if (line?.unit_id && line.inventory_id === pickId && line.unitSnapshot) {
        setAvailableUnits((units) => [...units, line.unitSnapshot!]);
      }
      return prev.filter((l) => l.key !== key);
    });
  }

  const cartTotal = cart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
  const pickedItem = inventory.find((i) => i.id === pickId);

  async function createSale() {
    if (cart.length === 0) {
      setError("Add at least one item.");
      return;
    }
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // A sale typed in fresh (not picked from the existing-customer
      // dropdown) never used to create a `customers` row — it only stored
      // customer_name/customer_phone as plain text on the sale itself, so
      // that person could never show up on the Customers page or build up
      // purchase/repair history there. Resolve (or create) a real customer
      // record here whenever we have a phone number to key it on, same as
      // "vijay" and every other walk-in should have been getting all along.
      let finalCustomerId = customerId || null;
      const trimmedPhone = customerPhone.trim();
      if (!finalCustomerId && trimmedPhone) {
        const { data: existingCustomer } = await supabase
          .from("customers")
          .select("id")
          .eq("phone", trimmedPhone)
          .maybeSingle();
        if (existingCustomer) {
          finalCustomerId = existingCustomer.id;
          // Backfill DOB if the customer already existed but didn't have one
          // on file yet, and the cashier captured it on this sale.
          if (customerDob) {
            await supabase.from("customers").update({ birthday: customerDob }).eq("id", finalCustomerId).is("birthday", null);
          }
        } else {
          const { data: newCustomer, error: custErr } = await supabase
            .from("customers")
            .insert({ name: customerName.trim(), phone: trimmedPhone, birthday: customerDob || null })
            .select("id")
            .single();
          if (custErr) throw custErr;
          finalCustomerId = newCustomer.id;
        }
      }

      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .insert({
          invoice_number: nextInvoiceNumber(),
          customer_id: finalCustomerId,
          customer_name: customerName.trim(),
          customer_phone: trimmedPhone || null,
          sale_type: "in_store",
          total_amount: cartTotal,
          discount: 0,
          final_amount: cartTotal,
          payment_method: paymentMethod,
          payment_status: "paid",
          staff_id: staffId || null,
        })
        .select()
        .single();

      if (saleErr) throw saleErr;

      // Defensive re-check right before committing: the dropdown was built
      // from a snapshot, so if another tab/cashier sold one of these exact
      // units in the meantime, block the whole sale rather than silently
      // re-selling it (spec: "This IMEI is already sold.").
      const unitIds = cart.map((l) => l.unit_id).filter((id): id is string => !!id);
      if (unitIds.length > 0) {
        const { data: liveUnits } = await supabase.from("inventory_units").select("id, status, imei_1, imei_2, serial_no").in("id", unitIds);
        const notInStock = (liveUnits ?? []).filter((u) => u.status !== "in_stock");
        if (notInStock.length > 0) {
          const labels = notInStock.map((u) => unitLabel(u as AvailableUnit)).join(", ");
          throw new Error(`This IMEI is already ${notInStock[0].status}: ${labels}. Remove it from the cart and refresh.`);
        }
      }

      // IDs are generated client-side (rather than relying on the insert's
      // returned row order) so each cart line's sales_items id is known up
      // front, for linking sold inventory_units back to the exact line below.
      const cartWithIds = cart.map((l) => ({ ...l, salesItemId: crypto.randomUUID() }));

      const { error: itemsErr } = await supabase.from("sales_items").insert(
        cartWithIds.map((l) => ({
          id: l.salesItemId,
          sale_id: sale.id,
          inventory_id: l.inventory_id,
          item_name: l.item_name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          total_price: l.quantity * l.unit_price,
          serial_no: l.serial_no.trim() || null,
        }))
      );
      if (itemsErr) throw itemsErr;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;

      // Serialized lines: mark the specific physical unit sold and linked to
      // its sale line — inventory.stock then auto-updates via the
      // inventory_units trigger, so no manual stock decrement needed here.
      // Also write the 'sale' lifecycle event (spec §12) with customer +
      // invoice reference, so the unit's history/timeline shows it.
      // Non-serialized lines: unaffected, same manual decrement as before.
      for (const l of cartWithIds) {
        if (l.unit_id) {
          await supabase
            .from("inventory_units")
            .update({ status: "sold", sale_item_id: l.salesItemId, customer_id: finalCustomerId, sold_at: new Date().toISOString(), updated_by: userId })
            .eq("id", l.unit_id);
          await supabase.from("imei_history").insert({
            stock_unit_id: l.unit_id,
            imei_1: l.unitSnapshot?.imei_1 ?? null,
            imei_2: l.unitSnapshot?.imei_2 ?? null,
            event_type: "sale",
            reference_type: "sale",
            reference_id: sale.invoice_number,
            from_status: "in_stock",
            to_status: "sold",
            customer_id: finalCustomerId,
            created_by: userId,
          });
          continue;
        }
        const item = inventory.find((i) => i.id === l.inventory_id);
        if (!item) continue;
        await supabase.from("inventory").update({ stock: Math.max(0, item.stock - l.quantity) }).eq("id", l.inventory_id);
      }

      setCart([]);
      setPickId("");
      setPickUnitId("");
      setAvailableUnits([]);
      setCustomerId("");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerDob("");
      setStaffId("");
      setShowForm(false);
      await load();
      const { data: freshInv } = await supabase.from("inventory").select("id, name, model, price, stock, is_serialized").eq("is_active", true).order("name");
      setInventory((freshInv as InventoryItem[]) ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to create sale.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadInvoice(sale: Sale, mode: "download" | "print") {
    setInvoiceLoadingId(sale.id);
    try {
      const { data: items } = await supabase
        .from("sales_items")
        .select("item_name, quantity, unit_price, total_price")
        .eq("sale_id", sale.id);
      generateSimpleInvoicePdf({
        invoiceNumber: sale.invoice_number,
        customerName: sale.customer_name,
        customerPhone: sale.customer_phone,
        paymentMethod: sale.payment_method,
        paymentStatus: sale.payment_status,
        createdAt: sale.created_at,
        items: (items ?? []).map((i: any) => ({
          name: i.item_name,
          quantity: i.quantity,
          unitPrice: i.unit_price,
          totalPrice: i.total_price,
        })),
        totalAmount: sale.total_amount,
        discount: sale.discount,
        finalAmount: sale.final_amount,
        shop: SHOP,
        mode,
      });
    } catch (err: any) {
      alert(err?.message || "Failed to generate invoice.");
    } finally {
      setInvoiceLoadingId(null);
    }
  }

  // GST-style "Tax Invoice" matching the shop's real paper invoice format
  // (CGST/SGST breakdown, HSN/SAC, amount in words) — this is what the
  // "Print" button opens; generateSimpleInvoicePdf above is only used for
  // the plain "Download" PDF, which is a separate, simpler artifact.
  async function printGstInvoice(sale: Sale, mode: "print" | "view" = "print") {
    // Opened synchronously, still inside the click's user-gesture window —
    // opening it after the await below would get silently popup-blocked.
    const win = openBlankInvoiceWindow();
    setInvoiceLoadingId(sale.id);
    try {
      // sales_items on the live DB has item_name/quantity/total_price plus
      // serial_no (added by migration 0028 for IMEI/serial capture at sale
      // time) — hsn_sac is still not a real column there (the SaleItem TS
      // type is aspirational for that field, same schema drift documented
      // elsewhere in this repo), so it's deliberately left out of this select.
      const { data: items, error: itemsErr } = await supabase
        .from("sales_items")
        .select("item_name, quantity, total_price, serial_no")
        .eq("sale_id", sale.id);
      if (itemsErr) throw itemsErr;
      openRetailTaxInvoice({
        invoiceNumber: sale.invoice_number,
        createdAt: sale.created_at,
        customerName: sale.customer_name,
        customerPhone: sale.customer_phone,
        paymentMethod: sale.payment_method,
        receivedAmount: sale.payment_status === "paid" ? sale.final_amount : undefined,
        items: (items ?? []).map((i: any) => ({
          name: i.item_name,
          quantity: i.quantity,
          totalPrice: i.total_price,
          serialNo: i.serial_no ?? null,
        })),
        totalAmount: sale.final_amount,
        shop: SHOP,
        mode,
      }, win);
    } catch (err: any) {
      win?.close();
      alert(err?.message || "Failed to generate GST invoice.");
    } finally {
      setInvoiceLoadingId(null);
    }
  }

  const filtered = sales.filter((s) => {
    if (dateFrom && s.created_at < dateFrom) return false;
    if (dateTo && s.created_at > dateTo + "T23:59:59") return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Sales & Invoices</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={filtered.map((s) => ({
              Invoice: s.invoice_number,
              Customer: s.customer_name,
              Type: s.sale_type,
              Total: s.final_amount,
              Payment: `${s.payment_method} (${s.payment_status})`,
              Date: s.created_at,
            }))}
            fileName="sales"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> New Sale
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="input w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span className="text-sm text-gray-400">to</span>
        <input type="date" className="input w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Type</th>
              <th className="text-right">Total</th>
              <th>Payment</th>
              <th>Date</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.invoice_number}</td>
                <td>{s.customer_name}</td>
                <td>
                  <StatusPill status={s.sale_type} />
                </td>
                <td className="text-right">{formatCurrency(s.final_amount)}</td>
                <td className="text-gray-500 capitalize">{s.payment_method} · {s.payment_status}</td>
                <td className="text-gray-500">{formatDateTime(s.created_at)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="btn-ghost !px-2 !py-1 text-xs"
                      disabled={invoiceLoadingId === s.id}
                      onClick={() => downloadInvoice(s, "download")}
                      title="Download plain invoice PDF"
                    >
                      Download
                    </button>
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      disabled={invoiceLoadingId === s.id}
                      onClick={() => printGstInvoice(s, "view")}
                      title="View the Tax Invoice online (no print dialog)"
                    >
                      <Eye size={13} /> View
                    </button>
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      disabled={invoiceLoadingId === s.id}
                      onClick={() => printGstInvoice(s)}
                      title="Print the real Tax Invoice (shop's paper format, CGST/SGST breakdown)"
                    >
                      <Printer size={13} /> Print
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  No sales found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-gray-800">New Sale</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>

            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}

            <select
              className="input"
              value={customerId}
              onChange={(e) => {
                const c = customers.find((x) => x.id === e.target.value);
                setCustomerId(e.target.value);
                setCustomerName(c?.name ?? customerName);
                setCustomerPhone(c?.phone ?? customerPhone);
                setCustomerDob(c?.birthday ?? "");
              }}
            >
              <option value="">Walk-in / choose existing customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Customer name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <input className="input" placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
            <input
              type="date"
              className="input"
              placeholder="Date of birth"
              value={customerDob}
              onChange={(e) => setCustomerDob(e.target.value)}
              title="Date of birth (optional) — used for birthday offers/tracking"
            />
            <select
              className="input"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              title="Which staff member made this sale — powers the Dashboard's Salesman Leaderboard"
            >
              <option value="">Sold by (optional)</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <div className="flex gap-2">
              <select className="input flex-1" value={pickId} onChange={(e) => onPickItem(e.target.value)}>
                <option value="">Select an item to add...</option>
                {inventory.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} {i.model} — {formatCurrency(i.price)} ({i.stock} in stock){i.is_serialized ? " · by serial" : ""}
                  </option>
                ))}
              </select>
              {pickedItem?.is_serialized ? (
                <select className="input !w-48" value={pickUnitId} onChange={(e) => setPickUnitId(e.target.value)}>
                  <option value="">Select serial...</option>
                  {availableUnits.map((u) => (
                    <option key={u.id} value={u.id}>{unitLabel(u)}</option>
                  ))}
                </select>
              ) : null}
              <button
                className="btn-secondary"
                onClick={addToCart}
                disabled={!pickId || (!!pickedItem?.is_serialized && !pickUnitId)}
              >
                Add
              </button>
            </div>
            {pickedItem?.is_serialized && availableUnits.length === 0 && (
              <p className="text-xs text-brand-danger">
                No serial numbers in stock for this item — add stock via Inventory → Serials first.
              </p>
            )}

            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {cart.map((l) => (
                <div key={l.key} className="rounded border border-gray-200 p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">{l.item_name}</span>
                    {l.unit_id ? (
                      <span className="w-16 text-right text-gray-400">×1</span>
                    ) : (
                      <input
                        type="number"
                        className="input !w-16 !py-0.5 text-right"
                        value={l.quantity}
                        onChange={(e) => updateQty(l.key, Number(e.target.value))}
                      />
                    )}
                    <span className="w-20 text-right font-medium">{formatCurrency(l.quantity * l.unit_price)}</span>
                    <button onClick={() => removeLine(l.key)} className="text-brand-danger"><Trash2 size={13} /></button>
                  </div>
                  {l.unit_id ? (
                    <div className="mt-1 text-xs text-gray-500">Serial: <span className="font-mono">{l.serial_no}</span></div>
                  ) : (
                    <input
                      className="input !py-0.5 mt-1.5 text-xs"
                      placeholder={l.quantity > 1 ? "Serial No. / IMEI (comma-separated, optional)" : "Serial No. / IMEI (optional)"}
                      value={l.serial_no}
                      onChange={(e) => updateSerial(l.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
              {cart.length === 0 && <p className="text-sm text-gray-400">No items added yet.</p>}
            </div>

            <div className="flex items-center justify-between border-t border-border pt-2">
              <select className="input !w-auto" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
              <span className="text-lg font-bold text-brand-primary">{formatCurrency(cartTotal)}</span>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={createSale} disabled={saving}>
                {saving ? "Saving..." : "Complete Sale"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
