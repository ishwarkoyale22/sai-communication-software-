// IMEI-specific business rules layered on top of the generic verifier. Format + Luhn validation
// itself lives in packages/shared/src/imei.ts (also used by the database's is_valid_imei() — see
// supabase/migrations/0065_imei_db_safety.sql) and is deliberately NOT duplicated here.
import { normalizeImei, validateImei } from "@sai/shared";

/** What Luhn actually proves, stated plainly (the brief asked this never be overstated):
 *  Luhn confirms the 15 digits are INTERNALLY CONSISTENT — it does NOT confirm the camera read
 *  them correctly. It catches the large majority of single-digit misreads, but it is documented
 *  to miss some digit-transposition errors (e.g. certain 0↔9 and doubled-digit swaps). That is
 *  exactly why acceptance here never rests on Luhn alone — it always also requires several
 *  independent camera reads (or, for a photo, several independent decode passes/engines) to
 *  agree before a value is accepted at all. */
export const LUHN_LIMITATION_NOTE =
  "Luhn confirms the number is internally consistent, not that the scan was read correctly. It misses some transposition errors.";

export { normalizeImei, validateImei };

export type ImeiValidationOutcome =
  | { ok: true; imei: string }
  | { ok: false; reason: "format" | "luhn"; message: string };

/** The one entry point the scanner UI calls on every verified (multi-read-accepted) text value.
 *  Format + Luhn only — duplicate-in-database checking is a separate, async step (see
 *  Inventory.tsx's findExistingImeiOwner, unchanged) because it needs a network round trip and
 *  must not block the synchronous accept/reject decision this function makes. */
export function checkImeiCandidate(rawText: string): ImeiValidationOutcome {
  const res = validateImei(rawText);
  if (!res.ok) {
    return { ok: false, reason: res.error === "invalid_checkdigit" ? "luhn" : "format", message: res.message ?? "Invalid IMEI" };
  }
  return { ok: true, imei: res.normalized };
}
