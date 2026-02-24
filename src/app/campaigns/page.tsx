"use client";

import { useState, useCallback } from "react";
import { useStats } from "@/lib/useStats";
import { useCampaigns } from "@/lib/useCampaigns";
import type { Campaign } from "@/lib/useCampaigns";
import {
  Mail,
  TrendingUp,
  Send,
  ChevronRight,
  Settings,
  Rocket,
  Link2,
  Zap,
  Pause,
  Play,
  Loader2,
} from "lucide-react";

export default function CampaignsPage() {
  const { data: statsData, loading: statsLoading } = useStats();
  const { data: campaignData, loading: campaignLoading, refetch } = useCampaigns();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleToggle = useCallback(async (campaignId: string, currentStatus: string) => {
    const action = currentStatus === "active" ? "pause" : "resume";
    setTogglingId(campaignId);
    try {
      const res = await fetch("/api/campaigns/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, action }),
      });
      const data = await res.json();
      if (data.success) {
        await refetch();
      }
    } catch {
      // Silent — will retry on next refetch
    } finally {
      setTogglingId(null);
    }
  }, [refetch]);

  if ((statsLoading && !statsData) || (campaignLoading && !campaignData)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stats = statsData?.stats;
  const categoryEmailRates = statsData?.categoryEmailRates ?? [];
  const topCategories = categoryEmailRates.slice(0, 5);
  const connected = campaignData?.connected ?? false;
  const activeCampaign = campaignData?.activeCampaign ?? null;
  const allCampaigns = campaignData?.campaigns ?? [];
  const totals = campaignData?.totals ?? {
    totalLeads: 0,
    contacted: 0,
    emailsSent: 0,
    emailsRead: 0,
    replied: 0,
    bounced: 0,
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Campagnes</h1>
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{
              background: connected ? "var(--green-subtle)" : "var(--amber-subtle)",
              color: connected ? "var(--green)" : "var(--amber)",
            }}
          >
            {connected ? "Connecte" : "Non connecte"}
          </span>
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Suivez vos campagnes email Instantly — envois, ouvertures, reponses.
        </p>
      </div>

      {/* Degraded API warning */}
      {connected && campaignData?.apiReachable === false && (
        <div className="rounded-lg p-3 mb-6" style={{ background: "var(--amber-subtle)" }}>
          <p className="text-xs" style={{ color: "var(--amber)" }}>
            API Instantly temporairement indisponible — les donnees affichees peuvent etre obsoletes.
          </p>
        </div>
      )}

      {/* Onboarding card when not connected */}
      {!connected && (
        <div
          className="rounded-xl p-6 mb-6 border border-[var(--border)]"
          style={{ background: "var(--bg-raised)" }}
        >
          <h2 className="text-sm font-semibold mb-4">Connectez Instantly pour lancer vos campagnes</h2>
          <div className="space-y-3">
            <OnboardingStep
              step={1}
              icon={<Link2 size={14} />}
              text="Creez un compte sur instantly.ai"
            />
            <OnboardingStep
              step={2}
              icon={<Settings size={14} />}
              text="Ajoutez votre cle API dans Reglages"
              href="/settings"
            />
            <OnboardingStep
              step={3}
              icon={<Rocket size={14} />}
              text="Revenez ici pour suivre vos campagnes"
            />
          </div>
        </div>
      )}

      {/* Empty state when connected but 0 campaigns */}
      {connected && allCampaigns.length === 0 && (
        <div
          className="rounded-xl p-8 mb-6 border border-[var(--border)] text-center"
          style={{ background: "var(--bg-raised)" }}
        >
          <Zap size={24} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
          <p className="text-sm font-medium mb-1">Aucune campagne</p>
          <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
            Lancez votre premiere campagne pour commencer a envoyer des emails.
          </p>
          <a
            href="/launch"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Rocket size={14} />
            Lancer une campagne
          </a>
        </div>
      )}

      {/* Active Campaign */}
      {connected && activeCampaign && (
        <CampaignCard
          campaign={activeCampaign}
          isActive
          toggling={togglingId === activeCampaign.id}
          onToggle={handleToggle}
        />
      )}

      {/* Global Totals */}
      {connected && allCampaigns.length > 0 && (
        <div
          className="rounded-xl border border-[var(--border)] mb-6"
          style={{ background: "var(--bg-raised)" }}
        >
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
            <TrendingUp size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-medium">Totaux</h2>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4 p-5">
            <Metric label="Leads" value={totals.totalLeads.toLocaleString()} />
            <Metric label="Contactes" value={totals.contacted.toLocaleString()} />
            <Metric label="Envoyes" value={totals.emailsSent.toLocaleString()} />
            <Metric label="Ouverts" value={totals.emailsRead.toLocaleString()} accent="green" />
            <Metric label="Repondu" value={totals.replied.toLocaleString()} accent="amber" />
            <Metric label="Bounced" value={totals.bounced.toLocaleString()} accent="red" />
          </div>
        </div>
      )}

      {/* All Campaigns List */}
      {connected && allCampaigns.length > 1 && (
        <div
          className="rounded-xl border border-[var(--border)] mb-6"
          style={{ background: "var(--bg-raised)" }}
        >
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium">
              Toutes les campagnes ({allCampaigns.length})
            </h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {allCampaigns.map((camp) => (
              <CampaignRow
                key={camp.id}
                campaign={camp}
                isActive={camp.id === campaignData?.activeCampaignId}
                toggling={togglingId === camp.id}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Supabase leads ready */}
      {stats && (
        <div
          className="rounded-xl border border-[var(--border)] mb-6"
          style={{ background: "var(--bg-raised)" }}
        >
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
            <Mail size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-medium">Leads prets pour campagne</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5">
            <Metric label="Total leads" value={stats.totalLeads.toLocaleString()} />
            <Metric label="Avec email" value={stats.withEmail.toLocaleString()} accent="green" />
            <Metric label="Avec site web" value={stats.withWebsite.toLocaleString()} />
            <Metric
              label="Taux email"
              value={`${stats.emailRate}%`}
              accent={stats.emailRate > 5 ? "green" : "amber"}
            />
          </div>
        </div>
      )}

      {/* Verticale breakdown */}
      {topCategories.length > 0 && stats && (
        <div
          className="rounded-xl border border-[var(--border)] mb-6"
          style={{ background: "var(--bg-raised)" }}
        >
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium">Repartition par verticale</h2>
          </div>
          <div className="p-5 space-y-3">
            {topCategories.map((cat) => {
              const pct =
                stats.totalLeads > 0
                  ? Math.round((cat.total / stats.totalLeads) * 100)
                  : 0;
              return (
                <div key={cat.name} className="flex items-center gap-3">
                  <span
                    className="text-xs w-44 truncate"
                    style={{ color: "var(--text-muted)" }}
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
                        width: `${pct}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium w-10 text-right">
                    {cat.total}
                  </span>
                  <span
                    className="text-xs w-10 text-right"
                    style={{
                      color: cat.withEmail > 0 ? "var(--green)" : "var(--text-muted)",
                    }}
                  >
                    {cat.withEmail > 0 ? cat.withEmail : "-"}
                  </span>
                </div>
              );
            })}
            {categoryEmailRates.length > 5 && (
              <p
                className="text-[11px] text-center pt-2"
                style={{ color: "var(--text-muted)" }}
              >
                +{categoryEmailRates.length - 5} autres verticales
              </p>
            )}
          </div>
        </div>
      )}

      {/* Email Sequence */}
      <div
        className="rounded-xl border border-[var(--border)]"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
          <Send size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-medium">Sequence email</h2>
        </div>
        <div className="p-5 space-y-3">
          <SequenceStep
            step={1}
            delay="J+0"
            subject="[Prenom], votre standard telephonique perd des clients"
          />
          <SequenceStep
            step={2}
            delay="J+3"
            subject="Re: {{company}} — ce que j'ai observe sur votre site"
          />
          <SequenceStep
            step={3}
            delay="J+7"
            subject="Derniere question rapide"
          />
        </div>
      </div>

      {/* Footer */}
      <p
        className="text-center text-xs mt-10"
        style={{ color: "var(--text-muted)" }}
      >
        AVA GTM &middot; Campagnes automatisees
      </p>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function CampaignCard({
  campaign,
  isActive,
  toggling,
  onToggle,
}: {
  campaign: Campaign;
  isActive: boolean;
  toggling: boolean;
  onToggle: (id: string, status: string) => void;
}) {
  const a = campaign.analytics;
  const canToggle = campaign.status === "active" || campaign.status === "paused";
  return (
    <div
      className="rounded-xl border mb-6 p-5"
      style={{
        background: "var(--bg-raised)",
        borderColor: isActive
          ? "rgba(99,102,241,0.25)"
          : "var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{campaign.name}</h3>
            {isActive && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  background: "var(--accent-subtle)",
                  color: "var(--accent-hover)",
                }}
              >
                Principale
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Creee le{" "}
            {campaign.createdAt
              ? new Date(campaign.createdAt).toLocaleDateString("fr-FR")
              : "N/A"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canToggle && (
            <button
              onClick={() => onToggle(campaign.id, campaign.status)}
              disabled={toggling}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50"
              style={{
                background: campaign.status === "active" ? "var(--amber-subtle)" : "var(--green-subtle)",
                color: campaign.status === "active" ? "var(--amber)" : "var(--green)",
              }}
            >
              {toggling ? (
                <Loader2 size={12} className="animate-spin" />
              ) : campaign.status === "active" ? (
                <Pause size={12} />
              ) : (
                <Play size={12} />
              )}
              {campaign.status === "active" ? "Pause" : "Reprendre"}
            </button>
          )}
          <StatusBadge status={campaign.status} />
        </div>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
        <Metric label="Leads" value={a.totalLeads.toLocaleString()} />
        <Metric label="Envoyes" value={a.emailsSent.toLocaleString()} />
        <Metric label="Ouverts" value={a.emailsRead.toLocaleString()} accent="green" />
        <Metric label="Repondu" value={a.replied.toLocaleString()} accent="amber" />
        <Metric label="Open rate" value={`${a.openRate}%`} accent={a.openRate > 30 ? "green" : undefined} />
        <Metric label="Reply rate" value={`${a.replyRate}%`} accent={a.replyRate > 5 ? "green" : undefined} />
      </div>
    </div>
  );
}

function CampaignRow({
  campaign,
  isActive,
  toggling,
  onToggle,
}: {
  campaign: Campaign;
  isActive: boolean;
  toggling: boolean;
  onToggle: (id: string, status: string) => void;
}) {
  const a = campaign.analytics;
  const canToggle = campaign.status === "active" || campaign.status === "paused";
  return (
    <div
      className="px-5 py-3 flex items-center justify-between"
      style={{
        background: isActive ? "var(--accent-subtle)" : "transparent",
      }}
    >
      <div className="flex items-center gap-3">
        <StatusDot status={campaign.status} />
        <div>
          <p className="text-sm font-medium">{campaign.name}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {a.totalLeads} leads &middot; {a.emailsSent} envoyes &middot;{" "}
            {a.replied} reponses &middot; {a.openRate}% open
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {canToggle && (
          <button
            onClick={() => onToggle(campaign.id, campaign.status)}
            disabled={toggling}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md font-medium transition-all disabled:opacity-50"
            style={{
              background: campaign.status === "active" ? "var(--amber-subtle)" : "var(--green-subtle)",
              color: campaign.status === "active" ? "var(--amber)" : "var(--green)",
            }}
          >
            {toggling ? (
              <Loader2 size={10} className="animate-spin" />
            ) : campaign.status === "active" ? (
              <Pause size={10} />
            ) : (
              <Play size={10} />
            )}
            {campaign.status === "active" ? "Pause" : "Reprendre"}
          </button>
        )}
        <StatusBadge status={campaign.status} />
        <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "amber" | "red";
}) {
  const colorMap = {
    green: "var(--green)",
    amber: "var(--amber)",
    red: "var(--red)",
  };
  return (
    <div className="text-center">
      <p
        className="text-lg font-semibold"
        style={accent ? { color: colorMap[accent] } : undefined}
      >
        {value}
      </p>
      <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    active: { color: "var(--green)", label: "Active" },
    paused: { color: "var(--amber)", label: "En pause" },
    completed: { color: "var(--accent)", label: "Terminee" },
    drafts: { color: "var(--text-muted)", label: "Brouillon" },
  };
  const c = config[status] ?? { color: "var(--text-muted)", label: status };
  return (
    <span
      className="text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ background: `color-mix(in srgb, ${c.color} 15%, transparent)`, color: c.color }}
    >
      {c.label}
    </span>
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
      className="w-2 h-2 rounded-full inline-block shrink-0"
      style={{ background: color }}
    />
  );
}

function OnboardingStep({
  step,
  icon,
  text,
  href,
}: {
  step: number;
  icon: React.ReactNode;
  text: string;
  href?: string;
}) {
  const content = (
    <div
      className="flex items-center gap-3 p-3 rounded-lg"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ background: "var(--accent-subtle)", color: "var(--accent-hover)" }}
      >
        {step}
      </div>
      <span style={{ color: "var(--text-muted)" }}>{icon}</span>
      <p className="text-sm flex-1">{text}</p>
      {href && <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />}
    </div>
  );

  if (href) {
    return <a href={href} className="block">{content}</a>;
  }
  return content;
}

function SequenceStep({
  step,
  delay,
  subject,
}: {
  step: number;
  delay: string;
  subject: string;
}) {
  return (
    <div
      className="p-3 rounded-lg flex items-center gap-3"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {step}
      </div>
      <p className="text-sm flex-1">{subject}</p>
      <span
        className="text-[11px] px-2 py-0.5 rounded-full shrink-0"
        style={{
          background: "var(--accent-subtle)",
          color: "var(--accent-hover)",
        }}
      >
        {delay}
      </span>
    </div>
  );
}
