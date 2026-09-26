import { useEffect, useState } from "react";
import { formatCurrency, formatDate, lineAmounts, openPurchaseBill, paymentModeLabel } from "@sai/shared";
import { supabase, SHOP } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { PurchaseEntryModal, type PurchaseEntry } from "../components/PurchaseEntryModal";
import { billFromEntry } from "../lib/purchaseBill";
import { StatusPill } from "../components/StatusPill";
import { Plus, Printer, Eye } from "lucide-react";

interface ThirdPartyPurchase {
  id: string;
  vendor_name: string;
  vendor_phone: string | null;
  vendor_gstin: string | null;
  vendor_address: string | null;
  vendor_state: string | null;
  place_of_supply: string | null;
  bill_number: string | null;
  payment_mode: string | null;
  paid_amount: number | null;
  items: unknown;
  terms: string | null;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  purchase_date: string;
  notes: string | null;
}

export function ThirdPartyPurchases() {
  const [rows, setRows] = useState<ThirdPartyPurchase[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("third-party-purchases-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "third_party_purchases" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("third_party_purchases").select("*").order("purchase_date", { ascending: false });
    setRows((data as ThirdPartyPurchase[]) ?? []);
  }

  async function add(e: PurchaseEntry) {
    setSaving(true);
    setError(null);
    const first = e.lines[0];
    const { error: insertErr } = await supabase.from("third_party_purchases").insert({
      vendor_name: e.partyName,
      vendor_phone: e.phone || null,
      vendor_gstin: e.gstin || null,
      vendor_address: e.address || null,
      vendor_state: e.partyState || null,
      place_of_supply: e.placeOfSupply || null,
      bill_number: e.billNumber || null,
      payment_mode: e.paymentMode,
      paid_amount: e.paidAmount,
      terms: e.terms || null,
      items: e.lines.map((l) => ({
        name: l.name,
        hsn_sac: l.hsn_sac || null,
        serials: l.serials,
        quantity: l.quantity,
        unit_price: l.unit_price,
        gst_rate: l.gst_rate,
        total_price: lineAmounts(l).total,
      })),
      // Summary columns — keep the list, exports and older code meaningful for multi-item bills.
      item_name: e.lines.length > 1 ? `${first.name} (+${e.lines.length - 1} more)` : first.name,
      quantity: e.totals.quantity,
      unit_price: e.totals.quantity > 0 ? Math.round((e.totals.total / e.totals.quantity) * 100) / 100 : e.totals.total,
      total_price: e.totals.total,
      purchase_date: e.billDate,
      notes: e.notes || null,
    });
    setSaving(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setShowForm(false);
    load();
  }

  function printBill(p: ThirdPartyPurchase, mode: "print" | "view" = "print") {
    const stored = Array.isArray(p.items) ? (p.items as any[]) : [];
    const items = stored.length > 0
      ? stored.map((it) => ({
          name: it.name ?? "Item",
          hsnSac: it.hsn_sac ?? null,
          quantity: it.quantity ?? 1,
          totalPrice: it.total_price ?? 0,
          ...(it.unit_price != null && it.gst_rate != null ? { unitPrice: Number(it.unit_price), gstRate: Number(it.gst_rate) } : {}),
          serials: Array.isArray(it.serials) ? it.serials : [],
        }))
      // Older single-item purchases: the stored total is the (GST-inclusive) amount.
      : [{ name: p.item_name, quantity: p.quantity, totalPrice: p.total_price }];

    openPurchaseBill({
      billNumber: p.bill_number || `TPP-${p.id.slice(0, 8).toUpperCase()}`,
      billDate: p.purchase_date,
      supplierName: p.vendor_name,
      supplier: { address: p.vendor_address, gstin: p.vendor_gstin, phone: p.vendor_phone, state: p.vendor_state },
      placeOfSupply: p.place_of_supply,
      paymentMode: p.payment_mode || "cash",
      paidAmount: p.paid_amount ?? p.total_price,
      terms: p.terms,
      items,
      totalAmount: p.total_price,
      shop: SHOP,
      mode,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Third-Party Purchases</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={rows.map((r) => ({
              Vendor: r.vendor_name,
              GSTIN: r.vendor_gstin ?? "",
              "Bill #": r.bill_number ?? "",
              Item: r.item_name,
              Qty: r.quantity,
              Total: r.total_price,
              Paid: r.paid_amount ?? r.total_price,
              "Payment Mode": r.payment_mode ? paymentModeLabel(r.payment_mode) : "",
              Date: r.purchase_date,
            }))}
            fileName="third-party-purchases"
          />
          <button
            className="btn-primary"
            onClick={() => {
              setError(null);
              setShowForm(true);
            }}
          >
            <Plus size={14} /> Add Purchase
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500">External purchases for repairs or resale — not linked to main inventory stock.</p>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Bill #</th>
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Total</th>
              <th className="text-right">Due</th>
              <th>Mode</th>
              <th>Date</th>
              <th className="text-right">Bill</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const paid = r.paid_amount ?? r.total_price; // older rows were all paid in cash
              const due = Math.max(0, r.total_price - paid);
              return (
                <tr key={r.id}>
                  <td>
                    <div className="font-medium">{r.vendor_name}</div>
                    {r.vendor_gstin && <div className="text-[11px] text-gray-400">{r.vendor_gstin}</div>}
                  </td>
                  <td className="text-gray-500">{r.bill_number ?? "-"}</td>
                  <td>{r.item_name}</td>
                  <td className="text-right">{r.quantity}</td>
                  <td className="text-right">{formatCurrency(r.total_price)}</td>
                  <td className="text-right">{due > 0.005 ? <StatusPill status="pending" label={formatCurrency(due)} /> : "-"}</td>
                  <td className="text-gray-500">{r.payment_mode ? paymentModeLabel(r.payment_mode) : "Cash"}</td>
                  <td className="text-gray-500">{formatDate(r.purchase_date)}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => printBill(r, "view")} title="View Bill online">
                        <Eye size={13} /> View
                      </button>
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => printBill(r)} title="Print Bill">
                        <Printer size={13} /> Print
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">No purchases logged</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <PurchaseEntryModal
          title="Add Purchase"
          partyLabel="Vendor"
          shopState={SHOP.state}
          error={error}
          saving={saving}
          onClose={() => setShowForm(false)}
          onSave={add}
          onPreview={(e) => openPurchaseBill(billFromEntry(e, "view"))}
        />
      )}
    </div>
  );
}
