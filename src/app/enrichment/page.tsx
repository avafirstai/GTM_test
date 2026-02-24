"use client";

import { useState, useCallback, useRef } from "react";
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
  Shield,
  Phone,
  Building2,
  Linkedin,
  AlertTriangle,
  ToggleLeft,
  ToggleRight,
  Clock,
  TrendingUp,
  Database,
  Wifi,
  Code,
  FileText,
  Hash,
  UserCheck,
} from "lucide-react";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface SourceToggle {
  name: string;
  label: string;
  tier: "free" | "fr_public" | "freemium" | "premium";
  description: string;
  enabled: boolean;
}

interface SourceStat {
  tried: number;
  emailFound: number;
  phoneFound: number;
  siretFound: number;
}

interface EnrichResultItem {
  leadId: string;
  bestEmail: string | null;
  bestPhone: string | null;
  dirigeant: string | null;
  siret: string | null;
  mxProvider: string | null;
  hasMx: boolean;
  finalConfidence: number;
  sourcesTried: string[];
  durationMs: number;
  sourceResults: Array<{
    source: string;
    email: string | null;
    phone: string | null;
    dirigeant: string | null;
    siret: string | null;
    confidence: number;
    durationMs: number;
  }>;
}

interface EnrichV2Response {
  success: boolean;
  processed: number;
  enriched: number;
  summary?: {
    totalEmails: number;
    totalPhones: number;
    totalSiret: number;
    totalDirigeants: number;
    avgConfidence: number;
    avgDurationMs: number;
  };
  sourceStats?: Record<string, SourceStat>;
  results?: EnrichResultItem[];
  error?: string;
  message?: string;
}

interface EnrichState {
  running: boolean;
  target: string;
  results: EnrichV2Response | null;
  error: string | null;
  startTime: number | null;
  elapsedMs: number;
}

/* ================================================================== */
/*  Source Configuration                                                */
/* ================================================================== */

const DEFAULT_SOURCES: SourceToggle[] = [
  { name: "dns_intel", label: "DNS / MX Pre-check", tier: "free", description: "Verifie que le domaine recoit des emails", enabled: true },
  { name: "schema_org", label: "Schema.org / JSON-LD", tier: "free", description: "Donnees structurees du site web", enabled: true },
  { name: "deep_scrape", label: "Deep HTML Scraping", tier: "free", description: "Scrape 5+ pages (contact, about, mentions)", enabled: true },
  { name: "sirene", label: "SIRENE / INSEE", tier: "fr_public", description: "Registre officiel FR (SIRET, dirigeant)", enabled: true },
  { name: "email_permutation", label: "Email Permutation", tier: "fr_public", description: "Genere prenom.nom@domain + verification", enabled: true },
  { name: "google_dork", label: "Google Dorking", tier: "freemium", description: "Recherche Google CSE (100/jour gratuit)", enabled: true },
  { name: "kaspr", label: "Kaspr (LinkedIn)", tier: "premium", description: "Email + tel via LinkedIn (credits)", enabled: false },
];

const TIER_CONFIG = {
  free: { label: "Gratuit", color: "#22c55e", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)", icon: Shield },
  fr_public: { label: "APIs FR", color: "#3b82f6", bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.2)", icon: Building2 },
  freemium: { label: "Freemium", color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", icon: Search },
  premium: { label: "Premium", color: "#a855f7", bg: "rgba(168,85,247,0.08)", border: "rgba(168,85,247,0.2)", icon: Linkedin },
} as const;

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  dns_intel: <Wifi size={13} />,
  schema_org: <Code size={13} />,
  deep_scrape: <Globe size={13} />,
  sirene: <Building2 size={13} />,
  email_permutation: <Mail size={13} />,
  google_dork: <Search size={13} />,
  kaspr: <Linkedin size={13} />,
};

/* ================================================================== */
/*  Main Page                                                          */
/* ================================================================== */

