"use client";

import { useEffect, useState } from "react";
import { LeadsTable } from "@/components/LeadsTable";
import { fetchLeads } from "@/lib/leads-data";
import type { Lead } from "@/lib/leads-data";

interface StatsData {
  totalLeads: number;
  withEmail: number;
  withPhone: number;
  withWebsite: number;
  avgScore: number;
  byVerticale: Record<string, number>;
  byVille: Record<string, number>;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [leadsRes, statsRes] = await Promise.all([
          fetchLeads({ limit: 500, sortBy: "score", sortDir: "desc" }),
          fetch("/api/stats").then((r) => r.json()),
        ]);
        setLeads(leadsRes.leads);
        setTotal(leadsRes.total);
        setStats(statsRes.stats);
      } catch (err) {
        console.error("Failed to load leads:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin inline-block w-8 h-8 border-2 border-current border-t-transparent rounded-full mb-3" style={{ color: "var(--accent)" }} />
          <p className="text-sm" style={{ color: "var(--muted)" }}>Chargement des leads...</p>
        </div>
      </div>
    );
  }

  const displayStats = stats || {
    totalLeads: total,
    withEmail: leads.filter((l) => l.email).length,
    withPhone: leads.filter((l) => l.telephone).length,
    withWebsite: leads.filter((l) => l.site_web).length,
    avgScore: leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0,
    byVerticale: {},
    byVille: {},
  };

  return (
    <div className="p-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {"\u{1F465}"} Base de Leads
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent-light)" }}
            >
              {displayStats.totalLeads.toLocaleString()}
            </span>
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            {displayStats.totalLeads.toLocaleString()} entreprises &bull; {leads.length} affich&eacute;es
          </p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <QuickStat label="Total Leads" value={displayStats.totalLeads.toLocaleString()} color="#6366f1" />
        <QuickStat label="Avec email" value={displayStats.withEmail.toLocaleString()} color="#22c55e" />
        <QuickStat label="Avec t&eacute;l&eacute;phone" value={displayStats.withPhone.toLocaleString()} color="#06b6d4" />
        <QuickStat label="Avec site web" value={displayStats.withWebsite.toLocaleString()} color="#818cf8" />
        <QuickStat label="Score moyen" value={String(displayStats.avgScore)} color="#f59e0b" />
      </div>

      {/* Table */}
      <LeadsTable leads={leads} />

      {/* Info */}
      <div className="mt-4 text-center">
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Affichage des top {leads.length} leads par score (sur {total.toLocaleString()} au total)
        </p>
      </div>
    </div>
  );
}

function QuickStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="p-3 rounded-lg text-center"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <p className="text-xl font-bold" style={{ color }}>
        {value}
      </p>
      <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>
        {label}
      </p>
    </div>
  );
}
