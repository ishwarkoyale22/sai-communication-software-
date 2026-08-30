import { useEffect, useState } from "react";
import { Plus, X, Edit2, Trash2, Check, AlertCircle } from "lucide-react";
import { CATEGORIES, formatCurrency, type Category, type Product, type DbCategory, type Brand } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";

const emptyForm = {
  name: "",
  category: "Mobiles" as Category,
  brand: "",
  model: "",
  sku: "",
  purchase_price: 0,
  sale_price: 0,
  stock_qty: 0,
  min_stock_alert: 3,
  barcode: "",
  buyer_code: "",
  is_gift_hamper: false,
};

export function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [category, setCategory] = useState<Category | "All">("All");
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingCell, setEditingCell] = useState<{ id: string; field: "sale_price" | "stock_qty" } | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(CATEGORIES);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }: { data: DbCategory[] | null }) => {
        if (data && data.length) setCategoryOptions(data.map((c) => c.name));
      });
    loadBrands();
    const channel = supabase
      .channel("products-inventory")
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

  async function loadBrands() {
    const { data } = await supabase.from("brands").select("*").eq("is_active", true).order("name");
    setBrands(data ?? []);
  }

  async function addProduct() {
    if (!form.name.trim()) {
      setError("Product name is required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (form.brand) {
        await supabase.from("brands").upsert({ name: form.brand.trim() }, { onConflict: "name", ignoreDuplicates: true });
      }

      const { error: insertErr } = await supabase.from("products").insert({
        name: form.name.trim(),
        category: form.category,
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        sku: form.sku.trim() || null,
        purchase_price: Number(form.purchase_price) || 0,
        sale_price: Number(form.sale_price) || 0,
        stock_qty: Number(form.stock_qty) || 0,
        min_stock_alert: Number(form.min_stock_alert) || 3,
        barcode: form.barcode.trim() || null,
        buyer_code: form.buyer_code.trim() || null,
        is_gift_hamper: form.is_gift_hamper,
        is_active: true,
      });

      if (insertErr) throw insertErr;

      setForm(emptyForm);
      setShowAddForm(false);
      setSuccess("Product added successfully!");
      setTimeout(() => setSuccess(null), 4000);
      if (form.brand) loadBrands();
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to add product.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEditedProduct() {
    if (!editingProduct || !editingProduct.name.trim()) {
      setError("Product name is required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingProduct.brand) {
        await supabase.from("brands").upsert({ name: editingProduct.brand.trim() }, { onConflict: "name", ignoreDuplicates: true });
      }

      const { error: updateErr } = await supabase
        .from("products")
        .update({
          name: editingProduct.name.trim(),
          category: editingProduct.category,
          brand: editingProduct.brand?.trim() || null,
          model: editingProduct.model?.trim() || null,
          sku: editingProduct.sku?.trim() || null,
          purchase_price: Number(editingProduct.purchase_price) || 0,
          sale_price: Number(editingProduct.sale_price) || 0,
          min_stock_alert: Number(editingProduct.min_stock_alert) || 3,
          barcode: editingProduct.barcode?.trim() || null,
          buyer_code: editingProduct.buyer_code?.trim() || null,
          is_gift_hamper: editingProduct.is_gift_hamper,
          is_active: editingProduct.is_active,
        })
        .eq("id", editingProduct.id);

      if (updateErr) throw updateErr;

      setEditingProduct(null);
      setSuccess("Product updated successfully!");
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to update product.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(p: Product) {
    if (!confirm(`Are you sure you want to delete or deactivate "${p.name}"?`)) return;

    try {
      const { error: delErr } = await supabase.from("products").delete().eq("id", p.id);
      if (delErr) {
        // Fallback to deactivate if referenced in sales
        await supabase.from("products").update({ is_active: false }).eq("id", p.id);
      }
      setSuccess(`Product "${p.name}" updated.`);
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (err: any) {
      alert(err?.message || "Failed to delete product.");
    }
  }

  async function updateField(id: string, field: "sale_price" | "stock_qty", value: number) {
    const currentProd = products.find((p) => p.id === id);
    if (!currentProd) return;

    if (field === "stock_qty") {
      const diff = value - currentProd.stock_qty;
      if (diff !== 0) {
        // Try calling adjust_stock_manual RPC for audit trail
        const { error: rpcErr } = await supabase.rpc("adjust_stock_manual", {
          p_product_id: id,
          p_change_qty: diff,
          p_note: "Manual edit in inventory table",
        });

        if (rpcErr) {
          // Direct fallback
          await supabase.from("products").update({ stock_qty: value }).eq("id", id);
        }
      }
    } else {
      await supabase.from("products").update({ [field]: value }).eq("id", id);
    }

    setEditingCell(null);
    load();
  }

  const filtered = products.filter((p) => {
    if (category !== "All" && p.category !== category) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.sku?.toLowerCase().includes(search.toLowerCase()) && !p.barcode?.includes(search)) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Inventory Catalog</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={filtered.map((p) => ({
              Name: p.name,
              Category: p.category,
              Brand: p.brand ?? "",
              SKU: p.sku ?? "",
              Barcode: p.barcode ?? "",
              "Purchase Price": p.purchase_price,
              "Sale Price": p.sale_price,
              Stock: p.stock_qty,
              "Min Alert": p.min_stock_alert,
              Active: p.is_active ? "Yes" : "No",
            }))}
            fileName="inventory"
          />
          <button
            className="btn-primary flex items-center gap-1.5"
            onClick={() => {
              setError(null);
              setShowAddForm(true);
            }}
          >
            <Plus size={15} /> Add Product
          </button>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 border border-emerald-200">
          <Check size={16} />
          <span>{success}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          placeholder="Search name, brand, SKU or barcode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | "All")}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
        >
          <option value="All">All Categories</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Brand</th>
              <th>SKU / Barcode</th>
              <th className="text-right">Purchase</th>
              <th className="text-right">Sale Price</th>
              <th className="text-right">Stock</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const low = p.stock_qty <= p.min_stock_alert;
              return (
                <tr key={p.id} className={low ? "bg-red-50/60" : !p.is_active ? "opacity-50" : ""}>
                  <td className="font-medium text-gray-800">
                    {p.name}
                    {!p.is_active && <span className="ml-2 text-xs text-gray-400">(Inactive)</span>}
                    {p.is_gift_hamper && <span className="ml-1 text-xs text-amber-600">🎁</span>}
                  </td>
                  <td>{p.category}</td>
                  <td className="text-gray-500">{p.brand ?? "-"}</td>
                  <td className="text-gray-500 font-mono text-xs">
                    {p.sku || "-"} {p.barcode ? `· ${p.barcode}` : ""}
                  </td>
                  <td className="text-right font-mono text-xs">{formatCurrency(p.purchase_price)}</td>
                  <td
                    className="cursor-pointer text-right"
                    onClick={() => setEditingCell({ id: p.id, field: "sale_price" })}
                    title="Click to edit sale price"
                  >
                    {editingCell?.id === p.id && editingCell.field === "sale_price" ? (
                      <input
                        autoFocus
                        type="number"
                        defaultValue={p.sale_price}
                        className="w-24 rounded border border-brand-primary px-1 py-0.5 text-right text-sm"
                        onBlur={(e) => updateField(p.id, "sale_price", Number(e.target.value))}
                        onKeyDown={(e) => e.key === "Enter" && updateField(p.id, "sale_price", Number((e.target as HTMLInputElement).value))}
                      />
                    ) : (
                      <span className="underline decoration-dotted decoration-gray-300 font-medium">
                        {formatCurrency(p.sale_price)}
                      </span>
                    )}
                  </td>
                  <td
                    className={`cursor-pointer text-right font-medium ${low ? "text-brand-danger font-bold" : ""}`}
                    onClick={() => setEditingCell({ id: p.id, field: "stock_qty" })}
                    title="Click to adjust stock"
                  >
                    {editingCell?.id === p.id && editingCell.field === "stock_qty" ? (
                      <input
                        autoFocus
                        type="number"
                        defaultValue={p.stock_qty}
                        className="w-16 rounded border border-brand-primary px-1 py-0.5 text-right text-sm"
                        onBlur={(e) => updateField(p.id, "stock_qty", Number(e.target.value))}
                        onKeyDown={(e) => e.key === "Enter" && updateField(p.id, "stock_qty", Number((e.target as HTMLInputElement).value))}
                      />
                    ) : (
                      <span className="underline decoration-dotted decoration-gray-300">{p.stock_qty}</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="btn-secondary !px-2 !py-1 text-xs"
                        onClick={() => {
                          setError(null);
                          setEditingProduct(p);
                        }}
                        title="Edit Product"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        className="btn-ghost !px-2 !py-1 text-xs text-brand-danger hover:bg-red-50"
                        onClick={() => deleteProduct(p)}
                        title="Delete Product"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-400">
                  No products found. Click &ldquo;Add Product&rdquo; to add items to your catalog.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Product Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-gray-800">Add New Product</h2>
              <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mb-3 flex items-start gap-2 rounded-md bg-red-50 p-3 text-xs text-brand-danger border border-red-200">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <Field label="Product Name *">
                <input
                  className="input w-full"
                  placeholder="e.g. iPhone 15 (128GB) Blue"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Category">
                  <select
                    className="input w-full"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                  >
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Brand">
                  <input
                    className="input w-full"
                    list="brand-options"
                    placeholder="e.g. Apple, Samsung"
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  />
                  <datalist id="brand-options">
                    {brands.map((b) => (
                      <option key={b.name} value={b.name} />
                    ))}
                  </datalist>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="SKU">
                  <input className="input w-full" placeholder="e.g. MOB-APL-15" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
                </Field>
                <Field label="Barcode">
                  <input className="input w-full" placeholder="e.g. 890123456789" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Purchase Price (₹)">
                  <input
                    type="number"
                    className="input w-full"
                    value={form.purchase_price}
                    onChange={(e) => setForm({ ...form, purchase_price: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Sale Price (₹) *">
                  <input
                    type="number"
                    className="input w-full"
                    value={form.sale_price}
                    onChange={(e) => setForm({ ...form, sale_price: Number(e.target.value) })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Stock Quantity">
                  <input
                    type="number"
                    className="input w-full"
                    value={form.stock_qty}
                    onChange={(e) => setForm({ ...form, stock_qty: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Min Alert Qty">
                  <input
                    type="number"
                    className="input w-full"
                    value={form.min_stock_alert}
                    onChange={(e) => setForm({ ...form, min_stock_alert: Number(e.target.value) })}
                  />
                </Field>
              </div>

              <label className="flex items-center gap-2 pt-1 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_gift_hamper}
                  onChange={(e) => setForm({ ...form, is_gift_hamper: e.target.checked })}
                  className="rounded border-gray-300 text-brand-primary"
                />
                Mark as Gift Hamper combo pack
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
              <button type="button" className="btn-ghost" onClick={() => setShowAddForm(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={addProduct} disabled={saving}>
                {saving ? "Saving..." : "Save Product"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-gray-800">Edit Product</h2>
              <button onClick={() => setEditingProduct(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mb-3 flex items-start gap-2 rounded-md bg-red-50 p-3 text-xs text-brand-danger border border-red-200">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <Field label="Product Name *">
                <input
                  className="input w-full"
                  value={editingProduct.name}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Category">
                  <select
                    className="input w-full"
                    value={editingProduct.category}
                    onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value as Category })}
                  >
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Brand">
                  <input
                    className="input w-full"
                    list="brand-options-edit"
                    value={editingProduct.brand ?? ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, brand: e.target.value })}
                  />
                  <datalist id="brand-options-edit">
                    {brands.map((b) => (
                      <option key={b.name} value={b.name} />
                    ))}
                  </datalist>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="SKU">
                  <input
                    className="input w-full"
                    value={editingProduct.sku ?? ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                  />
                </Field>
                <Field label="Barcode">
                  <input
                    className="input w-full"
                    value={editingProduct.barcode ?? ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Purchase Price (₹)">
                  <input
                    type="number"
                    className="input w-full"
                    value={editingProduct.purchase_price}
                    onChange={(e) => setEditingProduct({ ...editingProduct, purchase_price: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Sale Price (₹) *">
                  <input
                    type="number"
                    className="input w-full"
                    value={editingProduct.sale_price}
                    onChange={(e) => setEditingProduct({ ...editingProduct, sale_price: Number(e.target.value) })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Min Alert Qty">
                  <input
                    type="number"
                    className="input w-full"
                    value={editingProduct.min_stock_alert}
                    onChange={(e) => setEditingProduct({ ...editingProduct, min_stock_alert: Number(e.target.value) })}
                  />
                </Field>
                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingProduct.is_active}
                      onChange={(e) => setEditingProduct({ ...editingProduct, is_active: e.target.checked })}
                      className="rounded border-gray-300 text-brand-primary"
                    />
                    Active (Listed)
                  </label>
                </div>
              </div>

              <label className="flex items-center gap-2 pt-1 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingProduct.is_gift_hamper}
                  onChange={(e) => setEditingProduct({ ...editingProduct, is_gift_hamper: e.target.checked })}
                  className="rounded border-gray-300 text-brand-primary"
                />
                Mark as Gift Hamper combo pack
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
              <button type="button" className="btn-ghost" onClick={() => setEditingProduct(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={saveEditedProduct} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}
