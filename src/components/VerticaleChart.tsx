"use client";

interface VerticaleData {
  name: string;
  count: number;
}

export function VerticaleChart({ data }: { data: Record<string, number> }) {
  const items: VerticaleData[] = Object.entries(data)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const max = items.length > 0 ? Math.max(...items.map((i) => i.count)) : 1;
  const colors = [
    "#6366f1", "#818cf8", "#a78bfa", "#c084fc",
    "#e879f9", "#f472b6", "#fb7185", "#f97316", "#fbbf24"
  ];

  return (
    <div
      className="rounded-xl p-6"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-lg font-semibold mb-4">📊 Leads par Verticale</h3>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={item.name} className="flex items-center gap-3">
            <span className="text-xs w-40 truncate" style={{ color: "var(--muted)" }}>
              {item.name}
            </span>
            <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${(item.count / max) * 100}%`,
                  background: colors[i % colors.length],
                }}
              />
            </div>
            <span className="text-sm font-bold w-8 text-right">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
