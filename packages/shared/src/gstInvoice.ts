import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatCurrency, formatDate } from "./format";
import type { Sale, SaleItem, Customer, Product } from "./types";

export interface GstInvoiceInput {
  sale: Sale;
  items: (SaleItem & { product?: Product | null })[];
  customer: Customer | null;
  shop: {
    name: string;
    address: string;
    phone: string;
    gstNumber?: string;
  };
}

/**
 * Generates a printable GST invoice PDF and triggers a download.
 *
 * Reads the actual per-item tax breakdown (`gst_rate`, `hsn_sac`, `cgst`,
 * `sgst`, `igst`, `discount`) and the sale-level totals (`taxable_value`,
 * `cgst_total`, `sgst_total`, `igst_total`, `discount_total`) that Billing
 * saves at the time of sale — no assumed flat rate. For non-GST sales
 * (gst_applicable = false) the invoice still renders but omits the
 * GSTIN / tax breakdown rows, same as before.
 */
export function generateGstInvoicePdf(input: GstInvoiceInput): void {
  const { sale, items, customer, shop } = input;
  const doc = new jsPDF();
  const gst = sale.gst_applicable;

  doc.setFontSize(16);
  doc.text(shop.name, 14, 18);
  doc.setFontSize(10);
  doc.text(shop.address, 14, 24);
  doc.text(`Phone: ${shop.phone}`, 14, 29);
  if (gst && shop.gstNumber) {
    doc.text(`GSTIN: ${shop.gstNumber}`, 14, 34);
  }

  doc.setFontSize(14);
  doc.text(gst ? "TAX INVOICE" : "INVOICE", 150, 18);
  doc.setFontSize(10);
  doc.text(`Invoice #: ${sale.invoice_number}`, 150, 24);
  doc.text(`Date: ${formatDate(sale.created_at)}`, 150, 29);
  doc.text(`Type: ${sale.sale_type.toUpperCase()}`, 150, 34);

  doc.text("Bill To:", 14, 44);
  doc.text(customer?.name ?? "Walk-in Customer", 14, 49);
  if (customer?.phone) doc.text(customer.phone, 14, 54);
  if (gst && sale.gst_number) doc.text(`GSTIN: ${sale.gst_number}`, 14, 59);

  const hasIgst = gst && items.some((i) => Number(i.igst) > 0);

  const rows = items.map((item) => {
    const lineTotal = item.qty * item.unit_price - Number(item.discount || 0);
    const row = [
      item.product?.name ?? "Item",
      item.hsn_sac || item.product?.sku || "-",
      String(item.qty),
      formatCurrency(item.unit_price),
    ];
    if (gst) {
      row.push(`${Number(item.gst_rate || 0)}%`);
      if (hasIgst) row.push(formatCurrency(Number(item.igst || 0)));
      else row.push(formatCurrency(Number(item.cgst || 0)), formatCurrency(Number(item.sgst || 0)));
    }
    row.push(formatCurrency(lineTotal));
    return row;
  });

  const head = gst
    ? hasIgst
      ? [["Item", "HSN/SAC", "Qty", "Rate", "GST%", "IGST", "Amount"]]
      : [["Item", "HSN/SAC", "Qty", "Rate", "GST%", "CGST", "SGST", "Amount"]]
    : [["Item", "SKU", "Qty", "Rate", "Amount"]];

  autoTable(doc, { startY: 65, head, body: rows });

  // @ts-expect-error lastAutoTable is added by jspdf-autotable at runtime
  let y = (doc.lastAutoTable?.finalY ?? 65) + 8;

  if (gst) {
    doc.text(`Taxable Value: ${formatCurrency(sale.taxable_value)}`, 150, y);
    if (Number(sale.discount_total) > 0) {
      y += 5;
      doc.text(`Discount: -${formatCurrency(sale.discount_total)}`, 150, y);
    }
    if (hasIgst) {
      y += 5;
      doc.text(`IGST: ${formatCurrency(sale.igst_total)}`, 150, y);
    } else {
      y += 5;
      doc.text(`CGST: ${formatCurrency(sale.cgst_total)}`, 150, y);
      y += 5;
      doc.text(`SGST: ${formatCurrency(sale.sgst_total)}`, 150, y);
    }
  } else {
    doc.text(`Subtotal: ${formatCurrency(sale.total_amount)}`, 150, y);
  }
  y += 6;
  doc.setFontSize(12);
  doc.text(`Total: ${formatCurrency(sale.total_amount)}`, 150, y);

  if (sale.payment_method) {
    y += 6;
    doc.setFontSize(10);
    doc.text(`Payment: ${sale.payment_method.replace("_", " ").toUpperCase()}`, 150, y);
  }

  if (sale.finance_partner_id && sale.emi_months) {
    y += 8;
    doc.setFontSize(10);
    doc.text(`EMI: ${sale.emi_months} months @ ${formatCurrency(sale.emi_amount)}/mo`, 14, y);
  }

  doc.save(`${sale.invoice_number}.pdf`);
}
