/**
 * Payment Mode Split (requirements doc §1.2 / §12 Payment Management):
 * how much money has come in through each mode — UPI, Cash, Card,
 * Finance/EMI — across both offline sales and website orders, folding the
 * standalone EMI/Finance ledger in as "Finance / EMI" regardless of which
 * table a payment happened to land in.
 *
 * Pure aggregation function — each app passes in whatever rows it already
 * fetched from its own supabase client, so this has no data-fetching
 * dependency of its own.
 */

export type PaymentMode = "UPI" | "Cash" | "Card" | "Finance / EMI" | "Other";

const MODE_MAP: Record<string, PaymentMode> = {
  upi: "UPI",
  cash: "Cash",
  card: "Card",
  bank_transfer: "Card", // closest existing bucket; no separate "bank transfer" slot in the 4 required modes
  emi: "Finance / EMI",
  finance: "Finance / EMI",
};

export function normalizePaymentMode(raw: string | null | undefined): PaymentMode {
  if (!raw) return "Other";
  return MODE_MAP[raw.toLowerCase()] ?? "Other";
}

export interface PaymentSplitRow {
  amount: number;
  paymentMethod: string | null | undefined;
}

export interface PaymentSplitResult {
  byMode: Record<PaymentMode, number>;
  total: number;
}

const EMPTY_SPLIT: Record<PaymentMode, number> = {
  UPI: 0,
  Cash: 0,
  Card: 0,
  "Finance / EMI": 0,
  Other: 0,
};

export function computePaymentSplit(rows: PaymentSplitRow[], emiTotal = 0): PaymentSplitResult {
  const byMode = { ...EMPTY_SPLIT };
  let total = 0;
  for (const r of rows) {
    const mode = normalizePaymentMode(r.paymentMethod);
    const amt = Number(r.amount) || 0;
    byMode[mode] += amt;
    total += amt;
  }
  // EMI/Finance records live in their own table (no payment_method column on
  // sales for "emi") — fold that ledger's total into the same bucket so the
  // split reflects all money actually financed, not just sales rows tagged
  // with a payment_method the sales form never actually offers as "emi".
  byMode["Finance / EMI"] += emiTotal;
  total += emiTotal;
  return { byMode, total };
}
