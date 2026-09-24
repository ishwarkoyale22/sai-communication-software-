import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import { supabase } from "../lib/supabase";

interface Offer {
  id: string;
  title: string;
  description: string | null;
  offer_type: string | null;
  discount_value: number | null;
  coupon_code: string | null;
  is_active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  offer_products?: { inventory: { name: string; model: string | null } | null }[];
}

// `offers` already has a public SELECT policy (used by the website hero
// banner/pop-ups) — no staff RPC needed.
export function OffersView() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("offers")
      .select("id, title, description, offer_type, discount_value, coupon_code, is_active, starts_at, ends_at, offer_products(inventory(name, model))")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        // Only offers running right now (not scheduled for later, not ended).
        const now = Date.now();
        const live = ((data as unknown as Offer[]) ?? []).filter(
          (o) => (!o.starts_at || new Date(o.starts_at).getTime() <= now) && (!o.ends_at || new Date(o.ends_at).getTime() >= now)
        );
        setOffers(live);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Offers</h1>
      {loading ? (
        <div className="text-center text-sm text-gray-400">Loading…</div>
      ) : offers.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">No live offers right now.</div>
      ) : (
        <div className="space-y-2">
          {offers.map((o) => (
            <div key={o.id} className="card space-y-1 p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                <Tag size={14} className="text-brand-primary" /> {o.title}
              </div>
              {o.description && <div className="text-xs text-gray-500">{o.description}</div>}
              <div className="text-xs text-gray-500">
                {o.offer_products && o.offer_products.length > 0
                  ? `Applies to: ${o.offer_products.map((p) => [p.inventory?.name, p.inventory?.model].filter(Boolean).join(" ")).join(", ")}`
                  : "Applies to: whole store"}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {o.offer_type === "percentage" && o.discount_value != null && <span className="pill-info">{o.discount_value}% off</span>}
                {o.offer_type === "rupee_off" && o.discount_value != null && <span className="pill-info">₹{o.discount_value} off</span>}
                {o.offer_type === "bogo" && <span className="pill-info">Buy 1 Get 1</span>}
                {o.coupon_code && <span className="font-mono font-semibold text-brand-primary">{o.coupon_code}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
