"use client";

import { useStats } from "@/lib/useStats";
import {
  Search,
  MapPin,
  Tag,
  CheckCircle,
  Clock,
  XCircle,
} from "lucide-react";

export default function ScrapingPage() {
  const { data, loading } = useStats();

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
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
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Scraping</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Apify Google Maps &middot; {totalQueries}/930 requetes &middot;{" "}
          {villeEntries.length} villes &times; {verticaleEntries.length} categories
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Requetes lancees" value={String(totalQueries)} />
        <StatCard label={`Runs (${succeededRuns}/${apifyRuns.length})`} value={String(apifyRuns.length)} accent="green" />
        <StatCard label="Leads uniques" value={stats.totalLeads.toLocaleString()} accent="green" />
        <StatCard label="Restantes" value={String(930 - totalQueries)} accent="amber" />
      </div>

      {/* Progress */}
      <div
        className="rounded-xl border border-[var(--border)] mb-6"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-medium">Progression</h2>
          </div>
          <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
            {progressPct}%
          </span>
        </div>
        <div className="p-5">
          <div
            className="w-full h-2 rounded-full"
            style={{ background: "var(--bg)" }}
          >
            <div
              className="h-2 rounded-full transition-all duration-700"
              style={{
                width: `${progressPct}%`,
                background: "var(--accent)",
              }}
            />
          </div>
          <div className="flex justify-between mt-2">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {totalQueries} requetes &rarr; {totalResults.toLocaleString()} resultats
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {930 - totalQueries} restantes
            </p>
          </div>
        </div>
      </div>

      {/* Runs */}
      <div
        className="rounded-xl border border-[var(--border)] mb-6"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">
            Runs Apify ({apifyRuns.length})
          </h2>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {apifyRuns.map((run) => (
            <RunRow
              key={run.runId}
              verticale={run.verticale}
              runId={run.runId}
              status={run.status}
              queries={run.queriesCount}
              results={run.resultsCount ?? 0}
            />
          ))}
        </div>
      </div>

      {/* Geo coverage */}
      <div
        className="rounded-xl border border-[var(--border)] mb-6"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
          <MapPin size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-medium">
            Couverture ({villeEntries.length} villes)
          </h2>
        </div>
        <div className="p-5 grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
          {villeEntries.map(([ville, count]) => (
            <div
              key={ville}
              className="p-2 rounded-lg text-center"
              style={{ background: "var(--bg)" }}
            >
              <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                {count.toLocaleString()}
              </p>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {ville}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Categories */}
      <div
        className="rounded-xl border border-[var(--border)]"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
          <Tag size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-medium">
            Categories ({verticaleEntries.length})
          </h2>
        </div>
        <div className="p-5 flex flex-wrap gap-2">
          {verticaleEntries.map(([cat, count]) => (
            <span
              key={cat}
              className="text-xs px-3 py-1.5 rounded-full"
              style={{
                background: "var(--accent-subtle)",
                color: "var(--accent-hover)",
              }}
            >
              {cat} ({count})
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <p className="text-center text-xs mt-10" style={{ color: "var(--text-muted)" }}>
        AVA GTM &middot; Scraping pipeline
      </p>
    </div>
  );
}

/* ---------- Sub-components ---------- */

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

function RunRow({
  verticale,
  runId,
  status,
  queries,
  results,
}: {
  verticale: string;
  runId: string;
  status: string;
  queries: number;
  results: number;
}) {
  const StatusIcon =
    status === "SUCCEEDED"
      ? CheckCircle
      : status === "RUNNING"
        ? Clock
        : XCircle;
  const statusColor =
    status === "SUCCEEDED"
      ? "var(--green)"
      : status === "RUNNING"
        ? "var(--amber)"
        : "var(--red)";

  return (
    <div className="px-5 py-3 flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{verticale}</p>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Run: {runId.substring(0, 8)}...
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-semibold">{results.toLocaleString()}</p>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {queries} queries
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusIcon size={14} style={{ color: statusColor }} />
          <span className="text-[11px] font-medium" style={{ color: statusColor }}>
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
