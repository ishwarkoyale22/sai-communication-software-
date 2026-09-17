import { useEffect, useRef, useState } from "react";
import { softDelete } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { Plus, Trash2, X, Upload, Loader2, ArrowUp, ArrowDown, AlertCircle } from "lucide-react";

const IMAGE_BUCKET = "gallery";
const MAX_IMAGE_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1GB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

interface GalleryItem {
  id: string;
  image_url: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
  media_type: "image" | "video";
}

async function uploadGalleryMedia(file: File): Promise<{ url: string; mediaType: "image" | "video" }> {
  const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
  const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
  if (!isVideo && !isImage) {
    throw new Error("Please choose a JPG, PNG, WEBP, GIF image or an MP4, WEBM, MOV video.");
  }
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    throw new Error(isVideo ? "Video is too large — please choose one under 1GB." : "Image is too large — please choose one under 100MB.");
  }
  const ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error: uploadErr } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
  if (uploadErr) throw uploadErr;
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, mediaType: isVideo ? "video" : "image" };
}

export function Gallery() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [caption, setCaption] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("gallery-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "gallery" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("gallery").select("*").order("sort_order").order("created_at");
    setItems((data as GalleryItem[]) ?? []);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { url, mediaType: type } = await uploadGalleryMedia(file);
      setImageUrl(url);
      setMediaType(type);
    } catch (err: any) {
      setError(err?.message || "Failed to upload media.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function addItem() {
    if (!imageUrl.trim()) {
      setError("Upload or paste an image URL first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
      const { error: insertErr } = await supabase.from("gallery").insert({
        image_url: imageUrl.trim(),
        caption: caption.trim() || null,
        sort_order: maxOrder + 1,
        media_type: mediaType,
      });
      if (insertErr) throw insertErr;
      setCaption("");
      setImageUrl("");
      setMediaType("image");
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to add photo.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: GalleryItem) {
    if (!confirm("Remove this photo from the gallery? You can restore it from the Recycle Bin afterwards.")) return;
    await softDelete(supabase, "gallery", item.id, item.caption ?? undefined);
    load();
  }

  async function move(item: GalleryItem, direction: -1 | 1) {
    const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((i) => i.id === item.id);
    const swapWith = sorted[idx + direction];
    if (!swapWith) return;
    await Promise.all([
      supabase.from("gallery").update({ sort_order: swapWith.sort_order }).eq("id", item.id),
      supabase.from("gallery").update({ sort_order: item.sort_order }).eq("id", swapWith.id),
    ]);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Gallery</h1>
          <p className="text-xs text-gray-500">Photos and videos shown on the public website's Gallery page.</p>
        </div>
        <button className="btn-primary" onClick={() => { setError(null); setShowForm(true); }}>
          <Plus size={14} /> Add Photo / Video
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item, idx) => (
          <div key={item.id} className="card overflow-hidden">
            {item.media_type === "video" ? (
              <video src={item.image_url} className="h-36 w-full object-cover" muted playsInline controls />
            ) : (
              <img src={item.image_url} alt={item.caption ?? ""} className="h-36 w-full object-cover" />
            )}
            <div className="p-2">
              <p className="truncate text-xs text-gray-600">{item.caption || "—"}</p>
              <div className="mt-1 flex items-center justify-between">
                <div className="flex gap-0.5">
                  <button className="btn-ghost !p-1" disabled={idx === 0} onClick={() => move(item, -1)}>
                    <ArrowUp size={12} />
                  </button>
                  <button className="btn-ghost !p-1" disabled={idx === items.length - 1} onClick={() => move(item, 1)}>
                    <ArrowDown size={12} />
                  </button>
                </div>
                <button className="btn-ghost !p-1 text-brand-danger" onClick={() => remove(item)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="col-span-full py-8 text-center text-sm text-gray-400">No photos or videos yet — click "Add Photo / Video" above.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
          <div className="card w-full max-w-sm space-y-3 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">Add Photo / Video</h2>
              <button onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-brand-danger">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex size-24 items-center justify-center overflow-hidden rounded-md border border-gray-200 bg-gray-50">
              {uploading ? (
                <Loader2 className="size-5 animate-spin text-gray-400" />
              ) : imageUrl ? (
                mediaType === "video" ? (
                  <video src={imageUrl} className="h-full w-full object-cover" muted playsInline controls />
                ) : (
                  <img src={imageUrl} alt="Preview" className="h-full w-full object-cover" />
                )
              ) : (
                <span className="text-[10px] text-gray-400">No media</span>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button type="button" className="btn-secondary flex w-full items-center justify-center gap-1.5" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              <Upload size={13} /> {uploading ? "Uploading…" : "Upload from computer"}
            </button>
            <p className="text-center text-[10px] text-gray-400">Images up to 100MB, videos up to 1GB</p>

            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer select-none">Or paste an image/video URL instead</summary>
              <input
                className="input mt-1.5 w-full"
                placeholder="https://..."
                value={imageUrl}
                onChange={(e) => {
                  setImageUrl(e.target.value);
                  setMediaType(/\.(mp4|webm|mov)(\?.*)?$/i.test(e.target.value) ? "video" : "image");
                }}
              />
            </details>

            <input className="input w-full" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} />

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={addItem} disabled={saving || uploading}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
