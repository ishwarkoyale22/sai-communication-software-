import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { StatusPill } from "../components/StatusPill";
import { Plus, Trash2 } from "lucide-react";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  is_active: boolean;
}

const emptyForm = { name: "", description: "", price: 0 };

export function ServiceManagement() {
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("services-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "services" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("services").select("*").order("name");
    setServices((data as Service[]) ?? []);
  }

  async function addService() {
    if (!form.name) return;
    await supabase.from("services").insert({ name: form.name, description: form.description || null, price: form.price || null, is_active: true });
    setForm(emptyForm);
    setShowForm(false);
    load();
  }

  async function toggleActive(s: Service) {
    await supabase.from("services").update({ is_active: !s.is_active }).eq("id", s.id);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this service? This only removes it from the website — it doesn't affect past sales.")) return;
    await supabase.from("services").delete().eq("id", id);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Service Management</h1>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={14} /> Add Service
        </button>
      </div>
      <p className="text-sm text-gray-500">
        These show up on the public website's Services page. Inactive services stay here but are
        hidden from the site.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => (
          <div key={s.id} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-800">{s.name}</span>
              <StatusPill status={s.is_active ? "active" : "neutral"} label={s.is_active ? "Active" : "Hidden"} />
            </div>
            <p className="mt-2 text-sm text-gray-500">{s.description}</p>
            <div className="mt-3 flex gap-2">
              <button className="btn-secondary flex-1 !py-1.5 text-xs" onClick={() => toggleActive(s)}>
                {s.is_active ? "Hide from site" : "Show on site"}
              </button>
              <button className="btn-ghost !py-1.5 text-xs text-brand-danger" onClick={() => remove(s.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        {services.length === 0 && (
          <p className="col-span-full py-8 text-center text-gray-400">No services yet — add one above</p>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <div className="card w-96 space-y-2.5 p-5">
            <h2 className="mb-2 text-sm font-semibold text-gray-800">Add Service</h2>
            <input className="input" placeholder="Service name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <textarea
              className="input"
              placeholder="Description shown on the website"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" onClick={addService}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
