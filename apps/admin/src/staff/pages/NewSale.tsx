import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatCurrency } from "@sai/shared";
import { Plus, Minus, Trash2 } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";
import { fetchHamperCatalog, hamperDisplayName, maxAddableHampers, type HamperCatalog, type ComponentInventory } from "../../lib/hampers";

interface Product {
  id: string;
  name: string;
  model: string;
  price: number;
  stock: number;
  is_serialized: boolean;
}
interface GiftItem {
  id: string;
  name: string;
  price: number;
  stock: number;
}
interface CartLine {
  key: string;
  inventory_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
}
interface HamperLine {
  key: string;
  hamper_id: string;
  name: string;
  quantity: number;
  unit_price: number;
}
interface GiftLine {
  key: string;
  gift_id: string;
  name: string;
  quantity: number;
  unit_price: number;
}

// Non-serialized items + gifts only — a phone tracked by IMEI/serial still
// needs the Admin Portal's Sales flow (serial lifecycle, "already sold"
// re-check, imei_history) which doesn't belong duplicated into a staff RPC.
export function NewSale() {
  const { token } = useStaffAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [pickId, setPickId] = useState("");
  const [pickGiftId, setPickGiftId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [giftCart, setGiftCart] = useState<GiftLine[]>([]);
  const [catalog, setCatalog] = useState<HamperCatalog>({ hampers: [], components: [], inventory: [] });
  const [hamperCart, setHamperCart] = useState<HamperLine[]>([]);
  const [pickHamperId, setPickHamperId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function refreshHampers() {
    fetchHamperCatalog(supabase, { activeOnly: true, withCosts: false }).then(setCatalog);
  }

  // Products/gifts on hand — reloaded after every sale so the stock counts in
  // the dropdowns never go stale.
  function loadStock() {
    supabase
      .from("inventory")
      .select("id, name, model, price, stock, is_serialized")
      .eq("is_active", true)
      .eq("is_serialized", false)
      .gt("stock", 0)
      .order("name")
      .then(({ data }) => setProducts((data as Product[]) ?? []));
    supabase
      .from("gifts")
      .select("id, name, price, stock")
      .eq("is_active", true)
      .gt("stock", 0)
      .order("name")
      .then(({ data }) => setGifts((data as GiftItem[]) ?? []));
  }

  useEffect(() => {
    refreshHampers();
    loadStock();
  }, []);

  // Messages render at the top of the page — bring them into view on a small screen.
  useEffect(() => {
    if (error || success) document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [error, success]);

  function addToCart() {
    const item = products.find((p) => p.id === pickId);
    if (!item) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.inventory_id === item.id);
      if (existing) return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key: item.id, inventory_id: item.id, item_name: `${item.name} ${item.model}`, quantity: 1, unit_price: item.price }];
    });
    setPickId("");
  }

  function addGift() {
    const gift = gifts.find((g) => g.id === pickGiftId);
    if (!gift) return;
    setGiftCart((prev) => {
      const existing = prev.find((l) => l.gift_id === gift.id);
      if (existing) return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key: gift.id, gift_id: gift.id, name: gift.name, quantity: 1, unit_price: gift.price }];
    });
    setPickGiftId("");
  }

  const inventoryById = new Map<string, ComponentInventory>(catalog.inventory.map((i) => [i.id, i]));
  const componentsOf = (hamperId: string) => catalog.components.filter((c) => c.hamper_id === hamperId);

  // Units of each product already claimed by this cart (plain lines + every
  // hamper line), so a hamper can't be offered against stock that's already spoken for.
  function unitsUsed(hampersInCart: HamperLine[] = hamperCart) {
    const used = new Map<string, number>();
    for (const l of cart) used.set(l.inventory_id, (used.get(l.inventory_id) ?? 0) + l.quantity);
    for (const l of hampersInCart) {
      for (const c of componentsOf(l.hamper_id)) used.set(c.inventory_id, (used.get(c.inventory_id) ?? 0) + c.quantity * l.quantity);
    }
    return used;
  }

  function addHamper() {
    const hamper = catalog.hampers.find((h) => h.id === pickHamperId);
    if (!hamper) return;
    const comps = componentsOf(hamper.id);
    if (maxAddableHampers(comps, inventoryById, unitsUsed()) < 1) {
      setError(`Not enough stock to add another "${hamper.name}".`);
      return;
    }
    setError(null);
    setHamperCart((prev) => {
      const existing = prev.find((l) => l.hamper_id === hamper.id);
      if (existing) return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key: hamper.id, hamper_id: hamper.id, name: hamperDisplayName(hamper, comps, inventoryById), quantity: 1, unit_price: hamper.price }];
    });
    setPickHamperId("");
  }

  // Quantity steppers for plain items and gifts, capped at the stock on hand.
  function stepItem(key: string, delta: number) {
    setError(null);
    setCart((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const stock = products.find((p) => p.id === l.inventory_id)?.stock ?? Infinity;
        // Stock already claimed by this cart (plain lines + hamper components).
        if (delta > 0 && (unitsUsed().get(l.inventory_id) ?? 0) + delta > stock) {
          setError(`Only ${stock} of "${l.item_name}" in stock (hampers in this cart use some).`);
          return l;
        }
        return { ...l, quantity: Math.max(1, l.quantity + delta) };
      })
    );
  }
  function stepGift(key: string, delta: number) {
    setError(null);
    setGiftCart((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const stock = gifts.find((g) => g.id === l.gift_id)?.stock ?? Infinity;
        if (delta > 0 && l.quantity + delta > stock) {
          setError(`Only ${stock} of "${l.name}" in stock.`);
          return l;
        }
        return { ...l, quantity: Math.max(1, l.quantity + delta) };
      })
    );
  }
  const stepper = (qty: number, onStep: (d: number) => void) => (
    <span className="mx-1 flex shrink-0 items-center gap-1">
      <button type="button" aria-label="Decrease quantity" onClick={() => onStep(-1)} className="flex h-6 w-6 items-center justify-center rounded border border-gray-200 text-gray-500"><Minus size={12} /></button>
      <span className="w-5 text-center text-gray-600">{qty}</span>
      <button type="button" aria-label="Increase quantity" onClick={() => onStep(1)} className="flex h-6 w-6 items-center justify-center rounded border border-gray-200 text-gray-500"><Plus size={12} /></button>
    </span>
  );

  const total =
    cart.reduce((s, l) => s + l.quantity * l.unit_price, 0) +
    giftCart.reduce((s, l) => s + l.quantity * l.unit_price, 0) +
    hamperCart.reduce((s, l) => s + l.quantity * l.unit_price, 0);

  async function completeSale() {
    if (!token) return;
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (customerPhone.trim() && !/^[6-9]\d{9}$/.test(customerPhone.trim())) {
      setError("Enter a valid 10-digit mobile number, or leave the phone blank.");
      return;
    }
    if (cart.length === 0 && giftCart.length === 0 && hamperCart.length === 0) {
      setError("Add at least one item, gift or hamper.");
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("staff_create_sale", {
      p_token: token,
      p_customer_name: customerName.trim(),
      p_customer_phone: customerPhone.trim() || null,
      p_payment_method: paymentMethod,
      p_items: cart.map((l) => ({ inventory_id: l.inventory_id, item_name: l.item_name, quantity: l.quantity, unit_price: l.unit_price })),
      // Gift cost is taken from the database by staff_create_sale (cost_price is hidden from this role).
      p_gift_items: giftCart.map((l) => ({ gift_id: l.gift_id, quantity: l.quantity, unit_price: l.unit_price })),
      // Price, cost and stock deduction for hampers are all decided by the database.
      p_hamper_items: hamperCart.map((l) => ({ hamper_id: l.hamper_id, quantity: l.quantity })),
    });
    setSaving(false);
    if (rpcErr || !data?.success) {
      setError(rpcErr?.message || data?.error || "Failed to complete sale.");
      return;
    }
    setSuccess(`Sale completed — Invoice ${data.invoice_number}`);
    setCart([]);
    setGiftCart([]);
    setHamperCart([]);
    refreshHampers();
    loadStock();
    setCustomerName("");
    setCustomerPhone("");
    setTimeout(() => setSuccess(null), 4000);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">New Sale</h1>
      {success && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      <div className="card space-y-2.5 p-4">
        <input className="input w-full" placeholder="Customer name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        <input className="input w-full" placeholder="Phone" inputMode="numeric" maxLength={10} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />

        <div className="flex gap-2">
          <select className="input flex-1" value={pickId} onChange={(e) => setPickId(e.target.value)}>
            <option value="">Select a product...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} {p.model} — {formatCurrency(p.price)} ({p.stock} in stock)</option>
            ))}
          </select>
          <button className="btn-secondary" onClick={addToCart} disabled={!pickId}><Plus size={14} /></button>
        </div>

        {cart.map((l) => (
          <div key={l.key} className="rounded border border-gray-200 p-2 text-sm">
            <div className="break-words text-gray-700">{l.item_name}</div>
            <div className="mt-1.5 flex items-center justify-between">
              {stepper(l.quantity, (d) => stepItem(l.key, d))}
              <span className="ml-auto font-medium">{formatCurrency(l.quantity * l.unit_price)}</span>
              <button onClick={() => setCart((prev) => prev.filter((x) => x.key !== l.key))} aria-label="Remove item" className="ml-3 text-brand-danger"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}

        <div className="flex gap-2 border-t border-border pt-2">
          <select className="input flex-1" value={pickGiftId} onChange={(e) => setPickGiftId(e.target.value)}>
            <option value="">Select a gift...</option>
            {gifts.map((g) => (
              <option key={g.id} value={g.id}>{g.name} — {formatCurrency(g.price)} ({g.stock} in stock)</option>
            ))}
          </select>
          <button className="btn-secondary" onClick={addGift} disabled={!pickGiftId}><Plus size={14} /></button>
        </div>

        {giftCart.map((l) => (
          <div key={l.key} className="rounded border border-gray-200 p-2 text-sm">
            <div className="break-words text-gray-700">🎁 {l.name}</div>
            <div className="mt-1.5 flex items-center justify-between">
              {stepper(l.quantity, (d) => stepGift(l.key, d))}
              <span className="ml-auto font-medium">{formatCurrency(l.quantity * l.unit_price)}</span>
              <button onClick={() => setGiftCart((prev) => prev.filter((x) => x.key !== l.key))} aria-label="Remove gift" className="ml-3 text-brand-danger"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}

        <div className="flex gap-2 border-t border-border pt-2">
          <select className="input flex-1" value={pickHamperId} onChange={(e) => setPickHamperId(e.target.value)}>
            <option value="">Select a gift hamper...</option>
            {catalog.hampers.map((h) => {
              const left = maxAddableHampers(componentsOf(h.id), inventoryById, unitsUsed());
              return (
                <option key={h.id} value={h.id} disabled={left < 1}>
                  {h.name} — {formatCurrency(h.price)} ({left < 1 ? "not enough stock" : `${left} available`})
                </option>
              );
            })}
          </select>
          <button className="btn-secondary" onClick={addHamper} disabled={!pickHamperId}><Plus size={14} /></button>
        </div>

        {hamperCart.map((l) => (
          <div key={l.key} className="rounded border border-gray-200 p-2 text-sm">
            <div className="break-words text-gray-700">🧺 {l.name.split(" (")[0]}</div>
            <div className="mt-1.5 flex items-center justify-between">
              <input
                type="number"
                min={1}
                className="input !w-14 !py-0.5 text-right"
                value={l.quantity}
                onChange={(e) => {
                  const wanted = Math.max(1, Math.floor(Number(e.target.value)) || 1);
                  const room = maxAddableHampers(componentsOf(l.hamper_id), inventoryById, unitsUsed(hamperCart.filter((x) => x.key !== l.key)));
                  if (wanted > room) setError(`Only ${room} of this hamper can be sold with the current stock.`);
                  else setError(null);
                  setHamperCart((prev) => prev.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(1, Math.min(wanted, room)) } : x)));
                }}
              />
              <span className="ml-auto font-medium">{formatCurrency(l.quantity * l.unit_price)}</span>
              <button onClick={() => setHamperCart((prev) => prev.filter((x) => x.key !== l.key))} aria-label="Remove hamper" className="ml-3 text-brand-danger"><Trash2 size={14} /></button>
            </div>
            <div className="mt-1 break-words text-xs text-gray-400">{l.name.includes(" (") ? l.name.slice(l.name.indexOf("(")) : ""}</div>
          </div>
        ))}

        <div className="flex items-center justify-between border-t border-border pt-2">
          <select className="input !w-auto" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="upi">UPI</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
          <span className="text-lg font-bold text-brand-primary">{formatCurrency(total)}</span>
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-ghost flex-1" onClick={() => navigate("/portal/sales")}>Cancel</button>
          <button className="btn-primary flex-1" disabled={saving} onClick={completeSale}>
            {saving ? "Saving…" : "Complete Sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
