import { formatDate } from "./format";

/**
 * GST B2B "Tax Invoice" for a wholesaler/supplier purchase — the mirror
 * image of retailTaxInvoice.ts's "Retail Sale" invoice: there, the shop is
 * the seller; here, the shop is the buyer and the wholesaler is the seller.
 * The layout matches a real e-Invoice / Tax Invoice document exactly
 * (IRN/QR block, seller + invoice-metadata grid, consignee/buyer +
 * dispatch grid, item table with HSN/qty/rate/per/disc%, CGST+SGST tax
 * summary, declaration + signatory footer) — not the simpler retail
 * layout, since a wholesaler purchase invoice carries more B2B fields
 * (e-Way Bill No., dispatch details, buyer's order no., etc.).
 *
 * Renders entirely from data already stored on the `wholesaler_invoices`
 * row (its `items` jsonb array and the tax/reference metadata parsed out
 * of `notes`) plus the shop's own details — nothing here is hardcoded per
 * invoice. Fields that aren't recorded for a given purchase (most
 * invoices today only have a total, not full e-invoice metadata) simply
 * print as "-", the same way the real paper form leaves them blank.
 */

export interface PurchaseTaxInvoiceItem {
  description: string;
  hsnSac?: string | null;
  batchNumber?: string | null;
  qty: number;
  unit?: string | null;
  rate: number;
  amount: number;
  gstRate?: number | null;
}

