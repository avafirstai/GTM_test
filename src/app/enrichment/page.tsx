"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useStats } from "@/lib/useStats";
import { parseSSEEvents } from "@/lib/parseSSE";
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
  CircleDot,
  Pause,
  Square,
  RefreshCw,
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

interface SourceHealth {
  name: string;
  label: string;
  configured: boolean;
  tier: string;
}

interface EnrichDecisionMaker {
  name: string;
  firstName?: string;
  lastName?: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: string;
  confidence: number;
}

interface EnrichResultItem {
  leadId: string;
  name?: string;
  status?: "enriched" | "failed" | "skipped";
  bestEmail: string | null;
  bestPhone: string | null;
  dirigeant: string | null;
  siret: string | null;
  confidence: number;
  sourcesTried: string[];
  decisionMakers: EnrichDecisionMaker[];
  error?: string;
}

interface CurrentLead {
  leadId: string;
  name: string;
  website: string;
  index: number;
  total: number;
}

interface EnrichSummary {
  totalEmails: number;
  totalPhones: number;
  totalSiret: number;
  totalDirigeants: number;
  avgConfidence: number;
  avgDurationMs: number;
}

interface EnrichJob {
  id: string;
  status: string;
  progress_processed: number;
  progress_total: number;
  progress_enriched: number;
  summary: EnrichSummary | null;
  source_stats: Record<string, SourceStat> | null;
  lead_results: EnrichResultItem[] | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

type RunStatus = "idle" | "running" | "paused" | "stopped" | "done" | "error";

/* ================================================================== */
/*  JSONB safe parsers — validate raw Supabase data before state       */
/* ================================================================== */

function safeSummary(raw: unknown): EnrichSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    totalEmails: typeof obj.totalEmails === "number" ? obj.totalEmails : 0,
    totalPhones: typeof obj.totalPhones === "number" ? obj.totalPhones : 0,
    totalSiret: typeof obj.totalSiret === "number" ? obj.totalSiret : 0,
    totalDirigeants: typeof obj.totalDirigeants === "number" ? obj.totalDirigeants : 0,
    avgConfidence: typeof obj.avgConfidence === "number" ? obj.avgConfidence : 0,
    avgDurationMs: typeof obj.avgDurationMs === "number" ? obj.avgDurationMs : 0,
  };
}

function safeSourceStats(raw: unknown): Record<string, SourceStat> | null {
  if (!raw || typeof raw !== "object") return null;
  const result: Record<string, SourceStat> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    result[key] = {
      tried: typeof v.tried === "number" ? v.tried : 0,
      emailFound: typeof v.emailFound === "number" ? v.emailFound : 0,
      phoneFound: typeof v.phoneFound === "number" ? v.phoneFound : 0,
      siretFound: typeof v.siretFound === "number" ? v.siretFound : 0,
    };
  }
  return Object.keys(result).length > 0 ? result : null;
}

function parseEnrichDMs(raw: unknown): EnrichDecisionMaker[] {
  if (!Array.isArray(raw)) return [];
  const result: EnrichDecisionMaker[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const dm = item as Record<string, unknown>;
    if (typeof dm.name !== "string") continue;
    result.push({
      name: dm.name,
      firstName: typeof dm.firstName === "string" ? dm.firstName : undefined,
      lastName: typeof dm.lastName === "string" ? dm.lastName : undefined,
      title: typeof dm.title === "string" ? dm.title : null,
      email: typeof dm.email === "string" ? dm.email : null,
      phone: typeof dm.phone === "string" ? dm.phone : null,
      linkedinUrl: typeof dm.linkedinUrl === "string" ? dm.linkedinUrl : null,
      source: typeof dm.source === "string" ? dm.source : "unknown",
      confidence: typeof dm.confidence === "number" ? dm.confidence : 0,
    });
  }
  return result;
}

function safeLeadResult(raw: unknown): EnrichResultItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.leadId !== "string") return null;
  return {
    leadId: obj.leadId,
    name: typeof obj.name === "string" ? obj.name : undefined,
    status: (obj.status === "enriched" || obj.status === "failed" || obj.status === "skipped")
      ? obj.status as "enriched" | "failed" | "skipped"
      : undefined,
    bestEmail: typeof obj.bestEmail === "string" ? obj.bestEmail : null,
    bestPhone: typeof obj.bestPhone === "string" ? obj.bestPhone : null,
    dirigeant: typeof obj.dirigeant === "string" ? obj.dirigeant : null,
    siret: typeof obj.siret === "string" ? obj.siret : null,
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
    sourcesTried: Array.isArray(obj.sourcesTried) ? (obj.sourcesTried as string[]) : [],
    decisionMakers: parseEnrichDMs(obj.decisionMakers),
  };
}

