"use client";

import { useStats } from "@/lib/useStats";
import { useCampaigns } from "@/lib/useCampaigns";

export default function SettingsPage() {
  const { data, loading } = useStats();
  const { data: campaignData, loading: campaignLoading } = useCampaigns();

  if ((loading && !data) || (campaignLoading && !campaignData)) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: "var(--muted)" }}>Chargement settings...</div>
      </div>
    );
  }

  const stats = data?.stats;
  const apifyRuns = data?.apifyRuns ?? [];
  const succeededRuns = apifyRuns.filter((r) => r.status === "SUCCEEDED").length;

  // Instantly — real connection status
  const instantlyConnected = campaignData?.connected ?? false;
  const instantlyCampaigns = campaignData?.campaigns ?? [];
  const instantlyTotals = campaignData?.totals;
  const instantlyDetails = instantlyConnected
    ? `${instantlyCampaigns.length} campagne${instantlyCampaigns.length !== 1 ? "s" : ""} \u2022 ${instantlyTotals?.totalLeads.toLocaleString() ?? 0} leads charg\u00E9s \u2022 ${instantlyTotals?.emailsSent.toLocaleString() ?? 0} envoy\u00E9s`
    : campaignData?.error ?? "INSTANTLY_API_KEY non configur\u00E9e";

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold">{"\u2699\uFE0F"} Settings</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Configuration des APIs et int{"\u00E9"}grations
        </p>
      </div>

      <div className="space-y-4">
        <ApiCard
          name="Instantly.ai"
          icon={"\uD83D\uDCE7"}
          status={instantlyConnected ? "connected" : "planned"}
          details={instantlyDetails}
          color={instantlyConnected ? "#22c55e" : "#f59e0b"}
        />
        <ApiCard
          name="Apify"
          icon={"\uD83D\uDD77\uFE0F"}
          status="connected"
          details={`${succeededRuns}/${apifyRuns.length} runs r\u00E9ussis \u2022 ${stats?.totalLeads.toLocaleString() ?? 0} leads scrapp\u00E9s`}
          color="#22c55e"
        />
        <ApiCard
          name="Email Scraper"
          icon={"\uD83D\uDD0D"}
          status={stats && stats.withEmail > 100 ? "connected" : "limit"}
          details={`Scraping web gratuit \u2022 ${stats?.withEmail ?? 0} emails trouv\u00E9s sur ${stats?.withWebsite.toLocaleString() ?? 0} sites`}
          color={stats && stats.withEmail > 100 ? "#22c55e" : "#f59e0b"}
        />
        <ApiCard
          name="Supabase"
          icon={"\uD83D\uDDC4\uFE0F"}
          status="connected"
          details={`${stats?.totalLeads.toLocaleString() ?? 0} leads \u2022 PostgreSQL \u2022 Auto-refresh 30s`}
          color="#22c55e"
        />
        <ApiCard
          name="Cal.com"
          icon={"\uD83D\uDCC5"}
          status="connected"
          details="cal.com/avafirstai/15min"
          color="#22c55e"
        />
        <ApiCard
          name="N8N"
          icon={"\u26A1"}
          status="planned"
          details="Automatisation workflows \u2014 Phase 4"
          color="#818cf8"
        />
      </div>

      {/* Instantly Campaign Details */}
      {instantlyConnected && instantlyCampaigns.length > 0 && (
        <div
          className="mt-6 rounded-xl p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3 className="text-sm font-semibold mb-3">{"\uD83D\uDCE7"} Campagnes Instantly</h3>
          <div className="space-y-2">
            {instantlyCampaigns.map((camp) => {
              const statusColor = camp.status === "active" ? "#22c55e" : camp.status === "paused" ? "#f59e0b" : "#818cf8";
              return (
                <div
                  key={camp.id}
                  className="flex items-center justify-between p-3 rounded-lg"
                  style={{ background: "var(--background)" }}
                >
                  <div>
                    <p className="text-sm font-medium">{camp.name}</p>
                    <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                      {camp.analytics.totalLeads} leads \u2022 {camp.analytics.emailsSent} envoy\u00E9s \u2022 {camp.analytics.openRate}% open \u2022 {camp.analytics.replyRate}% reply
                    </p>
                  </div>
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: `${statusColor}20`, color: statusColor }}
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
        className="mt-6 rounded-xl p-5"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h3 className="text-sm font-semibold mb-3">{"\uD83D\uDCB0"} Co{"\u00FB"}t total du pipeline</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-xl font-bold" style={{ color: "#22c55e" }}>0 {"\u20AC"}</p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>Co{"\u00FB"}t emails</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold" style={{ color: "#22c55e" }}>0 {"\u20AC"}</p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>Co{"\u00FB"}t Apify (free tier)</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold" style={{ color: "#22c55e" }}>0 {"\u20AC"}</p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>Total pipeline</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiCard({
  name,
  icon,
  status,
  details,
  color,
}: {
  name: string;
  icon: string;
  status: "connected" | "limit" | "planned" | "error";
  details: string;
  color: string;
}) {
  const statusLabel = {
    connected: "Connect\u00E9",
    limit: "En cours",
    planned: "Planifi\u00E9",
    error: "Erreur",
  }[status];

  return (
    <div
      className="rounded-xl p-5 flex items-center justify-between"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-sm font-semibold">{name}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{details}</p>
        </div>
      </div>
      <span
        className="text-xs font-medium px-3 py-1 rounded-full"
        style={{ background: `${color}20`, color }}
      >
        {statusLabel}
      </span>
    </div>
  );
}
