"use client";

import { StatCard } from "@/components/StatCard";
import { Pipeline } from "@/components/Pipeline";
import { VerticaleChart } from "@/components/VerticaleChart";
import { ScrapingStatus } from "@/components/ScrapingStatus";
import { CampaignTable } from "@/components/CampaignTable";
import { EmailFunnel } from "@/components/EmailFunnel";
import { GeoMap } from "@/components/GeoMap";
import { ScoreDistribution } from "@/components/ScoreDistribution";
import { EnrichmentProgress } from "@/components/EnrichmentProgress";
import { useStats } from "@/lib/useStats";

export default function Dashboard() {
  const { data, loading } = useStats();

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-sm" style={{ color: "var(--muted)" }}>Chargement du dashboard...</p>
        </div>
      </div>
    );
  }

  const { stats, pipeline, apifyRuns, enrichment } = data;

  const campaigns = [
    {
      name: "France B2B — Toutes Verticales — Séquence 1",
      status: "paused" as const,
      totalLeads: stats.withEmail,
      sent: 0,
      opened: 0,
      replied: 0,
      booked: 0,
    },
  ];

  return (
    <div className="min-h-screen p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">AVA GTM Command Center</h1>
            <span
              className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider animate-pulse"
              style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
            >
              LIVE
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Growth Machine B2B France — {stats.totalLeads.toLocaleString()} leads
            {" "}&bull;{" "}
            {Object.keys(stats.byVerticale).length} verticales
            {" "}&bull;{" "}
            {Object.keys(stats.byVille).length} villes
            {stats.lastUpdated && (
              <>
                {" "}&bull;{" "}
                <span style={{ color: "#22c55e" }}>
                  MAJ: {stats.lastUpdated}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Dernière mise à jour
          </p>
          <p className="text-sm font-medium">{stats.lastUpdated}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
            Coût total: <span className="font-bold" style={{ color: "#22c55e" }}>0 EUR</span>
          </p>
        </div>
      </div>

      {/* Hero Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Leads"
          value={stats.totalLeads.toLocaleString()}
          icon="👥"
          color="#6366f1"
          subtitle={`Score moyen: ${stats.avgScore} • Note: ${stats.avgRating}/5`}
        />
        <StatCard
          title="Emails Trouvés"
          value={stats.withEmail.toLocaleString()}
          icon="📧"
          color={stats.withEmail > 0 ? "#22c55e" : "#f59e0b"}
          subtitle={`${stats.emailRate}% taux enrichissement`}
          trend={stats.withEmail > 0 ? { value: stats.emailRate, label: "enrichis" } : undefined}
        />
        <StatCard
          title="Avec Téléphone"
          value={stats.withPhone.toLocaleString()}
          icon="📞"
          color="#22c55e"
          subtitle={`${stats.phoneRate}% des leads`}
        />
        <StatCard
          title="Avec Site Web"
          value={stats.withWebsite.toLocaleString()}
          icon="🌐"
          color="#818cf8"
          subtitle={`${stats.websiteRate}% des leads`}
        />
      </div>

      {/* Score + Priority Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Leads Prioritaires"
          value={stats.highScore.toLocaleString()}
          icon="🔥"
          color="#ef4444"
          subtitle="Score ≥ 80"
        />
        <StatCard
          title="Standard"
          value={stats.mediumScore.toLocaleString()}
          icon="📋"
          color="#f59e0b"
          subtitle="Score 50-79"
        />
        <StatCard
          title="Avis Google Total"
          value={stats.totalReviews > 1000 ? `${(stats.totalReviews / 1000).toFixed(0)}K` : stats.totalReviews.toLocaleString()}
          icon="⭐"
          color="#fbbf24"
          subtitle={`Note moyenne: ${stats.avgRating}/5`}
        />
        <StatCard
          title="Scraping Runs"
          value="11/11"
          icon="🕷️"
          color="#a78bfa"
          subtitle="600/930 requêtes exécutées"
        />
      </div>

      {/* Enrichment Funnel + Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <EmailFunnel
          total={stats.totalLeads}
          withWebsite={stats.withWebsite}
          withEmail={stats.withEmail}
          withPhone={stats.withPhone}
        />
        <Pipeline stages={pipeline} />
      </div>

      {/* Score Distribution + Enrichment Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ScoreDistribution
          high={stats.byScore.high}
          medium={stats.byScore.medium}
          low={stats.byScore.low}
          avgScore={stats.avgScore}
          avgRating={stats.avgRating}
          totalReviews={stats.totalReviews}
        />
        {/* Enrichment Method Card */}
        <div
          className="rounded-xl p-6"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h3 className="text-lg font-semibold mb-5">Enrichissement Email</h3>

          <div className="space-y-4">
            <div className="p-4 rounded-lg" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🆓</span>
                <span className="text-sm font-bold" style={{ color: "#22c55e" }}>Méthode: Scraping Web Gratuit</span>
              </div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {enrichment.method}
              </p>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="text-center">
                  <p className="text-xl font-bold" style={{ color: "#22c55e" }}>{enrichment.totalEmailsFound.toLocaleString()}</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>Emails trouvés</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold" style={{ color: "#818cf8" }}>{enrichment.totalLeadsProcessed.toLocaleString()}</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>Leads traités</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold" style={{ color: "#22c55e" }}>{enrichment.cost}</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>Coût total</p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg" style={{ background: "var(--background)" }}>
              <p className="text-xs font-medium mb-2">Prochaines étapes</p>
              <div className="space-y-2">
                {[
                  { icon: "⏳", text: "Scraping emails en cours...", status: "running" },
                  { icon: "📤", text: "Upload Instantly par verticale", status: "pending" },
                  { icon: "✉️", text: "Lancer séquences email", status: "pending" },
                  { icon: "📊", text: "Suivre open/reply rates", status: "pending" },
                ].map((step) => (
                  <div key={step.text} className="flex items-center gap-2">
                    <span className="text-sm">{step.icon}</span>
                    <span className="text-xs flex-1" style={{ color: step.status === "running" ? "#f59e0b" : "var(--muted)" }}>
                      {step.text}
                    </span>
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background: step.status === "running" ? "rgba(245,158,11,0.15)" : "rgba(115,115,115,0.15)",
                        color: step.status === "running" ? "#f59e0b" : "#737373",
                      }}
                    >
                      {step.status === "running" ? "EN COURS" : "À FAIRE"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Campaigns */}
      <div className="mb-6">
        <CampaignTable campaigns={campaigns} />
      </div>

      {/* Enrichment by Verticale (full width) */}
      <div className="mb-6">
        <EnrichmentProgress rates={data.categoryEmailRates} />
      </div>

      {/* Verticales + Geo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <VerticaleChart data={stats.byVerticale} />
        <GeoMap data={stats.byVille} />
      </div>

      {/* Scraping Status */}
      <div className="mb-6">
        <ScrapingStatus runs={apifyRuns} />
      </div>

      {/* Footer */}
      <div className="text-center py-6">
        <div
          className="inline-flex items-center gap-4 px-6 py-3 rounded-xl"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="text-left">
            <p className="text-xs font-bold">AVA AI Growth Machine</p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>
              Apify + Web Scraping + Instantly &bull; Pipeline 100% automatisé
            </p>
          </div>
          <div className="w-px h-8" style={{ background: "var(--border)" }} />
          <div className="text-center">
            <p className="text-xs font-bold" style={{ color: "#22c55e" }}>Coût: 0 EUR</p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>100% gratuit</p>
          </div>
          <div className="w-px h-8" style={{ background: "var(--border)" }} />
          <div className="text-center">
            <p className="text-xs font-bold" style={{ color: "#818cf8" }}>{stats.totalLeads.toLocaleString()} leads</p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>{Object.keys(stats.byVille).length} villes France</p>
          </div>
        </div>
      </div>
    </div>
  );
}
