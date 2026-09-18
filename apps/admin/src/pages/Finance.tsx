import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDate, formatDateTime } from "@sai/shared";
import type { FinancePartner, FinanceStatus, FinanceStatusHistoryEvent, FinanceTransaction, ReconciliationStatus } from "@sai/shared";
import { FINANCE_STATUSES, FINANCE_STATUS_TRANSITIONS } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, X, Clock } from "lucide-react";

// Full Finance/EMI management module (replaces the old free-text Emi.tsx
// page). A finance transaction is linked to a real customer, an optional
// sale/invoice, and an optional physical stock unit/IMEI — not just typed
// text — per the Finance Sale Workflow spec (Customer -> Product -> Stock
// Unit -> IMEI -> Sale -> Payment=Finance -> Partner -> Application ->
// Approval -> Disbursement -> Settlement -> Reconciliation).

interface CustomerLite {
  id: string;
  name: string;
  phone: string | null;
}
interface SaleLite {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  final_amount: number;
  created_at: string;
}
interface SaleItemLite {
  id: string;
  sale_id: string;
  item_name: string;
  serial_no: string | null;
  total_price: number;
}
interface StockUnitLite {
  id: string;
  imei_1: string | null;
  imei_2: string | null;
  serial_no: string | null;
}

const STATUS_LABEL: Record<FinanceStatus, string> = {
  draft: "Draft",
  application_started: "Application Started",
  submitted: "Submitted",
  pending: "Pending",
  approved: "Approved",
  disbursement_pending: "Disbursement Pending",
  disbursed: "Disbursed",
  settlement_pending: "Settlement Pending",
  settled: "Settled",
  rejected: "Rejected",
  cancelled: "Cancelled",
  failed: "Failed",
};

const emptyForm = {
  customer_id: "",
  customer_name: "",
  customer_phone: "",
  sale_id: "",
  invoice_number: "",
  stock_unit_id: "",
  product_name: "",
  brand: "",
  model: "",
  imei_1: "",
  imei_2: "",
  serial_no: "",
  finance_partner_id: "",
  sale_amount: 0,
  down_payment: 0,
  finance_amount: 0,
  tenure_months: 6,
  emi_amount: 0,
  application_number: "",
  agreement_number: "",
  notes: "",
};

