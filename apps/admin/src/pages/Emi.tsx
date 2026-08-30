import { useEffect, useState } from "react";
import { formatCurrency, formatDate, type Sale, type FinancePartner, type Customer } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";

type EmiSale = Sale & { customer?: Customer | null; finance_partner?: FinancePartner | null };

export function Emi() {
  const [sales, setSales] = useState<EmiSale[]>([]);
  const [partners, setPartners] = useState<FinancePartner[]>([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase
        .from("sales")
        .select("*, customer:customers(*), finance_partner:finance_partners(*)")
        .not("finance_partner_id", "is", null)
        .order("created_at", { ascending: false }),
      supabase.from("finance_partners").select("*"),
    ]);
    setSales((s as any) ?? []);
    setPartners(p ?? []);
  }

  const outstandingByPartner = partners.map((p) => ({
    partner: p,
    total: sales.filter((s) => s.finance_partner_id === p.id).reduce((sum, s) => sum + Number(s.total_amount), 0),
    count: sales.filter((s) => s.finance_partner_id === p.id).length,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">EMI / Finance Partners</h1>
        <ExportExcelButton
          rows={sales.map((s) => ({
            Invoice: s.invoice_number,
            Customer: s.customer?.name,
            Partner: s.finance_partner?.name,
            Months: s.emi_months,
            "EMI/mo": s.emi_amount,
            Total: s.total_amount,
            Date: s.created_at,
          }))}
          fileName="emi-finance"
        />
      </div>

      <div className="grid grid-cols-4 gap-3">
        {outstandingByPartner.map((o) => (
          <div key={o.partner.id} className="card p-4">
            <div className="text-xs font-medium text-gray-500">{o.partner.name}</div>
            <div className="mt-1 text-lg font-semibold text-gray-800">{formatCurrency(o.total)}</div>
            <div className="text-xs text-gray-400">{o.count} sales</div>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Partner</th>
              <th className="text-right">Months</th>
              <th className="text-right">EMI/mo</th>
              <th className="text-right">Total</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.invoice_number}</td>
                <td>{s.customer?.name}</td>
                <td>{s.finance_partner?.name}</td>
                <td className="text-right">{s.emi_months}</td>
                <td className="text-right">{formatCurrency(s.emi_amount)}</td>
                <td className="text-right">{formatCurrency(s.total_amount)}</td>
                <td className="text-gray-500">{formatDate(s.created_at)}</td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  No EMI sales yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
