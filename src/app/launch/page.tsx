"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { VERTICALES as CANONICAL_VERTICALES, VILLES_FRANCE } from "@/lib/verticales";
import { useCampaigns } from "@/lib/useCampaigns";
import { useStats } from "@/lib/useStats";
import { parseSSEEvents } from "@/lib/parseSSE";
import Link from "next/link";
import {
  Rocket,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  MapPin,
  Briefcase,
  Hash,
  Mail,
  Zap,
  AlertTriangle,
  X,
  Search,
} from "lucide-react";

/* ─── Derived verticales for UI ─── */

const VERTICALES = CANONICAL_VERTICALES.map((v) => ({
  id: v.id,
  name: v.name,
  icon: v.emoji,
  score: v.totalScore,
  dealValue: `${v.avgDealValue}\u20AC/mois`,
  marketSize: v.marketSize.toLocaleString(),
  tier: v.tier,
}));

/* ─── Types ─── */

type LaunchStatus = "idle" | "loading" | "streaming" | "done" | "error";
type CampaignMode = "existing" | "new";

interface EmailAccount {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  warmupStatus: string;
  dailyLimit: number;
}

interface Diagnostic {
  reason: string;
  totalLeadsMatchingFilters: number;
}

interface ComboStatus {
  ville: string;
  niche: string;
  nicheLabel: string;
  status: "pending" | "streaming" | "done" | "error";
  uploaded: number;
  errors: number;
  total: number;
  message?: string;
  diagnostic?: Diagnostic;
}

/* ─── Main Component ─── */