export function Finance() {
  const [tab, setTab] = useState<"dashboard" | "transactions">("dashboard");
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [partners, setPartners] = useState<FinancePartner[]>([]);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [sales, setSales] = useState<SaleLite[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saleItems, setSaleItems] = useState<SaleItemLite[]>([]);
  const [stockUnit, setStockUnit] = useState<StockUnitLite | null>(null);

  const [search, setSearch] = useState("");
  const [partnerFilter, setPartnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reconFilter, setReconFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [detail, setDetail] = useState<FinanceTransaction | null>(null);
  const [history, setHistory] = useState<FinanceStatusHistoryEvent[]>([]);
  const [statusNote, setStatusNote] = useState("");
  const [settlementForm, setSettlementForm] = useState({
    expected_settlement_amount: "",
    actual_settlement_amount: "",
    processing_fee: "",
    commission: "",
    other_deduction: "",
    adjustment: "",
    settlement_date: "",
    settlement_reference: "",
    reconciliation_status: "pending" as ReconciliationStatus,
  });
  // Separate loading flags — sharing one `busy` flag made the "Save
  // Settlement" button flash "Saving..." while a status-transition button
  // was the one actually in flight (and vice versa), which looked like the
  // wrong button was responding to the click.
  const [statusBusy, setStatusBusy] = useState(false);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    load();
    supabase.from("finance_partners").select("*").order("name").then(({ data }) => setPartners((data as FinancePartner[]) ?? []));
    supabase.from("customers").select("id, name, phone").order("name").then(({ data }) => setCustomers((data as CustomerLite[]) ?? []));
    supabase.from("sales").select("id, invoice_number, customer_id, final_amount, created_at").order("created_at", { ascending: false }).then(({ data }) => setSales((data as SaleLite[]) ?? []));
    const channel = supabase
      .channel("finance-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_transactions" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase
      .from("finance_transactions")
      .select("*, finance_partner:finance_partner_id(name, short_code)")
      .order("created_at", { ascending: false });
    setTransactions((data as unknown as FinanceTransaction[]) ?? []);
  }

  async function currentUserId(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  }

  // --- New finance sale workflow -----------------------------------

  function onPickCustomer(id: string) {
    const c = customers.find((x) => x.id === id);
    setForm((f) => ({ ...f, customer_id: id, customer_name: c?.name ?? f.customer_name, customer_phone: c?.phone ?? f.customer_phone, sale_id: "" }));
    setSaleItems([]);
    setStockUnit(null);
  }

  async function onPickSale(saleId: string) {
    setForm((f) => ({ ...f, sale_id: saleId, stock_unit_id: "", imei_1: "", imei_2: "", serial_no: "" }));
    setStockUnit(null);
    if (!saleId) {
      setSaleItems([]);
      return;
    }
    const sale = sales.find((s) => s.id === saleId);
    if (sale) setForm((f) => ({ ...f, invoice_number: sale.invoice_number, sale_amount: sale.final_amount, finance_amount: Math.max(0, sale.final_amount - f.down_payment) }));
    const { data } = await supabase.from("sales_items").select("id, sale_id, item_name, serial_no, total_price").eq("sale_id", saleId);
    setSaleItems((data as SaleItemLite[]) ?? []);
  }

  async function onPickSaleItem(itemId: string) {
    const item = saleItems.find((i) => i.id === itemId);
    if (!item) return;
    setForm((f) => ({ ...f, product_name: item.item_name }));
    // A serialized line's sales_items id is linked back to exactly one
    // inventory_units row via sale_item_id — pull its IMEI/serial so the
    // finance record stays connected to the physical device sold (Phase 10).
    const { data } = await supabase
      .from("inventory_units")
      .select("id, imei_1, imei_2, serial_no")
      .eq("sale_item_id", itemId)
      .maybeSingle();
    if (data) {
      setStockUnit(data as StockUnitLite);
      setForm((f) => ({ ...f, stock_unit_id: data.id, imei_1: data.imei_1 ?? "", imei_2: data.imei_2 ?? "", serial_no: data.serial_no ?? item.serial_no ?? "" }));
    } else {
      setStockUnit(null);
      setForm((f) => ({ ...f, stock_unit_id: "", imei_1: "", imei_2: "", serial_no: item.serial_no ?? "" }));
    }
  }

  function recalcEmi(financeAmount: number, tenure: number) {
    return tenure > 0 ? Math.ceil(financeAmount / tenure) : 0;
  }

  function openAdd() {
    setForm(emptyForm);
    setSaleItems([]);
    setStockUnit(null);
    setError(null);
    setShowForm(true);
  }

  async function submitNew() {
    if (!form.customer_name.trim()) return setError("Customer is required.");
    if (!form.product_name.trim()) return setError("Product is required.");
    if (!form.finance_partner_id) return setError("Finance partner is required.");
    if (form.finance_amount < 0 || form.down_payment < 0) return setError("Amounts cannot be negative.");
    if (form.tenure_months <= 0) return setError("Tenure must be greater than 0.");
    if (form.application_number.trim()) {
      const { data: dupe } = await supabase.from("finance_transactions").select("id").eq("application_number", form.application_number.trim()).maybeSingle();
      if (dupe) return setError(`Application number "${form.application_number}" is already used by another finance transaction.`);
    }

    setSaving(true);
    setError(null);
    try {
      const userId = await currentUserId();
      const { data: created, error: insErr } = await supabase
        .from("finance_transactions")
        .insert({
          customer_id: form.customer_id || null,
          sale_id: form.sale_id || null,
          stock_unit_id: form.stock_unit_id || null,
          finance_partner_id: form.finance_partner_id,
          invoice_number: form.invoice_number.trim() || null,
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone.trim() || null,
          product_name: form.product_name.trim(),
          brand: form.brand.trim() || null,
          model: form.model.trim() || null,
          imei_1: form.imei_1.trim() || null,
          imei_2: form.imei_2.trim() || null,
          serial_no: form.serial_no.trim() || null,
          sale_amount: form.sale_amount,
          down_payment: form.down_payment,
          customer_paid_amount: form.down_payment,
          finance_amount: form.finance_amount,
          tenure_months: form.tenure_months,
          emi_amount: form.emi_amount || recalcEmi(form.finance_amount, form.tenure_months),
          application_number: form.application_number.trim() || null,
          agreement_number: form.agreement_number.trim() || null,
          notes: form.notes.trim() || null,
          status: "draft",
          created_by: userId,
          updated_by: userId,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      await supabase.from("finance_status_history").insert({
        finance_transaction_id: created.id,
        from_status: null,
        to_status: "draft",
        note: "Finance sale created.",
        changed_by: userId,
      });

      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to create finance transaction.");
    } finally {
      setSaving(false);
    }
  }

  // --- Status lifecycle + settlement --------------------------------

  async function openDetail(t: FinanceTransaction) {
    setDetail(t);
    setActionError(null);
    setStatusNote("");
    setSettlementForm({
      expected_settlement_amount: t.expected_settlement_amount != null ? String(t.expected_settlement_amount) : "",
      actual_settlement_amount: t.actual_settlement_amount != null ? String(t.actual_settlement_amount) : "",
      processing_fee: String(t.processing_fee ?? 0),
      commission: String(t.commission ?? 0),
      other_deduction: String(t.other_deduction ?? 0),
      adjustment: String(t.adjustment ?? 0),
      settlement_date: t.settlement_date ?? "",
      settlement_reference: t.settlement_reference ?? "",
      reconciliation_status: t.reconciliation_status,
    });
    const { data } = await supabase.from("finance_status_history").select("*").eq("finance_transaction_id", t.id).order("created_at", { ascending: true });
    setHistory((data as FinanceStatusHistoryEvent[]) ?? []);
  }

  async function changeStatus(to: FinanceStatus) {
    if (!detail) return;
    setStatusBusy(true);
    setActionError(null);
    try {
      const userId = await currentUserId();
      const from = detail.status;
      const { error: updErr } = await supabase.from("finance_transactions").update({ status: to, updated_by: userId }).eq("id", detail.id);
      if (updErr) throw updErr;
      await supabase.from("finance_status_history").insert({
        finance_transaction_id: detail.id,
        from_status: from,
        to_status: to,
        note: statusNote.trim() || null,
        changed_by: userId,
      });
      setStatusNote("");
      const { data } = await supabase.from("finance_transactions").select("*, finance_partner:finance_partner_id(name, short_code)").eq("id", detail.id).single();
      setDetail(data as unknown as FinanceTransaction);
      const { data: hist } = await supabase.from("finance_status_history").select("*").eq("finance_transaction_id", detail.id).order("created_at", { ascending: true });
      setHistory((hist as FinanceStatusHistoryEvent[]) ?? []);
      load();
    } catch (err: any) {
      if (err?.message?.includes("finance_transactions_settled_requires_settlement")) {
        setActionError("Fill in the settlement details below (actual amount, settlement date, and reference) before marking this as Settled.");
      } else {
        setActionError(err?.message || "Failed to update status — that transition may not be allowed from the current status.");
      }
    } finally {
      setStatusBusy(false);
    }
  }

  async function saveSettlement() {
    if (!detail) return;
    setSettlementBusy(true);
    setActionError(null);
    try {
      const userId = await currentUserId();
      const payload = {
        expected_settlement_amount: settlementForm.expected_settlement_amount ? Number(settlementForm.expected_settlement_amount) : null,
        actual_settlement_amount: settlementForm.actual_settlement_amount ? Number(settlementForm.actual_settlement_amount) : null,
        processing_fee: Number(settlementForm.processing_fee) || 0,
        commission: Number(settlementForm.commission) || 0,
        other_deduction: Number(settlementForm.other_deduction) || 0,
        adjustment: Number(settlementForm.adjustment) || 0,
        settlement_date: settlementForm.settlement_date || null,
        settlement_reference: settlementForm.settlement_reference.trim() || null,
        reconciliation_status: settlementForm.reconciliation_status,
        updated_by: userId,
      };
      const { error: updErr } = await supabase.from("finance_transactions").update(payload).eq("id", detail.id);
      if (updErr) throw updErr;
      const { data } = await supabase.from("finance_transactions").select("*, finance_partner:finance_partner_id(name, short_code)").eq("id", detail.id).single();
      setDetail(data as unknown as FinanceTransaction);
      load();
    } catch (err: any) {
      setActionError(err?.message || "Failed to save settlement details.");
    } finally {
      setSettlementBusy(false);
    }
  }

  // --- Filters / search ------------------------------------------

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (partnerFilter && t.finance_partner_id !== partnerFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (reconFilter && t.reconciliation_status !== reconFilter) return false;
      if (dateFrom && t.finance_date < dateFrom) return false;
      if (dateTo && t.finance_date > dateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [
          t.customer_name, t.customer_phone, t.invoice_number, t.application_number,
          t.agreement_number, t.imei_1, t.imei_2, t.serial_no, t.finance_partner?.name,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, partnerFilter, statusFilter, reconFilter, dateFrom, dateTo, search]);

  // --- Dashboard aggregates ----------------------------------------

  const stats = useMemo(() => {
    const s = {
      totalSales: transactions.length,
      totalFinanceAmount: 0,
      totalDownPayment: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      disbursementPending: 0,
      settlementPending: 0,
      settledAmount: 0,
      pendingSettlementAmount: 0,
      totalDeductions: 0,
      reconciliationDifference: 0,
    };
    for (const t of transactions) {
      s.totalFinanceAmount += Number(t.finance_amount) || 0;
      s.totalDownPayment += Number(t.down_payment) || 0;
      if (t.status === "pending" || t.status === "submitted" || t.status === "application_started") s.pending++;
      if (t.status === "approved") s.approved++;
      if (t.status === "rejected") s.rejected++;
      if (t.status === "disbursement_pending") s.disbursementPending++;
      if (t.status === "settlement_pending") s.settlementPending++;
      if (t.status === "settled") {
        s.settledAmount += Number(t.actual_settlement_amount) || 0;
        s.totalDeductions += (Number(t.processing_fee) || 0) + (Number(t.commission) || 0) + (Number(t.other_deduction) || 0);
        s.reconciliationDifference += (Number(t.finance_amount) || 0) - (Number(t.actual_settlement_amount) || 0);
      }
      if (t.status === "disbursed" || t.status === "settlement_pending") {
        s.pendingSettlementAmount += Number(t.expected_settlement_amount ?? t.finance_amount) || 0;
      }
    }
    return s;
  }, [transactions]);

  const partnerSummary = useMemo(() => {
    const map = new Map<string, { name: string; count: number; financeAmount: number; settledAmount: number; pendingAmount: number; deductions: number }>();
    for (const t of transactions) {
      // finance_partner_id is nullable — legacy backfilled records whose
      // free-text finance company didn't match a real partner have no
      // link, and are grouped under an explicit bucket rather than
      // silently merging into one map entry keyed by `null`/undefined.
      const key = t.finance_partner_id ?? "unlinked";
      const name = t.finance_partner?.name ?? "Unlinked / Unknown";
      const row = map.get(key) ?? { name, count: 0, financeAmount: 0, settledAmount: 0, pendingAmount: 0, deductions: 0 };
      row.count++;
      row.financeAmount += Number(t.finance_amount) || 0;
      if (t.status === "settled") {
        row.settledAmount += Number(t.actual_settlement_amount) || 0;
        row.deductions += (Number(t.processing_fee) || 0) + (Number(t.commission) || 0) + (Number(t.other_deduction) || 0);
      } else if (t.status === "disbursed" || t.status === "settlement_pending") {
        row.pendingAmount += Number(t.expected_settlement_amount ?? t.finance_amount) || 0;
      }
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => b.financeAmount - a.financeAmount);
  }, [transactions]);

  const customerSales = sales.filter((s) => s.customer_id === form.customer_id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Finance / EMI</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={filtered.map((t) => ({
              Date: t.finance_date,
              Customer: t.customer_name,
              Mobile: t.customer_phone,
              Invoice: t.invoice_number,
              Product: t.product_name,
              IMEI: t.imei_1 || t.serial_no,
              Partner: t.finance_partner?.name,
              "Sale Amount": t.sale_amount,
              "Down Payment": t.down_payment,
              "Finance Amount": t.finance_amount,
              Status: STATUS_LABEL[t.status],
              "Settlement Status": t.reconciliation_status,
              "Settlement Amount": t.actual_settlement_amount,
              "Balance/Difference": (t.finance_amount || 0) - (t.actual_settlement_amount || 0),
            }))}
            fileName="finance-transactions"
          />
          <button className="btn-primary" onClick={openAdd}>
            <Plus size={14} /> New Finance Sale
          </button>
        </div>
      </div>

      <div className="flex overflow-hidden rounded-md border border-gray-300 w-fit">
        {(["dashboard", "transactions"] as const).map((t) => (
          <button
            key={t}
            className={`px-4 py-1.5 text-xs font-medium capitalize ${tab === t ? "bg-brand-primary text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      {tab === "dashboard" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Total Finance Sales", stats.totalSales, false, "card-blue"],
              ["Total Finance Amount", stats.totalFinanceAmount, true, "card-gold"],
              ["Total Down Payment", stats.totalDownPayment, true, "card-green"],
              ["Pending Applications", stats.pending, false, "card-amber"],
              ["Approved", stats.approved, false, "card-green"],
              ["Rejected", stats.rejected, false, "card-red"],
              ["Disbursement Pending", stats.disbursementPending, false, "card-amber"],
              ["Settlement Pending", stats.settlementPending, false, "card-amber"],
              ["Settled Amount", stats.settledAmount, true, "card-green"],
              ["Pending Settlement Amount", stats.pendingSettlementAmount, true, "card-amber"],
              ["Total Deductions", stats.totalDeductions, true, "card-red"],
              ["Reconciliation Difference", stats.reconciliationDifference, true, "card-blue"],
            ].map(([label, value, currency, tile]) => (
              <div className={`${tile as string} p-4`} key={label as string}>
                <div className="text-xs font-medium text-gray-500">{label}</div>
                <div className="mt-1 font-serif text-lg font-semibold text-gray-800">
                  {currency ? formatCurrency(value as number) : (value as number)}
                </div>
              </div>
            ))}
          </div>

          <div className="card overflow-x-auto">
            <div className="border-b border-border p-3 text-sm font-semibold text-gray-700">Partner-wise Summary</div>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Finance Partner</th>
                  <th className="text-right">Transactions</th>
                  <th className="text-right">Finance Amount</th>
                  <th className="text-right">Settled Amount</th>
                  <th className="text-right">Pending Amount</th>
                  <th className="text-right">Deductions</th>
                </tr>
              </thead>
              <tbody>
                {partnerSummary.map((r) => (
                  <tr key={r.name}>
                    <td className="font-medium">{r.name}</td>
                    <td className="text-right">{r.count}</td>
                    <td className="text-right">{formatCurrency(r.financeAmount)}</td>
                    <td className="text-right">{formatCurrency(r.settledAmount)}</td>
                    <td className="text-right">{formatCurrency(r.pendingAmount)}</td>
                    <td className="text-right">{formatCurrency(r.deductions)}</td>
                  </tr>
                ))}
                {partnerSummary.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400">No finance transactions yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "transactions" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-64" placeholder="Search customer, mobile, invoice, IMEI, application/loan no..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input w-auto" value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)}>
              <option value="">All Partners</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {FINANCE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <select className="input w-auto" value={reconFilter} onChange={(e) => setReconFilter(e.target.value)}>
              <option value="">All Settlement Status</option>
              <option value="pending">Pending</option>
              <option value="matched">Matched</option>
              <option value="mismatch">Mismatch</option>
            </select>
            <input type="date" className="input w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-sm text-gray-400">to</span>
            <input type="date" className="input w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Product</th>
                  <th>IMEI</th>
                  <th>Partner</th>
                  <th className="text-right">Sale</th>
                  <th className="text-right">Down</th>
                  <th className="text-right">Finance</th>
                  <th>Status</th>
                  <th>Settlement</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="cursor-pointer" onClick={() => openDetail(t)}>
                    <td className="text-gray-500">{formatDate(t.finance_date)}</td>
                    <td className="font-medium">
                      {t.customer_name}
                      <div className="text-xs font-normal text-gray-400">{t.customer_phone}</div>
                    </td>
                    <td>{t.invoice_number ?? "-"}</td>
                    <td>{t.product_name}</td>
                    <td className="font-mono text-xs">{t.imei_1 || t.serial_no || "-"}</td>
                    <td>{t.finance_partner?.name ?? "-"}</td>
                    <td className="text-right">{formatCurrency(t.sale_amount)}</td>
                    <td className="text-right">{formatCurrency(t.down_payment)}</td>
                    <td className="text-right">{formatCurrency(t.finance_amount)}</td>
                    <td><StatusPill status={t.status} label={STATUS_LABEL[t.status]} /></td>
                    <td className="capitalize text-xs text-gray-500">{t.reconciliation_status}</td>
                    <td className="text-right">{formatCurrency((t.finance_amount || 0) - (t.actual_settlement_amount || 0))}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-gray-400">No finance transactions found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4 overflow-y-auto">
          <div className="card my-8 w-full max-w-lg space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-gray-800">New Finance Sale</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}

            <label className="block text-xs text-gray-500">
              Customer
              <select className="input mt-0.5" value={form.customer_id} onChange={(e) => onPickCustomer(e.target.value)}>
                <option value="">Walk-in / type below</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Customer name *" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
              <input className="input" placeholder="Mobile number" value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} />
            </div>

            <label className="block text-xs text-gray-500">
              Link to Sale / Invoice (optional — pulls IMEI &amp; amount automatically)
              <select className="input mt-0.5" value={form.sale_id} onChange={(e) => onPickSale(e.target.value)} disabled={!form.customer_id}>
                <option value="">No linked sale</option>
                {customerSales.map((s) => <option key={s.id} value={s.id}>{s.invoice_number} — {formatCurrency(s.final_amount)}</option>)}
              </select>
            </label>
            {saleItems.length > 0 && (
              <label className="block text-xs text-gray-500">
                Stock Unit / Item
                <select className="input mt-0.5" onChange={(e) => onPickSaleItem(e.target.value)} defaultValue="">
                  <option value="" disabled>Select the financed item...</option>
                  {saleItems.map((i) => <option key={i.id} value={i.id}>{i.item_name}{i.serial_no ? ` — ${i.serial_no}` : ""}</option>)}
                </select>
              </label>
            )}
            {stockUnit && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600">
                IMEI 1: <span className="font-mono">{stockUnit.imei_1 ?? "-"}</span> · IMEI 2: <span className="font-mono">{stockUnit.imei_2 ?? "-"}</span> · Serial: <span className="font-mono">{stockUnit.serial_no ?? "-"}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Product name *" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
              <input className="input" placeholder="Invoice number" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              <input className="input" placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            {!stockUnit && (
              <div className="grid grid-cols-3 gap-2">
                <input className="input" placeholder="IMEI 1" value={form.imei_1} onChange={(e) => setForm({ ...form, imei_1: e.target.value })} />
                <input className="input" placeholder="IMEI 2" value={form.imei_2} onChange={(e) => setForm({ ...form, imei_2: e.target.value })} />
                <input className="input" placeholder="Serial No." value={form.serial_no} onChange={(e) => setForm({ ...form, serial_no: e.target.value })} />
              </div>
            )}

            <label className="block text-xs text-gray-500">
              Finance Partner *
              <select className="input mt-0.5" value={form.finance_partner_id} onChange={(e) => setForm({ ...form, finance_partner_id: e.target.value })}>
                <option value="">Select partner...</option>
                {partners.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            <div className="grid grid-cols-3 gap-2">
              <label className="block text-xs text-gray-500">
                Sale Amount
                <input type="number" className="input mt-0.5" value={form.sale_amount || ""} onChange={(e) => {
                  const v = Number(e.target.value);
                  setForm((f) => ({ ...f, sale_amount: v, finance_amount: Math.max(0, v - f.down_payment) }));
                }} />
              </label>
              <label className="block text-xs text-gray-500">
                Down Payment
                <input type="number" className="input mt-0.5" value={form.down_payment || ""} onChange={(e) => {
                  const v = Number(e.target.value);
                  setForm((f) => ({ ...f, down_payment: v, finance_amount: Math.max(0, f.sale_amount - v) }));
                }} />
              </label>
              <label className="block text-xs text-gray-500">
                Finance Amount
                <input type="number" className="input mt-0.5" value={form.finance_amount || ""} onChange={(e) => setForm({ ...form, finance_amount: Number(e.target.value) })} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-gray-500">
                Tenure (months)
                <input type="number" className="input mt-0.5" value={form.tenure_months || ""} onChange={(e) => {
                  const v = Number(e.target.value);
                  setForm((f) => ({ ...f, tenure_months: v, emi_amount: recalcEmi(f.finance_amount, v) }));
                }} />
              </label>
              <label className="block text-xs text-gray-500">
                EMI Amount / month
                <input type="number" className="input mt-0.5" value={form.emi_amount || ""} onChange={(e) => setForm({ ...form, emi_amount: Number(e.target.value) })} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Application Number" value={form.application_number} onChange={(e) => setForm({ ...form, application_number: e.target.value })} />
              <input className="input" placeholder="Agreement / Loan Number" value={form.agreement_number} onChange={(e) => setForm({ ...form, agreement_number: e.target.value })} />
            </div>
            <textarea className="input" placeholder="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={submitNew} disabled={saving}>{saving ? "Saving..." : "Create Finance Sale"}</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4 overflow-y-auto">
          <div className="card my-8 w-full max-w-2xl space-y-4 p-5">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">{detail.customer_name} — {detail.product_name}</h2>
                <span className="text-xs text-gray-400">{detail.invoice_number ?? "No linked invoice"} · {detail.finance_partner?.name}</span>
              </div>
              <button onClick={() => setDetail(null)}><X size={16} /></button>
            </div>

            {actionError && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger whitespace-pre-wrap">{actionError}</div>}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <dt className="text-gray-500">Sale Amount</dt><dd>{formatCurrency(detail.sale_amount)}</dd>
              <dt className="text-gray-500">Down Payment</dt><dd>{formatCurrency(detail.down_payment)}</dd>
              <dt className="text-gray-500">Finance Amount</dt><dd>{formatCurrency(detail.finance_amount)}</dd>
              <dt className="text-gray-500">Tenure</dt><dd>{detail.tenure_months} mo</dd>
              <dt className="text-gray-500">EMI</dt><dd>{formatCurrency(detail.emi_amount)}</dd>
              <dt className="text-gray-500">Application No.</dt><dd>{detail.application_number ?? "-"}</dd>
              <dt className="text-gray-500">Agreement No.</dt><dd>{detail.agreement_number ?? "-"}</dd>
              <dt className="text-gray-500">IMEI</dt><dd className="font-mono">{detail.imei_1 || detail.serial_no || "-"}</dd>
            </dl>

            <div className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-gray-500">Status: <StatusPill status={detail.status} label={STATUS_LABEL[detail.status]} /></span>
              </div>
              {FINANCE_STATUS_TRANSITIONS[detail.status].length > 0 && (
                <>
                  <input className="input mb-2 !py-1 text-xs" placeholder="Reason / note for this status change (optional)" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
                  <div className="flex flex-wrap gap-1.5">
                    {FINANCE_STATUS_TRANSITIONS[detail.status].map((s) => (
                      <button key={s} className="btn-secondary !py-1 text-xs" disabled={statusBusy} onClick={() => changeStatus(s)}>
                        {statusBusy ? "..." : STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {(detail.status === "disbursed" || detail.status === "settlement_pending" || detail.status === "settled") && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <span className="text-xs font-semibold uppercase text-gray-500">Settlement / Reconciliation</span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-gray-500">
                    Expected Settlement
                    <input type="number" className="input mt-0.5" value={settlementForm.expected_settlement_amount} onChange={(e) => setSettlementForm({ ...settlementForm, expected_settlement_amount: e.target.value })} />
                  </label>
                  <label className="block text-xs text-gray-500">
                    Actual Settlement
                    <input type="number" className="input mt-0.5" value={settlementForm.actual_settlement_amount} onChange={(e) => setSettlementForm({ ...settlementForm, actual_settlement_amount: e.target.value })} />
                  </label>
                  <label className="block text-xs text-gray-500">
                    Processing Fee
                    <input type="number" className="input mt-0.5" value={settlementForm.processing_fee} onChange={(e) => setSettlementForm({ ...settlementForm, processing_fee: e.target.value })} />
                  </label>
                  <label className="block text-xs text-gray-500">
                    Commission
                    <input type="number" className="input mt-0.5" value={settlementForm.commission} onChange={(e) => setSettlementForm({ ...settlementForm, commission: e.target.value })} />
                  </label>
                  <label className="block text-xs text-gray-500">
                    Other Deduction
                    <input type="number" className="input mt-0.5" value={settlementForm.other_deduction} onChange={(e) => setSettlementForm({ ...settlementForm, other_deduction: e.target.value })} />
                  </label>
                  <label className="block text-xs text-gray-500">
                    Adjustment
                    <input type="number" className="input mt-0.5" value={settlementForm.adjustment} onChange={(e) => setSettlementForm({ ...settlementForm, adjustment: e.target.value })} />
                  </label>
                  <label className="block text-xs text-gray-500">
                    Settlement Date
                    <input type="date" className="input mt-0.5" value={settlementForm.settlement_date} onChange={(e) => setSettlementForm({ ...settlementForm, settlement_date: e.target.value })} />
                  </label>
                  <label className="block text-xs text-gray-500">
                    UTR / Settlement Reference
                    <input className="input mt-0.5" value={settlementForm.settlement_reference} onChange={(e) => setSettlementForm({ ...settlementForm, settlement_reference: e.target.value })} />
                  </label>
                  <label className="block text-xs text-gray-500 col-span-2">
                    Reconciliation Status
                    <select className="input mt-0.5" value={settlementForm.reconciliation_status} onChange={(e) => setSettlementForm({ ...settlementForm, reconciliation_status: e.target.value as ReconciliationStatus })}>
                      <option value="pending">Pending</option>
                      <option value="matched">Matched</option>
                      <option value="mismatch">Mismatch</option>
                    </select>
                  </label>
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary !py-1 text-xs" disabled={settlementBusy} onClick={saveSettlement}>{settlementBusy ? "Saving..." : "Save Settlement"}</button>
                </div>
              </div>
            )}

            <div className="border-t border-border pt-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                <Clock size={13} /> Status History
              </div>
              <ol className="space-y-2 border-l border-gray-200 pl-3">
                {history.map((h) => (
                  <li key={h.id} className="relative text-xs">
                    <span className="absolute -left-[17px] top-0.5 h-2 w-2 rounded-full bg-brand-primary" />
                    <div className="font-medium text-gray-800">{h.from_status ? `${STATUS_LABEL[h.from_status]} → ` : ""}{STATUS_LABEL[h.to_status]}</div>
                    <div className="text-gray-500">{formatDateTime(h.created_at)}</div>
                    {h.note && <div className="text-gray-500">{h.note}</div>}
                  </li>
                ))}
                {history.length === 0 && <p className="text-xs text-gray-400">No history recorded.</p>}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
