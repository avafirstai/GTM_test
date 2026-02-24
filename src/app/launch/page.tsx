"use client";

import { useState, useEffect, useCallback } from "react";
import { VERTICALES as CANONICAL_VERTICALES, VILLES_FRANCE } from "@/lib/verticales";
import { useCampaigns } from "@/lib/useCampaigns";
import { useStats } from "@/lib/useStats";
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
} from "lucide-react";

const VERTICALES = CANONICAL_VERTICALES.map((v) => ({
  id: v.id,
  name: v.name,
  icon: v.emoji,
  score: v.totalScore,
  dealValue: `${v.avgDealValue}\u20AC/mois`,
  marketSize: v.marketSize.toLocaleString(),
  tier: v.tier,
}));

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

interface OrchestrationResult {
  success: boolean;
  campaign: { id: string; name: string | null };
  uploaded: number;
  errors: number;
  total: number;
  validLeads?: number;
  skippedInvalid?: number;
  skippedDuplicate?: number;
  skippedByInstantly?: number;
  campaignLaunched: boolean;
  launchError?: string;
  filters: { ville: string; niche: string; count: number };
  errorDetails?: string[];
  message?: string;
  error?: string;
}

interface StreamProgress {
  uploaded: number;
  errors: number;
  current: number;
  total: number;
  percent: number;
}

interface StreamStep {
  step: number;
  message: string;
}

