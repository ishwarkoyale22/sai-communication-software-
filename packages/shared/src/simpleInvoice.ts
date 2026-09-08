import jsPDF from "jspdf";
import * as autoTableModule from "jspdf-autotable";
import { formatCurrency, formatDateTime } from "./format";

// jspdf-autotable ships as a UMD bundle whose CJS `module.exports` is an
// object with its OWN nested `.default` property holding the real function
// (plus `.applyPlugin`, `.Table`, etc.) — Vite/rolldown's CJS interop maps
// a plain `import autoTable from "jspdf-autotable"` to that whole
// module.exports object (one level of unwrapping), not the function
// buried inside it, so `autoTable(...)` throws "is not a function".
// Confirmed by inspecting the pre-bundled dep: `export default
// require_jspdf_plugin_autotable()` — the returned object itself has
// `exports.default = autoTable` set on it. Unwrap both levels defensively
// so this keeps working if a future bundler *does* unwrap it fully.
const autoTableExports = autoTableModule as any;
const autoTable = (
  typeof autoTableExports === "function"
    ? autoTableExports
    : typeof autoTableExports.default === "function"
      ? autoTableExports.default
      : autoTableExports.default?.default
) as (doc: jsPDF, options: any) => void;

/**
 * Printable/downloadable bill for the live `sales` + `sales_items` schema
 * actually used by apps/admin (Invoice Number, Customer Name, Product Name,
 * Total Paid Amount, Payment Method, Date & Time — per the requirements
 * doc's "Sales & Invoice Management" section). Deliberately separate from
 * gstInvoice.ts, which targets a different (GST-aware, aspirational) Sale
 * shape that the live sales/sales_items tables don't actually have columns
 * for (no taxable_value/cgst_total/etc. on the live `sales` row).
 */
export interface SimpleInvoiceInput {
  invoiceNumber: string;
  customerName: string;
  customerPhone?: string | null;
  paymentMethod: string;
  paymentStatus?: string | null;
  createdAt: string;
  items: { name: string; quantity: number; unitPrice: number; totalPrice: number }[];
  totalAmount: number;
  discount?: number;
  finalAmount: number;
  shop: { name: string; address: string; phone: string };
  /** "download" saves a .pdf file; "print" opens the browser print dialog on the PDF. */
  mode?: "download" | "print";
  /** Overrides the default "INVOICE" heading — e.g. "GIFT ORDER BILL". */
  billLabel?: string;
}

export function generateSimpleInvoicePdf(input: SimpleInvoiceInput): void {
  const { shop } = input;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text(shop.name, 14, 18);
  doc.setFontSize(10);
  doc.text(shop.address, 14, 24);
  doc.text(`Phone: ${shop.phone}`, 14, 29);

  doc.setFontSize(14);
  doc.text(input.billLabel ?? "INVOICE", 150, 18);
  doc.setFontSize(10);
  doc.text(`Invoice #: ${input.invoiceNumber}`, 150, 24);
  doc.text(`Date: ${formatDateTime(input.createdAt)}`, 150, 29);

  doc.text("Bill To:", 14, 40);
  doc.text(input.customerName || "Walk-in Customer", 14, 45);
  if (input.customerPhone) doc.text(input.customerPhone, 14, 50);

  const rows = input.items.map((i) => [i.name, String(i.quantity), formatCurrency(i.unitPrice), formatCurrency(i.totalPrice)]);
  autoTable(doc, {
    startY: 58,
    head: [["Product", "Qty", "Unit Price", "Amount"]],
    body: rows,
  });

  // @ts-expect-error lastAutoTable is added by jspdf-autotable at runtime
  let y = (doc.lastAutoTable?.finalY ?? 58) + 8;

  doc.text(`Subtotal: ${formatCurrency(input.totalAmount)}`, 150, y);
  if (input.discount && input.discount > 0) {
    y += 5;
    doc.text(`Discount: -${formatCurrency(input.discount)}`, 150, y);
  }
  y += 6;
  doc.setFontSize(12);
  doc.text(`Total Paid: ${formatCurrency(input.finalAmount)}`, 150, y);

  y += 6;
  doc.setFontSize(10);
  const paymentLabel = input.paymentMethod.replace(/_/g, " ").toUpperCase();
  doc.text(`Payment Method: ${paymentLabel}${input.paymentStatus ? ` (${input.paymentStatus})` : ""}`, 14, y);

  if (input.mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  } else {
    doc.save(`${input.invoiceNumber}.pdf`);
  }
}
