import { useEffect, useState } from "react";
import { formatCurrency } from "@sai/shared";
import { Gift } from "lucide-react";
import { supabase } from "../lib/supabase";

interface GiftItem {
  id: string;
  name: string;
  price: number;
  stock: number;
}

// `gifts` already has a public SELECT policy — browsing here is read-only;
// actually selling a gift happens from New Sale.
export function GiftsCatalog() {
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("gifts")
      .select("id, name, price, stock")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        setGifts((data as GiftItem[]) ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Gifts</h1>
      <p className="text-xs text-gray-500">This is the gift catalog.</p>
      {loading ? (
        <div className="text-center text-sm text-gray-400">Loading…</div>
      ) : gifts.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">No gifts set up yet.</div>
      ) : (
        <div className="space-y-2">
          {gifts.map((g) => (
            <div key={g.id} className="card flex items-center justify-between p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <Gift size={16} className="text-brand-primary" /> {g.name}
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-brand-primary">{formatCurrency(g.price)}</div>
                <div className={`text-xs ${g.stock <= 0 ? "text-brand-danger" : "text-gray-400"}`}>{g.stock} in stock</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
