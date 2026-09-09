import { useEffect, useState } from "react";
import { formatDateTime, formatDate } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Copy, Star, RefreshCw, MessageCircle, Check, AlertTriangle } from "lucide-react";

// A `service_feedback` row is auto-created (see migration 0020's
// repairs_create_feedback_trigger) the moment a repair's status flips to
// "completed" — so every completed repair has a link here the moment it's
// marked done, no manual "generate link" step.
interface FeedbackRow {
  id: string;
  repair_id: string;
  token: string;
  rating: number | null;
  comment: string | null;
  wants_reschedule: boolean;
  requested_date: string | null;
  submitted_at: string | null;
  created_at: string;
}

interface RepairLite {
  id: string;
  customer_name: string;
  phone: string;
  device_brand: string;
  device_model: string;
}

// Where the customer-facing feedback form lives — src/routes/feedback.$token.tsx
// on the public website. The production domain hasn't been purchased yet,
// so there is nothing real to hardcode here. VITE_CUSTOMER_SITE_URL is read
// at build time — set it (e.g. "https://sai-communication.in", no trailing
// slash) once the domain exists, and every feedback link below starts
// working immediately with no further code change. Until then this stays
// unset on purpose: no placeholder/fake domain, ever.
const CUSTOMER_SITE_URL = (import.meta.env.VITE_CUSTOMER_SITE_URL as string | undefined)?.replace(/\/$/, "") || null;

const FEEDBACK_PATH = (token: string) => `/feedback/${token}`;

/** Full shareable URL, or null if VITE_CUSTOMER_SITE_URL isn't configured yet. */
function feedbackUrl(token: string): string | null {
  return CUSTOMER_SITE_URL ? `${CUSTOMER_SITE_URL}${FEEDBACK_PATH(token)}` : null;
}

// There's no SMS/WhatsApp Business API integration configured anywhere in
// this codebase (no Twilio/Gupshup/etc. credentials or calls exist) — so
// "send" here means a wa.me deep link pre-filled with the message and
// feedback link, which opens WhatsApp with everything ready and admin taps
// Send. This is the same pattern already used for the site's other
// WhatsApp buttons (SiteHeader.tsx), not a placeholder. Requires a real
// feedbackUrl (see above) — there's no wa.me link without one.
function waFeedbackLink(repair: RepairLite, link: string) {
  const digits = repair.phone.replace(/\D/g, "");
  const msg =
    `Hi ${repair.customer_name}, your ${repair.device_brand} ${repair.device_model} repair is complete! ` +
    `We'd really appreciate your feedback: ${link}`;
  return `https://wa.me/91${digits}?text=${encodeURIComponent(msg)}`;
}

export function ServiceFeedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [repairs, setRepairs] = useState<Record<string, RepairLite>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("service-feedback-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_feedback" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data: fb } = await supabase.from("service_feedback").select("*").order("created_at", { ascending: false });
    setRows((fb as FeedbackRow[]) ?? []);
    const repairIds = Array.from(new Set((fb ?? []).map((r: any) => r.repair_id)));
    if (repairIds.length > 0) {
      const { data: reps } = await supabase
        .from("repairs")
        .select("id, customer_name, phone, device_brand, device_model")
        .in("id", repairIds);
      const map: Record<string, RepairLite> = {};
      for (const r of (reps as RepairLite[]) ?? []) map[r.id] = r;
      setRepairs(map);
    }
  }

  function copyLink(row: FeedbackRow) {
    // Falls back to just the path (e.g. "/feedback/abc123") when no domain
    // is configured yet — still useful to paste into a browser on the same
    // dev/staging host, and never a fake URL that looks live but isn't.
    const link = feedbackUrl(row.token) ?? FEEDBACK_PATH(row.token);
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopiedId(row.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const pendingReschedule = rows.filter((r) => r.wants_reschedule && r.submitted_at);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Customer Feedback (Post-Service)</h1>
        <ExportExcelButton
          rows={rows.map((r) => ({
            Customer: repairs[r.repair_id]?.customer_name,
            Device: repairs[r.repair_id] ? `${repairs[r.repair_id].device_brand} ${repairs[r.repair_id].device_model}` : "",
            Rating: r.rating,
            Comment: r.comment,
            "Wants Reschedule": r.wants_reschedule ? "Yes" : "No",
            "Requested Date": r.requested_date,
            Submitted: r.submitted_at,
          }))}
          fileName="service-feedback"
        />
      </div>
      <p className="text-sm text-gray-500">
        Created automatically when a repair is marked Completed. Tap <MessageCircle size={12} className="inline" /> to
        open WhatsApp with the feedback link pre-filled and ready to send, or copy the link to share another way.
      </p>

      {!CUSTOMER_SITE_URL && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            No customer website domain is configured yet (<code className="rounded bg-amber-100 px-1 py-0.5 text-xs">VITE_CUSTOMER_SITE_URL</code>{" "}
            is unset), so WhatsApp sending is disabled and "Copy link" only copies the feedback path, not a full
            working link. Once the domain is purchased, set that environment variable and this starts working
            immediately — no code change needed.
          </span>
        </div>
      )}

      {pendingReschedule.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <RefreshCw size={13} className="mr-1 inline" />
          {pendingReschedule.length} customer{pendingReschedule.length > 1 ? "s have" : " has"} requested a reschedule / follow-up repair — see below.
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Device</th>
              <th>Rating</th>
              <th>Comment</th>
              <th>Reschedule</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const repair = repairs[r.repair_id];
              return (
                <tr key={r.id}>
                  <td className="font-medium">
                    {repair?.customer_name ?? "-"}
                    <div className="text-xs font-normal text-gray-400">{repair?.phone}</div>
                  </td>
                  <td>{repair ? `${repair.device_brand} ${repair.device_model}` : "-"}</td>
                  <td>
                    {r.rating ? (
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} size={12} className={i < r.rating! ? "fill-gold text-gold" : "text-gray-200"} />
                        ))}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="max-w-xs truncate" title={r.comment ?? ""}>{r.comment ?? "-"}</td>
                  <td>
                    {r.wants_reschedule ? (
                      <span className="pill-warning text-xs">
                        {r.requested_date ? formatDate(r.requested_date) : "Requested"}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td>
                    <StatusPill
                      status={r.submitted_at ? "active" : "pending"}
                      label={r.submitted_at ? `Submitted ${formatDateTime(r.submitted_at)}` : "Awaiting response"}
                    />
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {repair && (
                        (() => {
                          const link = feedbackUrl(r.token);
                          return link ? (
                            <a
                              href={waFeedbackLink(repair, link)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-secondary !px-2 !py-1 text-xs"
                              title="Send feedback request via WhatsApp"
                            >
                              <MessageCircle size={12} /> WhatsApp
                            </a>
                          ) : (
                            <span
                              className="btn-secondary !px-2 !py-1 text-xs cursor-not-allowed opacity-50"
                              title="Set VITE_CUSTOMER_SITE_URL to enable sending — no domain configured yet"
                            >
                              <MessageCircle size={12} /> WhatsApp
                            </span>
                          );
                        })()
                      )}
                      <button
                        className="btn-ghost !px-2 !py-1 text-xs"
                        onClick={() => copyLink(r)}
                        title={CUSTOMER_SITE_URL ? "Copy the full feedback link" : "No domain configured — copies just the feedback path"}
                      >
                        {copiedId === r.id ? <Check size={12} /> : <Copy size={12} />}
                        {copiedId === r.id ? "Copied!" : CUSTOMER_SITE_URL ? "Copy link" : "Copy path"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  No feedback requests yet — they're created automatically when a repair is marked Completed.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
