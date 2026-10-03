import { useEffect, useRef, useState } from "react";
import { Plus, X, Edit2, Trash2, Check, AlertCircle, Upload, Loader2, Printer, Hash, Camera, FileSpreadsheet, Keyboard } from "lucide-react";
import { formatCurrency, validateImei, normalizeImei, softDelete } from "@sai/shared";
import type { InventoryUnit } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { BrandCombobox } from "../components/BrandCombobox";
import { InvoiceImportModal } from "../components/InvoiceImportModal";
import { decodeEInvoiceQr, decodeQrFromImage, type EInvoiceSummary } from "../lib/invoiceReader";
import { startQrScan, type QrScanHandle } from "../lib/qrScanner";
import { useLiveScanner } from "../lib/scanner/useLiveScanner";
import { IMEI_FORMATS } from "../lib/scanner/types";
import { checkImeiCandidate } from "../lib/scanner/imeiRules";
import { decodeImageStaged, type PhotoCandidate } from "../lib/scanner/imageSource";

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
  /** HSN/SAC + GST rate for tax invoices (columns added by migration 0058; undefined until that is applied). */
  hsn_sac?: string | null;
  gst_rate?: number | null;
}

// Must exactly match the live `inventory_category_check` constraint —
// verified directly against the database, not guessed:
// CHECK (category = ANY (ARRAY['Smartphones','Feature Phones','Tablets','Accessories','Refurbished','Home Appliances']))
const CATEGORY_OPTIONS = ["Smartphones", "Feature Phones", "Tablets", "Accessories", "Refurbished", "Home Appliances"];

// Suggested HSN/SAC per category (the rate is the current slab for that heading). Accessories/appliances vary by product.
const HSN_HINTS: Record<string, { code?: string; rate?: number; note: string }> = {
  Smartphones: { code: "8517", rate: 18, note: "Mobile phones: HSN 8517, GST 18%" },
  "Feature Phones": { code: "8517", rate: 18, note: "Mobile phones: HSN 8517, GST 18%" },
  Tablets: { code: "8471", rate: 18, note: "Tablets / computers: HSN 8471, GST 18%" },
  Refurbished: { code: "8517", rate: 18, note: "Phones: HSN 8517, GST 18% (second-hand goods may use the margin scheme — ask your CA)" },
  Accessories: { note: "Varies: chargers 8504, cables 8544, earphones 8518, cases 3926/4202, power banks 8507" },
  "Home Appliances": { note: "Varies by product — check the HSN on the supplier's invoice" },
};
const GST_RATE_CHOICES = [0, 5, 12, 18, 28, 40];
// Rate that goes with an HSN heading (first 4 digits) — used to fill the GST rate as soon as an HSN is typed.
const HSN_RATE_BY_HEADING: Record<string, number> = {
  "8517": 18, "8471": 18, "8504": 18, "8544": 18, "8518": 18, "8507": 18, "8528": 18, "8509": 18,
  "8418": 18, "8450": 18, "8415": 18, "8516": 18, "3926": 18, "4202": 18, "8523": 18, "8525": 18,
};

