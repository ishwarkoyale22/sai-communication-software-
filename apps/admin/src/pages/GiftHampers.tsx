import { useEffect, useState } from "react";
import { formatCurrency, softDelete } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { Plus, Trash2, X, Package, Tag } from "lucide-react";

interface HamperItem {
  id: string;
  name: string;
  category: string | null;
  price: number;
  image: string | null;
  stock: number;
  is_active: boolean;
  offer_id: string | null;
}

interface InventoryOption {
  id: string;
  name: string;
  model: string;
  price: number;
  brand_id: string | null;
  stock: number;
  is_active: boolean;
}

interface HamperProduct {
  id: string;
  hamper_id: string;
  inventory_id: string;
  quantity: number;
}

interface Brand {
  id: string;
  name: string;
  is_active: boolean;
}

interface OfferOption {
  id: string;
  title: string;
  offer_type: string;
  discount_value: number | null;
  coupon_code: string | null;
  is_active: boolean;
}

const emptyForm = { name: "", category: "", price: 0, stock: 0 };
const MAX_PRODUCTS_PER_HAMPER = 5;

function offerLabel(o: OfferOption) {
  if (o.offer_type === "percentage" && o.discount_value != null) return `${o.title} (${o.discount_value}% off)`;
  if (o.offer_type === "rupee_off" && o.discount_value != null) return `${o.title} (₹${o.discount_value} off)`;
  if (o.offer_type === "coupon" && o.coupon_code) return `${o.title} (code ${o.coupon_code})`;
  return o.title;
}

