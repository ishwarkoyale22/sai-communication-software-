import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { REPAIR_STATUSES, formatCurrency, type Repair, type RepairStatus, type RepairChannel, type Customer, type Staff } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { LayoutGrid, List, Plus } from "lucide-react";

type RepairRow = Repair & { customer?: Customer | null; staff?: Staff | null };

const STATUS_LABEL: Record<RepairStatus, string> = {
  received: "Received",
  in_progress: "In Progress",
  waiting_parts: "Waiting Parts",
  ready: "Ready",
  collected: "Collected",
};

const emptyForm = {
  customer_id: "",
  device_name: "",
  issue_description: "",
  estimated_cost: 0,
  channel: "offline" as RepairChannel,
};

export function Repairs() {
  const [repairs, setRepairs] = useState<RepairRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [channelFilter, setChannelFilter] = useState<"all" | RepairChannel>("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    load();
    supabase.from("customers").select("*").order("name").then(({ data }) => setCustomers(data ?? []));
    const channel = supabase
      .channel("repairs-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "repairs" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase
      .from("repairs")
      .select("*, customer:customers(*), staff:staff!repairs_assigned_staff_fkey(*)")
      .order("received_at", { ascending: false });
    setRepairs((data as any) ?? []);
  }

  async function setStatus(id: string, status: RepairStatus) {
    await supabase
      .from("repairs")
      .update({ status, completed_at: status === "collected" ? new Date().toISOString() : null })
      .eq("id", id);
  }

  async function addRepair() {
    if (!form.device_name) return;
    const { data: repairNumber } = await supabase.rpc("next_repair_number");
    await supabase.from("repairs").insert({
      repair_number: repairNumber,
      customer_id: form.customer_id || null,
      device_name: form.device_name,
      issue_description: form.issue_description || null,
      estimated_cost: form.estimated_cost || null,
      channel: form.channel,
    });
    setForm(emptyForm);
    setShowForm(false);
    load();
  }

  function daysOpen(r: RepairRow) {
    const end = r.completed_at ? new Date(r.completed_at) : new Date();
    return Math.max(0, Math.round((end.getTime() - new Date(r.received_at).getTime()) / 86400000));
  }

  const filtered = channelFilter === "all" ? repairs : repairs.filter((r) => r.channel === channelFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Repairs</h1>
        <div className="flex gap-2">
          <select className="input !w-auto" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value as any)}>
            <option value="all">Online + Offline</option>
            <option value="online">Online only</option>
            <option value="offline">Offline only</option>
          </select>
          <ExportExcelButton
            rows={filtered.map((r) => ({
              "Repair #": r.repair_number,
              Customer: r.customer?.name,
              Device: r.device_name,
              Channel: r.channel,
              Status: STATUS_LABEL[r.status],
              Staff: r.staff?.name,
              "Est. Cost": r.estimated_cost,
              "Final Cost": r.final_cost,
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
                {STATUS_LABEL[status]} ({filtered.filter((r) => r.status === status).length})
              </div>
              <div className="space-y-2">
                {filtered
                  .filter((r) => r.status === status)
                  .map((r) => (
                    <div key={r.id} className="card p-2.5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-gray-700">{r.repair_number}</div>
                        <StatusPill status={r.channel} />
                      </div>
                      <div className="text-sm font-medium">{r.device_name}</div>
                      <div className="text-xs text-gray-500">{r.customer?.name}</div>
                      {r.repair_enquiry_id && (
                        <Link to="/repair-enquiries" className="text-[11px] text-brand-primary hover:underline">
                          From website enquiry
                        </Link>
                      )}
                      <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
                        <span>{r.staff?.name ?? "Unassigned"}</span>
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
                <th>Repair #</th>
                <th>Customer</th>
                <th>Device</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Staff</th>
                <th className="text-right">Est. / Final Cost</th>
                <th className="text-right">Days Open</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.repair_number}</td>
                  <td>{r.customer?.name}</td>
                  <td>{r.device_name}</td>
                  <td>
                    <StatusPill status={r.channel} />
                  </td>
                  <td>
                    <StatusPill status={r.status} label={STATUS_LABEL[r.status]} />
                  </td>
                  <td>{r.staff?.name ?? "-"}</td>
                  <td className="text-right">
                    {formatCurrency(r.estimated_cost)} / {formatCurrency(r.final_cost)}
                  </td>
                  <td className="text-right">{daysOpen(r)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-400">
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

            <select className="input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">Walk-in / no customer on file</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `· ${c.phone}` : ""}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Device (e.g. iPhone 13 - cracked screen)"
              value={form.device_name}
              onChange={(e) => setForm({ ...form, device_name: e.target.value })}
            />
            <textarea
              className="input"
              placeholder="Issue description"
              value={form.issue_description}
              onChange={(e) => setForm({ ...form, issue_description: e.target.value })}
            />
            <input
              type="number"
              className="input"
              placeholder="Estimated cost"
              value={form.estimated_cost || ""}
              onChange={(e) => setForm({ ...form, estimated_cost: Number(e.target.value) })}
            />

            <div className="grid grid-cols-2 gap-2">
              {(["offline", "online"] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setForm({ ...form, channel: ch })}
                  className={`rounded-md border py-2 text-sm font-medium capitalize ${
                    form.channel === ch ? "border-brand-primary bg-brand-primary/10 text-brand-primary" : "border-gray-300 text-gray-500"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>

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
