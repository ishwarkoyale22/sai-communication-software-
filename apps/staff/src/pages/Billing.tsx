import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { formatCurrency, type Product, type Customer, type FinancePartner, type PaymentMethod } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { useStaffAuth } from "../context/StaffAuthContext";
import { Camera, Search, Trash2, X, AlertTriangle } from "lucide-react";

interface CartLine {
  product: Product;
  qty: number;
}

export function Billing() {
  const { staff } = useStaffAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const [saleType, setSaleType] = useState<"" | "online" | "offline">("offline");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [gstApplicable, setGstApplicable] = useState(false);
  const [gstNumber, setGstNumber] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [interstate, setInterstate] = useState(false); // false = CGST+SGST, true = IGST
  const [hsnSac, setHsnSac] = useState("");
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [partners, setPartners] = useState<FinancePartner[]>([]);
  const [financePartnerId, setFinancePartnerId] = useState("");
  const [emiMonths, setEmiMonths] = useState(0);
  const [staffNotes, setStaffNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [customerNoteText, setCustomerNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);

  useEffect(() => {
    supabase.from("finance_partners").select("*").then(({ data }) => setPartners(data ?? []));
  }, []);

  async function search(text: string) {
    setQuery(text);
    if (!text) return setResults([]);
    const { data } = await supabase
      .from("products")
      .select("*")
      .or(`name.ilike.%${text}%,barcode.eq.${text},buyer_code.eq.${text}`)
      .limit(8);
    setResults(data ?? []);
  }

  function addToCart(p: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing) return prev.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { product: p, qty: 1 }];
    });
    setQuery("");
    setResults([]);
  }

  function setQty(id: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, qty: Math.max(1, qty) } : l)));
  }

  function removeLine(id: string) {
    setCart((prev) => prev.filter((l) => l.product.id !== id));
  }

  async function startScan() {
    setScanning(true);
    setTimeout(async () => {
      const scanner = new Html5Qrcode("barcode-reader");
      scannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 220 },
          async (decodedText) => {
            await stopScan();
            const { data } = await supabase.from("products").select("*").eq("barcode", decodedText).maybeSingle();
            if (data) addToCart(data);
          },
          undefined
        );
      } catch {
        setScanning(false);
      }
    }, 100);
  }

  async function stopScan() {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        /* ignore */
      }
    }
    setScanning(false);
  }

  async function lookupPhone() {
    if (!phone.trim()) return;
    const { data } = await supabase.from("customers").select("*").eq("phone", phone.trim()).maybeSingle();
    setCustomer(data ?? null);
    setCustomerName(data?.name ?? "");
    setNoteSaved(false);
  }

  async function addCustomerNote() {
    if (!staff || !customer || !customerNoteText.trim()) return;
    await supabase.from("customer_notes").insert({
      customer_id: customer.id,
      staff_id: staff.id,
      note: customerNoteText.trim(),
    });
    setCustomerNoteText("");
    setNoteSaved(true);
  }

  const total = cart.reduce((sum, l) => sum + l.qty * l.product.sale_price, 0);
  const purchaseTotal = cart.reduce((sum, l) => sum + l.qty * l.product.purchase_price, 0);
  const canConfirm = cart.length > 0 && saleType && staff;

  async function confirmSale() {
    if (!canConfirm || !staff) return;
    setConfirming(true);

    let customerId = customer?.id ?? null;
    if (!customerId && phone && customerName) {
      const { data: newCust } = await supabase
        .from("customers")
        .insert({ name: customerName.trim(), phone: phone.trim() })
        .select()
        .single();
      customerId = newCust?.id ?? null;
    }

    const { data: invNumber } = await supabase.rpc("next_invoice_number");
    const emiAmount = financePartnerId && emiMonths ? total / emiMonths : null;

    const lineBreakdowns = cart.map((l) => {
      const lineTotal = l.qty * l.product.sale_price;
      if (!gstApplicable) {
        return { line: l, lineTotal, taxable: lineTotal, cgst: 0, sgst: 0, igst: 0 };
      }
      const taxable = lineTotal / (1 + gstRate / 100);
      const gstAmount = lineTotal - taxable;
      return {
        line: l,
        lineTotal,
        taxable,
        cgst: interstate ? 0 : gstAmount / 2,
        sgst: interstate ? 0 : gstAmount / 2,
        igst: interstate ? gstAmount : 0,
      };
    });
    const taxableValue = lineBreakdowns.reduce((s, b) => s + b.taxable, 0);
    const cgstTotal = lineBreakdowns.reduce((s, b) => s + b.cgst, 0);
    const sgstTotal = lineBreakdowns.reduce((s, b) => s + b.sgst, 0);
    const igstTotal = lineBreakdowns.reduce((s, b) => s + b.igst, 0);

    const { data: sale, error } = await supabase
      .from("sales")
      .insert({
        invoice_number: invNumber || `INV-${Date.now().toString().slice(-6)}`,
        customer_id: customerId,
        staff_id: staff.id,
        sale_type: saleType,
        payment_method: paymentMethod,
        total_amount: total,
        purchase_total: purchaseTotal,
        gst_applicable: gstApplicable,
        gst_number: gstApplicable ? gstNumber : null,
        taxable_value: taxableValue,
        cgst_total: cgstTotal,
        sgst_total: sgstTotal,
        igst_total: igstTotal,
        finance_partner_id: financePartnerId || null,
        emi_months: financePartnerId ? emiMonths : null,
        emi_amount: financePartnerId ? emiAmount : null,
        staff_notes: staffNotes || null,
      })
      .select()
      .single();

    if (error || !sale) {
      setConfirming(false);
      alert(error?.message ?? "Failed to create sale");
      return;
    }

    await supabase.from("sale_items").insert(
      lineBreakdowns.map(({ line: l, cgst, sgst, igst }) => ({
        sale_id: sale.id,
        product_id: l.product.id,
        qty: l.qty,
        unit_price: l.product.sale_price,
        purchase_price: l.product.purchase_price,
        gst_rate: gstApplicable ? gstRate : 0,
        hsn_sac: gstApplicable ? hsnSac || null : null,
        cgst,
        sgst,
        igst,
      }))
    );

    setConfirming(false);
    setDone(sale.invoice_number);
    setCart([]);
    setSaleType("offline");
    setPaymentMethod("cash");
    setGstApplicable(false);
    setGstNumber("");
    setGstRate(18);
    setInterstate(false);
    setHsnSac("");
    setPhone("");
    setCustomer(null);
    setCustomerName("");
    setFinancePartnerId("");
    setEmiMonths(0);
    setStaffNotes("");
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl">✅</div>
        <p className="mt-3 text-lg font-semibold">Sale complete!</p>
        <p className="text-sm text-gray-500 font-mono">Invoice #{done}</p>
        <button className="btn-primary mt-6" onClick={() => setDone(null)}>
          Start New Sale
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-800">New Sale</h1>

      {/* Sale type toggle */}
      <div className="grid grid-cols-2 gap-2">
        {(["offline", "online"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSaleType(t)}
            className={`rounded-md border py-2 text-sm font-medium capitalize transition-colors ${
              saleType === t ? "border-brand-primary bg-brand-primary/10 text-brand-primary font-semibold" : "border-gray-300 text-gray-500"
            }`}
          >
            {t} sale
          </button>
        ))}
      </div>

      {/* Product search + scan */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-3 text-gray-400" size={16} />
            <input
              className="input pl-9 w-full"
              placeholder="Search name, barcode, SKU..."
              value={query}
              onChange={(e) => search(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={startScan}>
            <Camera size={16} />
          </button>
        </div>
        {results.length > 0 && (
          <div className="card absolute z-10 mt-1 w-full max-h-56 overflow-y-auto shadow-lg">
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-gray-50 border-b border-border last:border-0"
              >
                <div>
                  <div className="font-medium text-gray-800">{p.name}</div>
                  <div className="text-xs text-gray-400 font-mono">{p.sku || p.barcode || "No SKU"}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-gray-800">{formatCurrency(p.sale_price)}</div>
                  <div className={`text-xs ${p.stock_qty <= p.min_stock_alert ? "text-brand-danger font-medium" : "text-gray-500"}`}>
                    {p.stock_qty} in stock
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {scanning && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-black/80 p-6">
          <div id="barcode-reader" className="w-full max-w-sm overflow-hidden rounded-lg" />
          <button className="btn-secondary mt-4" onClick={stopScan}>
            <X size={14} /> Cancel
          </button>
        </div>
      )}

      {/* Cart */}
      <div className="card divide-y divide-border">
        {cart.map((l) => {
          const isOverStock = l.qty > l.product.stock_qty;
          return (
            <div key={l.product.id} className="p-3 space-y-1">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-800">{l.product.name}</div>
                  <div className="text-xs text-gray-500">{formatCurrency(l.product.sale_price)} each</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    className="w-14 rounded border border-gray-300 px-1 py-1 text-center text-sm font-medium"
                    value={l.qty}
                    onChange={(e) => setQty(l.product.id, Number(e.target.value))}
                  />
                  <button onClick={() => removeLine(l.product.id)} className="text-brand-danger p-1">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {isOverStock && (
                <div className="flex items-center gap-1 text-[11px] text-amber-600 font-medium">
                  <AlertTriangle size={12} />
                  <span>Warning: Stock is {l.product.stock_qty} (order qty is {l.qty})</span>
                </div>
              )}
            </div>
          );
        })}
        {cart.length === 0 && <p className="p-4 text-center text-sm text-gray-400">Cart is empty. Search products above to add items.</p>}
      </div>

      {/* Customer lookup */}
      <div className="card space-y-2 p-3">
        <div className="text-xs font-semibold uppercase text-gray-400">Customer Details</div>
        <div className="flex gap-2">
          <input
            className="input w-full font-mono"
            placeholder="Customer Phone (10 digits)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={lookupPhone}
          />
        </div>
        {phone && !customer && (
          <input
            className="input w-full"
            placeholder="Customer Name (for new customer)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        )}
        {customer && (
          <>
            <p className="text-sm text-brand-success font-medium">✓ Found: {customer.name}</p>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Add note for customer profile..."
                value={customerNoteText}
                onChange={(e) => {
                  setCustomerNoteText(e.target.value);
                  setNoteSaved(false);
                }}
              />
              <button className="btn-secondary text-xs" onClick={addCustomerNote} disabled={!customerNoteText.trim()}>
                Save
              </button>
            </div>
            {noteSaved && <p className="text-xs text-brand-success">Note saved on customer profile.</p>}
          </>
        )}
      </div>

      {/* Payment Method */}
      <div className="card space-y-2 p-3">
        <div className="text-xs font-semibold uppercase text-gray-400">Payment Method</div>
        <div className="grid grid-cols-4 gap-1.5">
          {(["cash", "upi", "card", "bank_transfer"] as PaymentMethod[]).map((pm) => (
            <button
              key={pm}
              type="button"
              onClick={() => setPaymentMethod(pm)}
              className={`rounded border py-1.5 text-xs font-medium uppercase transition-colors ${
                paymentMethod === pm
                  ? "border-brand-primary bg-brand-primary text-white font-semibold"
                  : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              {pm === "bank_transfer" ? "Bank" : pm}
            </button>
          ))}
        </div>
      </div>

      {/* GST */}
      <div className="card space-y-2 p-3">
        <label className="flex items-center justify-between text-sm cursor-pointer">
          <span className="font-medium text-gray-700">GST Invoice</span>
          <input type="checkbox" checked={gstApplicable} onChange={(e) => setGstApplicable(e.target.checked)} className="rounded text-brand-primary" />
        </label>
        {gstApplicable && (
          <div className="space-y-2 pt-1 border-t border-border">
            <input className="input w-full font-mono text-xs" placeholder="Customer GSTIN" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} />
            <div className="flex gap-2">
              <input
                type="number"
                className="input w-24 text-center"
                placeholder="GST %"
                value={gstRate}
                onChange={(e) => setGstRate(Number(e.target.value))}
              />
              <input className="input flex-1 font-mono text-xs" placeholder="HSN/SAC code (optional)" value={hsnSac} onChange={(e) => setHsnSac(e.target.value)} />
            </div>
            <label className="flex items-center justify-between text-xs text-gray-600 cursor-pointer pt-1">
              <span>Interstate Sale (IGST instead of CGST+SGST)</span>
              <input type="checkbox" checked={interstate} onChange={(e) => setInterstate(e.target.checked)} className="rounded text-brand-primary" />
            </label>
          </div>
        )}
      </div>

      {/* Finance Partner */}
      <div className="card space-y-2 p-3">
        <div className="text-xs font-semibold uppercase text-gray-400">Finance & EMI (optional)</div>
        <select className="input w-full" value={financePartnerId} onChange={(e) => setFinancePartnerId(e.target.value)}>
          <option value="">No Finance (Direct Payment)</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {financePartnerId && (
          <input
            type="number"
            className="input w-full"
            placeholder="EMI tenure in months (e.g. 6, 9, 12)"
            value={emiMonths || ""}
            onChange={(e) => setEmiMonths(Number(e.target.value))}
          />
        )}
      </div>

      <textarea
        className="input w-full text-xs"
        placeholder="Staff notes for this transaction (optional)..."
        value={staffNotes}
        onChange={(e) => setStaffNotes(e.target.value)}
        rows={2}
      />

      <div className="card flex items-center justify-between p-3 bg-gray-50 border-brand-primary/30">
        <span className="text-sm text-gray-600 font-medium">Grand Total</span>
        <span className="text-2xl font-bold text-gray-900">{formatCurrency(total)}</span>
      </div>

      <button
        disabled={!canConfirm || confirming}
        className="btn-primary w-full py-3 text-base font-semibold shadow-md disabled:opacity-50"
        onClick={confirmSale}
      >
        {confirming ? "Processing Sale..." : `Confirm Sale (${formatCurrency(total)})`}
      </button>
    </div>
  );
}
