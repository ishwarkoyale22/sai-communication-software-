import { useEffect, useRef, useState } from "react";
import { Plus, X, Edit2, Trash2, Check, AlertCircle, Upload, Loader2 } from "lucide-react";
import { formatCurrency } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";

const IMAGE_BUCKET = "product-images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

async function uploadProductImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Please choose a JPG, PNG, WEBP, or GIF image.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large — please choose one under 5MB.");
  }

  const ext = file.name.split(".").pop() || "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

interface Brand {
  id: string;
  name: string;
  is_active: boolean;
}

interface InventoryItem {
  id: string;
  name: string;
  brand_id: string | null;
  model: string;
  category: string | null;
  product_type: string;
  price: number;
  original_price: number | null;
  stock: number;
  images: string[] | null;
  specs: Record<string, unknown> | null;
  condition: string | null;
  grade: string | null;
  battery_health: number | null;
  warranty_months: number;
  is_featured: boolean;
  is_active: boolean;
}

// Must exactly match the live `inventory_category_check` constraint —
// verified directly against the database, not guessed:
// CHECK (category = ANY (ARRAY['Smartphones','Feature Phones','Tablets','Accessories','Refurbished']))
const CATEGORY_OPTIONS = ["Smartphones", "Feature Phones", "Tablets", "Accessories", "Refurbished"];

const emptyForm = {
  name: "",
  category: "Smartphones",
  brand_id: "",
  model: "",
  product_type: "new" as "new" | "refurbished",
  price: 0,
  original_price: 0,
  stock: 0,
  condition: "",
  grade: "",
  battery_health: 0,
  warranty_months: 0,
  is_featured: false,
  image_url: "",
};

