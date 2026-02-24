"use client";

interface ScoreDistProps {
  high: number;
  medium: number;
  low: number;
  avgScore: number;
  avgRating: number;
  totalReviews: number;
}

export function ScoreDistribution({ high, medium, low, avgScore, avgRating, totalReviews }: ScoreDistProps) {
  const total = high + medium + low;
  const highPct = total > 0 ? Math.round((high / total) * 100) : 0;
  const medPct = total > 0 ? Math.round((medium / total) * 100) : 0;
  const lowPct = total > 0 ? Math.round((low / total) * 100) : 0;

  return (
    <div
      className="rounded-xl p-6"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-lg font-semibold mb-5">Qualité des Leads</h3>

      {/* Score arc visualization */}
      <div className="flex items-center justify-center gap-8 mb-6">
        <div className="text-center">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black"
            style={{
              background: "conic-gradient(#22c55e 0% " + highPct + "%, #f59e0b " + highPct + "% " + (highPct + medPct) + "%, #ef4444 " + (highPct + medPct) + "% 100%)",
              boxShadow: "inset 0 0 0 8px var(--card)",
            }}
          >
            <span className="bg-[var(--card)] w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold">
              {avgScore}
            </span>
          </div>
          <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>Score Moyen</p>
        </div>

        <div className="text-center">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              background: "conic-gradient(#fbbf24 0% " + Math.round(avgRating / 5 * 100) + "%, var(--border) " + Math.round(avgRating / 5 * 100) + "% 100%)",
              boxShadow: "inset 0 0 0 8px var(--card)",
            }}
          >
            <span className="bg-[var(--card)] w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold" style={{ color: "#fbbf24" }}>
              {avgRating}
            </span>
          </div>
          <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>Note Google</p>
        </div>

        <div className="text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "var(--background)", border: "2px solid var(--border)" }}>
            <span className="text-lg font-bold" style={{ color: "#818cf8" }}>
              {totalReviews > 1000 ? Math.round(totalReviews / 1000) + "K" : totalReviews}
            </span>
          </div>
          <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>Avis Google</p>
        </div>
      </div>

      {/* Score bars */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xs w-28" style={{ color: "var(--muted)" }}>Score &ge; 80</span>
          <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: "var(--background)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${highPct}%`, background: "linear-gradient(90deg, #22c55e, #16a34a)" }}
            />
          </div>
          <span className="text-sm font-bold w-16 text-right" style={{ color: "#22c55e" }}>
            {high.toLocaleString()}
          </span>
          <span className="text-xs w-10 text-right" style={{ color: "var(--muted)" }}>{highPct}%</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs w-28" style={{ color: "var(--muted)" }}>Score 50-79</span>
          <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: "var(--background)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${medPct}%`, background: "linear-gradient(90deg, #f59e0b, #d97706)" }}
            />
          </div>
          <span className="text-sm font-bold w-16 text-right" style={{ color: "#f59e0b" }}>
            {medium.toLocaleString()}
          </span>
          <span className="text-xs w-10 text-right" style={{ color: "var(--muted)" }}>{medPct}%</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs w-28" style={{ color: "var(--muted)" }}>Score &lt; 50</span>
          <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: "var(--background)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.max(lowPct, 1)}%`, background: "linear-gradient(90deg, #ef4444, #dc2626)" }}
            />
          </div>
          <span className="text-sm font-bold w-16 text-right" style={{ color: "#ef4444" }}>
            {low.toLocaleString()}
          </span>
          <span className="text-xs w-10 text-right" style={{ color: "var(--muted)" }}>{lowPct}%</span>
        </div>
      </div>
    </div>
  );
}
