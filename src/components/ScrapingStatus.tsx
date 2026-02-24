"use client";

interface ApifyRun {
  runId: string;
  datasetId: string;
  status: string;
  queriesCount: number;
  verticale: string;
  resultsCount?: number;
}

export function ScrapingStatus({ runs }: { runs: ApifyRun[] }) {
  const statusColors: Record<string, string> = {
    SUCCEEDED: "#22c55e",
    RUNNING: "#f59e0b",
    READY: "#6366f1",
    FAILED: "#ef4444",
  };

  const statusIcons: Record<string, string> = {
    SUCCEEDED: "\u2705",
    RUNNING: "\u23F3",
    READY: "\uD83D\uDD04",
    FAILED: "\u274C",
  };

  return (
    <div
      className="rounded-xl p-6"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{"\uD83D\uDD77\uFE0F"} Scraping Apify — France</h3>
        <span
          className="text-xs px-2 py-1 rounded-full font-medium"
          style={{
            background: "rgba(99,102,241,0.15)",
            color: "#818cf8",
          }}
        >
          {runs.filter((r) => r.status === "RUNNING").length} en cours
        </span>
      </div>
      <div className="space-y-2">
        {runs.map((run) => (
          <div
            key={run.runId}
            className="flex items-center gap-3 p-3 rounded-lg"
            style={{ background: "var(--background)" }}
          >
            <span>{statusIcons[run.status] || "\u2753"}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{run.verticale}</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {run.queriesCount} requ{"\u00EA"}tes
                {run.resultsCount ? ` \u2022 ${run.resultsCount} r\u00E9sultats` : ""}
              </p>
            </div>
            <span
              className="text-xs font-medium px-2 py-1 rounded-full"
              style={{
                background: `${statusColors[run.status] || "#737373"}20`,
                color: statusColors[run.status] || "#737373",
              }}
            >
              {run.status}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 p-3 rounded-lg" style={{ background: "rgba(99,102,241,0.08)" }}>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {"\uD83D\uDCCD"} <strong>930 requ{"\u00EA"}tes</strong> planifi{"\u00E9"}es {"\u2022"} 30 villes {"\u00D7"} 31 cat{"\u00E9"}gories {"\u2022"}
          Objectif: 50K-100K entreprises France enti{"\u00E8"}re
        </p>
      </div>
    </div>
  );
}
