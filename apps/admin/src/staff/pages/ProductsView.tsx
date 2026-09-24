import { useEffect, useState } from "react";
import { formatCurrency } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { Search } from "lucide-react";

interface Product {
  id: string;
  name: string;
  model: string;
  category: string | null;
  price: number;
  stock: number;
}

// `inventory` already has a public SELECT policy (the customer-facing
// website browses the same table) — no staff RPC needed for a read-only view.
export function ProductsView() {
  const [items, setItems] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("inventory")
      .select("id, name, model, category, price, stock")
      .eq("is_active", true)
      .order("name");
    setItems((data as Product[]) ?? []);
    setLoading(false);
  }

  const categories = ["All", ...Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[]))];
  const filtered = items
    .filter((i) => category === "All" || i.category === category)
    .filter((i) => `${i.name} ${i.model}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Products</h1>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products"
          className="input w-full pl-9"
        />
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
              category === c ? "border-brand-primary bg-brand-primary/10 text-brand-primary" : "border-border text-gray-500"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-sm text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">No products found.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <div key={p.id} className="card flex items-center justify-between p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-800">{p.name} {p.model}</div>
                <div className="text-xs text-gray-500">{p.category ?? "-"}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold text-brand-primary">{formatCurrency(p.price)}</div>
                <div className={`text-xs ${p.stock <= 0 ? "text-brand-danger" : "text-gray-400"}`}>{p.stock} in stock</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
