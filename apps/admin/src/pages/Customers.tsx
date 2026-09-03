import { useEffect, useState } from "react";
import { formatCurrency, formatDate } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { X } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  total_purchases: number;
  created_at: string;
}

interface Sale {
  id: string;
  customer_id: string | null;
  invoice_number: string;
  total_amount: number;
  created_at: string;
}

interface RepairRow {
  id: string;
  device_brand: string;
  device_model: string;
  status: string;
  received_at: string;
}

export function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [repairs, setRepairs] = useState<RepairRow[]>([]);

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
  }, [selected]);

  async function load() {
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("sales").select("id, customer_id, invoice_number, total_amount, created_at"),
    ]);
    setCustomers((c as Customer[]) ?? []);
    setSales((s as Sale[]) ?? []);
  }

  function spendFor(id: string) {
    return sales.filter((s) => s.customer_id === id).reduce((sum, s) => sum + Number(s.total_amount), 0);
  }
  function countFor(id: string) {
    return sales.filter((s) => s.customer_id === id).length;
  }

  const filtered = customers.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.phone?.includes(search)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Customers</h1>
        <ExportExcelButton
          rows={filtered.map((c) => ({
            Name: c.name,
            Phone: c.phone,
            Email: c.email,
            Address: c.address,
            Purchases: countFor(c.id),
            "Total Spend": spendFor(c.id),
          }))}
          fileName="customers"
        />
      </div>

      <input
        placeholder="Search name or phone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input w-64"
      />

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th className="text-right">Purchases</th>
              <th className="text-right">Total Spend</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                <td className="font-medium text-brand-primary">{c.name}</td>
                <td>{c.phone}</td>
                <td className="text-gray-500">{c.email ?? "-"}</td>
                <td className="text-right">{countFor(c.id)}</td>
                <td className="text-right">{formatCurrency(spendFor(c.id))}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-400">
                  No customers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-[28rem] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">{selected.name}</h2>
              <button onClick={() => setSelected(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="mb-4 space-y-1 text-sm text-gray-600">
              <p>📞 {selected.phone}</p>
              {selected.email && <p>✉️ {selected.email}</p>}
              {selected.address && <p>📍 {selected.address}</p>}
            </div>
            <div className="mb-2 text-xs font-semibold uppercase text-gray-400">Purchase History</div>
            <div className="mb-4 max-h-40 space-y-1 overflow-y-auto">
              {sales
                .filter((s) => s.customer_id === selected.id)
                .map((s) => (
                  <div key={s.id} className="flex justify-between text-sm">
                    <span>{s.invoice_number}</span>
                    <span className="text-gray-500">{formatDate(s.created_at)}</span>
                    <span className="font-medium">{formatCurrency(s.total_amount)}</span>
                  </div>
                ))}
              {sales.filter((s) => s.customer_id === selected.id).length === 0 && (
                <p className="text-sm text-gray-400">No purchases yet</p>
              )}
            </div>

            <div className="mb-2 text-xs font-semibold uppercase text-gray-400">Repairs</div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {repairs.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <span>{r.device_brand} {r.device_model}</span>
                  <StatusPill status={r.status} />
                  <span className="text-gray-500">{formatDate(r.received_at)}</span>
                </div>
              ))}
              {repairs.length === 0 && <p className="text-sm text-gray-400">No repairs on file</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
