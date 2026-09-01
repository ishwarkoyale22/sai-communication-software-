import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatCurrency, type Customer, type Staff } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { LayoutGrid, List, Plus } from "lucide-react";

const REPAIR_STATUSES = ["received", "in_progress", "waiting_parts", "ready", "completed"] as const;
type RepairStatus = (typeof REPAIR_STATUSES)[number];

const STATUS_LABEL: Record<string, string> = {
  received: "Received",
  in_progress: "In Progress",
  waiting_parts: "Waiting Parts",
  ready: "Ready",
  completed: "Completed",
};

interface RepairRow {
  id: string;
  enquiry_id: string | null;
  customer_id: string | null;
  customer_name: string;
  phone: string;
  device_brand: string;
  device_model: string;
  problem: string;
  diagnosis: string | null;
  repair_cost: number | null;
  advance_paid: number;
  status: string;
  technician_id: string | null;
  received_at: string;
  completed_at: string | null;
  customer?: Customer | null;
  technician?: Staff | null;
}

const emptyForm = {
  customer_id: "",
  customer_name: "",
  phone: "",
  device_brand: "",
  device_model: "",
  problem: "",
  repair_cost: 0,
};

export function Repairs() {
  const [repairs, setRepairs] = useState<RepairRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    load();
    supabase.from("customers").select("*").order("name").then(({ data }) => setCustomers((data as Customer[]) ?? []));
    const channel = supabase
      .channel("repairs-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "repairs" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data, error } = await supabase
      .from("repairs")
      .select("*, customer:customers(*), technician:staff(*)")
      .order("received_at", { ascending: false });
    if (error) {
      // Fall back to a plain select if the FK-embed shorthand doesn't
      // resolve (e.g. ambiguous/missing FK name) rather than showing nothing.
      const { data: plain } = await supabase.from("repairs").select("*").order("received_at", { ascending: false });
      setRepairs((plain as RepairRow[]) ?? []);
      return;
    }
    setRepairs((data as any) ?? []);
  }

  async function setStatus(id: string, status: RepairStatus) {
    await supabase
      .from("repairs")
      .update({ status, completed_at: status === "completed" ? new Date().toISOString() : null })
      .eq("id", id);
  }

  async function addRepair() {
    if (!form.device_brand || !form.customer_name || !form.phone || !form.problem) return;
    await supabase.from("repairs").insert({
      customer_id: form.customer_id || null,
      customer_name: form.customer_name,
      phone: form.phone,
      device_brand: form.device_brand,
      device_model: form.device_model,
      problem: form.problem,
      repair_cost: form.repair_cost || null,
      status: "received",
    });
    setForm(emptyForm);
    setShowForm(false);
    load();
  }

  function daysOpen(r: RepairRow) {
    const end = r.completed_at ? new Date(r.completed_at) : new Date();
    return Math.max(0, Math.round((end.getTime() - new Date(r.received_at).getTime()) / 86400000));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Repairs</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={repairs.map((r) => ({
              Customer: r.customer_name,
              Phone: r.phone,
              Device: `${r.device_brand} ${r.device_model}`,
              Problem: r.problem,
              Status: STATUS_LABEL[r.status] ?? r.status,
              Technician: r.technician?.name,
              "Repair Cost": r.repair_cost,
              "Advance Paid": r.advance_paid,
              "Days Open": daysOpen(r),
            }))}
            fileName="repairs"
          />
          <button className="btn-secondary" onClick={() => setView(view === "kanban" ? "table" : "kanban")}>
            {view === "kanban" ? <List size={14} /> : <LayoutGrid size={14} />}
            {view === "kanban" ? "Table view" : "Kanban view"}
          </button>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add Repair
          </button>
        </div>
      </div>

      {view === "kanban" ? (
        <div className="grid grid-cols-5 gap-3">
          {REPAIR_STATUSES.map((status) => (
            <div key={status} className="rounded-card bg-gray-100 p-2">
              <div className="mb-2 px-1 text-xs font-semibold uppercase text-gray-500">
                {STATUS_LABEL[status]} ({repairs.filter((r) => r.status === status).length})
              </div>
              <div className="space-y-2">
                {repairs
                  .filter((r) => r.status === status)
                  .map((r) => (
                    <div key={r.id} className="card p-2.5">
                      <div className="text-sm font-medium">
                        {r.device_brand} {r.device_model}
                      </div>
                      <div className="text-xs text-gray-500">{r.customer_name}</div>
                      {r.enquiry_id && (
                        <Link to="/repair-enquiries" className="text-[11px] text-brand-primary hover:underline">
                          From website enquiry
                        </Link>
                      )}
                      <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
                        <span>{r.technician?.name ?? "Unassigned"}</span>
                        <span>{daysOpen(r)}d</span>
                      </div>
                      <select
                        className="input mt-2 !py-1 text-xs"
                        value={r.status}
                        onChange={(e) => setStatus(r.id, e.target.value as RepairStatus)}
                      >
                        {REPAIR_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Device</th>
                <th>Problem</th>
                <th>Status</th>
                <th>Technician</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Days Open</th>
              </tr>
            </thead>
            <tbody>
              {repairs.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">
                    {r.customer_name}
                    <div className="text-xs font-normal text-gray-400">{r.phone}</div>
                  </td>
                  <td>
                    {r.device_brand} {r.device_model}
                  </td>
                  <td className="max-w-xs truncate">{r.problem}</td>
                  <td>
                    <StatusPill status={r.status} label={STATUS_LABEL[r.status] ?? r.status} />
                  </td>
                  <td>{r.technician?.name ?? "-"}</td>
                  <td className="text-right">{formatCurrency(r.repair_cost ?? 0)}</td>
                  <td className="text-right">{daysOpen(r)}</td>
                </tr>
              ))}
              {repairs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400">
                    No repairs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-96 space-y-2.5 p-5">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Add Repair</h2>

            <select
              className="input"
              value={form.customer_id}
              onChange={(e) => {
                const c = customers.find((x) => x.id === e.target.value);
                setForm({ ...form, customer_id: e.target.value, customer_name: c?.name ?? form.customer_name, phone: c?.phone ?? form.phone });
              }}
            >
              <option value="">Walk-in / no customer on file</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `· ${c.phone}` : ""}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Customer name *"
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
            />
            <input
              className="input"
              placeholder="Phone *"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                placeholder="Device brand *"
                value={form.device_brand}
                onChange={(e) => setForm({ ...form, device_brand: e.target.value })}
              />
              <input
                className="input"
                placeholder="Model"
                value={form.device_model}
                onChange={(e) => setForm({ ...form, device_model: e.target.value })}
              />
            </div>
            <textarea
              className="input"
              placeholder="Problem *"
              value={form.problem}
              onChange={(e) => setForm({ ...form, problem: e.target.value })}
            />
            <input
              type="number"
              className="input"
              placeholder="Estimated repair cost"
              value={form.repair_cost || ""}
              onChange={(e) => setForm({ ...form, repair_cost: Number(e.target.value) })}
            />

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={addRepair}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
