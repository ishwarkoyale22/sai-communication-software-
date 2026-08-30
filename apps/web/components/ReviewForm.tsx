"use client";

import { useState, type FormEvent } from "react";
import { Star } from "lucide-react";
import { supabase } from "../lib/supabase";

export function ReviewForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from("reviews").insert({
      customer_name: name,
      phone: phone || null,
      rating,
      comment: comment || null,
    });
    setSubmitting(false);
    if (error) {
      setError("Something went wrong. Please try again.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="card-surface p-6 text-center">
        <p className="font-display text-lg font-medium text-success-fg">Thank you for your feedback!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your review will appear on the site once approved.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card-surface space-y-3 p-5">
      <input className="input" placeholder="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />

      <div>
        <div className="mb-1 text-sm text-muted-foreground">Your rating</div>
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <button key={i} type="button" onClick={() => setRating(i + 1)}>
              <Star size={22} className={i < rating ? "fill-gold text-gold" : "text-border"} />
            </button>
          ))}
        </div>
      </div>

      <textarea className="input" placeholder="Tell us about your experience" value={comment} onChange={(e) => setComment(e.target.value)} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button className="btn-primary w-full" disabled={submitting}>
        {submitting ? "Submitting..." : "Submit Review"}
      </button>
    </form>
  );
}
