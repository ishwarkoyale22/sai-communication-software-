import { useState } from "react";
import { X, Plus, Trash2, Check, AlertCircle, ClipboardPaste } from "lucide-react";
import { supabase } from "../lib/supabase";

// Must match the live inventory_category_check constraint (same list Inventory.tsx uses).
const CATEGORY_OPTIONS = ["Smartphones", "Feature Phones", "Tablets", "Accessories", "Refurbished", "Home Appliances"];
const MAX_ROWS = 100;

interface ExistingItem {
  name: string;
  model: string;
}
interface BrandOpt {
  id: string;
  name: string;
  is_active: boolean;
}

interface Row {
  key: number;
  name: string;
  model: string;
  category: string;
  brandId: string;
  cost: string;
  price: string;
  stock: string;
  status: "pending" | "added" | "error";
  message?: string;
}

let rowKey = 1;
const blank = (p: Partial<Row> = {}): Row => ({ key: rowKey++, name: "", model: "", category: "Smartphones", brandId: "", cost: "", price: "", stock: "1", status: "pending", ...p });

/** Add many plain (non-serial) products in one go. The single-product form is untouched. */
export function BulkAddProductsModal({
  existing,
  brands,
  onClose,
  onDone,
}: {
  existing: ExistingItem[];
  brands: BrandOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const patch = (key: number, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const pending = rows.filter((r) => r.status !== "added");
  const addedCount = rows.filter((r) => r.status === "added").length;

  function addRows(n: number) {
    setRows((prev) => {
      const room = MAX_ROWS - prev.length;
      if (room <= 0) {
        setNotice(`You can add up to ${MAX_ROWS} products at a time.`);
        return prev;
      }
      return [...prev, ...Array.from({ length: Math.min(n, room) }, () => blank())];
    });
  }

  // Paste rows copied from Excel/Sheets: name, model, category, brand, cost, sale price, stock (tab or comma separated).
  function importPaste() {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed: Row[] = lines.slice(0, MAX_ROWS).map((line) => {
      const c = line.split(line.includes("\t") ? "\t" : ",").map((x) => x.trim());
      const cat = CATEGORY_OPTIONS.find((o) => o.toLowerCase() === (c[2] ?? "").toLowerCase()) ?? "Smartphones";
      const brand = brands.find((b) => b.name.toLowerCase() === (c[3] ?? "").toLowerCase());
      return blank({ name: c[0] ?? "", model: c[1] ?? "", category: cat, brandId: brand?.id ?? "", cost: c[4] ?? "", price: c[5] ?? "", stock: c[6] || "1" });
    });
    if (parsed.length === 0) return setNotice("Nothing to import — paste some rows first.");
    setRows((prev) => [...prev.filter((r) => r.name.trim() || r.status === "added"), ...parsed].slice(0, MAX_ROWS));
    setPasteText("");
    setPasteOpen(false);
    setNotice(`Imported ${parsed.length} row${parsed.length === 1 ? "" : "s"} — check them, then press Save.${lines.length > MAX_ROWS ? ` Only the first ${MAX_ROWS} were kept.` : ""}`);
  }

  async function saveAll() {
    setNotice(null);
    const taken = new Set(existing.flatMap((i) => [i.name.trim().toLowerCase(), i.model.trim().toLowerCase()]));
    const seen = new Set<string>();
    const good: Row[] = [];
    let checked = rows.map((r) => {
      if (r.status === "added" || (!r.name.trim() && !r.model.trim())) return r; // blank rows are ignored
      const name = r.name.trim() || r.model.trim();
      const model = r.model.trim() || r.name.trim();
      const key = name.toLowerCase();
      if (!name) return { ...r, status: "error" as const, message: "Enter a product name." };
      if (taken.has(key) || taken.has(model.toLowerCase())) return { ...r, status: "error" as const, message: "Already in inventory — use its stock / Manage Serials instead." };
      if (seen.has(key)) return { ...r, status: "error" as const, message: "Duplicate of another row above." };
      if (!Number.isFinite(Number(r.stock)) || Number(r.stock) < 0) return { ...r, status: "error" as const, message: "Stock must be 0 or more." };
      if ((r.price !== "" && Number(r.price) < 0) || (r.cost !== "" && Number(r.cost) < 0)) return { ...r, status: "error" as const, message: "Prices can't be negative." };
      seen.add(key);
      const ok = { ...r, name, model, status: "pending" as const, message: undefined };
      good.push(ok);
      return ok;
    });
    setRows(checked);
    if (good.length === 0) return setNotice("No valid products to save. Fix the highlighted rows or fill in at least one name.");

    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setBusy(false);
      return setNotice("Your admin session has expired. Please sign out and sign in again, then retry.");
    }
    // Chunks of 50 so a big paste never becomes one enormous request.
    for (let i = 0; i < good.length; i += 50) {
      const chunk = good.slice(i, i + 50);
      const { error } = await supabase.from("inventory").insert(
        chunk.map((r) => ({
          name: r.name,
          model: r.model,
          category: r.category,
          brand_id: r.brandId || null,
          product_type: "new",
          price: Number(r.price) || Number(r.cost) || 0,
          cost_price: Number(r.cost) || null,
          stock: Number(r.stock) || 0,
          warranty_months: 0,
          is_featured: false,
          images: [],
          is_active: true,
          is_serialized: false,
        }))
      );
      const keys = new Set(chunk.map((r) => r.key));
      checked = checked.map((r) =>
        keys.has(r.key) ? (error ? { ...r, status: "error" as const, message: error.message } : { ...r, status: "added" as const, message: "Added." }) : r
      );
      setRows(checked);
      if (error) break;
    }
    setBusy(false);
    const n = checked.filter((r) => r.status === "added").length;
    setNotice(`${n} product${n === 1 ? "" : "s"} added.${checked.some((r) => r.status === "error") ? " Some rows need attention (marked in red)." : ""}`);
    await supabase.from("notifications").insert({
      for_admin: true,
      type: "product_added",
      title: "Products Added",
      body: `${n} product${n === 1 ? "" : "s"} added in bulk by ${session.user.email?.split("@")[0] ?? "Admin"}.`,
      link: "/inventory",
    });
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-serif text-base font-semibold text-gray-800">Add multiple products</h2>
            <p className="text-xs text-gray-400">Up to {MAX_ROWS} at a time. For products tracked by IMEI/serial number, use the normal Add Product form.</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={18} className="text-gray-400" /></button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {notice && <div className="rounded-md border border-border bg-accent/40 p-2.5 text-xs text-gray-700">{notice}</div>}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-gray-700">{rows.length} row{rows.length === 1 ? "" : "s"}{addedCount ? ` · ${addedCount} added` : ""}</span>
            <button className="btn-secondary text-xs" onClick={() => addRows(1)}><Plus size={12} /> 1 row</button>
            <button className="btn-secondary text-xs" onClick={() => addRows(5)}>+5</button>
            <button className="btn-secondary text-xs" onClick={() => addRows(10)}>+10</button>
            <button className="btn-secondary text-xs" onClick={() => setPasteOpen((o) => !o)}><ClipboardPaste size={12} /> Paste from Excel</button>
          </div>

          {pasteOpen && (
            <div className="rounded-lg border border-dashed border-gray-300 p-3">
              <div className="mb-1 text-[11px] text-gray-500">
                One product per line, columns in this order: <b>name, model, category, brand, cost, sale price, stock</b> (tab or comma separated — copy straight from a spreadsheet).
              </div>
              <textarea className="input h-28 w-full font-mono text-xs" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"USB Cable\tUSB-C 1m\tAccessories\t\t80\t150\t20"} />
              <button className="btn-primary mt-1.5 text-xs" onClick={importPaste}>Import rows</button>
            </div>
          )}

          <div className="space-y-2">
            {rows.map((r, i) => {
              const locked = r.status === "added";
              return (
                <div key={r.key} className={`rounded-lg border p-2.5 ${locked ? "border-emerald-200 bg-emerald-50/50" : r.status === "error" ? "border-red-200 bg-red-50/40" : "border-border"}`}>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-[1.4fr_1.2fr_1fr_1fr_0.7fr_0.7fr_0.6fr_auto]">
                    <input className="input col-span-2 lg:col-span-1" placeholder={`Product name * (${i + 1})`} value={r.name} disabled={locked} onChange={(e) => patch(r.key, { name: e.target.value, status: "pending", message: undefined })} />
                    <input className="input" placeholder="Model" value={r.model} disabled={locked} onChange={(e) => patch(r.key, { model: e.target.value })} />
                    <select className="input" value={r.category} disabled={locked} onChange={(e) => patch(r.key, { category: e.target.value })}>
                      {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <select className="input" value={r.brandId} disabled={locked} onChange={(e) => patch(r.key, { brandId: e.target.value })}>
                      <option value="">Brand —</option>
                      {brands.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <input type="number" min={0} className="input" placeholder="Cost ₹" value={r.cost} disabled={locked} onChange={(e) => patch(r.key, { cost: e.target.value })} />
                    <input type="number" min={0} className="input" placeholder="Price ₹" value={r.price} disabled={locked} onChange={(e) => patch(r.key, { price: e.target.value })} />
                    <input type="number" min={0} className="input" placeholder="Stock" value={r.stock} disabled={locked} onChange={(e) => patch(r.key, { stock: e.target.value })} />
                    {!locked ? (
                      <button className="justify-self-end text-gray-400 hover:text-brand-danger" aria-label="Remove row" onClick={() => setRows((p) => (p.length > 1 ? p.filter((x) => x.key !== r.key) : p))}>
                        <Trash2 size={14} />
                      </button>
                    ) : <Check size={14} className="justify-self-end text-emerald-600" />}
                  </div>
                  {r.message && (
                    <div className={`mt-1 flex items-center gap-1 text-[11px] ${r.status === "error" ? "text-brand-danger" : "text-emerald-600"}`}>
                      {r.status === "error" && <AlertCircle size={11} />}{r.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <button className="btn-ghost text-xs" onClick={onClose}>{addedCount ? "Done" : "Cancel"}</button>
          <button className="btn-primary text-xs" disabled={busy || pending.length === 0} onClick={saveAll}>
            {busy ? "Saving…" : `Save ${pending.filter((r) => r.name.trim() || r.model.trim()).length || ""} product${pending.filter((r) => r.name.trim() || r.model.trim()).length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
