import { useEffect, useRef, useState } from "react";
import { X, Upload, Plus, Check, AlertCircle, Trash2 } from "lucide-react";
import { formatCurrency, validateImei, normalizeImei } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { readInvoiceFile, decodeQrFromImage, decodeEInvoiceQr, parseInvoiceHeader, type EInvoiceSummary } from "../lib/invoiceReader";

const CATEGORY_OPTIONS = ["Smartphones", "Feature Phones", "Tablets", "Accessories", "Refurbished", "Home Appliances"];

interface ExistingItem {
  id: string;
  name: string;
  model: string;
  stock: number;
  is_serialized: boolean;
}

interface Row {
  key: number;
  name: string;
  category: string;
  qty: number;
  unitCost: number;
  salePrice: number;
  hsn: string;
  gstRate: string;
  /** One IMEI per line — shown for checking/editing, only saved on "Confirm & Add". */
  imeiText: string;
  status: "pending" | "added" | "restocked" | "error";
  message?: string;
}

let rowKey = 1;
const newRow = (p: Partial<Row> = {}): Row => ({ key: rowKey++, name: "", category: "Accessories", qty: 1, unitCost: 0, salePrice: 0, hsn: "", gstRate: "", imeiText: "", status: "pending", ...p });

const imeiList = (text: string) => text.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);

type ImeiState = { raw: string; imei: string; ok: boolean; problem?: string };

/** Format + check digit, duplicates inside this invoice, and units already in inventory (`inStock`). */
function checkImeis(rows: Row[], inStock: Set<string>): Map<number, ImeiState[]> {
  const seen = new Map<string, number>();
  for (const r of rows) for (const raw of imeiList(r.imeiText)) {
    const n = normalizeImei(raw);
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  const out = new Map<number, ImeiState[]>();
  for (const r of rows) {
    out.set(
      r.key,
      imeiList(r.imeiText).map((raw) => {
        const res = validateImei(raw);
        const imei = res.normalized;
        if (!res.ok) return { raw, imei, ok: false, problem: res.message };
        if ((seen.get(imei) ?? 0) > 1) return { raw, imei, ok: false, problem: "Duplicate — appears more than once on this invoice." };
        if (inStock.has(imei)) return { raw, imei, ok: false, problem: "Already in inventory." };
        return { raw, imei, ok: true };
      })
    );
  }
  return out;
}

async function findImeisInInventory(imeis: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const list = [...new Set(imeis.filter((i) => /^\d{15}$/.test(i)))];
  if (!list.length) return found;
  for (const col of ["imei_1", "imei_2"] as const) {
    const { data } = await supabase.from("inventory_units").select(col).in(col, list);
    for (const r of (data ?? []) as unknown as Record<string, string | null>[]) if (r[col]) found.add(r[col] as string);
  }
  return found;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** dd-mm-yyyy, dd/mm/yyyy or "11-Sep-26" → yyyy-mm-dd (null if it can't be read). */
function toIsoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const a = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (a) return `${a[3]}-${a[2].padStart(2, "0")}-${a[1].padStart(2, "0")}`;
  const b = raw.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{2,4})$/);
  const m = b ? MONTHS.indexOf(b[2].toLowerCase()) : -1;
  if (b && m >= 0) return `${b[3].length === 2 ? `20${b[3]}` : b[3]}-${String(m + 1).padStart(2, "0")}-${b[1].padStart(2, "0")}`;
  return null;
}

