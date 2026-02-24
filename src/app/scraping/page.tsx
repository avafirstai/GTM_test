"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { parseSSEEvents } from "@/lib/parseSSE";
import { useCustomData } from "@/lib/useCustomData";
import type { MergedVerticale } from "@/lib/useCustomData";
import {
  MapPin,
  Tag,
  CheckCircle,
  Clock,
  XCircle,
  Loader2,
  ArrowRight,
  Zap,
  Globe,
  Plus,
  Pause,
  Square,
  RefreshCw,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Status = "idle" | "running" | "paused" | "stopped" | "done" | "error";

interface ComboStatus {
  verticale: string;
  verticaleId: string;
  ville: string;
  status: "pending" | "running" | "done" | "error";
  newLeads: number;
  duplicates: number;
  totalFound: number;
  error?: string;
}

interface ScrapingJob {
  id: string;
  status: string;
  verticale_ids: string[];
  villes: string[];
  total_combos: number;
  processed_combos: number;
  total_new_leads: number;
  total_duplicates: number;
  summary: Record<string, unknown> | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ScrapingPage() {
  // Custom data hook (merges defaults + user-added)
  const {
    allVerticales,
    allVilles,
    customVilleSet,
    addVerticale,
    addVille,
  } = useCustomData();

  // Selection state
  const [selectedVerts, setSelectedVerts] = useState<Set<string>>(new Set());
  const [selectedVilles, setSelectedVilles] = useState<Set<string>>(new Set());

  // Add-new forms
  const [showAddVert, setShowAddVert] = useState(false);
  const [newVertName, setNewVertName] = useState("");
  const [newVertEmoji, setNewVertEmoji] = useState("🏢");
  const [newVertCategories, setNewVertCategories] = useState("");
  const [addingVert, setAddingVert] = useState(false);

  const [showAddVille, setShowAddVille] = useState(false);
  const [newVilleName, setNewVilleName] = useState("");
  const [addingVille, setAddingVille] = useState(false);

  // Scraping state
  const [status, setStatus] = useState<Status>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ processed: 0, total: 0, percent: 0 });
  const [combos, setCombos] = useState<ComboStatus[]>([]);
  const [totalNewLeads, setTotalNewLeads] = useState(0);
  const [totalDuplicates, setTotalDuplicates] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<ScrapingJob[]>([]);

  // Timer
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback(() => {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Signal state (disable button while sending)
  const [signalSending, setSignalSending] = useState(false);

  async function sendSignal(signal: "pause" | "stop") {
    if (!jobId || signalSending) return;
    setSignalSending(true);
    try {
      await fetch(`/api/jobs/${jobId}/signal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "gtm_scraping_jobs", signal }),
      });
    } catch {
      // Signal best-effort — backend checks DB on next iteration
    } finally {
      setSignalSending(false);
    }
  }

  // Fetch history on mount
  useEffect(() => {
    fetch("/api/scrape/jobs?limit=10")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.jobs) setHistory(d.jobs);
      })
      .catch(() => {});
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Selection helpers                                                */
  /* ---------------------------------------------------------------- */

  function toggleVert(id: string) {
    setSelectedVerts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVertsByTier(tier: 1 | 2 | 3 | null) {
    if (tier === null) {
      setSelectedVerts(new Set());
    } else {
      setSelectedVerts(new Set(allVerticales.filter((v) => v.tier <= tier).map((v) => v.id)));
    }
  }

  function selectAllVerts() {
    setSelectedVerts(new Set(allVerticales.map((v) => v.id)));
  }

  function toggleVille(v: string) {
    setSelectedVilles((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function selectTopVilles(n: number) {
    setSelectedVilles(new Set(allVilles.slice(0, n)));
  }

  function selectAllVilles() {
    setSelectedVilles(new Set(allVilles));
  }

  async function handleAddVerticale() {
    if (!newVertName.trim() || !newVertCategories.trim()) return;
    setAddingVert(true);
    const cats = newVertCategories.split(",").map((c) => c.trim()).filter(Boolean);
    const result = await addVerticale({
      name: newVertName.trim(),
      emoji: newVertEmoji || "🏢",
      googleMapsCategories: cats,
    });
    if (result.success) {
      setNewVertName("");
      setNewVertEmoji("🏢");
      setNewVertCategories("");
      setShowAddVert(false);
    }
    setAddingVert(false);
  }

  async function handleAddVille() {
    if (!newVilleName.trim()) return;
    setAddingVille(true);
    const result = await addVille(newVilleName.trim());
    if (result.success) {
      setNewVilleName("");
      setShowAddVille(false);
    }
    setAddingVille(false);
  }

  /* ---------------------------------------------------------------- */
  /*  Estimation                                                       */
  /* ---------------------------------------------------------------- */

  const selectedVertList = allVerticales.filter((v) => selectedVerts.has(v.id));
  const totalCategories = selectedVertList.reduce(
    (sum, v) => sum + v.googleMapsCategories.length,
    0,
  );
  const totalCombos = selectedVerts.size * selectedVilles.size;
  const estimatedRequests = totalCategories * selectedVilles.size;
  const estimatedLeads = totalCombos * 18; // ~18 unique leads per combo avg
  const estimatedCost = estimatedRequests * 0.032;
  const estimatedTimeMin = Math.ceil((estimatedRequests * 0.15 + totalCombos * 0.3) / 60);

  /* ---------------------------------------------------------------- */
  /*  Run scraping                                                     */
  /* ---------------------------------------------------------------- */

  async function runScraping() {
    if (selectedVerts.size === 0 || selectedVilles.size === 0) return;

    setStatus("running");
    setJobId(null);
    setErrorMsg(null);
    setTotalNewLeads(0);
    setTotalDuplicates(0);
    setCombos([]);
    setProgress({ processed: 0, total: totalCombos, percent: 0 });
    startTimer();

    try {
      const res = await fetch("/api/scrape/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verticaleIds: Array.from(selectedVerts),
          villes: Array.from(selectedVilles),
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Unknown error");
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        sseBuffer = parseSSEEvents(sseBuffer, (eventType, rawData) => {
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(rawData);
          } catch {
            return;
          }

          if (eventType === "job_created") {
            const jid = typeof data.jobId === "string" ? data.jobId : null;
            setJobId(jid);
          } else if (eventType === "combo_start") {
            setCombos((prev) => [
              ...prev,
              {
                verticale: String(data.verticale ?? ""),
                verticaleId: String(data.verticaleId ?? ""),
                ville: String(data.ville ?? ""),
                status: "running",
                newLeads: 0,
                duplicates: 0,
                totalFound: 0,
              },
            ]);
          } else if (eventType === "combo_done") {
            setCombos((prev) =>
              prev.map((c) =>
                c.verticaleId === data.verticaleId && c.ville === data.ville
                  ? {
                      ...c,
                      status: "done" as const,
                      newLeads: typeof data.newLeads === "number" ? data.newLeads : 0,
                      duplicates: typeof data.duplicates === "number" ? data.duplicates : 0,
                      totalFound: typeof data.totalFound === "number" ? data.totalFound : 0,
                    }
                  : c,
              ),
            );
          } else if (eventType === "combo_error") {
            setCombos((prev) =>
              prev.map((c) =>
                c.verticaleId === data.verticaleId && c.ville === data.ville
                  ? { ...c, status: "error" as const, error: String(data.error ?? "") }
                  : c,
              ),
            );
          } else if (eventType === "progress") {
            setProgress({
              processed: typeof data.processed === "number" ? data.processed : 0,
              total: typeof data.total === "number" ? data.total : 0,
              percent: typeof data.percent === "number" ? data.percent : 0,
            });
            if (typeof data.totalNewLeads === "number") setTotalNewLeads(data.totalNewLeads);
            if (typeof data.totalDuplicates === "number") setTotalDuplicates(data.totalDuplicates);
          } else if (eventType === "paused") {
            stopTimer();
            setStatus("paused");
            if (typeof data.totalNewLeads === "number") setTotalNewLeads(data.totalNewLeads);
            if (typeof data.totalDuplicates === "number") setTotalDuplicates(data.totalDuplicates);
            if (typeof data.processedCombos === "number" && typeof data.totalCombos === "number") {
              setProgress((prev) => ({
                ...prev,
                processed: data.processedCombos as number,
                total: data.totalCombos as number,
                percent: Math.round(((data.processedCombos as number) / (data.totalCombos as number)) * 100),
              }));
            }
          } else if (eventType === "stopped") {
            stopTimer();
            setStatus("stopped");
            if (typeof data.totalNewLeads === "number") setTotalNewLeads(data.totalNewLeads);
            if (typeof data.totalDuplicates === "number") setTotalDuplicates(data.totalDuplicates);
            if (typeof data.processedCombos === "number" && typeof data.totalCombos === "number") {
              setProgress((prev) => ({
                ...prev,
                processed: data.processedCombos as number,
                total: data.totalCombos as number,
                percent: Math.round(((data.processedCombos as number) / (data.totalCombos as number)) * 100),
              }));
            }
          } else if (eventType === "done") {
            stopTimer();
            setStatus("done");
            if (typeof data.totalNewLeads === "number") setTotalNewLeads(data.totalNewLeads);
            if (typeof data.totalDuplicates === "number") setTotalDuplicates(data.totalDuplicates);
            setProgress((prev) => ({ ...prev, percent: 100 }));
          } else if (eventType === "error") {
            stopTimer();
            setStatus("error");
            setErrorMsg(typeof data.message === "string" ? data.message : "Erreur inconnue");
          }
        });
      }

      // If stream ended without done/error, mark done
      if (status === "running") {
        stopTimer();
        setStatus("done");
      }
    } catch (err) {
      stopTimer();
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Erreur de connexion");
    }

    // Refresh history
    fetch("/api/scrape/jobs?limit=10")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.jobs) setHistory(d.jobs);
      })
      .catch(() => {});
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  /** Build /leads URL with verticale + ville query params for filtering */
  function buildLeadsUrl(vertIds: string[], villes: string[]): string {
    const params = new URLSearchParams();
    // Map verticaleIds → verticale names for the leads filter
    for (const vId of vertIds) {
      const vert = allVerticales.find((v) => v.id === vId);
      if (vert) params.append("verticale", vert.name);
    }
    for (const ville of villes) {
      params.append("ville", ville);
    }
    const qs = params.toString();
    return qs ? `/leads?${qs}` : "/leads";
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "var(--accent-subtle)" }}
          >
            <Globe size={20} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Scraping</h1>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Google Places API &middot; {allVerticales.length} verticales &middot;{" "}
              {allVilles.length} villes
            </p>
          </div>
        </div>
      </div>

      {status === "idle" && (
        <>
          {/* Selection Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Verticales */}
            <div
              className="rounded-xl border border-[var(--border)]"
              style={{ background: "var(--bg-raised)" }}
            >
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag size={16} style={{ color: "var(--text-muted)" }} />
                  <h2 className="text-sm font-medium">
                    Verticales ({selectedVerts.size}/{allVerticales.length})
                  </h2>
                </div>
                <div className="flex gap-1.5">
                  <QuickBtn label="Tout" onClick={selectAllVerts} />
                  <QuickBtn label="T1" onClick={() => selectVertsByTier(1)} />
                  <QuickBtn label="T1+T2" onClick={() => selectVertsByTier(2)} />
                  <QuickBtn label="Aucun" onClick={() => selectVertsByTier(null)} />
                </div>
              </div>
              <div className="p-4 grid grid-cols-1 gap-1.5 max-h-[420px] overflow-y-auto">
                {allVerticales.map((v) => (
                  <VertChip
                    key={v.id}
                    vert={v}
                    selected={selectedVerts.has(v.id)}
                    onClick={() => toggleVert(v.id)}
                    isCustom={v.isCustom}
                  />
                ))}

                {/* Add custom verticale */}
                {!showAddVert ? (
                  <button
                    onClick={() => setShowAddVert(true)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all cursor-pointer border border-dashed"
                    style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                  >
                    <Plus size={14} />
                    <span className="text-xs">Ajouter une verticale</span>
                  </button>
                ) : (
                  <div className="rounded-lg border border-[var(--accent)] p-3 space-y-2" style={{ background: "var(--bg)" }}>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newVertEmoji}
                        onChange={(e) => setNewVertEmoji(e.target.value)}
                        className="w-10 text-center px-1 py-1.5 rounded text-sm outline-none"
                        style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}
                        maxLength={2}
                      />
                      <input
                        type="text"
                        value={newVertName}
                        onChange={(e) => setNewVertName(e.target.value)}
                        placeholder="Nom (ex: Pharmacies)"
                        className="flex-1 px-2 py-1.5 rounded text-xs outline-none"
                        style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}
                      />
                    </div>
                    <input
                      type="text"
                      value={newVertCategories}
                      onChange={(e) => setNewVertCategories(e.target.value)}
                      placeholder="Categories Google Maps (separees par virgule)"
                      className="w-full px-2 py-1.5 rounded text-xs outline-none"
                      style={{ background: "var(--bg-raised)", border: "1px solid var(--border)" }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddVerticale}
                        disabled={addingVert || !newVertName.trim() || !newVertCategories.trim()}
                        className="flex-1 px-2 py-1.5 rounded text-xs font-medium text-white disabled:opacity-40"
                        style={{ background: "var(--accent)" }}
                      >
                        {addingVert ? "..." : "Ajouter"}
                      </button>
                      <button
                        onClick={() => setShowAddVert(false)}
                        className="px-2 py-1.5 rounded text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Villes */}
            <div
              className="rounded-xl border border-[var(--border)]"
              style={{ background: "var(--bg-raised)" }}
            >
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin size={16} style={{ color: "var(--text-muted)" }} />
                  <h2 className="text-sm font-medium">
                    Villes ({selectedVilles.size}/{allVilles.length})
                  </h2>
                </div>
                <div className="flex gap-1.5">
                  <QuickBtn label="Tout" onClick={selectAllVilles} />
                  <QuickBtn label="Top 10" onClick={() => selectTopVilles(10)} />
                  <QuickBtn label="Top 5" onClick={() => selectTopVilles(5)} />
                  <QuickBtn label="Aucun" onClick={() => setSelectedVilles(new Set())} />
                </div>
              </div>
              <div className="p-4 flex flex-wrap gap-2 max-h-[420px] overflow-y-auto">
                {allVilles.map((v) => (
                  <button
                    key={v}
                    onClick={() => toggleVille(v)}
                    className="text-xs px-3 py-1.5 rounded-full transition-all cursor-pointer border"
                    style={{
                      background: selectedVilles.has(v) ? "var(--accent-subtle)" : "var(--bg)",
                      color: selectedVilles.has(v) ? "var(--accent)" : "var(--text-secondary)",
                      borderColor: selectedVilles.has(v) ? "var(--accent)" : "var(--border)",
                    }}
                  >
                    {v}
                    {customVilleSet.has(v) && (
                      <span className="ml-1 opacity-50">*</span>
                    )}
                  </button>
                ))}

                {/* Add custom ville */}
                {!showAddVille ? (
                  <button
                    onClick={() => setShowAddVille(true)}
                    className="text-xs px-3 py-1.5 rounded-full transition-all cursor-pointer border border-dashed flex items-center gap-1"
                    style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                  >
                    <Plus size={10} /> Ajouter
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newVilleName}
                      onChange={(e) => setNewVilleName(e.target.value)}
                      placeholder="Ville..."
                      className="px-2 py-1 rounded-full text-xs outline-none w-28"
                      style={{ background: "var(--bg-raised)", border: "1px solid var(--accent)" }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddVille(); }}
                      autoFocus
                    />
                    <button
                      onClick={handleAddVille}
                      disabled={addingVille || !newVilleName.trim()}
                      className="text-xs px-2 py-1 rounded-full font-medium text-white disabled:opacity-40"
                      style={{ background: "var(--accent)" }}
                    >
                      {addingVille ? "..." : "OK"}
                    </button>
                    <button
                      onClick={() => { setShowAddVille(false); setNewVilleName(""); }}
                      className="text-xs px-1 py-1"
                      style={{ color: "var(--text-muted)" }}
                    >
                      &times;
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Estimation + Launch */}
          {selectedVerts.size > 0 && selectedVilles.size > 0 && (
            <div
              className="rounded-xl border border-[var(--border)] mb-6"
              style={{ background: "var(--bg-raised)" }}
            >
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
                <Zap size={16} style={{ color: "var(--accent)" }} />
                <h2 className="text-sm font-medium">Estimation</h2>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
                  <EstCard label="Verticales" value={String(selectedVerts.size)} />
                  <EstCard label="Villes" value={String(selectedVilles.size)} />
                  <EstCard label="Combos" value={String(totalCombos)} />
                  <EstCard
                    label="Leads estimes"
                    value={`~${estimatedLeads.toLocaleString()}`}
                    accent
                  />
                  <EstCard
                    label="Duree"
                    value={`~${estimatedTimeMin} min`}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {estimatedRequests} requetes API &middot; cout estime:{" "}
                    <span style={{ color: estimatedCost < 6.25 ? "var(--green)" : "var(--amber)" }}>
                      ${estimatedCost.toFixed(2)}
                    </span>
                    {estimatedCost < 6.25 && (
                      <span style={{ color: "var(--green)" }}> (couvert par credits gratuits)</span>
                    )}
                  </p>
                  <button
                    onClick={runScraping}
                    className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 cursor-pointer"
                    style={{ background: "var(--accent)" }}
                  >
                    Lancer le scraping
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Running / Done / Error */}
      {status !== "idle" && (
        <div className="space-y-6">
          {/* Progress Header */}
          <div
            className="rounded-xl border border-[var(--border)]"
            style={{ background: "var(--bg-raised)" }}
          >
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                {status === "running" && (
                  <Loader2
                    size={18}
                    className="animate-spin"
                    style={{ color: "var(--accent)" }}
                  />
                )}
                {status === "paused" && <Pause size={18} style={{ color: "var(--amber)" }} />}
                {status === "stopped" && <Square size={18} style={{ color: "var(--red)" }} />}
                {status === "done" && <CheckCircle size={18} style={{ color: "var(--green)" }} />}
                {status === "error" && <XCircle size={18} style={{ color: "var(--red)" }} />}
                <div>
                  <h2 className="text-sm font-semibold">
                    {status === "running" && "Scraping en cours..."}
                    {status === "paused" && "Scraping en pause"}
                    {status === "stopped" && "Scraping arrete"}
                    {status === "done" && "Scraping termine !"}
                    {status === "error" && "Erreur"}
                  </h2>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {fmtTime(elapsed)} &middot; {progress.processed}/{progress.total} combos
                  </p>
                </div>
              </div>

              {/* Pause / Stop buttons */}
              {status === "running" && (
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
              )}
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-lg font-bold" style={{ color: "var(--green)" }}>
                    {totalNewLeads.toLocaleString()}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    nouveaux leads
                  </p>
                </div>
                {totalDuplicates > 0 && (
                  <div className="text-right">
                    <p className="text-lg font-bold" style={{ color: "var(--text-muted)" }}>
                      {totalDuplicates.toLocaleString()}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      doublons
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="px-5 py-4">
              <div className="w-full h-2.5 rounded-full" style={{ background: "var(--bg)" }}>
                <div
                  className="h-2.5 rounded-full transition-all duration-500"
                  style={{
                    width: `${progress.percent}%`,
                    background:
                      status === "error" || status === "stopped"
                        ? "var(--red)"
                        : status === "done"
                          ? "var(--green)"
                          : status === "paused"
                            ? "var(--amber)"
                            : "var(--accent)",
                  }}
                />
              </div>
              {errorMsg && (
                <p className="text-xs mt-2" style={{ color: "var(--red)" }}>
                  {errorMsg}
                </p>
              )}
            </div>
          </div>

          {/* Combos list */}
          {combos.length > 0 && (
            <div
              className="rounded-xl border border-[var(--border)]"
              style={{ background: "var(--bg-raised)" }}
            >
              <div className="px-5 py-4 border-b border-[var(--border)]">
                <h2 className="text-sm font-medium">
                  Combos ({combos.filter((c) => c.status === "done").length}/{combos.length})
                </h2>
              </div>
              <div className="divide-y divide-[var(--border)] max-h-[400px] overflow-y-auto">
                {combos.map((c, i) => (
                  <ComboRow key={`${c.verticaleId}-${c.ville}-${i}`} combo={c} />
                ))}
              </div>
            </div>
          )}

          {/* CTAs */}
          {status === "done" && (
            <div className="flex gap-3">
              <a
                href={buildLeadsUrl(Array.from(selectedVerts), Array.from(selectedVilles))}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                Voir les leads <ArrowRight size={16} />
              </a>
              <a
                href="/enrichment"
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 border"
                style={{
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                  background: "var(--accent-subtle)",
                }}
              >
                Enrichir les leads <ArrowRight size={16} />
              </a>
              <button
                onClick={() => {
                  setStatus("idle");
                  setCombos([]);
                  setProgress({ processed: 0, total: 0, percent: 0 });
                  setTotalNewLeads(0);
                  setTotalDuplicates(0);
                  setErrorMsg(null);
                }}
                className="px-5 py-3 rounded-xl text-sm font-medium transition-all hover:opacity-90 border cursor-pointer"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                Nouveau scrape
              </button>
            </div>
          )}

          {/* Paused CTAs */}
          {status === "paused" && (
            <div
              className="rounded-xl px-5 py-4 flex items-center justify-between"
              style={{ background: "var(--amber-subtle)", border: "1px solid rgba(245,158,11,0.3)" }}
            >
              <div className="flex items-center gap-3">
                <Pause size={16} style={{ color: "var(--amber)" }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--amber)" }}>
                    Scraping en pause
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {totalNewLeads} leads sauvegardes. Les doublons seront automatiquement ignores a la reprise.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={runScraping}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 cursor-pointer"
                  style={{ background: "var(--accent)" }}
                >
                  <RefreshCw size={14} /> Reprendre
                </button>
                <a
                  href={buildLeadsUrl(Array.from(selectedVerts), Array.from(selectedVilles))}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                >
                  Voir les leads <ArrowRight size={14} />
                </a>
              </div>
            </div>
          )}

          {/* Stopped CTAs */}
          {status === "stopped" && (
            <div className="flex gap-3">
              <a
                href={buildLeadsUrl(Array.from(selectedVerts), Array.from(selectedVilles))}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                Voir les {totalNewLeads} leads <ArrowRight size={16} />
              </a>
              <button
                onClick={() => {
                  setStatus("idle");
                  setCombos([]);
                  setProgress({ processed: 0, total: 0, percent: 0 });
                  setTotalNewLeads(0);
                  setTotalDuplicates(0);
                  setErrorMsg(null);
                }}
                className="px-5 py-3 rounded-xl text-sm font-medium transition-all hover:opacity-90 border cursor-pointer"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                Nouveau scrape
              </button>
            </div>
          )}

          {status === "error" && (
            <button
              onClick={() => {
                setStatus("idle");
                setCombos([]);
                setErrorMsg(null);
              }}
              className="px-5 py-3 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90 cursor-pointer"
              style={{ background: "var(--red)" }}
            >
              Reessayer
            </button>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div
          className="rounded-xl border border-[var(--border)] mt-8"
          style={{ background: "var(--bg-raised)" }}
        >
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
            <Clock size={16} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-medium">Historique ({history.length})</h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {history.map((job) => (
              <HistoryRow key={job.id} job={job} verticales={allVerticales} />
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="text-center text-xs mt-10" style={{ color: "var(--text-muted)" }}>
        AVA GTM &middot; Scraping pipeline &middot; Google Places API
      </p>
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] px-2 py-1 rounded-md transition-all hover:opacity-80 cursor-pointer"
      style={{ background: "var(--bg)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
    >
      {label}
    </button>
  );
}

function VertChip({
  vert,
  selected,
  onClick,
  isCustom,
}: {
  vert: MergedVerticale;
  selected: boolean;
  onClick: () => void;
  isCustom?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all cursor-pointer border"
      style={{
        background: selected ? "var(--accent-subtle)" : "var(--bg)",
        borderColor: selected ? "var(--accent)" : "var(--border)",
      }}
    >
      <span className="text-base">{vert.emoji}</span>
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium truncate"
          style={{ color: selected ? "var(--accent)" : "var(--text-primary)" }}
        >
          {vert.name}
        </p>
        <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
          {vert.googleMapsCategories.length} categories
          {isCustom ? " · Custom" : ` · Tier ${vert.tier}`}
        </p>
      </div>
      <span
        className="text-[10px] px-2 py-0.5 rounded-full font-medium"
        style={{
          background: isCustom
            ? "var(--accent-subtle)"
            : vert.tier === 1
              ? "var(--green-subtle)"
              : vert.tier === 2
                ? "var(--amber-subtle)"
                : "var(--bg-surface)",
          color: isCustom
            ? "var(--accent)"
            : vert.tier === 1
              ? "var(--green)"
              : vert.tier === 2
                ? "var(--amber)"
                : "var(--text-muted)",
        }}
      >
        {isCustom ? "Custom" : `T${vert.tier}`}
      </span>
    </button>
  );
}

function EstCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg p-3 border border-[var(--border)]" style={{ background: "var(--bg)" }}>
      <p className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className="text-lg font-semibold mt-0.5"
        style={accent ? { color: "var(--accent)" } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function ComboRow({ combo }: { combo: ComboStatus }) {
  const StatusIcon =
    combo.status === "done"
      ? CheckCircle
      : combo.status === "running"
        ? Loader2
        : combo.status === "error"
          ? XCircle
          : Clock;
  const statusColor =
    combo.status === "done"
      ? "var(--green)"
      : combo.status === "running"
        ? "var(--accent)"
        : combo.status === "error"
          ? "var(--red)"
          : "var(--text-muted)";

  return (
    <div className="px-5 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <StatusIcon
          size={14}
          style={{ color: statusColor }}
          className={combo.status === "running" ? "animate-spin" : ""}
        />
        <p className="text-sm">
          <span className="font-medium">{combo.verticale}</span>
          <span style={{ color: "var(--text-muted)" }}> &times; </span>
          <span>{combo.ville}</span>
        </p>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {combo.status === "done" && (
          <>
            <span style={{ color: "var(--green)" }} className="font-semibold">
              +{combo.newLeads}
            </span>
            {combo.duplicates > 0 && (
              <span style={{ color: "var(--text-muted)" }}>{combo.duplicates} dups</span>
            )}
          </>
        )}
        {combo.status === "error" && (
          <span style={{ color: "var(--red)" }}>{combo.error ?? "Erreur"}</span>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ job, verticales }: { job: ScrapingJob; verticales: MergedVerticale[] }) {
  const date = new Date(job.created_at);
  const fmtDate = date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const StatusIcon =
    job.status === "completed"
      ? CheckCircle
      : job.status === "running"
        ? Clock
        : XCircle;
  const statusColor =
    job.status === "completed"
      ? "var(--green)"
      : job.status === "running"
        ? "var(--amber)"
        : "var(--red)";

  // Build filtered leads URL from job verticale_ids + villes
  const leadsUrl = (() => {
    const params = new URLSearchParams();
    for (const vId of job.verticale_ids ?? []) {
      const vert = verticales.find((v) => v.id === vId);
      if (vert) params.append("verticale", vert.name);
    }
    for (const ville of job.villes ?? []) {
      params.append("ville", ville);
    }
    const qs = params.toString();
    return qs ? `/leads?${qs}` : "/leads";
  })();

  return (
    <div className="px-5 py-3 flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{fmtDate}</p>
        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {(job.verticale_ids ?? []).length} verticales &middot;{" "}
          {(job.villes ?? []).length} villes &middot;{" "}
          {job.total_combos ?? 0} combos
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-semibold" style={{ color: "var(--green)" }}>
            {(job.total_new_leads ?? 0).toLocaleString()}
          </p>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            leads
          </p>
        </div>
        {job.status === "completed" && (job.total_new_leads ?? 0) > 0 && (
          <a
            href={leadsUrl}
            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80"
            style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
          >
            Voir <ArrowRight size={12} />
          </a>
        )}
        <div className="flex items-center gap-1.5">
          <StatusIcon size={14} style={{ color: statusColor }} />
          <span className="text-[11px] font-medium" style={{ color: statusColor }}>
            {job.status}
          </span>
        </div>
      </div>
    </div>
  );
}
