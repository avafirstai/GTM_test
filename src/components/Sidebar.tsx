"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStats } from "@/lib/useStats";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: string;
}

export function Sidebar() {
  const pathname = usePathname();
  const { data } = useStats();

  const totalLeads = data?.stats.totalLeads ?? 0;
  const withEmail = data?.stats.withEmail ?? 0;
  const emailRate = data?.stats.emailRate ?? 0;
  const verticaleCount = data ? Object.keys(data.stats.byVerticale).length : 0;

  const NAV_ITEMS: NavItem[] = [
    { href: "/", label: "Dashboard", icon: "\u{1F680}" },
    { href: "/launch", label: "Lancer Campagne", icon: "\u{1F3AF}" },
    { href: "/leads", label: "Leads", icon: "\u{1F465}", badge: totalLeads > 0 ? totalLeads.toLocaleString() : undefined },
    { href: "/campaigns", label: "Campagnes", icon: "\u{1F4E7}", badge: withEmail > 0 ? String(withEmail) : undefined },
    { href: "/enrichment", label: "Enrichissement", icon: "\u{1F50D}" },
    { href: "/verticales", label: "Verticales", icon: "\u{1F4CA}", badge: verticaleCount > 0 ? String(verticaleCount) : undefined },
    { href: "/scraping", label: "Scraping", icon: "\u{1F577}\u{FE0F}" },
    { href: "/social", label: "Social Media", icon: "\u{1F4F1}" },
  ];

  const BOTTOM_ITEMS: NavItem[] = [
    { href: "/settings", label: "Settings", icon: "\u{2699}\u{FE0F}" },
  ];

  return (
    <aside
      className="fixed left-0 top-0 h-screen w-56 flex flex-col z-50"
      style={{
        background: "var(--card)",
        borderRight: "1px solid var(--border)",
      }}
    >
      {/* Logo */}
      <div className="px-4 py-5 flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
          style={{ background: "var(--accent)", color: "white" }}
        >
          A
        </div>
        <div>
          <p className="text-sm font-bold">AVA GTM</p>
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>
            Command Center
          </p>
        </div>
      </div>

      {/* Separator */}
      <div
        className="mx-3 mb-2"
        style={{ borderBottom: "1px solid var(--border)" }}
      />

      {/* Main Nav */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                color: isActive ? "var(--accent-light)" : "var(--foreground)",
              }}
            >
              <span className="text-base">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{
                    background: "rgba(99,102,241,0.15)",
                    color: "var(--accent-light)",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-4 space-y-0.5">
        <div
          className="mx-1 mb-2"
          style={{ borderBottom: "1px solid var(--border)" }}
        />
        {BOTTOM_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{ color: "var(--muted)" }}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
        <div
          className="mx-1 mt-2 p-3 rounded-lg"
          style={{ background: "rgba(99,102,241,0.06)" }}
        >
          <p className="text-[10px] font-medium" style={{ color: "var(--accent-light)" }}>
            Pipeline: Autonome
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
            {totalLeads.toLocaleString()} leads &bull; {withEmail} emails &bull; {emailRate}%
          </p>
        </div>
      </div>
    </aside>
  );
}
