import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { supabase } from "../lib/supabase";
import { ArrowRight, Wrench } from "lucide-react";

interface RepairEnquiry {
  id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  phone_brand: string;
  phone_model: string;
  problem_type: string;
  description: string | null;
  status: string;
  created_at: string;
}

interface LinkedRepair {
  id: string;
  enquiry_id: string;
  status: string;
}

export function RepairEnquiries() {
  const [enquiries, setEnquiries] = useState<RepairEnquiry[]>([]);
  const [repairsByEnquiry, setRepairsByEnquiry] = useState<Record<string, LinkedRepair>>({});
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("repair-enquiries-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "repair_enquiries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "repairs" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function load() {
    const [{ data: enqData, error: enqErr }, { data: repairData, error: repErr }] = await Promise.all([
      supabase.from("repair_enquiries").select("*").order("created_at", { ascending: false }),
      supabase.from("repairs").select("id, enquiry_id, status").not("enquiry_id", "is", null),
    ]);
    if (enqErr) {
      setError(`Failed to load repair enquiries: ${enqErr.message}`);
      return;
    }
    if (repErr) {
      setError(`Failed to load linked repairs: ${repErr.message}`);
      return;
    }
    setError(null);
    setEnquiries((enqData as RepairEnquiry[]) ?? []);
    const map: Record<string, LinkedRepair> = {};
    for (const r of (repairData as LinkedRepair[]) ?? []) {
      if (r.enquiry_id) map[r.enquiry_id] = r;
    }
    setRepairsByEnquiry(map);
  }

  async function createRepair(enquiry: RepairEnquiry) {
    setError(null);
    setCreatingId(enquiry.id);
    try {
      const { data, error: insertErr } = await supabase
        .from("repairs")
        .insert({
          enquiry_id: enquiry.id,
          customer_name: enquiry.customer_name,
          phone: enquiry.phone,
          device_brand: enquiry.phone_brand,
          device_model: enquiry.phone_model,
          problem: enquiry.description || enquiry.problem_type,
          status: "received",
        })
        .select()
        .single();

      if (insertErr) {
        setError(`Failed to create repair: ${insertErr.message}`);
        return;
      }

      if (data) {
        setRepairsByEnquiry((prev) => ({ ...prev, [enquiry.id]: data as LinkedRepair }));
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create repair. Please try again.");
    } finally {
      setCreatingId(null);
    }
  }

  const unconvertedCount = enquiries.filter((e) => !repairsByEnquiry[e.id]).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">
          Repair Enquiries{" "}
          {unconvertedCount > 0 && <span className="pill-info ml-2 align-middle">{unconvertedCount} new</span>}
        </h1>
        <ExportExcelButton
          rows={enquiries.map((e) => ({
            Name: e.customer_name,
            Phone: e.phone,
            Email: e.email,
            Device: `${e.phone_brand} ${e.phone_model}`,
            Problem: e.problem_type,
            Description: e.description,
            Received: e.created_at,
            Status: repairsByEnquiry[e.id] ? "Converted" : "New",
          }))}
          fileName="repair-enquiries"
        />
      </div>
      <p className="text-sm text-gray-500">
        Submitted from the public website's repair form. Create a repair to start tracking it.
      </p>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Phone / Email</th>
              <th>Device</th>
              <th>Problem</th>
              <th>Received</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {enquiries.map((e) => {
              const linkedRepair = repairsByEnquiry[e.id];
              return (
                <tr key={e.id}>
                  <td className="font-medium">{e.customer_name}</td>
                  <td>
                    {e.phone}
                    {e.email ? ` · ${e.email}` : ""}
                  </td>
                  <td>
                    {e.phone_brand} {e.phone_model}
                  </td>
                  <td>{e.problem_type}</td>
                  <td className="text-gray-500">{new Date(e.created_at).toLocaleString("en-IN")}</td>
                  <td>
                    {linkedRepair ? (
                      <StatusPill status="approved" label="Converted" />
                    ) : (
                      <StatusPill status="new" label="New / Unconverted" />
                    )}
                  </td>
                  <td>
                    {linkedRepair ? (
                      <Link
                        to="/repairs"
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline"
                      >
                        <Wrench className="size-3.5" />
                        <span className="text-gray-400">({linkedRepair.status})</span>
                        <ArrowRight className="size-3" />
                      </Link>
                    ) : (
                      <button
                        className="btn-primary !py-1 !px-3 text-xs"
                        disabled={creatingId === e.id}
                        onClick={() => createRepair(e)}
                      >
                        {creatingId === e.id ? "Creating…" : "Create Repair"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {enquiries.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">
                  No repair enquiries yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
