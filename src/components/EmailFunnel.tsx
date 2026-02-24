"use client";

import { useMemo } from "react";

interface FunnelProps {
  total: number;
  withWebsite: number;
  withEmail: number;
  withPhone: number;
}

export function EmailFunnel({ total, withWebsite, withEmail, withPhone }: FunnelProps) {
  const stages = useMemo(
    () => [
      { label: "Leads Scrappés", count: total, color: "#6366f1", pct: 100 },
      { label: "Avec Téléphone", count: withPhone, color: "#818cf8", pct: total > 0 ? Math.round((withPhone / total) * 100) : 0 },
      { label: "Avec Site Web", count: withWebsite, color: "#a78bfa", pct: total > 0 ? Math.round((withWebsite / total) * 100) : 0 },
      { label: "Email Trouvé", count: withEmail, color: "#22c55e", pct: total > 0 ? Math.round((withEmail / total) * 100) : 0 },
    ],
    [total, withWebsite, withEmail, withPhone]
  );

  return (
    <div
      className="rounded-xl p-6"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold">Funnel Enrichissement</h3>
        <span
          className="text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
        >
          {stages[3].pct}% conversion
        </span>
      </div>

      <div className="space-y-3">
        {stages.map((stage, i) => {
          const widthPct = total > 0 ? Math.max((stage.count / total) * 100, 4) : 4;
          return (
            <div key={stage.label} className="relative">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                  {stage.label}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{stage.count.toLocaleString()}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {stage.pct}%
                  </span>
                </div>
              </div>
              <div
                className="h-8 rounded-lg overflow-hidden"
                style={{ background: "var(--background)" }}
              >
                <div
                  className="h-full rounded-lg transition-all duration-1000 ease-out flex items-center px-3"
                  style={{
                    width: `${widthPct}%`,
                    background: `linear-gradient(90deg, ${stage.color}, ${stage.color}88)`,
                  }}
                />
              </div>
              {i < stages.length - 1 && (
                <div className="flex justify-center my-1">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 2L6 10M6 10L3 7M6 10L9 7" stroke="#737373" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
