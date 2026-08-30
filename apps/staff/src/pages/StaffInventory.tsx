import { useEffect, useState } from "react";
import { formatCurrency, type Product } from "@sai/shared";
import { supabase } from "../lib/supabase";

export function StaffInventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("staff-inventory")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("products").select("*").order("name");
    setProducts(data ?? []);
  }

  async function updateStock(id: string, qty: number) {
    await supabase.from("products").update({ stock_qty: qty }).eq("id", id);
    setEditing(null);
  }

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold text-gray-800">Stock</h1>
      <input className="input" placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="card divide-y divide-border">
        {filtered.map((p) => (
          <div key={p.id} className="flex items-center justify-between p-3">
            <div>
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-gray-500">{formatCurrency(p.sale_price)}</div>
            </div>
            {editing === p.id ? (
              <input
                autoFocus
                type="number"
                defaultValue={p.stock_qty}
                className="w-16 rounded border border-brand-primary px-1 py-1 text-center text-sm"
                onBlur={(e) => updateStock(p.id, Number(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && updateStock(p.id, Number((e.target as HTMLInputElement).value))}
              />
            ) : (
              <button
                onClick={() => setEditing(p.id)}
                className={`rounded-full px-2 py-1 text-xs font-medium ${
                  p.stock_qty <= p.min_stock_alert ? "bg-red-100 text-brand-danger" : "bg-gray-100 text-gray-600"
                }`}
              >
                {p.stock_qty} in stock
              </button>
            )}
          </div>
        ))}
        {filtered.length === 0 && <p className="p-4 text-center text-sm text-gray-400">No products found</p>}
      </div>
    </div>
  );
}
