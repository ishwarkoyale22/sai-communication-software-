import { markNavigation } from "@sai/shared";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { SmoothScroll } from "./SmoothScroll";
import { supabase } from "../lib/supabase";
import {
  LayoutDashboard,
  Package,
  Receipt,
  Users,
  Wrench,
  Gift,
  ShoppingBag,
  Undo2,
  CreditCard,
  UserCog,
  ListChecks,
  FileUp,
  BarChart3,
  LogOut,
  MessageSquareText,
  FileText,
  Star,
  Tag,
  Wallet,
  Wand2,
  Smile,
  Handshake,
  Truck,
  Building2,
  Image,
  Cake,
  Settings as SettingsIcon,
  Menu,
  X,
  Search,
  ArrowLeftRight,
  DatabaseBackup,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { NotificationBell } from "./NotificationBell";

const NAV_GROUPS: {
  label: string;
  items: { to: string; label: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Sell",
    items: [
      { to: "/inventory", label: "Inventory", icon: Package },
      { to: "/imei-search", label: "IMEI / Serial Search", icon: Search },
      { to: "/sales", label: "Sales & Invoices", icon: Receipt },
      { to: "/payments", label: "Payment Management", icon: Wallet },
      { to: "/all-transactions", label: "All Transactions", icon: ArrowLeftRight },
      { to: "/web-orders", label: "Website Orders", icon: ShoppingBag },
      { to: "/return-requests", label: "Return Requests", icon: Undo2 },
      { to: "/gift-hampers", label: "Gift Hampers", icon: Gift },
      { to: "/gifts", label: "Gifts", icon: Sparkles },
      { to: "/brands", label: "Brands", icon: Tag },
      { to: "/services", label: "Service Management", icon: Wand2 },
      { to: "/offers", label: "Offers", icon: Tag },
      { to: "/gallery", label: "Gallery", icon: Image },
    ],
  },
  {
    label: "People",
    items: [
      { to: "/customers", label: "Customers", icon: Users },
      { to: "/birthdays", label: "Birthday Reminders", icon: Cake },
      { to: "/enquiries", label: "Enquiries", icon: MessageSquareText },
      { to: "/client-reports", label: "Client Reports", icon: FileText },
      { to: "/finance-reports", label: "Finance Reports", icon: FileText },
      { to: "/reviews", label: "Reviews", icon: Star },
      { to: "/staff", label: "Staff", icon: UserCog },
      { to: "/staff-portal", label: "Staff Portal", icon: ListChecks },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/repair-enquiries", label: "Repair Enquiries", icon: MessageSquareText },
      { to: "/repairs", label: "Repairs", icon: Wrench },
      { to: "/service-feedback", label: "Service Feedback", icon: Smile },
      { to: "/wholesaler-invoices", label: "Wholesaler Invoices", icon: FileUp },
      { to: "/third-party-purchases", label: "Third-Party Purchases", icon: ShoppingBag },
      { to: "/finance", label: "Finance / EMI", icon: CreditCard },
      { to: "/finance-partners", label: "Finance Partners", icon: Handshake },
      { to: "/suppliers", label: "Suppliers", icon: Truck },
      { to: "/branches", label: "Branches", icon: Building2 },
    ],
  },
  {
    label: "Insights",
    items: [{ to: "/analytics", label: "Analytics", icon: BarChart3 }],
  },
  {
    label: "Configuration",
    items: [
      { to: "/settings", label: "Settings", icon: SettingsIcon },
      { to: "/backup", label: "Backup & Restore", icon: DatabaseBackup },
    ],
  },
];

export function Layout() {
  const { signOut } = useAuth();
  const location = useLocation();
  // Sidebar is a static column on large screens (lg+) and an off-canvas
  // drawer below that — closed by default so a phone/tablet load doesn't
  // start with a full-height overlay covering the page.
  const [navOpen, setNavOpen] = useState(false);
  const bumpedThisVisit = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const mainContentRef = useRef<HTMLDivElement | null>(null);

  // Unread admin notifications counted per sidebar section (by the path in
  // each notification's link). Opening a section marks its alerts as read.
  const [unreadByPath, setUnreadByPath] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    async function loadUnread() {
      const { data } = await supabase
        .from("notifications")
        .select("id, link")
        .eq("for_admin", true)
        .eq("is_read", false)
        .not("link", "is", null);
      if (!alive) return;
      const by: Record<string, number> = {};
      for (const n of (data as { link: string }[]) ?? []) {
        const path = n.link.split("?")[0];
        by[path] = (by[path] ?? 0) + 1;
      }
      setUnreadByPath(by);
    }
    loadUnread();
    const channel = supabase
      .channel("admin-sidebar-badges")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: "for_admin=eq.true" }, loadUnread)
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, []);
  useEffect(() => {
    const path = location.pathname;
    if (!unreadByPath[path]) return;
    setUnreadByPath((prev) => ({ ...prev, [path]: 0 }));
    supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("for_admin", true)
      .eq("is_read", false)
      .like("link", `${path}%`)
      .then(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, unreadByPath]);

  // Close the drawer automatically on navigation, so tapping a link doesn't
  // leave the overlay sitting open behind the new page.
  useEffect(() => {
    setNavOpen(false);
    bumpedThisVisit.current = false;
    markNavigation(); // lets the data cache answer this page's reads instantly
  }, [location.pathname]);

  // When the quiet background refresh finds newer data than what was shown instantly,
  // re-render the page once with it - unless the user has started typing or opened a dialog.
  const [dataRev, setDataRev] = useState(0);
  useEffect(() => {
    const onRefreshed = () => {
      const el = document.activeElement;
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (typing || document.querySelector("main .fixed")) return;
      if (bumpedThisVisit.current) return; // once per page visit, never a refresh loop
      bumpedThisVisit.current = true;
      setDataRev((n) => n + 1);
    };
    window.addEventListener("sai-data-refreshed", onRefreshed);
    return () => window.removeEventListener("sai-data-refreshed", onRefreshed);
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-page">
      {/* Backdrop — mobile/tablet only, closes the drawer on tap */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] max-w-[82vw] shrink-0 flex-col overflow-hidden text-sidebarTextMuted transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-sidebar lg:max-w-none lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "linear-gradient(165deg, #2A1420 0%, #1F3A8A 140%)" }}
      >
        {/* Cream Luxe glossy sheen — a soft top-to-bottom highlight over the wine-to-blue gradient */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.09), transparent 40%)" }}
        />
        {/* Gold + a hint of brand-blue glow, confined to the header strip —
            jewel tones against the wine base instead of a flat panel. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[150px] overflow-hidden">
          <div
            className="absolute -left-10 -top-[70px] h-[200px] w-[200px] rounded-full blur-[6px]"
            style={{ background: "radial-gradient(circle, rgba(201,151,90,0.3), transparent 70%)" }}
          />
          <div
            className="absolute -right-[70px] -top-2.5 h-[190px] w-[190px] rounded-full blur-[6px]"
            style={{ background: "radial-gradient(circle, rgba(31,58,138,0.24), transparent 70%)" }}
          />
        </div>

        <div className="relative flex h-topbar items-center justify-between gap-2.5 px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/logo-mark.png" alt="Sai Communication" className="h-9 w-9 shrink-0 rounded-full shadow-sm" />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-serif text-sm font-semibold text-white">Sai Communication</span>
              <span className="text-[10px] uppercase tracking-wider text-gold/70">Admin Portal</span>
            </div>
          </div>
          <button
            onClick={() => setNavOpen(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebarTextMuted hover:bg-sidebarHover hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Thin repeating gold medallion band — a quiet divider between the
            header and nav, nodding to the storefront's medallion-ring motif. */}
        <div
          className="relative mx-0 mb-2 h-[22px] shrink-0"
          style={{
            maskImage: "linear-gradient(90deg, transparent 0, #000 14%, #000 86%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 14%, #000 86%, transparent 100%)",
          }}
        >
          <svg width="260" height="22" viewBox="0 0 260 22" className="block">
            <defs>
              <pattern id="sidebar-medallion" width="26" height="22" patternUnits="userSpaceOnUse">
                <path d="M13 3 L19 11 L13 19 L7 11 Z" fill="none" stroke="#C9975A" strokeWidth="1" opacity="0.4" />
              </pattern>
            </defs>
            <rect width="260" height="22" fill="url(#sidebar-medallion)" />
          </svg>
        </div>

        <nav className="relative flex-1 overflow-y-auto px-2 py-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebarLabel">
                {group.label}
              </div>
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `relative flex items-center gap-2 overflow-hidden rounded-md border-l-2 px-2 py-2 text-sm transition-colors lg:py-1.5 ${
                      isActive
                        ? "border-transparent font-semibold text-sidebar shadow-[0_6px_14px_-4px_rgba(201,151,90,0.6)]"
                        : "border-transparent text-sidebarTextMuted hover:bg-sidebarHover hover:text-white"
                    }`
                  }
                  style={({ isActive }) =>
                    isActive ? { background: "linear-gradient(180deg, #E3B876, #C9975A)" } : undefined
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-md bg-gradient-to-b from-white/40 to-transparent" />
                      )}
                      <Icon size={16} className="relative" />
                      <span className="relative flex-1">{label}</span>
                      {(unreadByPath[to] ?? 0) > 0 && (
                        <span className="relative flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white shadow">
                          {unreadByPath[to] > 99 ? "99+" : unreadByPath[to]}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <button
          onClick={() => signOut()}
          className="relative m-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebarFooter transition-colors hover:bg-sidebarHover hover:text-white"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-topbar shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-5"
          style={{ background: "linear-gradient(180deg, #FFFFFF, #FBF7F2)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={() => setNavOpen(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-gray-600 hover:border-gold hover:text-gold lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            <div className="truncate font-serif text-sm font-medium text-gray-700">Admin Portal</div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm"
              style={{ background: "linear-gradient(155deg, #2A1420, #1F3A8A)", color: "#F5D9A8" }}
            >
              SC
            </div>
          </div>
        </header>
        <main ref={mainRef} className="flex-1 overflow-y-auto p-3 sm:p-5">
          <div ref={mainContentRef}>
            <Outlet key={dataRev} />
          </div>
        </main>
        <SmoothScroll wrapperRef={mainRef} contentRef={mainContentRef} />
      </div>
    </div>
  );
}
