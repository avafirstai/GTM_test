"use client";

import { useCampaigns } from "@/lib/useCampaigns";
import { useStats } from "@/lib/useStats";
import {
  Mail,
  Database,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";

export default function SettingsPage() {
  const { data: campaignData, loading: campaignLoading } = useCampaigns();
  const { data: statsData, loading: statsLoading } = useStats();

  if ((campaignLoading && !campaignData) || (statsLoading && !statsData)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stats = statsData?.stats;

  // --- Instantly (connexion reelle via /api/campaigns) ---
  const instantlyConnected = campaignData?.connected ?? false;
  const instantlyReachable = campaignData?.apiReachable ?? false;
  const instantlyCampaigns = campaignData?.campaigns ?? [];
  const instantlyTotals = campaignData?.totals;
  const instantlyDetails = !instantlyConnected
    ? "Cle API non configuree — ajoutez INSTANTLY_API_KEY"
    : !instantlyReachable
      ? "Cle API configuree \u00B7 API temporairement indisponible"
      : `${instantlyCampaigns.length} campagne${instantlyCampaigns.length !== 1 ? "s" : ""} \u00B7 ${instantlyTotals?.totalLeads.toLocaleString() ?? 0} leads \u00B7 ${instantlyTotals?.emailsSent.toLocaleString() ?? 0} envoyes`;
  const instantlyStatus: "connected" | "limit" | "planned" | "error" =
    !instantlyConnected ? "error" : !instantlyReachable ? "limit" : "connected";

  // --- Supabase (connexion reelle via /api/stats) ---
  const supabaseConnected = stats != null && stats.totalLeads >= 0;
  const supabaseDetails = supabaseConnected
    ? `${stats.totalLeads.toLocaleString()} leads \u00B7 PostgreSQL \u00B7 Auto-refresh 30s`
    : "Connexion echouee — verifiez NEXT_PUBLIC_SUPABASE_URL";
  const supabaseStatus: "connected" | "error" = supabaseConnected ? "connected" : "error";

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Connexions actives &mdash; toutes les donnees sont en temps reel
        </p>
      </div>

      {/* Active Integrations — only real connections */}
      <div className="space-y-3 mb-8">
        <ApiCard
          name="Instantly.ai"
          icon={<Mail size={18} />}
          status={instantlyStatus}
          details={instantlyDetails}
        />
        <ApiCard
          name="Supabase"
          icon={<Database size={18} />}
          status={supabaseStatus}
          details={supabaseDetails}
        />
      </div>

      {/* Instantly Campaigns — only if connected */}
      {instantlyConnected && instantlyReachable && instantlyCampaigns.length > 0 && (
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

      {/* Data summary */}
      {supabaseConnected && (
        <div
          className="rounded-xl border border-[var(--border)]"
          style={{ background: "var(--bg-raised)" }}
        >
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium">Donnees pipeline</h2>
          </div>
          <div className="grid grid-cols-3 gap-4 p-5">
            <div className="text-center">
              <p className="text-lg font-semibold">{stats.totalLeads.toLocaleString()}</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Leads total</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{stats.withEmail.toLocaleString()}</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Avec email</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{Math.round(stats.emailRate)}%</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Taux email</p>
            </div>
          </div>
        </div>
      )}

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
