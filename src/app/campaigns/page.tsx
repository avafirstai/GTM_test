"use client";

import { useStats } from "@/lib/useStats";
import { useCampaigns } from "@/lib/useCampaigns";
import type { Campaign } from "@/lib/useCampaigns";

export default function CampaignsPage() {
  const { data: statsData, loading: statsLoading } = useStats();
  const { data: campaignData, loading: campaignLoading } = useCampaigns();

  if ((statsLoading && !statsData) || (campaignLoading && !campaignData)) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: "var(--muted)" }}>Chargement des campagnes...</div>
      </div>
    );
  }

  const stats = statsData?.stats;
  const categoryEmailRates = statsData?.categoryEmailRates ?? [];
  const topCategories = categoryEmailRates.slice(0, 5);
  const connected = campaignData?.connected ?? false;
  const activeCampaign = campaignData?.activeCampaign ?? null;
  const allCampaigns = campaignData?.campaigns ?? [];
  const totals = campaignData?.totals ?? { totalLeads: 0, contacted: 0, emailsSent: 0, emailsRead: 0, replied: 0, bounced: 0 };

  return (
    <div className="p-6 max-w-full">
      <div className="mb-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          {"\u{1F4E7}"} Campagnes Email
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{
              background: connected ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
              color: connected ? "#22c55e" : "#f59e0b",
            }}
          >
            {connected ? `Instantly connect\u00E9` : "Non connect\u00E9"}
          </span>
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          {stats
            ? `${stats.totalLeads.toLocaleString()} leads \u2022 ${stats.withEmail.toLocaleString()} avec email \u2022 ${allCampaigns.length} campagne${allCampaigns.length !== 1 ? "s" : ""}`
            : "Chargement..."}
        </p>
      </div>

      {/* Instantly Connection Status */}
      {!connected && (
        <div
          className="rounded-xl p-5 mb-6 flex items-center gap-3"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
        >
          <span className="text-2xl">{"\u26A0\uFE0F"}</span>
          <div>
            <p className="text-sm font-medium" style={{ color: "#f59e0b" }}>
              Instantly non connect{"\u00E9"}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              {campaignData?.error ?? "Configurez INSTANTLY_API_KEY et INSTANTLY_CAMPAIGN_ID dans .env.local"}
            </p>
          </div>
        </div>
      )}

      {/* Active Campaign Card — real data from Instantly */}
      {connected && activeCampaign && (
        <CampaignCard campaign={activeCampaign} isActive />
      )}

      {/* Global Totals (across all campaigns) */}
      {connected && allCampaigns.length > 0 && (
        <div
          className="rounded-xl p-6 mb-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3 className="font-semibold mb-4">{"\u{1F4CA}"} Totaux Instantly (toutes campagnes)</h3>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <MetricBox label="Leads charg\u00E9s" value={totals.totalLeads.toLocaleString()} color="#6366f1" />
            <MetricBox label="Contact\u00E9s" value={totals.contacted.toLocaleString()} color="#818cf8" />
            <MetricBox label="Emails envoy\u00E9s" value={totals.emailsSent.toLocaleString()} color="#8b5cf6" />
            <MetricBox label="Ouverts" value={totals.emailsRead.toLocaleString()} color="#22c55e" />
            <MetricBox label="R\u00E9pondu" value={totals.replied.toLocaleString()} color="#f59e0b" />
            <MetricBox label="Bounced" value={totals.bounced.toLocaleString()} color="#ef4444" />
          </div>
        </div>
      )}

      {/* All Campaigns List */}
      {connected && allCampaigns.length > 1 && (
        <div
          className="rounded-xl p-6 mb-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3 className="font-semibold mb-4">{"\u{1F4CB}"} Toutes les campagnes ({allCampaigns.length})</h3>
          <div className="space-y-3">
            {allCampaigns.map((camp) => (
              <CampaignCard
                key={camp.id}
                campaign={camp}
                isActive={camp.id === campaignData?.activeCampaignId}
                compact
              />
            ))}
          </div>
        </div>
      )}

      {/* Supabase leads ready for campaign — from stats */}
      {stats && (
        <div
          className="rounded-xl p-6 mb-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3 className="font-semibold mb-4">{"\u{1F4E5}"} Leads Supabase pr{"\u00EA"}ts pour campagne</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <MetricBox label="Total leads" value={stats.totalLeads.toLocaleString()} color="#6366f1" />
            <MetricBox label="Avec email" value={stats.withEmail.toLocaleString()} color="#22c55e" />
            <MetricBox label="Avec site web" value={stats.withWebsite.toLocaleString()} color="#818cf8" />
            <MetricBox label="Taux email" value={`${stats.emailRate}%`} color={stats.emailRate > 5 ? "#22c55e" : "#f59e0b"} />
          </div>

          {stats.withEmail === 0 ? (
            <StatusBanner
              icon={"\u23F3"}
              color="#f59e0b"
              title="Enrichissement en cours"
              text={`Le script enrichit ${stats.withWebsite.toLocaleString()} sites web. Les emails appara\u00EEtront automatiquement.`}
            />
          ) : stats.withEmail > 0 && !connected ? (
            <StatusBanner
              icon={"\u2705"}
              color="#22c55e"
              title={`${stats.withEmail.toLocaleString()} emails pr\u00EAts`}
              text="Configurez Instantly pour lancer l'upload et la campagne."
            />
          ) : stats.withEmail > 0 && connected ? (
            <StatusBanner
              icon={"\u{1F680}"}
              color="#22c55e"
              title={`${stats.withEmail.toLocaleString()} emails dans Supabase`}
              text="Utilisez le script instantly_uploader.py pour les envoyer dans Instantly."
            />
          ) : null}
        </div>
      )}

      {/* Top Verticales for Campaign */}
      {topCategories.length > 0 && stats && (
        <div
          className="rounded-xl p-6 mb-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3 className="font-semibold mb-4">{"\u{1F4CA}"} R{"\u00E9"}partition par Verticale</h3>
          <div className="space-y-3">
            {topCategories.map((cat) => {
              const pct = stats.totalLeads > 0 ? Math.round((cat.total / stats.totalLeads) * 100) : 0;
              return (
                <div key={cat.name} className="flex items-center gap-3">
                  <span className="text-xs w-48 truncate" style={{ color: "var(--muted)" }}>{cat.name}</span>
                  <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: "var(--background)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: "linear-gradient(90deg, #6366f1, #818cf8)" }}
                    />
                  </div>
                  <span className="text-xs font-bold w-12 text-right">{cat.total}</span>
                  <span className="text-xs w-12 text-right" style={{ color: cat.withEmail > 0 ? "#22c55e" : "var(--muted)" }}>
                    {cat.withEmail > 0 ? `${cat.withEmail} \u2709` : "-"}
                  </span>
                </div>
              );
            })}
            {categoryEmailRates.length > 5 && (
              <p className="text-[10px] text-center pt-2" style={{ color: "var(--muted)" }}>
                +{categoryEmailRates.length - 5} autres verticales
              </p>
            )}
          </div>
        </div>
      )}

      {/* Sequence */}
      <div
        className="rounded-xl p-6"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h3 className="font-semibold mb-4">{"\u{1F4DD}"} S{"\u00E9"}quence Email</h3>
        <div className="space-y-3">
          <SequenceStep
            step={1}
            delay="J+0"
            subject="[Pr\u00E9nom], votre standard t\u00E9l\u00E9phonique perd des clients"
            preview="Chaque appel manqu\u00E9 = un client perdu. AVA est une IA qui r\u00E9pond 24/7..."
          />
          <SequenceStep
            step={2}
            delay="J+3"
            subject="Re: {{company}} \u2014 ce que j'ai observ\u00E9 sur votre site"
            preview="J'ai regard\u00E9 votre site et j'ai not\u00E9 que..."
          />
          <SequenceStep
            step={3}
            delay="J+7"
            subject="Derni\u00E8re question rapide"
            preview="Juste un dernier message \u2014 est-ce que le sujet vous int\u00E9resse ? Un oui/non suffit."
          />
        </div>
      </div>
    </div>
  );
}

