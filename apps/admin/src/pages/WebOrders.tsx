import { useEffect, useState } from "react";
import { formatCurrency, formatDateTime, type WebOrder, type WebOrderStatus } from "@sai/shared";
import { supabase } from "../lib/supabase";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { StatusPill } from "../components/StatusPill";
import {
  ShoppingBag,
  Search,
  Truck,
  Store,
  CreditCard,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const STATUS_OPTIONS: { value: WebOrderStatus; label: string; tone: string }[] = [
  { value: "pending", label: "Pending", tone: "warning" },
  { value: "confirmed", label: "Confirmed", tone: "info" },
  { value: "processing", label: "Processing", tone: "info" },
  { value: "ready", label: "Ready", tone: "success" },
  { value: "delivered", label: "Delivered", tone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "danger" },
];

export function WebOrders() {
  const [orders, setOrders] = useState<WebOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | WebOrderStatus>("all");
  const [search, setSearch] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrders();

    // Subscribe to realtime changes on orders and payments
    const channel = supabase
      .channel("web-orders-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        loadOrders();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        loadOrders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadOrders() {
    try {
      setError(null);
      const { data, error: fetchErr } = await supabase
        .from("orders")
        .select("*, order_items(*), payments(*)")
        .order("created_at", { ascending: false });

      if (fetchErr) {
        console.error("Error fetching web orders:", fetchErr);
        setError(`Failed to load orders: ${fetchErr.message}`);
        return;
      }

      setOrders((data as WebOrder[]) ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(orderId: string, newStatus: WebOrderStatus) {
    setUpdatingId(orderId);
    try {
      const { error: updateErr } = await supabase
        .from("orders")
        .update({
          order_status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (updateErr) {
        alert(`Failed to update status: ${updateErr.message}`);
        return;
      }

      // Optimistically update local state
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, order_status: newStatus } : o))
      );
    } catch (err: any) {
      alert(err?.message || "Failed to update order status");
    } finally {
      setUpdatingId(null);
    }
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
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
            <ShoppingBag className="size-5 text-gold" />
            Website Orders
            {pendingCount > 0 && (
              <span className="pill-warning ml-1 text-xs">{pendingCount} pending</span>
            )}
          </h1>
          <p className="text-xs text-gray-500">
            Live orders placed through the public storefront. Update statuses to notify fulfillment.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ExportExcelButton
            rows={filtered.map((o) => ({
              "Order #": o.order_number,
              Date: o.created_at,
              Customer: o.customer_name,
              Phone: o.customer_phone,
              Email: o.customer_email ?? "",
              Address: o.customer_address ?? "",
              Delivery: o.delivery_type,
              "Payment Type": o.payment_type,
              Total: o.total_amount,
              Status: o.order_status,
              Items: o.order_items?.map((i) => `${i.name} (x${i.quantity})`).join(", ") ?? "",
            }))}
            fileName="website-orders"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-brand-danger">
          {error}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Status Filter Buttons */}
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

        {/* Search */}
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

      {/* Orders Table */}
      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th>Order #</th>
              <th>Customer</th>
              <th>Delivery</th>
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
                <td colSpan={9} className="py-8 text-center text-gray-400">
                  Loading website orders...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">
                  {orders.length === 0
                    ? "No website orders yet. When customers checkout on the website, orders appear here."
                    : "No orders match your filter criteria."}
                </td>
              </tr>
            ) : (
              filtered.map((order) => {
                const isExpanded = expandedOrderId === order.id;
                const itemCount = order.order_items?.reduce((s, i) => s + i.quantity, 0) ?? 0;
                const payment = order.payments?.[0];

                return (
                  <>
                    <tr
                      key={order.id}
                      className={`group hover:bg-gray-50/80 ${isExpanded ? "bg-amber-50/20" : ""}`}
                    >
                      <td>
                        <button
                          onClick={() =>
                            setExpandedOrderId(isExpanded ? null : order.id)
                          }
                          className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                          title="Toggle line items"
                        >
                          {isExpanded ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                        </button>
                      </td>

                      <td>
                        <div className="font-mono text-xs font-semibold text-gray-800">
                          {order.order_number}
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {formatDateTime(order.created_at)}
                        </div>
                      </td>

                      <td>
                        <div className="font-medium text-gray-900">{order.customer_name}</div>
                        <div className="text-xs text-gray-500">{order.customer_phone}</div>
                        {order.customer_email && (
                          <div className="text-[11px] text-gray-400 truncate max-w-[150px]">
                            {order.customer_email}
                          </div>
                        )}
                      </td>

                      <td>
                        <div className="flex items-center gap-1 text-xs">
                          {order.delivery_type === "delivery" ? (
                            <>
                              <Truck className="size-3.5 text-blue-600" />
                              <span className="capitalize">Home Delivery</span>
                            </>
                          ) : (
                            <>
                              <Store className="size-3.5 text-amber-600" />
                              <span className="capitalize">Store Pickup</span>
                            </>
                          )}
                        </div>
                        {order.customer_address && (
                          <div
                            className="text-[11px] text-gray-400 truncate max-w-[160px]"
                            title={order.customer_address}
                          >
                            {order.customer_address}
                          </div>
                        )}
                      </td>

                      <td>
                        <div className="text-xs font-medium text-gray-800">
                          {itemCount} {itemCount === 1 ? "item" : "items"}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate max-w-[180px]">
                          {order.order_items?.map((i) => i.name).join(", ") || "No items"}
                        </div>
                      </td>

                      <td>
                        <div className="flex items-center gap-1 text-xs font-medium">
                          <CreditCard className="size-3 text-gray-400" />
                          <span className="uppercase">{order.payment_type}</span>
                        </div>
                        {order.payment_type === "emi" && order.finance_monthly_emi && (
                          <div className="text-[11px] text-brand-primary">
                            ~{formatCurrency(order.finance_monthly_emi)}/mo ({order.finance_tenure}m)
                          </div>
                        )}
                        {payment && (
                          <div className="text-[10px] text-gray-400 capitalize">
                            Method: {payment.payment_method} ({payment.payment_status})
                          </div>
                        )}
                      </td>

                      <td>
                        <div className="font-semibold text-gray-900">
                          {formatCurrency(order.total_amount)}
                        </div>
                      </td>

                      <td>
                        <StatusPill status={order.order_status} label={order.order_status} />
                      </td>

                      <td>
                        <div className="flex items-center gap-1.5">
                          <select
                            disabled={updatingId === order.id}
                            className="input !w-auto !py-1 text-xs font-medium capitalize"
                            value={order.order_status}
                            onChange={(e) =>
                              handleStatusChange(
                                order.id,
                                e.target.value as WebOrderStatus
                              )
                            }
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                    </tr>

                    {/* Expandable Order Items Breakdown */}
                    {isExpanded && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={9} className="p-3">
                          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                            <div className="flex items-center justify-between border-b pb-2">
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                                Order Line Items ({order.order_number})
                              </h4>
                              <span className="text-xs text-gray-500">
                                Delivery: <span className="font-medium text-gray-800 capitalize">{order.delivery_type}</span>
                              </span>
                            </div>

                            <div className="divide-y divide-gray-100">
                              {order.order_items?.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between py-2 text-xs"
                                >
                                  <div>
                                    <div className="font-medium text-gray-800">
                                      {item.name}
                                    </div>
                                    <div className="text-gray-400">
                                      Qty: {item.quantity} × {formatCurrency(item.unit_price)}
                                    </div>
                                  </div>
                                  <div className="font-semibold text-gray-900">
                                    {formatCurrency(item.total_price)}
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="flex justify-between border-t pt-2 text-xs font-bold">
                              <span>Total Amount:</span>
                              <span className="text-gold">{formatCurrency(order.total_amount)}</span>
                            </div>

                            {order.customer_address && (
                              <div className="rounded bg-gray-50 p-2.5 text-xs text-gray-600">
                                <span className="font-semibold text-gray-700">Full Shipping Address: </span>
                                {order.customer_address}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
