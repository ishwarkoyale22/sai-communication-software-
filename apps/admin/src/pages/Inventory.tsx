import { useEffect, useRef, useState } from "react";
import { Plus, X, Edit2, Trash2, Check, AlertCircle, Upload, Loader2, Printer, Hash, Camera, FileSpreadsheet, Keyboard } from "lucide-react";
import { formatCurrency, validateImei, normalizeImei, softDelete } from "@sai/shared";
import type { InventoryUnit } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { InvoiceImportModal } from "../components/InvoiceImportModal";
import { decodeEInvoiceQr, type EInvoiceSummary } from "../lib/invoiceReader";

import { uploadProductImage } from "../lib/uploadImage";

interface Brand {
  id: string;
  name: string;
  is_active: boolean;
}

interface InventoryItem {
  id: string;
  name: string;
  brand_id: string | null;
  model: string;
  category: string | null;
  product_type: string;
  price: number;
  original_price: number | null;
  stock: number;
  images: string[] | null;
  specs: Record<string, unknown> | null;
  condition: string | null;
  grade: string | null;
  battery_health: number | null;
  warranty_months: number;
  is_featured: boolean;
  is_active: boolean;
  cost_price: number | null;
  is_serialized: boolean;
}

// Must exactly match the live `inventory_category_check` constraint —
// verified directly against the database, not guessed:
// CHECK (category = ANY (ARRAY['Smartphones','Feature Phones','Tablets','Accessories','Refurbished','Home Appliances']))
const CATEGORY_OPTIONS = ["Smartphones", "Feature Phones", "Tablets", "Accessories", "Refurbished", "Home Appliances"];

const emptyForm = {
  name: "",
  category: "Smartphones",
  brand_id: "",
  model: "",
  product_type: "new" as "new" | "refurbished",
  price: 0,
  original_price: 0,
  stock: 0,
  condition: "",
  grade: "",
  battery_health: 0,
  warranty_months: 0,
  is_featured: false,
  cost_price: 0,
  is_serialized: false,
  serials: "",
  images: [] as string[],
  ram: [] as string[],
  storage: [] as string[],
  color: [] as string[],
  variant_prices: {} as Record<string, number>,
};

/** Key a RAM+Storage combo maps its price under in specs.variant_prices. */
function variantKey(ram: string, storage: string): string {
  return `${ram}|||${storage}`;
}

function buildSpecs(
  ram: string[],
  storage: string[],
  color: string[],
  variantPrices: Record<string, number>
): Record<string, unknown> | null {
  const specs: Record<string, unknown> = {};
  if (ram.length > 0) specs.ram = ram;
  if (storage.length > 0) specs.storage = storage;
  if (color.length > 0) specs.color = color;
  // Only keep prices for combos that still exist among the current RAM/Storage options.
  if (ram.length > 0 && storage.length > 0) {
    const pruned: Record<string, number> = {};
    for (const r of ram) {
      for (const s of storage) {
        const key = variantKey(r, s);
        if (variantPrices[key] > 0) pruned[key] = variantPrices[key];
      }
    }
    if (Object.keys(pruned).length > 0) specs.variant_prices = pruned;
  }
  return Object.keys(specs).length > 0 ? specs : null;
}

function specsArray(specs: Record<string, unknown> | null | undefined, key: string): string[] {
  const value = specs?.[key];
  return Array.isArray(value) ? value.map(String) : [];
}

function specsVariantPrices(specs: Record<string, unknown> | null | undefined): Record<string, number> {
  const value = specs?.variant_prices;
  return value && typeof value === "object" ? (value as Record<string, number>) : {};
}

/** Lowest set variant price — used as the product's headline "starting at" price. */
function minVariantPrice(variantPrices: Record<string, number>): number | null {
  const values = Object.values(variantPrices).filter((v) => v > 0);
  return values.length > 0 ? Math.min(...values) : null;
}

