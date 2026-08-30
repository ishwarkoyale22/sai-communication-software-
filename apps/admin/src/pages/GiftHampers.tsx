import { useEffect, useState } from "react";
import { formatCurrency, type Product } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";

export function GiftHampers() {
  const [hampers, setHampers] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase.from("products").select("*").order("name");
    setAllProducts(data ?? []);
    setHampers((data ?? []).filter((p) => p.is_gift_hamper));
  }

  function bundledNames(h: Product) {
    return (h.hamper_item_ids ?? [])
      .map((id) => allProducts.find((p) => p.id === id)?.name)
      .filter(Boolean)
      .join(", ");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Gift Hampers</h1>
        <ExportExcelButton
          rows={hampers.map((h) => ({
            Name: h.name,
            "Sale Price": h.sale_price,
            Stock: h.stock_qty,
            "Bundled Items": bundledNames(h),
          }))}
          fileName="gift-hampers"
        />
      </div>
      <p className="text-sm text-gray-500">
        Products flagged as <strong>Gift Hamper</strong> in Inventory show here. Bundle SKUs into a
        hamper by editing the product's <code>hamper_item_ids</code> — same billing flow as regular
        products.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {hampers.map((h) => (
          <div key={h.id} className="card p-4">
            <div className="font-medium text-gray-800">{h.name}</div>
            <div className="mt-1 text-sm text-gray-500">{bundledNames(h) || "No items bundled yet"}</div>
            <div className="mt-2 flex items-center justify-between">
              <span className="pill-info">Stock: {h.stock_qty}</span>
              <span className="font-semibold text-brand-primary">{formatCurrency(h.sale_price)}</span>
            </div>
          </div>
        ))}
        {hampers.length === 0 && <p className="text-sm text-gray-400">No gift hampers yet.</p>}
      </div>
    </div>
  );
}
