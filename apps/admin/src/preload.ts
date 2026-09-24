// Route code is split into one chunk per page (see App.tsx). Without help, a page's chunk only starts
// downloading AFTER the admin check finishes and the route renders, so every page load was:
//   app code -> admin check -> page code -> data.
// These loaders let us start the page code download immediately (in parallel with the admin check) and
// warm the commonly used pages while the app is idle, so moving between them is instant.
// Import paths must match App.tsx so the bundler reuses the same chunks.
const pages: Record<string, () => Promise<unknown>> = {
  "/": () => import("./pages/Dashboard"),
  "/inventory": () => import("./pages/Inventory"),
  "/sales": () => import("./pages/Sales"),
  "/web-orders": () => import("./pages/WebOrders"),
  "/customers": () => import("./pages/Customers"),
  "/repairs": () => import("./pages/Repairs"),
  "/repair-enquiries": () => import("./pages/RepairEnquiries"),
  "/enquiries": () => import("./pages/Enquiries"),
  "/finance": () => import("./pages/Finance"),
  "/payments": () => import("./pages/Payments"),
  "/all-transactions": () => import("./pages/AllTransactions"),
  "/gift-hampers": () => import("./pages/GiftHampers"),
  "/gifts": () => import("./pages/Gifts"),
  "/reviews": () => import("./pages/Reviews"),
  "/staff": () => import("./pages/StaffManagement"),
  "/return-requests": () => import("./pages/ReturnRequests"),
  // Staff portal (mobile app)
  "/portal": () => import("./staff/pages/Home"),
  "/portal/sales": () => import("./staff/pages/Home"),
  "/portal/technician": () => import("./staff/pages/Home"),
  "/portal/reception": () => import("./staff/pages/Home"),
  "/portal/new-sale": () => import("./staff/pages/NewSale"),
  "/portal/repairs": () => import("./staff/pages/Repairs"),
  "/portal/clients": () => import("./staff/pages/Clients"),
  "/portal/follow-ups": () => import("./staff/pages/FollowUps"),
  "/portal/attendance": () => import("./staff/pages/Attendance"),
  "/portal/tasks": () => import("./staff/pages/Tasks"),
  "/portal/products": () => import("./staff/pages/ProductsView"),
  "/portal/orders": () => import("./staff/pages/OrdersView"),
  "/portal/repair-intake": () => import("./staff/pages/RepairIntake"),
  "/portal/enquiries": () => import("./staff/pages/Enquiries"),
};

// Pages worth having ready after the first screen. Deliberately excludes the heavy, rarely used ones
// (Analytics, Backup) so idle prefetching never competes with what the person is actually doing.
const WARM_STAFF = ["/portal/new-sale", "/portal/repairs", "/portal/clients", "/portal/follow-ups", "/portal/attendance", "/portal/tasks"];
const WARM = ["/sales", "/inventory", "/web-orders", "/customers", "/repairs", "/payments", "/finance", "/"];

export function preloadCurrentRoute() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  pages[path]?.().catch(() => undefined);
}

export function warmCommonPages() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/login")) return; // nothing to warm before sign-in
  const list = path.startsWith("/portal") ? WARM_STAFF : WARM;
  const run = () => {
    list.forEach((route, i) => {
      if (route === path) return;
      window.setTimeout(() => pages[route]?.().catch(() => undefined), i * 250);
    });
  };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else window.setTimeout(run, 2000);
}
