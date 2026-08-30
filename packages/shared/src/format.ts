export function formatCurrency(n: number | null | undefined): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n ?? 0);
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(d));
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

/** Status -> pill color token, used by the shared <StatusPill> in each app. */
export function statusTone(
  status: string
): "success" | "warning" | "danger" | "info" | "neutral" {
  const s = status.toLowerCase();
  if (["active", "paid", "collected", "processed", "ready", "approved"].includes(s)) return "success";
  if (["pending", "emi", "waiting_parts", "in_progress"].includes(s)) return "warning";
  if (["overdue", "critical", "received", "new", "rejected"].includes(s)) return "danger";
  if (["online"].includes(s)) return "info";
  return "neutral";
}
