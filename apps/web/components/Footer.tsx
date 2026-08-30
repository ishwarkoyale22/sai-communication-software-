import Link from "next/link";
import { Star, ThumbsUp, Camera, MessageCircle, Play } from "lucide-react";

const COLUMNS = [
  {
    title: "Shop",
    links: [
      { href: "/catalog", label: "All Products" },
      { href: "/catalog?category=Mobiles", label: "Mobiles" },
      { href: "/catalog?category=Gift+Hampers", label: "Gift Hampers" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/services", label: "Services" },
      { href: "/contact", label: "Contact Us" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/contact", label: "Store Location" },
      { href: "/contact", label: "Book a Repair" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "#", label: "Privacy Policy" },
      { href: "#", label: "Terms of Service" },
    ],
  },
];

// lucide-react (this project's version) doesn't ship brand/logo icons, so
// these are generic stand-ins tinted with each platform's real brand color
// per the design brief ("hover-fill" in the brand's own color).
const SOCIALS = [
  { icon: ThumbsUp, label: "Facebook", hoverBg: "hover:bg-[#1877F2]" },
  { icon: Camera, label: "Instagram", hoverBg: "hover:bg-gradient-to-tr hover:from-[#FEDA75] hover:via-[#D62976] hover:to-[#4F5BD5]" },
  { icon: MessageCircle, label: "WhatsApp", hoverBg: "hover:bg-[#25D366]" },
  { icon: Play, label: "YouTube", hoverBg: "hover:bg-[#FF0000]" },
];

export function Footer() {
  const shopName = process.env.NEXT_PUBLIC_SHOP_NAME || "Sai Communication";

  return (
    <footer className="mt-20 bg-foreground text-gray-300">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow font-display text-sm font-semibold text-white">
                SC
              </span>
              <span className="font-display text-lg uppercase tracking-wide text-white">{shopName}</span>
            </div>
            <p className="mt-4 max-w-xs text-sm text-gray-400">
              Your neighbourhood electronics store — mobiles, TVs, ACs, laptops &amp; more, with
              honest pricing, easy EMI, and in-house repairs.
            </p>
            <div className="mt-5 flex gap-2.5">
              {SOCIALS.map(({ icon: Icon, label, hoverBg }) => (
                <a
                  key={label}
                  href="#"
                  aria-label={label}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-gray-300 transition-colors hover:border-transparent hover:text-white ${hoverBg}`}
                >
                  <Icon size={15} />
                </a>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="caption-mono !text-white/50">{col.title}</div>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-gray-400 hover:text-gold">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-4 text-xs text-gray-500 sm:flex-row">
          <span>© {new Date().getFullYear()} {shopName}. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-gold">Privacy</a>
            <a href="#" className="hover:text-gold">Terms</a>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold px-3 py-1 text-gold">
              <Star size={11} className="fill-gold" />
              Designed by RELENTIX
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
