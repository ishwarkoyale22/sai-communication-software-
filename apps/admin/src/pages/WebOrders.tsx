import { Fragment, useEffect, useState } from "react";
import { formatCurrency, formatDateTime, generateSimpleInvoicePdf } from "@sai/shared";
import { supabase, SHOP } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import { ShoppingBag, Search, CreditCard, ChevronDown, ChevronUp, FileText } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

interface OrderItem {
  id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  order_type: string;
  total_amount: number;
  payment_method: string;
  payment_status: string;
  order_status: string;
  notes: string | null;
  created_at: string;
  website_order_items?: OrderItem[];
}

export function WebOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrders();
    const channel = supabase
      .channel("web-orders-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "website_orders" }, loadOrders)
      .on("postgres_changes", { event: "*", schema: "public", table: "website_order_items" }, loadOrders)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadOrders() {
    try {
      setError(null);
      const { data, error: fetchErr } = await supabase
        .from("website_orders")
        .select("*, website_order_items(*)")
        .order("created_at", { ascending: false });

      if (fetchErr) {
        setError(`Failed to load orders: ${fetchErr.message}`);
        return;
      }
      setOrders((data as Order[]) ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }

  async function handlePaymentStatusChange(orderId: string, paymentStatus: string) {
    const previous = orders.find((o) => o.id === orderId)?.payment_status;
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, payment_status: paymentStatus } : o)));
    const { error: updateErr } = await supabase
      .from("website_orders")
      .update({ payment_status: paymentStatus, updated_at: new Date().toISOString() })
      .eq("id", orderId);
    if (updateErr) {
      alert(`Failed to update payment status: ${updateErr.message}`);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, payment_status: previous ?? "pending" } : o)));
    }
  }

  async function handleStatusChange(orderId: string, newStatus: string) {
    setUpdatingId(orderId);
    try {
      const { error: updateErr } = await supabase
        .from("website_orders")
        .update({ order_status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", orderId);

      if (updateErr) {
        alert(`Failed to update status: ${updateErr.message}`);
        return;
      }
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, order_status: newStatus } : o)));
    } catch (err: any) {
      alert(err?.message || "Failed to update order status");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleOrderTypeChange(orderId: string, orderType: string) {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, order_type: orderType } : o)));
    const { error: updateErr } = await supabase.from("website_orders").update({ order_type: orderType }).eq("id", orderId);
    if (updateErr) alert(`Failed to update order type: ${updateErr.message}`);
  }

  function generateBill(order: Order) {
    // Gift orders are still paid for (someone buying a hamper to send) —
    // only a true giveaway (free by definition) zeroes out the amount. Both
    // get a distinctly labeled bill from regular product orders, per the
    // requirement's "separate bill generation for gift / giveaway orders".
    const isGiveaway = order.order_type === "giveaway";
    const isGiftOrGiveaway = order.order_type === "gift" || isGiveaway;
    generateSimpleInvoicePdf({
      invoiceNumber: order.order_number,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      paymentMethod: isGiveaway ? "giveaway / no charge" : order.payment_method,
      paymentStatus: isGiveaway ? undefined : order.payment_status,
      createdAt: order.created_at,
      items: (order.website_order_items ?? []).map((i) => ({
        name: i.item_name,
        quantity: i.quantity,
        unitPrice: isGiveaway ? 0 : i.unit_price,
        totalPrice: isGiveaway ? 0 : i.total_price,
      })),
      totalAmount: isGiveaway ? 0 : order.total_amount,
      finalAmount: isGiveaway ? 0 : order.total_amount,
      shop: SHOP,
      mode: "download",
      billLabel: isGiftOrGiveaway ? (isGiveaway ? "GIVEAWAY BILL" : "GIFT ORDER BILL") : undefined,
    });
  }

  const filtered = orders.filter((o) => {
    const matchesStatus = statusFilter === "all" || o.order_status === statusFilter;
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      o.order_number?.toLowerCase().includes(q) ||
      o.customer_name?.toLowerCase().includes(q) ||
      o.customer_phone?.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const pendingCount = orders.filter((o) => o.order_status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
            <ShoppingBag className="size-5 text-gold" />
            Website Orders
            {pendingCount > 0 && <span className="pill-warning ml-1 text-xs">{pendingCount} pending</span>}
          </h1>
          <p className="text-xs text-gray-500">Live orders placed through the public storefront.</p>
        </div>
        <ExportExcelButton
          rows={filtered.map((o) => ({
            "Order #": o.order_number,
            Date: o.created_at,
            Customer: o.customer_name,
            Phone: o.customer_phone,
            Email: o.customer_email ?? "",
            Type: o.order_type,
            Total: o.total_amount,
            Status: o.order_status,
            Items: o.website_order_items?.map((i) => `${i.item_name} (x${i.quantity})`).join(", ") ?? "",
          }))}
          fileName="website-orders"
        />
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">{error}</div>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setStatusFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
              statusFilter === "all" ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All ({orders.length})
          </button>
          {STATUS_OPTIONS.map((opt) => {
            const count = orders.filter((o) => o.order_status === opt.value).length;
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  active ? "bg-brand-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {opt.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            className="input !py-1 !pl-8 text-xs"
            placeholder="Search order #, customer, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th>Order #</th>
              <th>Customer</th>
              <th>Type</th>
              <th>Items</th>
              <th>Payment</th>
              <th>Total</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">Loading website orders...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">
                  {orders.length === 0 ? "No website orders yet." : "No orders match your filter criteria."}
                </td>
              </tr>
            ) : (
              filtered.map((order) => {
                const isExpanded = expandedOrderId === order.id;
                const itemCount = order.website_order_items?.reduce((s, i) => s + i.quantity, 0) ?? 0;

                return (
                  <Fragment key={order.id}>
                    <tr className={`group hover:bg-gray-50/80 ${isExpanded ? "bg-amber-50/20" : ""}`}>
                      <td>
                        <button
                          onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                        >
                          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </button>
                      </td>
                      <td>
                        <div className="font-mono text-xs font-semibold text-gray-800">{order.order_number}</div>
                        <div className="text-[11px] text-gray-400">{formatDateTime(order.created_at)}</div>
                      </td>
                      <td>
                        <div className="font-medium text-gray-900">{order.customer_name}</div>
                        <div className="text-xs text-gray-500">{order.customer_phone}</div>
                      </td>
                      <td>
                        <select
                          className="input !w-auto !py-1 text-xs capitalize"
                          value={order.order_type}
                          onChange={(e) => handleOrderTypeChange(order.id, e.target.value)}
                        >
                          <option value="product">Product</option>
                          <option value="gift">Gift</option>
                          <option value="giveaway">Giveaway</option>
                          <option value="hamper">Hamper</option>
                          <option value="mixed">Mixed (products + hamper)</option>
                        </select>
                      </td>
                      <td>
                        <div className="text-xs font-medium text-gray-800">{itemCount} {itemCount === 1 ? "item" : "items"}</div>
                        <div className="text-[11px] text-gray-500 truncate max-w-[180px]">
                          {order.website_order_items?.map((i) => i.item_name).join(", ") || "No items"}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1 text-xs font-medium">
                          <CreditCard className="size-3 text-gray-400" />
                          <span className="capitalize">{order.payment_method}</span>
                        </div>
                        <select
                          className="input !w-auto !py-0.5 !text-[10px] capitalize"
                          value={order.payment_status}
                          title="Payment is collected at the shop — set this when the customer has paid"
                          onChange={(e) => handlePaymentStatusChange(order.id, e.target.value)}
                        >
                          <option value="pending">Pending</option>
                          <option value="partial">Partial</option>
                          <option value="paid">Paid</option>
                        </select>
                      </td>
                      <td className="font-semibold text-gray-900">{formatCurrency(order.total_amount)}</td>
                      <td>
                        <StatusPill status={order.order_status} label={order.order_status} />
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <select
                            disabled={updatingId === order.id}
                            className="input !w-auto !py-1 text-xs font-medium capitalize"
                            value={order.order_status}
                            onChange={(e) => handleStatusChange(order.id, e.target.value)}
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn-ghost !px-2 !py-1 text-xs"
                            onClick={() => generateBill(order)}
                            title={order.order_type === "product" ? "Download bill" : "Download gift/giveaway bill"}
                          >
                            <FileText size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={9} className="p-3">
                          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                            <h4 className="border-b pb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                              Order Line Items ({order.order_number})
                            </h4>
                            <div className="divide-y divide-gray-100">
                              {order.website_order_items?.map((item) => (
                                <div key={item.id} className="flex items-center justify-between py-2 text-xs">
                                  <div>
                                    <div className="font-medium text-gray-800">{item.item_name}</div>
                                    <div className="text-gray-400">Qty: {item.quantity} × {formatCurrency(item.unit_price)}</div>
                                  </div>
                                  <div className="font-semibold text-gray-900">{formatCurrency(item.total_price)}</div>
                                </div>
                              ))}
                            </div>
                            <div className="flex justify-between border-t pt-2 text-xs font-bold">
                              <span>Total Amount:</span>
                              <span className="text-gold">{formatCurrency(order.total_amount)}</span>
                            </div>
                            {order.notes && (
                              <div className="rounded bg-gray-50 p-2.5 text-xs text-gray-600">
                                <span className="font-semibold text-gray-700">Notes: </span>
                                {order.notes}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