export function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingCell, setEditingCell] = useState<{ id: string; field: "price" | "stock" } | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null); // instant preview before upload finishes
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    // Instant local preview (no network wait) — revoked once the real
    // uploaded URL takes over, so we don't leak object URLs.
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);

    setUploading(true);
    try {
      const publicUrl = await uploadProductImage(file);
      if (editingItem) {
        setEditingItem((prev) => (prev ? { ...prev, images: [publicUrl] } : prev));
      } else {
        setForm((prev) => ({ ...prev, image_url: publicUrl }));
      }
      setLocalPreview(null); // real hosted URL now takes over from the temporary blob preview
    } catch (err: any) {
      setError(err?.message || "Failed to upload image.");
      setLocalPreview(null);
    } finally {
      setUploading(false);
      URL.revokeObjectURL(objectUrl);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  useEffect(() => {
    load();
    loadBrands();
    const channel = supabase
      .channel("inventory-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("inventory").select("*").order("name");
    setItems((data as InventoryItem[]) ?? []);
  }

  async function loadBrands() {
    const { data } = await supabase.from("brands").select("id, name, is_active").eq("is_active", true).order("name");
    setBrands((data as Brand[]) ?? []);
  }

  function brandName(id: string | null) {
    return brands.find((b) => b.id === id)?.name ?? "-";
  }

  async function addItem() {
    if (!form.name.trim() || !form.model.trim()) {
      setError("Product name and model are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      console.info("[inventory] session before insert:", { hasSession: !!session, userId: session?.user?.id });
      if (!session) {
        setError("Your admin session has expired. Please sign out and sign in again, then retry.");
        setSaving(false);
        return;
      }

      const { error: insertErr } = await supabase.from("inventory").insert({
        name: form.name.trim(),
        model: form.model.trim(),
        category: form.category,
        brand_id: form.brand_id || null,
        product_type: form.product_type,
        price: Number(form.price) || 0,
        original_price: Number(form.original_price) || null,
        stock: Number(form.stock) || 0,
        condition: form.product_type === "refurbished" ? form.condition || null : null,
        grade: form.product_type === "refurbished" ? form.grade || null : null,
        battery_health: form.product_type === "refurbished" ? Number(form.battery_health) || null : null,
        warranty_months: Number(form.warranty_months) || 0,
        is_featured: form.is_featured,
        images: form.image_url.trim() ? [form.image_url.trim()] : [],
        is_active: true,
      });

      if (insertErr) throw insertErr;

      setForm(emptyForm);
      setShowAddForm(false);
      setSuccess("Item added successfully!");
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to add item.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEditedItem() {
    if (!editingItem || !editingItem.name.trim()) {
      setError("Product name is required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { error: updateErr } = await supabase
        .from("inventory")
        .update({
          name: editingItem.name.trim(),
          model: editingItem.model.trim(),
          category: editingItem.category,
          brand_id: editingItem.brand_id || null,
          product_type: editingItem.product_type,
          price: Number(editingItem.price) || 0,
          original_price: Number(editingItem.original_price) || null,
          condition: editingItem.product_type === "refurbished" ? editingItem.condition || null : null,
          grade: editingItem.product_type === "refurbished" ? editingItem.grade || null : null,
          battery_health: editingItem.product_type === "refurbished" ? editingItem.battery_health || null : null,
          warranty_months: Number(editingItem.warranty_months) || 0,
          is_featured: editingItem.is_featured,
          images: editingItem.images ?? [],
          is_active: editingItem.is_active,
        })
        .eq("id", editingItem.id);

      if (updateErr) throw updateErr;

      setEditingItem(null);
      setSuccess("Item updated successfully!");
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to update item.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(p: InventoryItem) {
    if (!confirm(`Are you sure you want to delete or deactivate "${p.name}"?`)) return;

    try {
      const { error: delErr } = await supabase.from("inventory").delete().eq("id", p.id);
      if (delErr) {
        // Likely referenced by a sale/order — deactivate instead of a hard delete.
        await supabase.from("inventory").update({ is_active: false }).eq("id", p.id);
      }
      setSuccess(`"${p.name}" updated.`);
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (err: any) {
      alert(err?.message || "Failed to delete item.");
    }
  }

  async function updateField(id: string, field: "price" | "stock", value: number) {
    await supabase.from("inventory").update({ [field]: value }).eq("id", id);
    setEditingCell(null);
    load();
  }

  const filtered = items.filter((p) => {
    if (category !== "All" && p.category !== category) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.model?.toLowerCase().includes(search.toLowerCase())) {
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
              Model: p.model,
              Category: p.category,
              Brand: brandName(p.brand_id),
              Type: p.product_type,
              Price: p.price,
              "Original Price": p.original_price,
              Stock: p.stock,
              Active: p.is_active ? "Yes" : "No",
            }))}
            fileName="inventory"
          />
          <button
            className="btn-primary flex items-center gap-1.5"
            onClick={() => {
              setError(null);
              setLocalPreview(null);
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
          placeholder="Search name or model..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72 rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-primary"
        >
          <option value="All">All Categories</option>
          {CATEGORY_OPTIONS.map((c) => (
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
              <th className="w-14"></th>
              <th>Name</th>
              <th>Category</th>
              <th>Brand</th>
              <th>Type</th>
              <th className="text-right">Price</th>
              <th className="text-right">Stock</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const low = p.stock <= 5;
              return (
                <tr key={p.id} className={low ? "bg-red-50/60" : !p.is_active ? "opacity-50" : ""}>
                  <td>
                    {p.images?.[0] ? (
                      <img
                        src={p.images[0]}
                        alt={p.name}
                        className="h-10 w-10 rounded object-cover"
                        onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-gray-100" />
                    )}
                  </td>
                  <td className="font-medium text-gray-800">
                    {p.name}
                    <div className="text-xs font-normal text-gray-400">{p.model}</div>
                    {!p.is_active && <span className="ml-2 text-xs text-gray-400">(Inactive)</span>}
                    {p.is_featured && <span className="ml-1 text-xs text-amber-600">★</span>}
                  </td>
                  <td>{p.category}</td>
                  <td className="text-gray-500">{brandName(p.brand_id)}</td>
                  <td className="text-gray-500 capitalize">{p.product_type}</td>
                  <td
                    className="cursor-pointer text-right"
                    onClick={() => setEditingCell({ id: p.id, field: "price" })}
                    title="Click to edit price"
                  >
                    {editingCell?.id === p.id && editingCell.field === "price" ? (
                      <input
                        autoFocus
                        type="number"
                        defaultValue={p.price}
                        className="w-24 rounded border border-brand-primary px-1 py-0.5 text-right text-sm"
                        onBlur={(e) => updateField(p.id, "price", Number(e.target.value))}
                        onKeyDown={(e) => e.key === "Enter" && updateField(p.id, "price", Number((e.target as HTMLInputElement).value))}
                      />
                    ) : (
                      <span className="underline decoration-dotted decoration-gray-300 font-medium">
                        {formatCurrency(p.price)}
                      </span>
                    )}
                  </td>
                  <td
                    className={`cursor-pointer text-right font-medium ${low ? "text-brand-danger font-bold" : ""}`}
                    onClick={() => setEditingCell({ id: p.id, field: "stock" })}
                    title="Click to adjust stock"
                  >
                    {editingCell?.id === p.id && editingCell.field === "stock" ? (
                      <input
                        autoFocus
                        type="number"
                        defaultValue={p.stock}
                        className="w-16 rounded border border-brand-primary px-1 py-0.5 text-right text-sm"
                        onBlur={(e) => updateField(p.id, "stock", Number(e.target.value))}
                        onKeyDown={(e) => e.key === "Enter" && updateField(p.id, "stock", Number((e.target as HTMLInputElement).value))}
                      />
                    ) : (
                      <span className="underline decoration-dotted decoration-gray-300">{p.stock}</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="btn-secondary !px-2 !py-1 text-xs"
                        onClick={() => {
                          setError(null);
                          setLocalPreview(null);
                          setEditingItem(p);
                        }}
                        title="Edit"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        className="btn-ghost !px-2 !py-1 text-xs text-brand-danger hover:bg-red-50"
                        onClick={() => deleteItem(p)}
                        title="Delete"
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
                  No items found. Click &ldquo;Add Product&rdquo; to add items to your catalog.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(showAddForm || editingItem) && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-gray-800">{editingItem ? "Edit Product" : "Add New Product"}</h2>
              <button
                onClick={() => (editingItem ? setEditingItem(null) : setShowAddForm(false))}
                className="text-gray-400 hover:text-gray-600"
              >
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
                  value={editingItem ? editingItem.name : form.name}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, name: e.target.value })
                      : setForm({ ...form, name: e.target.value })
                  }
                />
              </Field>

              <Field label="Model *">
                <input
                  className="input w-full"
                  value={editingItem ? editingItem.model : form.model}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, model: e.target.value })
                      : setForm({ ...form, model: e.target.value })
                  }
                />
              </Field>

              <Field label="Product Image">
                <div className="flex items-start gap-3">
                  <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                    {uploading ? (
                      <Loader2 className="size-5 animate-spin text-gray-400" />
                    ) : localPreview || (editingItem ? editingItem.images?.[0] : form.image_url) ? (
                      <img
                        src={localPreview || (editingItem ? editingItem.images?.[0] : form.image_url) || ""}
                        alt="Preview"
                        className="h-full w-full object-cover"
                        onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                      />
                    ) : (
                      <span className="text-[10px] text-gray-400">No image</span>
                    )}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => handleImageFile(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      className="btn-secondary flex items-center gap-1.5 !py-1.5 text-xs"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={13} />
                      {uploading ? "Uploading…" : "Upload from computer"}
                    </button>
                    <details className="text-xs text-gray-500">
                      <summary className="cursor-pointer select-none">Or paste an image URL instead</summary>
                      <input
                        className="input mt-1.5 w-full"
                        placeholder="https://..."
                        value={editingItem ? editingItem.images?.[0] ?? "" : form.image_url}
                        onChange={(e) =>
                          editingItem
                            ? setEditingItem({ ...editingItem, images: e.target.value ? [e.target.value] : [] })
                            : setForm({ ...form, image_url: e.target.value })
                        }
                      />
                    </details>
                  </div>
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Category">
                  <select
                    className="input w-full"
                    value={editingItem ? editingItem.category ?? "" : form.category}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, category: e.target.value })
                        : setForm({ ...form, category: e.target.value })
                    }
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Brand">
                  <select
                    className="input w-full"
                    value={editingItem ? editingItem.brand_id ?? "" : form.brand_id}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, brand_id: e.target.value })
                        : setForm({ ...form, brand_id: e.target.value })
                    }
                  >
                    <option value="">-</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Type">
                <select
                  className="input w-full"
                  value={editingItem ? editingItem.product_type : form.product_type}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, product_type: e.target.value })
                      : setForm({ ...form, product_type: e.target.value as "new" | "refurbished" })
                  }
                >
                  <option value="new">New</option>
                  <option value="refurbished">Refurbished</option>
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Price (₹) *">
                  <input
                    type="number"
                    className="input w-full"
                    value={editingItem ? editingItem.price : form.price}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, price: Number(e.target.value) })
                        : setForm({ ...form, price: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label="Original Price (₹)">
                  <input
                    type="number"
                    className="input w-full"
                    value={editingItem ? editingItem.original_price ?? 0 : form.original_price}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, original_price: Number(e.target.value) })
                        : setForm({ ...form, original_price: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>

              {!editingItem && (
                <Field label="Initial Stock">
                  <input
                    type="number"
                    className="input w-full"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
                  />
                </Field>
              )}

              {(editingItem ? editingItem.product_type : form.product_type) === "refurbished" && (
                <div className="grid grid-cols-3 gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-2">
                  <Field label="Condition">
                    <input
                      className="input w-full"
                      value={editingItem ? editingItem.condition ?? "" : form.condition}
                      onChange={(e) =>
                        editingItem
                          ? setEditingItem({ ...editingItem, condition: e.target.value })
                          : setForm({ ...form, condition: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Grade">
                    <input
                      className="input w-full"
                      value={editingItem ? editingItem.grade ?? "" : form.grade}
                      onChange={(e) =>
                        editingItem
                          ? setEditingItem({ ...editingItem, grade: e.target.value })
                          : setForm({ ...form, grade: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Battery %">
                    <input
                      type="number"
                      className="input w-full"
                      value={editingItem ? editingItem.battery_health ?? 0 : form.battery_health}
                      onChange={(e) =>
                        editingItem
                          ? setEditingItem({ ...editingItem, battery_health: Number(e.target.value) })
                          : setForm({ ...form, battery_health: Number(e.target.value) })
                      }
                    />
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Field label="Warranty (months)">
                  <input
                    type="number"
                    className="input w-full"
                    value={editingItem ? editingItem.warranty_months : form.warranty_months}
                    onChange={(e) =>
                      editingItem
                        ? setEditingItem({ ...editingItem, warranty_months: Number(e.target.value) })
                        : setForm({ ...form, warranty_months: Number(e.target.value) })
                    }
                  />
                </Field>
                {editingItem && (
                  <div className="flex items-center pt-5">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingItem.is_active}
                        onChange={(e) => setEditingItem({ ...editingItem, is_active: e.target.checked })}
                        className="rounded border-gray-300 text-brand-primary"
                      />
                      Active (Listed)
                    </label>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 pt-1 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingItem ? editingItem.is_featured : form.is_featured}
                  onChange={(e) =>
                    editingItem
                      ? setEditingItem({ ...editingItem, is_featured: e.target.checked })
                      : setForm({ ...form, is_featured: e.target.checked })
                  }
                  className="rounded border-gray-300 text-brand-primary"
                />
                Featured on website
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => (editingItem ? setEditingItem(null) : setShowAddForm(false))}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={editingItem ? saveEditedItem : addItem} disabled={saving}>
                {saving ? "Saving..." : "Save"}
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
