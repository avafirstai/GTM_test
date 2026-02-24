"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ChevronDown, X, Loader2, UserSearch, Linkedin, Mail as MailIcon, Shield, MapPin } from "lucide-react";
import type { Lead, DecisionMaker, SortField, SortDirection, LeadFilters } from "@/lib/leads-data";

interface LeadsTableProps {
  leads: Lead[];
  initialFilters?: Partial<LeadFilters>;
  campaignId?: string;
}

const PIPELINE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  nouveau: { bg: "rgba(99,102,241,0.15)", text: "#818cf8", label: "Nouveau" },
  contacte: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b", label: "Contact\u00e9" },
  repondu: { bg: "rgba(34,197,94,0.15)", text: "#22c55e", label: "R\u00e9pondu" },
  rdv_booke: { bg: "rgba(6,182,212,0.15)", text: "#06b6d4", label: "RDV Book\u00e9" },
  deal_won: { bg: "rgba(16,185,129,0.15)", text: "#10b981", label: "Deal Won" },
  perdu: { bg: "rgba(239,68,68,0.15)", text: "#ef4444", label: "Perdu" },
};

/* ========== MultiSelectFilter ========== */
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((s) => s !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap"
        style={{
          background: selected.length > 0 ? "var(--accent-subtle)" : "var(--bg)",
          border: selected.length > 0 ? "1px solid rgba(99,102,241,0.3)" : "1px solid var(--border)",
          color: selected.length > 0 ? "var(--accent-hover)" : "var(--text-primary)",
        }}
      >
        {label}
        {selected.length > 0 && (
          <span
            className="text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full"
            style={{ background: "var(--accent)", color: "white" }}
          >
            {selected.length}
          </span>
        )}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 min-w-52 max-h-64 overflow-y-auto rounded-lg py-1 shadow-lg"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-strong)",
          }}
        >
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs"
              style={{ color: "var(--red)" }}
            >
              Tout effacer
            </button>
          )}
          {options.map((opt) => {
            const isSelected = selected.includes(opt);
            return (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm hover:bg-[var(--bg-hover)] transition-colors"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(opt)}
                  className="rounded accent-[var(--accent)]"
                />
                <span style={{ color: isSelected ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {opt || "(vide)"}
                </span>
              </label>
            );
          })}
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Aucune option
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ========== ScoreBadge ========== */
function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 90 ? "#22c55e" : score >= 80 ? "#f59e0b" : score >= 60 ? "#818cf8" : "#737373";
  const bg =
    score >= 90
      ? "rgba(34,197,94,0.15)"
      : score >= 80
        ? "rgba(245,158,11,0.15)"
        : score >= 60
          ? "rgba(99,102,241,0.15)"
          : "rgba(115,115,115,0.15)";
  return (
    <span
      className="text-xs font-bold px-2 py-1 rounded-full"
      style={{ background: bg, color }}
    >
      {score}
    </span>
  );
}

/* ========== PipelineBadge ========== */
function PipelineBadge({ status }: { status: string }) {
  const config = PIPELINE_COLORS[status] || PIPELINE_COLORS.nouveau;
  return (
    <span
      className="text-[11px] font-medium px-2 py-1 rounded-full whitespace-nowrap"
      style={{ background: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  );
}

/* ========== LeadsTable ========== */
export function LeadsTable({ leads, initialFilters, campaignId }: LeadsTableProps) {
  const [filters, setFilters] = useState<LeadFilters>({
    search: "",
    ville: [],
    verticale: [],
    pipeline: "",
    scoreMin: 0,
    scoreMax: 100,
    hasEmail: "all",
    source: "",
    ...initialFilters,
  });
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [expandedLead, setExpandedLead] = useState<string | null>(null);
  const [enrichingLeads, setEnrichingLeads] = useState<Set<string>>(new Set());
  const [enrichResults, setEnrichResults] = useState<Record<string, { email?: string; error?: string }>>({});
  const [bulkAction, setBulkAction] = useState<"idle" | "exporting" | "sending" | "enriching">("idle");
  const [bulkMessage, setBulkMessage] = useState<string>("");
  const [bulkMessageType, setBulkMessageType] = useState<"success" | "error">("success");
  const [sendingLeadId, setSendingLeadId] = useState<string | null>(null);
  const [decisionMakers, setDecisionMakers] = useState<Record<string, DecisionMaker[]>>({});
  const [dmLoading, setDmLoading] = useState<Set<string>>(new Set());
  const [dmErrors, setDmErrors] = useState<Record<string, string>>({});

  // --- Action handlers ---

  const handleEnrichLead = useCallback(async (lead: Lead) => {
    if (!lead.site_web || lead.email) return;
    setEnrichingLeads((prev) => new Set([...prev, lead.id]));
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: [lead.id], technique: "website_scraping", limit: 1 }),
      });
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        setEnrichResults((prev) => ({
          ...prev,
          [lead.id]: result.email ? { email: result.email } : { error: result.error || "Aucun email trouve" },
        }));
      }
    } catch {
      setEnrichResults((prev) => ({ ...prev, [lead.id]: { error: "Erreur reseau" } }));
    } finally {
      setEnrichingLeads((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  }, []);

  const handleFindDecisionMakers = useCallback(async (lead: Lead) => {
    if (!lead.site_web) return;
    setDmLoading((prev) => new Set([...prev, lead.id]));
    setDmErrors((prev) => { const n = { ...prev }; delete n[lead.id]; return n; });
    try {
      const res = await fetch("/api/enrich/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: lead.site_web, leadId: lead.id, limit: 5 }),
      });
      const data = await res.json();
      if (data.success && data.people && data.people.length > 0) {
        setDecisionMakers((prev) => ({ ...prev, [lead.id]: data.people }));
      } else if (data.success && (!data.people || data.people.length === 0)) {
        setDmErrors((prev) => ({ ...prev, [lead.id]: "Aucun decideur trouve pour ce domaine" }));
      } else {
        setDmErrors((prev) => ({ ...prev, [lead.id]: data.error || "Erreur Apollo" }));
      }
    } catch {
      setDmErrors((prev) => ({ ...prev, [lead.id]: "Erreur reseau" }));
    } finally {
      setDmLoading((prev) => { const n = new Set(prev); n.delete(lead.id); return n; });
    }
  }, []);

  const handleSendSingleToInstantly = useCallback(async (lead: Lead) => {
    if (!lead.email) return;
    if (!campaignId) {
      setBulkMessage("Aucune campagne active — configurez une campagne d'abord");
      setBulkMessageType("error");
      setTimeout(() => setBulkMessage(""), 4000);
      return;
    }
    setSendingLeadId(lead.id);
    try {
      const res = await fetch("/api/leads/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          leads: [{
            email: lead.email,
            name: lead.nom_entreprise,
            phone: lead.telephone,
            website: lead.site_web,
            city: lead.ville,
            category: lead.verticale,
          }],
        }),
      });
      const data = await res.json();
      if (data.success && data.uploaded > 0) {
        setBulkMessage(`${lead.nom_entreprise} ajoute a Instantly`);
        setBulkMessageType("success");
      } else {
        setBulkMessage(data.error || "Erreur lors de l'envoi");
        setBulkMessageType("error");
      }
    } catch {
      setBulkMessage("Erreur reseau");
      setBulkMessageType("error");
    } finally {
      setSendingLeadId(null);
      setTimeout(() => setBulkMessage(""), 3000);
    }
  }, [campaignId]);

  // Derive unique filter options
  const villes = useMemo(() => [...new Set(leads.map((l) => l.ville).filter(Boolean))].sort(), [leads]);
  const verticales = useMemo(() => [...new Set(leads.map((l) => l.verticale).filter(Boolean))].sort(), [leads]);

  // Filter + sort
  const filteredLeads = useMemo(() => {
    let result = leads;

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (l) =>
          l.nom_entreprise.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q) ||
          l.ville.toLowerCase().includes(q) ||
          l.type_etablissement.toLowerCase().includes(q)
      );
    }
    if (filters.ville.length > 0) result = result.filter((l) => filters.ville.includes(l.ville));
    if (filters.verticale.length > 0) result = result.filter((l) => filters.verticale.includes(l.verticale));
    if (filters.pipeline) result = result.filter((l) => l.statut_pipeline === filters.pipeline);
    if (filters.hasEmail === "yes") result = result.filter((l) => l.email);
    if (filters.hasEmail === "no") result = result.filter((l) => !l.email);
    if (filters.scoreMin > 0) result = result.filter((l) => l.score >= filters.scoreMin);
    if (filters.scoreMax < 100) result = result.filter((l) => l.score <= filters.scoreMax);

    result = [...result].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal);
      const bStr = String(bVal);
      return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });

    return result;
  }, [leads, filters, sortField, sortDir]);

  const handleExportCSV = useCallback(() => {
    const leadsToExport = filteredLeads.filter((l) => selectedLeads.has(l.id));
    if (leadsToExport.length === 0) return;
    setBulkAction("exporting");

    const headers = ["Entreprise", "Ville", "Verticale", "Email", "Telephone", "Site Web", "Score", "Note Google", "Avis Google", "Adresse"];
    const rows = leadsToExport.map((l) => [
      l.nom_entreprise, l.ville, l.verticale, l.email, l.telephone,
      l.site_web, String(l.score), String(l.note_google), String(l.nb_avis_google), l.adresse,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${(cell || "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    setBulkMessage(`${leadsToExport.length} leads exportes en CSV`);
    setBulkMessageType("success");
    setBulkAction("idle");
    setTimeout(() => setBulkMessage(""), 3000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeads, filteredLeads]);

  const handleSendToInstantly = useCallback(async () => {
    if (!campaignId) {
      setBulkMessage("Aucune campagne active — configurez une campagne d'abord");
      setBulkMessageType("error");
      setTimeout(() => setBulkMessage(""), 4000);
      return;
    }
    const leadsToSend = filteredLeads.filter((l) => selectedLeads.has(l.id) && l.email);
    if (leadsToSend.length === 0) {
      setBulkMessage("Aucun lead avec email dans la selection");
      setBulkMessageType("error");
      setTimeout(() => setBulkMessage(""), 3000);
      return;
    }
    setBulkAction("sending");
    try {
      const res = await fetch("/api/leads/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          leads: leadsToSend.map((l) => ({
            email: l.email,
            name: l.nom_entreprise,
            phone: l.telephone,
            website: l.site_web,
            city: l.ville,
            category: l.verticale,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBulkMessage(`${data.uploaded} lead${data.uploaded !== 1 ? "s" : ""} envoye${data.uploaded !== 1 ? "s" : ""} a Instantly`);
        setBulkMessageType("success");
      } else {
        setBulkMessage(data.error || "Erreur lors de l'envoi");
        setBulkMessageType("error");
      }
    } catch {
      setBulkMessage("Erreur reseau");
      setBulkMessageType("error");
    } finally {
      setBulkAction("idle");
      setTimeout(() => setBulkMessage(""), 4000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeads, filteredLeads, campaignId]);

  const handleBulkEnrich = useCallback(async () => {
    const leadsToEnrich = filteredLeads.filter((l) => selectedLeads.has(l.id) && !l.email && l.site_web);
    if (leadsToEnrich.length === 0) {
      setBulkMessage("Aucun lead sans email avec site web dans la selection");
      setBulkMessageType("error");
      setTimeout(() => setBulkMessage(""), 3000);
      return;
    }
    setBulkAction("enriching");
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds: leadsToEnrich.map((l) => l.id),
          technique: "website_scraping",
          limit: leadsToEnrich.length,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBulkMessage(`${data.found} emails trouves sur ${data.processed} leads`);
        setBulkMessageType("success");
        for (const r of data.results || []) {
          if (r.email) {
            setEnrichResults((prev) => ({ ...prev, [r.leadId]: { email: r.email } }));
          }
        }
      } else {
        setBulkMessage("Erreur enrichissement");
        setBulkMessageType("error");
      }
    } catch {
      setBulkMessage("Erreur reseau");
      setBulkMessageType("error");
    } finally {
      setBulkAction("idle");
      setTimeout(() => setBulkMessage(""), 5000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeads, filteredLeads]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const toggleSelectAll = () => {
    if (selectedLeads.size === filteredLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filteredLeads.map((l) => l.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedLeads);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedLeads(next);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="opacity-30">&#x25B2;</span>;
    return <span>{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>;
  };

  // Active filter tags
  const hasActiveFilters = filters.ville.length > 0 || filters.verticale.length > 0;

  return (
    <div>
      {/* Filters Row */}
      <div className="flex flex-wrap gap-3 mb-3">
        <input
          type="text"
          placeholder="Rechercher entreprise, email, ville..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="flex-1 min-w-60 px-3 py-2 rounded-lg text-sm"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <MultiSelectFilter
          label="Villes"
          options={villes}
          selected={filters.ville}
          onChange={(next) => setFilters({ ...filters, ville: next })}
        />
        <MultiSelectFilter
          label="Verticales"
          options={verticales}
          selected={filters.verticale}
          onChange={(next) => setFilters({ ...filters, verticale: next })}
        />
        <select
          value={filters.pipeline}
          onChange={(e) => setFilters({ ...filters, pipeline: e.target.value })}
          className="px-3 py-2 rounded-lg text-sm"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">Tout le pipeline</option>
          <option value="nouveau">Nouveau</option>
          <option value="contacte">Contact\u00e9</option>
          <option value="repondu">R\u00e9pondu</option>
          <option value="rdv_booke">RDV Book\u00e9</option>
          <option value="deal_won">Deal Won</option>
          <option value="perdu">Perdu</option>
        </select>
        <select
          value={filters.hasEmail}
          onChange={(e) =>
            setFilters({ ...filters, hasEmail: e.target.value as "all" | "yes" | "no" })
          }
          className="px-3 py-2 rounded-lg text-sm"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <option value="all">Email: Tous</option>
          <option value="yes">Avec email</option>
          <option value="no">Sans email</option>
        </select>
      </div>

      {/* Active filter tags */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {filters.ville.map((v) => (
            <span
              key={`v-${v}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full"
              style={{ background: "var(--accent-subtle)", color: "var(--accent-hover)" }}
            >
              {v}
              <button
                type="button"
                onClick={() => setFilters({ ...filters, ville: filters.ville.filter((x) => x !== v) })}
                className="hover:opacity-70"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {filters.verticale.map((v) => (
            <span
              key={`c-${v}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full"
              style={{ background: "var(--green-subtle)", color: "var(--green)" }}
            >
              {v}
              <button
                type="button"
                onClick={() => setFilters({ ...filters, verticale: filters.verticale.filter((x) => x !== v) })}
                className="hover:opacity-70"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setFilters({ ...filters, ville: [], verticale: [] })}
            className="text-xs px-2 py-1"
            style={{ color: "var(--text-muted)" }}
          >
            Tout effacer
          </button>
        </div>
      )}

      {/* Selection bar */}
      {selectedLeads.size > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2 rounded-lg mb-3"
          style={{ background: "var(--accent-subtle)", border: "1px solid rgba(99,102,241,0.3)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--accent-hover)" }}>
            {selectedLeads.size} s\u00e9lectionn\u00e9{selectedLeads.size > 1 ? "s" : ""}
          </span>
          <button
            className="text-xs px-3 py-1 rounded-md font-medium transition-opacity disabled:opacity-50"
            style={{ background: "var(--accent)", color: "white" }}
            onClick={handleExportCSV}
            disabled={bulkAction !== "idle"}
          >
            {bulkAction === "exporting" ? "Export..." : "Exporter CSV"}
          </button>
          <button
            className="text-xs px-3 py-1 rounded-md font-medium transition-opacity disabled:opacity-50"
            style={{ background: "var(--green-subtle)", color: "var(--green)" }}
            onClick={handleSendToInstantly}
            disabled={bulkAction !== "idle"}
          >
            {bulkAction === "sending" ? "Envoi..." : "Envoyer \u00e0 Instantly"}
          </button>
          <button
            className="text-xs px-3 py-1 rounded-md font-medium transition-opacity disabled:opacity-50"
            style={{ background: "var(--amber-subtle)", color: "var(--amber)" }}
            onClick={handleBulkEnrich}
            disabled={bulkAction !== "idle"}
          >
            {bulkAction === "enriching" ? "Enrichissement..." : "Enrichir s\u00e9lection"}
          </button>
        </div>
      )}
      {/* Bulk action feedback */}
      {bulkMessage && (
        <div
          className="px-4 py-2 rounded-lg mb-3 text-sm font-medium"
          style={{
            background: bulkMessageType === "error" ? "rgba(239,68,68,0.1)" : "var(--green-subtle)",
            color: bulkMessageType === "error" ? "var(--red)" : "var(--green)",
            border: bulkMessageType === "error" ? "1px solid rgba(239,68,68,0.2)" : "1px solid rgba(34,197,94,0.2)",
          }}
        >
          {bulkMessage}
        </div>
      )}

      {/* Results count */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {filteredLeads.length} leads sur {leads.length}
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--bg-raised)", borderBottom: "1px solid var(--border)" }}>
              <th className="px-3 py-3 text-left w-8">
                <input
                  type="checkbox"
                  checked={selectedLeads.size === filteredLeads.length && filteredLeads.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <th
                className="px-3 py-3 text-left cursor-pointer select-none"
                onClick={() => toggleSort("nom_entreprise")}
                style={{ color: "var(--text-muted)" }}
              >
                Entreprise <SortIcon field="nom_entreprise" />
              </th>
              <th
                className="px-3 py-3 text-left cursor-pointer select-none"
                onClick={() => toggleSort("ville")}
                style={{ color: "var(--text-muted)" }}
              >
                Ville <SortIcon field="ville" />
              </th>
              <th className="px-3 py-3 text-left" style={{ color: "var(--text-muted)" }}>
                Verticale
              </th>
              <th
                className="px-3 py-3 text-center cursor-pointer select-none"
                onClick={() => toggleSort("score")}
                style={{ color: "var(--text-muted)" }}
              >
                Score <SortIcon field="score" />
              </th>
              <th
                className="px-3 py-3 text-center cursor-pointer select-none"
                onClick={() => toggleSort("note_google")}
                style={{ color: "var(--text-muted)" }}
              >
                Google <SortIcon field="note_google" />
              </th>
              <th className="px-3 py-3 text-left" style={{ color: "var(--text-muted)" }}>
                Email
              </th>
              <th className="px-3 py-3 text-center" style={{ color: "var(--text-muted)" }}>
                Pipeline
              </th>
              <th className="px-3 py-3 text-center" style={{ color: "var(--text-muted)" }}>
                Enrichi
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.map((lead) => (
              <>
                <tr
                  key={lead.id}
                  className="cursor-pointer transition-colors"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: selectedLeads.has(lead.id)
                      ? "rgba(99,102,241,0.06)"
                      : expandedLead === lead.id
                        ? "var(--bg-raised)"
                        : "transparent",
                  }}
                  onClick={() => setExpandedLead(expandedLead === lead.id ? null : lead.id)}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedLeads.has(lead.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleSelect(lead.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div>
                      <p className="font-medium text-sm">{lead.nom_entreprise}</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {lead.type_etablissement}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-sm">{lead.ville}</td>
                  <td className="px-3 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: "var(--accent-subtle)", color: "var(--accent-hover)" }}
                    >
                      {lead.verticale}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <ScoreBadge score={lead.score} />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="text-sm">
                      {lead.note_google > 0 ? `${lead.note_google} \u2605` : "-"}
                    </span>
                    <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>
                      ({lead.nb_avis_google})
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {lead.email ? (
                      <span className="text-xs" style={{ color: "var(--green)" }}>
                        {lead.email.length > 25
                          ? lead.email.substring(0, 22) + "..."
                          : lead.email}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--red)" }}>
                        Manquant
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <PipelineBadge status={lead.statut_pipeline} />
                  </td>
                  <td className="px-3 py-3 text-center">
                    {lead.enrichment_status === "enriched" ? (
                      <span style={{ color: "var(--green)" }}>&#10003;</span>
                    ) : lead.enrichment_status === "failed" ? (
                      <span style={{ color: "#ef4444" }} title="Enrichissement echoue">&#10007;</span>
                    ) : lead.enrichment_status === "skipped" ? (
                      <span style={{ color: "#f59e0b" }} title="Timeout / skip">&#x23F1;</span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>&mdash;</span>
                    )}
                  </td>
                </tr>
                {/* Expanded details */}
                {expandedLead === lead.id && (
                  <tr key={`${lead.id}-expanded`}>
                    <td
                      colSpan={9}
                      className="px-6 py-4"
                      style={{ background: "var(--bg-raised)", borderBottom: "1px solid var(--border)" }}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Info */}
                        <div>
                          <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                            Informations
                          </h4>
                          <div className="space-y-1.5 text-sm">
                            <p>
                              <span style={{ color: "var(--text-muted)" }}>Adresse:</span>{" "}
                              {lead.adresse}
                            </p>
                            <p>
                              <span style={{ color: "var(--text-muted)" }}>T\u00e9l:</span>{" "}
                              {lead.telephone}
                            </p>
                            <p>
                              <span style={{ color: "var(--text-muted)" }}>Site:</span>{" "}
                              {lead.site_web ? (
                                <a
                                  href={lead.site_web}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: "var(--accent-hover)" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {lead.site_web}
                                </a>
                              ) : (
                                "-"
                              )}
                            </p>
                            <p>
                              <span style={{ color: "var(--text-muted)" }}>Source:</span> {lead.source}
                            </p>
                            {lead.google_maps_url && (
                              <p className="flex items-center gap-1">
                                <MapPin size={12} style={{ color: "var(--text-muted)" }} />
                                <a
                                  href={lead.google_maps_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: "var(--accent-hover)" }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs hover:underline"
                                >
                                  Voir sur Google Maps
                                </a>
                              </p>
                            )}
                          </div>
                        </div>
                        {/* Pitch */}
                        <div>
                          <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                            Angle de pitch
                          </h4>
                          <p
                            className="text-sm p-3 rounded-lg"
                            style={{ background: "var(--bg)", fontStyle: "italic" }}
                          >
                            &ldquo;{lead.pitch_angle}&rdquo;
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {!lead.email && lead.site_web && (
                              <button
                                className="text-xs px-3 py-1.5 rounded-md font-medium transition-opacity disabled:opacity-50"
                                style={{ background: "var(--accent)", color: "white" }}
                                onClick={(e) => { e.stopPropagation(); handleEnrichLead(lead); }}
                                disabled={enrichingLeads.has(lead.id)}
                              >
                                {enrichingLeads.has(lead.id) ? "Enrichissement..." : "Enrichir email"}
                              </button>
                            )}
                            {lead.email && (
                              <>
                                <button
                                  className="text-xs px-3 py-1.5 rounded-md font-medium"
                                  style={{ background: "var(--green-subtle)", color: "var(--green)" }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSendSingleToInstantly(lead);
                                  }}
                                >
                                  {sendingLeadId === lead.id ? "Envoi..." : "Ajouter a Instantly"}
                                </button>
                                <button
                                  className="text-xs px-3 py-1.5 rounded-md font-medium"
                                  style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                                  onClick={(e) => { e.stopPropagation(); window.open(`mailto:${lead.email}`, "_blank"); }}
                                >
                                  Ouvrir mailto
                                </button>
                              </>
                            )}
                            {lead.site_web && (
                              <button
                                className="text-xs px-3 py-1.5 rounded-md font-medium"
                                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                                onClick={(e) => { e.stopPropagation(); window.open(lead.site_web.startsWith("http") ? lead.site_web : `https://${lead.site_web}`, "_blank"); }}
                              >
                                Voir site web
                              </button>
                            )}
                            {enrichResults[lead.id] && (
                              <span className="text-xs py-1.5" style={{ color: enrichResults[lead.id].email ? "var(--green)" : "var(--red)" }}>
                                {enrichResults[lead.id].email ? `\u2713 ${enrichResults[lead.id].email}` : enrichResults[lead.id].error}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Decideurs + Enrichment Status */}
                        <div>
                          <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                            Decideurs
                          </h4>

                          {/* Decision makers list */}
                          {decisionMakers[lead.id] && decisionMakers[lead.id].length > 0 ? (
                            <div className="space-y-1.5 mb-3">
                              {decisionMakers[lead.id].map((dm, idx) => (
                                <div
                                  key={`${lead.id}-dm-${idx}`}
                                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                                  style={{ background: "var(--bg)" }}
                                >
                                  {/* Avatar */}
                                  <div
                                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                    style={{
                                      background: "var(--accent-subtle)",
                                      color: "var(--accent-hover)",
                                    }}
                                  >
                                    {dm.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-xs truncate">{dm.name}</p>
                                    {dm.title && (
                                      <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                                        {dm.title}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {dm.email && (
                                      <a
                                        href={`mailto:${dm.email}`}
                                        onClick={(e) => e.stopPropagation()}
                                        title={dm.email}
                                        className="p-1 rounded transition-colors"
                                        style={{ color: "var(--green)" }}
                                      >
                                        <MailIcon size={12} />
                                      </a>
                                    )}
                                    {dm.linkedin_url && (
                                      <a
                                        href={dm.linkedin_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="p-1 rounded transition-colors"
                                        style={{ color: "#0077b5" }}
                                      >
                                        <Linkedin size={12} />
                                      </a>
                                    )}
                                    {/* Confidence badge */}
                                    <span
                                      className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                                      style={{
                                        background: dm.confidence >= 70
                                          ? "rgba(34,197,94,0.15)"
                                          : dm.confidence >= 40
                                            ? "rgba(245,158,11,0.15)"
                                            : "rgba(115,115,115,0.15)",
                                        color: dm.confidence >= 70
                                          ? "#22c55e"
                                          : dm.confidence >= 40
                                            ? "#f59e0b"
                                            : "#737373",
                                      }}
                                    >
                                      <Shield size={8} />
                                      {dm.confidence}%
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : dmErrors[lead.id] ? (
                            <div
                              className="px-3 py-2 rounded-lg text-[11px] mb-3"
                              style={{ background: "rgba(245,158,11,0.08)", color: "var(--amber)" }}
                            >
                              {dmErrors[lead.id]}
                            </div>
                          ) : null}

                          {/* Find decision-makers button */}
                          {!decisionMakers[lead.id] && lead.site_web && (
                            <button
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-opacity disabled:opacity-50 mb-3"
                              style={{ background: "var(--accent-subtle)", color: "var(--accent-hover)" }}
                              onClick={(e) => { e.stopPropagation(); handleFindDecisionMakers(lead); }}
                              disabled={dmLoading.has(lead.id)}
                            >
                              {dmLoading.has(lead.id) ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <UserSearch size={12} />
                              )}
                              {dmLoading.has(lead.id) ? "Recherche Apollo..." : "Trouver les decideurs"}
                            </button>
                          )}

                          {/* Enrichment mini-status */}
                          <div
                            className="p-3 rounded-lg text-xs"
                            style={{ background: "var(--bg)" }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span style={{ color: "var(--text-muted)" }}>Email</span>
                              <span style={{ color: lead.email || enrichResults[lead.id]?.email ? "var(--green)" : "var(--red)" }}>
                                {lead.email || enrichResults[lead.id]?.email ? "\u2713 Trouve" : "\u2717 Manquant"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between mb-1">
                              <span style={{ color: "var(--text-muted)" }}>Site web</span>
                              <span style={{ color: lead.site_web ? "var(--green)" : "var(--text-muted)" }}>
                                {lead.site_web ? "\u2713 Disponible" : "\u2014 Absent"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span style={{ color: "var(--text-muted)" }}>Telephone</span>
                              <span style={{ color: lead.telephone ? "var(--green)" : "var(--text-muted)" }}>
                                {lead.telephone ? "\u2713 Disponible" : "\u2014 Absent"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {filteredLeads.length === 0 && (
        <div className="text-center py-12">
          <p className="text-lg mb-2">Aucun lead trouv\u00e9</p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Ajustez vos filtres ou lancez un nouveau scraping
          </p>
        </div>
      )}
    </div>
  );
}
