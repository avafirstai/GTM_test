"use client";

import { useStats } from "@/lib/useStats";

export default function ScrapingPage() {
  const { data, loading } = useStats();

  if (loading || !data) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: "var(--muted)" }}>Chargement scraping...</div>
      </div>
    );
  }

  const { stats, apifyRuns } = data;
  const totalQueries = apifyRuns.reduce((s, r) => s + r.queriesCount, 0);
  const totalResults = apifyRuns.reduce((s, r) => s + (r.resultsCount ?? 0), 0);
  const succeededRuns = apifyRuns.filter((r) => r.status === "SUCCEEDED").length;
  const progressPct = Math.round((totalQueries / 930) * 100);
  const villeEntries = Object.entries(stats.byVille).sort((a, b) => b[1] - a[1]);
  const verticaleEntries = Object.entries(stats.byVerticale).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6 max-w-full">
      <div className="mb-6">
        <h1 className="text-xl font-bold">{"\u{1F577}\u{FE0F}"} Scraping &amp; Sources</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Apify Google Maps &bull; {totalQueries}/930 requ&ecirc;tes &bull; {villeEntries.length} villes &times; {verticaleEntries.length} cat&eacute;gories
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatBox label="Requ\u00eates lanc\u00e9es" value={String(totalQueries)} color="#6366f1" />
        <StatBox label={`Runs (${succeededRuns}/${apifyRuns.length})`} value={String(apifyRuns.length)} color="#22c55e" />
        <StatBox label="Leads uniques" value={stats.totalLeads.toLocaleString()} color="#22c55e" />
        <StatBox label="Restantes" value={String(930 - totalQueries)} color="#f59e0b" />
      </div>

      <div className="rounded-xl p-6 mb-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-semibold">{"\u{1F4CA}"} Progression Scraping</h3>
          <span className="text-sm font-bold" style={{ color: "#6366f1" }}>{progressPct}%</span>
        </div>
        <div className="w-full h-3 rounded-full" style={{ background: "var(--background)" }}>
          <div className="h-3 rounded-full transition-all duration-700" style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #6366f1, #818cf8)" }} />
        </div>
        <div className="flex justify-between mt-2">
          <p className="text-xs" style={{ color: "var(--muted)" }}>{totalQueries} requ&ecirc;tes &rarr; {totalResults.toLocaleString()} r&eacute;sultats</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>{930 - totalQueries} restantes</p>
        </div>
      </div>

      <div className="rounded-xl p-6 mb-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h3 className="font-semibold mb-4">{"\u{1F4E6}"} Runs Apify ({apifyRuns.length} runs)</h3>
        <div className="space-y-3">
          {apifyRuns.map((run) => (
            <RunCard key={run.runId} runId={run.runId} datasetId={run.datasetId} status={run.status} queries={run.queriesCount} results={run.resultsCount ?? 0} verticale={run.verticale} />
          ))}
        </div>
      </div>

      <div className="rounded-xl p-6 mb-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h3 className="font-semibold mb-4">{"\u{1F5FA}\u{FE0F}"} Couverture G&eacute;ographique ({villeEntries.length} villes)</h3>
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {villeEntries.map(([ville, count]) => (
            <div key={ville} className="p-2 rounded-lg text-center" style={{ background: "var(--background)" }}>
              <p className="text-sm font-bold" style={{ color: "#6366f1" }}>{count.toLocaleString()}</p>
              <p className="text-[10px]" style={{ color: "var(--muted)" }}>{ville}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <h3 className="font-semibold mb-4">{"\u{1F3F7}\u{FE0F}"} Cat&eacute;gories Google Maps ({verticaleEntries.length} verticales)</h3>
        <div className="flex flex-wrap gap-2">
          {verticaleEntries.map(([cat, count]) => (
            <span key={cat} className="text-xs px-3 py-1.5 rounded-full" style={{ background: "rgba(99,102,241,0.1)", color: "var(--accent-light)" }}>
              {cat} ({count})
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-4 rounded-xl text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{label}</p>
    </div>
  );
}

function RunCard({ runId, datasetId, status, queries, results, verticale }: { runId: string; datasetId: string; status: string; queries: number; results: number; verticale: string }) {
  const statusColor = status === "SUCCEEDED" ? "#22c55e" : status === "RUNNING" ? "#f59e0b" : "#ef4444";
  return (
    <div className="p-4 rounded-lg flex items-center justify-between" style={{ background: "var(--background)" }}>
      <div>
        <p className="text-sm font-medium">{verticale}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>Run: {runId.substring(0, 8)}... | Dataset: {datasetId.substring(0, 8)}...</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-bold">{results.toLocaleString()}</p>
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>{queries} queries</p>
        </div>
        <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ background: `${statusColor}20`, color: statusColor }}>{status}</span>
      </div>
    </div>
  );
}
