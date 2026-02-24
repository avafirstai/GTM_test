"use client";

import { useStats } from "@/lib/useStats";
import { useCampaigns } from "@/lib/useCampaigns";
import Link from "next/link";
import {
  Users,
  Mail,
  Phone,
  Rocket,
  ArrowRight,
  TrendingUp,
} from "lucide-react";

export default function Dashboard() {
  const { data, loading } = useStats();
  const { data: campaignData } = useCampaigns();

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { stats } = data;
  const campaigns = campaignData?.campaigns ?? [];
  const connected = campaignData?.connected ?? false;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {stats.totalLeads.toLocaleString()} leads &middot;{" "}
          {Object.keys(stats.byVerticale).length} verticales &middot;{" "}
          {Object.keys(stats.byVille).length} villes
        </p>
      </div>

      {/* Hero metrics */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <MetricCard
          icon={<Users size={18} />}
          label="Total Leads"
          value={stats.totalLeads.toLocaleString()}
          sub={`Score moyen: ${stats.avgScore}`}
        />
        <MetricCard
          icon={<Mail size={18} />}
          label="Emails"
          value={stats.withEmail.toLocaleString()}
          sub={`${stats.emailRate}% enrichis`}
          accent={stats.withEmail > 0}
        />
        <MetricCard
          icon={<Phone size={18} />}
          label="Telephones"
          value={stats.withPhone.toLocaleString()}
          sub={`${stats.phoneRate}% des leads`}
          accent
        />
      </div>

      {/* CTA */}
      <Link
        href="/launch"
        className="flex items-center justify-between p-4 rounded-xl mb-8 transition-colors group"
        style={{
          background: "var(--accent-subtle)",
          border: "1px solid rgba(99, 102, 241, 0.15)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Rocket size={18} />
          </div>
          <div>
            <p className="text-sm font-medium">Lancer une campagne</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Scraping + enrichissement + envoi automatique
            </p>
          </div>
        </div>
        <ArrowRight
          size={18}
          className="transition-transform group-hover:translate-x-1"
          style={{ color: "var(--accent-hover)" }}
        />
      </Link>

      {/* Quick stats row */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        <SmallStat label="Prioritaires" value={stats.highScore} caption="Score 80+" />
        <SmallStat label="Standard" value={stats.mediumScore} caption="Score 50-79" />
        <SmallStat label="Sites web" value={stats.withWebsite} caption={`${stats.websiteRate}%`} />
        <SmallStat label="Avis Google" value={stats.totalReviews > 1000 ? `${(stats.totalReviews / 1000).toFixed(0)}K` : stats.totalReviews} caption={`${stats.avgRating}/5 moy.`} />
      </div>

      {/* Campaigns */}
      <div className="rounded-xl border border-[var(--border)]" style={{ background: "var(--bg-raised)" }}>
        <div className="px-5 py-4 flex items-center justify-between border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-medium">Campagnes</h2>
          </div>
          {connected && (
            <Link href="/campaigns" className="text-xs font-medium" style={{ color: "var(--accent-hover)" }}>
              Voir tout
            </Link>
          )}
        </div>
        <div className="p-5">
          {campaignData?.connected && campaignData?.apiReachable === false && (
            <div className="rounded-lg p-2 mb-3" style={{ background: "var(--amber-subtle)" }}>
              <p className="text-[11px]" style={{ color: "var(--amber)" }}>
                API Instantly temporairement indisponible
              </p>
            </div>
          )}
          {!connected ? (
            <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
              Aucune campagne active. Lancez votre premiere campagne.
            </p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
              Aucune campagne trouvee.
            </p>
          ) : (
            <div className="space-y-3">
              {campaigns.slice(0, 5).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex items-center gap-3">
                    <StatusDot status={c.status} />
                    <span className="text-sm">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
                    <span>{c.analytics?.totalLeads ?? 0} leads</span>
                    <span>{c.analytics?.emailsSent ?? 0} sent</span>
                    <span>{c.analytics?.emailsRead ?? 0} opened</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <p className="text-center text-xs mt-10" style={{ color: "var(--text-muted)" }}>
        AVA GTM &middot; Pipeline automatise
      </p>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-5 border border-[var(--border)]"
      style={{ background: "var(--bg-raised)" }}
    >
      <div className="flex items-center gap-2 mb-3" style={{ color: "var(--text-muted)" }}>
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-tight" style={accent ? { color: "var(--green)" } : undefined}>
        {value}
      </p>
      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{sub}</p>
    </div>
  );
}

function SmallStat({
  label,
  value,
  caption,
}: {
  label: string;
  value: number | string;
  caption: string;
}) {
  const display = typeof value === "number" ? value.toLocaleString() : value;
  return (
    <div className="rounded-lg p-3 border border-[var(--border)]" style={{ background: "var(--bg-raised)" }}>
      <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="text-lg font-semibold mt-0.5">{display}</p>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{caption}</p>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active" || status === "completed"
      ? "var(--green)"
      : status === "paused"
        ? "var(--amber)"
        : "var(--text-muted)";
  return (
    <span
      className="w-2 h-2 rounded-full inline-block"
      style={{ background: color }}
    />
  );
}
