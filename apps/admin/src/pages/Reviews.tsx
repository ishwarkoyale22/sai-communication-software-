import { useEffect, useState } from "react";
import { formatDateTime } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Star, Heart } from "lucide-react";

// NOTE: the live `reviews` table (written by the public website's
// ReviewForm) only has customer_name, rating, review_text, source,
// is_featured and created_at — there is no `status`/`phone`/`comment`
// column. This page used to assume a pending/approved/rejected `status`
// field that never existed here, which crashed the whole page (reading
// `.toLowerCase()` off `undefined`). Moderation is modeled the way the
// real schema supports it: a review is either "Pending" (is_featured =
// false, not yet shown on the site) or "Featured" (is_featured = true,
// shows in the site's Customer Stories section) — see ReviewForm.tsx's
// insert comment on the public website.
interface Review {
  id: string;
  customer_name: string;
  rating: number;
  review_text: string | null;
  source: string | null;
  is_featured: boolean;
  created_at: string;
}

type Filter = "all" | "pending" | "featured";

export function Reviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filter, setFilter] = useState<Filter>("all");

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
    setReviews((data as Review[]) ?? []);
  }

  async function toggleFeatured(r: Review) {
    await supabase.from("reviews").update({ is_featured: !r.is_featured }).eq("id", r.id);
    load();
  }

  const filtered =
    filter === "all" ? reviews : reviews.filter((r) => (filter === "featured" ? r.is_featured : !r.is_featured));
  const pendingCount = reviews.filter((r) => !r.is_featured).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">
          Reviews {pendingCount > 0 && <span className="pill-danger ml-2">{pendingCount} pending</span>}
        </h1>
        <ExportExcelButton
          rows={filtered.map((r) => ({
            Name: r.customer_name,
            Rating: r.rating,
            Review: r.review_text,
            Source: r.source,
            Featured: r.is_featured ? "Yes" : "No",
            Submitted: r.created_at,
          }))}
          fileName="reviews"
        />
      </div>
      <p className="text-sm text-gray-500">
        Submitted from the public website. Featured reviews show up in the site's Customer Stories section.
      </p>

      <div className="flex gap-2">
        {(["all", "pending", "featured"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${
              filter === f ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-600"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => (
          <div key={r.id} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-800">{r.customer_name}</span>
              <StatusPill status={r.is_featured ? "active" : "pending"} label={r.is_featured ? "Featured" : "Pending"} />
            </div>
            <div className="mt-1 flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} size={14} className={i < r.rating ? "fill-amber-400 text-amber-400" : "text-gray-300"} />
              ))}
            </div>
            {r.review_text && <p className="mt-2 text-sm text-gray-600">{r.review_text}</p>}
            <p className="mt-2 text-xs text-gray-400">{formatDateTime(r.created_at)}</p>
            <div className="mt-3 flex gap-2">
              <button
                className={`btn-secondary flex-1 !py-1.5 text-xs ${r.is_featured ? "text-brand-danger" : ""}`}
                onClick={() => toggleFeatured(r)}
              >
                <Heart size={13} className={r.is_featured ? "fill-current" : ""} />
                {r.is_featured ? "Unfeature" : "Feature on site"}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="col-span-full py-8 text-center text-gray-400">No reviews found</p>}
      </div>
    </div>
  );
}
