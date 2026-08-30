import { useEffect, useState } from "react";
import { formatDate, formatCurrency, type WholesalerInvoice, type InvoiceItem, type Product } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Upload, Plus, Check, X, AlertCircle } from "lucide-react";

export function WholesalerInvoices() {
  const [invoices, setInvoices] = useState<WholesalerInvoice[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [active, setActive] = useState<WholesalerInvoice | null>(null);
  const [items, setItems] = useState<Partial<InvoiceItem>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [{ data: inv }, { data: prod }] = await Promise.all([
      supabase.from("wholesaler_invoices").select("*").order("created_at", { ascending: false }),
      supabase.from("products").select("*").order("name"),
    ]);
    setInvoices(inv ?? []);
    setProducts(prod ?? []);
  }

  async function uploadInvoice() {
    if (!supplierName.trim()) {
      setError("Please enter the supplier name.");
      return;
    }

    setUploading(true);
    setError(null);
    let file_url: string | null = null;

    try {
      if (file) {
        const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const { data, error: storageErr } = await supabase.storage.from("wholesaler-invoices").upload(path, file);
        if (!storageErr && data) {
          file_url = data.path;
        } else if (storageErr) {
          console.warn("Storage upload warning:", storageErr.message);
          // Continues even if storage bucket isn't created in Supabase
        }
      }

      const { data, error: insertErr } = await supabase
        .from("wholesaler_invoices")
        .insert({
          supplier_name: supplierName.trim(),
          invoice_number: invoiceNumber.trim() || null,
          file_url,
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      setSupplierName("");
      setInvoiceNumber("");
      setFile(null);
      setSuccess("Invoice uploaded successfully! You can now enter line items.");
      setTimeout(() => setSuccess(null), 4000);

      if (data) {
        setActive(data);
        setItems([{ product_name: "", qty: 1, unit_cost: 0 }]);
        await load();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create wholesaler invoice.");
    } finally {
      setUploading(false);
    }
  }

  async function saveLineItems() {
    if (!active) return;
    const rows = [...items].filter((i) => i.product_name?.trim());

    if (rows.length === 0) {
      setError("Please enter at least one product line item.");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Auto-create a product for any line not matched to existing product
      for (const row of rows) {
        if (!row.product_id) {
          const { data: newProduct, error: prodErr } = await supabase
            .from("products")
            .insert({
              name: row.product_name!.trim(),
              category: "Other",
              purchase_price: Number(row.unit_cost) || 0,
              sale_price: Math.round((Number(row.unit_cost) || 0) * 1.2), // Default 20% margin
              stock_qty: 0,
              min_stock_alert: 3,
              is_active: true,
            })
            .select()
            .single();

          if (!prodErr && newProduct) {
            row.product_id = newProduct.id;
          }
        }
      }

      const toInsert = rows.map((i) => ({
        invoice_id: active.id,
        product_id: i.product_id || null,
        product_name: i.product_name!.trim(),
        qty: Number(i.qty) || 1,
        unit_cost: Number(i.unit_cost) || 0,
      }));

      const { error: itemsErr } = await supabase.from("invoice_items").insert(toInsert);
      if (itemsErr) throw itemsErr;

      // Calculate total amount
      const totalAmount = toInsert.reduce((sum, item) => sum + item.qty * item.unit_cost, 0);
      await supabase
        .from("wholesaler_invoices")
        .update({ total_amount: totalAmount })
        .eq("id", active.id);

      // Process invoice to increment stock
      const { error: rpcErr } = await supabase.rpc("process_wholesaler_invoice", { p_invoice_id: active.id });
      if (rpcErr) throw rpcErr;

      setActive(null);
      setItems([]);
      setSuccess("Line items confirmed and stock updated!");
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to process line items.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Wholesaler Invoices</h1>
        <ExportExcelButton
          rows={invoices.map((i) => ({
            Supplier: i.supplier_name,
            "Invoice #": i.invoice_number ?? "",
            Date: i.created_at ? formatDate(i.created_at) : "",
            Total: i.total_amount ?? 0,
            Status: i.processed ? "Processed" : "Pending",
          }))}
          fileName="wholesaler-invoices"
        />
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 border border-emerald-200">
          <Check size={16} />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-brand-danger border border-red-200">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="block flex-1 min-w-[180px]">
          <span className="mb-1 block text-xs font-medium text-gray-600">Supplier Name *</span>
          <input
            className="input w-full"
            placeholder="e.g. Global Tech Distributors"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
          />
        </label>
        <label className="block w-48">
          <span className="mb-1 block text-xs font-medium text-gray-600">Invoice Number</span>
          <input
            className="input w-full font-mono text-xs"
            placeholder="e.g. WH-2026-0042"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
        </label>
        <label className="btn-secondary cursor-pointer">
          <Upload size={14} />
          <span className="max-w-[140px] truncate">{file ? file.name : "Attach Invoice"}</span>
          <input
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="btn-primary" onClick={uploadInvoice} disabled={uploading}>
          <Plus size={14} /> {uploading ? "Uploading..." : "Upload Invoice"}
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Invoice #</th>
              <th>Uploaded Date</th>
              <th className="text-right">Total Amount</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td className="font-medium text-gray-800">{i.supplier_name}</td>
                <td className="font-mono text-xs text-gray-500">{i.invoice_number || "-"}</td>
                <td className="text-gray-500 text-xs">{formatDate(i.created_at)}</td>
                <td className="text-right font-medium">{i.total_amount ? formatCurrency(i.total_amount) : "-"}</td>
                <td>
                  <StatusPill
                    status={i.processed ? "processed" : "pending"}
                    label={i.processed ? "Stock Updated" : "Pending Entry"}
                  />
                </td>
                <td className="text-right">
                  {!i.processed ? (
                    <button
                      className="btn-primary !py-1 !px-2.5 text-xs"
                      onClick={() => {
                        setError(null);
                        setActive(i);
                        setItems([{ product_name: "", qty: 1, unit_cost: 0 }]);
                      }}
                    >
                      Enter line items
                    </button>
                  ) : (
                    <span className="text-xs text-emerald-600 font-medium">✓ Processed</span>
                  )}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  No wholesaler invoices recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {active && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-2xl p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="text-base font-semibold text-gray-800">
                  Enter Line Items — {active.supplier_name}
                </h2>
                {active.invoice_number && (
                  <p className="text-xs text-gray-500 font-mono">Invoice #{active.invoice_number}</p>
                )}
              </div>
              <button onClick={() => setActive(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mb-3 flex items-start gap-2 rounded-md bg-red-50 p-3 text-xs text-brand-danger border border-red-200">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {items.map((it, idx) => (
                <div key={idx} className="rounded-lg border border-border p-3 space-y-2 bg-gray-50/50">
                  <div className="grid grid-cols-[1fr,auto,auto] gap-2">
                    <select
                      className="input w-full"
                      value={it.product_id ?? ""}
                      onChange={(e) => {
                        const p = products.find((p) => p.id === e.target.value);
                        const next = [...items];
                        next[idx] = {
                          ...it,
                          product_id: p?.id,
                          product_name: p?.name ?? it.product_name,
                          unit_cost: p?.purchase_price ?? it.unit_cost,
                        };
                        setItems(next);
                      }}
                    >
                      <option value="">Match existing product / leave for new</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku || "No SKU"})
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      placeholder="Qty"
                      className="input w-20 text-center"
                      min={1}
                      value={it.qty ?? 1}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...it, qty: Number(e.target.value) };
                        setItems(next);
                      }}
                    />

                    <input
                      type="number"
                      placeholder="Unit cost (₹)"
                      className="input w-28 text-right"
                      value={it.unit_cost ?? 0}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...it, unit_cost: Number(e.target.value) };
                        setItems(next);
                      }}
                    />
                  </div>

                  {!it.product_id && (
                    <input
                      placeholder="New product name (will be automatically added to catalog)"
                      className="input w-full text-xs"
                      value={it.product_name ?? ""}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...it, product_name: e.target.value };
                        setItems(next);
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            <button
              className="btn-secondary mt-3 flex items-center gap-1 text-xs"
              onClick={() => setItems([...items, { product_name: "", qty: 1, unit_cost: 0 }])}
            >
              <Plus size={13} /> Add another line
            </button>

            <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
              <div className="text-sm">
                <span className="text-gray-500">Estimated Total: </span>
                <span className="font-semibold text-gray-800">
                  {formatCurrency(
                    items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_cost) || 0), 0)
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setActive(null)} disabled={processing}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={saveLineItems} disabled={processing}>
                  <Check size={14} /> {processing ? "Processing..." : "Confirm & Update Stock"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
