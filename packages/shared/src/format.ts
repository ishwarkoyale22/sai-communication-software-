export function formatCurrency(n: number | null | undefined): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n ?? 0);
}

/**
 * Several tables (sales, customers, repair enquiries, web orders …) store
 * created_at as `timestamp without time zone` holding UTC. PostgREST returns
 * those without a "Z", and `new Date("2026-09-24T18:44:38")` reads them as
 * device-local time — so on an Indian phone/PC every such time showed 5½ hours
 * early (a 12:14 AM sale read "06:44 PM" the previous day). A date+time string
 * with no zone is treated as UTC; date-only strings and zoned strings are left alone.
 */
export function parseDbTimestamp(d: string | Date): Date {
  if (d instanceof Date) return d;
  const hasTime = /\d{2}:\d{2}/.test(d);
  const hasZone = /(Z|[+-]\d{2}(:?\d{2})?)$/.test(d);
  return hasTime && !hasZone ? new Date(`${d.replace(" ", "T")}Z`) : new Date(d);
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parseDbTimestamp(d));
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseDbTimestamp(d));
}

/** Status -> pill color token, used by the shared <StatusPill> in each app. */
export function statusTone(
  status: string | null | undefined
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (["active", "paid", "collected", "processed", "ready", "approved", "resolved"].includes(s)) return "success";
  if (["pending", "emi", "waiting_parts", "in_progress"].includes(s)) return "warning";
  if (["overdue", "critical", "received", "new", "rejected"].includes(s)) return "danger";
  if (["online"].includes(s)) return "info";
  return "neutral";
}
