// Reading a wholesaler invoice: (1) decode the government e-invoice QR summary,
// (2) pull line items out of the invoice PDF (its embedded text) or a photo (OCR).
// Everything runs in the browser, no AI service. Results are only a pre-fill —
// the person confirms every row before anything is saved.

export interface EInvoiceSummary {
  sellerGstin?: string;
  buyerGstin?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  totalValue?: number;
  itemCount?: number;
  mainHsn?: string;
  irn?: string;
  // Not in the QR — read from the printed invoice text (best effort, always editable).
  sellerName?: string;
}

export interface InvoiceLine {
  name: string;
  qty: number;
  unitCost: number;
  amount: number;
  hsn?: string;
  gstRate?: number;
  discountPct?: number;
  /** IMEIs printed under the item (the "Batch:" line on Samsung-style invoices). */
  imeis?: string[];
}

export interface InvoiceHeaderGuess {
  sellerName?: string;
  sellerGstin?: string;
  buyerGstin?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  totalValue?: number;
  eWayBill?: string;
}

function b64urlToString(part: string): string {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The signed e-invoice QR is a JWT (header.payload.signature); the payload's `data` holds the 8 summary fields. */
export function decodeEInvoiceQr(text: string): EInvoiceSummary | null {
  const parts = text.trim().split(".");
  if (parts.length !== 3 || !parts[0].startsWith("eyJ")) return null;
  try {
    const payload = JSON.parse(b64urlToString(parts[1]));
    const raw = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data ?? payload;
    if (!raw || (raw.SellerGstin == null && raw.Irn == null && raw.DocNo == null)) return null;
    const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : undefined);
    return {
      sellerGstin: raw.SellerGstin,
      buyerGstin: raw.BuyerGstin,
      invoiceNumber: raw.DocNo != null ? String(raw.DocNo) : undefined,
      invoiceDate: raw.DocDt,
      totalValue: num(raw.TotInvVal),
      itemCount: num(raw.ItemCnt),
      mainHsn: raw.MainHsnCode != null ? String(raw.MainHsnCode) : undefined,
      irn: raw.Irn,
    };
  } catch {
    return null;
  }
}

const UNIT_RE = /^(nos?|pcs?|pc|unit|units|set|sets|box|pkt|kg|mtr)\.?$/i;
const DECIMAL_RE = /^\d[\d,]*\.\d{1,2}$/;
const num = (t: string) => Number(t.replace(/,/g, ""));

/** Turns invoice text lines into item rows. Best effort — layouts differ per wholesaler. */
/** IMEIs on a "Batch: 3517…" / "IMEI: …" line, or a line that is nothing but a 15-digit number. */
function extractImeis(line: string): string[] {
  const l = line.trim();
  const labelled = l.match(/^(?:batch|imei\s*\d?|serial(?:\s*no)?|s\/?n)\s*[:.-]?\s*(.*)$/i);
  const body = labelled ? labelled[1] : /^[\d\s,/]+$/.test(l) ? l : "";
  if (!body) return [];
  // OCR often puts a space inside a number; take 15-digit runs after removing separators between digits.
  return (body.replace(/(\d)[\s-]+(?=\d)/g, "$1").match(/\d{15}/g) ?? []).filter((v, i, a) => a.indexOf(v) === i);
}

