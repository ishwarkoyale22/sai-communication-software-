import { useEffect, useState } from "react";
import { formatDateTime } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { X, MessageSquarePlus } from "lucide-react";

type EnquiryStatus = "new" | "contacted" | "closed";
interface Enquiry {
  id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  subject: string | null;
  message: string | null;
  status: EnquiryStatus;
  contact_notes: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export function Enquiries() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | EnquiryStatus>("all");
  const [detail, setDetail] = useState<Enquiry | null>(null);
  const [contactNotesDraft, setContactNotesDraft] = useState("");
  const [resolutionNotesDraft, setResolutionNotesDraft] = useState("");
  const [saving, setSaving] = useState(false);

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

  function openDetail(e: Enquiry) {
    setDetail(e);
    setContactNotesDraft(e.contact_notes ?? "");
    setResolutionNotesDraft(e.resolution_notes ?? "");
  }

  async function saveNotes() {
    if (!detail) return;
    setSaving(true);
    try {
      await supabase
        .from("enquiries")
        .update({ contact_notes: contactNotesDraft || null, resolution_notes: resolutionNotesDraft || null })
        .eq("id", detail.id);
      setDetail(null);
      await load();
    } finally {
      setSaving(false);
    }
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
            "After-Contact Notes": e.contact_notes,
            "Resolution Notes": e.resolution_notes,
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
              <th>Follow-up</th>
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
                <td>
                  <button
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() => openDetail(e)}
                    title="Add after-contact / resolution notes"
                  >
                    <MessageSquarePlus size={13} />
                    {e.contact_notes || e.resolution_notes ? "View notes" : "Add notes"}
                  </button>
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
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  No enquiries yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-gray-800">{detail.customer_name} — Follow-up</h2>
              <button onClick={() => setDetail(null)}><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-500">
              Original message: <span className="text-gray-700">{detail.message || "-"}</span>
            </p>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                After-Contact Notes — what happened when you called/messaged this person
              </span>
              <textarea
                className="input w-full"
                rows={3}
                value={contactNotesDraft}
                onChange={(e) => setContactNotesDraft(e.target.value)}
                placeholder="e.g. Called on 3 Sept, interested in EMI plan, will visit store Saturday"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                Resolution Notes — how the query was solved (fill in before marking Closed)
              </span>
              <textarea
                className="input w-full"
                rows={3}
                value={resolutionNotesDraft}
                onChange={(e) => setResolutionNotesDraft(e.target.value)}
                placeholder="e.g. Customer purchased Redmi Note 13 in-store on 5 Sept"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setDetail(null)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={saveNotes} disabled={saving}>
                {saving ? "Saving..." : "Save Notes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
