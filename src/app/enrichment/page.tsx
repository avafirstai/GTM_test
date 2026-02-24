"use client";

import { useState, useCallback } from "react";
import { useStats } from "@/lib/useStats";
import {
  Zap,
  Globe,
  Mail,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Rocket,
  Users,
  Search,
  ExternalLink,
  Play,
  Loader2,
  CheckCircle,
} from "lucide-react";

type Technique = "website_scraping" | "pattern_guess";

interface EnrichState {
  running: boolean;
  target: string; // "all" | category name | city name
  technique: Technique;
  results: { processed: number; found: number; failed: number } | null;
  error: string | null;
}

export default function EnrichmentPage() {
  const { data, loading } = useStats();
  const [technique, setTechnique] = useState<Technique>("website_scraping");
  const [enrichState, setEnrichState] = useState<EnrichState>({
    running: false,
    target: "",
    technique: "website_scraping",
    results: null,
    error: null,
  });
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllCities, setShowAllCities] = useState(false);

  const runEnrich = useCallback(
    async (opts: { category?: string; city?: string; label: string }) => {
      setEnrichState({ running: true, target: opts.label, technique, results: null, error: null });
      try {
        const res = await fetch("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: opts.category,
            city: opts.city,
            technique,
            limit: 100,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setEnrichState((prev) => ({
            ...prev,
            running: false,
            results: { processed: data.processed, found: data.found, failed: data.failed },
          }));
        } else {
          setEnrichState((prev) => ({ ...prev, running: false, error: data.error || "Erreur" }));
        }
      } catch {
        setEnrichState((prev) => ({ ...prev, running: false, error: "Erreur reseau" }));
      }
    },
    [technique]
  );

  const runEnrichAll = useCallback(() => {
    runEnrich({ label: "Tous les leads sans email" });
  }, [runEnrich]);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { stats, categoryEmailRates, cityEmailRates } = data;

  const websiteRate =
    stats.totalLeads > 0
      ? Math.round((stats.withWebsite / stats.totalLeads) * 100)
      : 0;
  const emailFromWebsite =
    stats.withWebsite > 0
      ? Math.round((stats.withEmail / stats.withWebsite) * 100)
      : 0;

  const MAX_VISIBLE = 8;
  const visibleCategories = showAllCategories ? categoryEmailRates : categoryEmailRates.slice(0, MAX_VISIBLE);
  const visibleCities = showAllCities ? cityEmailRates : cityEmailRates.slice(0, MAX_VISIBLE);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Enrichissement</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Trouve automatiquement les emails de vos leads via scraping web.
        </p>
      </div>

      {/* Technique Selector + Enrich All */}
      <div
        className="rounded-xl border border-[var(--border)] mb-6 p-5"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-sm font-medium mb-2">Technique d&apos;enrichissement</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTechnique("website_scraping")}
                className="text-xs px-3 py-2 rounded-lg font-medium transition-colors"
                style={{
                  background: technique === "website_scraping" ? "var(--accent)" : "var(--bg)",
                  color: technique === "website_scraping" ? "white" : "var(--text-secondary)",
                  border: technique === "website_scraping" ? "1px solid var(--accent)" : "1px solid var(--border)",
                }}
              >
                <Globe size={12} className="inline mr-1.5" style={{ verticalAlign: "-1px" }} />
                Scraping site web
              </button>
              <button
                type="button"
                onClick={() => setTechnique("pattern_guess")}
                className="text-xs px-3 py-2 rounded-lg font-medium transition-colors"
                style={{
                  background: technique === "pattern_guess" ? "var(--accent)" : "var(--bg)",
                  color: technique === "pattern_guess" ? "white" : "var(--text-secondary)",
                  border: technique === "pattern_guess" ? "1px solid var(--accent)" : "1px solid var(--border)",
                }}
              >
                <Mail size={12} className="inline mr-1.5" style={{ verticalAlign: "-1px" }} />
                Pattern email (contact@domain)
              </button>
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: "var(--text-muted)" }}>
              {technique === "website_scraping"
                ? "Visite chaque site web et extrait les emails de contact trouves dans le HTML"
                : "Genere contact@domaine.fr a partir du site web — rapide mais moins precis"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={runEnrichAll}
              disabled={enrichState.running}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-opacity disabled:opacity-50"
              style={{ background: "var(--accent)", color: "white" }}
            >
              {enrichState.running ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              {enrichState.running ? "Enrichissement en cours..." : "Enrichir tous les leads sans email"}
            </button>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {stats.withoutEmail.toLocaleString()} leads sans email &middot; {(stats.withWebsite - stats.withEmail).toLocaleString()} avec site web
            </span>
          </div>
        </div>

        {/* Enrichment results banner */}
        {enrichState.results && (
          <div
            className="mt-4 px-4 py-3 rounded-lg flex items-center gap-3"
            style={{ background: "var(--green-subtle)", border: "1px solid rgba(34,197,94,0.2)" }}
          >
            <CheckCircle size={16} style={{ color: "var(--green)" }} />
            <div className="text-sm">
              <span className="font-medium" style={{ color: "var(--green)" }}>
                {enrichState.results.found} emails trouves
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                {" "}sur {enrichState.results.processed} leads traites
                {enrichState.target !== "Tous les leads sans email" && ` (${enrichState.target})`}
              </span>
            </div>
          </div>
        )}
        {enrichState.error && (
          <div
            className="mt-4 px-4 py-3 rounded-lg text-sm"
            style={{ background: "var(--red-subtle)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            {enrichState.error}
          </div>
        )}
      </div>

      {/* Funnel */}
      <div
        className="rounded-xl border border-[var(--border)] mb-6"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
          <Zap size={16} style={{ color: "var(--text-muted)" }} />
          <h2 className="text-sm font-medium">Entonnoir de conversion</h2>
        </div>
        <div className="flex items-center gap-2 p-5 overflow-x-auto">
          <FunnelStep icon={<Users size={16} />} title="Leads scrappes" count={stats.totalLeads} href="/leads" />
          <FunnelArrow pct={websiteRate} />
          <FunnelStep icon={<Globe size={16} />} title="Avec site web" count={stats.withWebsite} href="/leads" />
          <FunnelArrow pct={emailFromWebsite} />
          <FunnelStep icon={<Mail size={16} />} title="Email trouve" count={stats.withEmail} accent href="/leads?hasEmail=yes" />
          <FunnelArrow pct={100} />
          <FunnelStep icon={<Rocket size={16} />} title="Pret campagne" count={stats.withEmail} accent href="/launch" />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <ActionCard icon={<Mail size={16} />} title="Leads avec email" desc={`${stats.withEmail.toLocaleString()} leads prets`} href="/leads?hasEmail=yes" accent="green" />
        <ActionCard icon={<Search size={16} />} title="Leads sans email" desc={`${stats.withoutEmail.toLocaleString()} leads a enrichir`} href="/leads?hasEmail=no" accent="amber" />
        <ActionCard icon={<Rocket size={16} />} title="Lancer une campagne" desc="Envoyer les leads enrichis" href="/launch" accent="accent" />
      </div>

      {/* Two columns: Categories + Cities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* By category */}
        {categoryEmailRates.length > 0 && (
          <div
            className="rounded-xl border border-[var(--border)]"
            style={{ background: "var(--bg-raised)" }}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-sm font-medium">Taux par categorie</h2>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {categoryEmailRates.length} categories
              </span>
            </div>
            <div className="p-4 space-y-1">
              {visibleCategories.map((cat) => (
                <EnrichableRow
                  key={cat.name}
                  name={cat.name}
                  withEmail={cat.withEmail}
                  total={cat.total}
                  rate={cat.rate}
                  href={`/leads?verticale=${encodeURIComponent(cat.name)}`}
                  onEnrich={() => runEnrich({ category: cat.name, label: cat.name })}
                  enriching={enrichState.running && enrichState.target === cat.name}
                  hasUnenriched={cat.total - cat.withEmail > 0}
                />
              ))}
              {categoryEmailRates.length > MAX_VISIBLE && (
                <button
                  type="button"
                  onClick={() => setShowAllCategories(!showAllCategories)}
                  className="w-full text-center text-xs py-2 rounded-lg transition-colors"
                  style={{ color: "var(--accent-hover)" }}
                >
                  {showAllCategories
                    ? "Voir moins"
                    : `Voir les ${categoryEmailRates.length - MAX_VISIBLE} autres categories`}
                  <ChevronDown
                    size={12}
                    className="inline ml-1"
                    style={{
                      transform: showAllCategories ? "rotate(180deg)" : "none",
                      transition: "transform 0.2s",
                      verticalAlign: "-1px",
                    }}
                  />
                </button>
              )}
            </div>
          </div>
        )}

        {/* By city */}
        {cityEmailRates.length > 0 && (
          <div
            className="rounded-xl border border-[var(--border)]"
            style={{ background: "var(--bg-raised)" }}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-sm font-medium">Taux par ville</h2>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {cityEmailRates.length} villes
              </span>
            </div>
            <div className="p-4 space-y-1">
              {visibleCities.map((city) => (
                <EnrichableRow
                  key={city.name}
                  name={city.name}
                  withEmail={city.withEmail}
                  total={city.total}
                  rate={city.rate}
                  href={`/leads?ville=${encodeURIComponent(city.name)}`}
                  onEnrich={() => runEnrich({ city: city.name, label: city.name })}
                  enriching={enrichState.running && enrichState.target === city.name}
                  hasUnenriched={city.total - city.withEmail > 0}
                />
              ))}
              {cityEmailRates.length > MAX_VISIBLE && (
                <button
                  type="button"
                  onClick={() => setShowAllCities(!showAllCities)}
                  className="w-full text-center text-xs py-2 rounded-lg transition-colors"
                  style={{ color: "var(--accent-hover)" }}
                >
                  {showAllCities
                    ? "Voir moins"
                    : `Voir les ${cityEmailRates.length - MAX_VISIBLE} autres villes`}
                  <ChevronDown
                    size={12}
                    className="inline ml-1"
                    style={{
                      transform: showAllCities ? "rotate(180deg)" : "none",
                      transition: "transform 0.2s",
                      verticalAlign: "-1px",
                    }}
                  />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="text-center text-xs mt-10" style={{ color: "var(--text-muted)" }}>
        AVA GTM &middot; Enrichissement automatise
      </p>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function EnrichableRow({
  name,
  withEmail,
  total,
  rate,
  href,
  onEnrich,
  enriching,
  hasUnenriched,
}: {
  name: string;
  withEmail: number;
  total: number;
  rate: number;
  href: string;
  onEnrich: () => void;
  enriching: boolean;
  hasUnenriched: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors group"
      style={{ background: "transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <a
        href={href}
        className="text-[11px] w-32 truncate shrink-0"
        style={{ color: "var(--text-secondary)" }}
      >
        {name}
      </a>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(rate, 1)}%`,
            background: rate > 50 ? "var(--green)" : rate > 20 ? "var(--amber)" : "var(--accent)",
          }}
        />
      </div>
      <span
        className="text-[11px] font-medium w-14 text-right shrink-0"
        style={{ color: withEmail > 0 ? "var(--green)" : "var(--text-muted)" }}
      >
        {withEmail}/{total}
      </span>
      {hasUnenriched ? (
        <button
          type="button"
          onClick={onEnrich}
          disabled={enriching}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-2 py-1 rounded font-medium shrink-0 disabled:opacity-50"
          style={{ background: "var(--accent-subtle)", color: "var(--accent-hover)" }}
          title={`Enrichir les leads sans email dans ${name}`}
        >
          {enriching ? <Loader2 size={10} className="animate-spin" /> : "Enrichir"}
        </button>
      ) : (
        <span className="w-14 shrink-0" />
      )}
      <a href={href} className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0">
        <ExternalLink size={10} style={{ color: "var(--text-muted)" }} />
      </a>
    </div>
  );
}

function FunnelStep({
  icon,
  title,
  count,
  accent,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  accent?: boolean;
  href: string;
}) {
  return (
    <a
      href={href}
      className="p-4 rounded-lg min-w-32 text-center shrink-0 transition-colors"
      style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = accent ? "rgba(34,197,94,0.4)" : "rgba(99,102,241,0.4)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
    >
      <div
        className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center"
        style={{
          background: accent ? "var(--green-subtle)" : "var(--accent-subtle)",
          color: accent ? "var(--green)" : "var(--accent)",
        }}
      >
        {icon}
      </div>
      <p className="text-xs font-medium">{title}</p>
      <p className="text-lg font-semibold mt-1" style={accent ? { color: "var(--green)" } : undefined}>
        {count.toLocaleString()}
      </p>
    </a>
  );
}

function FunnelArrow({ pct }: { pct: number }) {
  return (
    <div className="flex flex-col items-center shrink-0 gap-0.5">
      <ArrowRight size={14} style={{ color: "var(--text-muted)" }} />
      {pct < 100 && (
        <span className="text-[9px] font-medium" style={{ color: "var(--text-muted)" }}>
          {pct}%
        </span>
      )}
    </div>
  );
}

function ActionCard({
  icon,
  title,
  desc,
  href,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href: string;
  accent: "green" | "amber" | "accent";
}) {
  const colorMap = {
    green: { bg: "var(--green-subtle)", color: "var(--green)", border: "rgba(34,197,94,0.15)" },
    amber: { bg: "var(--amber-subtle)", color: "var(--amber)", border: "rgba(245,158,11,0.15)" },
    accent: { bg: "var(--accent-subtle)", color: "var(--accent-hover)", border: "rgba(99,102,241,0.15)" },
  };
  const c = colorMap[accent];

  return (
    <a
      href={href}
      className="rounded-xl p-4 flex items-center gap-3 transition-colors group"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: c.border, color: c.color }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: c.color }}>{title}</p>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{desc}</p>
      </div>
      <ChevronRight size={14} className="shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" style={{ color: c.color }} />
    </a>
  );
}