/** Per-combo price grid, shown once at least one RAM and one Storage option exist. */
function VariantPriceGrid({
  ram,
  storage,
  prices,
  onChange,
}: {
  ram: string[];
  storage: string[];
  prices: Record<string, number>;
  onChange: (prices: Record<string, number>) => void;
}) {
  if (ram.length === 0 || storage.length === 0) return null;

  return (
    <Field label="Price by RAM + Storage (₹) — leave a cell blank to use the base Price above">
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50">
              <th className="p-1.5 text-left font-medium text-gray-500">RAM \ Storage</th>
              {storage.map((s) => (
                <th key={s} className="p-1.5 text-left font-medium text-gray-500">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ram.map((r) => (
              <tr key={r} className="border-t border-gray-100">
                <td className="p-1.5 font-medium text-gray-700">{r}</td>
                {storage.map((s) => {
                  const key = variantKey(r, s);
                  return (
                    <td key={s} className="p-1.5">
                      <input
                        type="number"
                        className="input w-24 !py-1 text-xs"
                        placeholder="—"
                        value={prices[key] || ""}
                        onChange={(e) =>
                          onChange({ ...prices, [key]: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Field>
  );
}

/** Chip-style input for entering several values (e.g. "8GB", "16GB", "32GB") for one field. */
function TagInput({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  }

  return (
    <Field label={label}>
      <div className="input flex w-full flex-wrap items-center gap-1.5 !h-auto min-h-[38px] py-1.5">
        {values.map((v, i) => (
          <span
            key={v}
            className="flex items-center gap-1 rounded-full bg-brand-primary/10 px-2 py-0.5 text-xs text-brand-primary"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              className="text-brand-primary/70 hover:text-brand-primary"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="min-w-[70px] flex-1 border-0 p-0 text-sm outline-none focus:ring-0"
          placeholder={values.length === 0 ? placeholder : ""}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitDraft();
            } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={commitDraft}
        />
      </div>
    </Field>
  );
}

/** Number input with +/- buttons for adjusting a quantity like stock. */
function QuantityStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="btn-secondary flex size-9 shrink-0 items-center justify-center !p-0 text-lg"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label="Decrease quantity"
        >
          −
        </button>
        <input
          type="number"
          className="input w-full text-center"
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        />
        <button
          type="button"
          className="btn-secondary flex size-9 shrink-0 items-center justify-center !p-0 text-lg"
          onClick={() => onChange(value + 1)}
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
    </Field>
  );
}

/** Text field + button for adding one more image by URL, appended to the gallery above. */
function AddImageUrlField({ onAdd }: { onAdd: (url: string) => void }) {
  const [draft, setDraft] = useState("");

  function commit() {
    if (draft.trim()) {
      onAdd(draft);
      setDraft("");
    }
  }

  return (
    <details className="text-xs text-gray-500">
      <summary className="cursor-pointer select-none">Or add an image by URL instead</summary>
      <div className="mt-1.5 flex gap-1.5">
        <input
          className="input flex-1"
          placeholder="https://..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={commit}>
          Add
        </button>
      </div>
    </details>
  );
}

type SortKey = "name" | "price_desc" | "stock_asc" | "stock_desc" | "category";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name (A-Z)" },
  { key: "category", label: "Category" },
  { key: "price_desc", label: "Price (High-Low)" },
  { key: "stock_asc", label: "Stock (Low-High)" },
  { key: "stock_desc", label: "Stock (High-Low)" },
];

// The scanner <div> only exists once its "active" state has rendered, and Html5Qrcode
// throws (a plain string, not an Error) when its element is missing — so wait for it.
async function waitForElement(id: string) {
  for (let i = 0; i < 30 && !document.getElementById(id); i++) {
    await new Promise((r) => setTimeout(r, 30));
  }
}

// Html5Qrcode rejects with strings / DOMExceptions, so err.message is often empty.
function cameraErrorMessage(err: unknown): string {
  const text = typeof err === "string" ? err : (err as { name?: string; message?: string })?.name ?? "";
  const msg = typeof err === "string" ? err : (err as { message?: string })?.message ?? "";
  if (/NotAllowed|Permission/i.test(text + msg)) return "Camera permission is blocked. Tap the lock icon next to the address bar, set Camera to Allow, then reload and try again.";
  if (/NotFound|Requested device not found/i.test(text + msg)) return "No camera was found on this device.";
  if (/NotReadable|in use/i.test(text + msg)) return "The camera is being used by another app. Close it and try again.";
  if (!window.isSecureContext) return "The camera only works on a secure (https) page.";
  return msg || text || "Could not start the camera.";
}

export function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [category, setCategory] = useState<string>("All");
  const [brandFilter, setBrandFilter] = useState<string>("All");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  // Products filled in and waiting; "Save" adds these plus whatever is in the form.
  const [queue, setQueue] = useState<(typeof emptyForm)[]>([]);
  // Invoice import (e-invoice QR summary + item-by-item entry); summary null = opened without a QR.
  const [invoiceImport, setInvoiceImport] = useState<{ summary: EInvoiceSummary | null } | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingCell, setEditingCell] = useState<{ id: string; field: "price" | "stock" } | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // "Manage Serials" modal — add/view per-unit IMEI/serial numbers for a
  // product, and (if not already serialized) turn serial tracking on.
  // Supports all three intake methods from the spec: Manual Entry (Method C),
  // Excel/CSV Import (Method B), and camera Scan (Method A).
  const [serialsModalFor, setSerialsModalFor] = useState<InventoryItem | null>(null);
  const [serialsModalUnits, setSerialsModalUnits] = useState<InventoryUnit[]>([]);
  const [serialsModalLoading, setSerialsModalLoading] = useState(false);
  const [serialsModalError, setSerialsModalError] = useState<string | null>(null);
  const [serialsMethod, setSerialsMethod] = useState<"manual" | "excel" | "scan">("manual");
  const [expectedQty, setExpectedQty] = useState<number | "">("");
  // Manual entry — one row per physical stock unit (IMEI 1, IMEI 2, Serial).
  const [manualRows, setManualRows] = useState<{ imei_1: string; imei_2: string; serial_no: string }[]>([
    { imei_1: "", imei_2: "", serial_no: "" },
  ]);
  // Excel import — parsed + validated rows awaiting user confirmation.
  const [excelPreview, setExcelPreview] = useState<
    | null
    | {
        rows: { row: number; imei_1: string; imei_2: string; serial_no: string; errors: string[] }[];
        valid: number;
        invalid: number;
        duplicate: number;
      }
  >(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  // Scan mode — live camera decode.
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanActive, setScanActive] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [scannedPending, setScannedPending] = useState<{ imei_1: string; imei_2: string; serial_no: string }[]>([]);

  // Product/Invoice QR scan (distinct from the IMEI/serial scanner above) —
  // reads whatever a supplier's carton or invoice QR encodes and tries to
  // pre-fill Name + match an existing Brand, since suppliers rarely encode
  // a brand_id our DB would recognize directly.
  const invoiceScannerRef = useRef<Html5Qrcode | null>(null);
  const [invoiceScanActive, setInvoiceScanActive] = useState(false);
  const [invoiceScanFeedback, setInvoiceScanFeedback] = useState<string | null>(null);

  async function handleImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);

    try {
      // Upload one at a time and append as each finishes, so a single bad
      // file doesn't lose the URLs already uploaded before it.
      for (const file of Array.from(files)) {
        try {
          const publicUrl = await uploadProductImage(file);
          if (editingItem) {
            setEditingItem((prev) => (prev ? { ...prev, images: [...(prev.images ?? []), publicUrl] } : prev));
          } else {
            setForm((prev) => ({ ...prev, images: [...prev.images, publicUrl] }));
          }
        } catch (err: any) {
          setError(err?.message || `Failed to upload ${file.name}.`);
        }
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeImage(index: number) {
    if (editingItem) {
      setEditingItem((prev) =>
        prev ? { ...prev, images: (prev.images ?? []).filter((_, i) => i !== index) } : prev
      );
    } else {
      setForm((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }));
    }
  }

  function addImageUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (editingItem) {
      setEditingItem((prev) => (prev ? { ...prev, images: [...(prev.images ?? []), trimmed] } : prev));
    } else {
      setForm((prev) => ({ ...prev, images: [...prev.images, trimmed] }));
    }
  }

  useEffect(() => {
    load();
    loadBrands();
    const channel = supabase
      .channel("inventory-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("inventory").select("*").order("name");
    setItems((data as InventoryItem[]) ?? []);
  }

  async function loadBrands() {
    // All brands (not just active) so the filter/report still resolves a
    // name for products tagged with a brand that was since deactivated.
    const { data } = await supabase.from("brands").select("id, name, is_active").order("name");
    setBrands((data as Brand[]) ?? []);
  }

  function brandName(id: string | null) {
    return brands.find((b) => b.id === id)?.name ?? "-";
  }

  // Splits a textarea of plain serials (one per line, or comma-separated).
  // Used only for the Add-Product form's initial stock entry, where dual
  // IMEI isn't collected inline — the Manage Serials modal has richer input.
  function parseSerials(text: string): string[] {
    const seen = new Set<string>();
    for (const raw of text.split(/[\n,]/)) {
      const s = raw.trim();
      if (s) seen.add(s);
    }
    return Array.from(seen);
  }

  async function openSerialsModal(item: InventoryItem) {
    setSerialsModalError(null);
    setSerialsMethod("manual");
    setExpectedQty("");
    setManualRows([{ imei_1: "", imei_2: "", serial_no: "" }]);
    setExcelPreview(null);
    setScannedPending([]);
    setScanFeedback(null);
    await stopScanner();
    setSerialsModalFor(item);
    setSerialsModalLoading(true);
    const { data } = await supabase
      .from("inventory_units")
      .select("*")
      .eq("inventory_id", item.id)
      .order("created_at", { ascending: false });
    setSerialsModalUnits((data as InventoryUnit[]) ?? []);
    setSerialsModalLoading(false);
  }

  async function closeSerialsModal() {
    await stopScanner();
    setSerialsModalFor(null);
  }

  async function closeAddOrEditForm() {
    await stopScanner();
    await stopInvoiceScanner();
    setScanFeedback(null);
    setInvoiceScanFeedback(null);
    if (editingItem) setEditingItem(null);
    else setShowAddForm(false);
    setQueue([]);
  }

  // Cross-column duplicate check against ALL existing units in this shop's
  // inventory (not just the current product), so a phone imported earlier
  // as a different product's stock still trips the "already exists" guard.
  async function findExistingImeiOwner(imei: string): Promise<{ inventory_id: string; unit_id: string; imei_field: "imei_1" | "imei_2" } | null> {
    const { data: as1 } = await supabase.from("inventory_units").select("id, inventory_id").eq("imei_1", imei).limit(1).maybeSingle();
    if (as1) return { inventory_id: as1.inventory_id, unit_id: as1.id, imei_field: "imei_1" };
    const { data: as2 } = await supabase.from("inventory_units").select("id, inventory_id").eq("imei_2", imei).limit(1).maybeSingle();
    if (as2) return { inventory_id: as2.inventory_id, unit_id: as2.id, imei_field: "imei_2" };
    return null;
  }

  // Validates one row for the current draft (Manual/Scan/Excel). Errors
  // include Luhn/format issues (skipped when the field is blank because
  // serial-only is valid), duplicates within the current draft, and
  // duplicates against any existing unit anywhere in inventory.
  async function validateDraftRow(
    row: { imei_1: string; imei_2: string; serial_no: string },
    seenInDraft: Set<string>
  ): Promise<string[]> {
    const errors: string[] = [];
    const imei1 = normalizeImei(row.imei_1);
    const imei2 = normalizeImei(row.imei_2);
    const serial = row.serial_no.trim();

    if (!imei1 && !imei2 && !serial) {
      errors.push("Enter IMEI 1, IMEI 2 or Serial No.");
      return errors;
    }

    if (imei1 && imei2 && imei1 === imei2) errors.push("IMEI 1 and IMEI 2 cannot be the same.");

    for (const [label, value] of [["IMEI 1", row.imei_1], ["IMEI 2", row.imei_2]] as const) {
      if (!value.trim()) continue;
      const res = validateImei(value);
      if (!res.ok) errors.push(`${label}: ${res.message}`);
    }

    for (const val of [imei1, imei2].filter(Boolean)) {
      if (seenInDraft.has(val)) errors.push(`Duplicate IMEI ${val} in this draft.`);
      else seenInDraft.add(val);
    }

    for (const val of [imei1, imei2].filter(Boolean)) {
      const owner = await findExistingImeiOwner(val);
      if (owner) errors.push(`IMEI ${val} already exists.`);
    }

    return errors;
  }

  // Turns the Manual Entry rows (or scan/excel-produced rows) into actual
  // inventory_units + imei_history rows. Runs full pre-flight validation so
  // partial writes never happen — the transactionality here is "validate
  // everything first, then insert everything, then bail on any error".
  async function commitDraftRows(rows: { imei_1: string; imei_2: string; serial_no: string }[]) {
    if (!serialsModalFor) return;
    setSerialsModalError(null);
    if (rows.length === 0) {
      setSerialsModalError("Nothing to add.");
      return;
    }

    setSerialsModalLoading(true);
    try {
      const seen = new Set<string>();
      const preflight: { row: number; errors: string[] }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const errs = await validateDraftRow(rows[i], seen);
        if (errs.length) preflight.push({ row: i + 1, errors: errs });
      }
      if (preflight.length) {
        setSerialsModalError(
          preflight.slice(0, 3).map((p) => `Row ${p.row}: ${p.errors.join(" / ")}`).join("\n") +
            (preflight.length > 3 ? `\n(+${preflight.length - 3} more errors — fix and retry)` : "")
        );
        return;
      }

      // Enable serial tracking on first use of this modal for a product.
      if (!serialsModalFor.is_serialized) {
        const { error: toggleErr } = await supabase
          .from("inventory")
          .update({ is_serialized: true })
          .eq("id", serialsModalFor.id);
        if (toggleErr) throw toggleErr;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;

      // Insert unit rows with client-generated ids so we can immediately
      // write matching imei_history 'purchase' + 'in_stock' events without
      // a second round-trip to look up the ids.
      const toInsert = rows.map((r) => ({
        id: crypto.randomUUID(),
        inventory_id: serialsModalFor.id,
        imei_1: normalizeImei(r.imei_1) || null,
        imei_2: normalizeImei(r.imei_2) || null,
        serial_no: r.serial_no.trim() || null,
        status: "in_stock" as const,
        created_by: userId,
        updated_by: userId,
      }));

      const { error: unitsErr } = await supabase.from("inventory_units").insert(toInsert);
      if (unitsErr) throw unitsErr;

      // History: one 'purchase' event per unit, matching spec §8 lifecycle.
      const historyRows = toInsert.map((u) => ({
        stock_unit_id: u.id,
        imei_1: u.imei_1,
        imei_2: u.imei_2,
        event_type: "purchase" as const,
        to_status: "in_stock",
        created_by: userId,
      }));
      const { error: histErr } = await supabase.from("imei_history").insert(historyRows);
      if (histErr) throw histErr;

      // Reset the draft for the next batch.
      setManualRows([{ imei_1: "", imei_2: "", serial_no: "" }]);
      setExcelPreview(null);
      setScannedPending([]);
      await openSerialsModal({ ...serialsModalFor, is_serialized: true });
      await load();
    } catch (err: any) {
      setSerialsModalError(err?.message || "Failed to save — a serial may already be in use.");
    } finally {
      setSerialsModalLoading(false);
    }
  }

  async function deleteUnit(unit: InventoryUnit) {
    const label = unit.imei_1 ?? unit.imei_2 ?? unit.serial_no ?? unit.id;
    if (!confirm(`Remove ${label} from stock? Only do this if it was entered by mistake.`)) return;
    await supabase.from("inventory_units").delete().eq("id", unit.id);
    if (serialsModalFor) await openSerialsModal(serialsModalFor);
    await load();
  }

  // ── Excel/CSV Import (Method B) ────────────────────────────────────────
  async function handleExcelFile(file: File | undefined) {
    if (!file || !serialsModalFor) return;
    setSerialsModalError(null);
    setSerialsModalLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      // Skip header row if it looks like one (first cell contains "IMEI" or "Serial").
      let dataRows = raw;
      const first = raw[0]?.map((v) => String(v).toLowerCase()).join(" ") ?? "";
      if (/imei|serial|sr/.test(first)) dataRows = raw.slice(1);

      const seen = new Set<string>();
      const rows: { row: number; imei_1: string; imei_2: string; serial_no: string; errors: string[] }[] = [];
      let valid = 0;
      let duplicate = 0;
      let invalid = 0;
      for (let i = 0; i < dataRows.length; i++) {
        const cols = dataRows[i];
        const imei_1 = String(cols[0] ?? "").trim();
        const imei_2 = String(cols[1] ?? "").trim();
        const serial_no = String(cols[2] ?? "").trim();
        if (!imei_1 && !imei_2 && !serial_no) continue; // blank row → skip
        const errs = await validateDraftRow({ imei_1, imei_2, serial_no }, seen);
        if (errs.length === 0) valid++;
        else if (errs.some((e) => /already exists|Duplicate/.test(e))) duplicate++;
        else invalid++;
        rows.push({ row: i + 1 + (first ? 1 : 0), imei_1, imei_2, serial_no, errors: errs });
      }
      setExcelPreview({ rows, valid, invalid, duplicate });
    } catch (err: any) {
      setSerialsModalError(err?.message || "Could not read that file — is it a valid .xlsx or .csv?");
    } finally {
      setSerialsModalLoading(false);
      if (excelInputRef.current) excelInputRef.current.value = "";
    }
  }

  async function commitExcelImport() {
    if (!excelPreview) return;
    const clean = excelPreview.rows.filter((r) => r.errors.length === 0);
    await commitDraftRows(clean.map((r) => ({ imei_1: r.imei_1, imei_2: r.imei_2, serial_no: r.serial_no })));
  }

  // ── Camera Scan (Method A) ─────────────────────────────────────────────
  async function startScanner() {
    if (scanActive) return;
    setScanFeedback(null);
    setSerialsModalError(null);
    try {
      setScanActive(true);
      await waitForElement("imei-scanner-region");
      const scanner = new Html5Qrcode("imei-scanner-region");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decoded) => onScanDecoded(decoded),
        () => {
          /* per-frame errors are noise, don't surface */
        }
      );
    } catch (err: any) {
      setScanActive(false);
      scannerRef.current = null;
      const message = cameraErrorMessage(err);
      // scanFeedback renders in both the Add-Product form's scan section and
      // the Manage Serials modal's, so the failure is visible regardless of
      // which one is open; serialsModalError additionally surfaces it in the
      // Manage Serials modal's own error banner.
      setScanFeedback(message);
      setSerialsModalError(message);
    }
  }

  async function stopScanner() {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      /* already stopped */
    }
    scannerRef.current = null;
    setScanActive(false);
  }

  async function onScanDecoded(text: string) {
    const normalized = normalizeImei(text);
    const res = validateImei(normalized);
    if (!res.ok) {
      setScanFeedback(res.message ?? "Invalid scan");
      return;
    }

    // Add New Product form: scanning here builds up the plain "one per
    // line" serials textarea directly, so a brand-new serialized product
    // (e.g. a fresh wholesaler carton) can be created and stocked in one
    // pass instead of adding it first and scanning separately afterwards.
    if (showAddForm) {
      const existing = parseSerials(form.serials);
      if (existing.includes(res.normalized)) {
        setScanFeedback(`Already scanned in this batch: ${res.normalized}`);
        return;
      }
      const owner = await findExistingImeiOwner(res.normalized);
      if (owner) {
        setScanFeedback(`IMEI ${res.normalized} already exists.`);
        return;
      }
      setForm((prev) => ({ ...prev, serials: [...parseSerials(prev.serials), res.normalized].join("\n") }));
      setScanFeedback(`Added ${res.normalized}`);
      return;
    }

    // Manage Serials modal (existing product): reject if already in the
    // pending list or existing stock.
    if (scannedPending.some((r) => r.imei_1 === res.normalized || r.imei_2 === res.normalized)) {
      setScanFeedback(`Already scanned in this batch: ${res.normalized}`);
      return;
    }
    const owner = await findExistingImeiOwner(res.normalized);
    if (owner) {
      setScanFeedback(`IMEI ${res.normalized} already exists.`);
      return;
    }
    setScannedPending((prev) => [...prev, { imei_1: res.normalized, imei_2: "", serial_no: "" }]);
    setScanFeedback(`Added ${res.normalized}`);
  }

  async function commitScannedRows() {
    await commitDraftRows(scannedPending);
  }

  // ── Product / Invoice QR Scan ───────────────────────────────────────────
  // Suppliers encode QR payloads in very different shapes: some are the
  // government e-invoice QR (a JSON blob with GSTIN/IRN/invoice fields, no
  // per-item brand or model), others are a supplier's own carton QR (often
  // "key:value" pairs separated by | or ; or newlines). We try structured
  // parsing first, then fall back to matching a known Brand name anywhere
  // in the raw text so the product still lands under the right brand.
  interface ParsedInvoiceQr {
    name?: string;
    model?: string;
    salePrice?: number;
    wholesalePrice?: number;
    brandName?: string;
    ram?: string;
    storage?: string;
    quantity?: number;
    sku?: string;
    wholesalerName?: string;
    wholesalerPhone?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
  }

  function parseInvoiceQrPayload(text: string): ParsedInvoiceQr {
    const trimmed = text.trim();

    // Government e-invoice QR: JSON with Seller GSTIN / IRN / doc fields —
    // no item-level brand/model, so there's nothing product-specific to
    // extract beyond a document reference.
    try {
      const json = JSON.parse(trimmed);
      if (json && typeof json === "object") {
        const name = json.name ?? json.Name ?? json.product ?? json.Product ?? json.itemName ?? undefined;
        const model = json.model ?? json.Model ?? undefined;
        const brandName = json.brand ?? json.Brand ?? undefined;
        // "Rate"/"Price" on a wholesaler's invoice is what the shop paid
        // (wholesale/cost price), not the retail price it'll sell at — only
        // an explicit sale/mrp field counts as the sale price.
        const rawSale = json.salePrice ?? json.SalePrice ?? json.mrp ?? json.Mrp ?? json.MRP ?? undefined;
        const rawWholesale = json.wholesalePrice ?? json.WholesalePrice ?? json.costPrice ?? json.CostPrice ?? json.price ?? json.Price ?? json.rate ?? json.Rate ?? undefined;
        const salePrice = rawSale != null ? Number(rawSale) : undefined;
        const wholesalePrice = rawWholesale != null ? Number(rawWholesale) : undefined;
        const rawQty = json.quantity ?? json.Quantity ?? json.qty ?? json.Qty ?? undefined;
        const quantity = rawQty != null ? Number(rawQty) : undefined;
        return {
          name,
          model,
          brandName,
          salePrice: Number.isFinite(salePrice as number) ? salePrice : undefined,
          wholesalePrice: Number.isFinite(wholesalePrice as number) ? wholesalePrice : undefined,
          ram: json.ram ?? json.RAM ?? json.Ram ?? undefined,
          storage: json.storage ?? json.Storage ?? undefined,
          quantity: Number.isFinite(quantity as number) ? quantity : undefined,
          sku: json.sku ?? json.SKU ?? json.Sku ?? undefined,
          wholesalerName: json.wholesalerName ?? json.WholesalerName ?? json.SellerName ?? json.sellerName ?? undefined,
          wholesalerPhone: json.wholesalerPhone ?? json.WholesalerPhone ?? json.phone ?? json.Phone ?? undefined,
          invoiceNumber: json.invoiceNumber ?? json.InvoiceNumber ?? json.DocNo ?? json.docNo ?? undefined,
          invoiceDate: json.invoiceDate ?? json.InvoiceDate ?? json.DocDt ?? json.docDt ?? undefined,
        };
      }
    } catch {
      /* not JSON — fall through to key:value / plain-text parsing */
    }

    // "Key: value" pairs separated by newlines, |, or ;
    const pairs: Record<string, string> = {};
    for (const part of trimmed.split(/[|;\n]/)) {
      const m = part.match(/^\s*([A-Za-z ]+)\s*[:=]\s*(.+?)\s*$/);
      if (m) pairs[m[1].trim().toLowerCase()] = m[2].trim();
    }
    if (Object.keys(pairs).length > 0) {
      const sale = pairs["sale price"] ?? pairs["saleprice"] ?? pairs.mrp;
      const wholesale = pairs["wholesale price"] ?? pairs["wholesaleprice"] ?? pairs["cost price"] ?? pairs.price ?? pairs.rate;
      const qty = pairs.quantity ?? pairs.qty;
      return {
        name: pairs.name ?? pairs.product ?? pairs.item,
        model: pairs.model,
        brandName: pairs.brand,
        salePrice: sale ? Number(sale.replace(/[^\d.]/g, "")) : undefined,
        wholesalePrice: wholesale ? Number(wholesale.replace(/[^\d.]/g, "")) : undefined,
        ram: pairs.ram,
        storage: pairs.storage,
        quantity: qty ? Number(qty.replace(/[^\d.]/g, "")) : undefined,
        sku: pairs.sku,
        wholesalerName: pairs["wholesaler name"] ?? pairs["wholesaler"] ?? pairs["supplier"] ?? pairs["seller"],
        wholesalerPhone: pairs["wholesaler phone"] ?? pairs["phone"] ?? pairs["mobile"],
        invoiceNumber: pairs["invoice number"] ?? pairs["invoice no"] ?? pairs["invoice"],
        invoiceDate: pairs["invoice date"] ?? pairs["date"],
      };
    }

    // Plain text fallback — use the raw scan as the product name.
    return { name: trimmed };
  }

  /** Best-effort — a scan without a parseable date should never block the rest of the auto-fill. */
  function normalizeScannedDate(raw: string | undefined): string | null {
    if (!raw) return null;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    // DD/MM/YYYY or DD-MM-YYYY, common on Indian invoices
    const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }

  async function recordWholesalerInvoiceFromScan(parsed: ParsedInvoiceQr, product: { name: string; qty: number; unitCost: number }) {
    if (!parsed.wholesalerName) return;
    const totalAmount = product.unitCost * product.qty;
    const { error: invErr } = await supabase.from("wholesaler_invoices").insert({
      wholesaler_name: parsed.wholesalerName,
      wholesaler_phone: parsed.wholesalerPhone || null,
      invoice_number: parsed.invoiceNumber || null,
      items: [{ name: product.name, qty: product.qty, total_price: totalAmount }],
      total_amount: totalAmount,
      paid_amount: 0,
      due_amount: totalAmount,
      payment_status: "pending",
      invoice_date: normalizeScannedDate(parsed.invoiceDate) || new Date().toISOString().slice(0, 10),
      notes: "Auto-added from Add New Product QR scan",
    });
    if (invErr) {
      console.error("[inventory] failed to auto-add wholesaler invoice from scan:", invErr.message);
    }
  }

  async function startInvoiceScanner() {
    if (invoiceScanActive) return;
    setInvoiceScanFeedback(null);
    try {
      setInvoiceScanActive(true);
      await waitForElement("invoice-scanner-region");
      // Government e-invoice QRs are very dense: scan the whole frame at high resolution and use the
      // phone's built-in barcode detector where available (the JS decoder alone often fails on them).
      const scanner = new Html5Qrcode("invoice-scanner-region", { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], useBarCodeDetectorIfSupported: true, verbose: false });
      invoiceScannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 8,
          qrbox: (w: number, h: number) => ({ width: Math.floor(Math.min(w, h) * 0.95), height: Math.floor(Math.min(w, h) * 0.95) }),
          videoConstraints: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: "continuous" } as MediaTrackConstraints,
        },
        (decoded) => onInvoiceScanDecoded(decoded),
        () => {
          /* per-frame errors are noise, don't surface */
        }
      );
    } catch (err: any) {
      setInvoiceScanActive(false);
      invoiceScannerRef.current = null;
      setInvoiceScanFeedback(cameraErrorMessage(err));
    }
  }

  async function stopInvoiceScanner() {
    const scanner = invoiceScannerRef.current;
    if (!scanner) return;
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      /* already stopped */
    }
    invoiceScannerRef.current = null;
    setInvoiceScanActive(false);
  }

  async function onInvoiceScanDecoded(text: string) {
    await stopInvoiceScanner();

    // Government e-invoice QR: only a summary (no item list) — hand over to the item-by-item import.
    const einvoice = decodeEInvoiceQr(text);
    if (einvoice) {
      setInvoiceImport({ summary: einvoice });
      setInvoiceScanFeedback(null);
      return;
    }
    const parsed = parseInvoiceQrPayload(text);

    // If this exact product is already in inventory, don't offer to create
    // a duplicate — point the user at restocking the existing one instead
    // (via Manage Serials / the stock number on the row) rather than
    // silently filling the New Product form on top of it.
    const nameKey = parsed.name?.trim().toLowerCase();
    const modelKey = parsed.model?.trim().toLowerCase();
    const existing = items.find((i) => {
      const sameModel = modelKey && i.model.trim().toLowerCase() === modelKey;
      const sameName = nameKey && i.name.trim().toLowerCase() === nameKey;
      return sameModel || sameName;
    });
    const qty = parsed.quantity && parsed.quantity > 0 ? parsed.quantity : 1;

    if (existing) {
      // Still worth logging the purchase even though the product itself
      // already exists — this is a restock, not a new-product scan.
      if (parsed.wholesalerName) {
        await recordWholesalerInvoiceFromScan(parsed, {
          name: existing.name,
          qty,
          unitCost: parsed.wholesalePrice ?? 0,
        });
      }
      setInvoiceScanFeedback(
        `"${existing.name}" already exists in inventory — add stock to it instead of creating a duplicate.` +
          (parsed.wholesalerName ? " A Wholesaler Invoice was logged for this restock." : "")
      );
      return;
    }

    const matchedBrand = parsed.brandName
      ? brands.find((b) => b.name.toLowerCase() === parsed.brandName!.toLowerCase())
      : brands.find((b) => parsed.name?.toLowerCase().includes(b.name.toLowerCase()) || text.toLowerCase().includes(b.name.toLowerCase()));

    setForm((prev) => ({
      ...prev,
      name: parsed.name ?? prev.name,
      model: parsed.model ?? prev.model,
      price: parsed.salePrice ?? prev.price,
      cost_price: parsed.wholesalePrice ?? prev.cost_price,
      brand_id: matchedBrand?.id ?? prev.brand_id,
      stock: parsed.quantity ?? prev.stock,
      ram: parsed.ram && !prev.ram.includes(parsed.ram) ? [...prev.ram, parsed.ram] : prev.ram,
      storage: parsed.storage && !prev.storage.includes(parsed.storage) ? [...prev.storage, parsed.storage] : prev.storage,
    }));

    if (parsed.wholesalerName) {
      await recordWholesalerInvoiceFromScan(parsed, {
        name: parsed.name ?? "Scanned product",
        qty,
        unitCost: parsed.wholesalePrice ?? 0,
      });
    }

    setInvoiceScanFeedback(
      (matchedBrand ? `New product — added under brand "${matchedBrand.name}". ` : "New product — no matching brand found, please pick one. ") +
        "Sale Price, Wholesale Price, RAM/Storage and Quantity were filled in below where the scan had them — please confirm before saving." +
        (parsed.wholesalerName ? " A Wholesaler Invoice was also logged from this scan." : "")
    );
  }

  // Put the filled-in form on the waiting list and give a fresh form for the next product.
  function queueAnother(copyDetails = false) {
    if (!form.name.trim() || !form.model.trim()) {
      setError("Product name and model are required before adding another product.");
      return;
    }
    setError(null);
    setQueue((q) => [...q, form]);
    // "Copy details" keeps brand, category, RAM/storage/colour, prices etc. so a variant only needs what differs.
    setForm(copyDetails ? { ...form, serials: "" } : emptyForm);
    document.getElementById("add-product-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function queueSummary(q: typeof emptyForm) {
    const bits = [q.model && q.model !== q.name ? q.model : "", q.ram.join("/"), q.storage.join("/"), q.color.join("/"), q.stock ? `${q.stock} pcs` : ""].filter(Boolean);
    return bits.join(" · ");
  }

  // Pull a waiting product back into the form to change it (whatever is in the form joins the list).
  function editQueued(i: number) {
    const picked = queue[i];
    setQueue((all) => {
      const rest = all.filter((_, j) => j !== i);
      return form.name.trim() || form.model.trim() ? [...rest, form] : rest;
    });
    setForm(picked);
    document.getElementById("add-product-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function insertProduct(f: typeof emptyForm, actorName: string) {
    const serials = f.is_serialized ? parseSerials(f.serials) : [];

    const { data: inserted, error: insertErr } = await supabase
      .from("inventory")
      .insert({
        name: f.name.trim(),
        model: f.model.trim(),
        category: f.category,
        brand_id: f.brand_id || null,
        product_type: f.product_type,
        price: minVariantPrice(f.variant_prices) ?? (Number(f.price) || 0),
        original_price: Number(f.original_price) || null,
        // Serialized items derive stock from inventory_units (via trigger)
        // — 0 here is just the starting point until serials are inserted below.
        stock: f.is_serialized ? 0 : Number(f.stock) || 0,
        condition: f.product_type === "refurbished" ? f.condition || null : null,
        grade: f.product_type === "refurbished" ? f.grade || null : null,
        battery_health: f.product_type === "refurbished" ? Number(f.battery_health) || null : null,
        warranty_months: Number(f.warranty_months) || 0,
        is_featured: f.is_featured,
        images: f.images,
        is_active: true,
        cost_price: Number(f.cost_price) || null,
        is_serialized: f.is_serialized,
        specs: buildSpecs(f.ram, f.storage, f.color, f.variant_prices),
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    if (serials.length > 0) {
      const { error: unitsErr } = await supabase.from("inventory_units").insert(
        serials.map((serial_no) => ({ inventory_id: inserted.id, serial_no }))
      );
      if (unitsErr) throw unitsErr;
    }

    // Best-effort — the admin bell should reflect this, but a failed
    // notification insert must never fail the product add itself.
    await supabase.from("notifications").insert({
      for_admin: true,
      type: "product_added",
      title: "New Product Added",
      body: `${f.name.trim()} added by ${actorName}.`,
      related_id: inserted.id,
      link: "/inventory",
    });
  }

  async function addItem() {
    const currentFilled = !!(form.name.trim() || form.model.trim());
    if (currentFilled && (!form.name.trim() || !form.model.trim())) {
      setError("Product name and model are required.");
      return;
    }
    if (!currentFilled && queue.length === 0) {
      setError("Product name and model are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      console.info("[inventory] session before insert:", { hasSession: !!session, userId: session?.user?.id });
      if (!session) {
        setError("Your admin session has expired. Please sign out and sign in again, then retry.");
        setSaving(false);
        return;
      }

      const actorName = session.user.email?.split("@")[0] ?? "Admin";
      const toSave = [...queue, ...(currentFilled ? [form] : [])];
      let saved = 0;
      try {
        for (const f of toSave) {
          await insertProduct(f, actorName);
          saved++;
        }
      } catch (err: any) {
        // Keep what did not save so nothing typed is lost; drop what did.
        const failed = toSave[saved];
        const remaining = toSave.slice(saved);
        setQueue(remaining.slice(0, Math.max(0, remaining.length - (currentFilled ? 1 : 0))));
        if (currentFilled) setForm(remaining[remaining.length - 1]);
        else if (remaining.length) { setQueue(remaining.slice(1)); setForm(remaining[0]); }
        setError(`"${failed.name.trim()}" could not be saved${saved ? ` (${saved} saved before it)` : ""}: ${err?.message || "unknown error"}`);
        if (saved) await load();
        return;
      }

      setQueue([]);
      setForm(emptyForm);
      setShowAddForm(false);
      await stopScanner();
      setSuccess(toSave.length > 1 ? `${toSave.length} products added successfully!` : "Item added successfully!");
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to add item.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEditedItem() {
    if (!editingItem || !editingItem.name.trim()) {
      setError("Product name is required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { error: updateErr } = await supabase
        .from("inventory")
        .update({
          name: editingItem.name.trim(),
          model: editingItem.model.trim(),
          category: editingItem.category,
          brand_id: editingItem.brand_id || null,
          product_type: editingItem.product_type,
          price:
            minVariantPrice(specsVariantPrices(editingItem.specs)) ?? (Number(editingItem.price) || 0),
          original_price: Number(editingItem.original_price) || null,
          condition: editingItem.product_type === "refurbished" ? editingItem.condition || null : null,
          grade: editingItem.product_type === "refurbished" ? editingItem.grade || null : null,
          battery_health: editingItem.product_type === "refurbished" ? editingItem.battery_health || null : null,
          warranty_months: Number(editingItem.warranty_months) || 0,
          is_featured: editingItem.is_featured,
          images: editingItem.images ?? [],
          is_active: editingItem.is_active,
          cost_price: editingItem.cost_price == null ? null : Number(editingItem.cost_price),
          // Serialized items derive stock from inventory_units (via trigger) — leave it untouched here.
          ...(editingItem.is_serialized ? {} : { stock: Number(editingItem.stock) || 0 }),
          specs: buildSpecs(
            specsArray(editingItem.specs, "ram"),
            specsArray(editingItem.specs, "storage"),
            specsArray(editingItem.specs, "color"),
            specsVariantPrices(editingItem.specs)
          ),
        })
        .eq("id", editingItem.id);

      if (updateErr) throw updateErr;

      setEditingItem(null);
      setSuccess("Item updated successfully!");
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to update item.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(p: InventoryItem) {
    if (!confirm(`Are you sure you want to delete or deactivate "${p.name}"? A deleted product can be restored from the Recycle Bin.`)) return;

    try {
      const { error: delErr } = await softDelete(supabase, "inventory", p.id, p.name);
      if (delErr) {
        // Likely referenced by a sale/order — deactivate instead of a hard delete.
        await supabase.from("inventory").update({ is_active: false }).eq("id", p.id);
      }
      setSuccess(`"${p.name}" updated.`);
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (err: any) {
      alert(err?.message || "Failed to delete item.");
    }
  }

  async function updateField(id: string, field: "price" | "stock", value: number) {
    await supabase.from("inventory").update({ [field]: value }).eq("id", id);
    setEditingCell(null);
    load();
  }

  const filtered = items
    .filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (brandFilter !== "All" && (p.brand_id ?? "") !== brandFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.model?.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortKey === "price_desc") return b.price - a.price;
      if (sortKey === "stock_asc") return a.stock - b.stock;
      if (sortKey === "stock_desc") return b.stock - a.stock;
      if (sortKey === "category") {
        const catCompare = (a.category ?? "").localeCompare(b.category ?? "");
        return catCompare !== 0 ? catCompare : a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

  // Render the table in slices: mounting all ~450 rows (each with an image and several buttons)
  // took ~0.5s on every visit even when the data was already in memory. Exports/print still use
  // the full `filtered` list.
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [category, brandFilter, search, sortKey]);
  const moreRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisibleCount((n) => n + PAGE_SIZE);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, filtered.length]);

  function productRowHtml(p: InventoryItem) {
    return `<tr>
          <td>${p.name} ${p.model}</td>
          <td>${p.category ?? "-"}</td>
          <td>${brandName(p.brand_id)}</td>
          <td style="text-align:right">${formatCurrency(p.price)}</td>
          <td style="text-align:right">${p.stock}</td>
          <td style="text-align:right">${formatCurrency(p.price * p.stock)}</td>
        </tr>`;
  }

  function printReport() {
    const totalValue = filtered.reduce((s, p) => s + p.price * p.stock, 0);

    // Category-wise report: when the "All Categories" filter is active and
    // the report is sorted by Category, group products under a heading +
    // subtotal per category instead of one flat list — this is what makes
    // it an actual category-wise report rather than just a category-name
    // column. Selecting a single category from the filter above still just
    // prints that one category's flat list (grouping one group is
    // pointless), and any other sort mode also stays flat.
    const groupByCategory = category === "All" && sortKey === "category";

    let bodyHtml: string;
    if (groupByCategory) {
      const groups: { category: string; items: InventoryItem[] }[] = [];
      for (const p of filtered) {
        const cat = p.category ?? "Uncategorized";
        const last = groups[groups.length - 1];
        if (last && last.category === cat) last.items.push(p);
        else groups.push({ category: cat, items: [p] });
      }
      bodyHtml = groups
        .map((g) => {
          const groupValue = g.items.reduce((s, p) => s + p.price * p.stock, 0);
          return `<tr class="cat-header"><td colspan="6">${g.category} (${g.items.length} item${g.items.length === 1 ? "" : "s"})</td></tr>
            ${g.items.map(productRowHtml).join("")}
            <tr class="cat-subtotal"><td colspan="5">Subtotal — ${g.category}</td><td style="text-align:right">${formatCurrency(groupValue)}</td></tr>`;
        })
        .join("");
    } else {
      bodyHtml = filtered.map(productRowHtml).join("");
    }

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Inventory Report</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#1f2937}
        h1{font-size:18px;margin-bottom:2px}
        p{color:#6b7280;font-size:12px;margin-top:0}
        table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
        th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left}
        th{background:#f8f9fa}
        tfoot td{font-weight:bold}
        tr.cat-header td{background:#eef1f6;font-weight:bold;border-top:2px solid #c7cede}
        tr.cat-subtotal td{background:#f8f9fa;font-style:italic;color:#4b5563}
      </style></head><body>
      <h1>Inventory Report${groupByCategory ? " — Category-wise" : ""}</h1>
      <p>Category: ${category} · Brand: ${brandFilter === "All" ? "All" : brandName(brandFilter)} · Sorted by: ${SORT_OPTIONS.find((s) => s.key === sortKey)?.label}</p>
      <table>
        <thead><tr><th>Product</th><th>Category</th><th>Brand</th><th style="text-align:right">Sale Price</th><th style="text-align:right">Stock</th><th style="text-align:right">Value</th></tr></thead>
        <tbody>${bodyHtml}</tbody>
        <tfoot><tr><td colspan="5">Total Stock Value</td><td style="text-align:right">${formatCurrency(totalValue)}</td></tr></tfoot>
      </table>
      <script>window.onload = () => window.print();</script>
      </body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Inventory Catalog</h1>
        <div className="flex flex-wrap gap-2">
          <ExportExcelButton
            rows={filtered.map((p) => ({
              Name: p.name,
              Model: p.model,
              Category: p.category,
              Brand: brandName(p.brand_id),
              Type: p.product_type,
              "Sale Price": p.price,
              "Original Price": p.original_price,
              "Wholesale Price": p.cost_price,
              Stock: p.stock,
              "Stock Value": p.price * p.stock,
              Active: p.is_active ? "Yes" : "No",
            }))}
            fileName="inventory"
          />
          <button className="btn-secondary flex items-center gap-1.5" onClick={printReport} title="Print / save the current report view as PDF">
            <Printer size={14} /> Print Report
          </button>
          <button
            className="btn-primary flex items-center gap-1.5"
            onClick={() => {
              setError(null);
              setShowAddForm(true);
            }}
          >
            <Plus size={15} /> Add Product
          </button>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 border border-emerald-200">
          <Check size={16} />
          <span>{success}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          placeholder="Search name or model..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary sm:w-72"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
        >
          <option value="All">All Categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
        >
          <option value="All">All Brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-14"></th>
              <th>Name</th>
              <th>Category</th>
              <th>Brand</th>
              <th>Type</th>
              <th className="text-right">Sale Price</th>
              <th className="text-right">Stock</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, visibleCount).map((p) => {
              const low = p.stock <= 5;
              return (
                <tr key={p.id} className={low ? "bg-red-50/60" : !p.is_active ? "opacity-50" : ""}>
                  <td>
                    {p.images?.[0] ? (
                      <img
                        src={p.images[0]}
                        alt={p.name}
                        loading="lazy"
                        className="h-10 w-10 rounded object-cover"
                        onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-gray-100" />
                    )}
                  </td>
                  <td className="font-medium text-gray-800">
                    {p.name}
                    <div className="text-xs font-normal text-gray-400">{p.model}</div>
                    {!p.is_active && <span className="ml-2 text-xs text-gray-400">(Inactive)</span>}
                    {p.is_featured && <span className="ml-1 text-xs text-amber-600">★</span>}
                  </td>
                  <td>{p.category}</td>
                  <td className="text-gray-500">{brandName(p.brand_id)}</td>
                  <td className="text-gray-500 capitalize">{p.product_type}</td>
                  <td
                    className="cursor-pointer text-right"
                    onClick={() => setEditingCell({ id: p.id, field: "price" })}
                    title="Click to edit price"
                  >
                    {editingCell?.id === p.id && editingCell.field === "price" ? (
                      <input
                        autoFocus
                        type="number"
                        defaultValue={p.price}
                        className="w-24 rounded border border-brand-primary px-1 py-0.5 text-right text-sm"
                        onBlur={(e) => updateField(p.id, "price", Number(e.target.value))}
                        onKeyDown={(e) => e.key === "Enter" && updateField(p.id, "price", Number((e.target as HTMLInputElement).value))}
                      />
                    ) : (
                      <span className="underline decoration-dotted decoration-gray-300 font-medium">
                        {formatCurrency(p.price)}
                      </span>
                    )}
                  </td>
                  {p.is_serialized ? (
                    <td
                      className={`cursor-pointer text-right font-medium ${low ? "text-brand-danger font-bold" : ""}`}
                      onClick={() => openSerialsModal(p)}
                      title="Managed by serial number — click to view/add serials"
                    >
                      <span className="underline decoration-dotted decoration-gray-300">{p.stock}</span>
                      <span className="ml-1 text-[10px] font-normal text-gray-400">(by serial)</span>
                    </td>
                  ) : (
                    <td
                      className={`cursor-pointer text-right font-medium ${low ? "text-brand-danger font-bold" : ""}`}
                      onClick={() => setEditingCell({ id: p.id, field: "stock" })}
                      title="Click to adjust stock"
                    >
                      {editingCell?.id === p.id && editingCell.field === "stock" ? (
                        <input
                          autoFocus
                          type="number"
                          defaultValue={p.stock}
                          className="w-16 rounded border border-brand-primary px-1 py-0.5 text-right text-sm"
                          onBlur={(e) => updateField(p.id, "stock", Number(e.target.value))}
                          onKeyDown={(e) => e.key === "Enter" && updateField(p.id, "stock", Number((e.target as HTMLInputElement).value))}
                        />
                      ) : (
                        <span className="underline decoration-dotted decoration-gray-300">{p.stock}</span>
                      )}
                    </td>
                  )}
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="btn-secondary !px-2 !py-1 text-xs"
                        onClick={() => openSerialsModal(p)}
                        title={p.is_serialized ? "View/add serial numbers" : "Track this product by serial number / IMEI"}
                      >
                        <Hash size={13} />
                      </button>
                      <button
                        className="btn-secondary !px-2 !py-1 text-xs"
                        onClick={() => {
                          setError(null);
                          setEditingItem(p);
                        }}
                        title="Edit"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        className="btn-ghost !px-2 !py-1 text-xs text-brand-danger hover:bg-red-50"
                        onClick={() => deleteItem(p)}
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length > visibleCount && (
              <tr ref={moreRef}>
                <td colSpan={8} className="py-3 text-center text-xs text-gray-400">
                  Showing {visibleCount} of {filtered.length} - loading more as you scroll…
                </td>
              </tr>
            )}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-400">
                  No items found. Click &ldquo;Add Product&rdquo; to add items to your catalog.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {invoiceImport && (
        <InvoiceImportModal
          summary={invoiceImport.summary}
          existing={items}
          onClose={() => setInvoiceImport(null)}
          onDone={() => load()}
        />
      )}

      {(showAddForm || editingItem) && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="mb-4 flex shrink-0 items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-gray-800">{editingItem ? "Edit Product" : "Add New Product"}</h2>
              <button
                onClick={closeAddOrEditForm}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mb-3 flex items-start gap-2 rounded-md bg-red-50 p-3 text-xs text-brand-danger border border-red-200">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {!editingItem && (
              <div className="mb-3 rounded-md border border-dashed border-gray-300 p-2.5">
                {!invoiceScanActive ? (
                  <button type="button" className="btn-secondary w-full text-xs" onClick={startInvoiceScanner}>
                    <Camera size={13} /> Scan Invoice / Product QR to Auto-Fill
                  </button>
                ) : (
                  <>
                    <div id="invoice-scanner-region" className="mx-auto w-full max-w-md overflow-hidden rounded-md bg-gray-100" />
                    <button type="button" className="btn-ghost mt-2 w-full text-xs" onClick={stopInvoiceScanner}>
                      Stop Camera
                    </button>
                  </>
                )}
                {!invoiceScanActive && (
                  <button type="button" className="btn-ghost mt-1.5 w-full text-xs" onClick={() => setInvoiceImport({ summary: null })}>
                    Add several items from an invoice (PDF / photo / by hand)
                  </button>
                )}
                {invoiceScanFeedback && <p className="mt-1.5 text-center text-xs text-gray-600">{invoiceScanFeedback}</p>}
              </div>
            )}

            {!editingItem && queue.length > 0 && (
              <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5">
                <div className="mb-1 text-xs font-semibold text-emerald-700">
                  {queue.length} product{queue.length === 1 ? "" : "s"} ready to save — fill in the next one below
                </div>
                <div className="space-y-1">
                  {queue.map((q, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs text-gray-700">
                      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => editQueued(i)} title="Tap to edit this product">
                        <b>{i + 1}. {q.name}</b>
                        {queueSummary(q) && <span className="text-gray-400"> — {queueSummary(q)}</span>}
                      </button>
                      <button type="button" className="text-gray-400 hover:text-brand-danger" aria-label={`Remove ${q.name}`} onClick={() => setQueue((all) => all.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div id="add-product-scroll" className="min-h-[9rem] flex-1 space-y-3 overflow-y-auto pr-1">
              <Field label="Product Name *">
                <input
                  className="input w-full"
                  value={editingItem ? editingItem.name : form.name}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, name: e.target.value })
                      : setForm({ ...form, name: e.target.value })
                  }
                />
              </Field>

              <Field label="Model *">
                <input
                  className="input w-full"
                  value={editingItem ? editingItem.model : form.model}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, model: e.target.value })
                      : setForm({ ...form, model: e.target.value })
                  }
                />
              </Field>

              <Field label="Product Images">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {(editingItem ? editingItem.images ?? [] : form.images).map((url, i) => (
                      <div
                        key={url + i}
                        className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-50"
                      >
                        <img
                          src={url}
                          alt={`Product photo ${i + 1}`}
                          className="h-full w-full object-cover"
                          onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                          aria-label="Remove image"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    {uploading && (
                      <div className="flex size-20 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50">
                        <Loader2 className="size-5 animate-spin text-gray-400" />
                      </div>
                    )}
                    {(editingItem ? editingItem.images ?? [] : form.images).length === 0 && !uploading && (
                      <div className="flex size-20 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50">
                        <span className="text-[10px] text-gray-400">No image</span>
                      </div>
                    )}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={(e) => handleImageFiles(e.target.files)}
                  />
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1.5 !py-1.5 text-xs"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={13} />
                    {uploading ? "Uploading…" : "Upload from computer (select multiple at once)"}
                  </button>

                  <AddImageUrlField onAdd={addImageUrl} />
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Category">
                  <select
                    className="input w-full"
                    value={editingItem ? editingItem.category ?? "" : form.category}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, category: e.target.value })
                        : setForm({ ...form, category: e.target.value })
                    }
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Brand">
                  <select
                    className="input w-full"
                    value={editingItem ? editingItem.brand_id ?? "" : form.brand_id}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, brand_id: e.target.value })
                        : setForm({ ...form, brand_id: e.target.value })
                    }
                  >
                    <option value="">-</option>
                    {brands.filter((b) => b.is_active).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <TagInput
                  label="RAM (add each option)"
                  placeholder="e.g. 8GB, ↵"
                  values={editingItem ? specsArray(editingItem.specs, "ram") : form.ram}
                  onChange={(vals) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, specs: { ...editingItem.specs, ram: vals } })
                      : setForm({ ...form, ram: vals })
                  }
                />
                <TagInput
                  label="Storage (add each option)"
                  placeholder="e.g. 128GB, ↵"
                  values={editingItem ? specsArray(editingItem.specs, "storage") : form.storage}
                  onChange={(vals) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, specs: { ...editingItem.specs, storage: vals } })
                      : setForm({ ...form, storage: vals })
                  }
                />
                <TagInput
                  label="Color (add each option)"
                  placeholder="e.g. Black, ↵"
                  values={editingItem ? specsArray(editingItem.specs, "color") : form.color}
                  onChange={(vals) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, specs: { ...editingItem.specs, color: vals } })
                      : setForm({ ...form, color: vals })
                  }
                />
              </div>

              <VariantPriceGrid
                ram={editingItem ? specsArray(editingItem.specs, "ram") : form.ram}
                storage={editingItem ? specsArray(editingItem.specs, "storage") : form.storage}
                prices={editingItem ? specsVariantPrices(editingItem.specs) : form.variant_prices}
                onChange={(prices) =>
                  editingItem
                    ? setEditingItem({ ...editingItem, specs: { ...editingItem.specs, variant_prices: prices } })
                    : setForm({ ...form, variant_prices: prices })
                }
              />

              <Field label="Type">
                <select
                  className="input w-full"
                  value={editingItem ? editingItem.product_type : form.product_type}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, product_type: e.target.value })
                      : setForm({ ...form, product_type: e.target.value as "new" | "refurbished" })
                  }
                >
                  <option value="new">New</option>
                  <option value="refurbished">Refurbished</option>
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field
                  label={
                    (editingItem
                      ? specsArray(editingItem.specs, "ram").length > 0 && specsArray(editingItem.specs, "storage").length > 0
                      : form.ram.length > 0 && form.storage.length > 0)
                      ? "Sale Price (₹) — auto-set to the lowest RAM+Storage price above"
                      : "Sale Price (₹) *"
                  }
                >
                  <input
                    type="number"
                    className="input w-full"
                    disabled={
                      editingItem
                        ? minVariantPrice(specsVariantPrices(editingItem.specs)) != null
                        : minVariantPrice(form.variant_prices) != null
                    }
                    value={
                      editingItem
                        ? minVariantPrice(specsVariantPrices(editingItem.specs)) ?? editingItem.price
                        : minVariantPrice(form.variant_prices) ?? form.price
                    }
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, price: Number(e.target.value) })
                        : setForm({ ...form, price: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label="Original Price (₹)">
                  <input
                    type="number"
                    className="input w-full"
                    value={editingItem ? editingItem.original_price ?? 0 : form.original_price}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, original_price: Number(e.target.value) })
                        : setForm({ ...form, original_price: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>

              <Field label="Wholesale Price (₹) — what you paid the supplier; used to compute Gross Profit on the Dashboard, leave blank if unknown">
                <input
                  type="number"
                  className="input w-full"
                  value={editingItem ? editingItem.cost_price ?? "" : form.cost_price}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, cost_price: e.target.value ? Number(e.target.value) : null })
                      : setForm({ ...form, cost_price: Number(e.target.value) })
                  }
                />
              </Field>

              {!editingItem && (
                <>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_serialized}
                      onChange={(e) => setForm({ ...form, is_serialized: e.target.checked })}
                      className="rounded border-gray-300 text-brand-primary"
                    />
                    Track by Serial No. / IMEI (phones, tablets)
                  </label>

                  {form.is_serialized ? (
                    <Field label="Serial Numbers (one per line, or comma-separated) — sets initial stock">
                      <textarea
                        className="input w-full"
                        rows={3}
                        placeholder={"359876543210987\n359876543210988"}
                        value={form.serials}
                        onChange={(e) => setForm({ ...form, serials: e.target.value })}
                      />
                      <div className="mt-2">
                        {!scanActive ? (
                          <button type="button" className="btn-secondary w-full text-xs" onClick={startScanner}>
                            <Camera size={13} /> Scan IMEI / Serial with Camera
                          </button>
                        ) : (
                          <>
                            <div id="imei-scanner-region" className="mx-auto w-full max-w-xs overflow-hidden rounded-md bg-gray-100" />
                            <button type="button" className="btn-ghost mt-2 w-full text-xs" onClick={stopScanner}>
                              Stop Camera
                            </button>
                          </>
                        )}
                        {scanFeedback && <p className="mt-1.5 text-center text-xs text-gray-600">{scanFeedback}</p>}
                      </div>
                    </Field>
                  ) : (
                    <QuantityStepper
                      label="Initial Stock"
                      value={form.stock}
                      onChange={(v) => setForm({ ...form, stock: v })}
                    />
                  )}
                </>
              )}

              {editingItem && !editingItem.is_serialized && (
                <QuantityStepper
                  label="Stock"
                  value={editingItem.stock}
                  onChange={(v) => setEditingItem({ ...editingItem, stock: v })}
                />
              )}

              {(editingItem ? editingItem.product_type : form.product_type) === "refurbished" && (
                <div className="grid grid-cols-3 gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-2">
                  <Field label="Condition">
                    <input
                      className="input w-full"
                      value={editingItem ? editingItem.condition ?? "" : form.condition}
                      onChange={(e) =>
                        editingItem
                          ? setEditingItem({ ...editingItem, condition: e.target.value })
                          : setForm({ ...form, condition: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Grade">
                    <input
                      className="input w-full"
                      value={editingItem ? editingItem.grade ?? "" : form.grade}
                      onChange={(e) =>
                        editingItem
                          ? setEditingItem({ ...editingItem, grade: e.target.value })
                          : setForm({ ...form, grade: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Battery %">
                    <input
                      type="number"
                      className="input w-full"
                      value={editingItem ? editingItem.battery_health ?? 0 : form.battery_health}
                      onChange={(e) =>
                        editingItem
                          ? setEditingItem({ ...editingItem, battery_health: Number(e.target.value) })
                          : setForm({ ...form, battery_health: Number(e.target.value) })
                      }
                    />
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Field label="Warranty (months)">
                  <input
                    type="number"
                    className="input w-full"
                    value={editingItem ? editingItem.warranty_months : form.warranty_months}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, warranty_months: Number(e.target.value) })
                        : setForm({ ...form, warranty_months: Number(e.target.value) })
                    }
                  />
                </Field>
                {editingItem && (
                  <div className="flex items-center pt-5">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingItem.is_active}
                        onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked })}
                        className="rounded border-gray-300 text-brand-primary"
                      />
                      Active (Listed)
                    </label>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 pt-1 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingItem ? editingItem.is_featured : form.is_featured}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, is_featured: e.target.checked })
                      : setForm({ ...form, is_featured: e.target.checked })
                  }
                  className="rounded border-gray-300 text-brand-primary"
                />
                Featured on website
              </label>
            </div>

            <div className="mt-4 flex shrink-0 flex-wrap justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                className="btn-ghost"
                onClick={closeAddOrEditForm}
                disabled={saving}
              >
                Cancel
              </button>
              {!editingItem && (
                <>
                  <button type="button" className="btn-secondary" onClick={() => queueAnother(true)} disabled={saving} title="Keep brand, RAM, storage, colour and prices — change only what differs">
                    + Same details, next
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => queueAnother(false)} disabled={saving}>
                    + Add another product
                  </button>
                </>
              )}
              <button type="button" className="btn-primary" onClick={editingItem ? saveEditedItem : addItem} disabled={saving}>
                {saving ? "Saving..." : !editingItem && queue.length > 0 ? `Save all (${queue.length + (form.name.trim() || form.model.trim() ? 1 : 0)})` : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {serialsModalFor && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-2xl p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="text-base font-semibold text-gray-800">IMEI / Serial Numbers</h2>
                <p className="text-xs text-gray-500">{serialsModalFor.name} {serialsModalFor.model}</p>
              </div>
              <button onClick={closeSerialsModal} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {!serialsModalFor.is_serialized && (
              <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
                This product isn't tracked by IMEI/serial yet. Add units below to turn tracking on —
                stock will then be based on these units instead of the manual stock number.
              </div>
            )}

            {serialsModalError && (
              <div className="mb-3 flex items-start gap-2 rounded-md bg-red-50 p-2.5 text-xs text-brand-danger border border-red-200 whitespace-pre-wrap">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{serialsModalError}</span>
              </div>
            )}

            <Field label="Expected quantity for this batch (optional — shows Missing/Extra warnings)">
              <input
                type="number"
                className="input w-full !max-w-[140px]"
                placeholder="e.g. 50"
                value={expectedQty}
                onChange={(e) => setExpectedQty(e.target.value ? Number(e.target.value) : "")}
              />
            </Field>

            <div className="mt-3 flex gap-1 border-b border-border">
              {([
                ["manual", "Manual Entry", Keyboard],
                ["excel", "Import Excel/CSV", FileSpreadsheet],
                ["scan", "Scan IMEI", Camera],
              ] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => {
                    if (key !== "scan") stopScanner();
                    setSerialsMethod(key);
                  }}
                  className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium ${
                    serialsMethod === key ? "border-brand-primary text-brand-primary" : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>

            {/* ── Manual Entry (Method C) ── */}
            {serialsMethod === "manual" && (
              <div className="mt-3">
                <div className="mb-2 text-xs font-medium text-gray-500">
                  Added: {manualRows.filter((r) => r.imei_1 || r.imei_2 || r.serial_no).length}
                  {expectedQty !== "" ? ` / ${expectedQty}` : ""}
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {manualRows.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span className="w-5 shrink-0 text-right text-xs text-gray-400">{idx + 1}</span>
                      <input
                        className="input !py-1 flex-1 text-xs"
                        placeholder="IMEI 1"
                        value={row.imei_1}
                        onChange={(e) => {
                          const next = [...manualRows];
                          next[idx] = { ...next[idx], imei_1: e.target.value };
                          setManualRows(next);
                        }}
                      />
                      <input
                        className="input !py-1 flex-1 text-xs"
                        placeholder="IMEI 2 (optional)"
                        value={row.imei_2}
                        onChange={(e) => {
                          const next = [...manualRows];
                          next[idx] = { ...next[idx], imei_2: e.target.value };
                          setManualRows(next);
                        }}
                      />
                      <input
                        className="input !py-1 flex-1 text-xs"
                        placeholder="Serial No. (optional)"
                        value={row.serial_no}
                        onChange={(e) => {
                          const next = [...manualRows];
                          next[idx] = { ...next[idx], serial_no: e.target.value };
                          setManualRows(next);
                        }}
                      />
                      <button
                        onClick={() => setManualRows(manualRows.filter((_, i) => i !== idx))}
                        className="text-brand-danger shrink-0"
                        title="Remove row"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between">
                  <button
                    className="btn-secondary !py-1 text-xs"
                    onClick={() => setManualRows([...manualRows, { imei_1: "", imei_2: "", serial_no: "" }])}
                  >
                    <Plus size={12} /> Add Unit
                  </button>
                  <button
                    className="btn-primary !py-1.5 text-xs"
                    onClick={() => commitDraftRows(manualRows.filter((r) => r.imei_1 || r.imei_2 || r.serial_no))}
                    disabled={serialsModalLoading}
                  >
                    {serialsModalLoading ? "Saving..." : "Save & Add to Stock"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Excel/CSV Import (Method B) ── */}
            {serialsMethod === "excel" && (
              <div className="mt-3">
                {!excelPreview ? (
                  <div className="rounded-md border border-dashed border-gray-300 p-4 text-center">
                    <p className="mb-2 text-xs text-gray-500">
                      Columns: <strong>IMEI 1</strong> | IMEI 2 | Serial Number (header row optional)
                    </p>
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => handleExcelFile(e.target.files?.[0])}
                    />
                    <button className="btn-secondary text-xs" onClick={() => excelInputRef.current?.click()} disabled={serialsModalLoading}>
                      <Upload size={13} /> {serialsModalLoading ? "Reading..." : "Choose File"}
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="mb-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded bg-gray-100 px-2 py-1">Total Rows: {excelPreview.rows.length}</span>
                      <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">Valid: {excelPreview.valid}</span>
                      <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">Duplicate: {excelPreview.duplicate}</span>
                      <span className="rounded bg-red-100 px-2 py-1 text-brand-danger">Invalid: {excelPreview.invalid}</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded border border-gray-200">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-gray-50">
                          <tr>
                            <th className="p-1.5 text-left">Row</th>
                            <th className="p-1.5 text-left">IMEI 1</th>
                            <th className="p-1.5 text-left">IMEI 2</th>
                            <th className="p-1.5 text-left">Serial</th>
                            <th className="p-1.5 text-left">Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {excelPreview.rows.map((r) => (
                            <tr key={r.row} className={r.errors.length ? "bg-red-50" : ""}>
                              <td className="p-1.5">{r.row}</td>
                              <td className="p-1.5 font-mono">{r.imei_1}</td>
                              <td className="p-1.5 font-mono">{r.imei_2}</td>
                              <td className="p-1.5 font-mono">{r.serial_no}</td>
                              <td className="p-1.5">
                                {r.errors.length ? (
                                  <span className="text-brand-danger">{r.errors.join("; ")}</span>
                                ) : (
                                  <span className="text-emerald-600">OK</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-2 flex justify-between">
                      <button className="btn-ghost text-xs" onClick={() => setExcelPreview(null)}>
                        Choose different file
                      </button>
                      <button
                        className="btn-primary !py-1.5 text-xs"
                        onClick={commitExcelImport}
                        disabled={serialsModalLoading || excelPreview.valid === 0}
                      >
                        {serialsModalLoading ? "Importing..." : `Import ${excelPreview.valid} Valid Row${excelPreview.valid === 1 ? "" : "s"}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Scan IMEI (Method A) ── */}
            {serialsMethod === "scan" && (
              <div className="mt-3">
                <div className="mb-2 text-xs font-medium text-gray-500">
                  IMEI Added: {scannedPending.length}
                  {expectedQty !== "" ? ` / ${expectedQty}` : ""}
                </div>
                <div id="imei-scanner-region" className="mx-auto w-full max-w-xs overflow-hidden rounded-md bg-gray-100" />
                {!scanActive ? (
                  <button className="btn-secondary mt-2 w-full text-xs" onClick={startScanner}>
                    <Camera size={13} /> Start Camera
                  </button>
                ) : (
                  <button className="btn-ghost mt-2 w-full text-xs" onClick={stopScanner}>
                    Stop Camera
                  </button>
                )}
                {scanFeedback && <p className="mt-1.5 text-center text-xs text-gray-600">{scanFeedback}</p>}
                {scannedPending.length > 0 && (
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                    {scannedPending.map((r, i) => (
                      <div key={i} className="flex items-center justify-between rounded border border-gray-200 px-2 py-1 text-xs">
                        <span className="font-mono">{r.imei_1}</span>
                        <button onClick={() => setScannedPending(scannedPending.filter((_, j) => j !== i))} className="text-brand-danger">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex justify-end">
                  <button
                    className="btn-primary !py-1.5 text-xs"
                    onClick={commitScannedRows}
                    disabled={serialsModalLoading || scannedPending.length === 0}
                  >
                    {serialsModalLoading ? "Saving..." : `Save ${scannedPending.length} Scanned Unit${scannedPending.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">
                  Existing units ({serialsModalUnits.filter((u) => u.status === "in_stock").length} in stock)
                </span>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {serialsModalUnits.map((u) => (
                  <div key={u.id} className="flex items-center justify-between rounded border border-gray-200 px-2 py-1 text-xs">
                    <span className="font-mono">
                      {u.imei_1 ?? "-"}
                      {u.imei_2 ? ` / ${u.imei_2}` : ""}
                      {u.serial_no ? ` (SN: ${u.serial_no})` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          u.status === "in_stock"
                            ? "text-emerald-600"
                            : u.status === "sold"
                              ? "text-gray-400"
                              : ["damaged", "lost", "cancelled"].includes(u.status)
                                ? "text-brand-danger"
                                : "text-amber-600"
                        }
                      >
                        {u.status.replace("_", " ")}
                      </span>
                      {u.status === "in_stock" && (
                        <button onClick={() => deleteUnit(u)} className="text-brand-danger" title="Remove (mistaken entry only)">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {serialsModalUnits.length === 0 && !serialsModalLoading && (
                  <p className="text-xs text-gray-400">No units yet.</p>
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end border-t border-border pt-3">
              <button className="btn-ghost" onClick={closeSerialsModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}
