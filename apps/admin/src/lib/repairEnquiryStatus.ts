/**
 * The live `repair_enquiries.status` column has a DB check constraint
 * (`repair_enquiries_status_check`, not present in any tracked migration —
 * added directly against the live database) that only accepts
 * "pending" | "contacted" | "completed" | "cancelled". It does NOT accept
 * the Repairs kanban's own vocabulary (received/in_progress/waiting_parts/
 * ready/completed) — writing those values fails silently unless the error
 * is checked. Confirmed empirically against the live DB: every other
 * candidate value (new, received, in_progress, waiting_parts, ready,
 * device_received, diagnosis, delivered) is rejected.
 *
 * This maps a Repairs kanban status to the closest allowed enquiry status,
 * so the customer-facing Track Repair page (which only reads
 * repair_enquiries.status) can reflect real progress without a schema
 * change: "received" through "ready" all collapse to "contacted" (work has
 * started, not yet finished — the enquiry vocabulary has no finer stages),
 * and "completed" maps 1:1.
 */
export function repairEnquiryStatusFor(repairStatus: string): "pending" | "contacted" | "completed" {
  return repairStatus === "completed" ? "completed" : "contacted";
}
