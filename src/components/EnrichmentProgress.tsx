"use client";

import { getCategoryEmailRates } from "@/lib/data";
import type { CategoryRate } from "@/lib/data";

export function EnrichmentProgress() {
  const rates: CategoryRate[] = getCategoryEmailRates();
  const colors = [
    "#6366f1", "#818cf8", "#a78bfa", "#c084fc", "#e879f9",
    "#f472b6", "#fb7185", "#f97316", "#fbbf24", "#22c55e",
    "#06b6d4", "#14b8a6", "#8b5cf6", "#ec4899", "#84cc16",
    "#f59e0b", "#ef4444", "#3b82f6", "#10b981", "#d946ef",
  ];

  return (
    <div
      className="rounded-xl p-6"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold">Enrichissement par Verticale</h3>
        <span className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
          {rates.length} catégories
        </span>
      </div>

      <div className="space-y-2">
        {rates.map((cat, i) => {
          const barWidth = Math.max(cat.rate, 2);
          return (
            <div key={cat.name} className="group">
              <div className="flex items-center gap-3">
                <span className="text-[11px] w-44 truncate" style={{ color: "var(--muted)" }}>
                  {cat.name}
                </span>
                <div className="flex-1 relative">
                  <div className="h-5 rounded-full overflow-hidden" style={{ background: "var(--background)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${barWidth}%`,
                        background: `linear-gradient(90deg, ${colors[i % colors.length]}, ${colors[i % colors.length]}99)`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 w-24 justify-end">
                  <span className="text-xs font-bold" style={{ color: colors[i % colors.length] }}>
                    {cat.withEmail}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                    /{cat.total}
                  </span>
                  <span className="text-[10px] font-medium" style={{ color: cat.rate > 50 ? "#22c55e" : cat.rate > 20 ? "#f59e0b" : "#ef4444" }}>
                    {cat.rate}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
