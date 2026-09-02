import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Receipt,
  Users,
  Wrench,
  Gift,
  ShoppingBag,
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
  Wand2,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

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
      { to: "/sales", label: "Sales & Invoices", icon: Receipt },
      { to: "/web-orders", label: "Website Orders", icon: ShoppingBag },
      { to: "/gift-hampers", label: "Gift Hampers", icon: Gift },
      { to: "/brands", label: "Brands", icon: Tag },
      { to: "/services", label: "Service Management", icon: Wand2 },
    ],
  },
  {
    label: "People",
    items: [
      { to: "/customers", label: "Customers", icon: Users },
      { to: "/enquiries", label: "Enquiries", icon: MessageSquareText },
      { to: "/client-reports", label: "Client Reports", icon: FileText },
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
      { to: "/wholesaler-invoices", label: "Wholesaler Invoices", icon: FileUp },
      { to: "/third-party-purchases", label: "Third-Party Purchases", icon: ShoppingBag },
      { to: "/emi", label: "EMI / Finance", icon: CreditCard },
    ],
  },
  {
    label: "Insights",
    items: [{ to: "/analytics", label: "Analytics", icon: BarChart3 }],
  },
];

export function Layout() {
  const { signOut } = useAuth();
  const location = useLocation();
  // Sidebar is a static column on large screens (lg+) and an off-canvas
  // drawer below that — closed by default so a phone/tablet load doesn't
  // start with a full-height overlay covering the page.
  const [navOpen, setNavOpen] = useState(false);

  // Close the drawer automatically on navigation, so tapping a link doesn't
  // leave the overlay sitting open behind the new page.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

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
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] max-w-[82vw] shrink-0 flex-col overflow-hidden bg-sidebar text-sidebarTextMuted transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-sidebar lg:max-w-none lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
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
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gold/40 bg-gradient-to-br from-gold to-goldDim font-serif text-sm font-bold text-sidebar shadow-sm">
              S
            </div>
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
                    `flex items-center gap-2 rounded-md border-l-2 px-2 py-2 text-sm transition-colors lg:py-1.5 ${
                      isActive
                        ? "border-gold bg-gold/10 font-medium text-gold"
                        : "border-transparent text-sidebarTextMuted hover:bg-sidebarHover hover:text-white"
                    }`
                  }
                >
                  <Icon size={16} />
                  {label}
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
        <header className="flex h-topbar shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-5">
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
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-xs font-semibold text-brand-primary">
            SC
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 sm:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