export function InvoiceImportModal({
  summary: initialSummary,
  existing,
  onClose,
  onDone,
}: {
  summary: EInvoiceSummary | null;
  existing: ExistingItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [summary, setSummary] = useState<EInvoiceSummary | null>(initialSummary ?? {});
  const [rawLines, setRawLines] = useState<string[]>([]);
  const expected = summary?.itemCount ?? 0;
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: Math.max(expected, 1) }, () => newRow()));
  const [reading, setReading] = useState<string | null>(null);
  const [readMsg, setReadMsg] = useState<string | null>(null);
  const [wholesaler, setWholesaler] = useState("");
  const [phone, setPhone] = useState("");
  const [logged, setLogged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // IMEIs from this invoice that already exist in inventory (looked up as the list is edited).
  const [inStock, setInStock] = useState<Set<string>>(new Set());
  const imeiKey = rows.map((r) => r.imeiText).join("\n");
  useEffect(() => {
    const all = rows.flatMap((r) => imeiList(r.imeiText).map(normalizeImei));
    const t = setTimeout(() => findImeisInInventory(all).then(setInStock).catch(() => {}), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imeiKey]);
  const imeiChecks = checkImeis(rows, inStock);

  const done = rows.filter((r) => r.status === "added" || r.status === "restocked");
  const patch = (key: number, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReading("Reading invoice…");
    setReadMsg(null);
    setRawLines([]);
    const notes: string[] = [];
    try {
      const isImage = file.type.startsWith("image/");
      // A photo of the invoice usually shows its QR too — read that for the summary.
      if (isImage) {
        try {
          const qr = await decodeQrFromImage(file);
          const found = qr ? decodeEInvoiceQr(qr) : null;
          if (found) {
            setSummary(found);
            notes.push("QR read: invoice summary filled in.");
          } else
            notes.push(
              qr
                ? "A QR was found but it is not a GST e-invoice QR."
                : "The QR could not be read from this photo (e-invoice QRs are very dense — it is usually too small or blurry). For a QR, upload the invoice PDF or retake the photo close up with the QR filling the frame. The invoice details are read from the printed text instead; check them below."
            );
        } catch {
          notes.push("Could not check the photo for a QR.");
        }
      }
      setReading("Reading items…");
      const { lines, rawLines: raw, source } = await readInvoiceFile(file, (pct) => setReading(`Reading items… ${pct}%`));
      // Fill any header field the QR didn't give us from the printed text (never overwrites what is already set).
      const guess = parseInvoiceHeader(raw);
      setSummary((prev) => ({
        ...prev,
        sellerGstin: prev?.sellerGstin || guess.sellerGstin,
        buyerGstin: prev?.buyerGstin || guess.buyerGstin,
        invoiceNumber: prev?.invoiceNumber || guess.invoiceNumber,
        invoiceDate: prev?.invoiceDate || guess.invoiceDate,
        totalValue: prev?.totalValue ?? guess.totalValue,
        sellerName: prev?.sellerName || guess.sellerName,
        itemCount: prev?.itemCount ?? (lines.length || undefined),
      }));
      if (guess.sellerName) setWholesaler((w) => w || guess.sellerName!);
      if (lines.length === 0) {
        setRawLines(raw);
        notes.push(
          raw.length
            ? "Could not recognise item rows automatically. The text that was read is listed below — tap a line to use it as an item, or add items by hand."
            : "No text could be read from the file. Try a sharper, straight-on photo, or add the items by hand."
        );
      } else {
        setRows((prev) => {
          const kept = prev.filter((r) => r.name.trim() || r.status !== "pending");
          return [
            ...kept,
            ...lines.map((l) =>
              newRow({
                name: l.name,
                // Phones carry IMEIs / HSN 8517; everything else stays "Accessories" until changed.
                category: l.imeis?.length || /^8517/.test(l.hsn ?? "") ? "Smartphones" : "Accessories",
                qty: l.qty,
                unitCost: l.unitCost,
                hsn: l.hsn ?? "",
                gstRate: l.gstRate != null ? String(l.gstRate) : "",
                imeiText: (l.imeis ?? []).join("\n"),
              })
            ),
          ];
        });
        const nImei = lines.reduce((n, l) => n + (l.imeis?.length ?? 0), 0);
        notes.push(
          `Read ${lines.length} item${lines.length === 1 ? "" : "s"}${nImei ? ` and ${nImei} IMEI${nImei === 1 ? "" : "s"}` : ""} from the ${source === "pdf" ? "PDF" : "photo"}. Nothing is saved yet — check and edit every row, then press Confirm & Add.`
        );
      }
    } catch (e: any) {
      notes.push(`Could not read the items: ${e?.message || "unknown error"}. You can still add them by hand.`);
    } finally {
      setReadMsg(notes.join(" "));
      setReading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function useLine(line: string) {
    const tokens = line.trim().split(/\s+/);
    const cut = tokens.findIndex((t) => /^[\d,]+(\.\d+)?$/.test(t) && t.length >= 3);
    const name = (cut > 0 ? tokens.slice(0, cut) : tokens).join(" ").replace(/^\d{1,3}\s+/, "");
    const amounts = tokens.filter((t) => /^\d[\d,]*\.\d{1,2}$/.test(t)).map((t) => Number(t.replace(/,/g, "")));
    setRows((prev) => {
      const empty = prev.find((r) => r.status === "pending" && !r.name.trim());
      const row = newRow({ name, unitCost: amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0] ?? 0 });
      return empty ? prev.map((r) => (r.key === empty.key ? { ...row, key: empty.key } : r)) : [...prev, row];
    });
  }

  // Rows with IMEIs become serialized stock: one inventory_units row (+ a 'purchase' history event) per IMEI.
  // Runs only from "Confirm & Add", and re-checks every IMEI against the database right before writing.
  async function addRowWithImeis(row: Row, match: ExistingItem | undefined) {
    const entries = imeiList(row.imeiText).map((raw) => validateImei(raw));
    const bad = entries.filter((e) => !e.ok);
    if (bad.length) return patch(row.key, { status: "error", message: `Fix or remove ${bad.length} invalid IMEI${bad.length === 1 ? "" : "s"} first.` });
    const imeis = entries.map((e) => e.normalized);
    if (new Set(imeis).size !== imeis.length) return patch(row.key, { status: "error", message: "The same IMEI is listed twice in this item." });
    const others = rows.filter((r) => r.key !== row.key && r.status === "pending").flatMap((r) => imeiList(r.imeiText).map(normalizeImei));
    const clash = imeis.find((i) => others.includes(i));
    if (clash) return patch(row.key, { status: "error", message: `IMEI ${clash} is also listed on another item.` });
    const fresh = await findImeisInInventory(imeis);
    if (fresh.size) return patch(row.key, { status: "error", message: `Already in inventory: ${[...fresh].join(", ")}.` });
    if (match && !match.is_serialized) {
      return patch(row.key, { status: "error", message: `"${match.name}" exists without IMEI tracking — switching it on would reset its stock count. Add these via Manage Serials instead.` });
    }

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    let inventoryId = match?.id;
    let createdProduct = false;
    if (!inventoryId) {
      const hsn = row.hsn.trim();
      const gst = row.gstRate.trim();
      const { data, error: e } = await supabase
        .from("inventory")
        .insert({
          name: row.name.trim(),
          model: row.name.trim(),
          category: row.category,
          product_type: "new",
          price: Number(row.salePrice) || Number(row.unitCost) || 0,
          cost_price: Number(row.unitCost) || null,
          stock: 0, // derived from the units below
          warranty_months: 0,
          is_featured: false,
          images: [],
          is_active: true,
          is_serialized: true,
          ...(hsn ? { hsn_sac: hsn } : {}),
          ...(gst !== "" && Number.isFinite(Number(gst)) ? { gst_rate: Number(gst) } : {}),
        })
        .select("id")
        .single();
      if (e) throw e;
      inventoryId = data.id as string;
      createdProduct = true;
    }

    const units = imeis.map((imei) => ({ id: crypto.randomUUID(), inventory_id: inventoryId, imei_1: imei, imei_2: null, serial_no: null, status: "in_stock" as const, created_by: userId, updated_by: userId }));
    const { error: unitsErr } = await supabase.from("inventory_units").insert(units);
    if (unitsErr) {
      if (createdProduct) await supabase.from("inventory").delete().eq("id", inventoryId); // don't leave an empty product behind
      throw unitsErr;
    }
    const { error: histErr } = await supabase.from("imei_history").insert(
      units.map((u) => ({ stock_unit_id: u.id, imei_1: u.imei_1, imei_2: null, event_type: "purchase" as const, to_status: "in_stock", created_by: userId }))
    );
    if (histErr) throw histErr;

    patch(row.key, {
      qty: imeis.length,
      status: createdProduct ? "added" : "restocked",
      message: `${createdProduct ? "Added" : "Restocked"} with ${imeis.length} IMEI${imeis.length === 1 ? "" : "s"}.`,
    });
    setInStock((prev) => new Set([...prev, ...imeis]));
  }

  async function addRow(row: Row) {
    if (!row.name.trim()) return patch(row.key, { status: "error", message: "Enter the item name." });
    if (row.qty < 1) return patch(row.key, { status: "error", message: "Quantity must be at least 1." });
    const key = row.name.trim().toLowerCase();
    const match = existing.find((i) => i.name.trim().toLowerCase() === key || i.model.trim().toLowerCase() === key);
    try {
      if (imeiList(row.imeiText).length > 0) return await addRowWithImeis(row, match);
      if (match) {
        if (match.is_serialized) {
          return patch(row.key, { status: "error", message: `"${match.name}" already exists and tracks IMEI/serials — add its stock via Manage Serials.` });
        }
        const { error: e } = await supabase.from("inventory").update({ stock: match.stock + row.qty }).eq("id", match.id);
        if (e) throw e;
        match.stock += row.qty;
        return patch(row.key, { status: "restocked", message: `Added ${row.qty} to existing "${match.name}".` });
      }
      const { error: e } = await supabase.from("inventory").insert({
        name: row.name.trim(),
        model: row.name.trim(),
        category: row.category,
        product_type: "new",
        price: Number(row.salePrice) || Number(row.unitCost) || 0,
        cost_price: Number(row.unitCost) || null,
        stock: row.qty,
        warranty_months: 0,
        is_featured: false,
        images: [],
        is_active: true,
        is_serialized: false,
      });
      if (e) throw e;
      patch(row.key, { status: "added", message: "Added to inventory." });
    } catch (e: any) {
      patch(row.key, { status: "error", message: e?.message || "Could not add." });
    }
  }

  async function addAll() {
    setBusy(true);
    for (const r of rows) if (r.status !== "added" && r.status !== "restocked" && r.name.trim()) await addRow(r);
    setBusy(false);
    onDone();
  }

  async function logInvoice() {
    if (!wholesaler.trim()) return setError("Enter the wholesaler's name to log this invoice.");
    setError(null);
    const items = done.map((r) => ({ name: r.name.trim(), qty: r.qty, total_price: r.qty * r.unitCost }));
    const total = items.reduce((n, i) => n + i.total_price, 0);
    const isoDate = toIsoDate(summary?.invoiceDate);
    const { error: e } = await supabase.from("wholesaler_invoices").insert({
      wholesaler_name: wholesaler.trim(),
      wholesaler_phone: phone.trim() || null,
      invoice_number: summary?.invoiceNumber || null,
      items,
      total_amount: summary?.totalValue ?? total,
      paid_amount: 0,
      due_amount: summary?.totalValue ?? total,
      payment_status: "pending",
      invoice_date: isoDate ?? new Date().toISOString().slice(0, 10),
      notes: `Imported from invoice${summary?.sellerGstin ? ` (seller GSTIN ${summary.sellerGstin})` : ""}`,
    });
    if (e) return setError(e.message);
    setLogged(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-serif text-base font-semibold text-gray-800">Add items from invoice</h2>
          <button onClick={onClose} aria-label="Close"><X size={18} className="text-gray-400" /></button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {summary && (
            <div className="rounded-lg border border-border bg-accent/40 p-3 text-xs text-gray-600">
              <div className="mb-1 font-semibold text-gray-800">Invoice details <span className="font-normal text-gray-400">(edit if anything is wrong)</span></div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gray-400">Seller / wholesaler
                  <input className="input w-full" value={summary.sellerName ?? ""} onChange={(e) => { setSummary({ ...summary, sellerName: e.target.value }); setWholesaler(e.target.value); }} />
                </label>
                <label className="text-[11px] text-gray-400">Seller GSTIN
                  <input className="input w-full" value={summary.sellerGstin ?? ""} onChange={(e) => setSummary({ ...summary, sellerGstin: e.target.value })} />
                </label>
                <label className="text-[11px] text-gray-400">Invoice no
                  <input className="input w-full" value={summary.invoiceNumber ?? ""} onChange={(e) => setSummary({ ...summary, invoiceNumber: e.target.value })} />
                </label>
                <label className="text-[11px] text-gray-400">Date
                  <input className="input w-full" value={summary.invoiceDate ?? ""} onChange={(e) => setSummary({ ...summary, invoiceDate: e.target.value })} />
                </label>
                <label className="text-[11px] text-gray-400">Invoice total (₹)
                  <input type="number" className="input w-full" value={summary.totalValue ?? ""} onChange={(e) => setSummary({ ...summary, totalValue: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </label>
                <span className="self-end pb-2">Items on invoice: <b>{summary.itemCount ?? "—"}</b>{summary.mainHsn ? <> · Main HSN: <b>{summary.mainHsn}</b></> : null}</span>
              </div>
              {(() => {
                const warnings: string[] = [];
                const filled = rows.filter((r) => r.name.trim());
                if (summary.itemCount && filled.length && filled.length !== summary.itemCount) warnings.push(`The invoice lists ${summary.itemCount} items but ${filled.length} are filled in below.`);
                const withGst = filled.filter((r) => r.gstRate !== "" && r.unitCost > 0);
                if (summary.totalValue && withGst.length === filled.length && filled.length > 0) {
                  const calc = filled.reduce((n, r) => n + r.qty * r.unitCost * (1 + Number(r.gstRate) / 100), 0);
                  if (Math.abs(calc - summary.totalValue) > Math.max(2, filled.length)) warnings.push(`The rows add up to ${formatCurrency(calc)} with GST, but the invoice total is ${formatCurrency(summary.totalValue)} — check the prices, quantities and GST %.`);
                }
                return warnings.map((w) => <div key={w} className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-700"><AlertCircle size={12} className="mt-0.5 shrink-0" />{w}</div>);
              })()}
              <div className="mt-1.5 text-[11px] text-gray-400">The QR only carries invoice-level details. Item names, prices and IMEIs are read from the printed invoice below — nothing is saved until you press Confirm &amp; Add.</div>
            </div>
          )}

          <div className="rounded-lg border border-dashed border-gray-300 p-3">
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn-secondary w-full text-xs" disabled={!!reading} onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> {reading ?? "Upload invoice PDF / photo (reads QR + items)"}
            </button>
            {readMsg && <p className="mt-1.5 text-center text-xs text-gray-600">{readMsg}</p>}
            {rawLines.length > 0 && (
              <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded border border-border bg-white p-1.5 text-[11px]">
                {rawLines.slice(0, 80).map((l, i) => (
                  <button key={i} className="block w-full truncate rounded px-1 py-0.5 text-left text-gray-600 hover:bg-accent" onClick={() => useLine(l)}>
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-700">
              {done.length}{expected ? ` of ${expected}` : ""} item{done.length === 1 ? "" : "s"} added
              {expected > 0 && done.length < expected ? ` · ${expected - done.length} left` : ""}
            </span>
            <button className="text-brand-primary hover:underline" onClick={() => setRows((p) => [...p, newRow()])}>
              <Plus size={12} className="mr-0.5 inline" />Add another item
            </button>
          </div>

          {rows.map((r, i) => {
            const locked = r.status === "added" || r.status === "restocked";
            return (
              <div key={r.key} className={`rounded-lg border p-3 ${locked ? "border-emerald-200 bg-emerald-50/50" : "border-border"}`}>
                <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                  <span>Item {i + 1}{expected ? ` of ${expected}` : ""}</span>
                  {!locked && rows.length > 1 && (
                    <button onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))} aria-label="Remove"><Trash2 size={13} /></button>
                  )}
                </div>
                <input className="input mb-2 w-full" placeholder="Item name / model" value={r.name} disabled={locked} onChange={(e) => patch(r.key, { name: e.target.value, status: "pending", message: undefined })} />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <select className="input" value={r.category} disabled={locked} onChange={(e) => patch(r.key, { category: e.target.value })}>
                    {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <label className="text-[11px] text-gray-400">Qty
                    <input type="number" min={1} className="input w-full" value={r.qty} disabled={locked} onChange={(e) => patch(r.key, { qty: Number(e.target.value) })} />
                  </label>
                  <label className="text-[11px] text-gray-400">Cost / unit (₹)
                    <input type="number" min={0} className="input w-full" value={r.unitCost} disabled={locked} onChange={(e) => patch(r.key, { unitCost: Number(e.target.value) })} />
                  </label>
                  <label className="text-[11px] text-gray-400">Sale price (₹)
                    <input type="number" min={0} className="input w-full" value={r.salePrice} disabled={locked} onChange={(e) => patch(r.key, { salePrice: Number(e.target.value) })} />
                  </label>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-gray-400">HSN
                    <input className="input w-full" value={r.hsn} disabled={locked} onChange={(e) => patch(r.key, { hsn: e.target.value })} />
                  </label>
                  <label className="text-[11px] text-gray-400">GST %
                    <input type="number" min={0} className="input w-full" value={r.gstRate} disabled={locked} onChange={(e) => patch(r.key, { gstRate: e.target.value })} />
                  </label>
                </div>
                <label className="mt-2 block text-[11px] text-gray-400">IMEI / Batch (one per line — edit or delete here)
                  <textarea className="input w-full font-mono text-xs" rows={Math.max(2, Math.min(6, imeiList(r.imeiText).length + 1))} placeholder="No IMEI — this item will be added as plain stock" value={r.imeiText} disabled={locked} onChange={(e) => patch(r.key, { imeiText: e.target.value, status: "pending", message: undefined })} />
                </label>
                {(imeiChecks.get(r.key) ?? []).length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px]">
                    {(imeiChecks.get(r.key) ?? []).map((c, idx) => (
                      <li key={idx} className={`flex items-center gap-1 ${c.ok ? "text-emerald-600" : "text-brand-danger"}`}>
                        {c.ok ? <Check size={11} /> : <AlertCircle size={11} />}
                        <span className="font-mono">{c.imei || c.raw}</span>
                        <span>{c.ok ? (locked ? "saved" : "valid") : c.problem}</span>
                      </li>
                    ))}
                    {!locked && (imeiChecks.get(r.key) ?? []).length !== r.qty && (
                      <li className="text-amber-700">Qty is {r.qty} but {(imeiChecks.get(r.key) ?? []).length} IMEI(s) listed — stock will equal the IMEIs added.</li>
                    )}
                  </ul>
                )}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={`flex items-center gap-1 text-xs ${r.status === "error" ? "text-brand-danger" : "text-emerald-600"}`}>
                    {r.status === "error" ? <AlertCircle size={12} /> : locked ? <Check size={12} /> : null}
                    {r.message}
                  </span>
                  {!locked && (
                    <button className="btn-primary text-xs" onClick={() => addRow(r).then(onDone)}>
                      {imeiList(r.imeiText).length ? "Confirm & Add" : "Add to inventory"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {done.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 text-xs font-semibold text-gray-700">Log this as a wholesaler invoice</div>
              {logged ? (
                <div className="flex items-center gap-1 text-xs text-emerald-600"><Check size={12} /> Logged in Wholesaler Invoices.</div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input className="input" placeholder="Wholesaler name *" value={wholesaler} onChange={(e) => setWholesaler(e.target.value)} />
                  <input className="input" placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  <button className="btn-secondary text-xs" onClick={logInvoice}>Log invoice</button>
                </div>
              )}
              {error && <div className="mt-1.5 text-xs text-brand-danger">{error}</div>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <button className="btn-ghost text-xs" onClick={onClose}>Close</button>
          <button className="btn-primary text-xs" disabled={busy} onClick={addAll}>Confirm &amp; Add all remaining</button>
        </div>
      </div>
    </div>
  );
}
