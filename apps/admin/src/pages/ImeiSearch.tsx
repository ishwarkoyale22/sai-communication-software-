import { useState } from "react";
import { formatCurrency, formatDateTime, validateImei, normalizeImei } from "@sai/shared";
import type { InventoryUnit, ImeiHistoryEvent, InventoryUnitStatus, ImeiHistoryEventType } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { Search, Smartphone, Clock, Banknote } from "lucide-react";

interface UnitFinanceRow {
  id: string;
  finance_amount: number;
  status: string;
  finance_partner: { name: string } | null;
}

// Allowed manual transitions per current status — keeps the lifecycle
// controlled (spec §16) instead of letting the UI jump to any status.
const TRANSITIONS: Record<InventoryUnitStatus, { to: InventoryUnitStatus; label: string; eventType: ImeiHistoryEventType }[]> = {
  in_stock: [
    { to: "damaged", label: "Mark Damaged", eventType: "status_change" },
    { to: "lost", label: "Mark Lost", eventType: "status_change" },
  ],
  sold: [{ to: "returned", label: "Mark Returned", eventType: "return" }],
  returned: [
    { to: "in_stock", label: "Return to Stock", eventType: "in_stock" },
    { to: "warranty", label: "Send to Warranty", eventType: "warranty" },
  ],
  warranty: [{ to: "repair", label: "Move to Repair", eventType: "repair" }],
  repair: [
    { to: "in_stock", label: "Return to Stock", eventType: "in_stock" },
    { to: "sold", label: "Return to Customer", eventType: "status_change" },
  ],
  replaced: [],
  damaged: [],
  lost: [],
  pending_imei: [],
  cancelled: [],
};

interface UnitResult extends InventoryUnit {
  inventory?: { name: string; model: string } | null;
  customer?: { name: string; phone: string } | null;
  supplier?: { name: string } | null;
}

const STATUS_COLOR: Record<InventoryUnitStatus, string> = {
  in_stock: "text-emerald-600",
  sold: "text-gray-500",
  returned: "text-amber-600",
  warranty: "text-amber-600",
  repair: "text-amber-600",
  replaced: "text-blue-600",
  damaged: "text-brand-danger",
  lost: "text-brand-danger",
  pending_imei: "text-amber-600",
  cancelled: "text-gray-400",
};

