/**
 * Finance provider adapters (Phase 15). No partner currently has a real
 * API integration, so every adapter here is a no-op manual/portal-based
 * stub — the shape exists so a real adapter can be dropped in later
 * *without* the app ever claiming "X API integrated" before that's true.
 * `FinancePartner.integration_type` is the single source of truth for
 * what a partner actually supports; adapters do not change that on their
 * own.
 */

import type { FinanceTransaction } from "./types";

export interface FinanceProviderAdapter {
  /** Matches finance_partners.short_code. */
  partnerCode: string;
  /** True once a real API integration exists for this partner. */
  hasApiIntegration: boolean;
  /** Placeholder for a future real submission call — throws until hasApiIntegration is true. */
  submitApplication(transaction: FinanceTransaction): Promise<never>;
}

function manualAdapter(partnerCode: string): FinanceProviderAdapter {
  return {
    partnerCode,
    hasApiIntegration: false,
    async submitApplication() {
      throw new Error(
        `${partnerCode} has no API integration yet — record and track this application manually (Manual / Portal Based) until real credentials are available.`
      );
    },
  };
}

// One stub per owner-provided partner, matching finance_partners.short_code
// (0031_finance_module.sql). Replace an entry with a real adapter only once
// real API credentials and specs exist for that partner.
export const FINANCE_PROVIDER_ADAPTERS: Record<string, FinanceProviderAdapter> = {
  BAJAJ: manualAdapter("BAJAJ"),
  DMI: manualAdapter("DMI"),
  HOMECREDIT: manualAdapter("HOMECREDIT"),
  IDFC: manualAdapter("IDFC"),
  POONAWALLA: manualAdapter("POONAWALLA"),
  SAMSUNG: manualAdapter("SAMSUNG"),
  TVS: manualAdapter("TVS"),
  XIAOMI: manualAdapter("XIAOMI"),
};

export function getFinanceProviderAdapter(shortCode: string | null | undefined): FinanceProviderAdapter | null {
  if (!shortCode) return null;
  return FINANCE_PROVIDER_ADAPTERS[shortCode] ?? null;
}
