"use client";

interface GeoMapProps {
  data: Record<string, number>;
}

export function GeoMap({ data }: GeoMapProps) {
  const sorted = Object.entries(data)
    .sort((a, b) => b[1] - a[1]);
  const maxVal = sorted[0]?.[1] || 1;
  const grandTotal = sorted.reduce((s, [, c]) => s + c, 0) || 1;

  return (
    <div
      className="rounded-xl p-6"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold">Couverture Géographique</h3>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {sorted.length} villes
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {sorted.map(([ville, count], i) => {
          const intensity = Math.max(0.15, count / maxVal);
          const isTop3 = i < 3;
          return (
            <div
              key={ville}
              className="relative p-3 rounded-lg text-center transition-all duration-300 hover:scale-105 cursor-default"
              style={{
                background: isTop3
                  ? `rgba(99,102,241,${intensity * 0.3})`
                  : `rgba(99,102,241,${intensity * 0.15})`,
                border: isTop3 ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
              }}
            >
              {isTop3 && (
                <div
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{ background: "#6366f1", color: "white" }}
                >
                  {i + 1}
                </div>
              )}
              <p className="text-lg font-bold" style={{ color: "#818cf8" }}>
                {count.toLocaleString()}
              </p>
              <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--muted)" }}>
                {ville}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden flex" style={{ background: "var(--border)" }}>
          {sorted.slice(0, 5).map(([ville, count]) => (
            <div
              key={ville}
              className="h-full"
              style={{
                width: `${(count / grandTotal) * 100}%`,
                background: "#6366f1",
                opacity: 0.6 + (count / maxVal) * 0.4,
              }}
            />
          ))}
        </div>
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
          Top 5 = {Math.round((sorted.slice(0, 5).reduce((s, [, c]) => s + c, 0) / grandTotal) * 100)}%
        </span>
      </div>
    </div>
  );
}
