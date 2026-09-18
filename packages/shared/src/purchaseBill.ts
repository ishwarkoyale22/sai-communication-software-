/**
 * "Bill" print for money going OUT of the shop — a wholesaler invoice or a
 * third-party purchase. Visually the mirror image of retailTaxInvoice.ts's
 * retail sale bill (same header/logo/tax-summary structure), but the named
 * party goes in "Bill From:" since here the shop is the buyer, not the
 * seller — matching the exact layout requested for these two pages.
 */

export interface PurchaseBillItem {
  name: string;
  hsnSac?: string | null;
  quantity: number;
  totalPrice: number; // GST-inclusive line amount
}

export interface PurchaseBillInput {
  billNumber: string;
  billDate: string;
  /** The wholesaler / vendor being paid — printed under "Bill From:". */
  supplierName: string;
  paymentMode: string;
  /** How much of the total has actually been paid — defaults to 0 (nothing paid) when omitted. */
  paidAmount?: number;
  items: PurchaseBillItem[];
  totalAmount: number; // GST-inclusive grand total (pre-rounding)
  shop: {
    name: string;
    address: string;
    phone: string;
    email?: string;
    gstNumber?: string;
    state?: string;
  };
  /** "print" (default) opens the browser print dialog automatically; "view" just displays the bill for on-screen viewing. */
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

export function openPurchaseBill(input: PurchaseBillInput, targetWindow?: Window | null): void {
  const { shop } = input;

  const itemRows = input.items.map((item, i) => {
    const taxable = item.totalPrice / (1 + GST_RATE);
    const tax = item.totalPrice - taxable;
    const unitPrice = item.quantity > 0 ? taxable / item.quantity : taxable;
    return `<tr>
          <td class="text-center">${i + 1}</td>
          <td><div class="font-bold">${item.name}</div></td>
          <td class="text-center">${item.hsnSac ?? ""}</td>
          <td class="text-center">${item.quantity}</td>
          <td class="text-right">₹ ${fmt(unitPrice)}</td>
          <td class="text-right">₹ ${fmt(tax)} (${Math.round(GST_RATE * 100)}%)</td>
          <td class="text-right">₹ ${fmt(item.totalPrice)}</td>
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

  const paid = input.paidAmount ?? 0;
  const balance = roundedTotal - paid;

  const hsnGroups = new Map<string, { taxable: number; tax: number }>();
  for (const item of input.items) {
    const key = item.hsnSac?.trim() || "";
    const taxable = item.totalPrice / (1 + GST_RATE);
    const tax = item.totalPrice - taxable;
    const g = hsnGroups.get(key);
    if (g) { g.taxable += taxable; g.tax += tax; }
    else hsnGroups.set(key, { taxable, tax });
  }
  const taxRows = Array.from(hsnGroups.entries()).map(([hsn, g]) => {
    const half = g.tax / 2;
    return `<tr>
              <td class="col-center">${hsn}</td>
              <td>${fmt(g.taxable)}</td>
              <td class="col-center">9</td>
              <td>${fmt(half)}</td>
              <td class="col-center">9</td>
              <td>${fmt(half)}</td>
              <td>${fmt(g.tax)}</td>
            </tr>`;
  }).join("");

  const totalTaxable = rawTotal / (1 + GST_RATE);
  const totalTax = rawTotal - totalTaxable;
  const totalHalf = totalTax / 2;

  const paymentLabel = input.paymentMode.charAt(0).toUpperCase() + input.paymentMode.slice(1).replace(/_/g, " ");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Bill - ${shop.name}</title>
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  }
  body {
    background-color: #e5e7eb;
    padding: 20px;
  }
  .page {
    width: 210mm;
    min-width: 210mm;
    min-height: 297mm;
    background: #ffffff;
    padding: 20px 24px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.15);
    color: #1a202c;
    margin: 0 auto;
  }
  .title {
    text-align: center;
    font-size: 19px;
    font-weight: 800;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    color: #111827;
  }
  .main-box {
    border: 1.5px solid #334155;
  }

  .header-table {
    width: 100%;
    border-collapse: collapse;
  }
  .header-table td {
    padding: 0;
    vertical-align: top;
  }
  .logo-cell {
    width: 125px;
    text-align: center;
    padding: 0;
    vertical-align: middle !important;
  }
  .logo-cell img {
    width: 100%;
    height: 96px;
    object-fit: contain;
  }
  .company-info {
    padding: 8px 12px;
  }
  .company-title {
    font-size: 21px;
    font-weight: 900;
    letter-spacing: 0.3px;
    color: #1e293b;
    margin-bottom: 4px;
  }
  .company-address {
    font-size: 9.5px;
    color: #334155;
    font-weight: 600;
    line-height: 1.3;
    margin-bottom: 6px;
    text-transform: uppercase;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1.35fr;
    font-size: 10px;
    row-gap: 3px;
    color: #1e293b;
    white-space: nowrap;
  }
  .info-grid strong {
    color: #000;
  }

  .meta-bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1.5px solid #334155;
    background: #f8fafc;
    font-size: 10px;
    font-weight: 700;
  }
  .meta-bar > div {
    padding: 4px 8px;
  }
  .meta-bar > div:first-child {
    border-right: 1.5px solid #334155;
  }
  .meta-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1px solid #334155;
    font-size: 10px;
  }
  .meta-content-left {
    padding: 8px;
    border-right: 1.5px solid #334155;
    font-weight: 800;
    color: #0f172a;
  }
  .meta-content-right {
    padding: 6px 8px;
    line-height: 1.6;
    color: #1e293b;
  }

  table.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
  }
  table.data-table th, table.data-table td {
    border: 1px solid #334155;
    padding: 4px 6px;
  }
  table.data-table th {
    background-color: #f1f3f5;
    font-weight: 700;
    color: #1e293b;
    text-align: center;
  }
  .item-table {
    border-top: 1.5px solid #334155;
    border-left: none;
    border-right: none;
  }
  .item-table th {
    padding: 6px 4px;
  }
  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .font-bold { font-weight: 700; }

  .tax-summary-wrapper {
    display: flex;
    border-top: 1.5px solid #334155;
  }
  .tax-section {
    flex: 1.45;
    min-width: 0;
    border-right: 1.5px solid #334155;
  }
  .summary-section {
    flex: 0.85;
    min-width: 0;
  }
  .section-title {
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 700;
    border-bottom: 1px solid #334155;
    background: #fff;
  }
  .tax-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9px;
  }
  .tax-table th, .tax-table td {
    border: 1px solid #334155;
    padding: 3px 4px;
    text-align: right;
    white-space: nowrap;
  }
  .tax-table th {
    background-color: #fff;
    text-align: center;
    font-weight: 700;
  }
  .tax-table td.col-center {
    text-align: center;
  }

  .calc-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
  }
  .calc-table td {
    padding: 3px 6px;
    border-bottom: 1px solid #334155;
    white-space: nowrap;
  }
  .calc-label { width: 45%; color: #1e293b; }
  .calc-colon { width: 5%; text-align: center; }
  .calc-val { width: 50%; text-align: right; }

  .amount-words-box {
    padding: 4px 8px;
    font-size: 9px;
    border-bottom: 1px solid #334155;
    min-height: 42px;
    line-height: 1.35;
    overflow-wrap: break-word;
  }
  .amount-words-title {
    font-weight: 700;
    margin-bottom: 2px;
  }

  .payment-bar {
    border-top: 1.5px solid #334155;
    padding: 3px 8px;
    font-size: 10px;
    font-weight: 700;
  }
  .payment-body {
    border-top: 1px solid #334155;
    padding: 4px 8px 7px 8px;
    font-size: 9.5px;
  }

  .terms-box {
    margin-top: 12px;
    border: 1.5px solid #334155;
    font-size: 9.5px;
  }
  .terms-title {
    padding: 3px 8px;
    font-weight: 700;
    border-bottom: 1px solid #334155;
  }
  .terms-content {
    padding: 6px 8px;
    min-height: 22px;
  }

  .sign-container {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
  .sign-box {
    width: 48%;
    border: 1.5px solid #334155;
    font-size: 9.5px;
  }
  .sign-title {
    padding: 3px 8px;
    font-weight: 700;
    border-bottom: 1px solid #334155;
  }
  .sign-space {
    height: 60px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 4px;
    font-size: 9px;
    color: #334155;
  }

  @media print {
    body { background: transparent; padding: 0; }
    .page { box-shadow: none; width: 100%; margin: 0; }
  }
</style>
</head>
<body>

<div class="page">
  <div class="title">Bill</div>

  <div class="main-box">
    <table class="header-table">
      <tr>
        <td class="logo-cell">
          <img src="${window.location.origin}/logo.png" alt="${shop.name}" />
        </td>
        <td class="company-info">
          <div class="company-title">${shop.name.toUpperCase()}</div>
          <div class="company-address">${shop.address}</div>
          <div class="info-grid">
            <div>Phone: <strong>${shop.phone}</strong></div>
            ${shop.email ? `<div>Email: <strong>${shop.email.toUpperCase()}</strong></div>` : "<div></div>"}
            ${shop.gstNumber ? `<div>GSTIN: <strong>${shop.gstNumber}</strong></div>` : "<div></div>"}
            <div>State: <strong>${shop.state ?? ""}</strong></div>
          </div>
        </td>
      </tr>
    </table>

    <div class="meta-bar">
      <div>Bill From:</div>
      <div>Bill Details:</div>
    </div>
    <div class="meta-content">
      <div class="meta-content-left">${input.supplierName}</div>
      <div class="meta-content-right">
        <div>Bill No.: <strong>${input.billNumber}</strong></div>
        <div>Date: <strong>${fmtDate(input.billDate)}</strong></div>
        <div>Place Of Supply: <strong>${shop.state ?? ""}</strong></div>
      </div>
    </div>

    <table class="data-table item-table">
      <thead>
        <tr>
          <th style="width: 4%;">#</th>
          <th style="width: 32%;">Item name</th>
          <th style="width: 12%;">HSN/ SAC</th>
          <th style="width: 10%;">Quantity</th>
          <th style="width: 14%;">Price/ Unit(₹)</th>
          <th style="width: 14%;">GST(₹)</th>
          <th style="width: 14%;">Amount(₹)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr class="font-bold">
          <td></td>
          <td>Total</td>
          <td></td>
          <td class="text-center">${totalQty}</td>
          <td></td>
          <td class="text-right">₹ ${fmt(totalTax)}</td>
          <td class="text-right">₹ ${fmt(rawTotal)}</td>
        </tr>
      </tbody>
    </table>

    <div class="tax-summary-wrapper">
      <div class="tax-section">
        <div class="section-title">Tax Summary:</div>
        <table class="tax-table">
          <thead>
            <tr>
              <th rowspan="2" style="width: 16%;">HSN/ SAC</th>
              <th rowspan="2" style="width: 22%;">Taxable<br>amount (₹)</th>
              <th colspan="2" style="width: 24%;">CGST</th>
              <th colspan="2" style="width: 24%;">SGST</th>
              <th rowspan="2" style="width: 14%;">Total Tax<br>(₹)</th>
            </tr>
            <tr>
              <th style="font-size: 8px;">Rate (%)</th>
              <th style="font-size: 8px;">Amt (₹)</th>
              <th style="font-size: 8px;">Rate (%)</th>
              <th style="font-size: 8px;">Amt (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${taxRows}
            <tr class="font-bold">
              <td class="col-center">TOTAL</td>
              <td>${fmt(totalTaxable)}</td>
              <td></td>
              <td>${fmt(totalHalf)}</td>
              <td></td>
              <td>${fmt(totalHalf)}</td>
              <td>${fmt(totalTax)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="summary-section">
        <table class="calc-table">
          <tr>
            <td class="calc-label">Sub Total</td>
            <td class="calc-colon">:</td>
            <td class="calc-val">₹ ${fmt(rawTotal)}</td>
          </tr>
          <tr>
            <td class="calc-label">Round Off</td>
            <td class="calc-colon">:</td>
            <td class="calc-val">${roundOffStr}</td>
          </tr>
          <tr class="font-bold">
            <td class="calc-label">Total</td>
            <td class="calc-colon">:</td>
            <td class="calc-val">₹ ${fmt(roundedTotal)}</td>
          </tr>
        </table>

        <div class="amount-words-box">
          <div class="amount-words-title">Bill Amount in Words:</div>
          <div>${numberToWords(roundedTotal)}</div>
        </div>

        <table class="calc-table" style="border-bottom: none;">
          <tr>
            <td class="calc-label">Paid</td>
            <td class="calc-colon">:</td>
            <td class="calc-val">₹ ${fmt(paid)}</td>
          </tr>
          <tr>
            <td class="calc-label">Balance</td>
            <td class="calc-colon">:</td>
            <td class="calc-val">₹ ${fmt(balance)}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="payment-bar">Payment Mode:</div>
    <div class="payment-body">${paymentLabel}</div>
  </div>

  <div class="terms-box">
    <div class="terms-title">Terms &amp; Conditions:</div>
    <div class="terms-content">Thanks for doing business with us!</div>
  </div>

  <div class="sign-container">
    <div class="sign-box">
      <div class="sign-title">For ${shop.name.toUpperCase()}:</div>
      <div class="sign-space">Authorized Signatory</div>
    </div>
  </div>
</div>
${input.mode === "view" ? "" : "<script>window.onload = () => window.print();</script>"}
</body>
</html>`;

  const win = targetWindow !== undefined ? targetWindow : window.open("", "_blank", "width=960,height=1000");
  if (!win) {
    alert("Your browser blocked the invoice popup. Please allow popups for this site and try again.");
    return;
  }
  win.document.write(html);
  win.document.close();
}
