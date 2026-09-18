import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Save, Plus, Trash2 } from "lucide-react";

// Matches exactly what the website's settingsQuery reads (src/lib/queries.ts
// in the website repo) — key/value pairs, with the website falling back to
// hardcoded DEFAULT_SETTINGS for any key not present here. Grouped here
// purely for a friendlier admin UI; the underlying store is a flat map.
const FIELD_GROUPS: { label: string; fields: { key: string; label: string; placeholder?: string; multiline?: boolean }[] }[] = [
  {
    label: "Owner / Brand Story",
    fields: [
      { key: "owner_name", label: "Owner Name", placeholder: "Vijay Sir" },
      { key: "owner_intro", label: "Owner Story", multiline: true, placeholder: "Shown under the founder's photo on the homepage" },
      { key: "hero_photo_url", label: "Owner / Hero Photo URL" },
      { key: "established", label: "Established Year", placeholder: "2005" },
      { key: "rating", label: "Star Rating", placeholder: "4.8" },
      { key: "total_ratings", label: "Total Ratings Count", placeholder: "242" },
    ],
  },
  {
    label: "Contact & Location",
    fields: [
      { key: "address", label: "Shop Address", multiline: true },
      { key: "hours", label: "Store Hours", placeholder: "Mon-Sat, 10am - 8pm" },
      { key: "phone", label: "Primary Phone" },
      { key: "phone_alt", label: "Alternate Phone" },
      { key: "maps_embed", label: "Google Maps Embed URL" },
    ],
  },
  {
    label: "Social Links",
    fields: [
      { key: "instagram", label: "Instagram URL" },
      { key: "facebook", label: "Facebook URL" },
      { key: "twitter", label: "Twitter / X URL" },
      { key: "youtube", label: "YouTube URL" },
    ],
  },
];

export function Settings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [customKeys, setCustomKeys] = useState<{ key: string; value: string }[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const knownKeys = new Set(FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key)));

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase.from("settings").select("key, value");
    const map: Record<string, string> = {};
    const extra: { key: string; value: string }[] = [];
    for (const row of (data ?? []) as { key: string; value: string | null }[]) {
      if (knownKeys.has(row.key)) {
        map[row.key] = row.value ?? "";
      } else {
        extra.push({ key: row.key, value: row.value ?? "" });
      }
    }
    setValues(map);
    setCustomKeys(extra);
  }

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const rows = [
        ...Object.entries(values).map(([key, value]) => ({ key, value })),
        ...customKeys.map((c) => ({ key: c.key, value: c.value })),
      ].filter((r) => r.key.trim());
      if (rows.length > 0) {
        const { error: upsertErr } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
        if (upsertErr) throw upsertErr;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  function addCustomKey() {
    if (!newKey.trim()) return;
    setCustomKeys((prev) => [...prev, { key: newKey.trim(), value: newValue }]);
    setNewKey("");
    setNewValue("");
  }

  async function removeCustomKey(key: string) {
    setCustomKeys((prev) => prev.filter((c) => c.key !== key));
    await supabase.from("settings").delete().eq("key", key);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Settings</h1>
          <p className="text-xs text-gray-500">
            Editable content shown on the public website's homepage — owner story, contact info, social links.
            Leave a field blank to fall back to the website's default text.
          </p>
        </div>
        <button className="btn-primary" onClick={saveAll} disabled={saving}>
          <Save size={14} /> {saving ? "Saving..." : "Save All"}
        </button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}
      {saved && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">Settings saved.</div>}

      {FIELD_GROUPS.map((group) => (
        <div key={group.label} className="card space-y-3 p-4">
          <div className="font-serif text-sm font-semibold text-gray-700">{group.label}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.fields.map((f) => (
              <label key={f.key} className={`block text-xs text-gray-500 ${f.multiline ? "sm:col-span-2" : ""}`}>
                {f.label}
                {f.multiline ? (
                  <textarea
                    className="input mt-1 w-full"
                    rows={3}
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    className="input mt-1 w-full"
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="card space-y-3 p-4">
        <div className="font-serif text-sm font-semibold text-gray-700">Custom Keys</div>
        <p className="text-xs text-gray-400">
          Any other setting key the website reads (see DEFAULT_SETTINGS in its source) can be added here directly.
        </p>
        {customKeys.map((c, i) => (
          <div key={c.key} className="flex items-center gap-2">
            <input className="input !w-40" value={c.key} disabled />
            <input
              className="input flex-1"
              value={c.value}
              onChange={(e) => setCustomKeys((prev) => prev.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))}
            />
            <button className="text-brand-danger" onClick={() => removeCustomKey(c.key)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input className="input !w-40" placeholder="key_name" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <input className="input flex-1" placeholder="value" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          <button className="btn-secondary !px-2 !py-1" onClick={addCustomKey}>
            <Plus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
