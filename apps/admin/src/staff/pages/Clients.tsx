import { useEffect, useState } from "react";
import { Search, Plus, X, User } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

interface Client {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  created_at: string;
}

export function Clients() {
  const { token } = useStaffAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load(searchTerm?: string) {
    if (!token) return;
    setLoading(true);
    const { data } = await supabase.rpc("staff_get_clients", { p_token: token, p_search: searchTerm || null });
    setClients((data as Client[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function addClient() {
    if (!token || !form.name.trim() || !form.phone.trim()) {
      setError("Name and phone are required.");
      return;
    }
    setSaving(true);
    setError("");
    const { data, error: err } = await supabase.rpc("staff_add_client", {
      p_token: token,
      p_name: form.name.trim(),
      p_phone: form.phone.trim(),
      p_notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (err || !data?.success) {
      setError(err?.message || data?.error || "Failed to add client.");
      return;
    }
    setForm({ name: "", phone: "", notes: "" });
    setShowAdd(false);
    load(search);
  }

  async function saveNotes() {
    if (!token || !selected) return;
    setSaving(true);
    const { data } = await supabase.rpc("staff_update_client", { p_token: token, p_customer_id: selected.id, p_notes: notesDraft });
    setSaving(false);
    if (data?.success) {
      setSelected(null);
      load(search);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients by name or phone"
            className="input w-full pl-9"
          />
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1 px-3">
          <Plus size={16} /> Add
        </button>
      </div>

      {loading ? (
        <div className="text-center text-sm text-gray-400">Loading…</div>
      ) : clients.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">No clients yet.</div>
      ) : (
        <div className="space-y-2">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setSelected(c);
                setNotesDraft(c.notes || "");
              }}
              className="card flex w-full items-center gap-3 p-3 text-left"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
                <User size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-800">{c.name}</div>
                <div className="text-xs text-gray-500">{c.phone}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setShowAdd(false)}>
          <div className="w-full rounded-t-2xl bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Add Client</h3>
              <button onClick={() => setShowAdd(false)}>
                <X size={18} />
              </button>
            </div>
            {error && <div className="mb-2 text-xs text-brand-danger">{error}</div>}
            <div className="space-y-2">
              <input className="input w-full" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="input w-full" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <textarea className="input w-full" placeholder="Notes (optional)" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              <button onClick={addClient} disabled={saving} className="btn-primary w-full">
                {saving ? "Saving…" : "Save Client"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setSelected(null)}>
          <div className="w-full rounded-t-2xl bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{selected.name}</h3>
              <button onClick={() => setSelected(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="mb-2 text-xs text-gray-500">{selected.phone}</div>
            <textarea className="input w-full" placeholder="Notes / interaction history" rows={4} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
            <button onClick={saveNotes} disabled={saving} className="btn-primary mt-2 w-full">
              {saving ? "Saving…" : "Save Notes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
