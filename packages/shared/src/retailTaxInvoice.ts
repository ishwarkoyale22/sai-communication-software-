/**
 * GST Tax Invoice for retail counter sales — generates the exact HTML layout
 * used by the shop: blue logo header, Bill To / Invoice Details, item table
 * with HSN/SAC + serial numbers, CGST+SGST tax summary grouped by HSN,
 * Round Off, Invoice Amount in Words, Received / Balance, Payment Mode,
 * Terms & Conditions, and Authorized Signatory.
 *
 * GST is derived at print time: each line's price is GST-INCLUSIVE at 18%
 * (9% CGST + 9% SGST), standard practice for retail electronics in India.
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
  customerAddress?: string | null;
  customerGstin?: string | null;
  customerState?: string | null;
  paymentMethod: string;
  /** How much has actually been received — defaults to 0 (nothing received) when omitted. */
  receivedAmount?: number;
  items: RetailTaxInvoiceItem[];
  totalAmount: number; // GST-inclusive grand total (pre-rounding)
  shop: {
    name: string;
    address: string;
    phone: string;
    email?: string;
    gstNumber?: string;
    state?: string;
  };
  /** "print" (default) opens the browser print dialog automatically; "view" just displays the invoice for on-screen viewing. */
  mode?: "print" | "view";
}

const GST_RATE = 0.18;

