import { statusTone } from "@sai/shared";

const TONE_CLASS: Record<string, string> = {
  success: "pill-success",
  warning: "pill-warning",
  danger: "pill-danger",
  info: "pill-info",
  neutral: "pill-neutral",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={TONE_CLASS[statusTone(status)]}>{label ?? status}</span>;
}
