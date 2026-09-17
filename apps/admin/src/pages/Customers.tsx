import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { ArrowUpDown, X } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  birthday: string | null;
  total_purchases: number;
  created_at: string;
}

interface Sale {
  id: string;
  customer_id: string | null;
  invoice_number: string;
  total_amount: number;
  payment_method: string | null;
  created_at: string;
}

interface SaleItemRow {
  sale_id: string;
  item_name: string;
  quantity: number;
}

interface RepairRow {
  id: string;
  device_brand: string;
  device_model: string;
  status: string;
  received_at: string;
}

interface FinanceRow {
  id: string;
  invoice_number: string | null;
  product_name: string;
  imei_1: string | null;
  serial_no: string | null;
  finance_amount: number;
  down_payment: number;
  tenure_months: number;
  emi_amount: number;
  application_number: string | null;
  agreement_number: string | null;
  status: string;
  reconciliation_status: string;
  finance_date: string;
  finance_partner: { name: string } | null;
}

type SortKey = "name" | "purchases_desc" | "spend_desc" | "recent";

export function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItemRow[]>([]);
  const [search, setSearch] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [repairs, setRepairs] = useState<RepairRow[]>([]);
  const [financeHistory, setFinanceHistory] = useState<FinanceRow[]>([]);

  useEffect(() => {
    load();
    // Without this, a customer created by a fresh walk-in sale (or a new
    // sale against an existing one) only ever showed up here after a full
    // page reload — this page never re-fetched on its own.
    const channel = supabase
      .channel("customers-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    supabase
      .from("repairs")
      .select("id, device_brand, device_model, status, received_at")
      .eq("customer_id", selected.id)
      .order("received_at", { ascending: false })
      .then(({ data }) => setRepairs((data as RepairRow[]) ?? []));
    supabase
      .from("finance_transactions")
      .select("id, invoice_number, product_name, imei_1, serial_no, finance_amount, down_payment, tenure_months, emi_amount, application_number, agreement_number, status, reconciliation_status, finance_date, finance_partner:finance_partner_id(name)")
      .eq("customer_id", selected.id)
      .order("finance_date", { ascending: false })
      .then(({ data }) => setFinanceHistory((data as unknown as FinanceRow[]) ?? []));
  }, [selected]);

  async function load() {
    const [{ data: c }, { data: s }, { data: si }] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("sales").select("id, customer_id, invoice_number, total_amount, payment_method, created_at"),
      supabase.from("sales_items").select("sale_id, item_name, quantity"),
    ]);
    setCustomers((c as Customer[]) ?? []);
    setSales((s as Sale[]) ?? []);
    setSaleItems((si as SaleItemRow[]) ?? []);
  }

  function salesFor(id: string) {
    return sales.filter((s) => s.customer_id === id);
  }
  function spendFor(id: string) {
    return salesFor(id).reduce((sum, s) => sum + Number(s.total_amount), 0);
  }
  function countFor(id: string) {
    return salesFor(id).length;
  }
  function lastPurchaseAt(id: string) {
    const list = salesFor(id);
    if (list.length === 0) return null;
    return list.reduce((latest, s) => (s.created_at > latest ? s.created_at : latest), list[0].created_at);
  }
  function itemsForSale(saleId: string) {
    return saleItems.filter((i) => i.sale_id === saleId).map((i) => `${i.item_name} ×${i.quantity}`).join(", ");
  }

  const filtered = useMemo(() => {
    return customers
      .filter((c) => {
        if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.phone?.includes(search)) return false;
        if (minSpend && spendFor(c.id) < Number(minSpend)) return false;
        if (dateFrom || dateTo) {
          const has = salesFor(c.id).some((s) => {
            if (dateFrom && s.created_at < dateFrom) return false;
            if (dateTo && s.created_at > dateTo + "T23:59:59") return false;
            return true;
          });
          if (!has) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortKey === "purchases_desc") return countFor(b.id) - countFor(a.id);
        if (sortKey === "spend_desc") return spendFor(b.id) - spendFor(a.id);
        if (sortKey === "recent") return (lastPurchaseAt(b.id) ?? "").localeCompare(lastPurchaseAt(a.id) ?? "");
        return a.name.localeCompare(b.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, sales, search, minSpend, dateFrom, dateTo, sortKey]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Customers</h1>
        <ExportExcelButton
          rows={filtered.map((c) => ({
            Name: c.name,
            Phone: c.phone,
            Email: c.email,
            "Date of Birth": c.birthday,
            Address: c.address,
            Purchases: countFor(c.id),
            "Total Spend": spendFor(c.id),
          }))}
          fileName="customers"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          placeholder="Search name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-64"
        />
        <input
          type="number"
          placeholder="Min spend (₹)"
          value={minSpend}
          onChange={(e) => setMinSpend(e.target.value)}
          className="input w-36"
        />
        <input type="date" className="input w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span className="text-sm text-gray-400">to</span>
        <input type="date" className="input w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <select className="input w-auto" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="name">Sort: Name (A-Z)</option>
          <option value="purchases_desc">Sort: Most Purchases</option>
          <option value="spend_desc">Sort: Highest Spend</option>
          <option value="recent">Sort: Most Recent Purchase</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>DOB</th>
              <th
                className="cursor-pointer text-right"
                onClick={() => setSortKey("purchases_desc")}
                title="Sort by purchases"
              >
                <span className="inline-flex items-center gap-1">Purchases <ArrowUpDown size={11} /></span>
              </th>
              <th
                className="cursor-pointer text-right"
                onClick={() => setSortKey("spend_desc")}
                title="Sort by spend"
              >
                <span className="inline-flex items-center gap-1">Total Spend <ArrowUpDown size={11} /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                <td className="font-medium text-brand-primary">{c.name}</td>
                <td>{c.phone}</td>
                <td className="text-gray-500">{c.email ?? "-"}</td>
                <td className="text-gray-500">{c.birthday ? formatDate(c.birthday) : "-"}</td>
                <td className="text-right">{countFor(c.id)}</td>
                <td className="text-right">{formatCurrency(spendFor(c.id))}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  No customers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-[32rem] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">{selected.name}</h2>
              <button onClick={() => setSelected(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="mb-4 space-y-1 text-sm text-gray-600">
              <p>📞 {selected.phone}</p>
              {selected.email && <p>✉️ {selected.email}</p>}
              {selected.birthday && <p>🎂 {formatDate(selected.birthday)}</p>}
              {selected.address && <p>📍 {selected.address}</p>}
            </div>
            <div className="mb-2 text-xs font-semibold uppercase text-gray-400">Purchase History</div>
            <div className="mb-4 max-h-48 space-y-2 overflow-y-auto">
              {salesFor(selected.id).map((s) => (
                <div key={s.id} className="rounded border border-gray-100 p-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{s.invoice_number}</span>
                    <span className="font-medium">{formatCurrency(s.total_amount)}</span>
                  </div>
                  <div className="mt-0.5 flex justify-between text-xs text-gray-500">
                    <span className="capitalize">{itemsForSale(s.id) || "-"}</span>
                  </div>
                  <div className="mt-0.5 flex justify-between text-xs text-gray-500">
                    <span className="capitalize">{s.payment_method ?? "-"}</span>
                    <span>{formatDate(s.created_at)}</span>
                  </div>
                </div>
              ))}
              {salesFor(selected.id).length === 0 && (
                <p className="text-sm text-gray-400">No purchases yet</p>
              )}
            </div>

            <div className="mb-2 text-xs font-semibold uppercase text-gray-400">Repairs</div>
            <div className="mb-4 max-h-40 space-y-1 overflow-y-auto">
              {repairs.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <span>{r.device_brand} {r.device_model}</span>
                  <StatusPill status={r.status} />
                  <span className="text-gray-500">{formatDate(r.received_at)}</span>
                </div>
              ))}
              {repairs.length === 0 && <p className="text-sm text-gray-400">No repairs on file</p>}
            </div>

            <div className="mb-2 text-xs font-semibold uppercase text-gray-400">Finance / EMI History</div>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {financeHistory.map((f) => (
                <div key={f.id} className="rounded border border-gray-100 p-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{f.product_name}</span>
                    <span className="font-medium">{formatCurrency(f.finance_amount)}</span>
                  </div>
                  <div className="mt-0.5 flex justify-between text-xs text-gray-500">
                    <span>{f.finance_partner?.name ?? "-"} · {f.tenure_months}mo · {formatCurrency(f.emi_amount)}/mo</span>
                    <StatusPill status={f.status} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-xs text-gray-500">
                    <span>{f.invoice_number ?? "-"} {f.imei_1 ? `· IMEI ${f.imei_1}` : f.serial_no ? `· SN ${f.serial_no}` : ""}</span>
                    <span>{formatDate(f.finance_date)}</span>
                  </div>
                  {(f.application_number || f.agreement_number) && (
                    <div className="mt-0.5 text-xs text-gray-400">
                      {f.application_number ? `App# ${f.application_number}` : ""}{f.application_number && f.agreement_number ? " · " : ""}{f.agreement_number ? `Loan# ${f.agreement_number}` : ""}
                    </div>
                  )}
                </div>
              ))}
              {financeHistory.length === 0 && <p className="text-sm text-gray-400">No finance/EMI purchases yet</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
