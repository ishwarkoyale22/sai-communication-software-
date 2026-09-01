import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, X, Edit2, Trash2, Check, AlertCircle } from "lucide-react";

interface Staff {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  salary: number | null;
  joined_date: string | null;
  is_active: boolean;
  pin: string | null;
}

const emptyForm = { name: "", role: "staff", phone: "", email: "", salary: 0, joined_date: "", pin: "" };

export function StaffManagement() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("staff-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "staff" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const { data } = await supabase.from("staff").select("*").order("name");
    setStaff((data as Staff[]) ?? []);
  }

  async function addStaff() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.phone.trim() || !/^\d{4}$/.test(form.pin)) {
      setError("Phone and a 4-digit PIN are required — staff use these to log into the Staff Portal.");
      return;
    }
    setSaving(true);
    setError(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Your admin session has expired. Please sign out and sign in again, then retry.");
      setSaving(false);
      return;
    }

    const { error: insertErr } = await supabase.from("staff").insert({
      name: form.name.trim(),
      role: form.role.trim() || "staff",
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      salary: form.salary || null,
      joined_date: form.joined_date || null,
      pin: form.pin,
      is_active: true,
    });

    if (insertErr) {
      setError(`Failed to create staff member: ${insertErr.message}`);
      setSaving(false);
      return;
    }

    setForm(emptyForm);
    setShowAddForm(false);
    setSuccess("Staff member created successfully!");
    setTimeout(() => setSuccess(null), 4000);
    await load();
    setSaving(false);
  }

  async function updateStaff() {
    if (!editingStaff || !editingStaff.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);

    if (editingStaff.pin && !/^\d{4}$/.test(editingStaff.pin)) {
      setError("PIN must be exactly 4 digits.");
      setSaving(false);
      return;
    }

    const { error: updateErr } = await supabase
      .from("staff")
      .update({
        name: editingStaff.name.trim(),
        role: editingStaff.role,
        phone: editingStaff.phone,
        email: editingStaff.email,
        salary: editingStaff.salary,
        joined_date: editingStaff.joined_date,
        pin: editingStaff.pin,
        is_active: editingStaff.is_active,
      })
      .eq("id", editingStaff.id);

    if (updateErr) {
      setError(`Failed to update: ${updateErr.message}`);
      setSaving(false);
      return;
    }

    setEditingStaff(null);
    setSuccess("Staff updated successfully!");
    setTimeout(() => setSuccess(null), 4000);
    await load();
    setSaving(false);
  }

  async function deleteStaff(s: Staff) {
    if (!confirm(`Are you sure you want to deactivate or remove "${s.name}"?`)) return;
    const { error: delErr } = await supabase.from("staff").delete().eq("id", s.id);
    if (delErr) await supabase.from("staff").update({ is_active: false }).eq("id", s.id);
    setSuccess(`"${s.name}" removed.`);
    setTimeout(() => setSuccess(null), 4000);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Staff Management</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={staff.map((s) => ({ Name: s.name, Role: s.role, Phone: s.phone, Email: s.email, Salary: s.salary, Joined: s.joined_date, Active: s.is_active ? "Yes" : "No" }))}
            fileName="staff"
          />
          <button className="btn-primary flex items-center gap-1.5" onClick={() => { setError(null); setShowAddForm(true); }}>
            <Plus size={15} /> Add Staff
          </button>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 border border-emerald-200">
          <Check size={16} />
          <span>{success}</span>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Joined</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className={!s.is_active ? "opacity-60 bg-gray-50/50" : ""}>
                <td className="font-medium text-gray-800">{s.name}</td>
                <td className="capitalize">{s.role}</td>
                <td className="text-gray-600 font-mono text-xs">{s.phone ?? "-"}</td>
                <td className="text-gray-500">{s.email ?? "-"}</td>
                <td className="text-gray-500">{s.joined_date ?? "-"}</td>
                <td>
                  <StatusPill status={s.is_active ? "active" : "neutral"} label={s.is_active ? "Active" : "Inactive"} />
                </td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => { setError(null); setEditingStaff(s); }}>
                      <Edit2 size={13} />
                    </button>
                    <button className="btn-ghost !px-2 !py-1 text-xs text-brand-danger hover:bg-red-50" onClick={() => deleteStaff(s)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  No staff members added yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(showAddForm || editingStaff) && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md space-y-4 p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-gray-800">{editingStaff ? "Edit Staff Member" : "Add New Staff Member"}</h2>
              <button onClick={() => { setShowAddForm(false); setEditingStaff(null); setError(null); }} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-xs text-brand-danger border border-red-200">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Full Name *</label>
                <input
                  className="input w-full"
                  value={editingStaff ? editingStaff.name : form.name}
                  onChange={(e) => (editingStaff ? setEditingStaff({ ...editingStaff, name: e.target.value }) : setForm({ ...form, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
                <select
                  className="input w-full"
                  value={editingStaff ? editingStaff.role : form.role}
                  onChange={(e) => (editingStaff ? setEditingStaff({ ...editingStaff, role: e.target.value }) : setForm({ ...form, role: e.target.value }))}
                >
                  <option value="staff">Staff</option>
                  <option value="cashier">Cashier / Billing</option>
                  <option value="technician">Technician / Repairs</option>
                  <option value="manager">Store Manager</option>
                  <option value="sales">Sales Associate</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Phone *</label>
                  <input
                    type="tel"
                    className="input w-full font-mono"
                    value={editingStaff ? editingStaff.phone ?? "" : form.phone}
                    onChange={(e) => (editingStaff ? setEditingStaff({ ...editingStaff, phone: e.target.value }) : setForm({ ...form, phone: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    {editingStaff ? "PIN (leave blank to keep)" : "4-Digit PIN *"}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="••••"
                    className="input w-full font-mono tracking-widest"
                    value={editingStaff ? editingStaff.pin ?? "" : form.pin}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                      editingStaff ? setEditingStaff({ ...editingStaff, pin: digits }) : setForm({ ...form, pin: digits });
                    }}
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                Phone + PIN are how this staff member logs into the Staff Portal to clock in and bill sales.
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
                <input
                  type="email"
                  className="input w-full"
                  value={editingStaff ? editingStaff.email ?? "" : form.email}
                  onChange={(e) => (editingStaff ? setEditingStaff({ ...editingStaff, email: e.target.value }) : setForm({ ...form, email: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Salary (₹)</label>
                  <input
                    type="number"
                    className="input w-full"
                    value={editingStaff ? editingStaff.salary ?? 0 : form.salary}
                    onChange={(e) => (editingStaff ? setEditingStaff({ ...editingStaff, salary: Number(e.target.value) }) : setForm({ ...form, salary: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Joined Date</label>
                  <input
                    type="date"
                    className="input w-full"
                    value={editingStaff ? editingStaff.joined_date ?? "" : form.joined_date}
                    onChange={(e) => (editingStaff ? setEditingStaff({ ...editingStaff, joined_date: e.target.value }) : setForm({ ...form, joined_date: e.target.value }))}
                  />
                </div>
              </div>
              {editingStaff && (
                <label className="flex items-center gap-2 pt-1 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingStaff.is_active}
                    onChange={(e) => setEditingStaff({ ...editingStaff, is_active: e.target.checked })}
                    className="rounded border-gray-300 text-brand-primary"
                  />
                  Active
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <button type="button" className="btn-ghost" onClick={() => { setShowAddForm(false); setEditingStaff(null); setError(null); }} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={editingStaff ? updateStaff : addStaff} disabled={saving}>
                {saving ? "Saving..." : editingStaff ? "Save Changes" : "Create Staff Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