const emptyForm = {
  hsn_sac: "",
  gst_rate: "" as string, // "" = not set (the sale form's default rate is used)
  name: "",
  category: "Smartphones",
  brand_id: "",
  brand_name: "", // brand as typed; matched to an existing brand at save, or created if new
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
  const [gstCustom, setGstCustom] = useState(false); // GST rate typed by hand instead of picked
  const [editBrandName, setEditBrandName] = useState<string | null>(null);
  const [queue, setQueue] = useState<(typeof emptyForm)[]>([]);
  // Invoice import (e-invoice QR summary + item-by-item entry); summary null = opened without a QR.
  const [invoiceImport, setInvoiceImport] = useState<{ summary: EInvoiceSummary | null } | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  useEffect(() => setEditBrandName(null), [editingItem?.id]);
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
  // Scan mode — live camera decode via the shared scanner engine
  // (apps/admin/src/lib/scanner): native BarcodeDetector + zxing-wasm,
  // multi-frame verification (3 matching reads by default before a value is
  // ever accepted — see verifier.ts), never a single-frame guess.
  const imeiScanContainerRef = useRef<HTMLDivElement | null>(null);
  const imeiPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [scannedPending, setScannedPending] = useState<{ imei_1: string; imei_2: string; serial_no: string }[]>([]);
  // Dual-IMEI safety: when a second distinct IMEI is accepted within a few
  // seconds of the first (and the first has no imei_2 yet), ask explicitly
  // whether they're one dual-SIM phone instead of ever assuming it — see
  // acceptScannedImei() below. Default (no answer) is "two separate units",
  // i.e. the same behavior as before this existed.
  const lastAcceptedImeiRef = useRef<{ imei: string; at: number } | null>(null);
  const [dualImeiPrompt, setDualImeiPrompt] = useState<{ prevImei: string; newImei: string } | null>(null);
  // Photo (still-image) IMEI scanning — staged decode with multiple
  // preprocessing passes; see lib/scanner/imageSource.ts. Candidates with
  // agreement >= 2 are "likely correct" (confirmed by 2+ independent
  // passes/engines), never claimed certain — the user always confirms.
  const [photoCandidates, setPhotoCandidates] = useState<PhotoCandidate[] | null>(null);
  const [photoScanBusy, setPhotoScanBusy] = useState(false);

  const imeiScanner = useLiveScanner({
    formats: IMEI_FORMATS,
    verifier: { requiredMatches: 3, windowMs: 4000 },
    onAccepted: (text) => {
      try {
        navigator.vibrate?.(60);
      } catch {
        /* vibration unsupported */
      }
      const check = checkImeiCandidate(text);
      if (!check.ok) {
        setScanFeedback(check.message);
        return;
      }
      void acceptScannedImei(check.imei);
    },
    onConflict: () => {
      setScanFeedback("Different values were read — hold the barcode steady and directly facing the camera, then try again.");
    },
  });

  // Product/Invoice QR scan (distinct from the IMEI/serial scanner above) —
  // reads whatever a supplier's carton or invoice QR encodes and tries to
  // pre-fill Name + match an existing Brand, since suppliers rarely encode
  // a brand_id our DB would recognize directly.
  const invoiceScannerRef = useRef<QrScanHandle | null>(null);
  const invoicePhotoRef = useRef<HTMLInputElement | null>(null);
  const [invoiceZoom, setInvoiceZoom] = useState<QrScanHandle["zoom"]>(undefined);
  const [invoiceTorch, setInvoiceTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
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
    setGstCustom(false);
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

      // Atomic save: inventory_units + imei_history are inserted together,
      // inside one database transaction (see
      // supabase/migrations/0065_imei_db_safety.sql's
      // add_inventory_units_with_history RPC). If any unit in the batch
      // fails — duplicate IMEI, invalid IMEI, anything — the WHOLE batch
      // rolls back; a unit can never end up saved with no history event.
      const { error: rpcErr } = await supabase.rpc("add_inventory_units_with_history", {
        p_inventory_id: serialsModalFor.id,
        p_units: rows.map((r) => ({
          imei_1: normalizeImei(r.imei_1) || null,
          imei_2: normalizeImei(r.imei_2) || null,
          serial_no: r.serial_no.trim() || null,
        })),
      });
      if (rpcErr) throw rpcErr;

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

  // ── Camera Scan (Method A) — shared scanner engine ─────────────────────
  // Starts the live camera and the multi-frame verification loop (see
  // lib/scanner/useLiveScanner.ts). A value only ever reaches
  // acceptScannedImei() below after 3 matching reads agree — see
  // verifier.ts. Format/Luhn validation happens in the hook's onAccepted
  // callback (checkImeiCandidate), configured above where imeiScanner is
  // created.
  async function startScanner() {
    if (imeiScanner.state.active) return;
    setScanFeedback(null);
    setSerialsModalError(null);
    await new Promise((r) => requestAnimationFrame(r)); // let the container <div> render first
    const container = imeiScanContainerRef.current;
    if (!container) {
      setScanFeedback("Could not start the camera — the scanner area did not render.");
      return;
    }
    await imeiScanner.start(container);
    if (imeiScanner.state.feedback) {
      setScanFeedback(imeiScanner.state.feedback);
      setSerialsModalError(imeiScanner.state.feedback);
    }
  }

  async function stopScanner() {
    imeiScanner.stop();
  }

  // Called only after a value has passed BOTH 3-matching-read verification
  // (the live loop) and format+Luhn validation (checkImeiCandidate) — see
  // the onAccepted callback above. From here it still goes through the same
  // in-batch and database duplicate checks as before.
  async function acceptScannedImei(imei: string) {
    // Add New Product form: scanning here builds up the plain "one per
    // line" serials textarea directly, so a brand-new serialized product
    // (e.g. a fresh wholesaler carton) can be created and stocked in one
    // pass instead of adding it first and scanning separately afterwards.
    // insertProduct() (below) now re-validates and routes every 15-digit
    // entry here through the same Luhn + atomic-save path as Manage
    // Serials — scanning into this form can no longer bypass that.
    if (showAddForm) {
      const existing = parseSerials(form.serials);
      if (existing.includes(imei)) {
        setScanFeedback(`Already scanned in this batch: ${imei}`);
        return;
      }
      const owner = await findExistingImeiOwner(imei);
      if (owner) {
        setScanFeedback(`IMEI ${imei} already exists.`);
        return;
      }
      setForm((prev) => ({ ...prev, serials: [...parseSerials(prev.serials), imei].join("\n") }));
      setScanFeedback(`Verified and added ${imei} (3 matching reads).`);
      lastAcceptedImeiRef.current = { imei, at: Date.now() };
      return;
    }

    // Manage Serials modal (existing product): reject if already in the
    // pending list or existing stock.
    if (scannedPending.some((r) => r.imei_1 === imei || r.imei_2 === imei)) {
      setScanFeedback(`Already scanned in this batch: ${imei}`);
      return;
    }
    const owner = await findExistingImeiOwner(imei);
    if (owner) {
      setScanFeedback(`IMEI ${imei} already exists.`);
      return;
    }

    // Dual-IMEI safety: never silently decide two IMEIs scanned close
    // together are the same dual-SIM phone. Default is "two separate
    // units" (append as its own row, same as before) — a prompt offers
    // merging them only when the previous row is still imei_2-empty and
    // was accepted within the last 6 seconds.
    const last = lastAcceptedImeiRef.current;
    const prevRow = scannedPending[scannedPending.length - 1];
    if (last && prevRow && !prevRow.imei_2 && prevRow.imei_1 === last.imei && Date.now() - last.at < 6000) {
      setDualImeiPrompt({ prevImei: last.imei, newImei: imei });
      lastAcceptedImeiRef.current = { imei, at: Date.now() };
      return;
    }

    setScannedPending((prev) => [...prev, { imei_1: imei, imei_2: "", serial_no: "" }]);
    setScanFeedback(`Verified and added ${imei} (3 matching reads).`);
    lastAcceptedImeiRef.current = { imei, at: Date.now() };
  }

  function resolveDualImeiPrompt(mergeAsOneDevice: boolean) {
    if (!dualImeiPrompt) return;
    const { newImei } = dualImeiPrompt;
    setScannedPending((prev) => {
      if (mergeAsOneDevice) {
        const idx = prev.length - 1;
        if (idx < 0) return prev;
        const copy = [...prev];
        copy[idx] = { ...copy[idx], imei_2: newImei };
        return copy;
      }
      return [...prev, { imei_1: newImei, imei_2: "", serial_no: "" }];
    });
    setDualImeiPrompt(null);
  }

  async function commitScannedRows() {
    await commitDraftRows(scannedPending);
  }

  // ── Photo IMEI Scan ──────────────────────────────────────────────────────
  // Staged decode (lib/scanner/imageSource.ts): normal scale, alt scale,
  // grayscale/contrast, sharpen, invert — stops as soon as 2 independent
  // passes/engines agree on a value. Never auto-saves: every candidate is
  // shown for explicit confirmation, and conflicting candidates are all
  // shown rather than one being guessed.
  async function onImeiPhotoFile(file: File | undefined) {
    if (!file) return;
    setScanFeedback(null);
    setPhotoScanBusy(true);
    try {
      const { candidates } = await decodeImageStaged(file, IMEI_FORMATS);
      const valid = candidates.filter((c) => checkImeiCandidate(c.text).ok);
      if (valid.length === 0) {
        setScanFeedback(
          candidates.length
            ? "A barcode was found but it is not a valid IMEI (wrong length or check digit) — retake the photo closer and in focus."
            : "No barcode could be read from that photo. Try a closer, sharper, well-lit photo."
        );
      } else {
        setPhotoCandidates(valid);
      }
    } catch {
      setScanFeedback("Could not read that photo.");
    } finally {
      setPhotoScanBusy(false);
      if (imeiPhotoInputRef.current) imeiPhotoInputRef.current.value = "";
    }
  }

  async function confirmPhotoCandidate(imei: string) {
    setPhotoCandidates(null);
    const check = checkImeiCandidate(imei);
    if (!check.ok) {
      setScanFeedback(check.message);
      return;
    }
    await acceptScannedImei(check.imei);
  }

  // Shared render for the IMEI camera/photo scanner — used identically by
  // the Add Product form and the Manage Serials modal, so this is one
  // function instead of two copies of the same ~30 lines of JSX.
  function renderImeiScannerPanel() {
    const { active, feedback, torchSupported, torchOn, zoom, pendingText, pendingProgress } = imeiScanner.state;
    return (
      <div>
        {!active ? (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1 text-xs" onClick={startScanner}>
              <Camera size={13} /> Scan IMEI with Camera
            </button>
            <button type="button" className="btn-ghost text-xs" disabled={photoScanBusy} onClick={() => imeiPhotoInputRef.current?.click()}>
              {photoScanBusy ? "Reading…" : "Photo"}
            </button>
            <input
              ref={imeiPhotoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onImeiPhotoFile(e.target.files?.[0])}
            />
          </div>
        ) : (
          <>
            <div ref={imeiScanContainerRef} className="mx-auto w-full max-w-xs overflow-hidden rounded-md bg-gray-100" />
            {pendingText && pendingProgress && (
              <p className="mt-1.5 text-center text-xs text-brand-primary">
                Reading {pendingText.slice(0, 6)}… ({pendingProgress.matches}/{pendingProgress.required} matching reads)
              </p>
            )}
            {zoom && (
              <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
                Zoom
                <input
                  type="range"
                  className="flex-1"
                  min={zoom.min}
                  max={zoom.max}
                  step={zoom.step}
                  value={zoom.value}
                  onChange={(e) => imeiScanner.setZoom(Number(e.target.value))}
                />
              </label>
            )}
            {torchSupported && (
              <button type="button" className="btn-secondary mt-2 w-full text-xs" onClick={imeiScanner.toggleTorch}>
                {torchOn ? "Torch On" : "Torch Off"}
              </button>
            )}
            <button type="button" className="btn-ghost mt-2 w-full text-xs" onClick={stopScanner}>
              Stop Camera
            </button>
          </>
        )}
        {feedback && <p className="mt-1.5 text-center text-xs text-gray-600">{feedback}</p>}
        {scanFeedback && <p className="mt-1.5 text-center text-xs text-gray-600">{scanFeedback}</p>}

        {dualImeiPrompt && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs">
            <p className="mb-1.5 font-medium text-amber-800">
              Two IMEIs scanned close together — is this ONE dual-SIM phone, or two separate phones?
            </p>
            <p className="mb-2 font-mono text-[11px] text-gray-600">
              {dualImeiPrompt.prevImei} / {dualImeiPrompt.newImei}
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1 text-xs" onClick={() => resolveDualImeiPrompt(true)}>
                Same phone (pair as IMEI 1 + 2)
              </button>
              <button type="button" className="btn-ghost flex-1 text-xs" onClick={() => resolveDualImeiPrompt(false)}>
                Two separate phones
              </button>
            </div>
          </div>
        )}

        {photoCandidates && (
          <div className="mt-2 rounded-md border border-border bg-white p-2.5 text-xs">
            <p className="mb-1.5 font-medium text-gray-700">
              {photoCandidates.length === 1
                ? "One IMEI found — confirmed by matching independent reads, but a photo scan is never certain. Check it against the box before confirming."
                : `${photoCandidates.length} different valid IMEIs were read from this photo — they were not all read the same way, so nothing was picked automatically. Choose the correct one, or retake the photo.`}
            </p>
            <div className="space-y-1">
              {photoCandidates.map((c) => (
                <button
                  key={c.text}
                  type="button"
                  className="flex w-full items-center justify-between rounded border border-border px-2 py-1 font-mono hover:bg-accent"
                  onClick={() => confirmPhotoCandidate(c.text)}
                >
                  <span>{c.text}</span>
                  <span className="text-[10px] text-gray-400">{c.agreement}x agreement</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn-ghost mt-1.5 w-full text-[11px]" onClick={() => setPhotoCandidates(null)}>
              None of these — cancel
            </button>
          </div>
        )}
      </div>
    );
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
      // Government e-invoice QRs are very dense: read full-resolution frames with the phone's own barcode
      // detector plus zxing-wasm (see lib/qrScanner.ts) instead of html5-qrcode's small cropped box.
      const handle = await startQrScan(document.getElementById("invoice-scanner-region")!, (decoded) => onInvoiceScanDecoded(decoded));
      invoiceScannerRef.current = handle;
      setInvoiceZoom(handle.zoom);
      setInvoiceTorch({ supported: handle.torchSupported, on: false });
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
    } catch {
      /* already stopped */
    }
    invoiceScannerRef.current = null;
    setInvoiceScanActive(false);
    setInvoiceZoom(undefined);
    setInvoiceTorch({ supported: false, on: false });
  }

  // Fallback that always works: the phone's own camera app takes a full-resolution, auto-focused photo.
  async function onInvoicePhoto(file: File | undefined) {
    if (!file) return;
    setInvoiceScanFeedback("Reading the QR from the photo…");
    try {
      const text = await decodeQrFromImage(file);
      if (text) await onInvoiceScanDecoded(text);
      else setInvoiceScanFeedback("No QR could be read from that photo. Retake it closer, with the whole QR in frame, in focus and without glare — or upload the invoice PDF via the button below.");
    } catch {
      setInvoiceScanFeedback("Could not read that photo.");
    }
    if (invoicePhotoRef.current) invoicePhotoRef.current.value = "";
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
    if (!copyDetails) setGstCustom(false);
    document.getElementById("add-product-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function queueSummary(q: typeof emptyForm) {
    const bits = [q.brand_name, q.model && q.model !== q.name ? q.model : "", q.ram.join("/"), q.storage.join("/"), q.color.join("/"), q.stock ? `${q.stock} pcs` : ""].filter(Boolean);
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

  // Brand typed in the form: reuse the existing brand of that name, otherwise create it.
  async function ensureBrand(typed: string, brandId: string, cache: Map<string, string>): Promise<string | null> {
    if (brandId) return brandId;
    const name = typed.trim();
    if (!name) return null;
    const key = name.toLowerCase();
    const known = cache.get(key) ?? brands.find((b) => b.name.trim().toLowerCase() === key)?.id;
    if (known) return known;
    const { data, error } = await supabase.from("brands").insert({ name, is_active: true }).select("id").single();
    if (error) throw error;
    cache.set(key, data.id);
    await loadBrands();
    return data.id;
  }

  async function insertProduct(f: typeof emptyForm, actorName: string, brandCache: Map<string, string>) {
    const brandId = await ensureBrand(f.brand_name, f.brand_id, brandCache);
    const serials = f.is_serialized ? parseSerials(f.serials) : [];

    // Split into IMEI-shaped entries (15 digits) vs plain serial numbers.
    // Every IMEI-shaped entry — whether typed by hand or scanned — gets the
    // SAME strong validation as Manage Serials (format + Luhn + duplicate
    // check) BEFORE anything is saved, closing the bypass where a scanned
    // IMEI previously landed in serial_no with none of those checks.
    const imeiEntries: string[] = [];
    const plainSerials: string[] = [];
    for (const s of serials) {
      if (/^\d{15}$/.test(normalizeImei(s))) imeiEntries.push(normalizeImei(s));
      else plainSerials.push(s);
    }
    if (imeiEntries.length) {
      const seen = new Set<string>();
      for (const imei of imeiEntries) {
        const res = validateImei(imei);
        if (!res.ok) throw new Error(`"${imei}": ${res.message}`);
        if (seen.has(imei)) throw new Error(`IMEI ${imei} is listed twice.`);
        seen.add(imei);
        const owner = await findExistingImeiOwner(imei);
        if (owner) throw new Error(`IMEI ${imei} already exists.`);
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("inventory")
      .insert({
        name: f.name.trim(),
        model: f.model.trim(),
        category: f.category,
        brand_id: brandId,
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
        // Only sent when filled in, so adding products keeps working until migration 0058 is applied.
        ...(f.hsn_sac.trim() ? { hsn_sac: f.hsn_sac.trim() } : {}),
        ...(f.gst_rate !== "" ? { gst_rate: Number(f.gst_rate) } : {}),
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    // Atomic save (see supabase/migrations/0065_imei_db_safety.sql) — IMEI
    // and plain-serial units together in one all-or-nothing database call,
    // with a real imei_history 'purchase' event per unit, the same
    // guarantee Manage Serials already had.
    if (imeiEntries.length || plainSerials.length) {
      const { error: unitsErr } = await supabase.rpc("add_inventory_units_with_history", {
        p_inventory_id: inserted.id,
        p_units: [
          ...imeiEntries.map((imei) => ({ imei_1: imei })),
          ...plainSerials.map((serial_no) => ({ serial_no })),
        ],
      });
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
      const brandCache = new Map<string, string>();
      try {
        for (const f of toSave) {
          await insertProduct(f, actorName, brandCache);
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
      setGstCustom(false);
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
      const editBrandId = await ensureBrand(editBrandName ?? "", editingItem.brand_id ?? "", new Map());
      const { error: updateErr } = await supabase
        .from("inventory")
        .update({
          name: editingItem.name.trim(),
          model: editingItem.model.trim(),
          category: editingItem.category,
          brand_id: editBrandId,
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
          // Included only once the product has them (or the user typed them) — safe before migration 0058.
          ...(editingItem.hsn_sac !== undefined ? { hsn_sac: (editingItem.hsn_sac ?? "").trim() || null } : {}),
          ...(editingItem.gst_rate !== undefined ? { gst_rate: editingItem.gst_rate ?? null } : {}),
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
                    {invoiceZoom && (
                      <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
                        Zoom
                        <input
                          type="range"
                          className="flex-1"
                          min={invoiceZoom.min}
                          max={invoiceZoom.max}
                          step={invoiceZoom.step}
                          defaultValue={invoiceZoom.value}
                          onChange={(e) => invoiceScannerRef.current?.setZoom(Number(e.target.value)).catch(() => {})}
                        />
                      </label>
                    )}
                    {invoiceTorch.supported && (
                      <button
                        type="button"
                        className="btn-secondary mt-2 w-full text-xs"
                        onClick={() => invoiceScannerRef.current?.setTorch(!invoiceTorch.on).then(() => setInvoiceTorch((t) => ({ ...t, on: !t.on }))).catch(() => {})}
                      >
                        {invoiceTorch.on ? "Torch On" : "Torch Off"}
                      </button>
                    )}
                    <p className="mt-1.5 text-center text-[11px] text-gray-400">Hold 15–25 cm away, keep the whole QR in view and steady, avoid glare — use Zoom if it is small.</p>
                    <button type="button" className="btn-ghost mt-2 w-full text-xs" onClick={stopInvoiceScanner}>
                      Stop Camera
                    </button>
                  </>
                )}
                <input ref={invoicePhotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onInvoicePhoto(e.target.files?.[0])} />
                <button type="button" className="btn-ghost mt-1.5 w-full text-xs" onClick={() => invoicePhotoRef.current?.click()}>
                  <Camera size={13} /> Take a photo of the QR instead (sharper)
                </button>
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
                  <BrandCombobox
                    brands={brands}
                    value={
                      editingItem
                        ? editBrandName ?? brands.find((b) => b.id === editingItem.brand_id)?.name ?? ""
                        : form.brand_name || brands.find((b) => b.id === form.brand_id)?.name || ""
                    }
                    onChange={(text, match) => {
                      if (editingItem) {
                        setEditBrandName(text);
                        setEditingItem({ ...editingItem, brand_id: match?.id ?? "" });
                      } else {
                        setForm({ ...form, brand_name: text, brand_id: match?.id ?? "" });
                      }
                    }}
                  />
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

              <div className="rounded-md border border-border p-2.5">
                <div className="mb-2 text-xs font-semibold text-gray-600">Tax invoice details (optional)</div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="HSN / SAC code">
                    <input
                      className="input w-full"
                      inputMode="numeric"
                      placeholder="e.g. 8517"
                      value={editingItem ? editingItem.hsn_sac ?? "" : form.hsn_sac}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
                        const auto = v.length >= 4 ? HSN_RATE_BY_HEADING[v.slice(0, 4)] : undefined;
                        if (editingItem) {
                          setEditingItem({ ...editingItem, hsn_sac: v, ...(auto != null && editingItem.gst_rate == null ? { gst_rate: auto } : {}) });
                        } else {
                          setForm({ ...form, hsn_sac: v, ...(auto != null && form.gst_rate === "" ? { gst_rate: String(auto) } : {}) });
                        }
                      }}
                    />
                  </Field>
                  <Field label="GST rate">
                    {(() => {
                      const cur = editingItem ? (editingItem.gst_rate == null ? "" : String(editingItem.gst_rate)) : form.gst_rate;
                      const setRate = (v: string) =>
                        editingItem
                          ? setEditingItem({ ...editingItem, gst_rate: v === "" ? null : Number(v) })
                          : setForm({ ...form, gst_rate: v });
                      const custom = gstCustom || (cur !== "" && !GST_RATE_CHOICES.includes(Number(cur)));
                      return (
                        <div className="flex gap-1.5">
                          <select
                            className="input w-full"
                            value={custom ? "custom" : cur}
                            onChange={(e) => {
                              if (e.target.value === "custom") {
                                setGstCustom(true);
                              } else {
                                setGstCustom(false);
                                setRate(e.target.value);
                              }
                            }}
                          >
                            <option value="">Not set (use sale default)</option>
                            {GST_RATE_CHOICES.map((r) => (
                              <option key={r} value={String(r)}>{r}%</option>
                            ))}
                            <option value="custom">Other rate…</option>
                          </select>
                          {custom && (
                            <div className="relative w-24 shrink-0">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                className="input w-full pr-5"
                                placeholder="Rate"
                                value={cur}
                                onChange={(e) => setRate(e.target.value)}
                              />
                              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </Field>
                </div>
                {(() => {
                  const cat = editingItem ? editingItem.category ?? "" : form.category;
                  const hint = HSN_HINTS[cat];
                  if (!hint) return null;
                  const apply = () =>
                    editingItem
                      ? setEditingItem({ ...editingItem, hsn_sac: hint.code ?? editingItem.hsn_sac ?? "", gst_rate: hint.rate ?? editingItem.gst_rate ?? null })
                      : setForm({ ...form, hsn_sac: hint.code ?? form.hsn_sac, gst_rate: hint.rate != null ? String(hint.rate) : form.gst_rate });
                  return (
                    <div className="mt-1.5 flex items-start justify-between gap-2 text-[11px] text-gray-500">
                      <span>{hint.note}</span>
                      {hint.code && (
                        <button type="button" className="shrink-0 font-medium text-brand-primary hover:underline" onClick={apply}>
                          Use suggested
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>

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
                      <div className="mt-2">{renderImeiScannerPanel()}</div>
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
                {renderImeiScannerPanel()}
                {scannedPending.length > 0 && (
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                    {scannedPending.map((r, i) => (
                      <div key={i} className="flex items-center justify-between rounded border border-gray-200 px-2 py-1 text-xs">
                        <span className="font-mono">{r.imei_1}{r.imei_2 ? ` + ${r.imei_2}` : ""}</span>
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
