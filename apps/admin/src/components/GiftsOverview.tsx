import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { formatCurrency } from "@sai/shared";
import { supabase } from "../lib/supabase";

interface GiftRow {
  id: string;
  name: string;
  cost_price: number;
  stock: number;
  sold_qty: number;
  is_active: boolean;
}
interface GiftSaleRow {
  gift_id: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  created_at: string;
}

interface ItemSaleRow {
  inventory_id: string | null;
  item_name: string;
  quantity: number;
  total_price: number;
}
interface StockRow {
  id: string;
  stock: number;
}

const PERIOD_LABEL = { day: "today", week: "this week", month: "this month", year: "this year" } as const;

// Dedicated Gifts panel for the dashboard. Stock and money-spent are the
// gift stock as it stands now; the sales figures follow the Day/Week/Month/Year
// selector and come from the gift_sales ledger (the price and cost that were
// actually charged at the time of each sale).
export function GiftsOverview({ period, since }: { period: keyof typeof PERIOD_LABEL; since: Date }) {
  const [gifts, setGifts] = useState<GiftRow[]>([]);
  const [sales, setSales] = useState<GiftSaleRow[]>([]);
  const [itemSales, setItemSales] = useState<ItemSaleRow[]>([]);
  const [inventory, setInventory] = useState<StockRow[]>([]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("dashboard-gifts")
      .on("postgres_changes", { event: "*", schema: "public", table: "gifts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "gift_sales" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_items" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [since.getTime()]);

  async function load() {
    const [{ data: g }, { data: s }, { data: it }, { data: inv }] = await Promise.all([
      supabase.from("gifts").select("id, name, cost_price, stock, sold_qty, is_active"),
      supabase.from("gift_sales").select("gift_id, quantity, unit_price, unit_cost, created_at"),
      supabase
        .from("sales_items")
        .select("inventory_id, item_name, quantity, total_price, sales!inner(created_at)")
        .not("inventory_id", "is", null)
        .gte("sales.created_at", since.toISOString()),
      supabase.from("inventory").select("id, stock").eq("is_active", true),
    ]);
    setGifts((g as GiftRow[]) ?? []);
    setSales((s as GiftSaleRow[]) ?? []);
    setItemSales((it as unknown as ItemSaleRow[]) ?? []);
    setInventory((inv as StockRow[]) ?? []);
  }

  const stats = useMemo(() => {
    // Everything ever bought = what is still on the shelf + what has been sold.
    const unitsBought = gifts.reduce((n, g) => n + g.stock + g.sold_qty, 0);
    const spent = gifts.reduce((n, g) => n + (g.stock + g.sold_qty) * (g.cost_price ?? 0), 0);
    const unitsLeft = gifts.reduce((n, g) => n + g.stock, 0);
    const stockValue = gifts.reduce((n, g) => n + g.stock * (g.cost_price ?? 0), 0);
    const lowStock = gifts.filter((g) => g.is_active && g.stock <= 3).length;

    const inRange = sales.filter((s) => new Date(s.created_at).getTime() >= since.getTime());
    const units = inRange.reduce((n, s) => n + s.quantity, 0);
    const revenue = inRange.reduce((n, s) => n + s.unit_price * s.quantity, 0);
    const cost = inRange.reduce((n, s) => n + (s.unit_cost ?? 0) * s.quantity, 0);

    const perGift = gifts
      .map((g) => {
        const mine = inRange.filter((s) => s.gift_id === g.id);
        const cst = mine.reduce((n, s) => n + (s.unit_cost ?? 0) * s.quantity, 0);
        return { id: g.id, name: g.name, stock: g.stock, sold: mine.reduce((n, s) => n + s.quantity, 0), cost: cst };
      })
      .filter((r) => r.stock > 0 || r.sold > 0)
      .sort((a, b) => b.cost - a.cost || b.stock - a.stock);

    // Products sold (gifts and hampers are not inventory lines, so they are excluded here).
    const itemUnits = itemSales.reduce((n, r) => n + r.quantity, 0);
    const itemRevenue = itemSales.reduce((n, r) => n + r.total_price, 0);
    const byItem: Record<string, { name: string; sold: number; revenue: number; id: string | null }> = {};
    for (const r of itemSales) {
      const k = r.inventory_id ?? r.item_name;
      byItem[k] = byItem[k] ?? { name: r.item_name, sold: 0, revenue: 0, id: r.inventory_id };
      byItem[k].sold += r.quantity;
      byItem[k].revenue += r.total_price;
    }
    const stockById = new Map(inventory.map((i) => [i.id, i.stock]));
    const topItems = Object.values(byItem)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((r) => ({ ...r, stock: r.id ? stockById.get(r.id) ?? 0 : 0 }));
    // Gifts are handed out from the shop's own money: cost is an expense, anything charged is offset.
    const net = itemRevenue - cost + revenue;

    return { itemUnits, itemRevenue, topItems, net, unitsBought, spent, unitsLeft, stockValue, lowStock, units, revenue, cost, profit: revenue - cost, perGift };
  }, [gifts, sales, itemSales, inventory, since]);

  const when = PERIOD_LABEL[period];
  const tiles = [
    { label: "Spent on gifts", value: formatCurrency(stats.spent), note: `Cost of all ${stats.unitsBought} units bought (in stock + given/sold)`, color: "text-brand-danger" },
    { label: "Gift stock left", value: `${stats.unitsLeft} units`, note: `Worth ${formatCurrency(stats.stockValue)} at cost${stats.lowStock ? ` · ${stats.lowStock} low` : ""}`, color: "text-gray-800" },
  ];
  const lossMaking = stats.net < 0;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-serif text-sm font-semibold text-gray-700">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#C9975A]/12 text-[#C9975A]">
            <Sparkles size={13} strokeWidth={2} />
          </span>
          Items vs Gifts — profit / loss {when}
        </div>
        <Link to="/gifts" className="text-xs font-medium text-brand-primary hover:underline">Manage gifts →</Link>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-white/50 p-3 lg:col-span-2">
          <div className="flex items-center justify-between py-1 text-sm">
            <span className="text-gray-600">
              Item sales <span className="text-xs text-gray-400">({stats.itemUnits} units sold)</span>
            </span>
            <span className="font-medium text-gray-800">{formatCurrency(stats.itemRevenue)}</span>
          </div>
          <div className="flex items-center justify-between py-1 text-sm">
            <span className="text-gray-600">
              − Gift cost <span className="text-xs text-gray-400">({stats.units} gifts given, from our own money)</span>
            </span>
            <span className="font-medium text-brand-danger">{formatCurrency(stats.cost)}</span>
          </div>
          {stats.revenue > 0 && (
            <div className="flex items-center justify-between py-1 text-sm">
              <span className="text-gray-600">+ Gifts charged to customers</span>
              <span className="font-medium text-gray-800">{formatCurrency(stats.revenue)}</span>
            </div>
          )}
          <div className={`mt-1 flex items-center justify-between border-t border-border pt-2 font-serif text-lg font-semibold ${lossMaking ? "text-brand-danger" : "text-brand-success"}`}>
            <span>{lossMaking ? "Loss" : "Profit"}</span>
            <span>{formatCurrency(Math.abs(stats.net))}</span>
          </div>
          <div className="mt-1 text-[11px] text-gray-400">
            Item sales − gift cost{stats.revenue > 0 ? " + gift money charged" : ""}. Item sales exclude gifts and hampers.
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-border bg-white/50 p-3">
              <div className="text-xs font-medium text-gray-500">{t.label}</div>
              <div className={`mt-1 font-serif text-xl font-semibold ${t.color}`}>{t.value}</div>
              <div className="mt-1 text-[11px] leading-snug text-gray-400">{t.note}</div>
            </div>
          ))}
        </div>
      </div>

      {stats.topItems.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Items sold {when} (top 5)</div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">In stock</th>
                <th className="text-right">Sold</th>
                <th className="text-right">Sales</th>
              </tr>
            </thead>
            <tbody>
              {stats.topItems.map((r) => (
                <tr key={r.id ?? r.name}>
                  <td>{r.name}</td>
                  <td className="text-right">{r.stock}</td>
                  <td className="text-right">{r.sold}</td>
                  <td className="text-right">{formatCurrency(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stats.perGift.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Gifts {when}</div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Gift</th>
                <th className="text-right">In stock</th>
                <th className="text-right">Given</th>
                <th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {stats.perGift.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="text-right">{r.stock}</td>
                  <td className="text-right">{r.sold}</td>
                  <td className="text-right">{formatCurrency(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-gray-400">
        Item sales come from invoices (product lines only). Gift cost is the cost price recorded when each gift was given.
        Gifts spent and stock come from the Gifts page: (units in stock + units given) × cost price.
      </p>
    </div>
  );
}
