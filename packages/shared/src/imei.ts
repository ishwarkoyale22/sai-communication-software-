/**
 * IMEI normalization + format/check-digit validation. Pure functions only —
 * duplicate/history checks require a DB round-trip and live in the pages
 * that call these (Inventory.tsx, Sales.tsx, IMEI search).
 */

export type ImeiValidationError = "empty" | "invalid_format" | "invalid_checkdigit";

export interface ImeiValidationResult {
  ok: boolean;
  normalized: string;
  error?: ImeiValidationError;
  message?: string;
}

/** Strips spaces, hyphens, and any other non-digit characters. */
export function normalizeImei(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/** Standard IMEI Luhn check-digit validation over all 15 digits (the 15th is the check digit). */
export function isValidImeiLuhn(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = Number(imei[i]);
    // Luhn doubles every second digit counting from the right; the 15th
    // digit (index 14, the check digit itself) is never doubled.
    if ((14 - i) % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validateImei(raw: string): ImeiValidationResult {
  const normalized = normalizeImei(raw);
  if (!normalized) {
    return { ok: false, normalized, error: "empty", message: "IMEI is required." };
  }
  if (!/^\d{15}$/.test(normalized)) {
    return { ok: false, normalized, error: "invalid_format", message: "Invalid IMEI — must be 15 digits." };
  }
  if (!isValidImeiLuhn(normalized)) {
    return { ok: false, normalized, error: "invalid_checkdigit", message: "Invalid IMEI check digit." };
  }
  return { ok: true, normalized };
}