export interface PurchaseTaxInvoiceInput {
  invoiceNumber: string;
  invoiceDate: string;
  supplier: {
    name: string;
    address?: string | null;
    gstin?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  buyer: {
    name: string;
    address: string;
    gstin?: string;
    state?: string;
  };
  items: PurchaseTaxInvoiceItem[];
  totalAmount: number;
  paidAmount?: number;
  /** Optional tax breakdown — computed from items if not supplied. */
  taxableValue?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  /** Optional e-invoice / B2B reference fields — print as "-" when absent. */
  irn?: string | null;
  ackNo?: string | null;
  ackDate?: string | null;
  ewayBillNo?: string | null;
  deliveryNote?: string | null;
  modeOfPayment?: string | null;
  buyersOrderNo?: string | null;
  dispatchDocNo?: string | null;
  dispatchedThrough?: string | null;
  destination?: string | null;
  termsOfDelivery?: string | null;
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
  const paise = Math.round((num - intPart) * 100);
  if (intPart === 0 && paise === 0) return "Zero Rupees Only";

  const crore = Math.floor(intPart / 10000000);
  const lakh = Math.floor((intPart % 10000000) / 100000);
  const thousand = Math.floor((intPart % 100000) / 1000);
  const hundred = intPart % 1000;

  let words = "";
  if (crore) words += chunk(crore) + "Crore ";
  if (lakh) words += chunk(lakh) + "Lakh ";
  if (thousand) words += chunk(thousand) + "Thousand ";
  if (hundred) words += chunk(hundred);

  words = words.trim();
  if (paise > 0) {
    return `INR ${words} and ${chunk(paise).trim()} Paise Only`;
  }
  return `INR ${words} Only`;
}

const dash = (v?: string | null) => (v && v.trim() ? v : "-");

export function openPurchaseTaxInvoice(input: PurchaseTaxInvoiceInput): void {
  const { supplier, buyer } = input;

  const totalQty = input.items.reduce((s, i) => s + i.qty, 0);
  const computedTaxable = input.items.reduce((s, i) => s + i.amount / (1 + (i.gstRate ?? 18) / 100), 0);
  const taxableValue = input.taxableValue ?? computedTaxable;
  const totalTax = input.totalAmount - taxableValue;
  const cgst = input.cgstAmount ?? totalTax / 2;
  const sgst = input.sgstAmount ?? totalTax / 2;

  const itemRows = input.items.map((item, i) => `<tr>
      <td class="text-center">${i + 1}</td>
      <td class="item-desc">
        <strong>${item.description}</strong>${item.batchNumber ? `<br><small>Batch: ${item.batchNumber}</small>` : ""}
      </td>
      <td class="text-center">${dash(item.hsnSac)}</td>
      <td class="text-center"><strong>${item.qty} ${item.unit || "Pcs"}</strong></td>
      <td class="text-right">${fmt(item.rate)}</td>
      <td class="text-center">${item.unit || "Pcs"}</td>
      <td class="text-center"></td>
      <td class="text-right bold">${fmt(item.amount)}</td>
    </tr>`).join("");

  const hsnList = Array.from(new Set(input.items.map((i) => i.hsnSac).filter(Boolean))).join(", ") || "-";
  const gstRate = input.items[0]?.gstRate ?? 18;
  const halfRate = gstRate / 2;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Tax Invoice - ${supplier.name}</title>
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: Arial, Helvetica, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    background: #e9e9e9;
    padding: 24px 0;
    display: flex;
    justify-content: center;
  }
  .sheet {
    background: #fff;
    width: 850px;
    max-width: 850px;
    border: 1.5px solid #000;
    padding: 12px;
    color: #000;
    font-size: 11px;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .bold { font-weight: bold; }

  .title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .title-row .spacer { width: 90px; }
  .main-title { font-size: 18px; font-weight: bold; text-align: center; flex: 1; }
  .sub-tag { font-size: 10px; font-weight: bold; text-align: right; width: 220px; }

  .qr-box {
    width: 80px; height: 80px; border: 1px dashed #333;
    display: flex; align-items: center; justify-content: center;
    font-size: 8px; text-align: center;
    background: repeating-linear-gradient(45deg, #eee, #eee 3px, #fff 3px, #fff 6px);
    margin: 0 auto;
  }

  .meta-table { border: none; }
  .meta-table td { border: none; padding: 2px 6px; }

  .item-table th { background: #f7f7f7; text-align: center; font-weight: bold; }
  .item-desc small { font-size: 9.5px; color: #222; }

  @media print { body { background: #fff; padding: 0; } .sheet { border: none; width: 100%; } }
</style>
</head>
<body>
<div class="sheet">

  <div class="title-row">
    <div class="spacer"></div>
    <div class="main-title">Tax Invoice</div>
    <div class="sub-tag">(DUPLICATE FOR TRANSPORTER)&nbsp;&nbsp;e-Invoice</div>
  </div>

  <table style="margin-bottom:-1px;">
    <tr>
      <td style="width:80%; line-height:1.5;">
        <strong>IRN :</strong> ${dash(input.irn)}<br>
        <strong>Ack No. :</strong> ${dash(input.ackNo)} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>Ack Date :</strong> ${input.ackDate ? formatDate(input.ackDate) : "-"}
      </td>
      <td style="width:20%; text-align:center; vertical-align:middle;">
        <div class="qr-box">e-Invoice<br>QR Code</div>
      </td>
    </tr>
  </table>

  <table style="margin-bottom:-1px;">
    <tr>
      <td style="width:50%;">
        <strong style="font-size:13px;">${supplier.name}</strong><br>
        ${supplier.address ? `${supplier.address}<br>` : ""}
        <strong>GSTIN/UIN:</strong> ${dash(supplier.gstin)}<br>
        ${supplier.email ? `<strong>E-Mail :</strong> ${supplier.email}` : ""}
      </td>
      <td style="width:50%; padding:0;">
        <table class="meta-table">
          <tr>
            <td style="width:50%; border-bottom:1px solid #000; border-right:1px solid #000;">
              <strong>Invoice No.</strong><br>${input.invoiceNumber}
            </td>
            <td style="width:50%; border-bottom:1px solid #000;">
              <strong>e-Way Bill No.</strong><br>${dash(input.ewayBillNo)}
            </td>
          </tr>
          <tr>
            <td style="border-bottom:1px solid #000; border-right:1px solid #000;">
              <strong>Delivery Note</strong><br>${dash(input.deliveryNote)}
            </td>
            <td style="border-bottom:1px solid #000;">
              <strong>Dated</strong><br>${formatDate(input.invoiceDate)}
            </td>
          </tr>
          <tr>
            <td style="border-bottom:1px solid #000; border-right:1px solid #000;">
              <strong>Reference No. &amp; Date.</strong><br>${input.invoiceNumber} dt. ${formatDate(input.invoiceDate)}
            </td>
            <td style="border-bottom:1px solid #000;">
              <strong>Mode/Terms of Payment</strong><br>${dash(input.modeOfPayment)}
            </td>
          </tr>
          <tr>
            <td style="border-right:1px solid #000;">
              <strong>Buyer's Order No.</strong><br>${dash(input.buyersOrderNo)}
            </td>
            <td>
              <strong>Dated</strong><br>-
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <table style="margin-bottom:-1px;">
    <tr>
      <td style="width:50%;">
        <strong>Consignee (Ship to)</strong><br>
        <strong>${buyer.name}</strong><br>
        ${buyer.address}<br>
        <strong>GSTIN/UIN :</strong> ${dash(buyer.gstin)}<br>
        <strong>State Name :</strong> ${dash(buyer.state)}
        <hr style="margin:5px 0; border:none; border-top:1px solid #000;">
        <strong>Buyer (Bill to)</strong><br>
        <strong>${buyer.name}</strong><br>
        ${buyer.address}<br>
        <strong>GSTIN/UIN :</strong> ${dash(buyer.gstin)}<br>
        <strong>State Name :</strong> ${dash(buyer.state)}
      </td>
      <td style="width:50%; padding:0;">
        <table class="meta-table">
          <tr>
            <td style="width:50%; border-bottom:1px solid #000; border-right:1px solid #000;">
              <strong>Dispatch Doc No.</strong><br>${dash(input.dispatchDocNo)}
            </td>
            <td style="width:50%; border-bottom:1px solid #000;">
              <strong>Delivery Note Date</strong><br>-
            </td>
          </tr>
          <tr>
            <td style="border-bottom:1px solid #000; border-right:1px solid #000;">
              <strong>Dispatched through</strong><br>${dash(input.dispatchedThrough)}
            </td>
            <td style="border-bottom:1px solid #000;">
              <strong>Destination</strong><br>${dash(input.destination)}
            </td>
          </tr>
          <tr>
            <td colspan="2">
              <strong>Terms of Delivery</strong><br>${dash(input.termsOfDelivery)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <table class="item-table" style="margin-bottom:-1px;">
    <thead>
      <tr>
        <th style="width:28px;">Sl<br>No</th>
        <th>Description of Goods</th>
        <th style="width:70px;">HSN/SAC</th>
        <th style="width:70px;">Quantity</th>
        <th style="width:75px;">Rate</th>
        <th style="width:32px;">per</th>
        <th style="width:45px;">Disc. %</th>
        <th style="width:90px;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      <tr>
        <td></td>
        <td class="text-right bold">Output CGST ${halfRate}%</td>
        <td></td><td></td>
        <td class="text-right">${halfRate} %</td>
        <td></td><td></td>
        <td class="text-right">${fmt(cgst)}</td>
      </tr>
      <tr>
        <td></td>
        <td class="text-right bold">Output SGST ${halfRate}%</td>
        <td></td><td></td>
        <td class="text-right">${halfRate} %</td>
        <td></td><td></td>
        <td class="text-right">${fmt(sgst)}</td>
      </tr>
      <tr>
        <td></td>
        <td class="bold">Total</td>
        <td></td>
        <td class="text-center bold">${totalQty} Pcs</td>
        <td></td><td></td><td></td>
        <td class="text-right bold">₹ ${fmt(input.totalAmount)}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-bottom:-1px;">
    <tr>
      <td colspan="7">
        <strong>Amount Chargeable (in words):</strong><br>
        <strong>${numberToWords(input.totalAmount)}</strong>
        <span style="float:right;" class="bold">E. &amp; O.E</span>
      </td>
    </tr>
    <tr style="background:#f7f7f7;">
      <th rowspan="2" style="width:14%;">HSN/SAC</th>
      <th rowspan="2" style="width:16%;">Taxable Value</th>
      <th colspan="2" style="width:25%;">CGST</th>
      <th colspan="2" style="width:25%;">SGST</th>
      <th rowspan="2" style="width:20%;">Total Tax Amount</th>
    </tr>
    <tr style="background:#f7f7f7;">
      <th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th>
    </tr>
    <tr>
      <td class="text-center">${hsnList}</td>
      <td class="text-right">${fmt(taxableValue)}</td>
      <td class="text-center">${halfRate}%</td>
      <td class="text-right">${fmt(cgst)}</td>
      <td class="text-center">${halfRate}%</td>
      <td class="text-right">${fmt(sgst)}</td>
      <td class="text-right bold">${fmt(totalTax)}</td>
    </tr>
    <tr class="bold">
      <td class="text-center">Total</td>
      <td class="text-right">${fmt(taxableValue)}</td>
      <td></td>
      <td class="text-right">${fmt(cgst)}</td>
      <td></td>
      <td class="text-right">${fmt(sgst)}</td>
      <td class="text-right">${fmt(totalTax)}</td>
    </tr>
    <tr>
      <td colspan="7">
        <strong>Tax Amount (in words):</strong> ${numberToWords(totalTax)}
      </td>
    </tr>
  </table>

  <table>
    <tr>
      <td style="width:60%; line-height:1.5;">
        <strong>Declaration:</strong><br>
        We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
        <br><br><br>
        <span style="font-size:10px;">This is a Computer Generated Invoice</span>
      </td>
      <td style="width:40%; text-align:right; vertical-align:bottom;">
        <strong>for ${supplier.name}</strong><br><br><br><br>
        <span>Authorised Signatory</span>
      </td>
    </tr>
  </table>

</div>
<script>window.onload = () => window.print();</script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=950,height=900");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