/** "18 %" / "18%" tokens in order: the first is the GST rate, the second the discount. */
function percentValues(line: string): number[] {
  return [...line.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
}

export function parseInvoiceLines(lines: string[]): InvoiceLine[] {
  const rows: InvoiceLine[] = [];
  let last: InvoiceLine | null = null;

  for (const line of lines) {
    const imeis = last ? extractImeis(line) : [];
    if (last && imeis.length) {
      last.imeis = [...new Set([...(last.imeis ?? []), ...imeis])];
      continue;
    }
    const tokens = line.replace(/\s+/g, " ").trim().split(" ");
    const starts = /^\d{1,3}$/.test(tokens[0] ?? "");
    const decimals = tokens.filter((t) => DECIMAL_RE.test(t));

    if (starts && decimals.length >= 1 && tokens.length >= 4) {
      const rest = tokens.slice(1);
      const firstNumeric = rest.findIndex((t) => /^[\d,]+(\.\d+)?$/.test(t) && t.length >= 3 && !/[a-z]/i.test(t));
      const name = (firstNumeric > 0 ? rest.slice(0, firstNumeric) : rest.slice(0, 3)).join(" ").trim();
      if (!name || !/[a-z]/i.test(name)) continue;

      const hsn = rest.find((t) => /^\d{4,8}$/.test(t));
      const unitIdx = rest.findIndex((t) => UNIT_RE.test(t));
      let qty = 1;
      if (unitIdx > 0 && /^\d+(\.\d+)?$/.test(rest[unitIdx - 1])) qty = num(rest[unitIdx - 1]);
      else {
        const small = rest.find((t) => /^\d{1,4}$/.test(t) && t !== hsn);
        if (small) qty = num(small);
      }

      const values = decimals.map(num);
      const amount = values[values.length - 1];
      // Pick the decimal that, times qty, matches the line amount — that is the unit rate.
      const rate = values.find((v) => qty > 0 && Math.abs(v * qty - amount) <= Math.max(1, amount * 0.001));
      const unitCost = rate ?? (qty > 0 ? amount / qty : amount);

      const pct = percentValues(line);
      last = { name, qty: qty || 1, unitCost: Math.round(unitCost * 100) / 100, amount, hsn, gstRate: pct[0], discountPct: pct[1] };
      rows.push(last);
    } else if (last && !decimals.length && /^[A-Za-z(]/.test(line.trim()) && tokens.length <= 8 && !/total|gst|tax|amount|bank|ifsc|round/i.test(line)) {
      // A wrapped continuation of the previous item's name.
      last.name = `${last.name} ${line.trim()}`;
    }
  }
  if (rows.length > 0) return rows;

  // Second pass for tables without a serial-number column: any line with a name and 2+ amounts.
  for (const line of lines) {
    const imeis = rows.length ? extractImeis(line) : [];
    if (imeis.length) {
      const prev = rows[rows.length - 1];
      prev.imeis = [...new Set([...(prev.imeis ?? []), ...imeis])];
      continue;
    }
    const tokens = line.replace(/\s+/g, " ").trim().split(" ");
    const decimals = tokens.filter((t) => DECIMAL_RE.test(t)).map(num);
    const firstNum = tokens.findIndex((t) => /^[\d,]+(\.\d+)?$/.test(t) && t.length >= 3);
    const name = (firstNum > 0 ? tokens.slice(0, firstNum) : tokens.slice(0, 3)).join(" ").replace(/^\d{1,3}\s+/, "");
    if (decimals.length >= 2 && /[a-z]{3}/i.test(name) && !/total|gst|tax|round|bank|ifsc|amount in/i.test(line)) {
      const amount = decimals[decimals.length - 1];
      const unitIdx = tokens.findIndex((t) => UNIT_RE.test(t));
      const qty = unitIdx > 0 && /^\d+(\.\d+)?$/.test(tokens[unitIdx - 1]) ? num(tokens[unitIdx - 1]) : 1;
      const rate = decimals.find((v) => Math.abs(v * qty - amount) <= Math.max(1, amount * 0.001)) ?? amount / qty;
      const pct = percentValues(line);
      rows.push({ name, qty, unitCost: Math.round(rate * 100) / 100, amount, gstRate: pct[0], discountPct: pct[1] });
    }
  }
  return rows;
}

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

/** Best-effort guess of the invoice header from the printed text (used when the QR can't be read). */
export function parseInvoiceHeader(lines: string[]): InvoiceHeaderGuess {
  const out: InvoiceHeaderGuess = {};
  const text = lines.join("\n");
  const gstins = [...new Set(text.toUpperCase().match(GSTIN_RE) ?? [])];
  out.sellerGstin = gstins[0];
  out.buyerGstin = gstins[1];

  // Seller name: the nearest "business-looking" line above the first GSTIN line.
  const gIdx = lines.findIndex((l) => GSTIN_RE.test(l.toUpperCase()));
  GSTIN_RE.lastIndex = 0;
  const bizRe = /(corporation|traders?|enterprises?|agenc(?:y|ies)|distributors?|sales|communications?|pvt|ltd|limited|& co|company)/i;
  for (let i = (gIdx < 0 ? lines.length : gIdx) - 1; i >= 0; i--) {
    if (bizRe.test(lines[i]) && !/buyer|bill to|ship to|invoice/i.test(lines[i])) {
      out.sellerName = lines[i].replace(/\s+/g, " ").trim();
      break;
    }
  }

  const inv = text.match(/\b[A-Z]{1,6}\/[A-Z0-9]{1,6}\/\d{2,6}(?:-\d{2,4})?\/\d{1,8}\b/);
  if (inv) out.invoiceNumber = inv[0];
  const date = text.match(/\b(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{2,4})\b/) ?? text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (date) out.invoiceDate = date[0];
  const ewb = text.match(/\b\d{12}\b/);
  if (ewb) out.eWayBill = ewb[0];

  // Grand total: the amount after a rupee sign, else the biggest amount on a "Total" line.
  const rupee = [...text.matchAll(/[₹Rr][sS]?\.?\s*(\d[\d,]*\.\d{2})/g)].map((m) => num(m[1]));
  const totals = lines.filter((l) => /total/i.test(l)).flatMap((l) => l.split(/\s+/).filter((t) => DECIMAL_RE.test(t)).map(num));
  const pool = rupee.length ? rupee : totals;
  if (pool.length) out.totalValue = Math.max(...pool);
  return out;
}

async function pdfToLines(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    // Group text fragments into visual lines by their vertical position, then read left to right.
    const byY = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3);
      const row = byY.get(y) ?? [];
      row.push({ x: it.transform[4], s: it.str });
      byY.set(y, row);
    }
    [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .forEach(([, row]) => out.push(row.sort((a, b) => a.x - b.x).map((r) => r.s).join(" ")));
  }
  return out;
}

