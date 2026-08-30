"use client";

import { formatCurrency, type Product } from "@sai/shared";
import { Package } from "lucide-react";

export function ProductCard({
  product,
  onEnquire,
}: {
  product: Product;
  onEnquire: (p: Product) => void;
}) {
  const lowStock = product.stock_qty > 0 && product.stock_qty <= product.min_stock_alert;

  return (
    <div className="card-surface hover-glow group flex flex-col overflow-hidden">
      <div className="relative flex aspect-[4/3] items-center justify-center bg-accent">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <Package className="text-gold/40" size={40} />
        )}
        <span
          className={`badge-gold absolute left-2.5 top-2.5 !border-0 !bg-card/90 ${
            lowStock ? "!text-destructive" : "!text-success-fg"
          }`}
        >
          {lowStock ? `Only ${product.stock_qty} left` : "In stock"}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {product.brand && <div className="caption-mono">{product.brand}</div>}
        <h3 className="mt-1 font-display text-base font-medium text-foreground">{product.name}</h3>
        {product.model && <p className="mt-0.5 text-xs text-muted-foreground">{product.model}</p>}

        <hr className="my-3" />

        <div className="mt-auto flex items-center justify-between">
          <span className="font-display text-lg font-semibold text-primary">
            {formatCurrency(product.sale_price)}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn-outline !py-2 text-xs" onClick={() => onEnquire(product)}>
            Details
          </button>
          <button className="btn-primary !py-2 text-xs" onClick={() => onEnquire(product)}>
            Enquire
          </button>
        </div>
      </div>
    </div>
  );
}
