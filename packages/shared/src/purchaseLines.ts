/**
 * Shared maths + reference data for supplier bills (wholesaler invoices and third-party purchases).
 * Both the entry forms and the printed bill use these, so what you type, what is stored and what is
 * printed always agree to the paisa.
 *
 * Money convention (same as a real GST bill): each line has a Price/Unit EXCLUDING GST and a GST rate;
 * line GST = qty x unit x rate; line amount = taxable + GST. The bill total is rounded to the rupee
 * (shown as "Round Off" on the bill).
 */

export interface PurchaseLine {
  name: string;
  hsn_sac: string;
  /** IMEI / serial numbers, one per unit. May be fewer than quantity (not every item is serialised). */
  serials: string[];
  quantity: number;
  /** Price per unit, excluding GST. */
  unit_price: number;
  /** GST rate in percent (0, 5, 12, 18, 28 ...). */
  gst_rate: number;
}

export const GST_RATES = [0, 5, 12, 18, 28] as const;

export const PURCHASE_PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "credit", label: "Credit" },
] as const;

export function paymentModeLabel(mode: string | null | undefined): string {
  if (!mode) return "-";
  const known = PURCHASE_PAYMENT_MODES.find((m) => m.value === mode.toLowerCase());
  return known ? known.label : mode.charAt(0).toUpperCase() + mode.slice(1).replace(/_/g, " ");
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LineAmounts {
  taxable: number;
  gst: number;
  total: number;
}

export function lineAmounts(line: Pick<PurchaseLine, "quantity" | "unit_price" | "gst_rate">): LineAmounts {
  const taxable = round2((Number(line.quantity) || 0) * (Number(line.unit_price) || 0));
  const gst = round2((taxable * (Number(line.gst_rate) || 0)) / 100);
  return { taxable, gst, total: round2(taxable + gst) };
}

/** Converts a GST-inclusive price (what many suppliers quote) to the ex-GST price stored on the line. */
export function exclusiveFromInclusive(inclusive: number, gstRate: number): number {
  return round2(inclusive / (1 + (Number(gstRate) || 0) / 100));
}

export interface PurchaseTotals {
  taxable: number;
  gst: number;
  /** Sum of line amounts before rounding. */
  subTotal: number;
  /** Rounded to the nearest rupee — the amount actually payable. */
  total: number;
  /** total - subTotal (can be negative). */
  roundOff: number;
  quantity: number;
}

export function purchaseTotals(lines: PurchaseLine[]): PurchaseTotals {
  let taxable = 0;
  let gst = 0;
  let quantity = 0;
  for (const l of lines) {
    const a = lineAmounts(l);
    taxable += a.taxable;
    gst += a.gst;
    quantity += Number(l.quantity) || 0;
  }
  taxable = round2(taxable);
  gst = round2(gst);
  const subTotal = round2(taxable + gst);
  const total = Math.round(subTotal);
  return { taxable, gst, subTotal, total, roundOff: round2(total - subTotal), quantity };
}

// ---------------------------------------------------------------------------------------------
// GST states / GSTIN
// ---------------------------------------------------------------------------------------------

export const GST_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu & Kashmir" }, { code: "02", name: "Himachal Pradesh" }, { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" }, { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" }, { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" }, { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" }, { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" }, { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" }, { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" }, { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra & Nagar Haveli and Daman & Diu" }, { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" }, { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" }, { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman & Nicobar Islands" }, { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

/** "27-Maharashtra" style label used on bills. */
export function stateLabel(code: string | null | undefined): string {
  if (!code) return "";
  const c = code.slice(0, 2);
  const s = GST_STATES.find((x) => x.code === c);
  return s ? `${s.code}-${s.name}` : code;
}

/** The 2-digit state code from either "27-Maharashtra" or a GSTIN; "" if unknown. */
export function stateCodeOf(value: string | null | undefined): string {
  const m = (value ?? "").trim().match(/^(\d{2})/);
  return m ? m[1] : "";
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normalizeGstin(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Format check only (15 characters, valid state code) — not a live GST portal lookup. */
export function isValidGstin(raw: string): boolean {
  const g = normalizeGstin(raw);
  return GSTIN_RE.test(g) && GST_STATES.some((s) => s.code === g.slice(0, 2));
}

/** Splits free text ("a, b\nc") into a clean list of serial numbers / IMEIs. */
export function parseSerials(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// Tax summary (grouped by HSN + rate), identical on the entry form and on the printed bill
// ---------------------------------------------------------------------------------------------

export interface TaxSummaryRow {
  hsn: string;
  rate: number;
  taxable: number;
  tax: number;
  /** Half of `tax` (rounded to paise); `sgst` is the remainder, so CGST + SGST always equals `tax` exactly. */
  cgst: number;
  sgst: number;
}

export interface TaxSummary {
  rows: TaxSummaryRow[];
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
}

export function taxSummary(items: { hsn: string; rate: number; taxable: number; tax: number }[]): TaxSummary {
  const groups = new Map<string, { hsn: string; rate: number; taxable: number; tax: number }>();
  for (const it of items) {
    const hsn = (it.hsn ?? "").trim();
    const key = `${hsn}|${it.rate}`;
    const g = groups.get(key);
    if (g) {
      g.taxable += it.taxable;
      g.tax += it.tax;
    } else {
      groups.set(key, { hsn, rate: it.rate, taxable: it.taxable, tax: it.tax });
    }
  }
  const rows: TaxSummaryRow[] = Array.from(groups.values()).map((g) => {
    const taxable = round2(g.taxable);
    const tax = round2(g.tax);
    const cgst = round2(tax / 2);
    return { hsn: g.hsn, rate: g.rate, taxable, tax, cgst, sgst: round2(tax - cgst) };
  });
  const sum = (f: (r: TaxSummaryRow) => number) => round2(rows.reduce((a, r) => a + f(r), 0));
  return { rows, taxable: sum((r) => r.taxable), tax: sum((r) => r.tax), cgst: sum((r) => r.cgst), sgst: sum((r) => r.sgst) };
}
