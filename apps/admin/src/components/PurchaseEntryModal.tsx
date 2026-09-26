import { useMemo, useState } from "react";
import {
  GST_RATES,
  GST_STATES,
  PURCHASE_PAYMENT_MODES,
  exclusiveFromInclusive,
  isValidGstin,
  isValidImeiLuhn,
  lineAmounts,
  normalizeGstin,
  normalizeImei,
  parseSerials,
  purchaseTotals,
  stateCodeOf,
  taxSummary,
  stateLabel,
  type PurchaseLine,
  type PurchaseTotals,
} from "@sai/shared";
import { Plus, Trash2, X, Eye } from "lucide-react";

/** What the form hands back — line prices are always EX-GST, whichever way they were typed. */
export interface PurchaseEntry {
  partyName: string;
  phone: string;
  gstin: string;
  address: string;
  /** "27-Maharashtra" style, or "" when unknown. */
  partyState: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  placeOfSupply: string;
  paymentMode: string;
  paidAmount: number;
  lines: PurchaseLine[];
  totals: PurchaseTotals;
  terms: string;
  notes: string;
  /** Also put the bill's items into inventory (stock up existing items, create new ones). */
  addToInventory: boolean;
}

interface Props {
  title: string;
  partyLabel: string; // "Wholesaler" | "Vendor"
  showDueDate?: boolean;
  shopState: string; // e.g. "27-Maharashtra"
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (entry: PurchaseEntry) => void;
  onPreview: (entry: PurchaseEntry) => void;
}

interface DraftLine {
  name: string;
  hsn_sac: string;
  serialsText: string;
  quantity: string;
  price: string; // as typed (ex- or incl-GST depending on the toggle)
  gst_rate: number;
}

const blankLine = (): DraftLine => ({ name: "", hsn_sac: "", serialsText: "", quantity: "1", price: "", gst_rate: 18 });

/** Rupees with paise — bills are exact to the paisa, so the on-screen totals must be too. */
const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const today = () => new Date().toISOString().slice(0, 10);

