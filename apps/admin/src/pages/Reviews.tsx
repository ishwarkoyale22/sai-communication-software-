import { useEffect, useState } from "react";
import { formatDateTime, type Review, type ReviewStatus } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Star, Check, X } from "lucide-react";

export function Reviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | ReviewStatus>("all");

  useEffect(() => {
    load();
    const channel = supabase
      .channel("reviews-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "reviews" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
    setReviews(data ?? []);
  }

  async function setStatus(id: string, status: ReviewStatus) {
    await supabase.from("reviews").update({ status }).eq("id", id);
  }

  const filtered = statusFilter === "all" ? reviews : reviews.filter((r) => r.status === statusFilter);
  const pendingCount = reviews.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">
          Reviews {pendingCount > 0 && <span className="pill-danger ml-2">{pendingCount} pending</span>}
        </h1>
        <ExportExcelButton
          rows={filtered.map((r) => ({
            Name: r.customer_name,
            Phone: r.phone,
            Rating: r.rating,
            Comment: r.comment,
            Status: r.status,
            Submitted: r.created_at,
          }))}
          fileName="reviews"
        />
      </div>
      <p className="text-sm text-gray-500">
        Submitted from the public website. Approved reviews show up in the site's Customer Stories section.
      </p>

      <div className="flex gap-2">
        {(["all", "pending", "approved", "rejected"] as const).map((s) => (
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-800">{r.customer_name}</span>
              <StatusPill status={r.status} />
            </div>
            <div className="mt-1 flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} size={14} className={i < r.rating ? "fill-amber-400 text-amber-400" : "text-gray-300"} />
              ))}
            </div>
            {r.comment && <p className="mt-2 text-sm text-gray-600">{r.comment}</p>}
            <p className="mt-2 text-xs text-gray-400">{formatDateTime(r.created_at)}</p>
            {r.status === "pending" && (
              <div className="mt-3 flex gap-2">
                <button className="btn-primary flex-1 !py-1.5 text-xs" onClick={() => setStatus(r.id, "approved")}>
                  <Check size={13} /> Approve
                </button>
                <button className="btn-secondary flex-1 !py-1.5 text-xs" onClick={() => setStatus(r.id, "rejected")}>
                  <X size={13} /> Reject
                </button>
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && <p className="col-span-full py-8 text-center text-gray-400">No reviews found</p>}
      </div>
    </div>
  );
}
