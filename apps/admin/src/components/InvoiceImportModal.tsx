import { useRef, useState } from "react";
import { X, Upload, Plus, Check, AlertCircle, Trash2 } from "lucide-react";
import { formatCurrency } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { readInvoiceFile, decodeQrFromImage, decodeEInvoiceQr, type EInvoiceSummary } from "../lib/invoiceReader";

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
  status: "pending" | "added" | "restocked" | "error";
  message?: string;
}

let rowKey = 1;
const newRow = (p: Partial<Row> = {}): Row => ({ key: rowKey++, name: "", category: "Accessories", qty: 1, unitCost: 0, salePrice: 0, status: "pending", ...p });

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
  const [summary, setSummary] = useState<EInvoiceSummary | null>(initialSummary);
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
          } else notes.push(qr ? "A QR was found but it is not a GST e-invoice QR." : "No QR code was found in the photo.");
        } catch {
          notes.push("Could not check the photo for a QR.");
        }
      }
      setReading("Reading items…");
      const { lines, rawLines: raw, source } = await readInvoiceFile(file, (pct) => setReading(`Reading items… ${pct}%`));
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
          return [...kept, ...lines.map((l) => newRow({ name: l.name, qty: l.qty, unitCost: l.unitCost }))];
        });
        notes.push(`Read ${lines.length} item${lines.length === 1 ? "" : "s"} from the ${source === "pdf" ? "PDF" : "photo"}. Please check every row — names and prices can be misread.`);
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

  async function addRow(row: Row) {
    if (!row.name.trim()) return patch(row.key, { status: "error", message: "Enter the item name." });
    if (row.qty < 1) return patch(row.key, { status: "error", message: "Quantity must be at least 1." });
    const key = row.name.trim().toLowerCase();
    const match = existing.find((i) => i.name.trim().toLowerCase() === key || i.model.trim().toLowerCase() === key);
    try {
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
    const d = summary?.invoiceDate?.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    const { error: e } = await supabase.from("wholesaler_invoices").insert({
      wholesaler_name: wholesaler.trim(),
      wholesaler_phone: phone.trim() || null,
      invoice_number: summary?.invoiceNumber || null,
      items,
      total_amount: summary?.totalValue ?? total,
      paid_amount: 0,
      due_amount: summary?.totalValue ?? total,
      payment_status: "pending",
      invoice_date: d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : new Date().toISOString().slice(0, 10),
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
              <div className="mb-1 font-semibold text-gray-800">Scanned e-invoice</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span>Invoice no: <b>{summary.invoiceNumber ?? "—"}</b></span>
                <span>Date: <b>{summary.invoiceDate ?? "—"}</b></span>
                <span>Seller GSTIN: <b>{summary.sellerGstin ?? "—"}</b></span>
                <span>Total: <b>{summary.totalValue != null ? formatCurrency(summary.totalValue) : "—"}</b></span>
                <span>Items on invoice: <b>{summary.itemCount ?? "—"}</b></span>
                <span>Main HSN: <b>{summary.mainHsn ?? "—"}</b></span>
              </div>
              <div className="mt-1.5 text-[11px] text-gray-400">The QR only carries this summary. Item names and prices come from the invoice file below, or type them in.</div>
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
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={`flex items-center gap-1 text-xs ${r.status === "error" ? "text-brand-danger" : "text-emerald-600"}`}>
                    {r.status === "error" ? <AlertCircle size={12} /> : locked ? <Check size={12} /> : null}
                    {r.message}
                  </span>
                  {!locked && <button className="btn-primary text-xs" onClick={() => addRow(r).then(onDone)}>Add to inventory</button>}
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
          <button className="btn-primary text-xs" disabled={busy} onClick={addAll}>Add all remaining items</button>
        </div>
      </div>
    </div>
  );
}
