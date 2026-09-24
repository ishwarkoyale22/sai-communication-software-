import { useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { useStaffAuth } from "../context/StaffAuthContext";
import { supabase } from "../lib/supabase";

interface Enquiry {
  id: string;
  customer_name: string;
  phone: string | null;
  email: string | null;
  subject: string | null;
  message: string | null;
  status: string;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  new: "bg-blue-50 text-blue-700",
  contacted: "bg-amber-50 text-amber-700",
  resolved: "bg-emerald-50 text-emerald-700",
};

export function Enquiries() {
  const { token } = useStaffAuth();
  const [items, setItems] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data } = await supabase.rpc("staff_get_enquiries", { p_token: token });
    setItems((data as Enquiry[]) ?? []);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">Customer Enquiries</h1>
      {loading ? (
        <div className="text-center text-sm text-gray-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">No enquiries yet.</div>
      ) : (
        <div className="space-y-2">
          {items.map((e) => (
            <div key={e.id} className="card space-y-1.5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                  <MessageSquareText size={14} className="shrink-0 text-brand-primary" />
                  {e.customer_name}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[e.status] ?? "bg-gray-100 text-gray-500"}`}>
                  {e.status}
                </span>
              </div>
              {e.subject && <div className="text-xs font-medium text-gray-600">{e.subject}</div>}
              {e.message && <div className="text-xs text-gray-500">{e.message}</div>}
              <div className="text-xs text-gray-400">{e.phone}{e.email ? ` · ${e.email}` : ""}</div>
              <div className="text-[11px] text-gray-400">{new Date(e.created_at).toLocaleString("en-IN")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
