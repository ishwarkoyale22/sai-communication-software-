import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatDateTime, type RepairEnquiry, type Repair } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { ArrowRight, Wrench } from "lucide-react";

export function RepairEnquiries() {
  const [enquiries, setEnquiries] = useState<RepairEnquiry[]>([]);
  // Keyed by repair_enquiry_id, so we can tell at a glance which enquiries
  // already have a linked work order and which are still "New".
  const [repairsByEnquiry, setRepairsByEnquiry] = useState<Record<string, Repair>>({});
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
    // New repair enquiries submitted on the public website land here
    // immediately; also refresh when a repair gets created/updated so the
    // "Converted" state stays in sync even if created from elsewhere.
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
      supabase.from("repairs").select("*").not("repair_enquiry_id", "is", null),
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
    setEnquiries(enqData ?? []);
    const map: Record<string, Repair> = {};
    for (const r of (repairData as Repair[]) ?? []) {
      if (r.repair_enquiry_id) map[r.repair_enquiry_id] = r;
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
          repair_number: enquiry.enquiry_number.replace(/^RE-/, "RPR-"),
          repair_enquiry_id: enquiry.id,
          device_name: `${enquiry.phone_brand} ${enquiry.phone_model}`.trim(),
          issue_description: enquiry.description || enquiry.problem_type,
          status: "received",
          channel: "online",
        })
        .select()
        .single();

      if (insertErr) {
        // Same principle as the Add Staff fix: surface the real database
        // error, never silently fail or pretend it worked.
        setError(`Failed to create repair: ${insertErr.message}`);
        return;
      }

      if (data) {
        setRepairsByEnquiry((prev) => ({ ...prev, [enquiry.id]: data as Repair }));
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
            "Enquiry #": e.enquiry_number,
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
        Submitted from the public website's repair form. Create a repair work order to start tracking it.
      </p>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Enquiry #</th>
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
                  <td className="font-mono text-xs">{e.enquiry_number}</td>
                  <td className="font-medium">{e.customer_name}</td>
                  <td>
                    {e.phone}
                    {e.email ? ` · ${e.email}` : ""}
                  </td>
                  <td>
                    {e.phone_brand} {e.phone_model}
                  </td>
                  <td>{e.problem_type}</td>
                  <td className="text-gray-500">{formatDateTime(e.created_at)}</td>
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
                        {linkedRepair.repair_number}
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
                <td colSpan={8} className="py-8 text-center text-gray-400">
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
