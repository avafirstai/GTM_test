"use client";

import { useStats } from "@/lib/useStats";
import {
  Zap,
  Globe,
  Mail,
  ArrowRight,
  CheckCircle,
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

  const { stats, enrichment, categoryEmailRates } = data;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Enrichissement</h1>
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: "var(--green-subtle)", color: "var(--green)" }}
          >
            Gratuit
          </span>
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Scraping web automatique : site &rarr; contact &rarr; email &rarr; validation
        </p>
      </div>

      {/* Pipeline */}
      <div
        className="rounded-xl border border-[var(--border)] mb-6"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
          <Zap size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-medium">Pipeline</h2>
        </div>
        <div className="flex items-center gap-2 p-5 overflow-x-auto">
          <PipelineStep
            icon={<Globe size={16} />}
            title="Leads scrappes"
            count={stats.totalLeads}
          />
          <ArrowRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          <PipelineStep
            icon={<Globe size={16} />}
            title="Avec site web"
            count={stats.withWebsite}
          />
          <ArrowRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          <PipelineStep
            icon={<Mail size={16} />}
            title="Email trouve"
            count={stats.withEmail}
            accent
          />
          <ArrowRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          <PipelineStep
            icon={<CheckCircle size={16} />}
            title="Pret Instantly"
            count={stats.withEmail}
            accent
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Leads total" value={stats.totalLeads.toLocaleString()} />
        <StatCard label="Avec site web" value={stats.withWebsite.toLocaleString()} />
        <StatCard label="Emails trouves" value={stats.withEmail.toLocaleString()} accent="green" />
        <StatCard label="Taux enrichissement" value={`${stats.emailRate}%`} accent={stats.emailRate > 5 ? "green" : "amber"} />
      </div>

      {/* Method */}
      <div
        className="rounded-xl border border-[var(--border)] mb-6"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">Methode</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
          <div
            className="p-4 rounded-lg"
            style={{ background: "var(--green-subtle)", border: "1px solid rgba(34,197,94,0.15)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Globe size={16} style={{ color: "var(--green)" }} />
              <span className="text-sm font-medium" style={{ color: "var(--green)" }}>
                Scraping web gratuit
              </span>
            </div>
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              {enrichment.method}
            </p>
            <div className="space-y-1.5">
              {[
                "Visite page d'accueil + /contact + /mentions-legales",
                "Extraction emails par regex avancee",
                "Filtrage noreply@, webmaster@, etc.",
                "Priorisation : direction@ > contact@ > info@",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs">
                  <CheckCircle size={12} style={{ color: "var(--green)" }} />
                  <span style={{ color: "var(--text-secondary)" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-lg" style={{ background: "var(--bg)" }}>
            <h4 className="text-sm font-medium mb-4">Cout</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>Scraping web</span>
                <span className="text-sm font-semibold" style={{ color: "var(--green)" }}>0 EUR</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>API externe</span>
                <span className="text-sm font-semibold" style={{ color: "var(--green)" }}>0 EUR</span>
              </div>
              <div
                className="flex justify-between items-center pt-3"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <span className="text-xs font-medium">Total</span>
                <span className="text-lg font-bold" style={{ color: "var(--green)" }}>
                  {enrichment.cost}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* By category */}
      <div
        className="rounded-xl border border-[var(--border)]"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">Par categorie</h2>
        </div>
        <div className="p-5 space-y-2.5">
          {categoryEmailRates.map((cat) => (
            <div key={cat.name} className="flex items-center gap-3">
              <span
                className="text-[11px] w-44 truncate"
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
                className="text-xs font-medium w-12 text-right"
                style={{
                  color: cat.rate > 0 ? "var(--green)" : "var(--text-muted)",
                }}
              >
                {cat.withEmail}/{cat.total}
              </span>
              <span
                className="text-[11px] w-10 text-right"
                style={{
                  color:
                    cat.rate > 50
                      ? "var(--green)"
                      : cat.rate > 20
                        ? "var(--amber)"
                        : "var(--text-muted)",
                }}
              >
                {cat.rate}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <p className="text-center text-xs mt-10" style={{ color: "var(--text-muted)" }}>
        AVA GTM &middot; Enrichissement automatise
      </p>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function PipelineStep({
  icon,
  title,
  count,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  accent?: boolean;
}) {
  return (
    <div
      className="p-4 rounded-lg min-w-36 text-center shrink-0"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
      }}
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
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "amber";
}) {
  const colorMap = { green: "var(--green)", amber: "var(--amber)" };
  return (
    <div
      className="rounded-lg p-4 border border-[var(--border)]"
      style={{ background: "var(--bg-raised)" }}
    >
      <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className="text-xl font-semibold mt-1"
        style={accent ? { color: colorMap[accent] } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