export function ImeiSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnitResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UnitResult | null>(null);
  const [history, setHistory] = useState<ImeiHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [unitFinance, setUnitFinance] = useState<UnitFinanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showReplaceForm, setShowReplaceForm] = useState(false);
  const [replaceImei1, setReplaceImei1] = useState("");
  const [replaceImei2, setReplaceImei2] = useState("");
  const [replaceSerial, setReplaceSerial] = useState("");

  async function search() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    setSelected(null);
    try {
      // Search by IMEI 1, IMEI 2, Serial Number, or Product name/model
      // directly on inventory_units; Purchase Invoice Ref matches too.
      // Sales invoice / customer / supplier search is done via a second
      // lookup below since those live on related tables.
      const { data: byUnit } = await supabase
        .from("inventory_units")
        .select("*, inventory:inventory_id(name, model), customer:customer_id(name, phone), supplier:supplier_id(name)")
        .or(
          `imei_1.ilike.%${q}%,imei_2.ilike.%${q}%,serial_no.ilike.%${q}%,purchase_invoice_ref.ilike.%${q}%`
        )
        .order("created_at", { ascending: false })
        .limit(50);

      // Sales invoice number search: find matching sales_items, then their
      // linked units.
      const { data: bySaleItem } = await supabase
        .from("sales_items")
        .select("id, sales!inner(invoice_number)")
        .eq("sales.invoice_number", q);
      let byInvoice: UnitResult[] = [];
      if (bySaleItem && bySaleItem.length > 0) {
        const itemIds = bySaleItem.map((r: any) => r.id);
        const { data } = await supabase
          .from("inventory_units")
          .select("*, inventory:inventory_id(name, model), customer:customer_id(name, phone), supplier:supplier_id(name)")
          .in("sale_item_id", itemIds);
        byInvoice = (data as UnitResult[]) ?? [];
      }

      const merged = new Map<string, UnitResult>();
      for (const u of [...(byUnit as UnitResult[] ?? []), ...byInvoice]) merged.set(u.id, u);
      setResults(Array.from(merged.values()));
      if (merged.size === 0) setError(`No stock unit found matching "${q}".`);
    } catch (err: any) {
      setError(err?.message || "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function openUnit(unit: UnitResult) {
    setSelected(unit);
    setHistoryLoading(true);
    const { data } = await supabase
      .from("imei_history")
      .select("*")
      .eq("stock_unit_id", unit.id)
      .order("event_date", { ascending: true });
    setHistory((data as ImeiHistoryEvent[]) ?? []);
    setHistoryLoading(false);

    const { data: finance } = await supabase
      .from("finance_transactions")
      .select("id, finance_amount, status, finance_partner:finance_partner_id(name)")
      .eq("stock_unit_id", unit.id);
    setUnitFinance((finance as unknown as UnitFinanceRow[]) ?? []);
  }

  async function refreshSelected(unitId: string) {
    const { data } = await supabase
      .from("inventory_units")
      .select("*, inventory:inventory_id(name, model), customer:customer_id(name, phone), supplier:supplier_id(name)")
      .eq("id", unitId)
      .single();
    if (data) {
      setSelected(data as UnitResult);
      setResults((prev) => prev.map((r) => (r.id === unitId ? (data as UnitResult) : r)));
    }
    await openUnit(data as UnitResult);
  }

  async function applyTransition(to: InventoryUnitStatus, eventType: ImeiHistoryEventType) {
    if (!selected) return;
    setActionError(null);
    setTransitioning(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      const from = selected.status;

      const { error: updErr } = await supabase
        .from("inventory_units")
        .update({ status: to, updated_by: userId })
        .eq("id", selected.id);
      if (updErr) throw updErr;

      const { error: histErr } = await supabase.from("imei_history").insert({
        stock_unit_id: selected.id,
        imei_1: selected.imei_1,
        imei_2: selected.imei_2,
        event_type: eventType,
        from_status: from,
        to_status: to,
        created_by: userId,
      });
      if (histErr) throw histErr;

      await refreshSelected(selected.id);
    } catch (err: any) {
      setActionError(err?.message || "Failed to update status.");
    } finally {
      setTransitioning(false);
    }
  }

  // Replacement (spec §14): the OLD unit (in warranty/repair) is marked
  // 'replaced' and linked to a brand-new unit carrying the new IMEI(s),
  // which enters stock as 'in_stock'. Both histories are preserved and
  // cross-referenced — nothing about the old unit's IMEI/history is deleted.
  async function submitReplacement() {
    if (!selected) return;
    setActionError(null);

    const imei1 = normalizeImei(replaceImei1);
    const imei2 = normalizeImei(replaceImei2);
    const serial = replaceSerial.trim();
    if (!imei1 && !imei2 && !serial) {
      setActionError("Enter the new unit's IMEI 1, IMEI 2 or Serial No.");
      return;
    }
    if (imei1) {
      const res = validateImei(replaceImei1);
      if (!res.ok) return setActionError(`IMEI 1: ${res.message}`);
    }
    if (imei2) {
      const res = validateImei(replaceImei2);
      if (!res.ok) return setActionError(`IMEI 2: ${res.message}`);
    }
    if (imei1 && imei1 === imei2) return setActionError("IMEI 1 and IMEI 2 cannot be the same.");

    setTransitioning(true);
    try {
      for (const val of [imei1, imei2].filter(Boolean)) {
        const { data: dupe } = await supabase
          .from("inventory_units")
          .select("id")
          .or(`imei_1.eq.${val},imei_2.eq.${val}`)
          .limit(1)
          .maybeSingle();
        if (dupe) throw new Error(`IMEI ${val} already exists.`);
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      const newUnitId = crypto.randomUUID();

      const { error: newUnitErr } = await supabase.from("inventory_units").insert({
        id: newUnitId,
        inventory_id: selected.inventory_id,
        imei_1: imei1 || null,
        imei_2: imei2 || null,
        serial_no: serial || null,
        status: "in_stock",
        replaced_from_unit_id: selected.id,
        created_by: userId,
        updated_by: userId,
      });
      if (newUnitErr) throw newUnitErr;

      const { error: oldUnitErr } = await supabase
        .from("inventory_units")
        .update({ status: "replaced", replaced_by_unit_id: newUnitId, updated_by: userId })
        .eq("id", selected.id);
      if (oldUnitErr) throw oldUnitErr;

      await supabase.from("imei_history").insert([
        {
          stock_unit_id: selected.id,
          imei_1: selected.imei_1,
          imei_2: selected.imei_2,
          event_type: "replaced",
          from_status: selected.status,
          to_status: "replaced",
          reference_type: "replacement",
          reference_id: newUnitId,
          notes: `Replaced by new unit ${imei1 || imei2 || serial}`,
          created_by: userId,
        },
        {
          stock_unit_id: newUnitId,
          imei_1: imei1 || null,
          imei_2: imei2 || null,
          event_type: "purchase",
          to_status: "in_stock",
          reference_type: "replacement",
          reference_id: selected.id,
          notes: `Issued as replacement for ${selected.imei_1 || selected.imei_2 || selected.serial_no}`,
          created_by: userId,
        },
      ]);

      setShowReplaceForm(false);
      setReplaceImei1("");
      setReplaceImei2("");
      setReplaceSerial("");
      await refreshSelected(selected.id);
    } catch (err: any) {
      setActionError(err?.message || "Failed to create replacement — the new IMEI may already be in use.");
    } finally {
      setTransitioning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">IMEI / Serial Search</h1>
        <p className="text-sm text-gray-500">
          Search by IMEI 1, IMEI 2, Serial No., Product, Purchase Invoice, or Sales Invoice.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Enter IMEI, serial number, or invoice number..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button className="btn-primary" onClick={search} disabled={searching}>
          <Search size={14} /> {searching ? "Searching..." : "Search"}
        </button>
      </div>

      {error && <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Product</th>
                <th>IMEI / Serial</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((u) => (
                <tr key={u.id} className={`cursor-pointer ${selected?.id === u.id ? "bg-brand-primary/5" : ""}`} onClick={() => openUnit(u)}>
                  <td className="font-medium text-gray-800">
                    {u.inventory?.name} {u.inventory?.model}
                  </td>
                  <td className="font-mono text-xs">
                    {u.imei_1 ?? "-"}
                    {u.imei_2 ? ` / ${u.imei_2}` : ""}
                    {u.serial_no ? ` (SN: ${u.serial_no})` : ""}
                  </td>
                  <td className={STATUS_COLOR[u.status]}>{u.status.replace("_", " ")}</td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-gray-400">
                    <Smartphone className="mx-auto mb-2 text-gray-300" size={24} />
                    Search for a stock unit to see results here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="card space-y-4 p-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">
                {selected.inventory?.name} {selected.inventory?.model}
              </h2>
              <span className={`text-xs font-medium ${STATUS_COLOR[selected.status]}`}>{selected.status.replace("_", " ")}</span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-gray-500">IMEI 1</dt>
              <dd className="font-mono">{selected.imei_1 ?? "-"}</dd>
              <dt className="text-gray-500">IMEI 2</dt>
              <dd className="font-mono">{selected.imei_2 ?? "-"}</dd>
              <dt className="text-gray-500">Serial No.</dt>
              <dd className="font-mono">{selected.serial_no ?? "-"}</dd>
              <dt className="text-gray-500">Supplier</dt>
              <dd>{selected.supplier?.name ?? "-"}</dd>
              <dt className="text-gray-500">Purchase Invoice</dt>
              <dd>{selected.purchase_invoice_ref ?? "-"}</dd>
              <dt className="text-gray-500">Purchase Price</dt>
              <dd>{selected.purchase_price ? `₹${selected.purchase_price}` : "-"}</dd>
              <dt className="text-gray-500">Customer</dt>
              <dd>{selected.customer?.name ?? "-"}</dd>
              <dt className="text-gray-500">Sold At</dt>
              <dd>{selected.sold_at ? formatDateTime(selected.sold_at) : "-"}</dd>
            </dl>

            {actionError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger whitespace-pre-wrap">{actionError}</div>
            )}

            <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
              {TRANSITIONS[selected.status].map((t) => (
                <button
                  key={t.to}
                  className="btn-secondary !py-1 text-xs"
                  disabled={transitioning}
                  onClick={() => applyTransition(t.to, t.eventType)}
                >
                  {t.label}
                </button>
              ))}
              {(selected.status === "warranty" || selected.status === "repair") && (
                <button className="btn-primary !py-1 text-xs" disabled={transitioning} onClick={() => setShowReplaceForm((v) => !v)}>
                  Replace Unit
                </button>
              )}
            </div>

            {showReplaceForm && (
              <div className="space-y-2 rounded-md border border-border bg-gray-50 p-3">
                <p className="text-xs font-medium text-gray-600">Issue replacement — enter the new unit's identifiers:</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <input className="input !py-1 text-xs" placeholder="New IMEI 1" value={replaceImei1} onChange={(e) => setReplaceImei1(e.target.value)} />
                  <input className="input !py-1 text-xs" placeholder="New IMEI 2" value={replaceImei2} onChange={(e) => setReplaceImei2(e.target.value)} />
                  <input className="input !py-1 text-xs" placeholder="New Serial No." value={replaceSerial} onChange={(e) => setReplaceSerial(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2">
                  <button className="btn-ghost !py-1 text-xs" onClick={() => setShowReplaceForm(false)}>
                    Cancel
                  </button>
                  <button className="btn-primary !py-1 text-xs" disabled={transitioning} onClick={submitReplacement}>
                    {transitioning ? "Saving..." : "Confirm Replacement"}
                  </button>
                </div>
              </div>
            )}

            {selected.replaced_by_unit_id && (
              <p className="text-xs text-blue-600">
                Replaced by a new unit —{" "}
                <button className="underline" onClick={() => refreshSelected(selected.replaced_by_unit_id!)}>
                  view it
                </button>
              </p>
            )}
            {selected.replaced_from_unit_id && (
              <p className="text-xs text-blue-600">
                Issued as a replacement for another unit —{" "}
                <button className="underline" onClick={() => refreshSelected(selected.replaced_from_unit_id!)}>
                  view it
                </button>
              </p>
            )}

            {unitFinance.length > 0 && (
              <div className="border-t border-border pt-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                  <Banknote size={13} /> Finance History
                </div>
                <div className="space-y-1.5">
                  {unitFinance.map((f) => (
                    <div key={f.id} className="flex items-center justify-between text-xs">
                      <span>{f.finance_partner?.name ?? "-"}</span>
                      <span className="capitalize text-gray-500">{f.status.replace(/_/g, " ")}</span>
                      <span className="font-medium">{formatCurrency(f.finance_amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-border pt-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                <Clock size={13} /> Timeline
              </div>
              {historyLoading ? (
                <p className="text-xs text-gray-400">Loading...</p>
              ) : (
                <ol className="space-y-3 border-l border-gray-200 pl-3">
                  {history.map((h) => (
                    <li key={h.id} className="relative text-xs">
                      <span className="absolute -left-[17px] top-0.5 h-2 w-2 rounded-full bg-brand-primary" />
                      <div className="font-medium capitalize text-gray-800">{h.event_type.replace("_", " ")}</div>
                      <div className="text-gray-500">{formatDateTime(h.event_date)}</div>
                      {h.reference_id && <div className="text-gray-500">Ref: {h.reference_id}</div>}
                      {h.from_status && h.to_status && (
                        <div className="text-gray-500">
                          {h.from_status.replace("_", " ")} → {h.to_status.replace("_", " ")}
                        </div>
                      )}
                      {h.notes && <div className="text-gray-500">{h.notes}</div>}
                    </li>
                  ))}
                  {history.length === 0 && <p className="text-xs text-gray-400">No history recorded.</p>}
                </ol>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
