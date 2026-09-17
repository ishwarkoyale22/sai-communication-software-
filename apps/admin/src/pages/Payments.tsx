import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDateTime, computePaymentSplit } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";

// Requirements doc §12 "Payment Management": a single place that shows how
// much money has come in through each mode (UPI/Cash/Card/Finance-EMI)
// across every source it can arrive through — offline sales, website
// orders, and the standalone EMI/Finance ledger — rather than fragmented
// across three separate pages (Sales, WebOrders, Emi) as before.

interface PaymentRow {
  id: string;
  source: "Sale" | "Website Order" | "Finance/EMI";
  reference: string;
  customerName: string;
  amount: number;
  paymentMethod: string;
  createdAt: string;
}

export function Payments() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    load();
    const channel = supabase
      .channel("payments-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "website_orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_transactions" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const [{ data: sales }, { data: orders }, { data: emi }] = await Promise.all([
      supabase.from("sales").select("id, invoice_number, customer_name, final_amount, payment_method, created_at"),
      supabase.from("website_orders").select("id, order_number, customer_name, total_amount, payment_method, created_at"),
      supabase.from("finance_transactions").select("id, product_name, customer_name, finance_amount, finance_date"),
    ]);

    const combined: PaymentRow[] = [
      ...((sales ?? []) as any[]).map((s) => ({
        id: `sale-${s.id}`,
        source: "Sale" as const,
        reference: s.invoice_number,
        customerName: s.customer_name,
        amount: Number(s.final_amount ?? 0),
        paymentMethod: s.payment_method ?? "",
        createdAt: s.created_at,
      })),
      ...((orders ?? []) as any[]).map((o) => ({
        id: `order-${o.id}`,
        source: "Website Order" as const,
        reference: o.order_number,
        customerName: o.customer_name,
        amount: Number(o.total_amount ?? 0),
        paymentMethod: o.payment_method ?? "",
        createdAt: o.created_at,
      })),
      ...((emi ?? []) as any[]).map((e) => ({
        id: `finance-${e.id}`,
        source: "Finance/EMI" as const,
        reference: e.product_name,
        customerName: e.customer_name,
        amount: Number(e.finance_amount ?? 0),
        paymentMethod: "emi",
        createdAt: e.finance_date,
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    setRows(combined);
  }

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (dateFrom && r.createdAt < dateFrom) return false;
        if (dateTo && r.createdAt > dateTo + "T23:59:59") return false;
        return true;
      }),
    [rows, dateFrom, dateTo]
  );

  const split = useMemo(
    () => computePaymentSplit(filtered.filter((r) => r.source !== "Finance/EMI").map((r) => ({ amount: r.amount, paymentMethod: r.paymentMethod })), filtered.filter((r) => r.source === "Finance/EMI").reduce((s, r) => s + r.amount, 0)),
    [filtered]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Payment Management</h1>
        <ExportExcelButton
          rows={filtered.map((r) => ({
            Source: r.source,
            Reference: r.reference,
            Customer: r.customerName,
            Amount: r.amount,
            "Payment Method": r.paymentMethod,
            Date: r.createdAt,
          }))}
          fileName="payments"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="input w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span className="text-sm text-gray-400">to</span>
        <input type="date" className="input w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.entries(split.byMode) as [string, number][])
          .filter(([mode]) => mode !== "Other" || split.byMode.Other > 0)
          .map(([mode, amount]) => {
            const tile =
              mode === "UPI" ? "card-blue" : mode === "Cash" ? "card-green" : mode === "Card" ? "card-gold" : mode === "Finance/EMI" ? "card-purple" : "card";
            return (
              <div key={mode} className={`${tile} p-4`}>
                <div className="text-xs font-medium text-gray-500">{mode}</div>
                <div className="mt-1 font-serif text-xl font-semibold text-gray-800">{formatCurrency(amount)}</div>
              </div>
            );
          })}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Source</th>
              <th>Reference</th>
              <th>Customer</th>
              <th className="text-right">Amount</th>
              <th>Payment Method</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="text-gray-500">{r.source}</td>
                <td className="font-medium">{r.reference}</td>
                <td>{r.customerName}</td>
                <td className="text-right">{formatCurrency(r.amount)}</td>
                <td className="capitalize text-gray-500">{r.paymentMethod.replace(/_/g, " ")}</td>
                <td className="text-gray-500">{formatDateTime(r.createdAt)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">No payments found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
