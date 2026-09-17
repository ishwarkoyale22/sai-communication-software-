import { useEffect, useState } from "react";
import { softDelete } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2, X, Tag } from "lucide-react";

type OfferType = "percentage" | "bogo" | "rupee_off" | "coupon";
type DisplayMode = "image" | "popup" | "hero_banner";

interface Offer {
  id: string;
  title: string;
  description: string | null;
  offer_type: OfferType | null;
  discount_value: number | null;
  coupon_code: string | null;
  image_url: string | null;
  display_mode: DisplayMode | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

const OFFER_TYPE_LABEL: Record<OfferType, string> = {
  percentage: "Percentage Off",
  bogo: "Buy 1 Get 1",
  rupee_off: "Rupee Off",
  coupon: "Coupon Code",
};

const OFFER_TYPE_TILE: Record<OfferType, string> = {
  percentage: "card-gold",
  bogo: "card-purple",
  rupee_off: "card-green",
  coupon: "card-blue",
};

const emptyForm = {
  title: "",
  description: "",
  offer_type: "percentage" as OfferType,
  discount_value: 0,
  coupon_code: "",
  image_url: "",
  display_mode: "hero_banner" as DisplayMode,
  starts_at: "",
  ends_at: "",
};

export function Offers() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("offers-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "offers" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("offers").select("*").order("created_at", { ascending: false });
    setOffers((data as Offer[]) ?? []);
  }

  function isLive(o: Offer) {
    const now = new Date().toISOString();
    if (o.starts_at && o.starts_at > now) return false;
    if (o.ends_at && o.ends_at < now) return false;
    return o.is_active;
  }

  async function addOffer() {
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (form.offer_type === "coupon" && !form.coupon_code.trim()) {
      setError("Coupon code is required for a Coupon Code offer.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: insertErr } = await supabase.from("offers").insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        offer_type: form.offer_type,
        discount_value: form.offer_type === "bogo" ? null : Number(form.discount_value) || null,
        coupon_code: form.offer_type === "coupon" ? form.coupon_code.trim().toUpperCase() : null,
        image_url: form.image_url.trim() || null,
        display_mode: form.display_mode,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
        is_active: true,
      });
      if (insertErr) throw insertErr;
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to save offer.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(o: Offer) {
    await supabase.from("offers").update({ is_active: !o.is_active }).eq("id", o.id);
    load();
  }

  async function removeOffer(o: Offer) {
    if (!confirm(`Delete offer "${o.title}"? You can restore it from the Recycle Bin afterwards.`)) return;
    await softDelete(supabase, "offers", o.id, o.title);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Offer Management</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={offers.map((o) => ({
              Title: o.title,
              Type: o.offer_type ? OFFER_TYPE_LABEL[o.offer_type] : "-",
              Value: o.discount_value,
              Code: o.coupon_code,
              "Display Mode": o.display_mode,
              Active: o.is_active ? "Yes" : "No",
              Starts: o.starts_at,
              Ends: o.ends_at,
            }))}
            fileName="offers"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add Offer
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500">
        Offers marked "Live" show on the website's hero banner, as a pop-up, or as an image, depending on Display
        Mode.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {offers.map((o) => (
          <div
            key={o.id}
            className={`${o.offer_type ? OFFER_TYPE_TILE[o.offer_type] : "card"} p-4 ${!o.is_active ? "opacity-50" : ""}`}
          >
            <div className="flex items-start justify-between">
              <div className="font-medium text-gray-800">{o.title}</div>
              <StatusPill status={isLive(o) ? "active" : "neutral"} label={isLive(o) ? "Live" : "Not live"} />
            </div>
            {o.description && <p className="mt-1 text-sm text-gray-500">{o.description}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="pill-info">
                <Tag size={11} className="mr-1 inline" />
                {o.offer_type ? OFFER_TYPE_LABEL[o.offer_type] : "-"}
              </span>
              {o.offer_type === "percentage" && o.discount_value != null && <span>{o.discount_value}% off</span>}
              {o.offer_type === "rupee_off" && o.discount_value != null && <span>₹{o.discount_value} off</span>}
              {o.offer_type === "coupon" && o.coupon_code && (
                <span className="font-mono font-semibold text-brand-primary">{o.coupon_code}</span>
              )}
              <span className="capitalize text-gray-400">{(o.display_mode ?? "hero_banner").replace("_", " ")}</span>
            </div>
            <div className="mt-3 flex justify-end gap-1">
              <button className="btn-ghost !py-0.5 text-xs" onClick={() => toggleActive(o)}>
                {o.is_active ? "Deactivate" : "Activate"}
              </button>
              <button className="btn-ghost !py-0.5 text-xs text-brand-danger" onClick={() => removeOffer(o)}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {offers.length === 0 && <p className="text-sm text-gray-400">No offers yet — add one above.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
          <div className="card w-full max-w-md space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Add Offer</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}

            <input className="input" placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <textarea className="input" placeholder="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

            <select className="input" value={form.offer_type} onChange={(e) => setForm({ ...form, offer_type: e.target.value as OfferType })}>
              {(Object.entries(OFFER_TYPE_LABEL) as [OfferType, string][]).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>

            {form.offer_type !== "bogo" && form.offer_type !== "coupon" && (
              <input
                type="number"
                className="input"
                placeholder={form.offer_type === "percentage" ? "Discount % (e.g. 10)" : "Rupees off (e.g. 500)"}
                value={form.discount_value || ""}
                onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
              />
            )}
            {form.offer_type === "coupon" && (
              <input
                className="input"
                placeholder="Coupon code (e.g. FESTIVE10)"
                value={form.coupon_code}
                onChange={(e) => setForm({ ...form, coupon_code: e.target.value })}
              />
            )}

            <input className="input" placeholder="Offer image URL (optional)" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />

            <select className="input" value={form.display_mode} onChange={(e) => setForm({ ...form, display_mode: e.target.value as DisplayMode })}>
              <option value="hero_banner">Hero Banner (free on hero section)</option>
              <option value="popup">Pop-up</option>
              <option value="image">Image</option>
            </select>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-gray-500">
                Starts
                <input type="date" className="input mt-0.5" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
              </label>
              <label className="block text-xs text-gray-500">
                Ends
                <input type="date" className="input mt-0.5" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={addOffer} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
