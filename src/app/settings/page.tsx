import { getDashboardStats, getApifyRuns } from "@/lib/data";

export default function SettingsPage() {
  const stats = getDashboardStats();
  const runs = getApifyRuns();
  const succeededRuns = runs.filter((r) => r.status === "SUCCEEDED").length;

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold">{"\u2699\uFE0F"} Settings</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Configuration des APIs et int{"\u00E9"}grations
        </p>
      </div>

      <div className="space-y-4">
        <ApiCard
          name="Instantly.ai"
          icon={"\uD83D\uDCE7"}
          status={stats.withEmail > 0 ? "connected" : "planned"}
          details={
            stats.withEmail > 0
              ? `${stats.withEmail.toLocaleString()} leads avec email pr\u00EAts \u00E0 importer`
              : "En attente des emails enrichis pour import"
          }
          color={stats.withEmail > 0 ? "#22c55e" : "#f59e0b"}
        />
        <ApiCard
          name="Apify"
          icon={"\uD83D\uDD77\uFE0F"}
          status="connected"
          details={`${succeededRuns}/${runs.length} runs r\u00E9ussis \u2022 ${stats.totalLeads.toLocaleString()} leads scrapp\u00E9s`}
          color="#22c55e"
        />
        <ApiCard
          name="Email Scraper"
          icon={"\uD83D\uDD0D"}
          status={stats.withEmail > 100 ? "connected" : "limit"}
          details={`Scraping web gratuit \u2022 ${stats.withEmail} emails trouv\u00E9s sur ${stats.withWebsite.toLocaleString()} sites`}
          color={stats.withEmail > 100 ? "#22c55e" : "#f59e0b"}
        />
        <ApiCard
          name="Cal.com"
          icon={"\uD83D\uDCC5"}
          status="connected"
          details="cal.com/avafirstai/15min"
          color="#22c55e"
        />
        <ApiCard
          name="Notion"
          icon={"\uD83D\uDCDD"}
          status="connected"
          details={`Pipeline AVA GTM \u2022 ${stats.totalLeads.toLocaleString()} leads`}
          color="#22c55e"
        />
        <ApiCard
          name="N8N"
          icon={"\u26A1"}
          status="planned"
          details="Automatisation workflows \u2014 Phase 4"
          color="#818cf8"
        />
      </div>

      {/* Cost Summary */}
      <div
        className="mt-6 rounded-xl p-5"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h3 className="text-sm font-semibold mb-3">{"\uD83D\uDCB0"} Co{"\u00FB"}t total du pipeline</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-xl font-bold" style={{ color: "#22c55e" }}>0 {"\u20AC"}</p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>Co{"\u00FB"}t emails</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold" style={{ color: "#22c55e" }}>0 {"\u20AC"}</p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>Co{"\u00FB"}t Apify (free tier)</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold" style={{ color: "#22c55e" }}>0 {"\u20AC"}</p>
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>Total pipeline</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiCard({
  name,
  icon,
  status,
  details,
  color,
}: {
  name: string;
  icon: string;
  status: "connected" | "limit" | "planned" | "error";
  details: string;
  color: string;
}) {
  const statusLabel = {
    connected: "Connect\u00E9",
    limit: "En cours",
    planned: "Planifi\u00E9",
    error: "Erreur",
  }[status];

  return (
    <div
      className="rounded-xl p-5 flex items-center justify-between"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-sm font-semibold">{name}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{details}</p>
        </div>
      </div>
      <span
        className="text-xs font-medium px-3 py-1 rounded-full"
        style={{ background: `${color}20`, color }}
      >
        {statusLabel}
      </span>
    </div>
  );
}