/* ====================== Sub-components ====================== */

function CampaignCard({
  campaign,
  isActive = false,
  compact = false,
}: {
  campaign: Campaign;
  isActive?: boolean;
  compact?: boolean;
}) {
  const a = campaign.analytics;
  const statusColor = {
    active: "#22c55e",
    paused: "#f59e0b",
    completed: "#6366f1",
    drafts: "#818cf8",
  }[campaign.status] ?? "var(--muted)";

  const statusLabel = {
    active: "Active",
    paused: "En pause",
    completed: "Termin\u00E9e",
    drafts: "Brouillon",
  }[campaign.status] ?? campaign.status;

  if (compact) {
    return (
      <div
        className="p-4 rounded-lg flex items-center justify-between"
        style={{
          background: isActive ? "rgba(99,102,241,0.06)" : "var(--background)",
          border: isActive ? "1px solid rgba(99,102,241,0.2)" : "1px solid transparent",
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: statusColor }}
          />
          <div>
            <p className="text-sm font-medium">
              {campaign.name}
              {isActive && (
                <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                  Active
                </span>
              )}
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {a.totalLeads} leads \u2022 {a.emailsSent} envoy\u00E9s \u2022 {a.replied} r\u00E9ponses \u2022 {a.openRate}% open
            </p>
          </div>
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ background: `${statusColor}20`, color: statusColor }}
        >
          {statusLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-6 mb-6"
      style={{
        background: "var(--card)",
        border: isActive ? "1px solid rgba(99,102,241,0.3)" : "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            {campaign.name}
            {isActive && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
                Campagne principale
              </span>
            )}
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            ID: {campaign.id.slice(0, 12)}... \u2022 Cr{"\u00E9\u00E9"}e le{" "}
            {campaign.createdAt ? new Date(campaign.createdAt).toLocaleDateString("fr-FR") : "N/A"}
          </p>
        </div>
        <span
          className="text-xs font-medium px-3 py-1 rounded-full"
          style={{ background: `${statusColor}20`, color: statusColor }}
        >
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <MetricBox label="Leads" value={a.totalLeads.toLocaleString()} color="#6366f1" />
        <MetricBox label="Envoy\u00E9s" value={a.emailsSent.toLocaleString()} color="#818cf8" />
        <MetricBox label="Ouverts" value={a.emailsRead.toLocaleString()} color="#22c55e" />
        <MetricBox label="R\u00E9pondu" value={a.replied.toLocaleString()} color="#f59e0b" />
        <MetricBox label="Open rate" value={`${a.openRate}%`} color={a.openRate > 30 ? "#22c55e" : "#818cf8"} />
        <MetricBox label="Reply rate" value={`${a.replyRate}%`} color={a.replyRate > 5 ? "#22c55e" : "#818cf8"} />
      </div>
    </div>
  );
}

function MetricBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{label}</p>
    </div>
  );
}

function StatusBanner({ icon, color, title, text }: { icon: string; color: string; title: string; text: string }) {
  return (
    <div
      className="p-3 rounded-lg flex items-center gap-2"
      style={{ background: `${color}12`, border: `1px solid ${color}33` }}
    >
      <span>{icon}</span>
      <p className="text-xs" style={{ color }}>
        <strong>{title}.</strong> {text}
      </p>
    </div>
  );
}

function SequenceStep({
  step,
  delay,
  subject,
  preview,
}: {
  step: number;
  delay: string;
  subject: string;
  preview: string;
}) {
  return (
    <div
      className="p-4 rounded-lg flex gap-4"
      style={{ background: "var(--background)" }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {step}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-medium">{subject}</p>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{ background: "rgba(99,102,241,0.1)", color: "var(--accent-light)" }}
          >
            {delay}
          </span>
        </div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>{preview}</p>
      </div>
    </div>
  );
}
