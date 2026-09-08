import { formatDate } from "./format";

/**
 * GST-style "Tax Invoice" for retail counter sales — matches the exact
 * printed format the shop already uses on paper (logo box, Bill To /
 * Invoice Details, item table with HSN/SAC, CGST+SGST breakdown, amount
 * in words, signatory box).
 *
 * The live `sales` / `sales_items` tables carry no GST fields at all (no
 * gst_rate, hsn_sac, cgst, sgst — confirmed against the schema; see
 * simpleInvoice.ts's notes for why gstInvoice.ts's shape doesn't match
 * live data either). Rather than inventing new columns for this, GST is
 * derived at print time the same way the shop's existing paper invoices
 * derive it: each line's price is treated as GST-INCLUSIVE at 18%, split
 * evenly into 9% CGST + 9% SGST — this is standard practice for retail
 * electronics billing in India and matches the sample invoice exactly
 * (₹33,897.46 taxable + ₹6,101.54 tax @18% = ₹39,999.00).
 */

export interface RetailTaxInvoiceItem {
  name: string;
  serialNo?: string | null;
  hsnSac?: string | null;
  quantity: number;
  totalPrice: number; // GST-inclusive line amount
}

export interface RetailTaxInvoiceInput {
  invoiceNumber: string;
  createdAt: string;
  customerName: string;
  customerPhone?: string | null;
  paymentMethod: string;
  /** How much of the total has actually been received — defaults to the full amount (paid in full). */
  receivedAmount?: number;
  items: RetailTaxInvoiceItem[];
  totalAmount: number; // GST-inclusive grand total
  shop: {
    name: string;
    address: string;
    phone: string;
    email?: string;
    gstNumber?: string;
    state?: string;
  };
}

const GST_RATE = 0.18;

