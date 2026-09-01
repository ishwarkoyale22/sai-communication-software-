import { useState } from "react";
import { User, KeyRound, LogOut } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

export function Profile() {
  const { staff, token, signOut } = useStaffAuth();
  const [name, setName] = useState(staff?.name || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  const [pinForm, setPinForm] = useState({ current: "", next: "", confirm: "" });
  const [savingPin, setSavingPin] = useState(false);
  const [pinMsg, setPinMsg] = useState("");

  async function saveProfile() {
    if (!token || !name.trim()) return;
    setSavingProfile(true);
    setProfileMsg("");
    const { data, error } = await supabase.rpc("staff_update_profile", { p_token: token, p_name: name.trim() });
    setSavingProfile(false);
    setProfileMsg(error ? error.message : data?.success ? "Saved." : "Failed to save.");
  }

  async function changePin() {
    if (!token) return;
    if (pinForm.next.length !== 4 || pinForm.next !== pinForm.confirm) {
      setPinMsg("New PIN must be 4 digits and match confirmation.");
      return;
    }
    setSavingPin(true);
    setPinMsg("");
    const { data, error } = await supabase.rpc("staff_change_pin", {
      p_token: token,
      p_current_pin: pinForm.current,
      p_new_pin: pinForm.next,
    });
    setSavingPin(false);
    if (error || !data?.success) {
      setPinMsg(error?.message || data?.error || "Failed to change PIN.");
      return;
    }
    setPinMsg("PIN changed.");
    setPinForm({ current: "", next: "", confirm: "" });
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-3 p-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
          <User size={26} />
        </div>
        <div>
          <div className="text-base font-semibold text-gray-800">{staff?.name}</div>
          <div className="text-xs text-gray-500">{staff?.role}</div>
          <div className="text-xs text-gray-400">{staff?.phone}</div>
        </div>
      </div>

      <div className="card space-y-2 p-4">
        <h3 className="text-sm font-semibold text-gray-700">Edit Name</h3>
        <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
        {profileMsg && <div className="text-xs text-gray-500">{profileMsg}</div>}
        <button onClick={saveProfile} disabled={savingProfile} className="btn-primary w-full">
          {savingProfile ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="card space-y-2 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <KeyRound size={15} /> Change PIN
        </h3>
        <input type="password" inputMode="numeric" maxLength={4} className="input w-full" placeholder="Current PIN" value={pinForm.current} onChange={(e) => setPinForm({ ...pinForm, current: e.target.value })} />
        <input type="password" inputMode="numeric" maxLength={4} className="input w-full" placeholder="New PIN" value={pinForm.next} onChange={(e) => setPinForm({ ...pinForm, next: e.target.value })} />
        <input type="password" inputMode="numeric" maxLength={4} className="input w-full" placeholder="Confirm New PIN" value={pinForm.confirm} onChange={(e) => setPinForm({ ...pinForm, confirm: e.target.value })} />
        {pinMsg && <div className="text-xs text-gray-500">{pinMsg}</div>}
        <button onClick={changePin} disabled={savingPin} className="btn-primary w-full">
          {savingPin ? "Saving…" : "Update PIN"}
        </button>
      </div>

      <button onClick={() => signOut()} className="card flex w-full items-center justify-center gap-2 p-3 text-sm font-medium text-brand-danger">
        <LogOut size={16} /> Logout
      </button>
    </div>
  );
}
