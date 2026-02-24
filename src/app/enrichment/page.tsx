"use client";

import { useStats } from "@/lib/useStats";

export default function EnrichmentPage() {
  const { data, loading } = useStats();

  if (loading || !data) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: "var(--muted)" }}>Chargement enrichissement...</div>
      </div>
    );
  }

  const { stats, enrichment, categoryEmailRates } = data;

  return (
    <div className="p-6 max-w-full">
      <div className="mb-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          {"\u{1F50D}"} Enrichissement Emails
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
          >
            GRATUIT
          </span>
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Scraping web automatique : Site web &rarr; Pages contact &rarr; Extraction emails &rarr; Validation
        </p>
      </div>

      {/* Pipeline visual */}
      <div
        className="rounded-xl p-6 mb-6"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h3 className="font-semibold mb-4">{"\u{1F504}"} Pipeline d&apos;enrichissement</h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <PipelineStep step={1} title="Leads scrapp&eacute;s" desc="Google Maps / Apify" count={stats.totalLeads} color="#6366f1" />
          <Arrow />
          <PipelineStep step={2} title="Avec site web" desc="Sites &agrave; scraper" count={stats.withWebsite} color="#818cf8" />
          <Arrow />
          <PipelineStep step={3} title="Email trouv&eacute;" desc="Scraping web gratuit" count={stats.withEmail} color="#22c55e" />
          <Arrow />
          <PipelineStep step={4} title="Pr&ecirc;t Instantly" desc="Upload campagne" count={stats.withEmail} color="#f59e0b" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatBox label="Leads total" value={stats.totalLeads.toLocaleString()} color="#6366f1" icon={"\u{1F3E2}"} />
        <StatBox label="Avec site web" value={stats.withWebsite.toLocaleString()} color="#818cf8" icon={"\u{1F310}"} />
        <StatBox label="Emails trouv&eacute;s" value={stats.withEmail.toLocaleString()} color="#22c55e" icon={"\u{1F4E7}"} />
        <StatBox label="Taux enrichissement" value={`${stats.emailRate}%`} color="#f59e0b" icon={"\u{1F4C8}"} />
      </div>

      {/* Method card */}
      <div
        className="rounded-xl p-6 mb-6"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h3 className="font-semibold mb-4">{"\u{1F6E0}\u{FE0F}"} M&eacute;thode d&apos;enrichissement</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{"\u{1F310}"}</span>
              <span className="text-sm font-bold" style={{ color: "#22c55e" }}>Scraping Web Gratuit</span>
            </div>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {enrichment.method}
            </p>
            <div className="mt-3 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span style={{ color: "#22c55e" }}>{"\u2713"}</span>
                <span style={{ color: "var(--muted)" }}>Visite page d&apos;accueil + /contact + /mentions-legales</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span style={{ color: "#22c55e" }}>{"\u2713"}</span>
                <span style={{ color: "var(--muted)" }}>Extraction emails par regex avanc&eacute;e</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span style={{ color: "#22c55e" }}>{"\u2713"}</span>
                <span style={{ color: "var(--muted)" }}>Filtrage noreply@, webmaster@, etc.</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span style={{ color: "#22c55e" }}>{"\u2713"}</span>
                <span style={{ color: "var(--muted)" }}>Priorisation : direction@ &gt; contact@ &gt; info@</span>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg" style={{ background: "var(--background)" }}>
            <h4 className="text-sm font-medium mb-3">{"\u{1F4B0}"} Co&ucirc;t</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "var(--muted)" }}>Scraping web</span>
                <span className="text-sm font-bold" style={{ color: "#22c55e" }}>0 EUR</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: "var(--muted)" }}>API externe</span>
                <span className="text-sm font-bold" style={{ color: "#22c55e" }}>0 EUR</span>
              </div>
              <div className="flex justify-between items-center pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <span className="text-xs font-medium">Total</span>
                <span className="text-lg font-black" style={{ color: "#22c55e" }}>{enrichment.cost}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* By category */}
      <div
        className="rounded-xl p-6"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h3 className="font-semibold mb-4">{"\u{1F4CA}"} Enrichissement par cat&eacute;gorie</h3>
        <div className="space-y-2">
          {categoryEmailRates.map((cat) => (
            <div key={cat.name} className="flex items-center gap-3">
              <span className="text-[11px] w-48 truncate" style={{ color: "var(--muted)" }}>
                {cat.name}
              </span>
              <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: "var(--background)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(cat.rate, 1)}%`,
                    background: cat.rate > 50 ? "#22c55e" : cat.rate > 20 ? "#f59e0b" : "#6366f1",
                  }}
                />
              </div>
              <span className="text-xs font-bold w-12 text-right" style={{ color: cat.rate > 0 ? "#22c55e" : "var(--muted)" }}>
                {cat.withEmail}/{cat.total}
              </span>
              <span className="text-[10px] w-10 text-right" style={{ color: cat.rate > 50 ? "#22c55e" : cat.rate > 20 ? "#f59e0b" : "var(--muted)" }}>
                {cat.rate}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PipelineStep({ step, title, desc, count, color }: { step: number; title: string; desc: string; count: number; color: string }) {
  return (
    <div className="p-4 rounded-xl min-w-40 text-center shrink-0" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
      <div className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center text-xs font-bold" style={{ background: color, color: "white" }}>{step}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{desc}</p>
      <p className="text-lg font-bold mt-2" style={{ color }}>{count.toLocaleString()}</p>
    </div>
  );
}

function Arrow() {
  return <div className="text-xl shrink-0" style={{ color: "var(--muted)" }}>&rarr;</div>;
}

function StatBox({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div className="p-4 rounded-xl text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <span className="text-2xl">{icon}</span>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{label}</p>
    </div>
  );
}