export default function LaunchPage() {
  // Multi-select state
  const [selectedVilles, setSelectedVilles] = useState<string[]>([]);
  const [villeSearch, setVilleSearch] = useState("");
  const [selectedNiches, setSelectedNiches] = useState<string[]>([]);
  const [leadCount, setLeadCount] = useState<number>(500);

  // Campaign config
  const [campaignMode, setCampaignMode] = useState<CampaignMode>("existing");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [newCampaignName, setNewCampaignName] = useState<string>("");

  // Email accounts
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // Orchestration state
  const [status, setStatus] = useState<LaunchStatus>("idle");
  const [combos, setCombos] = useState<ComboStatus[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const { data: campaignData } = useCampaigns();
  const { data: statsData } = useStats();

  const connected = campaignData?.connected ?? false;
  const activeCampaignId = campaignData?.activeCampaignId ?? "";
  const campaigns = campaignData?.campaigns ?? [];
  const emailsAvailable = statsData?.stats.withEmail ?? 0;

  // Computed
  const villeOptions = villeSearch
    ? VILLES_FRANCE.filter((v) => v.toLowerCase().includes(villeSearch.toLowerCase()))
    : VILLES_FRANCE;

  const effectiveVilles = selectedVilles.length > 0 ? selectedVilles : [""];
  const effectiveNiches = selectedNiches.length > 0 ? selectedNiches : [""];
  const comboCount = effectiveVilles.length * effectiveNiches.length;
  const hasTarget = selectedVilles.length > 0 || selectedNiches.length > 0;

  // Totals from combos
  const totalUploaded = combos.reduce((s, c) => s + c.uploaded, 0);
  const totalErrors = combos.reduce((s, c) => s + c.errors, 0);
  const combosDone = combos.filter((c) => c.status === "done" || c.status === "error").length;
  const combosWithDiagnostic = combos.filter((c) => c.diagnostic?.reason === "leads_exist_but_no_email");

  // Load email accounts
  useEffect(() => {
    async function loadAccounts() {
      setAccountsLoading(true);
      try {
        const resp = await fetch("/api/orchestrate/accounts", { cache: "no-store" });
        if (resp.ok) {
          const data = await resp.json();
          setEmailAccounts(data.accounts ?? []);
        }
      } catch {
        // Silent
      } finally {
        setAccountsLoading(false);
      }
    }
    loadAccounts();
  }, []);

  const toggleAccount = useCallback((accountId: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId],
    );
  }, []);

  const toggleVille = useCallback((ville: string) => {
    setSelectedVilles((prev) =>
      prev.includes(ville) ? prev.filter((v) => v !== ville) : [...prev, ville],
    );
  }, []);

  const toggleNiche = useCallback((nicheId: string) => {
    setSelectedNiches((prev) =>
      prev.includes(nicheId) ? prev.filter((n) => n !== nicheId) : [...prev, nicheId],
    );
  }, []);

  // ─── Launch: sequential SSE per combo ───
  const handleLaunch = useCallback(async () => {
    if (!hasTarget) return;
    if (!connected) {
      setErrorMessage("Service email non disponible. Verifiez la configuration.");
      setStatus("error");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Build combos
    const newCombos: ComboStatus[] = [];
    for (const ville of effectiveVilles) {
      for (const niche of effectiveNiches) {
        const nicheLabel = niche
          ? VERTICALES.find((v) => v.id === niche)?.name || niche
          : "Toutes";
        newCombos.push({
          ville: ville || "Toutes",
          niche,
          nicheLabel,
          status: "pending",
          uploaded: 0,
          errors: 0,
          total: 0,
        });
      }
    }

    setCombos(newCombos);
    setStatus("streaming");
    setErrorMessage("");

    // Process sequentially
    for (let idx = 0; idx < newCombos.length; idx++) {
      if (controller.signal.aborted) break;

      const combo = newCombos[idx];

      // Mark streaming
      setCombos((prev) => prev.map((c, i) => i === idx ? { ...c, status: "streaming" } : c));

      try {
        const payload: Record<string, unknown> = {
          ville: combo.ville === "Toutes" ? "" : combo.ville,
          niche: combo.niche,
          count: leadCount,
        };

        if (campaignMode === "existing") {
          payload.campaignId = selectedCampaignId || activeCampaignId;
        } else if (campaignMode === "new" && newCampaignName.trim()) {
          payload.campaignName = newCampaignName.trim();
        }

        if (selectedAccounts.length > 0) {
          payload.emailAccounts = selectedAccounts;
        }

        const resp = await fetch("/api/orchestrate/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({ error: `Erreur ${resp.status}` }));
          setCombos((prev) => prev.map((c, i) =>
            i === idx ? { ...c, status: "error", message: (errData as { error?: string }).error || `Erreur ${resp.status}` } : c,
          ));
          continue;
        }

        const reader = resp.body?.getReader();
        if (!reader) {
          setCombos((prev) => prev.map((c, i) =>
            i === idx ? { ...c, status: "error", message: "Stream non disponible" } : c,
          ));
          continue;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = parseSSEEvents(buffer, (eventType, eventData) => {
            try {
              const data = JSON.parse(eventData) as Record<string, unknown>;
              if (eventType === "progress") {
                setCombos((prev) => prev.map((c, i) =>
                  i === idx ? {
                    ...c,
                    uploaded: (data.uploaded as number) ?? c.uploaded,
                    total: (data.total as number) ?? c.total,
                    errors: (data.errors as number) ?? c.errors,
                  } : c,
                ));
              } else if (eventType === "done") {
                setCombos((prev) => prev.map((c, i) =>
                  i === idx ? {
                    ...c,
                    status: "done",
                    uploaded: (data.uploaded as number) ?? c.uploaded,
                    errors: (data.errors as number) ?? c.errors,
                    total: (data.total as number) ?? c.total,
                    message: data.message as string | undefined,
                    diagnostic: data.diagnostic as Diagnostic | undefined,
                  } : c,
                ));
              } else if (eventType === "error") {
                setCombos((prev) => prev.map((c, i) =>
                  i === idx ? { ...c, status: "error", message: (data.error as string) ?? "Erreur" } : c,
                ));
              }
            } catch {
              // skip malformed
            }
          });
        }

        // Ensure combo is marked done if stream ended without event
        setCombos((prev) => prev.map((c, i) =>
          i === idx && c.status === "streaming" ? { ...c, status: "done" } : c,
        ));

      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") break;
        setCombos((prev) => prev.map((c, i) =>
          i === idx ? { ...c, status: "error", message: err instanceof Error ? err.message : "Erreur" } : c,
        ));
      }
    }

    setStatus("done");
  }, [hasTarget, connected, effectiveVilles, effectiveNiches, leadCount, campaignMode, selectedCampaignId, activeCampaignId, newCampaignName, selectedAccounts]);

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setCombos([]);
    setErrorMessage("");
  }, []);

  const canLaunch = hasTarget && connected;

  // ─── RESULTS VIEW ───
  if (status !== "idle") {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="rounded-xl p-6 border border-[var(--border)]" style={{ background: "var(--bg-raised)" }}>
          {/* Header */}
          <div className="text-center mb-6">
            <div className="mb-3">
              {status === "streaming" && <Loader2 size={32} className="animate-spin mx-auto" style={{ color: "var(--accent)" }} />}
              {status === "done" && <CheckCircle2 size={32} className="mx-auto" style={{ color: "var(--green)" }} />}
              {status === "error" && <XCircle size={32} className="mx-auto" style={{ color: "var(--red)" }} />}
            </div>
            <h2 className="text-lg font-semibold">
              {status === "streaming" && `${combosDone}/${combos.length} combinaisons`}
              {status === "done" && "Campagne terminee"}
              {status === "error" && "Erreur"}
            </h2>
            {errorMessage && status === "error" && (
              <p className="text-sm mt-1" style={{ color: "var(--red)" }}>{errorMessage}</p>
            )}
          </div>

          {/* Global stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <ResultStat label="Uploades" value={totalUploaded} color="var(--green)" />
            <ResultStat label="Erreurs" value={totalErrors} color={totalErrors > 0 ? "var(--red)" : undefined} />
            <ResultStat label="Combos" value={`${combosDone}/${combos.length}`} />
          </div>

          {/* Progress bar */}
          {status === "streaming" && combos.length > 0 && (
            <div className="mb-4">
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg)" }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.round((combosDone / combos.length) * 100)}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
            </div>
          )}

          {/* Combo grid */}
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {combos.map((c, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: "var(--bg)" }}>
                <span className="flex-shrink-0">
                  {c.status === "pending" && <span className="w-3 h-3 rounded-full inline-block" style={{ background: "var(--border)" }} />}
                  {c.status === "streaming" && <Loader2 size={12} className="animate-spin" style={{ color: "var(--accent)" }} />}
                  {c.status === "done" && c.uploaded > 0 && <CheckCircle2 size={12} style={{ color: "var(--green)" }} />}
                  {c.status === "done" && c.uploaded === 0 && <AlertTriangle size={12} style={{ color: "var(--amber)" }} />}
                  {c.status === "error" && <XCircle size={12} style={{ color: "var(--red)" }} />}
                </span>
                <span className="font-medium truncate" style={{ minWidth: 0 }}>
                  {c.ville} × {c.nicheLabel}
                </span>
                <span className="ml-auto flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  {c.status === "done" && c.uploaded > 0 && (
                    <span style={{ color: "var(--green)" }}>{c.uploaded} uploade{c.uploaded > 1 ? "s" : ""}</span>
                  )}
                  {c.status === "done" && c.uploaded === 0 && c.diagnostic?.reason === "leads_exist_but_no_email" && (
                    <span style={{ color: "var(--amber)" }}>{c.diagnostic.totalLeadsMatchingFilters} leads sans email</span>
                  )}
                  {c.status === "done" && c.uploaded === 0 && !c.diagnostic && (
                    <span>0 leads</span>
                  )}
                  {c.status === "done" && c.uploaded === 0 && c.diagnostic?.reason === "no_leads_match_filters" && (
                    <span>Aucun lead</span>
                  )}
                  {c.status === "error" && (
                    <span style={{ color: "var(--red)" }}>{c.message || "Erreur"}</span>
                  )}
                  {c.status === "streaming" && (
                    <span style={{ color: "var(--accent)" }}>en cours...</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Enrichment CTA if some combos have leads without email */}
          {combosWithDiagnostic.length > 0 && status === "done" && (
            <div className="mt-4 p-3 rounded-lg" style={{ background: "var(--amber-subtle)" }}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: "var(--amber)" }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--amber)" }}>
                    {combosWithDiagnostic.length} combo{combosWithDiagnostic.length > 1 ? "s" : ""} avec des leads sans email
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    Les leads existent mais n'ont pas encore d'email. Enrichissez-les d'abord.
                  </p>
                  <Link
                    href="/enrichment"
                    className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{ background: "var(--accent)", color: "white" }}
                  >
                    <Zap size={12} />
                    Enrichir les leads
                    <ChevronRight size={12} />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Reset button */}
          {(status === "done" || status === "error") && (
            <div className="mt-6 text-center">
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{ background: "var(--accent)", color: "white" }}
              >
                <RotateCcw size={14} />
                Nouvelle campagne
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── FORM VIEW ───
  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Lancer une campagne</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Selectionnez villes et niches, on s'occupe du reste.
        </p>
      </div>

      {/* Pre-launch email warning */}
      {emailsAvailable === 0 && (
        <div className="mb-5 p-3 rounded-lg flex items-start gap-2" style={{ background: "var(--amber-subtle)" }}>
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: "var(--amber)" }} />
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--amber)" }}>
              Aucun lead avec email dans la base
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Enrichissez vos leads avant de lancer une campagne.
            </p>
            <Link
              href="/enrichment"
              className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium"
              style={{ color: "var(--accent)" }}
            >
              <Zap size={11} /> Aller a l'enrichissement <ChevronRight size={11} />
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left — Steps 1-3 */}
        <div className="lg:col-span-3 space-y-5">
          {/* Step 1: Villes (multi-select) */}
          <Section icon={<MapPin size={15} />} title="Villes" step={1} badge={selectedVilles.length > 0 ? `${selectedVilles.length}` : undefined}>
            {/* Selected tags */}
            {selectedVilles.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedVilles.map((v) => (
                  <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium"
                    style={{ background: "var(--accent-subtle)", color: "var(--accent-hover)" }}
                  >
                    {v}
                    <button onClick={() => toggleVille(v)} className="hover:opacity-70"><X size={10} /></button>
                  </span>
                ))}
                <button
                  onClick={() => setSelectedVilles([])}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: "var(--text-muted)" }}
                >
                  Tout effacer
                </button>
              </div>
            )}
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
              <input
                type="text"
                value={villeSearch}
                onChange={(e) => setVilleSearch(e.target.value)}
                placeholder="Rechercher une ville..."
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {villeOptions.map((v) => (
                <Chip key={v} selected={selectedVilles.includes(v)} onClick={() => toggleVille(v)}>
                  {v}
                </Chip>
              ))}
            </div>
            {selectedVilles.length === 0 && (
              <p className="text-[10px] mt-1.5" style={{ color: "var(--text-muted)" }}>
                Aucune ville = toutes les villes
              </p>
            )}
          </Section>

          {/* Step 2: Niches (multi-select) */}
          <Section icon={<Briefcase size={15} />} title="Niches" step={2} badge={selectedNiches.length > 0 ? `${selectedNiches.length}` : undefined}>
            {/* Selected tags */}
            {selectedNiches.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedNiches.map((n) => {
                  const v = VERTICALES.find((x) => x.id === n);
                  return (
                    <span key={n} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium"
                      style={{ background: "var(--accent-subtle)", color: "var(--accent-hover)" }}
                    >
                      {v?.icon} {v?.name || n}
                      <button onClick={() => toggleNiche(n)} className="hover:opacity-70"><X size={10} /></button>
                    </span>
                  );
                })}
                <button
                  onClick={() => setSelectedNiches([])}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ color: "var(--text-muted)" }}
                >
                  Tout effacer
                </button>
              </div>
            )}
            {/* Tier groups */}
            {([1, 2, 3] as const).map((tier) => {
              const tierVerts = VERTICALES.filter((v) => v.tier === tier);
              if (tierVerts.length === 0) return null;
              return (
                <div key={tier} className="mb-2">
                  <p className="text-[10px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                    {tier === 1 ? "Tier 1 — ROI Max" : tier === 2 ? "Tier 2 — Potentiel" : "Tier 3 — Explorer"}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {tierVerts.map((v) => (
                      <Chip key={v.id} selected={selectedNiches.includes(v.id)} onClick={() => toggleNiche(v.id)}>
                        <span className="mr-1">{v.icon}</span> {v.name}
                        <span className="ml-auto text-[10px] opacity-60">T{v.tier}</span>
                      </Chip>
                    ))}
                  </div>
                </div>
              );
            })}
            {selectedNiches.length === 0 && (
              <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                Aucune niche = toutes les niches
              </p>
            )}
          </Section>

          {/* Step 3: Count */}
          <Section icon={<Hash size={15} />} title="Leads par combo" step={3}>
            <div className="flex flex-wrap gap-2">
              {[50, 100, 250, 500, 1000, 2000, 5000].map((n) => (
                <button
                  key={n}
                  onClick={() => setLeadCount(n)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: leadCount === n ? "var(--accent)" : "var(--bg)",
                    color: leadCount === n ? "white" : "var(--text-secondary)",
                    border: `1px solid ${leadCount === n ? "var(--accent)" : "var(--border)"}`,
                  }}
                >
                  {n.toLocaleString()}
                </button>
              ))}
            </div>
          </Section>
        </div>

        {/* Right — Campaign + Accounts + Launch */}
        <div className="lg:col-span-2 space-y-5">
          {/* Campaign */}
          <Section icon={<Mail size={15} />} title="Campagne" step={4}>
            <div className="flex gap-1.5 mb-3">
              <Chip selected={campaignMode === "existing"} onClick={() => setCampaignMode("existing")}>
                Existante
              </Chip>
              <Chip selected={campaignMode === "new"} onClick={() => setCampaignMode("new")}>
                + Nouvelle
              </Chip>
            </div>
            {campaignMode === "existing" ? (
              campaigns.length > 0 ? (
                <div className="space-y-1.5 max-h-28 overflow-y-auto">
                  {campaigns.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCampaignId(selectedCampaignId === c.id ? "" : c.id)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors"
                      style={{
                        background: selectedCampaignId === c.id ? "var(--accent-subtle)" : "var(--bg)",
                        border: `1px solid ${selectedCampaignId === c.id ? "rgba(99,102,241,0.3)" : "var(--border)"}`,
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: c.status === "active" ? "var(--green)" : "var(--text-muted)" }}
                      />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Campagne par defaut utilisee.
                </p>
              )
            ) : (
              <input
                type="text"
                value={newCampaignName}
                onChange={(e) => setNewCampaignName(e.target.value)}
                placeholder="Nom de la campagne..."
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
              />
            )}
          </Section>

          {/* Email accounts */}
          <Section icon={<Zap size={15} />} title="Comptes email" step={5}>
            {accountsLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>Chargement...</span>
              </div>
            ) : emailAccounts.length > 0 ? (
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {emailAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => toggleAccount(acc.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors"
                    style={{
                      background: selectedAccounts.includes(acc.id) ? "var(--accent-subtle)" : "var(--bg)",
                      border: `1px solid ${selectedAccounts.includes(acc.id) ? "rgba(99,102,241,0.3)" : "var(--border)"}`,
                    }}
                  >
                    <span className="w-3 h-3 rounded flex items-center justify-center flex-shrink-0"
                      style={{
                        background: selectedAccounts.includes(acc.id) ? "var(--accent)" : "transparent",
                        border: `1px solid ${selectedAccounts.includes(acc.id) ? "var(--accent)" : "var(--border-strong)"}`,
                      }}
                    >
                      {selectedAccounts.includes(acc.id) && (
                        <CheckCircle2 size={8} color="white" />
                      )}
                    </span>
                    <span className="truncate">{acc.email}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs py-1" style={{ color: "var(--text-muted)" }}>
                {connected ? "Aucun compte email trouve." : "Ajoutez votre cle API Instantly dans Reglages pour activer l'envoi."}
              </p>
            )}
          </Section>

          {/* Degraded API warning */}
          {campaignData?.connected && campaignData?.apiReachable === false && (
            <div className="rounded-lg p-3" style={{ background: "var(--amber-subtle)" }}>
              <p className="text-xs" style={{ color: "var(--amber)" }}>
                API Instantly temporairement indisponible. Vous pouvez preparer votre campagne.
              </p>
            </div>
          )}

          {/* Estimation */}
          <div className="rounded-xl p-4 border border-[var(--border)]" style={{ background: "var(--bg-raised)" }}>
            <p className="text-xs font-medium mb-3" style={{ color: "var(--text-muted)" }}>Estimation</p>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-lg font-semibold">{comboCount}</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Combinaisons</p>
              </div>
              <div>
                <p className="text-lg font-semibold">{emailsAvailable.toLocaleString()}</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Emails dispo</p>
              </div>
            </div>
            {comboCount > 15 && (
              <p className="text-[10px] mt-2 text-center" style={{ color: "var(--amber)" }}>
                {comboCount} combos — cela peut prendre du temps
              </p>
            )}
            {comboCount > 30 && (
              <p className="text-[10px] mt-1 text-center" style={{ color: "var(--red)" }}>
                Max 30 combinaisons recommande
              </p>
            )}
          </div>

          {/* Launch */}
          <button
            onClick={handleLaunch}
            disabled={!canLaunch || comboCount > 30}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: canLaunch ? "var(--accent)" : "var(--bg-surface)",
              color: "white",
            }}
          >
            <Rocket size={16} />
            Lancer {comboCount > 1 ? `${comboCount} combos` : "la campagne"}
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function Section({
  icon,
  title,
  step,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  step: number;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-4 border border-[var(--border)]" style={{ background: "var(--bg-raised)" }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold"
          style={{ background: "var(--accent-subtle)", color: "var(--accent-hover)" }}
        >
          {step}
        </span>
        <span style={{ color: "var(--text-muted)" }}>{icon}</span>
        <span className="text-xs font-medium">{title}</span>
        {badge && (
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style={{
        background: selected ? "var(--accent-subtle)" : "var(--bg)",
        color: selected ? "var(--accent-hover)" : "var(--text-secondary)",
        border: `1px solid ${selected ? "rgba(99,102,241,0.25)" : "var(--border)"}`,
      }}
    >
      {children}
    </button>
  );
}

function ResultStat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="text-center p-3 rounded-lg" style={{ background: "var(--bg)" }}>
      <p className="text-xl font-semibold" style={color ? { color } : undefined}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label}</p>
    </div>
  );
}