export default function LaunchPage() {
  const [ville, setVille] = useState<string>("");
  const [customVille, setCustomVille] = useState<string>("");
  const [niche, setNiche] = useState<string>("");
  const [leadCount, setLeadCount] = useState<number>(500);

  const [campaignMode, setCampaignMode] = useState<CampaignMode>("existing");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [newCampaignName, setNewCampaignName] = useState<string>("");

  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const [status, setStatus] = useState<LaunchStatus>("idle");
  const [results, setResults] = useState<OrchestrationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [currentStep, setCurrentStep] = useState<StreamStep | null>(null);
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const [stepLog, setStepLog] = useState<string[]>([]);

  const { data: campaignData } = useCampaigns();
  const { data: statsData } = useStats();

  const connected = campaignData?.connected ?? false;
  const activeCampaignId = campaignData?.activeCampaignId ?? "";
  const campaigns = campaignData?.campaigns ?? [];
  const emailsAvailable = statsData?.stats.withEmail ?? 0;

  const selectedVerticale = VERTICALES.find((v) => v.id === niche);
  const effectiveVille = ville === "_custom" ? customVille : ville;

  const estimatedEmails = Math.min(leadCount, emailsAvailable);
  const estimatedResponses = Math.round(estimatedEmails * 0.08);
  const estimatedRDV = Math.round(estimatedResponses * 0.3);

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

  const [abortController, setAbortController] = useState<AbortController | null>(null);

  useEffect(() => {
    return () => { abortController?.abort(); };
  }, [abortController]);

  function parseSSEEvents(
    buffer: string,
    onEvent: (event: string, data: string) => void,
  ): string {
    const parts = buffer.split("\n\n");
    const remaining = parts.pop() || "";
    for (const block of parts) {
      if (!block.trim()) continue;
      let eventType = "";
      let eventData = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        else if (line.startsWith("data: ")) eventData = line.slice(6);
      }
      if (eventType && eventData) onEvent(eventType, eventData);
    }
    return remaining;
  }

  const handleLaunch = useCallback(async () => {
    if (!effectiveVille && !niche) return;
    if (!connected) {
      setErrorMessage("Service email non disponible. Verifiez la configuration.");
      setStatus("error");
      return;
    }

    abortController?.abort();
    const controller = new AbortController();
    setAbortController(controller);

    setStatus("streaming");
    setResults(null);
    setErrorMessage("");
    setCurrentStep(null);
    setProgress(null);
    setStepLog([]);

    try {
      const payload: Record<string, unknown> = {
        ville: effectiveVille,
        niche,
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
        setErrorMessage((errData as { error?: string }).error || `Erreur ${resp.status}`);
        setStatus("error");
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        setErrorMessage("Stream non disponible");
        setStatus("error");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSSEEvents(buffer, (eventType, eventData) => {
          try {
            const data = JSON.parse(eventData);
            if (eventType === "step") {
              const stepData = data as StreamStep;
              setCurrentStep(stepData);
              setStepLog((prev) => {
                const next = [...prev, stepData.message];
                return next.length > 100 ? next.slice(-100) : next;
              });
            } else if (eventType === "progress") {
              setProgress(data as StreamProgress);
            } else if (eventType === "done") {
              setResults(data as OrchestrationResult);
              setStatus("done");
            } else if (eventType === "error") {
              setErrorMessage((data as { error: string }).error);
              setStatus("error");
            }
          } catch {
            // skip malformed
          }
        });
      }

      setStatus((prev) => prev === "streaming" ? "done" : prev);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setErrorMessage(err instanceof Error ? err.message : "Erreur reseau");
      setStatus("error");
    }
  }, [effectiveVille, niche, leadCount, connected, activeCampaignId, selectedCampaignId, campaignMode, newCampaignName, selectedAccounts, abortController]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setResults(null);
    setErrorMessage("");
    setCurrentStep(null);
    setProgress(null);
    setStepLog([]);
  }, []);

  const canLaunch = (effectiveVille || niche) && connected;

  // ─── RENDER ───
  if (status !== "idle") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <ResultsView
          status={status}
          results={results}
          errorMessage={errorMessage}
          currentStep={currentStep}
          progress={progress}
          stepLog={stepLog}
          onReset={handleReset}
        />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Lancer une campagne</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Selectionnez une cible, on s'occupe du reste.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left — Steps 1-3 */}
        <div className="lg:col-span-3 space-y-5">
          {/* Step 1: Ville */}
          <Section icon={<MapPin size={15} />} title="Ville" step={1}>
            <div className="flex flex-wrap gap-1.5">
              <Chip selected={ville === ""} onClick={() => { setVille(""); setCustomVille(""); }}>
                Toutes
              </Chip>
              {VILLES_FRANCE.map((v) => (
                <Chip key={v} selected={ville === v} onClick={() => setVille(v)}>
                  {v}
                </Chip>
              ))}
              <Chip selected={ville === "_custom"} onClick={() => setVille("_custom")}>
                Autre...
              </Chip>
            </div>
            {ville === "_custom" && (
              <input
                type="text"
                value={customVille}
                onChange={(e) => setCustomVille(e.target.value)}
                placeholder="Nom de la ville..."
                className="mt-3 w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
              />
            )}
          </Section>

          {/* Step 2: Niche */}
          <Section icon={<Briefcase size={15} />} title="Niche" step={2}>
            <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
              <Chip selected={niche === ""} onClick={() => setNiche("")}>
                Toutes
              </Chip>
              {VERTICALES.map((v) => (
                <Chip key={v.id} selected={niche === v.id} onClick={() => setNiche(v.id)}>
                  <span className="mr-1">{v.icon}</span> {v.name}
                  <span className="ml-auto text-[10px] opacity-60">T{v.tier}</span>
                </Chip>
              ))}
            </div>
          </Section>

          {/* Step 3: Count */}
          <Section icon={<Hash size={15} />} title="Nombre de leads" step={3}>
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
            {leadCount > emailsAvailable && emailsAvailable > 0 && (
              <p className="text-xs mt-2" style={{ color: "var(--amber)" }}>
                {emailsAvailable.toLocaleString()} emails disponibles
              </p>
            )}
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
                {connected ? "Aucun compte email trouve." : "En attente de connexion..."}
              </p>
            )}
          </Section>

          {/* Estimation */}
          <div className="rounded-xl p-4 border border-[var(--border)]" style={{ background: "var(--bg-raised)" }}>
            <p className="text-xs font-medium mb-3" style={{ color: "var(--text-muted)" }}>Estimation</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-lg font-semibold">{estimatedEmails.toLocaleString()}</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Leads</p>
              </div>
              <div>
                <p className="text-lg font-semibold" style={{ color: "var(--green)" }}>~{estimatedResponses}</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Reponses</p>
              </div>
              <div>
                <p className="text-lg font-semibold" style={{ color: "var(--amber)" }}>~{estimatedRDV}</p>
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>RDV</p>
              </div>
            </div>
          </div>

          {/* Launch */}
          <button
            onClick={handleLaunch}
            disabled={!canLaunch}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: canLaunch ? "var(--accent)" : "var(--bg-surface)",
              color: "white",
            }}
          >
            <Rocket size={16} />
            Lancer la campagne
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
  children,
}: {
  icon: React.ReactNode;
  title: string;
  step: number;
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

function ResultsView({
  status,
  results,
  errorMessage,
  currentStep,
  progress,
  stepLog,
  onReset,
}: {
  status: LaunchStatus;
  results: OrchestrationResult | null;
  errorMessage: string;
  currentStep: StreamStep | null;
  progress: StreamProgress | null;
  stepLog: string[];
  onReset: () => void;
}) {
  return (
    <div className="rounded-xl p-6 border border-[var(--border)]" style={{ background: "var(--bg-raised)" }}>
      {/* Status icon */}
      <div className="text-center mb-6">
        <div className="mb-3">
          {status === "streaming" && <Loader2 size={32} className="animate-spin mx-auto" style={{ color: "var(--accent)" }} />}
          {status === "done" && <CheckCircle2 size={32} className="mx-auto" style={{ color: "var(--green)" }} />}
          {status === "error" && <XCircle size={32} className="mx-auto" style={{ color: "var(--red)" }} />}
        </div>
        <h2 className="text-lg font-semibold">
          {status === "streaming" && (currentStep ? `Etape ${currentStep.step}/5` : "Demarrage...")}
          {status === "done" && "Campagne prete"}
          {status === "error" && "Erreur"}
        </h2>
        {status === "streaming" && currentStep && (
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{currentStep.message}</p>
        )}
      </div>

      {/* Progress bar */}
      {status === "streaming" && progress && (
        <div className="mb-6">
          <div className="flex justify-between text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>
            <span>{progress.current}/{progress.total}</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg)" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress.percent}%`, background: "var(--accent)" }}
            />
          </div>
        </div>
      )}

      {/* Step log */}
      {status === "streaming" && stepLog.length > 0 && (
        <div className="p-3 rounded-lg max-h-28 overflow-y-auto mb-4" style={{ background: "var(--bg)" }}>
          {stepLog.map((msg, i) => (
            <p key={i} className="text-[11px] font-mono py-0.5"
              style={{ color: i === stepLog.length - 1 ? "var(--text-primary)" : "var(--text-muted)" }}
            >
              {i === stepLog.length - 1 ? "\u25B6" : "\u2713"} {msg}
            </p>
          ))}
        </div>
      )}

      {/* Error */}
      {status === "error" && errorMessage && (
        <div className="mb-4 p-3 rounded-lg" style={{ background: "var(--red-subtle)" }}>
          <p className="text-sm" style={{ color: "var(--red)" }}>{errorMessage}</p>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <ResultStat label="Total" value={results.total} />
            <ResultStat label="Uploades" value={results.uploaded} color="var(--green)" />
            <ResultStat label="Erreurs" value={results.errors} color={results.errors > 0 ? "var(--red)" : undefined} />
          </div>

          {results.campaignLaunched && (
            <div className="p-3 rounded-lg text-center" style={{ background: "var(--green-subtle)" }}>
              <p className="text-sm font-medium" style={{ color: "var(--green)" }}>Campagne activee — emails en cours d'envoi</p>
            </div>
          )}

          {results.launchError && (
            <div className="p-3 rounded-lg" style={{ background: "var(--amber-subtle)" }}>
              <p className="text-xs" style={{ color: "var(--amber)" }}>{results.launchError}</p>
            </div>
          )}
        </div>
      )}

      {/* Reset */}
      {(status === "done" || status === "error") && (
        <div className="mt-6 text-center">
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <RotateCcw size={14} />
            {status === "done" ? "Nouvelle campagne" : "Reessayer"}
          </button>
        </div>
      )}
    </div>
  );
}

function ResultStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center p-3 rounded-lg" style={{ background: "var(--bg)" }}>
      <p className="text-xl font-semibold" style={color ? { color } : undefined}>{value.toLocaleString()}</p>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label}</p>
    </div>
  );
}
