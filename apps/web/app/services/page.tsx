"use client";

import { useEffect, useState } from "react";
import { Wrench, CreditCard, Gift, Sparkles, ShieldCheck, Star } from "lucide-react";
import type { Service } from "@sai/shared";
import { supabase } from "../../lib/supabase";

// Static fallback — used until the `services` table (migration 0010) has
// been run, or if it comes back empty, so the page never regresses visually.
const FALLBACK_SERVICES = [
  {
    icon: Wrench,
    name: "Repairs",
    description:
      "In-house repair for mobiles, TVs, ACs & laptops. Bring in your device for a free estimate — we'll keep you posted at every stage.",
  },
  {
    icon: CreditCard,
    name: "EMI Options",
    description:
      "Buy now, pay monthly with our finance partners — Bajaj Finance, Home Credit, IDFC First Bank and more, available at checkout in-store.",
  },
  {
    icon: Gift,
    name: "Gift Hampers",
    description:
      "Curated electronics gift hampers for festivals and special occasions — mix and match products or pick a ready-made bundle.",
  },
];

const ICON_POOL = [Wrench, CreditCard, Gift, Sparkles, ShieldCheck, Star];

export default function ServicesPage() {
  const [services, setServices] = useState<(Service & { icon?: typeof Wrench })[] | null>(null);

  useEffect(() => {
    supabase
      .from("services")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setServices(data && data.length ? data : null));
  }, []);

  const items =
    services ??
    FALLBACK_SERVICES.map((s) => ({ id: s.name, name: s.name, description: s.description, icon: s.icon }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <div className="mb-10 text-center">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">
          Our <em>Services</em>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          Beyond selling devices — we repair, finance, and gift-wrap electronics for every need.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        {items.map((s, i) => {
          const Icon = s.icon ?? ICON_POOL[i % ICON_POOL.length];
          return (
            <div key={s.id ?? s.name} className="card-surface hover-glow flex flex-col items-center p-6 text-center">
              <div className="medallion-ring-sm">
                <Icon size={20} />
              </div>
              <h2 className="mt-4 font-display font-medium text-foreground">{s.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>
            </div>
          );
        })}
      </div>
    </main>
  );
}
