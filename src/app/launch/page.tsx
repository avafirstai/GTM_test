"use client";

import { useState, useEffect, useCallback } from "react";
import { VERTICALES as CANONICAL_VERTICALES, VILLES_FRANCE } from "@/lib/verticales";
import { useCampaigns } from "@/lib/useCampaigns";
import { useStats } from "@/lib/useStats";

// Map canonical verticales to display format
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
  // ─── Filters ───
  const [ville, setVille] = useState<string>("");
  const [customVille, setCustomVille] = useState<string>("");
  const [niche, setNiche] = useState<string>("");
  const [leadCount, setLeadCount] = useState<number>(500);

  // ─── Campaign ───
  const [campaignMode, setCampaignMode] = useState<CampaignMode>("existing");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [newCampaignName, setNewCampaignName] = useState<string>("");

  // ─── Email accounts ───
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // ─── Status ───
  const [status, setStatus] = useState<LaunchStatus>("idle");
  const [results, setResults] = useState<OrchestrationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // ─── Live progress (SSE) ───
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

  // Estimation calculations
  const estimatedEmails = Math.min(leadCount, emailsAvailable);
  const estimatedResponses = Math.round(estimatedEmails * 0.08);
  const estimatedRDV = Math.round(estimatedResponses * 0.3);
  const estimatedRevenue = selectedVerticale
    ? Math.round(estimatedRDV * parseInt(selectedVerticale.dealValue))
    : 0;

  // ─── Load Instantly email accounts ───
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
        // Silent — accounts panel will show empty
      } finally {
        setAccountsLoading(false);
      }
    }
    loadAccounts();
  }, []);

  // ─── Toggle email account selection ───
  const toggleAccount = useCallback((accountId: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(accountId)
        ? prev.filter((id) => id !== accountId)
        : [...prev, accountId],
    );
  }, []);

  // ─── LAUNCH (SSE stream) ───
  const handleLaunch = useCallback(async () => {
    if (!effectiveVille && !niche) return;
    if (!connected) {
      setErrorMessage("Instantly non connect\u00E9. Configurez INSTANTLY_API_KEY.");
      setStatus("error");
      return;
    }

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

      // Fix 2: Use selected campaign ID from the list
      if (campaignMode === "existing") {
        payload.campaignId = selectedCampaignId || activeCampaignId;
      } else if (campaignMode === "new" && newCampaignName.trim()) {
        payload.campaignName = newCampaignName.trim();
      }

      if (selectedAccounts.length > 0) {
        payload.emailAccounts = selectedAccounts;
      }

      // Fix 3: Use SSE streaming endpoint
      const resp = await fetch("/api/orchestrate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        setErrorMessage((errData as { error?: string }).error || `HTTP ${resp.status}`);
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

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "step") {
                const stepData = data as StreamStep;
                setCurrentStep(stepData);
                setStepLog((prev) => [...prev, stepData.message]);
              } else if (currentEvent === "progress") {
                setProgress(data as StreamProgress);
              } else if (currentEvent === "done") {
                setResults(data as OrchestrationResult);
                setStatus("done");
              } else if (currentEvent === "error") {
                setErrorMessage((data as { error: string }).error);
                setStatus("error");
              }
            } catch {
              // Malformed JSON — skip
            }
            currentEvent = "";
          }
        }
      }

      // Stream ended — if no done/error event was received, mark done
      setStatus((prev) => prev === "streaming" ? "done" : prev);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Network error");
      setStatus("error");
    }
  }, [effectiveVille, niche, leadCount, connected, activeCampaignId, selectedCampaignId, campaignMode, newCampaignName, selectedAccounts]);

  const handleReset = useCallback(() => {
    setStatus("idle");
    setResults(null);
    setErrorMessage("");
    setCurrentStep(null);
    setProgress(null);
    setStepLog([]);
  }, []);

  // ─── RENDER ───
  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">{"\uD83D\uDE80"} GTM Orchestrator</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Ville + Niche + Nombre {"\u2192"} Campagne compl\u00E8te en 1 clic
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: connected ? "#22c55e" : "#ef4444" }}
          />
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Instantly: {connected ? "connect\u00E9" : "non connect\u00E9"} {"\u2022"}{" "}
            {emailsAvailable.toLocaleString()} emails en base {"\u2022"}{" "}
            {campaigns.length} campagne{campaigns.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {status !== "idle" ? (
        /* ==================== RESULTS / LIVE PROGRESS ==================== */
        <div
          className="rounded-xl p-8"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">
              {status === "done"
                ? (results?.campaignLaunched ? "\u2705" : "\u2705")
                : status === "error" ? "\u274C" : "\u26A1"}
            </div>
            <h2 className="text-xl font-bold mb-1">
              {status === "streaming" && (currentStep ? `\u00C9tape ${currentStep.step}/5` : "D\u00E9marrage...")}
              {status === "done" && (results?.campaignLaunched ? "Campagne lanc\u00E9e !" : "Campagne orchestr\u00E9e !")}
              {status === "error" && "Erreur"}
            </h2>
            {status === "streaming" && currentStep && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {currentStep.message}
              </p>
            )}
            {results && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {results.filters.ville && `${results.filters.ville} \u2022 `}
                {results.filters.niche && `${VERTICALES.find((v) => v.id === results.filters.niche)?.name || results.filters.niche}`}
              </p>
            )}
          </div>

          {/* Live streaming progress */}
          {status === "streaming" && (
            <div className="mb-8">
              {/* Progress bar */}
              {progress && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1" style={{ color: "var(--muted)" }}>
                    <span>{progress.current}/{progress.total} leads</span>
                    <span>{progress.percent}%</span>
                  </div>
                  <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: "var(--background)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${progress.percent}%`,
                        background: "linear-gradient(90deg, #6366f1, #818cf8)",
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--muted)" }}>
                    <span style={{ color: "#22c55e" }}>{progress.uploaded} OK</span>
                    {progress.errors > 0 && (
                      <span style={{ color: "#ef4444" }}>{progress.errors} erreurs</span>
                    )}
                  </div>
                </div>
              )}

              {/* Step log */}
              <div
                className="p-3 rounded-lg max-h-32 overflow-y-auto"
                style={{ background: "var(--background)" }}
              >
                {stepLog.map((msg, i) => (
                  <p key={i} className="text-[11px] font-mono py-0.5" style={{ color: i === stepLog.length - 1 ? "var(--foreground)" : "var(--muted)" }}>
                    {i === stepLog.length - 1 ? "\u25B6" : "\u2713"} {msg}
                  </p>
                ))}
              </div>
            </div>
          )}

          {status === "error" && errorMessage && (
            <div
              className="mb-6 p-4 rounded-lg"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <p className="text-sm" style={{ color: "#ef4444" }}>
                <strong>Erreur:</strong> {errorMessage}
              </p>
            </div>
          )}

          {results && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <ResultBox label="Leads trouv\u00E9s" value={results.total.toLocaleString()} color="#6366f1" />
                <ResultBox label="Upload\u00E9s" value={results.uploaded.toLocaleString()} color="#22c55e" />
                <ResultBox label="Erreurs" value={results.errors.toLocaleString()} color={results.errors > 0 ? "#ef4444" : "#22c55e"} />
                <ResultBox label="Campagne" value={results.campaign.name || results.campaign.id.slice(0, 8) + "..."} color="#818cf8" />
                <ResultBox
                  label="Emails"
                  value={results.campaignLaunched ? "Envoi actif" : "Non lanc\u00E9"}
                  color={results.campaignLaunched ? "#22c55e" : "#f59e0b"}
                />
              </div>

              {results.launchError && (
                <div className="mb-4 p-3 rounded-lg" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <p className="text-xs" style={{ color: "#f59e0b" }}>
                    Activation: {results.launchError}
                  </p>
                </div>
              )}

              {results.message && (
                <div className="mb-6 p-4 rounded-lg" style={{ background: "var(--background)" }}>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{results.message}</p>
                </div>
              )}

              {results.errorDetails && results.errorDetails.length > 0 && (
                <div className="mb-6 p-4 rounded-lg" style={{ background: "var(--background)" }}>
                  <p className="text-xs font-medium mb-2" style={{ color: "var(--muted)" }}>D\u00E9tails erreurs:</p>
                  {results.errorDetails.map((err, i) => (
                    <p key={i} className="text-[10px] font-mono" style={{ color: "#ef4444" }}>{err}</p>
                  ))}
                </div>
              )}
            </>
          )}

          {(status === "done" || status === "error") && (
            <div className="text-center">
              <button
                onClick={handleReset}
                className="px-6 py-3 rounded-lg text-sm font-medium transition-all hover:scale-105"
                style={{ background: "var(--accent)", color: "white" }}
              >
                {status === "done" ? "Lancer une autre campagne" : "R\u00E9essayer"}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ==================== CONFIGURATION ==================== */
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* ─── LEFT: Filters ─── */}
            <div className="space-y-6">
              {/* Step 1: Ville */}
              <div
                className="rounded-xl p-5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <h2 className="text-base font-semibold mb-3">
                  1{"\uFE0F\u20E3"} Ville
                </h2>
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                  <button
                    onClick={() => { setVille(""); setCustomVille(""); }}
                    className="px-3 py-1.5 rounded-lg text-xs transition-all"
                    style={{
                      background: ville === "" ? "rgba(99,102,241,0.15)" : "var(--background)",
                      border: `1px solid ${ville === "" ? "var(--accent)" : "var(--border)"}`,
                      fontWeight: ville === "" ? 600 : 400,
                    }}
                  >
                    Toutes
                  </button>
                  {VILLES_FRANCE.map((v) => (
                    <button
                      key={v}
                      onClick={() => setVille(v)}
                      className="px-3 py-1.5 rounded-lg text-xs transition-all"
                      style={{
                        background: ville === v ? "rgba(99,102,241,0.15)" : "var(--background)",
                        border: `1px solid ${ville === v ? "var(--accent)" : "var(--border)"}`,
                        fontWeight: ville === v ? 600 : 400,
                      }}
                    >
                      {v}
                    </button>
                  ))}
                  <button
                    onClick={() => setVille("_custom")}
                    className="px-3 py-1.5 rounded-lg text-xs transition-all"
                    style={{
                      background: ville === "_custom" ? "rgba(99,102,241,0.15)" : "var(--background)",
                      border: `1px solid ${ville === "_custom" ? "var(--accent)" : "var(--border)"}`,
                    }}
                  >
                    Autre...
                  </button>
                </div>
                {ville === "_custom" && (
                  <input
                    type="text"
                    value={customVille}
                    onChange={(e) => setCustomVille(e.target.value)}
                    placeholder="Nom de la ville..."
                    className="mt-3 w-full px-3 py-2 rounded-lg text-sm"
                    style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                  />
                )}
              </div>

              {/* Step 2: Niche */}
              <div
                className="rounded-xl p-5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <h2 className="text-base font-semibold mb-3">
                  2{"\uFE0F\u20E3"} Niche / Verticale
                </h2>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => setNiche("")}
                    className="p-3 rounded-lg text-left transition-all"
                    style={{
                      background: niche === "" ? "rgba(99,102,241,0.15)" : "var(--background)",
                      border: `1px solid ${niche === "" ? "var(--accent)" : "var(--border)"}`,
                    }}
                  >
                    <p className="text-xs font-medium">Toutes les niches</p>
                  </button>
                  {VERTICALES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setNiche(v.id)}
                      className="p-3 rounded-lg text-left transition-all"
                      style={{
                        background: niche === v.id ? "rgba(99,102,241,0.15)" : "var(--background)",
                        border: `1px solid ${niche === v.id ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-base">{v.icon}</span>
                        <span
                          className="text-[10px] font-bold px-1 py-0.5 rounded"
                          style={{
                            background: v.score >= 82 ? "rgba(34,197,94,0.15)" : v.score >= 70 ? "rgba(245,158,11,0.15)" : "rgba(156,163,175,0.15)",
                            color: v.score >= 82 ? "#22c55e" : v.score >= 70 ? "#f59e0b" : "#9ca3af",
                          }}
                        >
                          {v.score}
                        </span>
                      </div>
                      <p className="text-xs font-medium">{v.name}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                        {v.dealValue} {"\u2022"} T{v.tier}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 3: Count */}
              <div
                className="rounded-xl p-5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <h2 className="text-base font-semibold mb-3">
                  3{"\uFE0F\u20E3"} Nombre de leads
                </h2>
                <div className="flex flex-wrap gap-2">
                  {[50, 100, 250, 500, 1000, 2000, 5000].map((n) => (
                    <button
                      key={n}
                      onClick={() => setLeadCount(n)}
                      className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                      style={{
                        background: leadCount === n ? "var(--accent)" : "var(--background)",
                        color: leadCount === n ? "white" : "var(--foreground)",
                        border: `1px solid ${leadCount === n ? "var(--accent)" : "var(--border)"}`,
                      }}
                    >
                      {n.toLocaleString()}
                    </button>
                  ))}
                </div>
                {leadCount > emailsAvailable && emailsAvailable > 0 && (
                  <p className="text-xs mt-2" style={{ color: "#f59e0b" }}>
                    {"\u26A0\uFE0F"} Seulement {emailsAvailable.toLocaleString()} emails disponibles
                  </p>
                )}
              </div>
            </div>

            {/* ─── RIGHT: Campaign + Accounts + Estimation ─── */}
            <div className="space-y-6">
              {/* Campaign selection */}
              <div
                className="rounded-xl p-5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <h2 className="text-base font-semibold mb-3">
                  4{"\uFE0F\u20E3"} Campagne Instantly
                </h2>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setCampaignMode("existing")}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: campaignMode === "existing" ? "var(--accent)" : "var(--background)",
                      color: campaignMode === "existing" ? "white" : "var(--foreground)",
                      border: `1px solid ${campaignMode === "existing" ? "var(--accent)" : "var(--border)"}`,
                    }}
                  >
                    Existante
                  </button>
                  <button
                    onClick={() => setCampaignMode("new")}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: campaignMode === "new" ? "var(--accent)" : "var(--background)",
                      color: campaignMode === "new" ? "white" : "var(--foreground)",
                      border: `1px solid ${campaignMode === "new" ? "var(--accent)" : "var(--border)"}`,
                    }}
                  >
                    + Nouvelle
                  </button>
                </div>

                {campaignMode === "existing" ? (
                  <div>
                    {campaigns.length > 0 ? (
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {campaigns.map((c) => {
                          const isSelected = selectedCampaignId === c.id;
                          return (
                            <button
                              key={c.id}
                              onClick={() => setSelectedCampaignId(isSelected ? "" : c.id)}
                              className="w-full flex items-center justify-between p-2 rounded-lg text-xs text-left transition-all"
                              style={{
                                background: isSelected ? "rgba(99,102,241,0.12)" : "var(--background)",
                                border: `1px solid ${isSelected ? "var(--accent)" : "transparent"}`,
                              }}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                  style={{
                                    background: isSelected ? "var(--accent)" : "transparent",
                                    border: `1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                                    color: "white",
                                  }}
                                >
                                  {isSelected ? "\u2713" : ""}
                                </span>
                                <div>
                                  <span className="font-medium">{c.name}</span>
                                  <span className="ml-2" style={{ color: "var(--muted)" }}>
                                    {c.status}
                                  </span>
                                </div>
                              </div>
                              <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                                {c.id.slice(0, 8)}...
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        Campagne par d\u00E9faut: {activeCampaignId ? `${activeCampaignId.slice(0, 12)}...` : "non configur\u00E9e"}
                      </p>
                    )}
                    {selectedCampaignId && (
                      <p className="text-xs mt-2" style={{ color: "#22c55e" }}>
                        Campagne s\u00E9lectionn\u00E9e: {campaigns.find((c) => c.id === selectedCampaignId)?.name || selectedCampaignId.slice(0, 12)}
                      </p>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                    placeholder="Nom de la campagne (ex: Dentistes Paris Q1)"
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ background: "var(--background)", border: "1px solid var(--border)" }}
                  />
                )}
              </div>

              {/* Email accounts */}
              <div
                className="rounded-xl p-5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <h2 className="text-base font-semibold mb-3">
                  5{"\uFE0F\u20E3"} Comptes email Instantly
                </h2>
                {accountsLoading ? (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Chargement...</p>
                ) : emailAccounts.length > 0 ? (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {emailAccounts.map((acc) => (
                      <button
                        key={acc.id}
                        onClick={() => toggleAccount(acc.id)}
                        className="w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all"
                        style={{
                          background: selectedAccounts.includes(acc.id)
                            ? "rgba(99,102,241,0.12)"
                            : "var(--background)",
                          border: `1px solid ${selectedAccounts.includes(acc.id) ? "var(--accent)" : "var(--border)"}`,
                        }}
                      >
                        <span
                          className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold"
                          style={{
                            background: selectedAccounts.includes(acc.id) ? "var(--accent)" : "transparent",
                            border: `1px solid ${selectedAccounts.includes(acc.id) ? "var(--accent)" : "var(--border)"}`,
                            color: "white",
                          }}
                        >
                          {selectedAccounts.includes(acc.id) ? "\u2713" : ""}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{acc.email}</p>
                          <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                            {acc.status === "active" ? "\uD83D\uDFE2" : "\uD83D\uDD34"} {acc.status}
                            {acc.dailyLimit > 0 && ` \u2022 ${acc.dailyLimit}/jour`}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    Aucun compte email trouv\u00E9 dans Instantly.
                    {!connected && " Connectez d'abord votre API key."}
                  </p>
                )}
                {selectedAccounts.length > 0 && (
                  <p className="text-xs mt-2" style={{ color: "#22c55e" }}>
                    {selectedAccounts.length} compte{selectedAccounts.length > 1 ? "s" : ""} s\u00E9lectionn\u00E9{selectedAccounts.length > 1 ? "s" : ""}
                  </p>
                )}
              </div>

              {/* Estimation Panel */}
              <div
                className="rounded-xl p-5"
                style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(129,140,248,0.05))",
                  border: "1px solid rgba(99,102,241,0.2)",
                }}
              >
                <h3 className="text-base font-semibold mb-3">{"\uD83D\uDCCA"} Estimation</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xl font-bold" style={{ color: "#6366f1" }}>
                      {Math.min(leadCount, emailsAvailable).toLocaleString()}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--muted)" }}>Leads \u00E0 uploader</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold" style={{ color: "#22c55e" }}>
                      ~{estimatedResponses}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--muted)" }}>R\u00E9ponses (8%)</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold" style={{ color: "#f59e0b" }}>
                      ~{estimatedRDV}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--muted)" }}>RDV (30%)</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold" style={{ color: "#06b6d4" }}>
                      ~{estimatedRevenue.toLocaleString()}{"\u20AC"}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--muted)" }}>Revenue/mois</p>
                  </div>
                </div>

                {/* Summary */}
                <div className="mt-4 p-3 rounded-lg" style={{ background: "rgba(0,0,0,0.05)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {effectiveVille ? `${effectiveVille}` : "Toutes villes"}
                    {" \u2192 "}
                    {selectedVerticale ? selectedVerticale.name : "Toutes niches"}
                    {" \u2192 "}
                    {leadCount.toLocaleString()} leads max
                    {" \u2192 "}
                    {campaignMode === "new" ? `Nouvelle: "${newCampaignName || "..."}"` : "Campagne existante"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Launch Button */}
          <div className="text-center mt-8">
            <button
              onClick={handleLaunch}
              disabled={(!effectiveVille && !niche) || !connected}
              className="px-10 py-4 rounded-xl text-lg font-bold transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: (effectiveVille || niche) && connected
                  ? "linear-gradient(135deg, #6366f1, #818cf8)"
                  : "var(--border)",
                color: "white",
                boxShadow: (effectiveVille || niche) && connected
                  ? "0 4px 20px rgba(99,102,241,0.3)"
                  : "none",
              }}
            >
              {"\uD83D\uDE80"} Lancer l'orchestration
            </button>
            <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
              {connected
                ? "Supabase \u2192 Filtre \u2192 Upload Instantly \u2192 Activation \u2192 Emails en route"
                : "Configurez INSTANTLY_API_KEY dans .env.local"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function ResultBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center p-4 rounded-lg" style={{ background: "var(--background)" }}>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{label}</p>
    </div>
  );
}