export function PurchaseEntryModal({ title, partyLabel, showDueDate, shopState, error, saving, onClose, onSave, onPreview }: Props) {
  const [partyName, setPartyName] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [partyState, setPartyState] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState(stateCodeOf(shopState));
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paidText, setPaidText] = useState<string | null>(null); // null = follow the payment mode automatically
  const [priceIncludesGst, setPriceIncludesGst] = useState(false);
  const [terms, setTerms] = useState("Thanks for doing business with us!");
  const [notes, setNotes] = useState("");
  const [addToInventory, setAddToInventory] = useState(true);
  const [draft, setDraft] = useState<DraftLine[]>([blankLine()]);
  const [localError, setLocalError] = useState<string | null>(null);

  const gstinTrim = normalizeGstin(gstin);
  const gstinOk = !gstinTrim || isValidGstin(gstinTrim);
  // The supplier's state comes from the GSTIN when one is given, otherwise from the picker.
  const effectiveState = gstinTrim && gstinOk ? stateCodeOf(gstinTrim) : partyState;
  const interState = !!effectiveState && !!placeOfSupply && effectiveState !== placeOfSupply;

  const lines: PurchaseLine[] = useMemo(
    () =>
      draft.map((d) => {
        const typed = Number(d.price) || 0;
        return {
          name: d.name.trim(),
          hsn_sac: d.hsn_sac.trim(),
          serials: parseSerials(d.serialsText),
          quantity: Number(d.quantity) || 0,
          unit_price: priceIncludesGst ? exclusiveFromInclusive(typed, d.gst_rate) : typed,
          gst_rate: d.gst_rate,
        };
      }),
    [draft, priceIncludesGst]
  );
  const totals = useMemo(() => purchaseTotals(lines), [lines]);
  const split = useMemo(
    () => taxSummary(lines.map((l) => ({ hsn: l.hsn_sac, rate: l.gst_rate, ...lineAmounts(l), tax: lineAmounts(l).gst }))),
    [lines]
  );
  const paidAuto = paymentMode === "credit" ? 0 : totals.total;
  const paid = paidText === null ? paidAuto : Number(paidText) || 0;
  const balance = totals.total - paid;

  function update(i: number, patch: Partial<DraftLine>) {
    setDraft((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function buildEntry(): PurchaseEntry | null {
    if (!partyName.trim()) return fail(`${partyLabel} name is required.`);
    if (!gstinOk) return fail("GSTIN isn't valid — it should be 15 characters like 27AAAAA0000A1Z5. Clear it if you don't have it.");
    const filled = lines.filter((l) => l.name || l.unit_price || l.serials.length);
    if (filled.length === 0) return fail("Add at least one item.");
    const seen = new Set<string>();
    for (const [idx, l] of filled.entries()) {
      const n = `Item ${idx + 1}`;
      if (!l.name) return fail(`${n}: enter the item name.`);
      if (!(l.quantity > 0) || !Number.isInteger(l.quantity)) return fail(`${n} (${l.name}): quantity must be a whole number, 1 or more.`);
      if (!(l.unit_price >= 0)) return fail(`${n} (${l.name}): price can't be negative.`);
      if (l.serials.length > l.quantity) return fail(`${n} (${l.name}): ${l.serials.length} serial numbers entered for a quantity of ${l.quantity}.`);
      for (const s of l.serials) {
        const key = s.toUpperCase();
        if (seen.has(key)) return fail(`Serial number ${s} appears more than once on this bill.`);
        seen.add(key);
      }
    }
    if (paid < 0) return fail("Paid amount can't be negative.");
    if (paid > totals.total + 0.005) return fail(`Paid amount (${money(paid)}) is more than the bill total (${money(totals.total)}).`);
    if (showDueDate && dueDate && dueDate < billDate) return fail("Due date can't be before the bill date.");
    setLocalError(null);
    const keep = lines.filter((l) => filled.includes(l));
    return {
      partyName: partyName.trim(),
      phone: phone.trim(),
      gstin: gstinTrim,
      address: address.trim(),
      partyState: effectiveState ? stateLabel(effectiveState) : "",
      billNumber: billNumber.trim(),
      billDate,
      dueDate,
      placeOfSupply: stateLabel(placeOfSupply),
      paymentMode,
      paidAmount: paid,
      lines: keep,
      totals: purchaseTotals(keep),
      terms: terms.trim(),
      notes: notes.trim(),
      addToInventory,
    };
  }

  function fail(msg: string): null {
    setLocalError(msg);
    return null;
  }

  // IMEI-looking serials that fail the check digit are flagged (not blocked — it may be a typo, or a non-phone serial).
  const imeiWarnings = lines.flatMap((l) => l.serials.filter((s) => /^\d{15}$/.test(normalizeImei(s)) && !isValidImeiLuhn(normalizeImei(s))));
  const shownError = localError || error;

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/30 p-3 sm:p-6">
      <div className="card w-full max-w-4xl space-y-4 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {shownError && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{shownError}</div>}

        {/* Supplier + bill details */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{partyLabel} (Bill From)</div>
            <input className="input" placeholder={`${partyLabel} name *`} value={partyName} onChange={(e) => setPartyName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <div>
                <input
                  className={`input ${gstin && !gstinOk ? "!border-red-400" : ""}`}
                  placeholder="GSTIN"
                  maxLength={15}
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                />
                {gstin && !gstinOk && <div className="mt-0.5 text-[10px] text-brand-danger">Not a valid GSTIN yet</div>}
              </div>
            </div>
            <textarea className="input" rows={2} placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
            <select
              className="input"
              value={effectiveState}
              disabled={!!gstinTrim && gstinOk}
              onChange={(e) => setPartyState(e.target.value)}
              title={gstinTrim && gstinOk ? "Taken from the GSTIN" : "Their state (decides CGST+SGST or IGST)"}
            >
              <option value="">{partyLabel}'s state (optional)</option>
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.code}-{s.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bill Details</div>
            <input className="input" placeholder="Bill / invoice number" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
            <div className={`grid gap-2 ${showDueDate ? "grid-cols-2" : "grid-cols-1"}`}>
              <label className="text-[11px] text-gray-500">
                Bill date
                <input type="date" className="input mt-0.5" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
              </label>
              {showDueDate && (
                <label className="text-[11px] text-gray-500">
                  Due date
                  <input type="date" className="input mt-0.5" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </label>
              )}
            </div>
            <label className="block text-[11px] text-gray-500">
              Place of supply
              <select className="input mt-0.5" value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)}>
                {GST_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.code}-{s.name}</option>
                ))}
              </select>
            </label>
            <div className={`rounded-md px-2 py-1.5 text-[11px] ${interState ? "bg-amber-50 text-amber-800" : "bg-gray-50 text-gray-600"}`}>
              {interState ? "Supplier is in another state — the bill will show IGST." : "Same state — the bill will show CGST + SGST."}
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Items</div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={priceIncludesGst} onChange={(e) => setPriceIncludesGst(e.target.checked)} />
              Prices I type include GST
            </label>
          </div>

          {draft.map((d, i) => {
            const eff = lines[i];
            const amt = lineAmounts(eff);
            const serialCount = eff.serials.length;
            return (
              <div key={i} className="space-y-2 rounded-lg border border-border p-2.5">
                <div className="grid gap-2 md:grid-cols-12">
                  <input className="input md:col-span-5" placeholder="Item name *" value={d.name} onChange={(e) => update(i, { name: e.target.value })} />
                  <input className="input md:col-span-2" placeholder="HSN / SAC" value={d.hsn_sac} onChange={(e) => update(i, { hsn_sac: e.target.value })} />
                  <input className="input md:col-span-1" type="number" min={1} placeholder="Qty" value={d.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                  <input
                    className="input md:col-span-2"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={priceIncludesGst ? "Price/unit (incl. GST)" : "Price/unit (ex-GST)"}
                    value={d.price}
                    onChange={(e) => update(i, { price: e.target.value })}
                  />
                  <select className="input md:col-span-2" value={d.gst_rate} onChange={(e) => update(i, { gst_rate: Number(e.target.value) })}>
                    {GST_RATES.map((r) => (
                      <option key={r} value={r}>GST {r}%</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2 md:grid-cols-12">
                  <textarea
                    className="input md:col-span-9"
                    rows={2}
                    placeholder="Serial no. / IMEI — one per line or comma-separated (optional)"
                    value={d.serialsText}
                    onChange={(e) => update(i, { serialsText: e.target.value })}
                  />
                  <div className="flex items-center justify-between text-xs md:col-span-3 md:flex-col md:items-end md:justify-center">
                    <div className="text-right text-gray-500">
                      <div>Price/unit ex-GST: {money(eff.unit_price)}</div>
                      <div>GST: {money(amt.gst)}</div>
                      <div className="font-semibold text-gray-800">Amount: {money(amt.total)}</div>
                    </div>
                    {draft.length > 1 && (
                      <button className="mt-1 flex items-center gap-1 text-brand-danger" onClick={() => setDraft((p) => p.filter((_, idx) => idx !== i))}>
                        <Trash2 size={12} /> Remove
                      </button>
                    )}
                  </div>
                </div>
                {serialCount > 0 && (
                  <div className={`text-[11px] ${serialCount > eff.quantity ? "text-brand-danger" : "text-gray-400"}`}>
                    {serialCount} of {eff.quantity} serial number{eff.quantity === 1 ? "" : "s"} entered
                  </div>
                )}
              </div>
            );
          })}
          <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setDraft((p) => [...p, blankLine()])}>
            <Plus size={13} /> Add item
          </button>
          {imeiWarnings.length > 0 && (
            <div className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">
              These look like IMEIs but fail the check digit — please double-check: {imeiWarnings.slice(0, 5).join(", ")}
              {imeiWarnings.length > 5 ? "…" : ""}
            </div>
          )}
        </div>

        {/* Totals + payment */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment</div>
            <select
              className="input"
              value={paymentMode}
              onChange={(e) => {
                setPaymentMode(e.target.value);
                setPaidText(null);
              }}
            >
              {PURCHASE_PAYMENT_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <label className="block text-[11px] text-gray-500">
              Amount paid now
              <input
                type="number"
                min={0}
                step="0.01"
                className="input mt-0.5"
                value={paidText === null ? String(paidAuto || "") : paidText}
                onChange={(e) => setPaidText(e.target.value)}
              />
            </label>
            <textarea className="input" rows={2} placeholder="Terms & conditions (printed on the bill)" value={terms} onChange={(e) => setTerms(e.target.value)} />
            <textarea className="input" rows={2} placeholder="Internal notes (not printed)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
            <Row label="Taxable value" value={money(totals.taxable)} />
            {interState ? (
              <Row label="IGST" value={money(totals.gst)} />
            ) : (
              <>
                <Row label="CGST" value={money(split.cgst)} />
                <Row label="SGST" value={money(split.sgst)} />
              </>
            )}
            <Row label="Sub total" value={money(totals.subTotal)} />
            <Row label="Round off" value={`${totals.roundOff < 0 ? "-" : totals.roundOff > 0 ? "+" : ""}${money(Math.abs(totals.roundOff))}`} />
            <div className="flex justify-between border-t border-border pt-1 text-base font-semibold text-gray-900">
              <span>Total</span>
              <span>{money(totals.total)}</span>
            </div>
            <Row label="Paid" value={money(paid)} />
            <div className={`flex justify-between font-medium ${balance > 0.005 ? "text-brand-danger" : "text-brand-success"}`}>
              <span>Balance</span>
              <span>{money(balance)}</span>
            </div>
          </div>
        </div>

        <label className="flex items-start gap-2 rounded-md border border-border bg-accent/30 p-2.5 text-sm text-gray-700">
          <input type="checkbox" className="mt-0.5 rounded border-gray-300 text-brand-primary" checked={addToInventory} onChange={(e) => setAddToInventory(e.target.checked)} />
          <span>
            <b>Add these items to inventory</b>
            <span className="block text-xs text-gray-500">
              Existing items get their stock raised (or the serials added); new items are created with this bill's price as cost. Untick for parts you only use for repairs.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-secondary"
            onClick={() => {
              const e = buildEntry();
              if (e) onPreview(e);
            }}
          >
            <Eye size={13} /> Preview bill
          </button>
          <button
            className="btn-primary"
            disabled={saving}
            onClick={() => {
              const e = buildEntry();
              if (e) onSave(e);
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-gray-600">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