async function imageToLines(file: File, onProgress?: (pct: number) => void): Promise<string[]> {
  const { recognize } = await import("tesseract.js");
  const res = await recognize(file, "eng", {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(Math.round(m.progress * 100));
    },
  });
  return res.data.text.split("\n").map((l: string) => l.trim()).filter(Boolean);
}

async function pdfPagesToOcrLines(file: File, onProgress?: (pct: number) => void): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b as Blob), "image/png"));
    out.push(...(await imageToLines(new File([blob], `p${p}.png`, { type: "image/png" }), onProgress)));
  }
  return out;
}

export async function readInvoiceFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ lines: InvoiceLine[]; rawLines: string[]; source: "pdf" | "photo" }> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  let text = isPdf ? await pdfToLines(file) : await imageToLines(file, onProgress);
  // A PDF with no embedded text is a scanned picture — read it by OCR instead.
  if (isPdf && text.join("").replace(/\s/g, "").length < 40) text = await pdfPagesToOcrLines(file, onProgress);
  return { lines: parseInvoiceLines(text), rawLines: text, source: isPdf ? "pdf" : "photo" };
}

/** Finds and decodes a QR code inside a photo (dense government e-invoice QRs included). */
export async function decodeQrFromImage(file: File): Promise<string | null> {
  const { readBarcodes, setZXingModuleOverrides } = await import("zxing-wasm/reader");
  const wasmUrl = (await import("zxing-wasm/reader/zxing_reader.wasm?url")).default;
  setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) });
  const bmp = await createImageBitmap(file);
  const tryScales = [1, 0.5];
  for (const sc of tryScales) {
    const maxSide = 2600;
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height)) * sc;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const found = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { tryHarder: true, tryRotate: true, formats: ["QRCode"], maxNumberOfSymbols: 1 });
    if (found.length && found[0].text) return found[0].text;
  }
  return null;
}
