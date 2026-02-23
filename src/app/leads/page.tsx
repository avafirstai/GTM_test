import { LeadsTable } from "@/components/LeadsTable";
import { getLeads, getLeadStats } from "@/lib/leads-data";
import { getDashboardStats } from "@/lib/data";

export default function LeadsPage() {
  const leads = getLeads();
  const stats = getLeadStats();
  const dashStats = getDashboardStats();

  return (
    <div className="p-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {"\u{1F465}"} Base de Leads
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent-light)" }}
            >
              {dashStats.totalLeads.toLocaleString()}
            </span>
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            {dashStats.totalLeads.toLocaleString()} entreprises prospect&eacute;es &bull; {Object.keys(dashStats.byVerticale).length} verticales &bull; {Object.keys(dashStats.byVille).length} villes
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="text-xs px-4 py-2 rounded-lg font-medium"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
          >
            Exporter CSV
          </button>
          <button
            className="text-xs px-4 py-2 rounded-lg font-medium"
            style={{ background: "var(--accent)", color: "white" }}
          >
            + Nouveau scraping
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <QuickStat label="Total Leads" value={dashStats.totalLeads.toLocaleString()} color="#6366f1" />
        <QuickStat label="Avec email" value={dashStats.withEmail.toLocaleString()} color="#22c55e" />
        <QuickStat label="Avec t&eacute;l&eacute;phone" value={dashStats.withPhone.toLocaleString()} color="#06b6d4" />
        <QuickStat label="Avec site web" value={dashStats.withWebsite.toLocaleString()} color="#818cf8" />
        <QuickStat label="Score moyen" value={String(dashStats.avgScore)} color="#f59e0b" />
      </div>

      {/* Table */}
      <LeadsTable leads={leads} />

      {/* Info */}
      <div className="mt-4 text-center">
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Affichage des top {stats.displayed} leads par score (sur {dashStats.totalLeads.toLocaleString()} au total)
        </p>
      </div>
    </div>
  );
}

function QuickStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="p-3 rounded-lg text-center"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <p className="text-xl font-bold" style={{ color }}>
        {value}
      </p>
      <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>
        {label}
      </p>
    </div>
  );
}
