import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency, softDelete } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { uploadProductImage } from "../lib/uploadImage";
import { hamperStats, inventoryLabel, type ComponentInventory, type HamperRow, type HamperComponentRow } from "../lib/hampers";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { Plus, Trash2, X, Tag, Pencil, ImagePlus, Loader2, AlertTriangle, Gift } from "lucide-react";

interface InventoryOption extends ComponentInventory {
  brand_id: string | null;
  price: number;
}

interface OfferOption {
  id: string;
  title: string;
  offer_type: string;
  discount_value: number | null;
  coupon_code: string | null;
  is_active: boolean;
}

interface HamperSaleRow {
  hamper_id: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
}

/** One editable component line inside the editor modal. */
interface DraftComponent {
  inventory_id: string;
  quantity: number;
}

interface Draft {
  id: string | null;
  name: string;
  category: string;
  image: string | null;
  price: string;
  packaging_cost: string;
  offer_id: string;
  components: DraftComponent[];
}

const emptyDraft: Draft = { id: null, name: "", category: "", image: null, price: "", packaging_cost: "", offer_id: "", components: [] };

function offerLabel(o: OfferOption) {
  if (o.offer_type === "percentage" && o.discount_value != null) return `${o.title} (${o.discount_value}% off)`;
  if (o.offer_type === "rupee_off" && o.discount_value != null) return `${o.title} (₹${o.discount_value} off)`;
  if (o.offer_type === "coupon" && o.coupon_code) return `${o.title} (code ${o.coupon_code})`;
  return o.title;
}

