"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Rocket,
  Globe,
  Users,
  Mail,
  MessageSquareText,
  Settings,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/launch", label: "Lancer", icon: Rocket },
  { href: "/scraping", label: "Scraping", icon: Globe },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/enrichment", label: "Enrichissement", icon: Zap },
  { href: "/campaigns", label: "Campagnes", icon: Mail },
  { href: "/replies", label: "Réponses", icon: MessageSquareText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-screen w-[220px] flex flex-col z-50 border-r border-[var(--border)]"
      style={{ background: "var(--bg-raised)" }}
    >
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
          style={{ background: "var(--accent)", color: "white" }}
        >
          A
        </div>
        <span className="text-sm font-semibold tracking-tight">AVA GTM</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 mt-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors"
              style={{
                background: isActive ? "var(--accent-subtle)" : "transparent",
                color: isActive ? "var(--accent-hover)" : "var(--text-secondary)",
              }}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4">
        <div className="border-t border-[var(--border)] pt-3">
          <Link
            href="/settings"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            <Settings size={16} />
            <span>Settings</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
