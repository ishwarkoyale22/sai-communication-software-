import { NavLink, Outlet } from "react-router-dom";
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
  FileUp,
  BarChart3,
  LogOut,
  MessageSquareText,
  FileText,
  Star,
  Tag,
  Wand2,
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

  return (
    <div className="flex h-screen w-full overflow-hidden bg-page">
      <aside className="relative flex w-sidebar shrink-0 flex-col overflow-hidden bg-sidebar text-gray-400">
        {/* faint gold glow, top-left — echoes the boutique brand instead of a flat panel */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-60"
          style={{ background: "radial-gradient(320px circle at 20% 0%, rgba(201,151,90,0.16), transparent 70%)" }}
        />

        <div className="relative flex h-topbar items-center gap-2.5 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-gold/40 bg-gradient-to-br from-gold to-goldDim font-serif text-sm font-bold text-sidebar shadow-sm">
            S
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-white">Sai Communication</span>
            <span className="text-[10px] uppercase tracking-wider text-gold/70">Admin Portal</span>
          </div>
        </div>

        <nav className="relative flex-1 overflow-y-auto px-2 py-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                {group.label}
              </div>
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "border-gold bg-gold/10 font-medium text-gold"
                        : "border-transparent text-gray-400 hover:bg-sidebarHover hover:text-white"
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
          className="relative m-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-sidebarHover hover:text-white"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-topbar shrink-0 items-center justify-between border-b border-border bg-card px-5">
          <div className="text-sm font-medium text-gray-700">Admin Portal</div>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-primary/10 text-xs font-semibold text-brand-primary">
            SC
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