export function GiftHampers() {
  const [hampers, setHampers] = useState<HamperRow[]>([]);
  const [components, setComponents] = useState<HamperComponentRow[]>([]);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [hamperSales, setHamperSales] = useState<HamperSaleRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pickQty, setPickQty] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("hamper-items-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "hamper_items" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "hamper_products" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "hamper_sales" }, load)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "inventory" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const [{ data: h }, { data: hp }, { data: inv }, { data: off }, { data: hs }] = await Promise.all([
      supabase.from("hamper_items").select("id, name, category, price, image, is_active, offer_id, packaging_cost").order("name"),
      supabase.from("hamper_products").select("id, hamper_id, inventory_id, quantity"),
      // Only plain stock can go inside a hamper — IMEI/serial phones can't be
      // counted down by quantity.
      supabase
        .from("inventory")
        .select("id, name, model, price, brand_id, stock, cost_price, is_active, is_serialized")
        .eq("is_serialized", false)
        .order("name"),
      supabase.from("offers").select("id, title, offer_type, discount_value, coupon_code, is_active").eq("is_active", true).order("title"),
      supabase.from("hamper_sales").select("hamper_id, quantity, unit_price, unit_cost"),
    ]);
    setHampers((h as HamperRow[]) ?? []);
    setComponents((hp as HamperComponentRow[]) ?? []);
    setInventory((inv as InventoryOption[]) ?? []);
    setOffers((off as OfferOption[]) ?? []);
    setHamperSales((hs as HamperSaleRow[]) ?? []);
  }

  const inventoryById = useMemo(() => new Map<string, ComponentInventory>(inventory.map((i) => [i.id, i])), [inventory]);
  const categories = useMemo(
    () => Array.from(new Set(hampers.map((h) => h.category).filter((c): c is string => !!c))).sort(),
    [hampers]
  );

  function componentsFor(hamperId: string) {
    return components.filter((c) => c.hamper_id === hamperId);
  }
  function soldFor(hamperId: string) {
    return hamperSales.filter((s) => s.hamper_id === hamperId).reduce(
      (acc, s) => ({ qty: acc.qty + s.quantity, profit: acc.profit + (s.unit_price - s.unit_cost) * s.quantity }),
      { qty: 0, profit: 0 }
    );
  }
  function offerFor(h: HamperRow) {
    return offers.find((o) => o.id === h.offer_id) ?? null;
  }

  // ---- editor ----------------------------------------------------------------
  function openNew() {
    setError(null);
    setSearch("");
    setPickQty(1);
    setDraft({ ...emptyDraft });
  }

  function openEdit(h: HamperRow) {
    setError(null);
    setSearch("");
    setPickQty(1);
    setDraft({
      id: h.id,
      name: h.name,
      category: h.category ?? "",
      image: h.image,
      price: String(h.price ?? ""),
      packaging_cost: h.packaging_cost ? String(h.packaging_cost) : "",
      offer_id: h.offer_id ?? "",
      components: componentsFor(h.id).map((c) => ({ inventory_id: c.inventory_id, quantity: c.quantity })),
    });
  }

  const draftStats = useMemo(() => {
    if (!draft) return null;
    return hamperStats(
      { price: Number(draft.price) || 0, packaging_cost: Number(draft.packaging_cost) || 0 },
      draft.components,
      inventoryById
    );
  }, [draft, inventoryById]);

  const pickerMatches = useMemo(() => {
    if (!draft) return [];
    const taken = new Set(draft.components.map((c) => c.inventory_id));
    const q = search.trim().toLowerCase();
    return inventory
      .filter((i) => i.is_active !== false && !taken.has(i.id))
      .filter((i) => !q || inventoryLabel(i).toLowerCase().includes(q))
      .slice(0, 40);
  }, [draft, inventory, search]);

  function addComponent(inv: InventoryOption) {
    if (!draft) return;
    setDraft({ ...draft, components: [...draft.components, { inventory_id: inv.id, quantity: Math.max(1, pickQty) }] });
    setSearch("");
    setPickQty(1);
    setSearchOpen(false);
  }

  function setComponentQty(inventoryId: string, qty: number) {
    if (!draft) return;
    setDraft({
      ...draft,
      components: draft.components.map((c) => (c.inventory_id === inventoryId ? { ...c, quantity: Math.max(1, Math.floor(qty) || 1) } : c)),
    });
  }

  function removeComponent(inventoryId: string) {
    if (!draft) return;
    setDraft({ ...draft, components: draft.components.filter((c) => c.inventory_id !== inventoryId) });
  }

  async function handleImage(file: File | undefined) {
    if (!file || !draft) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadProductImage(file);
      setDraft((d) => (d ? { ...d, image: url } : d));
    } catch (e: any) {
      setError(e?.message || "Image upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveDraft() {
    if (!draft) return;
    const price = Number(draft.price);
    if (!draft.name.trim()) return setError("Hamper name is required.");
    if (!(price > 0)) return setError("Enter a selling price greater than 0.");
    if (Number(draft.packaging_cost) < 0) return setError("Packaging cost cannot be negative.");
    if (draft.components.length === 0) return setError("Add at least one product to the hamper.");

    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        category: draft.category.trim() || null,
        image: draft.image,
        price,
        packaging_cost: Number(draft.packaging_cost) || 0,
        offer_id: draft.offer_id || null,
      };

      let hamperId = draft.id;
      if (hamperId) {
        const { error: upErr } = await supabase.from("hamper_items").update(payload).eq("id", hamperId);
        if (upErr) throw upErr;
      } else {
        // `stock` is intentionally not sent — the database derives it from the components.
        const { data: created, error: insErr } = await supabase
          .from("hamper_items")
          .insert({ ...payload, is_active: true })
          .select("id")
          .single();
        if (insErr) throw insErr;
        hamperId = created.id as string;
      }

      // Sync components: drop the removed ones, upsert the rest.
      const keep = draft.components.map((c) => c.inventory_id);
      const existing = componentsFor(hamperId).filter((c) => !keep.includes(c.inventory_id));
      if (existing.length > 0) {
        const { error: delErr } = await supabase.from("hamper_products").delete().in("id", existing.map((c) => c.id));
        if (delErr) throw delErr;
      }
      const { error: compErr } = await supabase
        .from("hamper_products")
        .upsert(
          draft.components.map((c) => ({ hamper_id: hamperId, inventory_id: c.inventory_id, quantity: c.quantity })),
          { onConflict: "hamper_id,inventory_id" }
        );
      if (compErr) throw compErr;

      setDraft(null);
      load();
    } catch (e: any) {
      setError(e?.message || "Failed to save hamper.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(h: HamperRow) {
    await supabase.from("hamper_items").update({ is_active: !h.is_active }).eq("id", h.id);
    load();
  }

  async function removeHamper(h: HamperRow) {
    if (
      !confirm(
        `Delete "${h.name}"? Past sales of it stay in Sales History. You can restore the hamper from the Recycle Bin, but its product list will need re-adding.`
      )
    )
      return;
    const { error: delErr } = await softDelete(supabase, "hamper_items", h.id, h.name);
    if (delErr) await supabase.from("hamper_items").update({ is_active: false }).eq("id", h.id);
    load();
  }

  const limitingStat = draftStats?.limitingName && draftStats.componentCount > 0 ? draftStats : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Gift Hampers</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={hampers.map((h) => {
              const s = hamperStats(h, componentsFor(h.id), inventoryById);
              const sold = soldFor(h.id);
              return {
                Name: h.name,
                Category: h.category,
                "Selling Price": h.price,
                "Product Cost": s.productCost,
                "Packaging Cost": h.packaging_cost,
                "Total Cost": s.totalCost,
                Profit: s.profit,
                "Available Hampers": s.available,
                Sold: sold.qty,
                "Profit Earned": sold.profit,
                Components: componentsFor(h.id)
                  .map((c) => `${inventoryById.get(c.inventory_id) ? inventoryLabel(inventoryById.get(c.inventory_id)!) : "Unknown"} x${c.quantity}`)
                  .join("; "),
                Offer: offerFor(h) ? offerLabel(offerFor(h)!) : "-",
                Active: h.is_active ? "Yes" : "No",
              };
            })}
            fileName="gift-hampers"
          />
          <button className="btn-primary" onClick={openNew}>
            <Plus size={14} /> Add Hamper
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-500">
        A hamper is a bundle of products already in your Inventory (e.g. Gift Box ×1 + Charger ×1 + Earphones ×1 + Cover ×1). It has no stock of its own:
        the number you can sell is worked out from the stock of its products, and selling a hamper deducts every product from Inventory automatically.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {hampers.map((h) => {
          const comps = componentsFor(h.id);
          const s = hamperStats(h, comps, inventoryById);
          const sold = soldFor(h.id);
          const tile = s.available <= 0 ? "card-red" : s.available < 5 ? "card-amber" : "card-gold";
          return (
            <div key={h.id} className={`${tile} flex flex-col p-4 ${!h.is_active ? "opacity-50" : ""}`}>
              <div className="flex gap-3">
                {h.image ? (
                  <img src={h.image} alt={h.name} className="h-16 w-16 shrink-0 rounded-md border border-border object-cover" />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-gray-300">
                    <Gift size={22} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-gray-800">{h.name}</div>
                  <div className="text-xs text-gray-500">{h.category ?? "-"}</div>
                  <div className="mt-1 font-semibold text-brand-primary">{formatCurrency(h.price)}</div>
                </div>
                <span className={s.available <= 0 ? "pill-danger self-start" : "pill-info self-start"} title={s.limitingName ? `Limited by ${s.limitingName}` : undefined}>
                  {s.available} available
                </span>
              </div>

              <div className="mt-3 space-y-0.5 text-xs">
                {comps.map((c) => {
                  const inv = inventoryById.get(c.inventory_id);
                  const canMake = inv ? Math.floor(Math.max(inv.stock ?? 0, 0) / c.quantity) : 0;
                  return (
                    <div key={c.id} className="flex justify-between gap-2 text-gray-600">
                      <span className="truncate">
                        {inv ? inventoryLabel(inv) : "Unknown product"} ×{c.quantity}
                      </span>
                      <span className={canMake === s.available && s.available < 5 ? "font-medium text-brand-danger" : "text-gray-400"}>
                        {inv?.stock ?? 0} in stock
                      </span>
                    </div>
                  );
                })}
                {comps.length === 0 && <span className="italic text-gray-400">No products — click Edit to build this hamper</span>}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1 border-t border-gray-100 pt-2 text-center text-xs">
                <div>
                  <div className="text-gray-400">Total cost</div>
                  <div className="font-medium text-gray-700">{formatCurrency(s.totalCost)}</div>
                </div>
                <div>
                  <div className="text-gray-400">Profit</div>
                  <div className={`font-medium ${s.profit < 0 ? "text-brand-danger" : "text-brand-success"}`}>{formatCurrency(s.profit)}</div>
                </div>
                <div>
                  <div className="text-gray-400">Sold</div>
                  <div className="font-medium text-gray-700">{sold.qty}</div>
                </div>
              </div>

              {offerFor(h) && (
                <div className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-success">
                  <Tag size={11} /> {offerLabel(offerFor(h)!)}
                </div>
              )}

              <div className="mt-auto flex justify-end gap-1 pt-2">
                <button className="btn-secondary !py-0.5 text-xs" onClick={() => openEdit(h)}>
                  <Pencil size={12} /> Edit
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

      {draft && draftStats && (
        <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <div className="card my-auto w-full max-w-2xl space-y-3 p-5">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-gray-800">{draft.id ? "Edit Hamper" : "Add Hamper"}</h2>
              <button onClick={() => setDraft(null)}><X size={16} /></button>
            </div>

            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}

            <div className="flex gap-3">
              <div className="shrink-0">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => handleImage(e.target.files?.[0])} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border border-dashed border-border text-gray-400 hover:bg-accent"
                  title="Upload hamper image"
                >
                  {uploading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : draft.image ? (
                    <img src={draft.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-[11px]"><ImagePlus size={20} /> Image</span>
                  )}
                </button>
                {draft.image && (
                  <button type="button" className="mt-1 w-24 text-center text-[11px] text-brand-danger" onClick={() => setDraft({ ...draft, image: null })}>
                    Remove
                  </button>
                )}
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2">
                <input className="input col-span-2" placeholder="Hamper name * (e.g. Birthday Hamper)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <input className="input" list="hamper-categories" placeholder="Category (e.g. Birthday)" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
                <datalist id="hamper-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
                <select className="input" value={draft.offer_id} onChange={(e) => setDraft({ ...draft, offer_id: e.target.value })}>
                  <option value="">No offer</option>
                  {offers.map((o) => <option key={o.id} value={o.id}>{offerLabel(o)}</option>)}
                </select>
                <label className="text-xs text-gray-500">
                  Selling price (₹) *
                  <input type="number" min={0} className="input mt-0.5" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
                </label>
                <label className="text-xs text-gray-500">
                  Packaging cost (₹)
                  <input type="number" min={0} className="input mt-0.5" value={draft.packaging_cost} onChange={(e) => setDraft({ ...draft, packaging_cost: e.target.value })} />
                </label>
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="text-xs font-medium text-gray-600">Products in this hamper (from Inventory)</div>

              <div className="space-y-1.5">
                {draft.components.map((c) => {
                  const inv = inventoryById.get(c.inventory_id) ?? inventory.find((i) => i.id === c.inventory_id);
                  const cost = Number(inv?.cost_price ?? 0);
                  const short = inv ? (inv.stock ?? 0) < c.quantity : true;
                  return (
                    <div key={c.inventory_id} className="flex items-center gap-2 rounded border border-gray-200 p-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{inv ? inventoryLabel(inv) : "Unknown product"}</div>
                        <div className={`text-xs ${short ? "text-brand-danger" : "text-gray-400"}`}>
                          {inv?.stock ?? 0} in stock · cost {formatCurrency(cost)}{cost === 0 ? " (not set)" : ""}
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">×</span>
                      <input type="number" min={1} className="input !w-16 !py-0.5 text-right" value={c.quantity} onChange={(e) => setComponentQty(c.inventory_id, Number(e.target.value))} />
                      <span className="w-20 text-right text-sm font-medium">{formatCurrency(cost * c.quantity)}</span>
                      <button onClick={() => removeComponent(c.inventory_id)} className="text-brand-danger"><Trash2 size={13} /></button>
                    </div>
                  );
                })}
                {draft.components.length === 0 && <p className="text-sm text-gray-400">No products added yet — search below.</p>}
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    className="input w-full"
                    placeholder="Search Inventory to add a product…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  />
                  {searchOpen && (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-cardHover">
                      {pickerMatches.map((i) => (
                        <li key={i.id} className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent" onMouseDown={() => addComponent(i)}>
                          {inventoryLabel(i)} — {i.stock ?? 0} in stock · cost {formatCurrency(Number(i.cost_price ?? 0))}
                        </li>
                      ))}
                      {pickerMatches.length === 0 && <li className="px-3 py-1.5 text-sm text-gray-400">No matching products</li>}
                    </ul>
                  )}
                </div>
                <input type="number" min={1} className="input !w-16" title="Quantity of this product per hamper" value={pickQty} onChange={(e) => setPickQty(Math.max(1, Number(e.target.value)))} />
              </div>
              <p className="text-[11px] text-gray-400">
                Pick a product, set how many go in one hamper (quantity box), then choose it. Phones tracked by IMEI/serial can't be used here.
              </p>
            </div>

            <div className="space-y-1 rounded-md bg-page p-3 text-sm">
              <div className="flex justify-between text-gray-500"><span>Product cost</span><span>{formatCurrency(draftStats.productCost)}</span></div>
              <div className="flex justify-between text-gray-500"><span>Packaging cost</span><span>{formatCurrency(Number(draft.packaging_cost) || 0)}</span></div>
              <div className="flex justify-between border-t border-border pt-1 font-medium text-gray-700"><span>Total cost</span><span>{formatCurrency(draftStats.totalCost)}</span></div>
              <div className="flex justify-between text-gray-500"><span>Selling price</span><span>{formatCurrency(Number(draft.price) || 0)}</span></div>
              <div className={`flex justify-between font-semibold ${draftStats.profit < 0 ? "text-brand-danger" : "text-brand-success"}`}>
                <span>Profit per hamper</span>
                <span>{formatCurrency(draftStats.profit)} ({draftStats.marginPct.toFixed(1)}%)</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1 text-gray-700">
                <span>Hampers you can sell now</span>
                <span className="font-semibold">
                  {draftStats.available}
                  {limitingStat && <span className="ml-1 font-normal text-xs text-gray-400">(limited by {limitingStat.limitingName})</span>}
                </span>
              </div>
            </div>

            {draftStats.missingCost.length > 0 && (
              <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>No cost price on: {draftStats.missingCost.join(", ")} — counted as ₹0, so profit is overstated. Set it in Inventory.</span>
              </div>
            )}
            {draftStats.profit < 0 && Number(draft.price) > 0 && (
              <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>Selling price is below total cost — this hamper would sell at a loss.</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={saveDraft} disabled={saving || uploading}>{saving ? "Saving…" : "Save Hamper"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
