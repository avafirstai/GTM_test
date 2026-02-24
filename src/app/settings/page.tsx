"use client";

import { useStats } from "@/lib/useStats";
import { useCampaigns } from "@/lib/useCampaigns";
import {
  Settings,
  Mail,
  Database,
  Globe,
  Calendar,
  Zap,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";

export default function SettingsPage() {
  const { data, loading } = useStats();
  const { data: campaignData, loading: campaignLoading } = useCampaigns();

  if ((loading && !data) || (campaignLoading && !campaignData)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stats = data?.stats;
  const apifyRuns = data?.apifyRuns ?? [];
  const succeededRuns = apifyRuns.filter((r) => r.status === "SUCCEEDED").length;

  const instantlyConnected = campaignData?.connected ?? false;
  const instantlyCampaigns = campaignData?.campaigns ?? [];
  const instantlyTotals = campaignData?.totals;
  const instantlyDetails = instantlyConnected
    ? `${instantlyCampaigns.length} campagne${instantlyCampaigns.length !== 1 ? "s" : ""} \u00B7 ${instantlyTotals?.totalLeads.toLocaleString() ?? 0} leads \u00B7 ${instantlyTotals?.emailsSent.toLocaleString() ?? 0} envoyes`
    : "Service email non configure";

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Configuration des APIs et integrations
        </p>
      </div>

      {/* Integrations */}
      <div className="space-y-3 mb-8">
        <ApiCard
          name="Instantly.ai"
          icon={<Mail size={18} />}
          status={instantlyConnected ? "connected" : "planned"}
          details={instantlyDetails}
        />
        <ApiCard
          name="Apify"
          icon={<Globe size={18} />}
          status="connected"
          details={`${succeededRuns}/${apifyRuns.length} runs reussis \u00B7 ${stats?.totalLeads.toLocaleString() ?? 0} leads scrappes`}
        />
        <ApiCard
          name="Email Scraper"
          icon={<Zap size={18} />}
          status={stats && stats.withEmail > 100 ? "connected" : "limit"}
          details={`Scraping web gratuit \u00B7 ${stats?.withEmail ?? 0} emails trouves sur ${stats?.withWebsite.toLocaleString() ?? 0} sites`}
        />
        <ApiCard
          name="Supabase"
          icon={<Database size={18} />}
          status="connected"
          details={`${stats?.totalLeads.toLocaleString() ?? 0} leads \u00B7 PostgreSQL \u00B7 Auto-refresh 30s`}
        />
        <ApiCard
          name="Cal.com"
          icon={<Calendar size={18} />}
          status="connected"
          details="cal.com/avafirstai/15min"
        />
        <ApiCard
          name="N8N"
          icon={<Zap size={18} />}
          status="planned"
          details="Automatisation workflows — Phase 4"
        />
      </div>

      {/* Instantly Campaigns */}
      {instantlyConnected && instantlyCampaigns.length > 0 && (
        <div
          className="rounded-xl border border-[var(--border)] mb-6"
          style={{ background: "var(--bg-raised)" }}
        >
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
            <Mail size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-medium">Campagnes Instantly</h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {instantlyCampaigns.map((camp) => {
              const statusColor =
                camp.status === "active"
                  ? "var(--green)"
                  : camp.status === "paused"
                    ? "var(--amber)"
                    : "var(--accent)";
              return (
                <div
                  key={camp.id}
                  className="px-5 py-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{camp.name}</p>
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {camp.analytics.totalLeads} leads &middot;{" "}
                      {camp.analytics.emailsSent} envoyes &middot;{" "}
                      {camp.analytics.openRate}% open &middot;{" "}
                      {camp.analytics.replyRate}% reply
                    </p>
                  </div>
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style={{
                      background: `color-mix(in srgb, ${statusColor} 15%, transparent)`,
                      color: statusColor,
                    }}
                  >
                    {camp.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cost Summary */}
      <div
        className="rounded-xl border border-[var(--border)]"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">Cout total du pipeline</h2>
        </div>
        <div className="grid grid-cols-3 gap-4 p-5">
          <div className="text-center">
            <p className="text-xl font-semibold" style={{ color: "var(--green)" }}>
              0 &euro;
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Cout emails
            </p>
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold" style={{ color: "var(--green)" }}>
              0 &euro;
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Cout Apify
            </p>
          </div>
          <div className="text-center">
            <p className="text-xl font-semibold" style={{ color: "var(--green)" }}>
              0 &euro;
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Total pipeline
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="text-center text-xs mt-10" style={{ color: "var(--text-muted)" }}>
        AVA GTM &middot; Configuration
      </p>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function ApiCard({
  name,
  icon,
  status,
  details,
}: {
  name: string;
  icon: React.ReactNode;
  status: "connected" | "limit" | "planned" | "error";
  details: string;
}) {
  const config: Record<string, { color: string; label: string; Icon: typeof CheckCircle }> = {
    connected: { color: "var(--green)", label: "Connecte", Icon: CheckCircle },
    limit: { color: "var(--amber)", label: "En cours", Icon: Clock },
    planned: { color: "var(--text-muted)", label: "Planifie", Icon: Clock },
    error: { color: "var(--red)", label: "Erreur", Icon: AlertCircle },
  };
  const c = config[status];

  return (
    <div
      className="rounded-xl p-4 flex items-center justify-between"
      style={{
        background: "var(--bg-raised)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: "var(--bg)", color: "var(--text-secondary)" }}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {details}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <c.Icon size={12} style={{ color: c.color }} />
        <span
          className="text-[11px] font-medium"
          style={{ color: c.color }}
        >
          {c.label}
        </span>
      </div>
    </div>
  );
}
