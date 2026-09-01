import { useEffect, useState } from "react";
import { formatDateTime } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";

type EnquiryStatus = "new" | "contacted" | "closed";
interface Enquiry {
  id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  subject: string | null;
  message: string | null;
  status: EnquiryStatus;
  created_at: string;
}

export function Enquiries() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | EnquiryStatus>("all");

  useEffect(() => {
    load();
    // New enquiries submitted on the public website land here immediately.
    const channel = supabase
      .channel("enquiries-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "enquiries" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("enquiries").select("*").order("created_at", { ascending: false });
    setEnquiries((data as Enquiry[]) ?? []);
  }

  async function setStatus(id: string, status: EnquiryStatus) {
    await supabase.from("enquiries").update({ status }).eq("id", id);
  }

  const filtered = statusFilter === "all" ? enquiries : enquiries.filter((e) => e.status === statusFilter);
  const newCount = enquiries.filter((e) => e.status === "new").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">
          Enquiries {newCount > 0 && <span className="pill-info ml-2 align-middle">{newCount} new</span>}
        </h1>
        <ExportExcelButton
          rows={filtered.map((e) => ({
            Name: e.customer_name,
            Phone: e.phone,
            Email: e.email,
            Subject: e.subject,
            Message: e.message,
            Status: e.status,
            Received: e.created_at,
          }))}
          fileName="enquiries"
        />
      </div>
      <p className="text-sm text-gray-500">Submitted from the public website's catalog / contact enquiry form.</p>

      <div className="flex gap-2">
        {(["all", "new", "contacted", "closed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${
              statusFilter === s ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-600"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone / Email</th>
              <th>Subject</th>
              <th>Message</th>
              <th>Received</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="font-medium">{e.customer_name}</td>
                <td>
                  {e.phone}
                  {e.email ? ` · ${e.email}` : ""}
                </td>
                <td>{e.subject ?? "-"}</td>
                <td className="max-w-xs truncate" title={e.message ?? ""}>
                  {e.message ?? "-"}
                </td>
                <td className="text-gray-500">{formatDateTime(e.created_at)}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <StatusPill status={e.status} />
                    <select
                      className="input !w-auto !py-0.5 text-xs"
                      value={e.status}
                      onChange={(ev) => setStatus(e.id, ev.target.value as EnquiryStatus)}
                    >
                      <option value="new">New</option>
                      <option value="contacted">Contacted</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  No enquiries yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
