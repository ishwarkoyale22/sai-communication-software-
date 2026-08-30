"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Phone, Clock, ShoppingBag } from "lucide-react";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "Products" },
  { href: "/services", label: "Services" },
  { href: "/contact", label: "Contact" },
];

export function Navbar() {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      const goingDown = y > lastY;
      setHidden(goingDown && y > 120);
      lastY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const phone = process.env.NEXT_PUBLIC_SHOP_PHONE || "+91 90000 00000";

  return (
    <header
      className={`sticky top-0 z-30 w-full transition-transform duration-300 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      {/* Utility strip — dark, hidden below sm */}
      <div className="relative hidden overflow-hidden bg-foreground text-white sm:block">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(500px circle at 15% 0%, rgba(184,137,75,0.25), transparent 60%)",
          }}
        />
        <div className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-1.5 text-xs">
          <div className="flex items-center gap-4 text-gray-300">
            <span className="flex items-center gap-1.5">
              <Phone size={11} className="text-gold" /> {phone}
            </span>
            <span className="hidden items-center gap-1.5 md:flex">
              <Clock size={11} className="text-gold" /> Mon–Sun · 10am–9pm
            </span>
          </div>
          <div className="hidden gap-3 text-gray-400 xl:flex">
            <a href="#" className="hover:text-gold">Facebook</a>
            <a href="#" className="hover:text-gold">Instagram</a>
            <a href="#" className="hover:text-gold">WhatsApp</a>
          </div>
        </div>
      </div>

      {/* Main bar */}
      <div className="border-b border-gold/60 bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow font-display text-sm font-semibold text-white">
              SC
            </span>
            <span className="font-display text-lg font-medium uppercase tracking-wide text-foreground">
              Sai Communication
            </span>
          </Link>

          <nav className="hidden items-center gap-8 xl:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`border-b pb-1 text-sm font-medium transition-colors ${
                    active
                      ? "border-gold text-foreground"
                      : "border-transparent text-muted-foreground hover:border-gold hover:text-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 xl:flex">
            <Link href="/catalog" className="btn-primary !rounded-btn">
              Shop Now
            </Link>
            <Link
              href="/catalog"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground hover:border-gold hover:text-gold"
              aria-label="Catalog"
            >
              <ShoppingBag size={16} />
            </Link>
          </div>

          <button
            className="flex h-9 w-9 items-center justify-center rounded border border-border xl:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {mobileOpen && (
          <div className="border-t border-border bg-background px-6 py-4 xl:hidden">
            <nav className="flex flex-col gap-3">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="text-sm font-medium text-foreground"
                >
                  {link.label}
                </Link>
              ))}
              <Link href="/catalog" onClick={() => setMobileOpen(false)} className="btn-primary mt-2 w-full">
                Shop Now
              </Link>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
