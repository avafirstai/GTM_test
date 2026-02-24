"use client";

import { useState, useMemo } from "react";
import type { Lead, SortField, SortDirection, LeadFilters } from "@/lib/leads-data";

interface LeadsTableProps {
  leads: Lead[];
}

const PIPELINE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  nouveau: { bg: "rgba(99,102,241,0.15)", text: "#818cf8", label: "Nouveau" },
  contacte: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b", label: "Contacté" },
  repondu: { bg: "rgba(34,197,94,0.15)", text: "#22c55e", label: "Répondu" },
  rdv_booke: { bg: "rgba(6,182,212,0.15)", text: "#06b6d4", label: "RDV Booké" },
  deal_won: { bg: "rgba(16,185,129,0.15)", text: "#10b981", label: "Deal Won" },
  perdu: { bg: "rgba(239,68,68,0.15)", text: "#ef4444", label: "Perdu" },
};

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

export function LeadsTable({ leads }: LeadsTableProps) {
  const [filters, setFilters] = useState<LeadFilters>({
    search: "",
    ville: "",
    verticale: "",
    pipeline: "",
    scoreMin: 0,
    scoreMax: 100,
    hasEmail: "all",
    source: "",
  });
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [expandedLead, setExpandedLead] = useState<string | null>(null);

  // Derive unique filter options
  const villes = useMemo(() => [...new Set(leads.map((l) => l.ville))].sort(), [leads]);
  const verticales = useMemo(() => [...new Set(leads.map((l) => l.verticale))].sort(), [leads]);

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
    if (filters.ville) result = result.filter((l) => l.ville === filters.ville);
    if (filters.verticale) result = result.filter((l) => l.verticale === filters.verticale);
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

  return (
    <div>
      {/* Filters Row */}
      <div className="flex flex-wrap gap-3 mb-4">
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
        <select
          value={filters.ville}
          onChange={(e) => setFilters({ ...filters, ville: e.target.value })}
          className="px-3 py-2 rounded-lg text-sm"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">Toutes les villes</option>
          {villes.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <select
          value={filters.verticale}
          onChange={(e) => setFilters({ ...filters, verticale: e.target.value })}
          className="px-3 py-2 rounded-lg text-sm"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">Toutes les verticales</option>
          {verticales.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
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
          <option value="contacte">Contacté</option>
          <option value="repondu">Répondu</option>
          <option value="rdv_booke">RDV Booké</option>
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

      {/* Selection bar */}
      {selectedLeads.size > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2 rounded-lg mb-3"
          style={{ background: "var(--accent-subtle)", border: "1px solid rgba(99,102,241,0.3)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--accent-hover)" }}>
            {selectedLeads.size} sélectionné{selectedLeads.size > 1 ? "s" : ""}
          </span>
          <button
            className="text-xs px-3 py-1 rounded-md font-medium"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Exporter CSV
          </button>
          <button
            className="text-xs px-3 py-1 rounded-md font-medium"
            style={{ background: "var(--green-subtle)", color: "var(--green)" }}
          >
            Envoyer à Instantly
          </button>
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
                    {lead.enrichment_status === "completed" ? (
                      <span style={{ color: "var(--green)" }}>&#10003;</span>
                    ) : lead.enrichment_status === "in_progress" ? (
                      <span className="animate-spin inline-block">&#x21BB;</span>
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
                              <span style={{ color: "var(--text-muted)" }}>Tél:</span>{" "}
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
                          <div className="mt-3 flex gap-2">
                            <button
                              className="text-xs px-3 py-1.5 rounded-md font-medium"
                              style={{ background: "var(--accent)", color: "white" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Enrichir decideurs
                            </button>
                            <button
                              className="text-xs px-3 py-1.5 rounded-md font-medium"
                              style={{ background: "var(--green-subtle)", color: "var(--green)" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Voir dans Instantly
                            </button>
                          </div>
                        </div>
                        {/* Decision Makers */}
                        <div>
                          <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                            Decideurs ({lead.decision_makers.length})
                          </h4>
                          {lead.decision_makers.length > 0 ? (
                            <div className="space-y-2">
                              {lead.decision_makers.map((dm, i) => (
                                <div
                                  key={i}
                                  className="p-2 rounded-lg text-xs"
                                  style={{ background: "var(--bg)" }}
                                >
                                  <p className="font-medium">{dm.name}</p>
                                  <p style={{ color: "var(--text-muted)" }}>{dm.title}</p>
                                  <p style={{ color: "var(--green)" }}>{dm.email}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div
                              className="p-4 rounded-lg text-center"
                              style={{
                                background: "var(--bg)",
                                border: "1px dashed var(--border)",
                              }}
                            >
                              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                                Pas encore enrichi
                              </p>
                              <p className="text-[10px] mt-1" style={{ color: "var(--accent-hover)" }}>
                                Cliquer &laquo;Enrichir decideurs&raquo; pour lancer
                              </p>
                            </div>
                          )}
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
          <p className="text-lg mb-2">Aucun lead trouvé</p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Ajustez vos filtres ou lancez un nouveau scraping
          </p>
        </div>
      )}
    </div>
  );
}
