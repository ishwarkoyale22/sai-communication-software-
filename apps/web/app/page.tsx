"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star, Sparkles, Gift, CreditCard, ShieldCheck, Wrench, Truck } from "lucide-react";
import type { Product, Review } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { Reveal } from "../components/Reveal";
import { ProductCard } from "../components/ProductCard";
import { EnquiryForm } from "../components/EnquiryForm";
import { ReviewForm } from "../components/ReviewForm";

const PILLARS = [
  { icon: Wrench, title: "Phone Repair", body: "Screen, battery & water-damage repairs with a free estimate." },
  { icon: Sparkles, title: "Refurbished", body: "Certified pre-owned devices, tested and graded before sale." },
  { icon: Gift, title: "Gift Hampers", body: "Curated electronics hampers for every festival & occasion." },
  { icon: CreditCard, title: "Easy EMI", body: "No-cost EMI with Bajaj Finance, Home Credit & more." },
];

const WHY_US = [
  { icon: ShieldCheck, title: "Certified Quality", body: "Every device checked before it reaches you." },
  { icon: CreditCard, title: "Easy EMI", body: "Flexible monthly plans, approved in minutes." },
  { icon: Wrench, title: "Free Estimates", body: "No-obligation repair quotes, always." },
  { icon: Truck, title: "Local & Trusted", body: "Serving the neighbourhood since day one." },
];

export default function HomePage() {
  const [featured, setFeatured] = useState<Product[]>([]);
  const [enquireFor, setEnquireFor] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showReviewForm, setShowReviewForm] = useState(false);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("home-featured")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("category", "Mobiles")
      .gt("stock_qty", 0)
      .eq("is_active", true)
      .order("sale_price", { ascending: false })
      .limit(4);
    setFeatured(data ?? []);

    const { data: r } = await supabase
      .from("reviews")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(6);
    setReviews(r ?? []);
  }

  return (
    <main>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="hero-band border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <div className="medallion-ring mx-auto">
            <span className="h-1 w-1 rounded-full bg-gold" />
            <span className="caption-mono !text-gold">Est. 2005</span>
            <span className="h-1 w-1 rounded-full bg-gold" />
          </div>

          <h1 className="mt-6 font-display text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
            Your neighbourhood <em>electronics</em> boutique
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Mobiles, TVs, ACs, laptops, accessories &amp; gift hampers — with easy EMI and
            in-house repairs. Browse what&apos;s in stock right now, live.
          </p>

          <div className="mx-auto mt-6 flex max-w-md flex-wrap justify-center gap-3">
            <div className="card-surface flex items-center gap-2 px-4 py-2 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Wrench size={13} />
              </span>
              Same-day repairs
            </div>
            <div className="card-surface flex items-center gap-2 px-4 py-2 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CreditCard size={13} />
              </span>
              Easy EMI
            </div>
          </div>

          <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3">
            <Link href="/catalog" className="btn-primary w-full">
              Browse Catalog
            </Link>
            <Link href="/contact" className="btn-outline w-full">
              Visit Our Store
            </Link>
            <Link href="/services" className="btn-gold w-full">
              Book a Repair
            </Link>
          </div>

          <div className="stat-strip mx-auto mt-10 w-fit text-sm">
            <div className="flex items-center gap-1 text-foreground">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} size={13} className="fill-gold text-gold" />
              ))}
              <span className="ml-1 font-medium">4.8</span>
            </div>
            <div className="text-muted-foreground">
              <span className="font-display font-semibold text-foreground">19+ Yrs</span> in business
            </div>
            <div className="text-muted-foreground">
              <span className="font-display font-semibold text-foreground">10,000+</span> customers served
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- Quick Pillars */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 60}>
              <div className="card-surface hover-glow flex h-full flex-col items-center p-6 text-center">
                <div className="medallion-ring-sm">
                  <p.icon size={20} />
                </div>
                <h3 className="mt-4 font-display text-base font-medium">{p.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ Featured Products */}
      <section className="border-y border-border bg-secondary/40 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <div className="mb-8 flex items-end justify-between">
              <div>
                <div className="caption-mono">Handpicked</div>
                <h2 className="mt-1 font-display text-2xl font-medium sm:text-3xl">
                  Featured <em>Smartphones</em>
                </h2>
              </div>
              <Link href="/catalog" className="btn-link hidden sm:inline-flex">
                View all products →
              </Link>
            </div>
          </Reveal>

          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {featured.map((p, i) => (
              <Reveal key={p.id} delay={i * 60}>
                <ProductCard product={p} onEnquire={setEnquireFor} />
              </Reveal>
            ))}
          </div>
          {featured.length === 0 && (
            <p className="py-10 text-center text-muted-foreground">
              New stock arriving soon — check back shortly.
            </p>
          )}

          <div className="mt-8 text-center sm:hidden">
            <Link href="/catalog" className="btn-link">
              View all products →
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- Why Choose Us */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <Reveal>
          <div className="mb-8 text-center">
            <div className="caption-mono">The Difference</div>
            <h2 className="mt-1 font-display text-2xl font-medium sm:text-3xl">
              Why Choose <em>Us</em>
            </h2>
          </div>
        </Reveal>

        <Reveal>
          <div className="hairline-band">
            {WHY_US.map((w) => (
              <div key={w.title} className="flex flex-col items-center p-6 text-center">
                <div className="medallion-ring-sm">
                  <w.icon size={20} />
                </div>
                <h3 className="mt-3 font-display text-sm font-medium">{w.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{w.body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ------------------------------------------------------ Customer Stories */}
      <section className="border-t border-border bg-secondary/40 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <div className="mb-8 flex items-end justify-between">
              <div>
                <div className="caption-mono">In Their Words</div>
                <h2 className="mt-1 font-display text-2xl font-medium sm:text-3xl">
                  Customer <em>Stories</em>
                </h2>
              </div>
              <button className="btn-outline hidden sm:inline-flex" onClick={() => setShowReviewForm(true)}>
                Leave a Review
              </button>
            </div>
          </Reveal>

          {reviews.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {reviews.map((r, i) => (
                <Reveal key={r.id} delay={i * 60}>
                  <div className="card-surface p-5">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <Star key={j} size={14} className={j < r.rating ? "fill-gold text-gold" : "text-border"} />
                      ))}
                    </div>
                    {r.comment && <p className="mt-3 font-display italic text-foreground">&ldquo;{r.comment}&rdquo;</p>}
                    <hr className="my-3 border-gold/30" />
                    <p className="caption-mono">{r.customer_name}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-muted-foreground">
              Be the first to share your experience with us.
            </p>
          )}

          <div className="mt-8 text-center sm:hidden">
            <button className="btn-outline" onClick={() => setShowReviewForm(true)}>
              Leave a Review
            </button>
          </div>
        </div>
      </section>

      {enquireFor && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
          onClick={() => setEnquireFor(null)}
        >
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <EnquiryForm productInterest={enquireFor.name} />
          </div>
        </div>
      )}

      {showReviewForm && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
          onClick={() => setShowReviewForm(false)}
        >
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <ReviewForm />
          </div>
        </div>
      )}
    </main>
  );
}
