import type { SupabaseClient } from "@supabase/supabase-js";

// A hamper is a bundle of EXISTING inventory products (hamper_products). It has
// no stock of its own — everything below is derived from the components.

export interface HamperRow {
  id: string;
  name: string;
  category: string | null;
  price: number;
  image: string | null;
  is_active: boolean | null;
  offer_id: string | null;
  packaging_cost: number;
}

export interface HamperComponentRow {
  id: string;
  hamper_id: string;
  inventory_id: string;
  quantity: number;
}

export interface ComponentInventory {
  id: string;
  name: string;
  model: string;
  stock: number | null;
  cost_price: number | null;
  is_active: boolean | null;
  is_serialized: boolean;
}

export interface HamperStats {
  /** sum(component cost_price x qty) */
  productCost: number;
  /** productCost + packaging */
  totalCost: number;
  /** selling price - totalCost */
  profit: number;
  marginPct: number;
  /** max hampers that can be sold right now = min(floor(stock / qty)) over components */
  available: number;
  /** component that limits `available` (null when there are no components) */
  limitingName: string | null;
  /** components with no cost price recorded (their cost counts as 0) */
  missingCost: string[];
  componentCount: number;
}

export function inventoryLabel(i: Pick<ComponentInventory, "name" | "model">) {
  return `${i.name} ${i.model ?? ""}`.trim();
}

export function hamperStats(
  hamper: Pick<HamperRow, "price" | "packaging_cost">,
  components: { inventory_id: string; quantity: number }[],
  inventoryById: Map<string, ComponentInventory>
): HamperStats {
  let productCost = 0;
  let available = Infinity;
  let limitingName: string | null = null;
  const missingCost: string[] = [];

  for (const c of components) {
    const inv = inventoryById.get(c.inventory_id);
    if (!inv) {
      available = 0;
      limitingName = "Unknown product";
      continue;
    }
    if (inv.cost_price == null || Number(inv.cost_price) === 0) missingCost.push(inventoryLabel(inv));
    productCost += Number(inv.cost_price ?? 0) * c.quantity;
    const canMake = inv.is_active === false ? 0 : Math.floor(Math.max(inv.stock ?? 0, 0) / c.quantity);
    if (canMake < available) {
      available = canMake;
      limitingName = inventoryLabel(inv);
    }
  }
  if (components.length === 0) available = 0;

  const totalCost = productCost + Number(hamper.packaging_cost || 0);
  const price = Number(hamper.price || 0);
  const profit = price - totalCost;
  return {
    productCost,
    totalCost,
    profit,
    marginPct: price > 0 ? (profit / price) * 100 : 0,
    available: Number.isFinite(available) ? available : 0,
    limitingName,
    missingCost,
    componentCount: components.length,
  };
}

/**
 * How many of `hamperId` can still be added to a cart, given everything
 * already in it. `usedByInventory` = units of each inventory product already
 * claimed by the cart (plain lines + every hamper line, INCLUDING this
 * hamper's current lines), so components shared with ordinary items or other
 * hampers are never double-counted.
 */
export function maxAddableHampers(
  components: { inventory_id: string; quantity: number }[],
  inventoryById: Map<string, ComponentInventory>,
  usedByInventory: Map<string, number>
): number {
  if (components.length === 0) return 0;
  let max = Infinity;
  for (const c of components) {
    const inv = inventoryById.get(c.inventory_id);
    if (!inv || inv.is_active === false) return 0;
    const left = Math.max((inv.stock ?? 0) - (usedByInventory.get(c.inventory_id) ?? 0), 0);
    max = Math.min(max, Math.floor(left / c.quantity));
  }
  return Number.isFinite(max) ? max : 0;
}

export interface HamperCatalog {
  hampers: HamperRow[];
  components: HamperComponentRow[];
  inventory: ComponentInventory[];
}

/** Loads hampers + their component rows + the inventory those components point at. */
export async function fetchHamperCatalog(
  supabase: SupabaseClient,
  // withCosts:false is for the staff portal (anon role) — cost_price / packaging_cost are
  // hidden from anon at the database level, so asking for them would be a permission error.
  opts?: { activeOnly?: boolean; withCosts?: boolean }
): Promise<HamperCatalog> {
  const withCosts = opts?.withCosts !== false;
  let hq = supabase
    .from("hamper_items")
    .select(withCosts ? "id, name, category, price, image, is_active, offer_id, packaging_cost" : "id, name, category, price, image, is_active, offer_id")
    .order("name");
  if (opts?.activeOnly) hq = hq.eq("is_active", true);
  const [{ data: h }, { data: hp }] = await Promise.all([
    hq,
    supabase.from("hamper_products").select("id, hamper_id, inventory_id, quantity"),
  ]);
  const hampers = ((h as unknown as HamperRow[]) ?? []).map((x) => ({ ...x, packaging_cost: Number(x.packaging_cost ?? 0) }));
  const ids = new Set(hampers.map((x) => x.id));
  const components = ((hp as HamperComponentRow[]) ?? []).filter((c) => ids.has(c.hamper_id));
  const invIds = Array.from(new Set(components.map((c) => c.inventory_id)));
  let inventory: ComponentInventory[] = [];
  if (invIds.length > 0) {
    const { data: inv } = await supabase
      .from("inventory")
      .select(withCosts ? "id, name, model, stock, cost_price, is_active, is_serialized" : "id, name, model, stock, is_active, is_serialized")
      .in("id", invIds);
    inventory = ((inv as unknown as ComponentInventory[]) ?? []).map((i) => ({ ...i, cost_price: i.cost_price ?? null }));
  }
  return { hampers, components, inventory };
}

/** "Birthday Hamper (Charger x1, Gift Box x1)" — the line shown on invoices / sales history. */
export function hamperDisplayName(
  hamper: Pick<HamperRow, "name">,
  components: { inventory_id: string; quantity: number }[],
  inventoryById: Map<string, ComponentInventory>
): string {
  const parts = components
    .map((c) => ({ label: inventoryById.get(c.inventory_id) ? inventoryLabel(inventoryById.get(c.inventory_id)!) : "Item", qty: c.quantity }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((p) => `${p.label} x${p.qty}`);
  return parts.length > 0 ? `${hamper.name} (${parts.join(", ")})` : hamper.name;
}