function numberToWords(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function chunk(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n] + " ";
    if (n < 100) return tens[Math.floor(n / 10)] + " " + chunk(n % 10);
    return ones[Math.floor(n / 100)] + " Hundred " + chunk(n % 100);
  }

  const intPart = Math.floor(num);
  if (intPart === 0) return "Zero Rupees only";

  const crore = Math.floor(intPart / 10000000);
  const lakh = Math.floor((intPart % 10000000) / 100000);
  const thousand = Math.floor((intPart % 100000) / 1000);
  const hundred = intPart % 1000;

  let words = "";
  if (crore) words += chunk(crore) + "Crore ";
  if (lakh) words += chunk(lakh) + "Lakh ";
  if (thousand) words += chunk(thousand) + "Thousand ";
  if (hundred) words += chunk(hundred);

  return words.trim() + " Rupees only";
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function openRetailTaxInvoice(input: RetailTaxInvoiceInput): void {
  const { shop } = input;

  const rows = input.items.map((item, i) => {
    const taxable = item.totalPrice / (1 + GST_RATE);
    const tax = item.totalPrice - taxable;
    const unitPrice = taxable / item.quantity;
    return `<tr>
      <td class="text-center">${i + 1}</td>
      <td><strong>${item.name}</strong>${item.serialNo ? `<br>Serial No: ${item.serialNo}` : ""}</td>
      <td class="text-center">${item.hsnSac || "-"}</td>
      <td class="text-center">${item.quantity}</td>
      <td class="text-right">₹ ${fmt(unitPrice)}</td>
      <td class="text-right">₹ ${fmt(tax)} (${Math.round(GST_RATE * 100)}%)</td>
      <td class="text-right bold">₹ ${fmt(item.totalPrice)}</td>
    </tr>`;
  }).join("");

  const totalQty = input.items.reduce((s, i) => s + i.quantity, 0);
  const taxableTotal = input.totalAmount / (1 + GST_RATE);
  const totalTax = input.totalAmount - taxableTotal;
  const cgst = totalTax / 2;
  const sgst = totalTax / 2;
  const received = input.receivedAmount ?? input.totalAmount;
  const balance = input.totalAmount - received;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Tax Invoice - ${shop.name}</title>
  <style>
    * {
      box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif;
      /* Browsers strip background colors when printing by default — without
         this, the solid black logo box (and any other background) prints
         as blank/faint text instead of the actual filled box. This is the
         standard fix, needed on both the Chromium and Firefox property names. */
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
    }
    body { background-color: #f4f4f4; padding: 20px; display: flex; justify-content: center; }
    .invoice-card { background: #fff; width: 880px; border: 1.5px solid #000; padding: 16px; }
    .tax-summary-label { font-weight: bold; font-size: 12px; margin: 8px 0 3px; }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    .logo-box { width: 160px; height: 100px; background: #000; color: #fff; text-align: center; vertical-align: middle; padding: 14px 10px; font-weight: bold; }
    .logo-title { font-size: 34px; line-height: 1.1; }
    .logo-sub { font-size: 11px; letter-spacing: 0.5px; margin-top: 4px; }
    .header-details { padding-left: 14px; vertical-align: middle; }
    .invoice-heading { text-align: center; font-size: 22px; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; }
    .shop-name { font-size: 15px; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
    .shop-info { font-size: 11px; line-height: 1.35; }
    .sale-type-badge { display: inline-block; margin-top: 4px; padding: 2px 8px; border: 1px solid #000; font-size: 10px; font-weight: bold; text-transform: uppercase; }
    table.data-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.data-table th, table.data-table td { border: 1px solid #000; padding: 5px 6px; vertical-align: middle; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .sign-box { height: 60px; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; padding: 4px; font-size: 11px; }
    @media print { body { background: #fff; padding: 0; } .invoice-card { border: none; width: 100%; } }
  </style>
</head>
<body>
<div class="invoice-card">
  <table class="header-table">
    <tr>
      <td class="logo-box">
        <div class="logo-title">Sai</div>
        <div class="logo-sub">Communication</div>
      </td>
      <td class="header-details">
        <div class="invoice-heading">Tax Invoice</div>
        <div class="shop-name">${shop.name}</div>
        <div class="shop-info">
          ${shop.address}<br>
          <strong>Phone:</strong> ${shop.phone}${shop.email ? ` &nbsp;|&nbsp; <strong>Email:</strong> ${shop.email}` : ""}<br>
          ${shop.gstNumber ? `<strong>GSTIN:</strong> ${shop.gstNumber} &nbsp;|&nbsp; ` : ""}<strong>State:</strong> ${shop.state || ""}
        </div>
        <span class="sale-type-badge">Retail Sale</span>
      </td>
    </tr>
  </table>

  <table class="data-table" style="margin-bottom: -1px;">
    <tr>
      <td style="width: 50%;">
        <strong>Bill To:</strong><br>
        <strong>${input.customerName}</strong><br>
        ${input.customerPhone ? `Contact No: ${input.customerPhone}` : ""}
      </td>
      <td style="width: 50%;">
        <strong>Invoice Details:</strong><br>
        Invoice No.: <strong>${input.invoiceNumber}</strong><br>
        Date: <strong>${formatDate(input.createdAt)}</strong>
      </td>
    </tr>
  </table>

  <table class="data-table">
    <thead>
      <tr style="background: #f9f9f9;">
        <th style="width: 30px;">#</th>
        <th>Item name</th>
        <th style="width: 70px;">HSN/SAC</th>
        <th style="width: 50px;">Quantity</th>
        <th style="width: 85px;">Price/Unit(₹)</th>
        <th style="width: 95px;">GST(₹)</th>
        <th style="width: 85px;">Amount(₹)</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr>
        <td class="bold text-center">Total</td>
        <td></td>
        <td></td>
        <td class="text-center bold">${totalQty}</td>
        <td></td>
        <td class="text-right bold">₹ ${fmt(totalTax)}</td>
        <td class="text-right bold">₹ ${fmt(input.totalAmount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="tax-summary-label">Tax Summary:</div>
  <table class="data-table">
    <thead>
      <tr style="background: #f9f9f9;">
        <th rowspan="2">HSN/SAC</th>
        <th rowspan="2">Taxable amount (₹)</th>
        <th colspan="2">CGST</th>
        <th colspan="2">SGST</th>
        <th rowspan="2">Total Tax (₹)</th>
        <th colspan="2" rowspan="2" style="background:#fff; border-bottom: none;"></th>
      </tr>
      <tr style="background: #f9f9f9;">
        <th>Rate(%)</th>
        <th>Amt (₹)</th>
        <th>Rate(%)</th>
        <th>Amt (₹)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="text-center">-</td>
        <td class="text-right">${fmt(taxableTotal)}</td>
        <td class="text-center">9</td>
        <td class="text-right">${fmt(cgst)}</td>
        <td class="text-center">9</td>
        <td class="text-right">${fmt(sgst)}</td>
        <td class="text-right bold">${fmt(totalTax)}</td>
        <td class="bold">Sub Total</td>
        <td class="text-right bold">₹ ${fmt(input.totalAmount)}</td>
      </tr>
      <tr>
        <td colspan="7" rowspan="3" style="vertical-align: top;">
          <strong>Sale Type:</strong> Retail Sale<br>
          <strong>Payment Mode:</strong> ${input.paymentMethod.replace(/_/g, " ").toUpperCase()}<br><br>
          <strong>Terms & Conditions:</strong><br>
          Thanks for doing business with us!<br><br>
          <strong>Invoice Amount in Words:</strong> ${numberToWords(input.totalAmount)}
        </td>
        <td class="bold">Total</td>
        <td class="text-right bold">₹ ${fmt(input.totalAmount)}</td>
      </tr>
      <tr>
        <td>Received</td>
        <td class="text-right">₹ ${fmt(received)}</td>
      </tr>
      <tr>
        <td class="bold">Balance</td>
        <td class="text-right bold">₹ ${fmt(balance)}</td>
      </tr>
      <tr>
        <td colspan="7"></td>
        <td colspan="2" style="padding: 0;">
          <div class="sign-box">
            <span class="bold">For ${shop.name}:</span>
            <span>Authorized Signatory</span>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</div>
<script>window.onload = () => window.print();</script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=900");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
