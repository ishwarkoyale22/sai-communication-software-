import { useEffect, useState } from "react";
import {
  formatCurrency,
  formatDateTime,
  generateSimpleInvoicePdf,
  openRetailTaxInvoice,
  openBlankInvoiceWindow,
  GST_STATES,
  isValidGstin,
  normalizeGstin,
  stateCodeOf,
  stateLabel,
  type RetailTaxInvoiceInput,
} from "@sai/shared";
import { supabase, SHOP } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2, X, Printer, Eye } from "lucide-react";
import {
  fetchHamperCatalog,
  hamperDisplayName,
  hamperStats,
  maxAddableHampers,
  type HamperCatalog,
  type ComponentInventory,
} from "../lib/hampers";

interface StaffLite {
  id: string;
  name: string;
}
interface FinancePartnerLite {
  id: string;
  name: string;
}
interface InventoryItem {
  id: string;
  name: string;
  model: string;
  price: number;
  stock: number;
  is_serialized: boolean;
}
interface AvailableUnit {
  id: string;
  imei_1: string | null;
  imei_2: string | null;
  serial_no: string | null;
}
interface GiftItem {
  id: string;
  name: string;
  price: number;
  cost_price: number;
  stock: number;
  is_active: boolean;
}
interface HamperCartLine {
  key: string;
  hamper_id: string;
  /** Name incl. contents, e.g. "Birthday Hamper (Charger x1, ...)" — what lands on the invoice line. */
  name: string;
  quantity: number;
  unit_price: number;
  /** product cost + packaging at the moment it was added (profit snapshot) */
  unit_cost: number;
}
interface GiftCartLine {
  key: string;
  gift_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
}

/** Human-readable identifier for a stock unit — IMEI(s) preferred, serial as fallback/extra. */
function unitLabel(u: { imei_1: string | null; imei_2: string | null; serial_no: string | null }): string {
  const parts: string[] = [];
  if (u.imei_1) parts.push(u.imei_1);
  if (u.imei_2) parts.push(u.imei_2);
  if (u.serial_no) parts.push(`SN: ${u.serial_no}`);
  return parts.join(" / ") || "-";
}
interface Sale {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  sale_type: string;
  total_amount: number;
  discount: number;
  final_amount: number;
  payment_method: string;
  payment_status: string;
  notes: string | null;
  created_at: string;
  gst_rate: number | null;
  customer_gstin?: string | null;
  customer_address?: string | null;
  customer_state?: string | null;
  invoice_date?: string | null;
  amount_received?: number | null;
  terms?: string | null;
}
interface CartLine {
  /** Unique per cart line — the inventory_id for a merged non-serialized line, or the specific unit_id for a serialized one (each physical unit is its own line). */
  key: string;
  inventory_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  /** Serial No. / IMEI(s) for this line, comma-separated when quantity > 1 — optional, shown on the printed invoice when present. */
  serial_no: string;
  /** Set when this line is one specific serialized inventory_units row — quantity is locked at 1 and serial_no is read-only, sourced from the picked unit. */
  unit_id: string | null;
  /** Original unit shape, kept so removeLine can restore it to the picker exactly (imei_1/imei_2 split intact). */
  unitSnapshot?: AvailableUnit;
  /** Optional HSN/SAC printed on the invoice. */
  hsn_sac: string;
  /** GST % for this line; null = use the sale's GST rate. */
  gst_rate: number | null;
}

const GST_RATE_OPTIONS = [0, 5, 12, 18, 28];

/** Today as YYYY-MM-DD in the shop's local time (toISOString would give the UTC date). */
function localDateStr(d = new Date()) {
  return d.toLocaleDateString("en-CA");
}

