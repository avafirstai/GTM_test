"use client";

import { useStats } from "@/lib/useStats";
import {
  Zap,
  Globe,
  Mail,
  ArrowRight,
  ChevronRight,
  Rocket,
  Users,
  Search,
  ExternalLink,
} from "lucide-react";

export default function EnrichmentPage() {
  const { data, loading } = useStats();

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { stats, categoryEmailRates, cityEmailRates } = data;

  const websiteRate =
    stats.totalLeads > 0
      ? Math.round((stats.withWebsite / stats.totalLeads) * 100)
      : 0;
  const emailFromWebsite =
    stats.withWebsite > 0
      ? Math.round((stats.withEmail / stats.withWebsite) * 100)
      : 0;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Enrichissement</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Trouve automatiquement les emails de vos leads via scraping web.
        </p>
      </div>

      {/* Funnel */}
      <div
        className="rounded-xl border border-[var(--border)] mb-6"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
          <Zap size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-medium">Entonnoir de conversion</h2>
        </div>
        <div className="flex items-center gap-2 p-5 overflow-x-auto">
          <FunnelStep
            icon={<Users size={16} />}
            title="Leads scrappes"
            count={stats.totalLeads}
            href="/leads"
          />
          <FunnelArrow pct={websiteRate} />
          <FunnelStep
            icon={<Globe size={16} />}
            title="Avec site web"
            count={stats.withWebsite}
            href="/leads"
          />
          <FunnelArrow pct={emailFromWebsite} />
          <FunnelStep
            icon={<Mail size={16} />}
            title="Email trouve"
            count={stats.withEmail}
            accent
            href="/leads?hasEmail=yes"
          />
          <FunnelArrow pct={100} />
          <FunnelStep
            icon={<Rocket size={16} />}
            title="Pret campagne"
            count={stats.withEmail}
            accent
            href="/launch"
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <ActionCard
          icon={<Mail size={16} />}
          title="Leads avec email"
          desc={`${stats.withEmail.toLocaleString()} leads prets`}
          href="/leads?hasEmail=yes"
          accent="green"
        />
        <ActionCard
          icon={<Search size={16} />}
          title="Leads sans email"
          desc={`${stats.withoutEmail.toLocaleString()} leads a enrichir`}
          href="/leads?hasEmail=no"
          accent="amber"
        />
        <ActionCard
          icon={<Rocket size={16} />}
          title="Lancer une campagne"
          desc="Envoyer les leads enrichis"
          href="/launch"
          accent="accent"
        />
      </div>

      {/* Two columns: Categories + Cities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* By category */}
        {categoryEmailRates.length > 0 && (
          <div
            className="rounded-xl border border-[var(--border)]"
            style={{ background: "var(--bg-raised)" }}
          >
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-sm font-medium">Taux par categorie</h2>
            </div>
            <div className="p-4 space-y-1.5">
              {categoryEmailRates.map((cat) => (
                <a
                  key={cat.name}
                  href={`/leads?verticale=${encodeURIComponent(cat.name)}`}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors group"
                  style={{ background: "transparent" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    className="text-[11px] w-36 truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {cat.name}
                  </span>
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: "var(--bg)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(cat.rate, 1)}%`,
                        background:
                          cat.rate > 50
                            ? "var(--green)"
                            : cat.rate > 20
                              ? "var(--amber)"
                              : "var(--accent)",
                      }}
                    />
                  </div>
                  <span
                    className="text-[11px] font-medium w-16 text-right"
                    style={{
                      color: cat.withEmail > 0 ? "var(--green)" : "var(--text-muted)",
                    }}
                  >
                    {cat.withEmail}/{cat.total}
                  </span>
                  <ExternalLink
                    size={10}
                    className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
                    style={{ color: "var(--text-muted)" }}
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* By city */}
        {cityEmailRates.length > 0 && (
          <div
            className="rounded-xl border border-[var(--border)]"
            style={{ background: "var(--bg-raised)" }}
          >
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-sm font-medium">Taux par ville</h2>
            </div>
            <div className="p-4 space-y-1.5">
              {cityEmailRates.map((city) => (
                <a
                  key={city.name}
                  href={`/leads?ville=${encodeURIComponent(city.name)}`}
                  className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors group"
                  style={{ background: "transparent" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    className="text-[11px] w-36 truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {city.name}
                  </span>
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: "var(--bg)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(city.rate, 1)}%`,
                        background:
                          city.rate > 50
                            ? "var(--green)"
                            : city.rate > 20
                              ? "var(--amber)"
                              : "var(--accent)",
                      }}
                    />
                  </div>
                  <span
                    className="text-[11px] font-medium w-16 text-right"
                    style={{
                      color: city.withEmail > 0 ? "var(--green)" : "var(--text-muted)",
                    }}
                  >
                    {city.withEmail}/{city.total}
                  </span>
                  <ExternalLink
                    size={10}
                    className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
                    style={{ color: "var(--text-muted)" }}
                  />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="text-center text-xs mt-10" style={{ color: "var(--text-muted)" }}>
        AVA GTM &middot; Enrichissement automatise
      </p>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function FunnelStep({
  icon,
  title,
  count,
  accent,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  accent?: boolean;
  href: string;
}) {
  return (
    <a
      href={href}
      className="p-4 rounded-lg min-w-32 text-center shrink-0 transition-colors"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = accent ? "rgba(34,197,94,0.4)" : "rgba(99,102,241,0.4)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
    >
      <div
        className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center"
        style={{
          background: accent ? "var(--green-subtle)" : "var(--accent-subtle)",
          color: accent ? "var(--green)" : "var(--accent)",
        }}
      >
        {icon}
      </div>
      <p className="text-xs font-medium">{title}</p>
      <p
        className="text-lg font-semibold mt-1"
        style={accent ? { color: "var(--green)" } : undefined}
      >
        {count.toLocaleString()}
      </p>
    </a>
  );
}

function FunnelArrow({ pct }: { pct: number }) {
  return (
    <div className="flex flex-col items-center shrink-0 gap-0.5">
      <ArrowRight size={14} style={{ color: "var(--text-muted)" }} />
      {pct < 100 && (
        <span className="text-[9px] font-medium" style={{ color: "var(--text-muted)" }}>
          {pct}%
        </span>
      )}
    </div>
  );
}

function ActionCard({
  icon,
  title,
  desc,
  href,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href: string;
  accent: "green" | "amber" | "accent";
}) {
  const colorMap = {
    green: { bg: "var(--green-subtle)", color: "var(--green)", border: "rgba(34,197,94,0.15)" },
    amber: { bg: "var(--amber-subtle)", color: "var(--amber)", border: "rgba(245,158,11,0.15)" },
    accent: { bg: "var(--accent-subtle)", color: "var(--accent-hover)", border: "rgba(99,102,241,0.15)" },
  };
  const c = colorMap[accent];

  return (
    <a
      href={href}
      className="rounded-xl p-4 flex items-center gap-3 transition-colors group"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: c.border, color: c.color }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: c.color }}>{title}</p>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{desc}</p>
      </div>
      <ChevronRight size={14} className="shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" style={{ color: c.color }} />
    </a>
  );
}
