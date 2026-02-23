import { getDashboardStats, getCategoryEmailRates } from "@/lib/data";

export default function CampaignsPage() {
  const stats = getDashboardStats();
  const categories = getCategoryEmailRates();
  const topCategories = categories.slice(0, 5);
  const campaignStatus = stats.withEmail > 0 ? "ready" : "waiting";

  return (
    <div className="p-6 max-w-full">
      <div className="mb-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          {"📧"} Campagnes Email
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{
              background: campaignStatus === "ready" ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
              color: campaignStatus === "ready" ? "#22c55e" : "#f59e0b",
            }}
          >
            {campaignStatus === "ready" ? `${stats.withEmail} emails pr\u00EAts` : "En attente emails"}
          </span>
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          {stats.totalLeads.toLocaleString()} leads &bull; {stats.withEmail.toLocaleString()} avec email &bull; {Object.keys(stats.byVerticale).length} verticales
        </p>
      </div>

      {/* Campaign Overview */}
      <div
        className="rounded-xl p-6 mb-6"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">{"🇫🇷"} France B2B &mdash; Toutes Verticales &mdash; S&eacute;quence 1</h3>
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              {Object.keys(stats.byVerticale).length} verticales &bull; {Object.keys(stats.byVille).length} villes &bull; Enrichissement: {stats.emailRate}%
            </p>
          </div>
          <span
            className="text-xs font-medium px-3 py-1 rounded-full"
            style={{
              background: stats.withEmail > 50 ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
              color: stats.withEmail > 50 ? "#22c55e" : "#f59e0b",
            }}
          >
            {stats.withEmail > 50 ? "✅ Pr\u00EAt" : "⏸ En attente"}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricBox label="Leads totaux" value={stats.totalLeads.toLocaleString()} color="#6366f1" />
          <MetricBox label="Avec email" value={stats.withEmail.toLocaleString()} color={stats.withEmail > 0 ? "#22c55e" : "#ef4444"} />
          <MetricBox label="Envoy&eacute;s" value="0" color="#818cf8" />
          <MetricBox label="R&eacute;pondu" value="0" color="#f59e0b" />
          <MetricBox label="RDV Book&eacute;" value="0" color="#06b6d4" />
        </div>

        {stats.withEmail === 0 ? (
          <div
            className="mt-4 p-3 rounded-lg flex items-center gap-2"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <span>{"⏳"}</span>
            <p className="text-xs" style={{ color: "#f59e0b" }}>
              <strong>Scraping en cours:</strong> Le script enrichit {stats.withWebsite.toLocaleString()} sites web. Les emails appara{"î"}tront ici automatiquement.
            </p>
          </div>
        ) : stats.withEmail < 50 ? (
          <div
            className="mt-4 p-3 rounded-lg flex items-center gap-2"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <span>{"⏳"}</span>
            <p className="text-xs" style={{ color: "#f59e0b" }}>
              <strong>Enrichissement en cours:</strong> {stats.withEmail} emails trouv{"é"}s sur {stats.totalLeads.toLocaleString()} leads. Le scraping continue...
            </p>
          </div>
        ) : (
          <div
            className="mt-4 p-3 rounded-lg flex items-center gap-2"
            style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}
          >
            <span>{"✅"}</span>
            <p className="text-xs" style={{ color: "#22c55e" }}>
              <strong>{stats.withEmail.toLocaleString()} emails pr{"ê"}ts.</strong> Connecter un compte email sender dans Instantly pour lancer les envois.
            </p>
          </div>
        )}
      </div>

      {/* Top Verticales for Campaign */}
      <div
        className="rounded-xl p-6 mb-6"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h3 className="font-semibold mb-4">{"📊"} R{"é"}partition par Verticale</h3>
        <div className="space-y-3">
          {topCategories.map((cat) => {
            const pct = Math.round((cat.total / stats.totalLeads) * 100);
            return (
              <div key={cat.name} className="flex items-center gap-3">
                <span className="text-xs w-48 truncate" style={{ color: "var(--muted)" }}>{cat.name}</span>
                <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: "var(--background)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: "linear-gradient(90deg, #6366f1, #818cf8)" }}
                  />
                </div>
                <span className="text-xs font-bold w-12 text-right">{cat.total}</span>
                <span className="text-xs w-12 text-right" style={{ color: cat.withEmail > 0 ? "#22c55e" : "var(--muted)" }}>
                  {cat.withEmail > 0 ? `${cat.withEmail} ✉` : "-"}
                </span>
              </div>
            );
          })}
          {categories.length > 5 && (
            <p className="text-[10px] text-center pt-2" style={{ color: "var(--muted)" }}>
              +{categories.length - 5} autres verticales
            </p>
          )}
        </div>
      </div>

      {/* Sequence */}
      <div
        className="rounded-xl p-6"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <h3 className="font-semibold mb-4">📝 S&eacute;quence Email</h3>
        <div className="space-y-3">
          <SequenceStep
            step={1}
            delay="J+0"
            subject="[Pr&eacute;nom], votre standard t&eacute;l&eacute;phonique perd des clients"
            preview="Chaque appel manqu&eacute; = un client perdu. AVA est une IA qui r&eacute;pond 24/7..."
          />
          <SequenceStep
            step={2}
            delay="J+3"
            subject="Re: {{company}} — ce que j'ai observ&eacute; sur votre site"
            preview="J'ai regard&eacute; votre site et j'ai not&eacute; que..."
          />
          <SequenceStep
            step={3}
            delay="J+7"
            subject="Derni&egrave;re question rapide"
            preview="Juste un dernier message — est-ce que le sujet vous int&eacute;resse ? Un oui/non suffit."
          />
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{label}</p>
    </div>
  );
}

function SequenceStep({
  step,
  delay,
  subject,
  preview,
}: {
  step: number;
  delay: string;
  subject: string;
  preview: string;
}) {
  return (
    <div
      className="p-4 rounded-lg flex gap-4"
      style={{ background: "var(--background)" }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {step}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-medium">{subject}</p>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{ background: "rgba(99,102,241,0.1)", color: "var(--accent-light)" }}
          >
            {delay}
          </span>
        </div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>{preview}</p>
      </div>
    </div>
  );
}
