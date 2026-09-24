import { useEffect, useState } from "react";
import { softDelete, formatCurrency } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2, X, Tag, Package } from "lucide-react";

type OfferType = "percentage" | "bogo" | "rupee_off" | "coupon";
type DisplayMode = "image" | "popup" | "hero_banner";
/** Which products an offer covers: nothing specific (store-wide), exactly one, or a chosen set. */
type AppliesTo = "store" | "one" | "many";

interface InventoryOption {
  id: string;
  name: string;
  model: string;
  price: number;
  brand_id: string | null;
  is_active: boolean;
}
interface OfferProductLink {
  id: string;
  offer_id: string;
  inventory_id: string;
}
interface Brand {
  id: string;
  name: string;
  is_active: boolean;
}

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
  applies_to: "store" as AppliesTo,
};

/** Search + brand filter + pick list. `multiple` = tick boxes (many products); otherwise choose exactly one. */
function ProductPicker({
  inventory,
  brands,
  selected,
  multiple,
  onChange,
}: {
  inventory: InventoryOption[];
  brands: Brand[];
  selected: string[];
  multiple: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const shown = inventory.filter(
    (i) =>
      i.is_active &&
      (!brand || i.brand_id === brand) &&
      `${i.name} ${i.model}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const shownIds = shown.map((i) => i.id);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selected.includes(id));

  function toggle(id: string) {
    if (!multiple) return onChange([id]);
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border p-2">
      <div className="flex gap-2">
        <select className="input !w-36 !py-1 text-xs" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <input className="input !py-1 text-xs" placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {multiple && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={() =>
                onChange(
                  allShownSelected
                    ? selected.filter((id) => !shownIds.includes(id))
                    : Array.from(new Set([...selected, ...shownIds]))
                )
              }
            />
            Select all shown ({shown.length})
          </label>
          <span>
            <strong className="text-gray-700">{selected.length}</strong> selected
            {selected.length > 0 && (
              <button type="button" className="ml-2 text-brand-danger" onClick={() => onChange([])}>Clear</button>
            )}
          </span>
        </div>
      )}
      <div className="max-h-44 overflow-y-auto rounded border border-gray-100">
        {shown.map((i) => (
          <label key={i.id} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-accent">
            <input
              type={multiple ? "checkbox" : "radio"}
              name="offer-product"
              checked={selected.includes(i.id)}
              onChange={() => toggle(i.id)}
            />
            <span className="flex-1 truncate">{i.name} {i.model}</span>
            <span className="text-gray-400">{formatCurrency(i.price)}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="p-2 text-xs text-gray-400">No matching products.</p>}
      </div>
    </div>
  );
}

export function Offers() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [pickedProducts, setPickedProducts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);
  const [offerProducts, setOfferProducts] = useState<OfferProductLink[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [managing, setManaging] = useState<Offer | null>(null);
  const [pickBrand, setPickBrand] = useState("");
  const [pickProductId, setPickProductId] = useState("");

  useEffect(() => {
    load();
    const channel = supabase
      .channel("offers-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "offers" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "offer_products" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const [{ data: o }, { data: inv }, { data: op }, { data: br }] = await Promise.all([
      supabase.from("offers").select("*").order("created_at", { ascending: false }),
      supabase.from("inventory").select("id, name, model, price, brand_id, is_active").order("name"),
      supabase.from("offer_products").select("id, offer_id, inventory_id"),
      supabase.from("brands").select("id, name, is_active").order("name"),
    ]);
    setOffers((o as Offer[]) ?? []);
    setInventory((inv as InventoryOption[]) ?? []);
    setOfferProducts((op as OfferProductLink[]) ?? []);
    setBrands((br as Brand[]) ?? []);
  }

  function productsFor(offerId: string) {
    return offerProducts.filter((p) => p.offer_id === offerId);
  }
  function inventoryItem(id: string) {
    return inventory.find((i) => i.id === id);
  }
  function brandName(id: string | null) {
    return brands.find((b) => b.id === id)?.name ?? "-";
  }

  async function addProductToOffer() {
    if (!managing || !pickProductId) return;
    if (productsFor(managing.id).some((p) => p.inventory_id === pickProductId)) return;
    setError(null);
    const { error: insertErr } = await supabase.from("offer_products").insert({ offer_id: managing.id, inventory_id: pickProductId });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setPickProductId("");
    load();
  }

  async function removeProductFromOffer(id: string) {
    await supabase.from("offer_products").delete().eq("id", id);
    load();
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
    if (form.offer_type === "coupon" && !form.discount_value) {
      // Checkout (checkout.tsx) reads this coupon's discount_value as a flat
      // ₹ amount off the order total — a coupon saved without one applies
      // successfully at checkout but grants ₹0 off, silently. See the "Apply"
      // flow's discountAmount calc, which falls back to 0 when this is null.
      setError("Discount amount is required for a Coupon Code offer.");
      return;
    }
    if (form.applies_to === "one" && pickedProducts.length !== 1) {
      setError("Choose the one product this offer applies to.");
      return;
    }
    if (form.applies_to === "many" && pickedProducts.length < 1) {
      setError("Tick at least one product for this offer.");
      return;
    }
    if (form.starts_at && form.ends_at && form.ends_at < form.starts_at) {
      setError("The end date can't be before the start date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: created, error: insertErr } = await supabase.from("offers").insert({
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
      }).select("id").single();
      if (insertErr) throw insertErr;
      if (form.applies_to !== "store" && pickedProducts.length > 0) {
        const { error: linkErr } = await supabase
          .from("offer_products")
          .insert(pickedProducts.map((inventory_id) => ({ offer_id: created.id, inventory_id })));
        if (linkErr) {
          // Don't leave an offer that silently covers nothing: undo it and report why.
          await supabase.from("offers").delete().eq("id", created.id);
          throw linkErr;
        }
      }
      setForm(emptyForm);
      setPickedProducts([]);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
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
          <button
            className="btn-primary"
            onClick={() => {
              setError(null);
              setForm(emptyForm);
              setPickedProducts([]);
              setShowForm(true);
            }}
          >
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
              {o.offer_type === "coupon" && o.discount_value != null && <span>₹{o.discount_value} off</span>}
              <span className="capitalize text-gray-400">{(o.display_mode ?? "hero_banner").replace("_", " ")}</span>
            </div>
            <div className="mt-2 space-y-0.5 text-xs text-gray-500">
              {productsFor(o.id).slice(0, 4).map((p) => {
                const item = inventoryItem(p.inventory_id);
                return <div key={p.id} className="truncate">{item ? `${item.name} ${item.model}` : "Deleted product"}</div>;
              })}
              {productsFor(o.id).length > 4 && <div>+{productsFor(o.id).length - 4} more</div>}
              {productsFor(o.id).length === 0 && <span className="italic text-gray-400">No products linked yet</span>}
            </div>
            <div className="mt-3 flex justify-end gap-1">
              <button
                className="btn-secondary !py-0.5 text-xs"
                onClick={() => {
                  setError(null);
                  setPickBrand("");
                  setPickProductId("");
                  setManaging(o);
                }}
              >
                <Package size={12} /> Manage Products ({productsFor(o.id).length})
              </button>
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
          <div className="card max-h-[92vh] w-full max-w-md space-y-2.5 overflow-y-auto p-5">
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

            {form.offer_type !== "bogo" && (
              <input
                type="number"
                className="input"
                placeholder={
                  form.offer_type === "percentage"
                    ? "Discount % (e.g. 10)"
                    : form.offer_type === "coupon"
                      ? "Coupon discount, ₹ off (e.g. 500) *"
                      : "Rupees off (e.g. 500)"
                }
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

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-gray-600">This offer applies to</div>
              <div className="grid grid-cols-3 gap-1.5 text-xs">
                {([
                  ["store", "Whole store"],
                  ["one", "One product"],
                  ["many", "Multiple products"],
                ] as [AppliesTo, string][]).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setForm({ ...form, applies_to: v });
                      // Switching to "one" keeps at most one earlier pick; switching to store clears them.
                      setPickedProducts((prev) => (v === "store" ? [] : v === "one" ? prev.slice(0, 1) : prev));
                    }}
                    className={`rounded-md border px-2 py-1.5 font-medium ${
                      form.applies_to === v ? "border-brand-primary bg-brand-primary text-white" : "border-border bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {form.applies_to === "store" && (
                <p className="text-[11px] text-gray-400">Not tied to any product. You can still link products later with "Manage Products".</p>
              )}
              {form.applies_to !== "store" && (
                <ProductPicker
                  inventory={inventory}
                  brands={brands}
                  selected={pickedProducts}
                  multiple={form.applies_to === "many"}
                  onChange={setPickedProducts}
                />
              )}
            </div>

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

      {managing && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-gray-800">{managing.title} — Products</h2>
              <button onClick={() => setManaging(null)}><X size={16} /></button>
            </div>

            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}

            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {productsFor(managing.id).map((p) => {
                const item = inventoryItem(p.inventory_id);
                return (
                  <div key={p.id} className="flex items-center justify-between rounded border border-gray-200 p-2 text-sm">
                    <span className="flex-1 truncate">{item ? `${item.name} ${item.model}` : "Deleted product"}</span>
                    <span className="w-24 text-right font-medium">{item ? formatCurrency(item.price) : "-"}</span>
                    <button className="ml-2 text-brand-danger" onClick={() => removeProductFromOffer(p.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
              {productsFor(managing.id).length === 0 && (
                <p className="text-sm text-gray-400">No products added yet — add any number below.</p>
              )}
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex gap-2">
                <select
                  className="input w-40"
                  value={pickBrand}
                  onChange={(e) => {
                    setPickBrand(e.target.value);
                    setPickProductId("");
                  }}
                >
                  <option value="">All brands</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <select className="input flex-1" value={pickProductId} onChange={(e) => setPickProductId(e.target.value)}>
                  <option value="">Select a product to add...</option>
                  {inventory
                    .filter((i) => !productsFor(managing.id).some((p) => p.inventory_id === i.id))
                    .filter((i) => !pickBrand || i.brand_id === pickBrand)
                    .map((i) => (
                      <option key={i.id} value={i.id} disabled={!i.is_active}>
                        {brandName(i.brand_id)} {i.name} {i.model} — {formatCurrency(i.price)}{!i.is_active ? " — inactive" : ""}
                      </option>
                    ))}
                </select>
                <button className="btn-secondary" onClick={addProductToOffer} disabled={!pickProductId}>Add</button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button className="btn-primary" onClick={() => setManaging(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
