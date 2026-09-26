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
}

export interface InvoiceLine {
  name: string;
  qty: number;
  unitCost: number;
  amount: number;
  hsn?: string;
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
export function parseInvoiceLines(lines: string[]): InvoiceLine[] {
  const rows: InvoiceLine[] = [];
  let last: InvoiceLine | null = null;

  for (const line of lines) {
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

      last = { name, qty: qty || 1, unitCost: Math.round(unitCost * 100) / 100, amount, hsn };
      rows.push(last);
    } else if (last && !decimals.length && /^[A-Za-z(]/.test(line.trim()) && tokens.length <= 8 && !/total|gst|tax|amount|bank|ifsc|round/i.test(line)) {
      // A wrapped continuation of the previous item's name.
      last.name = `${last.name} ${line.trim()}`;
    }
  }
  return rows;
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

export async function readInvoiceFile(file: File, onProgress?: (pct: number) => void): Promise<{ lines: InvoiceLine[]; source: "pdf" | "photo" }> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const text = isPdf ? await pdfToLines(file) : await imageToLines(file, onProgress);
  return { lines: parseInvoiceLines(text), source: isPdf ? "pdf" : "photo" };
}