function numberToWords(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
    "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function chunk(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n] + " ";
    if (n < 100) return tens[Math.floor(n / 10)] + " " + chunk(n % 10);
    return ones[Math.floor(n / 100)] + " Hundred " + chunk(n % 100);
  }

  const intPart = Math.round(num);
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

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function openRetailTaxInvoice(input: RetailTaxInvoiceInput): void {
  const { shop } = input;

  // ── Line item rows ──────────────────────────────────────────────────────────
  const itemRows = input.items.map((item, i) => {
    const taxable = item.totalPrice / (1 + GST_RATE);
    const tax = item.totalPrice - taxable;
    const unitPrice = taxable / item.quantity;
    const serialLine = item.serialNo
      ? `<div class="item-imei">Serial No.: ${item.serialNo}</div>`
      : "";
    return `<tr>
      <td class="text-center">${i + 1}</td>
      <td>
        <div class="item-desc">${item.name}</div>
        ${serialLine}
      </td>
      <td class="text-center">${item.hsnSac ?? ""}</td>
      <td class="text-center">${item.quantity}</td>
      <td class="text-right">₹ ${fmt(unitPrice)}</td>
      <td class="text-right">₹ ${fmt(tax)} (${Math.round(GST_RATE * 100)}%)</td>
      <td class="text-right font-bold">₹ ${fmt(item.totalPrice)}</td>
    </tr>`;
  }).join("");

  const totalQty = input.items.reduce((s, i) => s + i.quantity, 0);
  const rawTotal = input.totalAmount;
  const roundedTotal = Math.round(rawTotal);
  const roundOff = roundedTotal - rawTotal;
  const roundOffStr = roundOff < 0
    ? `- ₹ ${fmt(Math.abs(roundOff))}`
    : roundOff > 0
      ? `+ ₹ ${fmt(roundOff)}`
      : "₹ 0.00";

  // Default to nothing received when the caller doesn't specify an amount —
  // assuming full payment by default would misstate the balance owed on any
  // pending/partial sale (the only case receivedAmount is left unset).
  const received = input.receivedAmount ?? 0;
  const balance = roundedTotal - received;

  // ── Tax summary: group by HSN/SAC ───────────────────────────────────────────
  const hsnGroups = new Map<string, { taxable: number; tax: number }>();
  for (const item of input.items) {
    const key = item.hsnSac?.trim() ?? "";
    const taxable = item.totalPrice / (1 + GST_RATE);
    const tax = item.totalPrice - taxable;
    const g = hsnGroups.get(key);
    if (g) { g.taxable += taxable; g.tax += tax; }
    else hsnGroups.set(key, { taxable, tax });
  }

  const taxRows = Array.from(hsnGroups.entries()).map(([hsn, g]) => {
    const half = g.tax / 2;
    return `<tr>
      <td>${hsn}</td>
      <td class="text-right">${fmt(g.taxable)}</td>
      <td>9</td>
      <td class="text-right">${fmt(half)}</td>
      <td>9</td>
      <td class="text-right">${fmt(half)}</td>
      <td class="text-right">${fmt(g.tax)}</td>
    </tr>`;
  }).join("");

  const totalTaxable = rawTotal / (1 + GST_RATE);
  const totalTax = rawTotal - totalTaxable;
  const totalHalf = totalTax / 2;

  // ── Bill To section ──────────────────────────────────────────────────────────
  const billToLines = [
    input.customerAddress ? `<div>${input.customerAddress}</div>` : "",
    input.customerPhone ? `<div style="margin-top:3px;"><strong>Contact No:</strong> ${input.customerPhone}${input.customerGstin ? ` &nbsp;&nbsp; <strong>GSTIN:</strong> ${input.customerGstin}` : ""}</div>` : "",
    input.customerState ? `<div><strong>State:</strong> ${input.customerState}</div>` : "",
  ].join("");

  const paymentLabel = input.paymentMethod.charAt(0).toUpperCase() + input.paymentMethod.slice(1).replace(/_/g, " ");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="format-detection" content="telephone=no, email=no, address=no, date=no">
  <title>Tax Invoice - ${shop.name}</title>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * {
      box-sizing: border-box; margin: 0; padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { background-color: #525659; padding: 20px 0; font-size: 15px; }
    .page-sheet { width: 210mm; min-width: 210mm; min-height: 297mm; background: #ffffff; padding: 12mm 10mm; margin: 0 auto; }
    .doc-main-heading {
      text-align: center; font-size: 28px; font-weight: 800; color: #2b333d;
      margin-bottom: 16px; letter-spacing: 0.5px;
    }
    .invoice-box { border: 1.5px solid #2d3748; width: 100%; display: flex; flex-direction: column; }
    .brand-section {
      display: flex; padding: 12px 14px; border-bottom: 1.5px solid #2d3748;
      align-items: center; gap: 18px;
    }
    .brand-logo {
      width: 128px; height: 104px; border-radius: 4px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; overflow: hidden;
    }
    .brand-logo img { width: 100%; height: 100%; object-fit: contain; }
    .brand-details { flex: 1; }
    .brand-details h1 { font-size: 30px; font-weight: 800; color: #202b38; margin-bottom: 5px; }
    .brand-address { font-size: 13.5px; color: #333333; margin-bottom: 7px; line-height: 1.4; }
    .brand-grid { display: grid; grid-template-columns: 1.1fr 1.3fr; font-size: 13.5px; row-gap: 5px; color: #222222; }
    .bill-meta-container { display: flex; width: 100%; border-bottom: 1.5px solid #2d3748; }
    .bill-to-col { width: 52%; border-right: 1.5px solid #2d3748; display: flex; flex-direction: column; }
    .invoice-details-col { width: 48%; display: flex; flex-direction: column; }
    .section-header-bar {
      background-color: #f1f3f5; padding: 5px 12px; font-size: 14px;
      font-weight: 700; color: #222222; border-bottom: 1px solid #2d3748;
    }
    .bill-to-content { padding: 10px 12px; font-size: 14px; line-height: 1.5; color: #111111; }
    .bill-to-title { font-weight: 800; font-size: 15.5px; margin-bottom: 4px; }
    .meta-content-grid {
      padding: 10px 12px; display: grid; grid-template-columns: 140px 1fr;
      row-gap: 7px; font-size: 14px; color: #111111;
    }
    table { width: 100%; border-collapse: collapse; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-bold { font-weight: 700; }
    .items-table th {
      border-right: 1px solid #2d3748; border-bottom: 1.5px solid #2d3748;
      padding: 9px 5px; font-size: 14px; font-weight: 700; background-color: #f1f3f5; color: #222222;
    }
    .items-table th:last-child { border-right: none; }
    .items-table td {
      border-right: 1px solid #2d3748; padding: 9px 6px; font-size: 14px;
      vertical-align: top; color: #111111;
    }
    .items-table td:last-child { border-right: none; }
    .item-desc { font-weight: 700; color: #000000; }
    .item-imei { font-size: 12.5px; color: #444444; margin-top: 4px; }
    .items-total-row td {
      border-top: 1.5px solid #2d3748; border-bottom: 1.5px solid #2d3748;
      font-weight: 700; padding: 8px 6px; font-size: 14px;
    }
    .middle-block { display: flex; width: 100%; border-bottom: 1.5px solid #2d3748; }
    .middle-left { width: 65%; min-width: 0; border-right: 1.5px solid #2d3748; display: flex; flex-direction: column; }
    .middle-right { width: 35%; min-width: 0; display: flex; flex-direction: column; }
    .tax-header-label { background-color: #f1f3f5; padding: 6px 10px; font-size: 14px; font-weight: 700; border-top: 1.5px solid #2d3748; border-bottom: 1px solid #2d3748; }
    .tax-sub-table { table-layout: auto; }
    .tax-sub-table th, .tax-sub-table td {
      border-right: 1px solid #2d3748; border-bottom: 1px solid #2d3748;
      padding: 6px 5px; font-size: 13px; text-align: center; color: #111111;
      white-space: nowrap;
    }
    .tax-sub-table th { background-color: #f1f3f5; }
    .tax-sub-table th:last-child, .tax-sub-table td:last-child { border-right: none; }
    .tax-sub-table .text-right { text-align: right; }
    .payment-box { border-top: 1px solid #2d3748; }
    .payment-title { background-color: #f1f3f5; font-weight: 700; font-size: 13.5px; padding: 5px 10px; border-bottom: 1px solid #2d3748; }
    .payment-body { padding: 7px 10px; font-size: 14px; min-height: 26px; }
    .summary-table td { padding: 6px 10px; font-size: 14px; }
    .summary-table tr.bordered td {
      border-top: 1px solid #2d3748; border-bottom: 1px solid #2d3748; font-weight: 700;
    }
    .colon-col { width: 18px; text-align: center; }
    .amount-words-card {
      border-top: 1px solid #2d3748; border-bottom: 1px solid #2d3748;
      padding: 7px 10px; font-size: 13.5px; line-height: 1.45; overflow-wrap: break-word;
    }
    .balance-rows-table td { padding: 5px 10px; font-size: 13.5px; }
    .footer-block { display: flex; width: 100%; }
    .footer-left { width: 52%; border-right: 1.5px solid #2d3748; display: flex; flex-direction: column; }
    .terms-heading { background-color: #f1f3f5; font-weight: 700; font-size: 13.5px; padding: 5px 10px; border-bottom: 1px solid #2d3748; }
    .terms-content { padding: 7px 10px; font-size: 13.5px; color: #222222; }
    .footer-right { width: 48%; display: flex; flex-direction: column; }
    .signatory-company { background-color: #f1f3f5; font-size: 13.5px; font-weight: 700; padding: 5px 10px; border-bottom: 1px solid #2d3748; }
    .signatory-box-inner {
      margin: 8px; border: 1px solid #2d3748; height: 84px;
      display: flex; align-items: flex-end; justify-content: center;
      padding-bottom: 7px; font-size: 13.5px; color: #333333;
    }
    @media print {
      body { background: none; padding: 0; font-size: 15px; }
      .page-sheet { width: 100%; min-width: 0; padding: 0; min-height: auto; margin: 0; }
    }
  </style>
</head>
<body>
<div class="page-sheet">
  <div class="doc-main-heading">Tax Invoice</div>

  <div class="invoice-box">

    <!-- Brand Header -->
    <div class="brand-section">
      <div class="brand-logo">
        <img src="${window.location.origin}/logo.png" alt="${shop.name}" />
      </div>
      <div class="brand-details">
        <h1>${shop.name.toUpperCase()}</h1>
        <div class="brand-address">${shop.address}</div>
        <div class="brand-grid">
          <div><strong>Phone:</strong> ${shop.phone}</div>
          ${shop.email ? `<div><strong>Email:</strong> ${shop.email.toUpperCase()}</div>` : "<div></div>"}
          ${shop.gstNumber ? `<div><strong>GSTIN:</strong> ${shop.gstNumber}</div>` : "<div></div>"}
          <div><strong>State:</strong> ${shop.state ?? ""}</div>
        </div>
      </div>
    </div>

    <!-- Bill To & Invoice Details -->
    <div class="bill-meta-container">
      <div class="bill-to-col">
        <div class="section-header-bar">Bill To:</div>
        <div class="bill-to-content">
          <div class="bill-to-title">${input.customerName}</div>
          ${billToLines}
        </div>
      </div>
      <div class="invoice-details-col">
        <div class="section-header-bar">Invoice Details:</div>
        <div class="meta-content-grid">
          <div>Invoice No.:</div>
          <div class="font-bold">${input.invoiceNumber}</div>
          <div>Date:</div>
          <div class="font-bold">${fmtDate(input.createdAt)}</div>
          <div>Place Of Supply:</div>
          <div class="font-bold">${shop.state ?? ""}</div>
        </div>
      </div>
    </div>

    <!-- Line Items -->
    <table class="items-table">
      <thead>
        <tr>
          <th style="width:4%;">#</th>
          <th style="width:40%; text-align:left; padding-left:6px;">Item name</th>
          <th style="width:12%;">HSN/ SAC</th>
          <th style="width:9%;">Quantity</th>
          <th style="width:12%;">Price/ Unit(₹)</th>
          <th style="width:11%;">GST(₹)</th>
          <th style="width:12%;">Amount(₹)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr class="items-total-row">
          <td></td>
          <td class="font-bold">Total</td>
          <td></td>
          <td class="text-center font-bold">${totalQty}</td>
          <td></td>
          <td class="text-right font-bold">₹ ${fmt(totalTax)}</td>
          <td class="text-right font-bold">₹ ${fmt(rawTotal)}</td>
        </tr>
      </tbody>
    </table>

    <!-- Tax Summary + Right Totals -->
    <div class="tax-header-label">Tax Summary:</div>
    <div class="middle-block">
      <div class="middle-left">
        <table class="tax-sub-table">
          <thead>
            <tr>
              <th rowspan="2" style="width:17%;">HSN/ SAC</th>
              <th rowspan="2" style="width:21%;">Taxable<br>amount (₹)</th>
              <th colspan="2" style="width:21%;">CGST</th>
              <th colspan="2" style="width:21%;">SGST</th>
              <th rowspan="2" style="width:20%;">Total Tax<br>(₹)</th>
            </tr>
            <tr>
              <th>Rate (%)</th>
              <th>Amt (₹)</th>
              <th>Rate (%)</th>
              <th>Amt (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${taxRows}
            <tr class="font-bold">
              <td>TOTAL</td>
              <td class="text-right">${fmt(totalTaxable)}</td>
              <td></td>
              <td class="text-right">${fmt(totalHalf)}</td>
              <td></td>
              <td class="text-right">${fmt(totalHalf)}</td>
              <td class="text-right">${fmt(totalTax)}</td>
            </tr>
          </tbody>
        </table>

        <div class="payment-box">
          <div class="payment-title">Payment Mode:</div>
          <div class="payment-body">${paymentLabel}</div>
        </div>
      </div>

      <div class="middle-right">
        <table class="summary-table">
          <tr>
            <td>Sub Total</td>
            <td class="colon-col">:</td>
            <td class="text-right">₹ ${fmt(rawTotal)}</td>
          </tr>
          <tr>
            <td>Round Off</td>
            <td class="colon-col">:</td>
            <td class="text-right">${roundOffStr}</td>
          </tr>
          <tr class="bordered">
            <td>Total</td>
            <td class="colon-col">:</td>
            <td class="text-right">₹ ${fmt(roundedTotal)}</td>
          </tr>
        </table>

        <div class="amount-words-card">
          <div class="font-bold">Invoice Amount in Words:</div>
          <div style="margin-top:2px;">${numberToWords(roundedTotal)}</div>
        </div>

        <table class="balance-rows-table">
          <tr>
            <td>Received</td>
            <td class="colon-col">:</td>
            <td class="text-right">₹ ${fmt(received)}</td>
          </tr>
          <tr class="font-bold">
            <td>Balance</td>
            <td class="colon-col">:</td>
            <td class="text-right">₹ ${fmt(balance)}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer-block">
      <div class="footer-left">
        <div class="terms-heading">Terms &amp; Conditions:</div>
        <div class="terms-content">Thanks for doing business with us!</div>
      </div>
      <div class="footer-right">
        <div class="signatory-company">For ${shop.name.toUpperCase()}:</div>
        <div class="signatory-box-inner">Authorized Signatory</div>
      </div>
    </div>

  </div>
</div>
${input.mode === "view" ? "" : "<script>window.onload = () => window.print();</script>"}
</body>
</html>`;

  const win = window.open("", "_blank", "width=960,height=1000");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