/** Rupees with paise, for the invoice summary (bills are exact to the paisa). */
const money2 = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function nextInvoiceNumber() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function Sales() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [staffList, setStaffList] = useState<StaffLite[]>([]);
  const [financePartners, setFinancePartners] = useState<FinancePartnerLite[]>([]);
  const [staffId, setStaffId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "website" | "in_store">("all");
  const [showForm, setShowForm] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerDob, setCustomerDob] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [gstRateChoice, setGstRateChoice] = useState<string>("18");
  // Optional GST-invoice details — left blank they change nothing about how a sale worked before.
  const [showMore, setShowMore] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(localDateStr());
  const [customerGstin, setCustomerGstin] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerStateCode, setCustomerStateCode] = useState("");
  const [receivedText, setReceivedText] = useState<string | null>(null); // null = follows the payment method
  const [terms, setTerms] = useState("Thanks for doing business with us!");
  const [gstRateCustom, setGstRateCustom] = useState<number>(18);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [giftCart, setGiftCart] = useState<GiftCartLine[]>([]);
  const [pickGiftId, setPickGiftId] = useState("");
  const [hamperCatalog, setHamperCatalog] = useState<HamperCatalog>({ hampers: [], components: [], inventory: [] });
  const [hamperCart, setHamperCart] = useState<HamperCartLine[]>([]);
  const [pickHamperId, setPickHamperId] = useState("");
  const [pickId, setPickId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false);
  const [availableUnits, setAvailableUnits] = useState<AvailableUnit[]>([]);
  const [pickUnitId, setPickUnitId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [invoiceLoadingId, setInvoiceLoadingId] = useState<string | null>(null);

  useEffect(() => {
    load();
    supabase.from("inventory").select("id, name, model, price, stock, is_serialized").eq("is_active", true).order("name").then(({ data }) => setInventory((data as InventoryItem[]) ?? []));
    supabase.from("gifts").select("id, name, price, cost_price, stock, is_active").eq("is_active", true).order("name").then(({ data }) => setGifts((data as GiftItem[]) ?? []));
    refreshHampers();
    supabase.from("staff").select("id, name").eq("is_active", true).order("name").then(({ data }) => setStaffList((data as StaffLite[]) ?? []));
    supabase.from("finance_partners").select("id, name").eq("is_active", true).order("name").then(({ data }) => setFinancePartners((data as FinancePartnerLite[]) ?? []));
    const channel = supabase
      .channel("sales-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function refreshHampers() {
    setHamperCatalog(await fetchHamperCatalog(supabase, { activeOnly: true }));
  }

  async function load() {
    const { data } = await supabase.from("sales").select("*").order("created_at", { ascending: false });
    setSales((data as Sale[]) ?? []);
  }

  async function loadAvailableUnits(inventoryId: string) {
    const { data } = await supabase
      .from("inventory_units")
      .select("id, imei_1, imei_2, serial_no")
      .eq("inventory_id", inventoryId)
      .eq("status", "in_stock")
      .order("created_at");
    setAvailableUnits((data as AvailableUnit[]) ?? []);
  }

  function onPickItem(id: string) {
    setPickId(id);
    setPickUnitId("");
    const item = inventory.find((i) => i.id === id);
    setItemSearch(item ? `${item.name} ${item.model}`.trim() : "");
    setItemDropdownOpen(false);
    if (item?.is_serialized) loadAvailableUnits(id);
    else setAvailableUnits([]);
  }

  const filteredInventory = inventory.filter((i) =>
    `${i.name} ${i.model}`.toLowerCase().includes(itemSearch.toLowerCase())
  );

  function addToCart() {
    const item = inventory.find((i) => i.id === pickId);
    if (!item) return;

    if (item.is_serialized) {
      const unit = availableUnits.find((u) => u.id === pickUnitId);
      if (!unit) return; // Add button is disabled until a serial is picked
      setCart((prev) => [
        ...prev,
        {
          key: unit.id,
          inventory_id: item.id,
          item_name: `${item.name} ${item.model}`,
          quantity: 1,
          unit_price: item.price,
          serial_no: unitLabel(unit),
          unit_id: unit.id,
          unitSnapshot: unit,
          hsn_sac: "",
          gst_rate: null,
        },
      ]);
      setAvailableUnits((prev) => prev.filter((u) => u.id !== unit.id));
      setPickUnitId("");
      return;
    }

    setCart((prev) => {
      const existing = prev.find((l) => l.inventory_id === item.id && l.unit_id === null);
      if (existing) {
        return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { key: item.id, inventory_id: item.id, item_name: `${item.name} ${item.model}`, quantity: 1, unit_price: item.price, serial_no: "", unit_id: null, hsn_sac: "", gst_rate: null }];
    });
    // Clear the search box too, so the next item can be searched and added right away.
    setPickId("");
    setItemSearch("");
  }

  function updateQty(key: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, qty) } : l)));
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function updateSerial(key: string, serial_no: string) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, serial_no } : l)));
  }

  function removeLine(key: string) {
    // Returning a serialized unit to the cart's available-serials picker so
    // it isn't lost if the cashier removed it by mistake before completing the sale.
    setCart((prev) => {
      const line = prev.find((l) => l.key === key);
      if (line?.unit_id && line.inventory_id === pickId && line.unitSnapshot) {
        setAvailableUnits((units) => [...units, line.unitSnapshot!]);
      }
      return prev.filter((l) => l.key !== key);
    });
  }

  function addGiftToCart() {
    const gift = gifts.find((g) => g.id === pickGiftId);
    if (!gift) return;
    setGiftCart((prev) => {
      const existing = prev.find((l) => l.gift_id === gift.id);
      const alreadyInCart = existing?.quantity ?? 0;
      if (alreadyInCart + 1 > gift.stock) return prev; // guarded again on the Add button's disabled state
      if (existing) {
        return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { key: gift.id, gift_id: gift.id, name: gift.name, quantity: 1, unit_price: gift.price, unit_cost: gift.cost_price }];
    });
    setPickGiftId("");
  }

  function updateGiftQty(key: string, qty: number) {
    const gift = gifts.find((g) => g.id === key);
    const clamped = gift ? Math.min(Math.max(1, qty), gift.stock) : Math.max(1, qty);
    setGiftCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: clamped } : l)));
  }

  function removeGiftLine(key: string) {
    setGiftCart((prev) => prev.filter((l) => l.key !== key));
  }

  // ---- hampers ------------------------------------------------------------
  const hamperInventoryById = new Map<string, ComponentInventory>(hamperCatalog.inventory.map((i) => [i.id, i]));
  const hamperComponents = (hamperId: string) => hamperCatalog.components.filter((c) => c.hamper_id === hamperId);

  /** Units of each product already claimed by the cart: ordinary lines + every hamper line. */
  function unitsUsedByCart(hampersInCart: HamperCartLine[] = hamperCart) {
    const used = new Map<string, number>();
    for (const l of cart) {
      if (l.unit_id) continue; // serialized units are counted through inventory_units, and can't be hamper components
      used.set(l.inventory_id, (used.get(l.inventory_id) ?? 0) + l.quantity);
    }
    for (const l of hampersInCart) {
      for (const c of hamperComponents(l.hamper_id)) {
        used.set(c.inventory_id, (used.get(c.inventory_id) ?? 0) + c.quantity * l.quantity);
      }
    }
    return used;
  }

  function addHamperToCart() {
    const hamper = hamperCatalog.hampers.find((h) => h.id === pickHamperId);
    if (!hamper) return;
    const comps = hamperComponents(hamper.id);
    if (maxAddableHampers(comps, hamperInventoryById, unitsUsedByCart()) < 1) {
      setError(`Not enough stock to add another "${hamper.name}" — check its products' stock.`);
      return;
    }
    setError(null);
    setHamperCart((prev) => {
      const existing = prev.find((l) => l.hamper_id === hamper.id);
      if (existing) return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      const stats = hamperStats(hamper, comps, hamperInventoryById);
      return [
        ...prev,
        { key: hamper.id, hamper_id: hamper.id, name: hamperDisplayName(hamper, comps, hamperInventoryById), quantity: 1, unit_price: hamper.price, unit_cost: stats.totalCost },
      ];
    });
    setPickHamperId("");
  }

  function updateHamperQty(key: string, qty: number) {
    const line = hamperCart.find((l) => l.key === key);
    if (!line) return;
    const wanted = Math.max(1, Math.floor(qty) || 1);
    // Room for THIS line = what is free with this line taken out of the cart.
    const others = hamperCart.filter((l) => l.key !== key);
    const room = maxAddableHampers(hamperComponents(line.hamper_id), hamperInventoryById, unitsUsedByCart(others));
    if (wanted > room) setError(`Only ${room} of this hamper can be sold with the current stock.`);
    else setError(null);
    setHamperCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: Math.max(1, Math.min(wanted, room)) } : l)));
  }

  const cartTotal =
    cart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0) +
    giftCart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0) +
    hamperCart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
  const pickedItem = inventory.find((i) => i.id === pickId);

  // cartTotal above is the customer-facing (GST-inclusive) price, same as it
  // always was — the GST% selector doesn't change what the customer pays,
  // it changes how that total is split into Taxable Value + GST for the
  // invoice. This recomputes live on every render, so it always reflects
  // the current cart/gift lines and the currently selected rate.
  const gstRate = gstRateChoice === "custom" ? gstRateCustom : Number(gstRateChoice);
  // Each item line can carry its own GST %; gifts/hampers and lines left on "sale rate" use the sale's rate.
  const splitTaxable = (amount: number, rate: number) => (rate > 0 ? amount / (1 + rate / 100) : amount);
  const taxableValue =
    cart.reduce((sum, l) => sum + splitTaxable(l.quantity * l.unit_price, l.gst_rate ?? gstRate), 0) +
    splitTaxable(giftCart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0) + hamperCart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0), gstRate);
  const gstAmount = cartTotal - taxableValue;
  const mixedRates = cart.some((l) => l.gst_rate != null && l.gst_rate !== gstRate);

  // Same state as the shop -> CGST + SGST; a customer in another state -> IGST.
  const shopStateCode = stateCodeOf(SHOP.state);
  const gstinTrim = normalizeGstin(customerGstin);
  const gstinOk = !gstinTrim || isValidGstin(gstinTrim);
  const effectiveCustomerState = gstinTrim && gstinOk ? stateCodeOf(gstinTrim) : customerStateCode;
  const interState = !!effectiveCustomerState && !!shopStateCode && effectiveCustomerState !== shopStateCode;

  // Payment: by default what the method implies (everything now, or nothing for Credit); editable for part payments.
  const receivedAuto = paymentMethod === "credit" ? 0 : cartTotal;
  const received = receivedText === null ? receivedAuto : Number(receivedText) || 0;
  const balanceDue = cartTotal - received;

  /** The invoice exactly as it will print, from what is currently typed — used by "Preview invoice". */
  function buildPreview(): RetailTaxInvoiceInput | null {
    if (cart.length === 0 && giftCart.length === 0 && hamperCart.length === 0) {
      setError("Add at least one item, gift or hamper.");
      return null;
    }
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return null;
    }
    setError(null);
    return {
      invoiceNumber: invoiceNumber.trim() || "(assigned on save)",
      createdAt: new Date().toISOString(),
      invoiceDate,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || null,
      customerAddress: customerAddress.trim() || null,
      customerGstin: gstinTrim || null,
      customerState: effectiveCustomerState ? stateLabel(effectiveCustomerState) : null,
      paymentMethod: paymentMethod.startsWith("finance:") ? "emi" : paymentMethod,
      receivedAmount: received,
      items: [
        ...cart.map((l) => ({ name: l.item_name, serialNo: l.serial_no.trim() || null, hsnSac: l.hsn_sac.trim() || null, quantity: l.quantity, totalPrice: l.quantity * l.unit_price, gstRate: l.gst_rate })),
        ...giftCart.map((l) => ({ name: l.name, quantity: l.quantity, totalPrice: l.quantity * l.unit_price })),
        ...hamperCart.map((l) => ({ name: l.name, quantity: l.quantity, totalPrice: l.quantity * l.unit_price })),
      ],
      totalAmount: cartTotal,
      gstRatePercent: gstRate,
      terms: terms.trim() || null,
      shop: SHOP,
      mode: "view",
    };
  }

  async function createSale() {
    if (cart.length === 0 && giftCart.length === 0 && hamperCart.length === 0) {
      setError("Add at least one item, gift or hamper.");
      return;
    }
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!gstinOk) {
      setError("Customer GSTIN isn't valid — it should be 15 characters like 27AAAAA0000A1Z5. Clear it if they don't have one.");
      return;
    }
    if (received < -0.005 || received > cartTotal + 0.005) {
      setError(`Amount received must be between ₹0 and the invoice total (${formatCurrency(cartTotal)}).`);
      return;
    }
    if (invoiceDate > localDateStr()) {
      setError("Invoice date can't be in the future.");
      return;
    }
    for (const l of cart) {
      if (!(l.unit_price >= 0)) {
        setError(`"${l.item_name}": price can't be negative.`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    let createdSaleId: string | null = null;
    try {
      // Hampers: re-read live stock right before selling (the picker's numbers
      // may be minutes old) and check the WHOLE cart at once — hamper
      // components can overlap with ordinary lines and with each other.
      // Same product on several cart lines: check the combined quantity against live stock too,
      // otherwise each line passes alone and the later deduction would fail after the sale exists.
      {
        const combined = new Map<string, number>();
        for (const l of cart) if (!l.unit_id) combined.set(l.inventory_id, (combined.get(l.inventory_id) ?? 0) + l.quantity);
        if (combined.size > 0) {
          const { data: liveRows } = await supabase.from("inventory").select("id, name, model, stock").in("id", [...combined.keys()]);
          for (const r of (liveRows as { id: string; name: string; model: string; stock: number | null }[]) ?? []) {
            const wanted = combined.get(r.id) ?? 0;
            if ((r.stock ?? 0) < wanted) throw new Error(`Not enough stock for "${r.name} ${r.model ?? ""}": the cart needs ${wanted} but only ${r.stock ?? 0} in stock.`);
          }
        }
      }
      if (hamperCart.length > 0) {
        const fresh = await fetchHamperCatalog(supabase, { activeOnly: true });
        const freshById = new Map<string, ComponentInventory>(fresh.inventory.map((i) => [i.id, i]));
        const need = new Map<string, number>();
        for (const l of cart) if (!l.unit_id) need.set(l.inventory_id, (need.get(l.inventory_id) ?? 0) + l.quantity);
        for (const l of hamperCart) {
          const hamper = fresh.hampers.find((h) => h.id === l.hamper_id);
          if (!hamper) throw new Error(`Hamper "${l.name}" is no longer available.`);
          for (const c of fresh.components.filter((x) => x.hamper_id === l.hamper_id)) {
            need.set(c.inventory_id, (need.get(c.inventory_id) ?? 0) + c.quantity * l.quantity);
          }
        }
        for (const [invId, qty] of need) {
          const inv = freshById.get(invId);
          if (inv && (inv.stock ?? 0) < qty) {
            throw new Error(`Not enough stock for "${inv.name} ${inv.model}": the cart needs ${qty} but only ${inv.stock ?? 0} in stock.`);
          }
        }
      }

      // A sale typed in fresh (not picked from the existing-customer
      // dropdown) never used to create a `customers` row — it only stored
      // customer_name/customer_phone as plain text on the sale itself, so
      // that person could never show up on the Customers page or build up
      // purchase/repair history there. Resolve (or create) a real customer
      // record here whenever we have a phone number to key it on, same as
      // "vijay" and every other walk-in should have been getting all along.
      let finalCustomerId = customerId || null;
      const trimmedPhone = customerPhone.trim();
      if (!finalCustomerId && trimmedPhone) {
        const { data: existingCustomer } = await supabase
          .from("customers")
          .select("id")
          .eq("phone", trimmedPhone)
          .maybeSingle();
        if (existingCustomer) {
          finalCustomerId = existingCustomer.id;
          // Backfill DOB if the customer already existed but didn't have one
          // on file yet, and the cashier captured it on this sale.
          if (customerDob) {
            await supabase.from("customers").update({ birthday: customerDob }).eq("id", finalCustomerId).is("birthday", null);
          }
        } else {
          const { data: newCustomer, error: custErr } = await supabase
            .from("customers")
            .insert({ name: customerName.trim(), phone: trimmedPhone, birthday: customerDob || null })
            .select("id")
            .single();
          if (custErr) throw custErr;
          finalCustomerId = newCustomer.id;
        }
      }

      const isFinance = paymentMethod.startsWith("finance:");
      const manualInvoiceNo = invoiceNumber.trim();
      if (manualInvoiceNo) {
        const { data: clash } = await supabase.from("sales").select("id").eq("invoice_number", manualInvoiceNo).maybeSingle();
        if (clash) throw new Error(`Invoice number "${manualInvoiceNo}" is already used by another sale.`);
      }
      const paymentStatus = received >= cartTotal - 0.005 ? "paid" : received > 0.005 ? "partial" : "pending";
      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .insert({
          invoice_number: manualInvoiceNo || nextInvoiceNumber(),
          customer_id: finalCustomerId,
          customer_name: customerName.trim(),
          customer_phone: trimmedPhone || null,
          sale_type: "in_store",
          total_amount: cartTotal,
          discount: 0,
          final_amount: cartTotal,
          payment_method: isFinance ? "emi" : paymentMethod,
          finance_partner_id: isFinance ? paymentMethod.slice("finance:".length) : null,
          payment_status: paymentStatus,
          staff_id: staffId || null,
          gst_rate: gstRate,
          customer_gstin: gstinTrim || null,
          customer_address: customerAddress.trim() || null,
          customer_state: effectiveCustomerState ? stateLabel(effectiveCustomerState) : null,
          invoice_date: invoiceDate || null,
          amount_received: received,
          terms: terms.trim() || null,
        })
        .select()
        .single();

      if (saleErr) throw saleErr;
      createdSaleId = sale.id;

      // Hampers first: the database deducts every component from Inventory and
      // rejects the line if any component is short. On any failure below the
      // sale is rolled back (deleting a hamper sale puts the stock back).
      if (hamperCart.length > 0) {
        const { error: hamperErr } = await supabase.from("hamper_sales").insert(
          hamperCart.map((l) => ({
            hamper_id: l.hamper_id,
            hamper_name: l.name,
            sale_id: sale.id,
            quantity: l.quantity,
            unit_price: l.unit_price,
            unit_cost: l.unit_cost,
            staff_id: staffId || null,
          }))
        );
        if (hamperErr) throw hamperErr;
        const { error: hamperItemsErr } = await supabase.from("sales_items").insert(
          hamperCart.map((l) => ({
            sale_id: sale.id,
            inventory_id: null,
            item_name: l.name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            total_price: l.quantity * l.unit_price,
          }))
        );
        if (hamperItemsErr) throw hamperItemsErr;
      }

      // Defensive re-check right before committing: the dropdown was built
      // from a snapshot, so if another tab/cashier sold one of these exact
      // units in the meantime, block the whole sale rather than silently
      // re-selling it (spec: "This IMEI is already sold.").
      const unitIds = cart.map((l) => l.unit_id).filter((id): id is string => !!id);
      if (unitIds.length > 0) {
        const { data: liveUnits } = await supabase.from("inventory_units").select("id, status, imei_1, imei_2, serial_no").in("id", unitIds);
        const notInStock = (liveUnits ?? []).filter((u) => u.status !== "in_stock");
        if (notInStock.length > 0) {
          const labels = notInStock.map((u) => unitLabel(u as AvailableUnit)).join(", ");
          throw new Error(`This IMEI is already ${notInStock[0].status}: ${labels}. Remove it from the cart and refresh.`);
        }
      }

      // IDs are generated client-side (rather than relying on the insert's
      // returned row order) so each cart line's sales_items id is known up
      // front, for linking sold inventory_units back to the exact line below.
      const cartWithIds = cart.map((l) => ({ ...l, salesItemId: crypto.randomUUID() }));

      if (cartWithIds.length > 0) {
        const { error: itemsErr } = await supabase.from("sales_items").insert(
          cartWithIds.map((l) => ({
            id: l.salesItemId,
            sale_id: sale.id,
            inventory_id: l.inventory_id,
            item_name: l.item_name,
            quantity: l.quantity,
            unit_price: l.unit_price,
            total_price: l.quantity * l.unit_price,
            serial_no: l.serial_no.trim() || null,
            hsn_sac: l.hsn_sac.trim() || null,
            gst_rate: l.gst_rate,
          }))
        );
        if (itemsErr) throw itemsErr;
      }

      // Gifts are tracked in their own table (not sales_items/inventory) —
      // inserting here is enough: a DB trigger on gift_sales decrements
      // gifts.stock and bumps gifts.sold_qty automatically.
      if (giftCart.length > 0) {
        const { error: giftErr } = await supabase.from("gift_sales").insert(
          giftCart.map((l) => ({
            gift_id: l.gift_id,
            sale_id: sale.id,
            quantity: l.quantity,
            unit_price: l.unit_price,
            unit_cost: l.unit_cost,
            staff_id: staffId || null,
          }))
        );
        if (giftErr) throw giftErr;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;

      // Serialized lines: mark the specific physical unit sold and linked to
      // its sale line — inventory.stock then auto-updates via the
      // inventory_units trigger, so no manual stock decrement needed here.
      // Also write the 'sale' lifecycle event (spec §12) with customer +
      // invoice reference, so the unit's history/timeline shows it.
      // Non-serialized lines: unaffected, same manual decrement as before.
      for (const l of cartWithIds) {
        if (l.unit_id) {
          await supabase
            .from("inventory_units")
            .update({ status: "sold", sale_item_id: l.salesItemId, customer_id: finalCustomerId, sold_at: new Date().toISOString(), updated_by: userId })
            .eq("id", l.unit_id);
          await supabase.from("imei_history").insert({
            stock_unit_id: l.unit_id,
            imei_1: l.unitSnapshot?.imei_1 ?? null,
            imei_2: l.unitSnapshot?.imei_2 ?? null,
            event_type: "sale",
            reference_type: "sale",
            reference_id: sale.invoice_number,
            from_status: "in_stock",
            to_status: "sold",
            customer_id: finalCustomerId,
            created_by: userId,
          });
          continue;
        }
        const item = inventory.find((i) => i.id === l.inventory_id);
        if (!item) continue;
        // Relative, atomic decrement — never "snapshot - qty", which would overwrite
        // a hamper deduction made a moment ago for the same product.
        const { error: decErr } = await supabase.rpc("decrement_inventory_stock", { p_inventory_id: l.inventory_id, p_qty: l.quantity });
        if (decErr) throw new Error(decErr.message);
      }

      // Best-effort — one notification per completed sale (not per line),
      // so a multi-item cart doesn't spam the admin bell.
      const soldNames = [...cart.map((l) => l.item_name), ...hamperCart.map((l) => l.name.split(" (")[0]), ...giftCart.map((l) => l.name)];
      if (soldNames.length > 0) {
        await supabase.from("notifications").insert({
          for_admin: true,
          type: "product_sold",
          title: "Sale Completed",
          body: `${soldNames.slice(0, 3).join(", ")}${soldNames.length > 3 ? ` +${soldNames.length - 3} more` : ""} sold — ${formatCurrency(cartTotal)}.`,
          related_id: sale.id,
          link: "/sales",
        });
      }

      setCart([]);
      setGiftCart([]);
      setHamperCart([]);
      setPickHamperId("");
      setPickGiftId("");
      setPickId("");
      setPickUnitId("");
      setAvailableUnits([]);
      setCustomerId("");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerDob("");
      setStaffId("");
      setGstRateChoice("18");
      setShowMore(false);
      setInvoiceNumber("");
      setInvoiceDate(localDateStr());
      setCustomerGstin("");
      setCustomerAddress("");
      setCustomerStateCode("");
      setReceivedText(null);
      setTerms("Thanks for doing business with us!");
      setGstRateCustom(18);
      setShowForm(false);
      await load();
      const { data: freshInv } = await supabase.from("inventory").select("id, name, model, price, stock, is_serialized").eq("is_active", true).order("name");
      setInventory((freshInv as InventoryItem[]) ?? []);
      const { data: freshGifts } = await supabase.from("gifts").select("id, name, price, cost_price, stock, is_active").eq("is_active", true).order("name");
      setGifts((freshGifts as GiftItem[]) ?? []);
      await refreshHampers();
    } catch (err: any) {
      // Undo a half-created sale: deleting it cascades its lines and hamper
      // sales, and the hamper reversal trigger returns every component to stock.
      if (createdSaleId) {
        await supabase.from("hamper_sales").delete().eq("sale_id", createdSaleId);
        await supabase.from("sales").delete().eq("id", createdSaleId);
        await load();
        await refreshHampers();
      }
      setError(err?.message || "Failed to create sale.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadInvoice(sale: Sale, mode: "download" | "print") {
    setInvoiceLoadingId(sale.id);
    try {
      const { data: items } = await supabase
        .from("sales_items")
        .select("item_name, quantity, unit_price, total_price")
        .eq("sale_id", sale.id);
      generateSimpleInvoicePdf({
        invoiceNumber: sale.invoice_number,
        customerName: sale.customer_name,
        customerPhone: sale.customer_phone,
        paymentMethod: sale.payment_method,
        paymentStatus: sale.payment_status,
        createdAt: sale.created_at,
        items: (items ?? []).map((i: any) => ({
          name: i.item_name,
          quantity: i.quantity,
          unitPrice: i.unit_price,
          totalPrice: i.total_price,
        })),
        totalAmount: sale.total_amount,
        discount: sale.discount,
        finalAmount: sale.final_amount,
        shop: SHOP,
        mode,
      });
    } catch (err: any) {
      alert(err?.message || "Failed to generate invoice.");
    } finally {
      setInvoiceLoadingId(null);
    }
  }

  // GST-style "Tax Invoice" matching the shop's real paper invoice format
  // (CGST/SGST breakdown, HSN/SAC, amount in words) — this is what the
  // "Print" button opens; generateSimpleInvoicePdf above is only used for
  // the plain "Download" PDF, which is a separate, simpler artifact.
  async function printGstInvoice(sale: Sale, mode: "print" | "view" = "print") {
    // Opened synchronously, still inside the click's user-gesture window —
    // opening it after the await below would get silently popup-blocked.
    const win = openBlankInvoiceWindow();
    setInvoiceLoadingId(sale.id);
    try {
      // sales_items on the live DB has item_name/quantity/total_price plus
      // serial_no (added by migration 0028 for IMEI/serial capture at sale
      // time) — hsn_sac is still not a real column there (the SaleItem TS
      // type is aspirational for that field, same schema drift documented
      // elsewhere in this repo), so it's deliberately left out of this select.
      const { data: items, error: itemsErr } = await supabase
        .from("sales_items")
        .select("item_name, quantity, total_price, serial_no, hsn_sac, gst_rate")
        .eq("sale_id", sale.id);
      if (itemsErr) throw itemsErr;
      openRetailTaxInvoice({
        invoiceNumber: sale.invoice_number,
        createdAt: sale.created_at,
        customerName: sale.customer_name,
        invoiceDate: sale.invoice_date ?? null,
        customerPhone: sale.customer_phone,
        customerAddress: sale.customer_address ?? null,
        customerGstin: sale.customer_gstin ?? null,
        customerState: sale.customer_state ?? null,
        paymentMethod: sale.payment_method,
        receivedAmount: sale.amount_received ?? (sale.payment_status === "paid" ? sale.final_amount : undefined),
        items: (items ?? []).map((i: any) => ({
          name: i.item_name,
          quantity: i.quantity,
          totalPrice: i.total_price,
          serialNo: i.serial_no ?? null,
          hsnSac: i.hsn_sac ?? null,
          gstRate: i.gst_rate ?? null,
        })),
        totalAmount: sale.final_amount,
        gstRatePercent: sale.gst_rate ?? 18,
        terms: sale.terms ?? null,
        shop: SHOP,
        mode,
      }, win);
    } catch (err: any) {
      win?.close();
      alert(err?.message || "Failed to generate GST invoice.");
    } finally {
      setInvoiceLoadingId(null);
    }
  }

  const filtered = sales.filter((s) => {
    if (dateFrom && s.created_at < dateFrom) return false;
    if (dateTo && s.created_at > dateTo + "T23:59:59") return false;
    if (typeFilter !== "all" && s.sale_type !== typeFilter) return false;
    return true;
  });
  const typeCount = (t: "website" | "in_store") => sales.filter((s) => s.sale_type === t).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-800">Sales & Invoices</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={filtered.map((s) => ({
              Invoice: s.invoice_number,
              Customer: s.customer_name,
              Type: s.sale_type,
              Total: s.final_amount,
              Payment: `${s.payment_method} (${s.payment_status})`,
              Date: s.created_at,
            }))}
            fileName="sales"
          />
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> New Sale
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-card p-0.5" role="tablist" aria-label="Order type">
          {([
            { key: "all", label: "All", count: sales.length },
            { key: "website", label: "Website", count: typeCount("website") },
            { key: "in_store", label: "In-store", count: typeCount("in_store") },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={typeFilter === t.key}
              onClick={() => setTypeFilter(t.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === t.key ? "bg-brand-primary text-white" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label} <span className={typeFilter === t.key ? "text-white/80" : "text-gray-400"}>({t.count})</span>
            </button>
          ))}
        </div>
        <input type="date" className="input w-auto" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span className="text-sm text-gray-400">to</span>
        <input type="date" className="input w-auto" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Type</th>
              <th className="text-right">Total</th>
              <th>Payment</th>
              <th>Date</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.invoice_number}</td>
                <td>{s.customer_name}</td>
                <td>
                  <StatusPill status={s.sale_type} />
                </td>
                <td className="text-right">{formatCurrency(s.final_amount)}</td>
                <td className="text-gray-500 capitalize">{s.payment_method} · {s.payment_status}</td>
                <td className="text-gray-500">{s.invoice_date ? new Date(s.invoice_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : formatDateTime(s.created_at)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="btn-ghost !px-2 !py-1 text-xs"
                      disabled={invoiceLoadingId === s.id}
                      onClick={() => downloadInvoice(s, "download")}
                      title="Download plain invoice PDF"
                    >
                      Download
                    </button>
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      disabled={invoiceLoadingId === s.id}
                      onClick={() => printGstInvoice(s, "view")}
                      title="View the Tax Invoice online (no print dialog)"
                    >
                      <Eye size={13} /> View
                    </button>
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      disabled={invoiceLoadingId === s.id}
                      onClick={() => printGstInvoice(s)}
                      title="Print the real Tax Invoice (shop's paper format, CGST/SGST breakdown)"
                    >
                      <Printer size={13} /> Print
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  No sales found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="card max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto p-5">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-sm font-semibold text-gray-800">New Sale</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>

            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">{error}</div>}

            {/* Manual customer entry — the only way to set the customer now.
                createSale() already resolves an existing customer by phone
                number server-side, so typing a returning customer's phone
                here still links to their existing record instead of
                creating a duplicate; no separate "choose existing" picker
                is needed for that. */}
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Customer name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <input className="input" placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
            <input
              type="date"
              className="input"
              placeholder="Date of birth"
              value={customerDob}
              onChange={(e) => setCustomerDob(e.target.value)}
              title="Date of birth (optional) — used for birthday offers/tracking"
            />
            <select
              className="input"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              title="Which staff member made this sale — powers the Dashboard's Salesman Leaderboard"
            >
              <option value="">Sold by (optional)</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            <button type="button" className="text-xs font-medium text-brand-primary" onClick={() => setShowMore((v) => !v)}>
              {showMore ? "▾ Hide" : "▸ Add"} GST invoice details (invoice no., date, customer GSTIN / address / state)
            </button>
            {showMore && (
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-2">
                <input className="input" placeholder="Invoice no. (blank = automatic)" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                <label className="text-[11px] text-gray-500">
                  Invoice date
                  <input type="date" className="input mt-0.5" max={localDateStr()} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                </label>
                <div>
                  <input
                    className={`input ${customerGstin && !gstinOk ? "!border-red-400" : ""}`}
                    placeholder="Customer GSTIN (optional)"
                    maxLength={15}
                    value={customerGstin}
                    onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
                  />
                  {customerGstin && !gstinOk && <div className="mt-0.5 text-[10px] text-brand-danger">Not a valid GSTIN yet</div>}
                </div>
                <select
                  className="input"
                  value={effectiveCustomerState}
                  disabled={!!gstinTrim && gstinOk}
                  onChange={(e) => setCustomerStateCode(e.target.value)}
                  title={gstinTrim && gstinOk ? "Taken from the GSTIN" : "Customer's state — another state means IGST instead of CGST + SGST"}
                >
                  <option value="">Customer's state (optional)</option>
                  {GST_STATES.map((st) => (
                    <option key={st.code} value={st.code}>{st.code}-{st.name}</option>
                  ))}
                </select>
                <textarea className="input col-span-2" rows={2} placeholder="Customer address (optional)" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
                <textarea className="input col-span-2" rows={2} placeholder="Terms & conditions (printed on the invoice)" value={terms} onChange={(e) => setTerms(e.target.value)} />
              </div>
            )}

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  className="input w-full"
                  placeholder="Select an item to add..."
                  value={itemSearch}
                  onChange={(e) => {
                    setItemSearch(e.target.value);
                    setItemDropdownOpen(true);
                    if (pickId) onPickItem("");
                  }}
                  onFocus={() => setItemDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setItemDropdownOpen(false), 150)}
                />
                {itemDropdownOpen && filteredInventory.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-cardHover">
                    {filteredInventory.map((i) => (
                      <li
                        key={i.id}
                        className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent"
                        onMouseDown={() => onPickItem(i.id)}
                      >
                        {i.name} {i.model} — {formatCurrency(i.price)} ({i.stock} in stock){i.is_serialized ? " · by serial" : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {itemDropdownOpen && itemSearch && filteredInventory.length === 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-white shadow-cardHover">
                    <li className="px-3 py-1.5 text-sm text-gray-400">No matching items</li>
                  </ul>
                )}
              </div>
              {pickedItem?.is_serialized ? (
                <select className="input !w-48" value={pickUnitId} onChange={(e) => setPickUnitId(e.target.value)}>
                  <option value="">Select serial...</option>
                  {availableUnits.map((u) => (
                    <option key={u.id} value={u.id}>{unitLabel(u)}</option>
                  ))}
                </select>
              ) : null}
              <button
                className="btn-secondary"
                onClick={addToCart}
                disabled={!pickId || (!!pickedItem?.is_serialized && !pickUnitId)}
              >
                Add
              </button>
            </div>
            {pickedItem?.is_serialized && availableUnits.length === 0 && (
              <p className="text-xs text-brand-danger">
                No serial numbers in stock for this item — add stock via Inventory → Serials first.
              </p>
            )}

            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {cart.map((l) => (
                <div key={l.key} className="rounded border border-gray-200 p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">{l.item_name}</span>
                    {l.unit_id ? (
                      <span className="w-16 text-right text-gray-400">×1</span>
                    ) : (
                      <input
                        type="number"
                        className="input !w-16 !py-0.5 text-right"
                        value={l.quantity}
                        onChange={(e) => updateQty(l.key, Number(e.target.value))}
                      />
                    )}
                    <span className="w-20 text-right font-medium">{formatCurrency(l.quantity * l.unit_price)}</span>
                    <button onClick={() => removeLine(l.key)} className="text-brand-danger"><Trash2 size={13} /></button>
                  </div>
                  {l.unit_id ? (
                    <div className="mt-1 text-xs text-gray-500">Serial: <span className="font-mono">{l.serial_no}</span></div>
                  ) : (
                    <input
                      className="input !py-0.5 mt-1.5 text-xs"
                      placeholder={l.quantity > 1 ? "Serial No. / IMEI (comma-separated, optional)" : "Serial No. / IMEI (optional)"}
                      value={l.serial_no}
                      onChange={(e) => updateSerial(l.key, e.target.value)}
                    />
                  )}
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    <input
                      className="input !py-0.5 text-xs"
                      placeholder="HSN / SAC"
                      value={l.hsn_sac}
                      onChange={(e) => updateLine(l.key, { hsn_sac: e.target.value })}
                    />
                    <select
                      className="input !py-0.5 text-xs"
                      value={l.gst_rate ?? ""}
                      onChange={(e) => updateLine(l.key, { gst_rate: e.target.value === "" ? null : Number(e.target.value) })}
                      title="GST % for this item"
                    >
                      <option value="">GST: sale rate ({gstRate}%)</option>
                      {GST_RATE_OPTIONS.map((r) => (
                        <option key={r} value={r}>GST {r}%</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input !py-0.5 text-right text-xs"
                      title="Price per unit, including GST"
                      value={l.unit_price}
                      onChange={(e) => updateLine(l.key, { unit_price: Number(e.target.value) })}
                    />
                  </div>
                </div>
              ))}
              {cart.length === 0 && <p className="text-sm text-gray-400">No items added yet.</p>}
            </div>

            <div className="flex gap-2 border-t border-border pt-2">
              <select className="input flex-1" value={pickGiftId} onChange={(e) => setPickGiftId(e.target.value)}>
                <option value="">Select a gift to add...</option>
                {gifts.map((g) => (
                  <option key={g.id} value={g.id} disabled={g.stock <= 0}>
                    {g.name} — {formatCurrency(g.price)} ({g.stock <= 0 ? "out of stock" : `${g.stock} in stock`})
                  </option>
                ))}
              </select>
              <button className="btn-secondary" onClick={addGiftToCart} disabled={!pickGiftId}>
                <Plus size={13} /> Add Gift
              </button>
            </div>

            {giftCart.length > 0 && (
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {giftCart.map((l) => (
                  <div key={l.key} className="flex items-center gap-2 rounded border border-gray-200 p-2 text-sm">
                    <span className="flex-1">🎁 {l.name}</span>
                    <input
                      type="number"
                      className="input !w-16 !py-0.5 text-right"
                      value={l.quantity}
                      onChange={(e) => updateGiftQty(l.key, Number(e.target.value))}
                    />
                    <span className="w-20 text-right font-medium">{formatCurrency(l.quantity * l.unit_price)}</span>
                    <button onClick={() => removeGiftLine(l.key)} className="text-brand-danger"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 border-t border-border pt-2">
              <select className="input flex-1" value={pickHamperId} onChange={(e) => setPickHamperId(e.target.value)}>
                <option value="">Select a gift hamper to add...</option>
                {hamperCatalog.hampers.map((h) => {
                  const left = maxAddableHampers(hamperComponents(h.id), hamperInventoryById, unitsUsedByCart());
                  return (
                    <option key={h.id} value={h.id} disabled={left < 1}>
                      {h.name} — {formatCurrency(h.price)} ({left < 1 ? "not enough stock" : `${left} available`})
                    </option>
                  );
                })}
              </select>
              <button className="btn-secondary" onClick={addHamperToCart} disabled={!pickHamperId}>
                <Plus size={13} /> Add Hamper
              </button>
            </div>

            {hamperCart.length > 0 && (
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {hamperCart.map((l) => (
                  <div key={l.key} className="flex items-center gap-2 rounded border border-gray-200 p-2 text-sm">
                    <span className="flex-1">🧺 {l.name}</span>
                    <input
                      type="number"
                      className="input !w-16 !py-0.5 text-right"
                      value={l.quantity}
                      onChange={(e) => updateHamperQty(l.key, Number(e.target.value))}
                    />
                    <span className="w-20 text-right font-medium">{formatCurrency(l.quantity * l.unit_price)}</span>
                    <button onClick={() => setHamperCart((prev) => prev.filter((x) => x.key !== l.key))} className="text-brand-danger"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-border pt-2">
              <select
                className="input !w-auto"
                value={gstRateChoice}
                onChange={(e) => setGstRateChoice(e.target.value)}
                title="GST% used for this invoice's Taxable Value / GST breakdown"
              >
                {GST_RATE_OPTIONS.map((r) => (
                  <option key={r} value={r}>GST {r}%</option>
                ))}
                <option value="custom">Custom GST %</option>
              </select>
              {gstRateChoice === "custom" && (
                <input
                  type="number"
                  className="input !w-24"
                  placeholder="e.g. 3"
                  value={gstRateCustom}
                  onChange={(e) => setGstRateCustom(Number(e.target.value))}
                />
              )}
            </div>

            <div className="space-y-1 rounded-md bg-page p-2.5 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Taxable Value</span>
                <span>{money2(taxableValue)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>GST {mixedRates ? "(mixed rates)" : `(${gstRate}%)`}</span>
                <span>{money2(gstAmount)}</span>
              </div>
              {interState ? (
                <div className="flex justify-between text-xs text-gray-400">
                  <span>IGST (customer is in another state)</span>
                  <span>{money2(gstAmount)}</span>
                </div>
              ) : (
                <div className="flex justify-between text-xs text-gray-400">
                  <span>CGST + SGST</span>
                  <span>{money2(gstAmount / 2)} + {money2(gstAmount / 2)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1 font-semibold text-gray-800">
                <span>Invoice Total</span>
                <span>{money2(cartTotal)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border pt-2">
              <select className="input !w-auto" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="credit">Credit (pay later)</option>
                {financePartners.map((p) => (
                  <option key={p.id} value={`finance:${p.id}`}>{p.name}</option>
                ))}
              </select>
              <span className="text-lg font-bold text-brand-primary">{formatCurrency(cartTotal)}</span>
            </div>
            <div className="grid grid-cols-2 items-end gap-2">
              <label className="text-[11px] text-gray-500">
                Amount received now
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input mt-0.5"
                  value={receivedText === null ? String(receivedAuto || "") : receivedText}
                  onChange={(e) => setReceivedText(e.target.value)}
                />
              </label>
              <div className={`pb-1.5 text-right text-sm font-medium ${balanceDue > 0.005 ? "text-brand-danger" : "text-brand-success"}`}>
                Balance: {money2(Math.max(0, balanceDue))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button
                className="btn-secondary"
                disabled={saving}
                onClick={() => {
                  // Open the tab first (still inside the click) so the popup isn't blocked.
                  const win = openBlankInvoiceWindow();
                  const input = buildPreview();
                  if (!input) {
                    win?.close();
                    return;
                  }
                  openRetailTaxInvoice(input, win);
                }}
              >
                Preview invoice
              </button>
              <button className="btn-primary" onClick={createSale} disabled={saving}>
                {saving ? "Saving..." : "Complete Sale"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
