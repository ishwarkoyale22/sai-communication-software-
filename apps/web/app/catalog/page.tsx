"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CATEGORIES, type Category, type Product } from "@sai/shared";
import { supabase } from "../../lib/supabase";
import { EnquiryForm } from "../../components/EnquiryForm";
import { ProductCard } from "../../components/ProductCard";
import { Reveal } from "../../components/Reveal";

function CatalogInner() {
  const searchParams = useSearchParams();
  const initialCategory = (searchParams.get("category") as Category) || "All";
  const [category, setCategory] = useState<Category | "All">(initialCategory);
  const [products, setProducts] = useState<Product[]>([]);
  const [enquireFor, setEnquireFor] = useState<Product | null>(null);

  useEffect(() => {
    load();
    // Realtime: stock/price changes in admin reflect here within seconds,
    // and items that hit 0 stock disappear without a page reload.
    const channel = supabase
      .channel("public-catalog")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase
      .from("products")
      .select("*")
      .gt("stock_qty", 0)
      .eq("is_active", true)
      .order("name");
    setProducts(data ?? []);
  }

  const filtered = category === "All" ? products : products.filter((p) => p.category === category);

  return (
    <main className="mx-auto max-w-6xl px-6 py-14">
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">
          Our <em>Catalog</em>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          Live stock, straight from the store — updated the moment anything changes.
        </p>
      </div>

      <div className="mb-8 flex flex-wrap justify-center gap-2">
        <button
          onClick={() => setCategory("All")}
          className={category === "All" ? "tag-soft !bg-primary !text-white" : "tag-soft"}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={category === c ? "tag-soft !bg-primary !text-white" : "tag-soft"}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        {filtered.map((p, i) => (
          <Reveal key={p.id} delay={(i % 8) * 40}>
            <ProductCard product={p} onEnquire={setEnquireFor} />
          </Reveal>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-10 text-center text-muted-foreground">
            No products in this category right now.
          </p>
        )}
      </div>

      {enquireFor && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
          onClick={() => setEnquireFor(null)}
        >
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <EnquiryForm productInterest={enquireFor.name} />
          </div>
        </div>
      )}
    </main>
  );
}

export default function CatalogPage() {
  return (
    <Suspense>
      <CatalogInner />
    </Suspense>
  );
}
