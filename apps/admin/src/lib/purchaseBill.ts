import { lineAmounts, type PurchaseBillInput } from "@sai/shared";
import { SHOP } from "./supabase";
import type { PurchaseEntry } from "../components/PurchaseEntryModal";

/** Turns a form entry into the bill layout's input (used for both Preview and printing saved rows). */
export function billFromEntry(e: PurchaseEntry, mode: "print" | "view"): PurchaseBillInput {
  return {
    billNumber: e.billNumber || "-",
    billDate: e.billDate,
    supplierName: e.partyName,
    supplier: { address: e.address, gstin: e.gstin, phone: e.phone, state: e.partyState },
    placeOfSupply: e.placeOfSupply,
    paymentMode: e.paymentMode,
    paidAmount: e.paidAmount,
    terms: e.terms,
    items: e.lines.map((l) => ({
      name: l.name,
      hsnSac: l.hsn_sac,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      gstRate: l.gst_rate,
      serials: l.serials,
      totalPrice: lineAmounts(l).total,
    })),
    totalAmount: e.totals.subTotal,
    mode,
    shop: SHOP,
  };
}
