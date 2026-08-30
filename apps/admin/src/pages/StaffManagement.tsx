import { useEffect, useState } from "react";
import { formatDateTime, type Staff, type Attendance } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { Plus, MapPin, X, Edit2, Trash2, Check, AlertCircle } from "lucide-react";

const emptyForm = { name: "", role: "cashier", phone: "", pin: "" };
const LOCAL_STAFF_KEY = "sai_local_staff";

function getLocalStaff(): Staff[] {
  try {
    const raw = localStorage.getItem(LOCAL_STAFF_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalStaff(list: Staff[]) {
  try {
    localStorage.setItem(LOCAL_STAFF_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

interface EditingStaff {
  id: string;
  name: string;
  role: string;
  phone: string;
  pin: string;
  is_active: boolean;
}

export function StaffManagement() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<EditingStaff | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyFor, setHistoryFor] = useState<Staff | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [{ data: s }, { data: a }] = await Promise.all([
      supabase.from("staff").select("*").order("name"),
      supabase.from("attendance").select("*").order("clock_in", { ascending: false }).limit(200),
    ]);

    const localList = getLocalStaff();
    const remoteList = s ?? [];

    const mergedMap = new Map<string, Staff>();
    for (const l of localList) {
      if (l.phone) mergedMap.set(l.phone, l);
    }
    for (const r of remoteList) {
      if (r.phone) mergedMap.set(r.phone, r);
    }

    const combined = Array.from(mergedMap.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setStaff(combined);
    saveLocalStaff(combined);
    setAttendance(a ?? []);
  }

  function todayHours(staffId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const today = attendance.filter((a) => a.staff_id === staffId && new Date(a.clock_in) >= todayStart);
    const mins = today.reduce((sum, a) => {
      const end = a.clock_out ? new Date(a.clock_out) : new Date();
      return sum + (end.getTime() - new Date(a.clock_in).getTime()) / 60000;
    }, 0);
    return (mins / 60).toFixed(1);
  }

  function currentStatus(staffId: string) {
    const open = attendance.find((a) => a.staff_id === staffId && !a.clock_out);
    return open ? "active" : "neutral";
  }

  async function addStaff() {
    if (!form.name.trim() || !form.phone.trim() || form.pin.length !== 4) {
      setError("Please fill in Name, Phone, and a 4-digit PIN.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // 0. A privileged write only succeeds if this browser actually holds a
      // live, valid admin session — verify that explicitly first instead of
      // finding out from a cryptic RLS error (or worse, silently treating
      // failure as success). getSession() also triggers a token refresh if
      // the current one is stale, so this also self-heals a merely-expired
      // (but still refreshable) session.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Your admin session has expired. Please sign out and sign in again, then retry.");
        setSaving(false);
        return;
      }

      // 1. Try PostgreSQL RPC create_staff_member, if one has been deployed.
      // Its absence (PGRST202 — function not found) is expected/harmless in
      // this codebase and falls through to the direct insert below; any
      // other RPC error is unexpected and should NOT be silently swallowed.
      const { data: rpcData, error: rpcErr } = await supabase.rpc("create_staff_member", {
        p_name: form.name.trim(),
        p_role: form.role.trim() || "cashier",
        p_phone: form.phone.trim(),
        p_pin: form.pin.trim(),
      });

      if (!rpcErr && rpcData) {
        setForm(emptyForm);
        setShowAddForm(false);
        setSuccess("Staff member added successfully!");
        setTimeout(() => setSuccess(null), 4000);
        await load();
        setSaving(false);
        return;
      }
      if (rpcErr && rpcErr.code !== "PGRST202") {
        setError(`Failed to create staff member: ${rpcErr.message}`);
        setSaving(false);
        return;
      }

      // 2. Direct insert into staff table — the real, database-backed path.
      const { data: staffRow, error: directErr } = await supabase
        .from("staff")
        .insert({
          name: form.name.trim(),
          role: form.role.trim() || "cashier",
          phone: form.phone.trim(),
          pin: form.pin.trim(),
          is_active: true,
        })
        .select()
        .single();

      if (directErr) {
        // Never fall back to a localStorage-only record here — that used to
        // report false success for a write that never reached the database
        // (e.g. RLS rejecting an unauthenticated/non-admin request with
        // "new row violates row-level security policy"). Surface the real
        // error instead so the admin knows the staff member was NOT saved.
        setError(`Failed to create staff member: ${directErr.message}`);
        setSaving(false);
        return;
      }

      if (staffRow) {
        setForm(emptyForm);
        setShowAddForm(false);
        setSuccess("Staff member created successfully!");
        setTimeout(() => setSuccess(null), 4000);
        await load();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create staff member. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function updateStaff() {
    if (!editingStaff) return;
    if (!editingStaff.name.trim() || !editingStaff.phone.trim()) {
      setError("Name and Phone are required.");
      return;
    }

    setSaving(true);
    setError(null);

    const updatedItem: Staff = {
      id: editingStaff.id,
      name: editingStaff.name.trim(),
      role: editingStaff.role.trim(),
      phone: editingStaff.phone.trim(),
      pin: editingStaff.pin ? editingStaff.pin.trim() : (staff.find((s) => s.id === editingStaff.id)?.pin || ""),
      is_active: editingStaff.is_active,
      auth_user_id: null,
      created_at: new Date().toISOString(),
    };

    try {
      await supabase.rpc("update_staff_member", {
        p_staff_id: editingStaff.id,
        p_name: editingStaff.name.trim(),
        p_role: editingStaff.role.trim(),
        p_phone: editingStaff.phone.trim(),
        p_pin: editingStaff.pin ? editingStaff.pin.trim() : "",
        p_is_active: editingStaff.is_active,
      });

      await supabase
        .from("staff")
        .update({
          name: editingStaff.name.trim(),
          role: editingStaff.role.trim(),
          phone: editingStaff.phone.trim(),
          is_active: editingStaff.is_active,
          ...(editingStaff.pin && editingStaff.pin.length === 4 ? { pin: editingStaff.pin } : {}),
        })
        .eq("id", editingStaff.id);
    } catch {
      /* ignore */
    } finally {
      const currentLocals = getLocalStaff();
      const updatedLocals = currentLocals.map((st) => (st.id === editingStaff.id ? updatedItem : st));
      saveLocalStaff(updatedLocals);

      setEditingStaff(null);
      setSuccess("Staff updated successfully!");
      setTimeout(() => setSuccess(null), 4000);
      await load();
      setSaving(false);
    }
  }

  async function deleteStaff(staffId: string, staffName: string) {
    if (!confirm(`Are you sure you want to deactivate or remove "${staffName}"?`)) return;

    try {
      await supabase.rpc("delete_staff_member", { p_staff_id: staffId });
      await supabase.from("staff").update({ is_active: false }).eq("id", staffId);
    } catch {
      /* ignore */
    } finally {
      const currentLocals = getLocalStaff();
      const updatedLocals = currentLocals.filter((st) => st.id !== staffId);
      saveLocalStaff(updatedLocals);

      setSuccess(`Staff "${staffName}" removed.`);
      setTimeout(() => setSuccess(null), 4000);
      await load();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">Staff Management</h1>
        <div className="flex gap-2">
          <ExportExcelButton
            rows={staff.map((s) => ({
              Name: s.name,
              Role: s.role,
              Phone: s.phone,
              Active: s.is_active ? "Yes" : "No",
              Status: currentStatus(s.id) === "active" ? "Clocked in" : "Clocked out",
              "Today's Hours": todayHours(s.id),
            }))}
            fileName="staff"
          />
          <button
            className="btn-primary flex items-center gap-1.5"
            onClick={() => {
              setError(null);
              setShowAddForm(true);
            }}
          >
            <Plus size={15} /> Add Staff
          </button>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 border border-emerald-200 animate-in fade-in">
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
              <th>Status</th>
              <th>Account</th>
              <th className="text-right">Today's Hours</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id || s.phone} className={!s.is_active ? "opacity-60 bg-gray-50/50" : ""}>
                <td className="font-medium text-gray-800">
                  {s.name}
                  {!s.is_active && <span className="ml-2 text-xs text-gray-400">(Inactive)</span>}
                </td>
                <td>{s.role}</td>
                <td className="text-gray-600 font-mono text-xs">{s.phone}</td>
                <td>
                  <StatusPill
                    status={currentStatus(s.id)}
                    label={currentStatus(s.id) === "active" ? "Clocked in" : "Clocked out"}
                  />
                </td>
                <td>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {s.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="text-right font-medium">{todayHours(s.id)} hrs</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      className="btn-ghost !px-2 !py-1 text-xs"
                      onClick={() => setHistoryFor(s)}
                      title="Attendance History"
                    >
                      History
                    </button>
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      onClick={() => {
                        setError(null);
                        setEditingStaff({
                          id: s.id,
                          name: s.name,
                          role: s.role,
                          phone: s.phone,
                          pin: s.pin || "",
                          is_active: s.is_active,
                        });
                      }}
                      title="Edit Staff"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      className="btn-ghost !px-2 !py-1 text-xs text-brand-danger hover:bg-red-50"
                      onClick={() => deleteStaff(s.id, s.name)}
                      title="Deactivate or Remove"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  No staff members added yet. Click &ldquo;Add Staff&rdquo; to create your first team account.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Staff Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md space-y-4 p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-gray-800">Add New Staff Member</h2>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setError(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
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
                  placeholder="e.g. Ramesh Kumar"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
                <select
                  className="input w-full"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="cashier">Cashier / Billing</option>
                  <option value="technician">Technician / Repairs</option>
                  <option value="manager">Store Manager</option>
                  <option value="sales">Sales Associate</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Phone Number (10 digits) *</label>
                <input
                  type="tel"
                  className="input w-full font-mono"
                  placeholder="e.g. 9876543210"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                />
                <p className="mt-1 text-[11px] text-gray-400">Used by staff to log in on the Staff Portal.</p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">4-Digit Login PIN *</label>
                <input
                  type="password"
                  className="input w-full font-mono tracking-widest text-center text-lg"
                  placeholder="••••"
                  maxLength={4}
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                />
                <p className="mt-1 text-[11px] text-gray-400">4 numbers staff will punch in to clock in and bill.</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setShowAddForm(false);
                  setError(null);
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={addStaff}
                disabled={saving}
              >
                {saving ? "Saving..." : "Create Staff Account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md space-y-4 p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-gray-800">Edit Staff Member</h2>
              <button
                onClick={() => {
                  setEditingStaff(null);
                  setError(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
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
                  value={editingStaff.name}
                  onChange={(e) => setEditingStaff({ ...editingStaff, name: e.target.value })}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
                <select
                  className="input w-full"
                  value={editingStaff.role}
                  onChange={(e) => setEditingStaff({ ...editingStaff, role: e.target.value })}
                >
                  <option value="cashier">Cashier / Billing</option>
                  <option value="technician">Technician / Repairs</option>
                  <option value="manager">Store Manager</option>
                  <option value="sales">Sales Associate</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Phone Number *</label>
                <input
                  type="tel"
                  className="input w-full font-mono"
                  value={editingStaff.phone}
                  onChange={(e) => setEditingStaff({ ...editingStaff, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">New 4-Digit PIN (leave blank to keep current)</label>
                <input
                  type="password"
                  className="input w-full font-mono tracking-widest text-center text-lg"
                  placeholder="••••"
                  maxLength={4}
                  value={editingStaff.pin}
                  onChange={(e) => setEditingStaff({ ...editingStaff, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                />
              </div>

              <label className="flex items-center gap-2 pt-1 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingStaff.is_active}
                  onChange={(e) => setEditingStaff({ ...editingStaff, is_active: e.target.checked })}
                  className="rounded border-gray-300 text-brand-primary"
                />
                Account Active (can clock in and bill)
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setEditingStaff(null);
                  setError(null);
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={updateStaff}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance History Modal */}
      {historyFor && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-gray-800">{historyFor.name} — Attendance History</h2>
              <button onClick={() => setHistoryFor(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {attendance
                .filter((a) => a.staff_id === historyFor.id)
                .map((a) => (
                  <div key={a.id} className="rounded-md border border-border p-3 text-sm hover:bg-gray-50/60 transition-colors">
                    <div className="flex justify-between font-medium">
                      <span>Clock In: {formatDateTime(a.clock_in)}</span>
                      <span className={a.clock_out ? "text-gray-600" : "text-emerald-600 font-semibold"}>
                        {a.clock_out ? `Clock Out: ${formatDateTime(a.clock_out)}` : "Currently Active"}
                      </span>
                    </div>
                    {a.clock_in_lat && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                        <MapPin size={12} className="text-brand-primary" />
                        <a
                          className="text-brand-primary underline"
                          target="_blank"
                          rel="noreferrer"
                          href={`https://www.google.com/maps?q=${a.clock_in_lat},${a.clock_in_lng}`}
                        >
                          GPS: {a.clock_in_lat?.toFixed(4)}, {a.clock_in_lng?.toFixed(4)}
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              {attendance.filter((a) => a.staff_id === historyFor.id).length === 0 && (
                <p className="py-8 text-center text-sm text-gray-400">No attendance records on file for this staff member.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
