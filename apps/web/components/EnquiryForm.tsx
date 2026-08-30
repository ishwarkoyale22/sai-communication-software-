"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export function EnquiryForm({ productInterest }: { productInterest?: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from("enquiries").insert({
      name,
      phone,
      email: email || null,
      message: message || null,
      product_interest: productInterest ?? null,
    });
    setSubmitting(false);
    if (error) {
      setError("Something went wrong. Please call us instead.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="card-surface p-6 text-center">
        <p className="font-display text-lg font-medium text-success-fg">Thank you!</p>
        <p className="mt-1 text-sm text-muted-foreground">We&apos;ll contact you within 24 hours.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card-surface space-y-3 p-5">
      {productInterest && (
        <p className="text-sm text-muted-foreground">
          Enquiring about: <span className="font-medium text-foreground">{productInterest}</span>
        </p>
      )}
      <input className="input" placeholder="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="Phone number" required value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className="input" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
      <textarea className="input" placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button className="btn-primary w-full" disabled={submitting}>
        {submitting ? "Sending..." : "Enquire / Visit Store"}
      </button>
    </form>
  );
}