export function GiftHampers() {
  const [hampers, setHampers] = useState<HamperItem[]>([]);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);
  const [products, setProducts] = useState<HamperProduct[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<HamperItem | null>(null);
  const [pickBrand, setPickBrand] = useState("");
  const [pickId, setPickId] = useState("");
  const [pickQty, setPickQty] = useState(1);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("hamper-items-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "hamper_items" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "hamper_products" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const [{ data: h }, { data: inv }, { data: hp }, { data: br }, { data: off }] = await Promise.all([
      supabase.from("hamper_items").select("*").order("name"),
      // Not filtered to is_active here (unlike before) — the picker needs to
      // show inactive/out-of-stock products too, so it can label them
      // "Unavailable" instead of just silently hiding them.
      supabase.from("inventory").select("id, name, model, price, brand_id, stock, is_active").order("name"),
      supabase.from("hamper_products").select("id, hamper_id, inventory_id, quantity"),
      supabase.from("brands").select("id, name, is_active").order("name"),
      supabase.from("offers").select("id, title, offer_type, discount_value, coupon_code, is_active").eq("is_active", true).order("title"),
    ]);
    setHampers((h as HamperItem[]) ?? []);
    setInventory((inv as InventoryOption[]) ?? []);
    setProducts((hp as HamperProduct[]) ?? []);
    setBrands((br as Brand[]) ?? []);
    setOffers((off as OfferOption[]) ?? []);
  }

  function productsFor(hamperId: string) {
    return products.filter((p) => p.hamper_id === hamperId);
  }
  function inventoryName(id: string) {
    const item = inventory.find((i) => i.id === id);
    return item ? `${item.name} ${item.model}` : "Unknown product";
  }
  function bundleValue(hamperId: string) {
    return productsFor(hamperId).reduce((sum, p) => {
      const item = inventory.find((i) => i.id === p.inventory_id);
      return sum + (item?.price ?? 0) * p.quantity;
    }, 0);
  }
  function brandName(id: string | null) {
    return brands.find((b) => b.id === id)?.name ?? "-";
  }
  function offerFor(hamper: HamperItem) {
    return offers.find((o) => o.id === hamper.offer_id) ?? null;
  }
  function isAvailable(item: InventoryOption) {
    return item.is_active && item.stock > 0;
  }
  async function setHamperOffer(hamper: HamperItem, offerId: string) {
    await supabase.from("hamper_items").update({ offer_id: offerId || null }).eq("id", hamper.id);
    load();
  }

  async function addHamper() {
    if (!form.name.trim()) return;
    setError(null);
    const { error: insertErr } = await supabase.from("hamper_items").insert({
      name: form.name.trim(),
      category: form.category.trim() || null,
      price: Number(form.price) || 0,
      stock: Number(form.stock) || 0,
      is_active: true,
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setForm(emptyForm);
    setShowForm(false);
    load();
  }

  async function toggleActive(h: HamperItem) {
    await supabase.from("hamper_items").update({ is_active: !h.is_active }).eq("id", h.id);
    load();
  }

  async function removeHamper(h: HamperItem) {
    if (!confirm(`Delete "${h.name}"? You can restore it from the Recycle Bin afterwards (its product list will need re-adding).`)) return;
    const { error: delErr } = await softDelete(supabase, "hamper_items", h.id, h.name);
    if (delErr) await supabase.from("hamper_items").update({ is_active: false }).eq("id", h.id);
    load();
  }

  async function addProductToHamper() {
    if (!managing || !pickId) return;
    if (productsFor(managing.id).length >= MAX_PRODUCTS_PER_HAMPER) {
      setError(`A gift hamper can contain at most ${MAX_PRODUCTS_PER_HAMPER} products.`);
      return;
    }
    const item = inventory.find((i) => i.id === pickId);
    if (item && !isAvailable(item)) {
      setError(`${item.name} ${item.model} is currently unavailable (out of stock or inactive) — pick an available product instead.`);
      return;
    }
    setError(null);
    const { error: insertErr } = await supabase
      .from("hamper_products")
      .insert({ hamper_id: managing.id, inventory_id: pickId, quantity: Math.max(1, pickQty) });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setPickId("");
    setPickQty(1);
    load();
  }

  async function removeProductFromHamper(id: string) {
    await supabase.from("hamper_products").delete().eq("id", id);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Gift Hampers</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={hampers.map((h) => ({
              Name: h.name,
              Category: h.category,
              Price: h.price,
              Stock: h.stock,
              Products: productsFor(h.id).map((p) => `${inventoryName(p.inventory_id)} x${p.quantity}`).join("; "),
              "Bundle Value": bundleValue(h.id),
              Offer: offerFor(h) ? offerLabel(offerFor(h)!) : "-",
              Active: h.is_active ? "Yes" : "No",
            }))}
            fileName="gift-hampers"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add Hamper
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Each hamper can bundle up to {MAX_PRODUCTS_PER_HAMPER} existing inventory products with a quantity each —
        click "Manage Products" on a hamper to build it.
      </p>

      <div className="grid grid-cols-3 gap-3">
        {hampers.map((h) => {
          const tile = h.stock <= 0 ? "card-red" : h.stock < 5 ? "card-amber" : "card-gold";
          return (
          <div key={h.id} className={`${tile} p-4 ${!h.is_active ? "opacity-50" : ""}`}>
            <div className="font-medium text-gray-800">{h.name}</div>
            <div className="mt-1 text-sm text-gray-500">{h.category ?? "-"}</div>
            <div className="mt-2 flex items-center justify-between">
              <span className="pill-info">Stock: {h.stock}</span>
              <span className="font-semibold text-brand-primary">{formatCurrency(h.price)}</span>
            </div>
            {offerFor(h) && (
              <div className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-success">
                <Tag size={11} /> {offerLabel(offerFor(h)!)}
              </div>
            )}
            <div className="mt-2 space-y-0.5 text-xs text-gray-500">
              {productsFor(h.id).map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span className="truncate">{inventoryName(p.inventory_id)} ×{p.quantity}</span>
                </div>
              ))}
              {productsFor(h.id).length === 0 && <span className="italic text-gray-400">No products added yet</span>}
              {productsFor(h.id).length > 0 && (
                <div className="flex justify-between border-t border-gray-100 pt-1 font-medium text-gray-600">
                  <span>Bundle value</span>
                  <span>{formatCurrency(bundleValue(h.id))}</span>
                </div>
              )}
            </div>
            <div className="mt-2 flex justify-end gap-1">
              <button
                className="btn-secondary !py-0.5 text-xs"
                onClick={() => {
                  setError(null);
                  setPickBrand("");
                  setPickId("");
                  setManaging(h);
                }}
              >
                <Package size={12} /> Manage Products
              </button>
              <button className="btn-ghost !py-0.5 text-xs" onClick={() => toggleActive(h)}>
                {h.is_active ? "Deactivate" : "Activate"}
              </button>
              <button className="btn-ghost !py-0.5 text-xs text-brand-danger" onClick={() => removeHamper(h)}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          );
        })}
        {hampers.length === 0 && <p className="text-sm text-gray-400">No gift hampers yet.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-96 space-y-2.5 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Add Gift Hamper</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}
            <input className="input" placeholder="Gift Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="input" placeholder="Price" value={form.price || ""} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
              <input type="number" className="input" placeholder="Stock" value={form.stock || ""} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
            </div>
            <p className="text-xs text-gray-400">You can add the products that go inside this hamper after saving it.</p>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={addHamper}>Save</button>
            </div>
          </div>
        </div>
      )}

      {managing && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-gray-800">{managing.name} — Products</h2>
              <button onClick={() => setManaging(null)}><X size={16} /></button>
            </div>

            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}

            <div className="space-y-1.5">
              {productsFor(managing.id).map((p) => {
                const item = inventory.find((i) => i.id === p.inventory_id);
                return (
                  <div key={p.id} className="flex items-center justify-between rounded border border-gray-200 p-2 text-sm">
                    <span className="flex-1 truncate">{inventoryName(p.inventory_id)}</span>
                    <span className="w-16 text-right text-gray-500">×{p.quantity}</span>
                    <span className="w-24 text-right font-medium">{formatCurrency((item?.price ?? 0) * p.quantity)}</span>
                    <button className="ml-2 text-brand-danger" onClick={() => removeProductFromHamper(p.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
              {productsFor(managing.id).length === 0 && (
                <p className="text-sm text-gray-400">No products added yet.</p>
              )}
            </div>

            {productsFor(managing.id).length < MAX_PRODUCTS_PER_HAMPER ? (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex gap-2">
                  <select
                    className="input w-40"
                    value={pickBrand}
                    onChange={(e) => {
                      setPickBrand(e.target.value);
                      setPickId("");
                    }}
                  >
                    <option value="">All brands</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <select className="input flex-1" value={pickId} onChange={(e) => setPickId(e.target.value)}>
                    <option value="">Select a product to add...</option>
                    {inventory
                      .filter((i) => !productsFor(managing.id).some((p) => p.inventory_id === i.id))
                      .filter((i) => !pickBrand || i.brand_id === pickBrand)
                      .map((i) => (
                        <option key={i.id} value={i.id} disabled={!isAvailable(i)}>
                          {brandName(i.brand_id)} {i.name} {i.model} — {formatCurrency(i.price)}
                          {isAvailable(i) ? ` — ${i.stock} in stock` : " — Unavailable"}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    className="input !w-16"
                    value={pickQty}
                    onChange={(e) => setPickQty(Math.max(1, Number(e.target.value)))}
                  />
                  <button className="btn-secondary flex-1" onClick={addProductToHamper} disabled={!pickId}>Add</button>
                </div>
              </div>
            ) : (
              <p className="border-t border-border pt-3 text-xs text-amber-600">
                Maximum of {MAX_PRODUCTS_PER_HAMPER} products reached for this hamper.
              </p>
            )}

            <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
              <span className="text-gray-500">Bundle value (sum of product prices)</span>
              <span className="font-semibold text-brand-primary">{formatCurrency(bundleValue(managing.id))}</span>
            </div>

            <div className="border-t border-border pt-2">
              <span className="mb-1 block text-xs font-medium text-gray-600">Offer attached to this hamper</span>
              <select
                className="input w-full"
                value={managing.offer_id ?? ""}
                onChange={(e) => {
                  setHamperOffer(managing, e.target.value);
                  setManaging({ ...managing, offer_id: e.target.value || null });
                }}
              >
                <option value="">No offer</option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>{offerLabel(o)}</option>
                ))}
              </select>
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
