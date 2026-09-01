import { useState } from "react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";
import { Star } from "lucide-react";

export function ReviewsPage() {
  const { token } = useStaffAuth();
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!token || !customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("staff_submit_review", {
      p_token: token,
      p_customer_name: customerName.trim(),
      p_phone: phone.trim() || null,
      p_rating: rating,
      p_comment: comment.trim() || null,
    });
    setSubmitting(false);
    if (rpcErr || !data?.success) {
      setError(rpcErr?.message || data?.error || "Failed to submit review.");
      return;
    }
    setDone(true);
    setCustomerName("");
    setPhone("");
    setRating(5);
    setComment("");
    setTimeout(() => setDone(false), 3000);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Customer Review / Feedback</h1>
      <p className="text-xs text-gray-500">
        Record a customer's feedback on their behalf. Submitted reviews are sent to Admin for approval before
        appearing publicly.
      </p>

      {done && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          Review submitted — thank you!
        </div>
      )}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      <div className="card space-y-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Customer Name *</label>
          <input className="input w-full" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Phone (optional)</label>
          <input className="input w-full font-mono" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Rating</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)}>
                <Star size={24} className={n <= rating ? "fill-amber-400 text-amber-400" : "text-gray-300"} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Comment</label>
          <textarea className="input w-full" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <button className="btn-primary w-full py-2.5" disabled={submitting} onClick={submit}>
          {submitting ? "Submitting…" : "Submit Review"}
        </button>
      </div>
    </div>
  );
}