export default function EnrichmentPage() {
  const { data, loading } = useStats();
  const [sources, setSources] = useState<SourceToggle[]>(DEFAULT_SOURCES);
  const [useKaspr, setUseKaspr] = useState(false);
  const [enrichLimit, setEnrichLimit] = useState(20);
  const [stopOnConfidence, setStopOnConfidence] = useState(80);
  const [enrichState, setEnrichState] = useState<EnrichState>({
    running: false,
    target: "",
    results: null,
    error: null,
    startTime: null,
    elapsedMs: 0,
  });
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllCities, setShowAllCities] = useState(false);
  const [showSourceDetail, setShowSourceDetail] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggleSource = useCallback((name: string) => {
    setSources((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: !s.enabled } : s))
    );
  }, []);

  const toggleKaspr = useCallback(() => {
    setUseKaspr((prev) => {
      const next = !prev;
      setSources((s) =>
        s.map((src) => (src.name === "kaspr" ? { ...src, enabled: next } : src))
      );
      return next;
    });
  }, []);

  const startTimer = useCallback(() => {
    const start = Date.now();
    setEnrichState((prev) => ({ ...prev, startTime: start, elapsedMs: 0 }));
    timerRef.current = setInterval(() => {
      setEnrichState((prev) => ({ ...prev, elapsedMs: Date.now() - start }));
    }, 200);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runEnrichV2 = useCallback(
    async (opts: { category?: string; city?: string; label: string }) => {
      setEnrichState({ running: true, target: opts.label, results: null, error: null, startTime: null, elapsedMs: 0 });
      startTimer();
      try {
        const enabledSources = sources.filter((s) => s.enabled).map((s) => s.name);
        const res = await fetch("/api/enrich/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: opts.category,
            city: opts.city,
            limit: enrichLimit,
            sources: enabledSources,
            stopOnConfidence,
            useKaspr,
            minScoreForPaid: 30,
          }),
        });
        const responseData: EnrichV2Response = await res.json();
        stopTimer();
        if (responseData.success) {
          setEnrichState((prev) => ({
            ...prev,
            running: false,
            results: responseData,
          }));
        } else {
          setEnrichState((prev) => ({
            ...prev,
            running: false,
            error: responseData.error || "Erreur inconnue",
          }));
        }
      } catch {
        stopTimer();
        setEnrichState((prev) => ({ ...prev, running: false, error: "Erreur reseau" }));
      }
    },
    [sources, enrichLimit, stopOnConfidence, useKaspr, startTimer, stopTimer]
  );

  const runEnrichAll = useCallback(() => {
    runEnrichV2({ label: "Tous les leads sans email" });
  }, [runEnrichV2]);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { stats, categoryEmailRates, cityEmailRates } = data;

  const websiteRate = stats.totalLeads > 0 ? Math.round((stats.withWebsite / stats.totalLeads) * 100) : 0;
  const emailFromWebsite = stats.withWebsite > 0 ? Math.round((stats.withEmail / stats.withWebsite) * 100) : 0;

  const MAX_VISIBLE = 8;
  const visibleCategories = showAllCategories ? categoryEmailRates : categoryEmailRates.slice(0, MAX_VISIBLE);
  const visibleCities = showAllCities ? cityEmailRates : cityEmailRates.slice(0, MAX_VISIBLE);

  const enabledCount = sources.filter((s) => s.enabled).length;
  const tiers = ["free", "fr_public", "freemium", "premium"] as const;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-semibold tracking-tight">Enrichissement Waterfall v2</h1>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7" }}>
            8 sources
          </span>
        </div>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Cascade de {enabledCount} sources actives pour trouver emails, telephones, SIRET et dirigeants.
        </p>
      </div>

      {/* Source Configuration Panel */}
      <div className="rounded-xl border border-[var(--border)] mb-6" style={{ background: "var(--bg-raised)" }}>
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-medium">Sources d&apos;enrichissement</h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-[10px]" style={{ color: "var(--text-muted)" }}>Limite</label>
              <select
                value={enrichLimit}
                onChange={(e) => setEnrichLimit(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-md"
                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                <option value={10}>10 leads</option>
                <option value={20}>20 leads</option>
                <option value={50}>50 leads</option>
                <option value={100}>100 leads</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px]" style={{ color: "var(--text-muted)" }}>Seuil confiance</label>
              <select
                value={stopOnConfidence}
                onChange={(e) => setStopOnConfidence(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-md"
                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                <option value={60}>60%</option>
                <option value={70}>70%</option>
                <option value={80}>80% (defaut)</option>
                <option value={90}>90%</option>
                <option value={100}>100% (tout essayer)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="p-5">
          {/* 4-Tier Source Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {tiers.map((tier) => {
              const tierSources = sources.filter((s) => s.tier === tier);
              const cfg = TIER_CONFIG[tier];
              const TierIcon = cfg.icon;

              return (
                <div key={tier} className="rounded-lg p-3" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                  <div className="flex items-center gap-1.5 mb-3">
                    <TierIcon size={12} style={{ color: cfg.color }} />
                    <span className="text-[11px] font-semibold" style={{ color: cfg.color }}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {tierSources.map((src) => (
                      <div key={src.name} className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => src.name === "kaspr" ? toggleKaspr() : toggleSource(src.name)}
                          className="mt-0.5 shrink-0"
                        >
                          {src.enabled ? (
                            <ToggleRight size={18} style={{ color: cfg.color }} />
                          ) : (
                            <ToggleLeft size={18} style={{ color: "var(--text-muted)" }} />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span style={{ color: src.enabled ? cfg.color : "var(--text-muted)" }}>
                              {SOURCE_ICONS[src.name]}
                            </span>
                            <span
                              className="text-[11px] font-medium truncate"
                              style={{ color: src.enabled ? "var(--text-primary)" : "var(--text-muted)" }}
                            >
                              {src.label}
                            </span>
                          </div>
                          <p className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                            {src.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Kaspr Warning */}
          {useKaspr && (
            <div
              className="mt-4 px-4 py-3 rounded-lg flex items-start gap-2.5"
              style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "#a855f7" }} />
              <div>
                <p className="text-[11px] font-medium" style={{ color: "#a855f7" }}>
                  Kaspr consomme des credits
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Kaspr sera utilise uniquement en dernier recours, pour les leads sans email apres les sources gratuites.
                  1 credit par donnee trouvee (email, telephone).
                </p>
              </div>
            </div>
          )}

          {/* Run Buttons */}
          <div className="flex items-center justify-between mt-5 pt-4 border-t border-[var(--border)]">
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {enabledCount} sources actives &middot; {(stats.withWebsite - stats.withEmail).toLocaleString()} leads avec site web sans email
            </div>
            <button
              onClick={runEnrichAll}
              disabled={enrichState.running || enabledCount === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
              style={{ background: "var(--accent)", color: "white" }}
            >
              {enrichState.running ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              {enrichState.running ? "Enrichissement en cours..." : "Lancer l'enrichissement"}
            </button>
          </div>
        </div>
      </div>

      {/* Running Indicator */}
      {enrichState.running && (
        <div
          className="rounded-xl border border-[var(--border)] mb-6 p-5"
          style={{ background: "var(--bg-raised)" }}
        >
          <div className="flex items-center gap-3 mb-3">
            <Loader2 size={16} className="animate-spin" style={{ color: "var(--accent)" }} />
            <span className="text-sm font-medium">Enrichissement en cours...</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {enrichState.target}
            </span>
          </div>
          <div className="flex items-center gap-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span className="flex items-center gap-1">
              <Clock size={11} /> {(enrichState.elapsedMs / 1000).toFixed(1)}s
            </span>
            <span>{enabledCount} sources actives</span>
            <span>Limite: {enrichLimit} leads</span>
          </div>
          {/* Pulsing progress bar */}
          <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: "var(--bg)" }}>
            <div
              className="h-full rounded-full animate-pulse"
              style={{ background: "var(--accent)", width: "60%", transition: "width 0.5s ease" }}
            />
          </div>
        </div>
      )}

      {/* Results Banner */}
      {enrichState.results && !enrichState.running && (
        <div className="rounded-xl border border-[var(--border)] mb-6" style={{ background: "var(--bg-raised)" }}>
          {/* Summary Header */}
          <div className="p-5 border-b border-[var(--border)]">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle size={18} style={{ color: "var(--green)" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--green)" }}>
                Enrichissement termine
              </span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {enrichState.results.processed} traites &middot; {enrichState.results.enriched} enrichis
                {enrichState.results.summary && ` &middot; ${(enrichState.results.summary.avgDurationMs / 1000).toFixed(1)}s en moyenne`}
              </span>
            </div>

            {/* Stats Cards */}
            {enrichState.results.summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  icon={<Mail size={14} />}
                  label="Emails trouves"
                  value={enrichState.results.summary.totalEmails}
                  total={enrichState.results.processed}
                  color="#22c55e"
                />
                <StatCard
                  icon={<Phone size={14} />}
                  label="Telephones"
                  value={enrichState.results.summary.totalPhones}
                  total={enrichState.results.processed}
                  color="#3b82f6"
                />
                <StatCard
                  icon={<Hash size={14} />}
                  label="SIRET"
                  value={enrichState.results.summary.totalSiret}
                  total={enrichState.results.processed}
                  color="#f59e0b"
                />
                <StatCard
                  icon={<UserCheck size={14} />}
                  label="Dirigeants"
                  value={enrichState.results.summary.totalDirigeants}
                  total={enrichState.results.processed}
                  color="#a855f7"
                />
              </div>
            )}
          </div>

          {/* Source Stats */}
          {enrichState.results.sourceStats && (
            <div className="p-5 border-b border-[var(--border)]">
              <h3 className="text-xs font-medium mb-3 flex items-center gap-2">
                <TrendingUp size={13} style={{ color: "var(--text-muted)" }} />
                Performance par source
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(enrichState.results.sourceStats).map(([name, stat]) => {
                  const srcConfig = sources.find((s) => s.name === name);
                  const tierCfg = srcConfig ? TIER_CONFIG[srcConfig.tier] : TIER_CONFIG.free;
                  return (
                    <div key={name} className="rounded-lg px-3 py-2" style={{ background: tierCfg.bg, border: `1px solid ${tierCfg.border}` }}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span style={{ color: tierCfg.color }}>{SOURCE_ICONS[name]}</span>
                        <span className="text-[10px] font-medium truncate" style={{ color: tierCfg.color }}>
                          {srcConfig?.label || name}
                        </span>
                      </div>
                      <div className="flex gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {stat.emailFound > 0 && (
                          <span>
                            <Mail size={9} className="inline mr-0.5" style={{ verticalAlign: "-1px" }} />
                            {stat.emailFound}
                          </span>
                        )}
                        {stat.phoneFound > 0 && (
                          <span>
                            <Phone size={9} className="inline mr-0.5" style={{ verticalAlign: "-1px" }} />
                            {stat.phoneFound}
                          </span>
                        )}
                        {stat.siretFound > 0 && (
                          <span>
                            <Hash size={9} className="inline mr-0.5" style={{ verticalAlign: "-1px" }} />
                            {stat.siretFound}
                          </span>
                        )}
                        <span className="ml-auto">{stat.tried} essais</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detailed results toggle */}
          {enrichState.results.results && enrichState.results.results.length > 0 && (
            <div className="p-5">
              <button
                type="button"
                onClick={() => setShowSourceDetail(!showSourceDetail)}
                className="text-xs font-medium flex items-center gap-1.5 mb-3"
                style={{ color: "var(--accent-hover)" }}
              >
                <FileText size={12} />
                {showSourceDetail ? "Masquer" : "Voir"} les details par lead ({enrichState.results.results.length})
                <ChevronDown
                  size={12}
                  style={{ transform: showSourceDetail ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                />
              </button>

              {showSourceDetail && (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {enrichState.results.results.map((r) => (
                    <div
                      key={r.leadId}
                      className="rounded-lg px-3 py-2.5 text-[11px]"
                      style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                    >
                      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                        <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {r.leadId.slice(0, 8)}
                        </span>
                        {r.bestEmail && (
                          <span className="flex items-center gap-1" style={{ color: "var(--green)" }}>
                            <Mail size={10} /> {r.bestEmail}
                          </span>
                        )}
                        {r.bestPhone && (
                          <span className="flex items-center gap-1" style={{ color: "#3b82f6" }}>
                            <Phone size={10} /> {r.bestPhone}
                          </span>
                        )}
                        {r.dirigeant && (
                          <span className="flex items-center gap-1" style={{ color: "#a855f7" }}>
                            <UserCheck size={10} /> {r.dirigeant}
                          </span>
                        )}
                        {r.siret && (
                          <span className="flex items-center gap-1" style={{ color: "#f59e0b" }}>
                            <Hash size={10} /> {r.siret}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                          <span
                            className="font-medium"
                            style={{
                              color: r.finalConfidence >= 80 ? "var(--green)" : r.finalConfidence >= 50 ? "#f59e0b" : "var(--text-muted)",
                            }}
                          >
                            {r.finalConfidence}%
                          </span>
                          <span>{(r.durationMs / 1000).toFixed(1)}s</span>
                        </span>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {r.sourcesTried.map((s) => {
                          const srcResult = r.sourceResults.find((sr) => sr.source === s);
                          const found = srcResult && (srcResult.email || srcResult.phone || srcResult.siret || srcResult.dirigeant);
                          return (
                            <span
                              key={s}
                              className="text-[9px] px-1.5 py-0.5 rounded"
                              style={{
                                background: found ? "rgba(34,197,94,0.1)" : "var(--bg-hover)",
                                color: found ? "var(--green)" : "var(--text-muted)",
                              }}
                            >
                              {s}
                              {srcResult?.email && " (email)"}
                              {srcResult?.phone && " (tel)"}
                              {srcResult?.siret && " (siret)"}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error Banner */}
      {enrichState.error && !enrichState.running && (
        <div
          className="rounded-xl mb-6 px-5 py-4 flex items-center gap-3"
          style={{ background: "var(--red-subtle)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <AlertTriangle size={16} style={{ color: "var(--red)" }} />
          <span className="text-sm" style={{ color: "var(--red)" }}>{enrichState.error}</span>
        </div>
      )}

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
          <div className="rounded-xl border border-[var(--border)]" style={{ background: "var(--bg-raised)" }}>
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
                  onEnrich={() => runEnrichV2({ category: cat.name, label: cat.name })}
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
          <div className="rounded-xl border border-[var(--border)]" style={{ background: "var(--bg-raised)" }}>
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
                  onEnrich={() => runEnrichV2({ city: city.name, label: city.name })}
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
        AVA GTM &middot; Waterfall Enrichment Engine v2 &middot; 8 sources
      </p>
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function StatCard({
  icon,
  label,
  value,
  total,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{ background: `${color}08`, border: `1px solid ${color}20` }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold" style={{ color }}>{value}</span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          /{total} ({pct}%)
        </span>
      </div>
    </div>
  );
}

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
