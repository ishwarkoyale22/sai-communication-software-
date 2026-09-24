import { useEffect, useState } from "react";
import { formatCurrency, formatDateTime } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Undo2 } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "completed", label: "Completed" },
];

interface ReturnRow {
  id: string;
  order_id: string;
  reason: string;
  status: string;
  created_at: string;
  website_orders: { order_number: string; customer_name: string; customer_phone: string; total_amount: number } | null;
}

/** Return / refund requests filed by customers on the website. */
export function ReturnRequests() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("return-requests-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "return_requests" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data, error: err } = await supabase
      .from("return_requests")
      .select("*, website_orders(order_number, customer_name, customer_phone, total_amount)")
      .order("created_at", { ascending: false });
    if (err) setError(`Failed to load return requests: ${err.message}`);
    else {
      setError(null);
      setRows((data as unknown as ReturnRow[]) ?? []);
    }
    setLoading(false);
  }

  async function setStatus(id: string, status: string) {
    setUpdatingId(id);
    const { error: err } = await supabase.from("return_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    setUpdatingId(null);
    if (err) {
      window.alert(`Failed to update: ${err.message}`);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  const shown = rows.filter((r) => statusFilter === "all" || r.status === statusFilter);
  const openCount = rows.filter((r) => r.status === "requested").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
            <Undo2 size={18} /> Return Requests
            {openCount > 0 && <span className="pill-warning">{openCount} new</span>}
          </h1>
          <p className="text-xs text-gray-500">
            Return / refund requests customers file from their website account. Approving a return does not change stock — use the
            order's status (or IMEI Search for serialised phones) to reverse the sale.
          </p>
        </div>
        <ExportExcelButton
          fileName="return-requests"
          rows={shown.map((r) => ({
            Order: r.website_orders?.order_number ?? "",
            Customer: r.website_orders?.customer_name ?? "",
            Phone: r.website_orders?.customer_phone ?? "",
            Reason: r.reason,
            Status: r.status,
            Requested: r.created_at,
          }))}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {[{ value: "all", label: "All" }, ...STATUS_OPTIONS].map((o) => (
          <button
            key={o.value}
            onClick={() => setStatusFilter(o.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${statusFilter === o.value ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {o.label} ({o.value === "all" ? rows.length : rows.filter((r) => r.status === o.value).length})
          </button>
        ))}
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Reason</th>
              <th>Order Total</th>
              <th>Requested</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-sm text-gray-400">Loading…</td>
              </tr>
            )}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-sm text-gray-400">No return requests.</td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-xs font-semibold">{r.website_orders?.order_number ?? "—"}</td>
                <td>
                  <div className="text-sm font-medium">{r.website_orders?.customer_name ?? "—"}</div>
                  <div className="text-xs text-gray-400">{r.website_orders?.customer_phone}</div>
                </td>
                <td className="max-w-xs text-sm text-gray-600">{r.reason}</td>
                <td>{r.website_orders ? formatCurrency(r.website_orders.total_amount) : "—"}</td>
                <td className="text-xs text-gray-500">{formatDateTime(r.created_at)}</td>
                <td>
                  <StatusPill status={r.status} label={r.status} />
                </td>
                <td>
                  <select
                    className="input !w-auto !py-1 text-xs"
                    value={r.status}
                    disabled={updatingId === r.id}
                    onChange={(e) => setStatus(r.id, e.target.value)}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
