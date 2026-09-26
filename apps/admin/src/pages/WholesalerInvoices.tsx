import { useEffect, useState } from "react";
import { formatDate, formatCurrency, openPurchaseBill, lineAmounts, paymentModeLabel } from "@sai/shared";
import { supabase, SHOP } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { PurchaseEntryModal, type PurchaseEntry } from "../components/PurchaseEntryModal";
import { billFromEntry } from "../lib/purchaseBill";
import { Plus, Printer, Eye } from "lucide-react";

interface WholesalerInvoice {
  id: string;
  wholesaler_name: string;
  wholesaler_phone: string | null;
  wholesaler_gstin: string | null;
  wholesaler_address: string | null;
  wholesaler_state: string | null;
  place_of_supply: string | null;
  payment_mode: string | null;
  terms: string | null;
  invoice_number: string | null;
  items: unknown;
  total_amount: number;
  paid_amount: number;
  due_amount: number | null;
  payment_status: string;
  invoice_date: string;
  due_date: string | null;
  notes: string | null;
}

export function WholesalerInvoices() {
  const [invoices, setInvoices] = useState<WholesalerInvoice[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("wholesaler-invoices-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "wholesaler_invoices" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("wholesaler_invoices").select("*").order("invoice_date", { ascending: false });
    setInvoices((data as WholesalerInvoice[]) ?? []);
  }

  async function addInvoice(e: PurchaseEntry) {
    setSaving(true);
    setError(null);
    const dueAmount = Math.max(0, e.totals.total - e.paidAmount);
    const { error: insertErr } = await supabase.from("wholesaler_invoices").insert({
      wholesaler_name: e.partyName,
      wholesaler_phone: e.phone || null,
      wholesaler_gstin: e.gstin || null,
      wholesaler_address: e.address || null,
      wholesaler_state: e.partyState || null,
      place_of_supply: e.placeOfSupply || null,
      payment_mode: e.paymentMode,
      terms: e.terms || null,
      invoice_number: e.billNumber || null,
      // Line items are kept in full so the bill can be reprinted exactly; `quantity` / `total_price` keep
      // older readers of this column working.
      items: e.lines.map((l) => ({
        name: l.name,
        hsn_sac: l.hsn_sac || null,
        serials: l.serials,
        quantity: l.quantity,
        unit_price: l.unit_price,
        gst_rate: l.gst_rate,
        total_price: lineAmounts(l).total,
      })),
      total_amount: e.totals.total,
      paid_amount: e.paidAmount,
      due_amount: dueAmount,
      payment_status: dueAmount <= 0.005 ? "paid" : e.paidAmount > 0 ? "partial" : "pending",
      invoice_date: e.billDate,
      due_date: e.dueDate || null,
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

  function printBill(inv: WholesalerInvoice, mode: "print" | "view" = "print") {
    const rawItems = Array.isArray(inv.items) ? (inv.items as any[]) : [];
    const items = rawItems.length > 0
      ? rawItems.map((it) => {
          const quantity = it.qty ?? it.quantity ?? 1;
          const hasRate = it.unit_price != null && it.gst_rate != null;
          return {
            name: it.name ?? it.item_name ?? "Item",
            hsnSac: it.hsn_sac ?? it.hsnSac ?? null,
            quantity,
            totalPrice: it.total_price ?? it.totalPrice ?? 0,
            ...(hasRate ? { unitPrice: Number(it.unit_price), gstRate: Number(it.gst_rate) } : {}),
            serials: Array.isArray(it.serials) ? it.serials : [],
          };
        })
      : [{ name: inv.notes || "Wholesale Purchase", quantity: 1, totalPrice: inv.total_amount }];

    openPurchaseBill({
      billNumber: inv.invoice_number || inv.id.slice(0, 8).toUpperCase(),
      billDate: inv.invoice_date,
      supplierName: inv.wholesaler_name,
      supplier: {
        address: inv.wholesaler_address,
        gstin: inv.wholesaler_gstin,
        phone: inv.wholesaler_phone,
        state: inv.wholesaler_state,
      },
      placeOfSupply: inv.place_of_supply,
      // Older invoices have no payment mode — fall back to what their status implies.
      paymentMode: inv.payment_mode || (inv.payment_status === "paid" ? "cash" : "credit"),
      paidAmount: inv.paid_amount,
      terms: inv.terms,
      items,
      totalAmount: inv.total_amount,
      mode,
      shop: SHOP,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Wholesaler Invoices</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={invoices.map((i) => ({
              Wholesaler: i.wholesaler_name,
              GSTIN: i.wholesaler_gstin ?? "",
              "Invoice #": i.invoice_number,
              Total: i.total_amount,
              Paid: i.paid_amount,
              Due: i.due_amount,
              "Payment Mode": i.payment_mode ? paymentModeLabel(i.payment_mode) : "",
              Status: i.payment_status,
              Date: i.invoice_date,
            }))}
            fileName="wholesaler-invoices"
          />
          <button
            className="btn-primary"
            onClick={() => {
              setError(null);
              setShowForm(true);
            }}
          >
            <Plus size={14} /> Add Invoice
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Wholesaler</th>
              <th>Invoice #</th>
              <th className="text-right">Total</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Due</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Date</th>
              <th className="text-right">Bill</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>
                  <div className="font-medium">{i.wholesaler_name}</div>
                  {i.wholesaler_gstin && <div className="text-[11px] text-gray-400">{i.wholesaler_gstin}</div>}
                </td>
                <td className="text-gray-500">{i.invoice_number ?? "-"}</td>
                <td className="text-right">{formatCurrency(i.total_amount)}</td>
                <td className="text-right">{formatCurrency(i.paid_amount)}</td>
                <td className="text-right">{formatCurrency(i.due_amount ?? 0)}</td>
                <td className="text-gray-500">{i.payment_mode ? paymentModeLabel(i.payment_mode) : "-"}</td>
                <td>
                  <StatusPill status={i.payment_status} />
                </td>
                <td className="text-gray-500">{formatDate(i.invoice_date)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => printBill(i, "view")} title="View Bill online">
                      <Eye size={13} /> View
                    </button>
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => printBill(i)} title="Print Bill">
                      <Printer size={13} /> Print
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">No invoices recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <PurchaseEntryModal
          title="Add Wholesaler Invoice"
          partyLabel="Wholesaler"
          showDueDate
          shopState={SHOP.state}
          error={error}
          saving={saving}
          onClose={() => setShowForm(false)}
          onSave={addInvoice}
          onPreview={(e) => openPurchaseBill(billFromEntry(e, "view"))}
        />
      )}
    </div>
  );
}
