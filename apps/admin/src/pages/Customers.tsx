import { useEffect, useState } from "react";
import { formatCurrency, formatDate, formatDateTime, type Customer, type Sale, type Repair, type CustomerNote, type Staff } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { X } from "lucide-react";

export function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [search, setSearch] = useState("");
  const [birthdayFilter, setBirthdayFilter] = useState<"none" | "week" | "month">("none");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [notes, setNotes] = useState<(CustomerNote & { staff?: Staff | null })[]>([]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selected) return;
    supabase
      .from("repairs")
      .select("*")
      .eq("customer_id", selected.id)
      .order("received_at", { ascending: false })
      .then(({ data }) => setRepairs(data ?? []));
    supabase
      .from("customer_notes")
      .select("*, staff:staff(*)")
      .eq("customer_id", selected.id)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: any }) => setNotes(data ?? []));
  }, [selected]);

  async function load() {
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("sales").select("*"),
    ]);
    setCustomers(c ?? []);
    setSales(s ?? []);
  }

  function spendFor(id: string) {
    return sales.filter((s) => s.customer_id === id).reduce((sum, s) => sum + Number(s.total_amount), 0);
  }
  function countFor(id: string) {
    return sales.filter((s) => s.customer_id === id).length;
  }

  const filtered = customers.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.phone?.includes(search)) return false;
    if (birthdayFilter !== "none" && c.birthday) {
      const today = new Date();
      const bday = new Date(c.birthday);
      bday.setFullYear(today.getFullYear());
      const diffDays = (bday.getTime() - today.getTime()) / 86400000;
      const window = birthdayFilter === "week" ? 7 : 30;
      if (diffDays < 0 || diffDays > window) return false;
    } else if (birthdayFilter !== "none") {
      return false;
    }
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
            Birthday: c.birthday,
            Purchases: countFor(c.id),
            "Total Spend": spendFor(c.id),
          }))}
          fileName="customers"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          placeholder="Search name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-64"
        />
        <select className="input w-auto" value={birthdayFilter} onChange={(e) => setBirthdayFilter(e.target.value as any)}>
          <option value="none">All customers</option>
          <option value="week">Birthday this week</option>
          <option value="month">Birthday this month</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Birthday</th>
              <th className="text-right">Purchases</th>
              <th className="text-right">Total Spend</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                <td className="font-medium text-brand-primary">{c.name}</td>
                <td>{c.phone}</td>
                <td>{c.birthday ? formatDate(c.birthday) : "-"}</td>
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
              {selected.birthday && <p>🎂 {formatDate(selected.birthday)}</p>}
              {selected.gst_number && <p>GSTIN: {selected.gst_number}</p>}
              {selected.notes && <p className="italic text-gray-500">Notes: {selected.notes}</p>}
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

            <div className="mb-2 text-xs font-semibold uppercase text-gray-400">Services Taken (Repairs)</div>
            <div className="mb-4 max-h-40 space-y-1 overflow-y-auto">
              {repairs.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <span>{r.device_name}</span>
                  <StatusPill status={r.status} />
                  <span className="text-gray-500">{formatDate(r.received_at)}</span>
                </div>
              ))}
              {repairs.length === 0 && <p className="text-sm text-gray-400">No repairs on file</p>}
            </div>

            <div className="mb-2 text-xs font-semibold uppercase text-gray-400">Staff Notes</div>
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {notes.map((n) => (
                <div key={n.id} className="rounded bg-gray-50 p-2 text-sm">
                  <p className="text-gray-700">{n.note}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {n.staff?.name ?? "Staff"} · {formatDateTime(n.created_at)}
                  </p>
                </div>
              ))}
              {notes.length === 0 && <p className="text-sm text-gray-400">No staff notes yet</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