function safeLeadResults(raw: unknown): EnrichResultItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(safeLeadResult).filter((r): r is EnrichResultItem => r !== null);
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
  { name: "linkedin_search", label: "LinkedIn Search", tier: "freemium", description: "Trouve le profil LinkedIn du dirigeant (4 strategies)", enabled: true },
  { name: "kaspr", label: "Kaspr (LinkedIn)", tier: "premium", description: "Email + tel via LinkedIn (illimite)", enabled: true },
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
  linkedin_search: <Linkedin size={13} />,
  kaspr: <Linkedin size={13} />,
};

/* ================================================================== */
/*  Main Page                                                          */
/* ================================================================== */

export default function EnrichmentPage() {
  const { data, loading } = useStats();
  const [sources, setSources] = useState<SourceToggle[]>(DEFAULT_SOURCES);
  const [useKaspr, setUseKaspr] = useState(true);
  const [enrichLimit, setEnrichLimit] = useState(20);
  const [stopOnConfidence, setStopOnConfidence] = useState(80);
  const [enrichmentFilter, setEnrichmentFilter] = useState<"pending" | "failed" | "no_email" | "all">("pending");

  // Multi-select filters
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);

  // Run state
  const [status, setStatus] = useState<RunStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [progress, setProgress] = useState({ processed: 0, total: 0, enriched: 0, failed: 0, skipped: 0, percent: 0 });
  const [currentLead, setCurrentLead] = useState<CurrentLead | null>(null);
  const [leadResults, setLeadResults] = useState<EnrichResultItem[]>([]);
  const [summary, setSummary] = useState<EnrichSummary | null>(null);
  const [sourceStats, setSourceStats] = useState<Record<string, SourceStat> | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [jobStartTime, setJobStartTime] = useState<string | null>(null);

  // Source health
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[]>([]);

  // UI toggles
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllCities, setShowAllCities] = useState(false);
  const [showSourceDetail, setShowSourceDetail] = useState(false);

  // Refs for cleanup + stale closure fix
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestJobIdRef = useRef<string | null>(null);

  // Signal state
  const [signalSending, setSignalSending] = useState(false);

  async function sendSignal(signal: "pause" | "stop") {
    if (!jobId || signalSending) return;
    setSignalSending(true);
    try {
      await fetch(`/api/jobs/${jobId}/signal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "gtm_enrichment_jobs", signal }),
      });
    } catch {
      // Signal best-effort — backend checks DB on next iteration
    } finally {
      setSignalSending(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Cleanup on unmount                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  On mount: check source health + resume running job               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    // Source health
    fetch("/api/enrich/sources")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSourceHealth(d.sources);
      })
      .catch(() => {});

    // Check for a running job to resume
    fetch("/api/enrich/jobs?status=running&limit=1")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.jobs.length > 0) {
          const runningJob = d.jobs[0] as EnrichJob;
          // Safety: if the job has been "running" for more than 10 minutes, treat it as stale
          const jobAge = Date.now() - new Date(runningJob.created_at).getTime();
          const MAX_JOB_AGE_MS = 10 * 60 * 1000; // 10 minutes
          if (jobAge > MAX_JOB_AGE_MS) {
            // Stale job — skip to last completed
            fetch("/api/enrich/jobs?status=completed&limit=1")
              .then((r2) => r2.json())
              .then((d2) => {
                if (d2.success && d2.jobs.length > 0) {
                  restoreFromJob(d2.jobs[0] as EnrichJob);
                }
              })
              .catch(() => {});
            return;
          }
          setJobId(runningJob.id);
          setStatus("running");
          setTarget("Reprise en cours...");
          setProgress({
            processed: runningJob.progress_processed,
            total: runningJob.progress_total,
            enriched: runningJob.progress_enriched,
            failed: 0,
            skipped: 0,
            percent: runningJob.progress_total > 0
              ? Math.round((runningJob.progress_processed / runningJob.progress_total) * 100)
              : 0,
          });
          // Start polling this job
          startPolling(runningJob.id);
        } else {
          // Check for a paused job to offer resume
          fetch("/api/enrich/jobs?status=paused&limit=1")
            .then((r2) => r2.json())
            .then((d2) => {
              if (d2.success && d2.jobs.length > 0) {
                const pausedJob = d2.jobs[0] as EnrichJob;
                setJobId(pausedJob.id);
                setStatus("paused");
                const parsedResultsForCounts = safeLeadResults(pausedJob.lead_results);
                const failedFromResults = parsedResultsForCounts.filter((r) => r.status === "failed").length;
                const skippedFromResults = parsedResultsForCounts.filter((r) => r.status === "skipped").length;
                setProgress({
                  processed: pausedJob.progress_processed ?? 0,
                  total: pausedJob.progress_total ?? 0,
                  enriched: pausedJob.progress_enriched ?? 0,
                  failed: failedFromResults,
                  skipped: skippedFromResults,
                  percent: pausedJob.progress_total > 0
                    ? Math.round((pausedJob.progress_processed / pausedJob.progress_total) * 100)
                    : 0,
                });
                const parsedSummary = safeSummary(pausedJob.summary);
                if (parsedSummary) setSummary(parsedSummary);
                const parsedStats = safeSourceStats(pausedJob.source_stats);
                if (parsedStats) setSourceStats(parsedStats);
                const parsedResults = safeLeadResults(pausedJob.lead_results);
                if (parsedResults.length > 0) setLeadResults(parsedResults);
              } else {
                // Check last completed job for display
                fetch("/api/enrich/jobs?status=completed&limit=1")
                  .then((r3) => r3.json())
                  .then((d3) => {
                    if (d3.success && d3.jobs.length > 0) {
                      const lastJob = d3.jobs[0] as EnrichJob;
                      restoreFromJob(lastJob);
                    }
                  })
                  .catch(() => {});
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Restore state from a completed job                               */
  /* ---------------------------------------------------------------- */

  function restoreFromJob(job: EnrichJob) {
    setJobId(job.id);
    setStatus("done");
    // Derive failed/skipped from lead_results if available
    const parsedResultsForCounts = safeLeadResults(job.lead_results);
    const failedFromResults = parsedResultsForCounts.filter((r) => r.status === "failed").length;
    const skippedFromResults = parsedResultsForCounts.filter((r) => r.status === "skipped").length;
    setProgress({
      processed: job.progress_processed ?? 0,
      total: job.progress_total ?? 0,
      enriched: job.progress_enriched ?? 0,
      failed: failedFromResults,
      skipped: skippedFromResults,
      percent: 100,
    });
    const parsedSummary = safeSummary(job.summary);
    if (parsedSummary) setSummary(parsedSummary);
    const parsedStats = safeSourceStats(job.source_stats);
    if (parsedStats) setSourceStats(parsedStats);
    const parsedResults = safeLeadResults(job.lead_results);
    if (parsedResults.length > 0) setLeadResults(parsedResults);
  }

  /* ---------------------------------------------------------------- */
  /*  Polling fallback (when SSE disconnects or on page resume)        */
  /* ---------------------------------------------------------------- */

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    let pollCount = 0;
    const MAX_POLL_CYCLES = 100; // ~5 minutes at 3s interval

    pollRef.current = setInterval(async () => {
      pollCount++;
      // Safety: stop polling after too many cycles to prevent infinite spin
      if (pollCount > MAX_POLL_CYCLES) {
        if (pollRef.current) clearInterval(pollRef.current);
        setStatus("error");
        setErrorMsg("Timeout: le job ne repond plus (abandon apres 5 min de polling)");
        stopTimer();
        return;
      }

      try {
        const res = await fetch(`/api/enrich/jobs/${id}`);
        const d = await res.json();
        if (!d.success) return;

        const job = d.job as EnrichJob;
        setProgress((prev) => ({
          processed: job.progress_processed,
          total: job.progress_total,
          enriched: job.progress_enriched,
          failed: prev.failed,
          skipped: prev.skipped,
          percent: job.progress_total > 0
            ? Math.round((job.progress_processed / job.progress_total) * 100)
            : 0,
        }));

        if (job.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          restoreFromJob(job);
          stopTimer();
        } else if (job.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("error");
          setErrorMsg(job.error || "Erreur inconnue");
          stopTimer();
        } else if (job.status === "paused" || job.status === "stopped") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus(job.status as "paused" | "stopped");
          setCurrentLead(null);
          latestJobIdRef.current = null;
          const parsedSummary = safeSummary(job.summary);
          if (parsedSummary) setSummary(parsedSummary);
          const parsedStats = safeSourceStats(job.source_stats);
          if (parsedStats) setSourceStats(parsedStats);
          stopTimer();
        }
      } catch {
        // Silently retry next interval
      }
    }, 3000);
  }

  /* ---------------------------------------------------------------- */
  /*  Timer                                                            */
  /* ---------------------------------------------------------------- */

  const startTimer = useCallback(() => {
    const start = Date.now();
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 200);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Toggle handlers                                                  */
  /* ---------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------- */
  /*  Run enrichment via SSE stream                                    */
  /* ---------------------------------------------------------------- */

  const runEnrich = useCallback(
    async (opts: { category?: string; city?: string; categories?: string[]; cities?: string[]; label: string }) => {
      // Reset state
      setStatus("running");
      setTarget(opts.label);
      setProgress({ processed: 0, total: 0, enriched: 0, failed: 0, skipped: 0, percent: 0 });
      setCurrentLead(null);
      setLeadResults([]);
      setSummary(null);
      setSourceStats(null);
      setErrorMsg(null);
      setJobId(null);
      setJobStartTime(new Date().toISOString());
      latestJobIdRef.current = null;
      startTimer();

      // Abort previous stream if any
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const enabledSources = sources.filter((s) => s.enabled).map((s) => s.name);
        const res = await fetch("/api/enrich/v2/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            category: opts.category,
            city: opts.city,
            categories: opts.categories,
            cities: opts.cities,
            limit: enrichLimit,
            sources: enabledSources,
            stopOnConfidence,
            useKaspr,
            minScoreForPaid: 0,
            enrichmentFilter,
          }),
        });

        // Detect JSON response (happens when 0 leads match the query)
        // Backend returns NextResponse.json() instead of SSE stream in that case
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          stopTimer();
          if (data.success && data.processed === 0) {
            setStatus("done");
            setSummary(null);
            setProgress({ processed: 0, total: 0, enriched: 0, failed: 0, skipped: 0, percent: 100 });
            return;
          }
          setStatus("error");
          setErrorMsg(data.error || "Reponse inattendue du serveur");
          return;
        }

        if (!res.ok || !res.body) {
          stopTimer();
          setStatus("error");
          setErrorMsg(`HTTP ${res.status}`);
          return;
        }

        // Read SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          buffer = parseSSEEvents(buffer, (eventType, eventData) => {
            try {
              const data = JSON.parse(eventData);

              if (eventType === "job_created") {
                const jid = typeof data.jobId === "string" ? data.jobId : null;
                setJobId(jid);
                latestJobIdRef.current = jid;
              } else if (eventType === "lead_start") {
                setCurrentLead({
                  leadId: data.leadId as string,
                  name: data.name as string,
                  website: data.website as string,
                  index: data.index as number,
                  total: data.total as number,
                });
              } else if (eventType === "lead_done") {
                setCurrentLead(null);
                const parsed = safeLeadResult(data);
                if (parsed) setLeadResults((prev) => [...prev, parsed]);
              } else if (eventType === "lead_error") {
                setCurrentLead(null);
                const errItem: EnrichResultItem = {
                  leadId: data.leadId as string,
                  name: data.name as string,
                  status: data.status as "failed" | "skipped",
                  bestEmail: null,
                  bestPhone: null,
                  dirigeant: null,
                  siret: null,
                  confidence: 0,
                  sourcesTried: [],
                  decisionMakers: [],
                  error: data.error as string,
                };
                setLeadResults((prev) => [...prev, errItem]);
              } else if (eventType === "progress") {
                setProgress({
                  processed: data.processed as number,
                  total: data.total as number,
                  enriched: data.enriched as number,
                  failed: (data.failed as number) ?? 0,
                  skipped: (data.skipped as number) ?? 0,
                  percent: data.percent as number,
                });
              } else if (eventType === "lead_result") {
                // Backward compat for old SSE events
                const parsed = safeLeadResult(data);
                if (parsed) setLeadResults((prev) => [...prev, parsed]);
              } else if (eventType === "paused" || eventType === "stopped") {
                stopTimer();
                setStatus(eventType as "paused" | "stopped");
                setCurrentLead(null);
                latestJobIdRef.current = null;
                const parsedSummary = safeSummary(data.summary);
                if (parsedSummary) setSummary(parsedSummary);
                const parsedStats = safeSourceStats(data.sourceStats);
                if (parsedStats) setSourceStats(parsedStats);
                setProgress((prev) => ({
                  ...prev,
                  processed: typeof data.processed === "number" ? data.processed : prev.processed,
                  enriched: typeof data.enriched === "number" ? data.enriched : prev.enriched,
                  failed: typeof data.failed === "number" ? data.failed : prev.failed,
                  skipped: typeof data.skipped === "number" ? data.skipped : prev.skipped,
                  percent: typeof data.percent === "number" ? data.percent : prev.percent,
                }));
              } else if (eventType === "done") {
                stopTimer();
                setStatus("done");
                setCurrentLead(null);
                latestJobIdRef.current = null;
                const parsedSummary = safeSummary(data.summary);
                if (parsedSummary) setSummary(parsedSummary);
                const parsedStats = safeSourceStats(data.sourceStats);
                if (parsedStats) setSourceStats(parsedStats);
                setProgress((prev) => ({
                  ...prev,
                  percent: 100,
                  failed: (data.failed as number) ?? prev.failed,
                  skipped: (data.skipped as number) ?? prev.skipped,
                }));
              } else if (eventType === "error") {
                stopTimer();
                setStatus("error");
                setCurrentLead(null);
                latestJobIdRef.current = null;
                setErrorMsg((data as { message: string }).message);
              }
            } catch {
              // Skip malformed events
            }
          });
        }

        // Safety: if stream ended but no done/error event was received,
        // force status out of "running" to prevent infinite spinner
        const currentJobIdAfterStream = latestJobIdRef.current;
        if (currentJobIdAfterStream) {
          // Stream ended prematurely — poll for job completion
          startPolling(currentJobIdAfterStream);
        } else {
          // No jobId = stream ended without creating a job, or done event already fired
          stopTimer();
          setStatus((prev) => prev === "running" ? "done" : prev);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        stopTimer();

        const currentJobIdOnError = latestJobIdRef.current;
        if (currentJobIdOnError) {
          startPolling(currentJobIdOnError);
        } else {
          setStatus("error");
          setErrorMsg("Connexion perdue");
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, enrichLimit, stopOnConfidence, useKaspr, enrichmentFilter, startTimer, stopTimer],
  );

  const runEnrichAll = useCallback(() => {
    const label = selectedCategories.length > 0 || selectedCities.length > 0
      ? `Filtré: ${[...selectedCategories, ...selectedCities].join(", ")}`
      : "Tous les leads sans email";
    runEnrich({
      categories: selectedCategories.length > 0 ? selectedCategories : undefined,
      cities: selectedCities.length > 0 ? selectedCities : undefined,
      label,
    });
  }, [runEnrich, selectedCategories, selectedCities]);

  /* ---------------------------------------------------------------- */
  /*  Loading state                                                    */
  /* ---------------------------------------------------------------- */

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

  // Helper to check source health
  function isSourceConfigured(name: string): boolean | null {
    const health = sourceHealth.find((s) => s.name === name);
    return health ? health.configured : null;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-semibold tracking-tight">Enrichissement Waterfall v2</h1>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7" }}>
            7 sources
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
                <option value={200}>200 leads</option>
                <option value={500}>500 leads</option>
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
                    {tierSources.map((src) => {
                      const configured = isSourceConfigured(src.name);
                      return (
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
                              {configured !== null && (
                                <span title={configured ? "API configuree" : "Cle API manquante"}>
                                  <CircleDot
                                    size={8}
                                    style={{ color: configured ? "#22c55e" : "#ef4444" }}
                                  />
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                              {src.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Kaspr Info */}
          {useKaspr && (
            <div
              className="mt-4 px-4 py-3 rounded-lg flex items-start gap-2.5"
              style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "#a855f7" }} />
              <div>
                <p className="text-[11px] font-medium" style={{ color: "#a855f7" }}>
                  Kaspr active (emails illimites)
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Kaspr sera utilise en dernier recours, pour les leads sans email apres les sources gratuites.
                  Necessite un profil LinkedIn du dirigeant (trouve par les sources precedentes).
                </p>
              </div>
            </div>
          )}

          {/* Multi-Select Filters */}
          <div className="mt-5 pt-4 border-t border-[var(--border)]">
            <div className="flex items-center gap-2 mb-3">
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
                Filtrer les leads a enrichir
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                (optionnel — vide = tous les leads pending)
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {/* Category multi-select */}
              <div>
                <label className="text-[10px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>Categories / Niches</label>
                <div className="flex flex-wrap gap-1.5 p-2 rounded-lg max-h-28 overflow-y-auto" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                  {categoryEmailRates.length === 0 && (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Aucune categorie</span>
                  )}
                  {categoryEmailRates.map((cat) => {
                    const selected = selectedCategories.includes(cat.name);
                    return (
                      <button
                        key={cat.name}
                        type="button"
                        onClick={() => {
                          setSelectedCategories((prev) =>
                            selected ? prev.filter((c) => c !== cat.name) : [...prev, cat.name]
                          );
                        }}
                        className="text-[10px] px-2 py-1 rounded-md transition-all"
                        style={{
                          background: selected ? "var(--accent)" : "var(--bg-hover)",
                          color: selected ? "white" : "var(--text-secondary)",
                          border: selected ? "1px solid var(--accent)" : "1px solid transparent",
                        }}
                      >
                        {cat.name} ({cat.total - cat.withEmail})
                      </button>
                    );
                  })}
                </div>
                {selectedCategories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCategories([])}
                    className="text-[9px] mt-1"
                    style={{ color: "var(--accent-hover)" }}
                  >
                    Effacer ({selectedCategories.length})
                  </button>
                )}
              </div>
              {/* City multi-select */}
              <div>
                <label className="text-[10px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>Villes</label>
                <div className="flex flex-wrap gap-1.5 p-2 rounded-lg max-h-28 overflow-y-auto" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                  {cityEmailRates.length === 0 && (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Aucune ville</span>
                  )}
                  {cityEmailRates.map((city) => {
                    const selected = selectedCities.includes(city.name);
                    return (
                      <button
                        key={city.name}
                        type="button"
                        onClick={() => {
                          setSelectedCities((prev) =>
                            selected ? prev.filter((c) => c !== city.name) : [...prev, city.name]
                          );
                        }}
                        className="text-[10px] px-2 py-1 rounded-md transition-all"
                        style={{
                          background: selected ? "var(--accent)" : "var(--bg-hover)",
                          color: selected ? "white" : "var(--text-secondary)",
                          border: selected ? "1px solid var(--accent)" : "1px solid transparent",
                        }}
                      >
                        {city.name} ({city.total - city.withEmail})
                      </button>
                    );
                  })}
                </div>
                {selectedCities.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCities([])}
                    className="text-[9px] mt-1"
                    style={{ color: "var(--accent-hover)" }}
                  >
                    Effacer ({selectedCities.length})
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Run Buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
            <div className="flex items-center gap-3">
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {enabledCount} sources actives &middot; {(stats.withWebsite - stats.withEmail).toLocaleString()} leads avec site web sans email
                {(selectedCategories.length > 0 || selectedCities.length > 0) && (
                  <span style={{ color: "var(--accent-hover)" }}>
                    {" "}&middot; Filtre: {[...selectedCategories, ...selectedCities].join(", ")}
                  </span>
                )}
              </div>
              <select
                value={enrichmentFilter}
                onChange={(e) => setEnrichmentFilter(e.target.value as "pending" | "failed" | "no_email" | "all")}
                disabled={status === "running"}
                className="text-[11px] px-2 py-1 rounded-md border border-[var(--border)] disabled:opacity-50"
                style={{ background: "var(--bg-raised)", color: "var(--text-primary)" }}
              >
                <option value="pending">Non tentes</option>
                <option value="failed">Echecs (re-enrichir)</option>
                <option value="no_email">Sans email</option>
                <option value="all">Tous (force)</option>
              </select>
            </div>
            <button
              onClick={runEnrichAll}
              disabled={status === "running" || enabledCount === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
              style={{ background: "var(--accent)", color: "white" }}
            >
              {status === "running" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              {status === "running" ? "Enrichissement en cours..." : "Lancer l'enrichissement"}
            </button>
          </div>
        </div>
      </div>

      {/* Running Indicator with REAL progress */}
      {status === "running" && (
        <div
          className="rounded-xl border border-[var(--border)] mb-6 p-5"
          style={{ background: "var(--bg-raised)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Loader2 size={16} className="animate-spin" style={{ color: "var(--accent)" }} />
              <span className="text-sm font-medium">Enrichissement en cours...</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {target}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => sendSignal("pause")}
                disabled={signalSending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90 cursor-pointer disabled:opacity-50"
                style={{ background: "var(--amber-subtle)", color: "var(--amber)", border: "1px solid rgba(245,158,11,0.3)" }}
              >
                <Pause size={12} /> Pause
              </button>
              <button
                onClick={() => sendSignal("stop")}
                disabled={signalSending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90 cursor-pointer disabled:opacity-50"
                style={{ background: "var(--red-subtle)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                <Square size={12} /> Arreter
              </button>
            </div>
          </div>

          {/* Current lead being processed */}
          {currentLead && (
            <div
              className="mb-3 px-3 py-2 rounded-lg flex items-center gap-3"
              style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }}
            >
              <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "var(--accent)" }} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {currentLead.name}
                </div>
                <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                  {currentLead.website}
                </div>
              </div>
              <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--accent)" }}>
                {currentLead.index}/{currentLead.total}
              </span>
            </div>
          )}

          <div className="flex items-center gap-4 text-[11px] flex-wrap" style={{ color: "var(--text-muted)" }}>
            <span className="flex items-center gap-1">
              <Clock size={11} /> {(elapsedMs / 1000).toFixed(1)}s
            </span>
            <span>{progress.processed}/{progress.total} traites</span>
            <span style={{ color: "#22c55e" }}>{progress.enriched} enrichis</span>
            {progress.failed > 0 && (
              <span style={{ color: "#ef4444" }}>{progress.failed} echoues</span>
            )}
            {progress.skipped > 0 && (
              <span style={{ color: "#f59e0b" }}>{progress.skipped} skipped</span>
            )}
            <span>{progress.percent}%</span>
          </div>

          {/* Real progress bar */}
          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg)" }}>
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                background: "var(--accent)",
                width: `${Math.max(progress.percent, progress.total > 0 ? 2 : 0)}%`,
              }}
            />
          </div>

          {/* Live lead results feed */}
          {leadResults.length > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto space-y-1">
              {leadResults.slice(-8).map((r) => (
                <div key={r.leadId} className="text-[10px] flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                  {r.status === "failed" || r.status === "skipped" ? (
                    <AlertTriangle size={10} style={{ color: r.status === "skipped" ? "#f59e0b" : "#ef4444" }} />
                  ) : r.bestEmail ? (
                    <CheckCircle size={10} style={{ color: "#22c55e" }} />
                  ) : (
                    <CircleDot size={10} style={{ color: "var(--text-muted)" }} />
                  )}
                  <span className="font-medium truncate max-w-[120px]">{r.name || r.leadId.slice(0, 8)}</span>
                  {r.bestEmail && <span style={{ color: "#22c55e" }}>{r.bestEmail}</span>}
                  {r.bestPhone && <span style={{ color: "#3b82f6" }}>{r.bestPhone}</span>}
                  {r.error && <span style={{ color: "#ef4444" }}>{r.error}</span>}
                  {!r.bestEmail && !r.bestPhone && !r.error && <span>aucun resultat</span>}
                  <span className="ml-auto">{r.confidence > 0 ? `${r.confidence}%` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Paused Banner */}
      {status === "paused" && (
        <div
          className="rounded-xl mb-6 px-5 py-4"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Pause size={16} style={{ color: "#f59e0b" }} />
              <div>
                <span className="text-sm font-medium" style={{ color: "#f59e0b" }}>
                  Enrichissement en pause
                </span>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {progress.processed}/{progress.total} traites &middot; {progress.enriched} enrichis
                  {progress.failed > 0 && ` \u00b7 ${progress.failed} echoues`}
                  {progress.skipped > 0 && ` \u00b7 ${progress.skipped} skipped`}
                  &middot; {(elapsedMs / 1000).toFixed(1)}s ecoules
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={runEnrichAll}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90"
                style={{ background: "#f59e0b", color: "white" }}
              >
                <RefreshCw size={12} /> Reprendre
              </button>
              <a
                href="/leads?hasEmail=yes"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                <ExternalLink size={11} /> Voir les leads
              </a>
            </div>
          </div>
          {/* Show partial progress bar */}
          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg)" }}>
            <div
              className="h-full rounded-full"
              style={{ background: "#f59e0b", width: `${Math.max(progress.percent, 2)}%` }}
            />
          </div>
        </div>
      )}

      {/* Stopped Banner */}
      {status === "stopped" && (
        <div
          className="rounded-xl mb-6 px-5 py-4"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Square size={16} style={{ color: "#ef4444" }} />
              <div>
                <span className="text-sm font-medium" style={{ color: "#ef4444" }}>
                  Enrichissement arrete
                </span>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {progress.processed}/{progress.total} traites &middot; {progress.enriched} enrichis
                  {progress.failed > 0 && ` \u00b7 ${progress.failed} echoues`}
                  {progress.skipped > 0 && ` \u00b7 ${progress.skipped} skipped`}
                  &middot; Arrete par l&apos;utilisateur
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {progress.enriched > 0 && (
                <a
                  href="/leads?hasEmail=yes"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: "var(--green-subtle)", color: "var(--green)", border: "1px solid rgba(34,197,94,0.2)" }}
                >
                  <ExternalLink size={11} /> Voir les {progress.enriched} leads enrichis
                </a>
              )}
              <button
                onClick={() => { setStatus("idle"); setLeadResults([]); setSummary(null); setSourceStats(null); setProgress({ processed: 0, total: 0, enriched: 0, failed: 0, skipped: 0, percent: 0 }); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                <RefreshCw size={11} /> Nouveau enrichissement
              </button>
            </div>
          </div>
          {/* Progress bar showing where we stopped */}
          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg)" }}>
            <div
              className="h-full rounded-full"
              style={{ background: "#ef4444", width: `${Math.max(progress.percent, 2)}%` }}
            />
          </div>
        </div>
      )}

      {/* Results Banner */}
      {status === "done" && summary && (
        <div className="rounded-xl border border-[var(--border)] mb-6" style={{ background: "var(--bg-raised)" }}>
          {/* Summary Header */}
          <div className="p-5 border-b border-[var(--border)]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <CheckCircle size={18} style={{ color: "var(--green)" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--green)" }}>
                  Enrichissement termine
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {progress.processed} traites &middot; {progress.enriched} enrichis
                  {progress.failed > 0 && ` \u00b7 ${progress.failed} echoues`}
                  {progress.skipped > 0 && ` \u00b7 ${progress.skipped} skipped`}
                  {summary.avgDurationMs > 0 && ` \u00b7 ${(summary.avgDurationMs / 1000).toFixed(1)}s en moyenne`}
                </span>
              </div>
              {progress.enriched > 0 && (
                <a
                  href={`/leads?hasEmail=yes${jobStartTime ? `&enriched_after=${encodeURIComponent(jobStartTime)}` : ""}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: "var(--green-subtle)", color: "var(--green)", border: "1px solid rgba(34,197,94,0.2)" }}
                >
                  <ExternalLink size={11} />
                  Voir les {progress.enriched} leads enrichis
                </a>
              )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                icon={<Mail size={14} />}
                label="Emails trouves"
                value={summary.totalEmails}
                total={progress.processed}
                color="#22c55e"
              />
              <StatCard
                icon={<Phone size={14} />}
                label="Telephones"
                value={summary.totalPhones}
                total={progress.processed}
                color="#3b82f6"
              />
              <StatCard
                icon={<Hash size={14} />}
                label="SIRET"
                value={summary.totalSiret}
                total={progress.processed}
                color="#f59e0b"
              />
              <StatCard
                icon={<UserCheck size={14} />}
                label="Dirigeants"
                value={summary.totalDirigeants}
                total={progress.processed}
                color="#a855f7"
              />
            </div>
          </div>

          {/* Source Stats */}
          {sourceStats && (
            <div className="p-5 border-b border-[var(--border)]">
              <h3 className="text-xs font-medium mb-3 flex items-center gap-2">
                <TrendingUp size={13} style={{ color: "var(--text-muted)" }} />
                Performance par source
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(sourceStats).map(([name, stat]) => {
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
                        {(stat?.emailFound ?? 0) > 0 && (
                          <span>
                            <Mail size={9} className="inline mr-0.5" style={{ verticalAlign: "-1px" }} />
                            {stat.emailFound}
                          </span>
                        )}
                        {(stat?.phoneFound ?? 0) > 0 && (
                          <span>
                            <Phone size={9} className="inline mr-0.5" style={{ verticalAlign: "-1px" }} />
                            {stat.phoneFound}
                          </span>
                        )}
                        {(stat?.siretFound ?? 0) > 0 && (
                          <span>
                            <Hash size={9} className="inline mr-0.5" style={{ verticalAlign: "-1px" }} />
                            {stat.siretFound}
                          </span>
                        )}
                        <span className="ml-auto">{stat?.tried ?? 0} essais</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Detailed results toggle */}
          {leadResults.length > 0 && (
            <div className="p-5">
              <button
                type="button"
                onClick={() => setShowSourceDetail(!showSourceDetail)}
                className="text-xs font-medium flex items-center gap-1.5 mb-3"
                style={{ color: "var(--accent-hover)" }}
              >
                <FileText size={12} />
                {showSourceDetail ? "Masquer" : "Voir"} les details par lead ({leadResults.length})
                <ChevronDown
                  size={12}
                  style={{ transform: showSourceDetail ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                />
              </button>

              {showSourceDetail && (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {leadResults.map((r) => (
                    <div
                      key={r.leadId}
                      className="rounded-lg px-3 py-2.5 text-[11px]"
                      style={{
                        background: r.status === "failed" ? "rgba(239,68,68,0.03)" : r.status === "skipped" ? "rgba(245,158,11,0.03)" : "var(--bg)",
                        border: r.status === "failed" ? "1px solid rgba(239,68,68,0.15)" : r.status === "skipped" ? "1px solid rgba(245,158,11,0.15)" : "1px solid var(--border)",
                      }}
                    >
                      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                        {r.status === "failed" ? (
                          <AlertTriangle size={11} style={{ color: "#ef4444" }} />
                        ) : r.status === "skipped" ? (
                          <Clock size={11} style={{ color: "#f59e0b" }} />
                        ) : (
                          <CheckCircle size={11} style={{ color: "#22c55e" }} />
                        )}
                        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                          {r.name || r.leadId.slice(0, 8)}
                        </span>
                        {r.error && (
                          <span className="text-[10px]" style={{ color: "#ef4444" }}>
                            {r.error}
                          </span>
                        )}
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
                              color: r.confidence >= 80 ? "var(--green)" : r.confidence >= 50 ? "#f59e0b" : "var(--text-muted)",
                            }}
                          >
                            {r.confidence}%
                          </span>
                        </span>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {(r.sourcesTried ?? []).map((s) => (
                          <span
                            key={s}
                            className="text-[9px] px-1.5 py-0.5 rounded"
                            style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Done but no results */}
      {status === "done" && !summary && (
        <div
          className="rounded-xl mb-6 px-5 py-4 flex items-center gap-3"
          style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)" }}
        >
          <CheckCircle size={16} style={{ color: "var(--green)" }} />
          <span className="text-sm" style={{ color: "var(--green)" }}>
            Aucun lead a enrichir (tous ont deja un email ou pas de site web)
          </span>
        </div>
      )}

      {/* Error Banner */}
      {status === "error" && (
        <div
          className="rounded-xl mb-6 px-5 py-4 flex items-center gap-3"
          style={{ background: "var(--red-subtle)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <AlertTriangle size={16} style={{ color: "var(--red)" }} />
          <span className="text-sm" style={{ color: "var(--red)" }}>{errorMsg || "Erreur inconnue"}</span>
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
                  onEnrich={() => runEnrich({ category: cat.name, label: cat.name })}
                  enriching={status === "running" && target === cat.name}
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
                  onEnrich={() => runEnrich({ city: city.name, label: city.name })}
                  enriching={status === "running" && target === city.name}
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
        AVA GTM &middot; Waterfall Enrichment Engine v2 &middot; 7 sources
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
