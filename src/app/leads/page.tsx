"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LeadsTable } from "@/components/LeadsTable";
import { fetchLeads } from "@/lib/leads-data";
import type { Lead, LeadFilters } from "@/lib/leads-data";
import { Users, Mail, Phone, Globe, Star } from "lucide-react";
import { useCampaigns } from "@/lib/useCampaigns";

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
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: campaignData } = useCampaigns();

  // Parse URL params into initial filters
  const initialFilters: Partial<LeadFilters> = {};
  const villeParams = searchParams.getAll("ville");
  const verticaleParams = searchParams.getAll("verticale");
  const hasEmailParam = searchParams.get("hasEmail");
  if (villeParams.length > 0) initialFilters.ville = villeParams;
  if (verticaleParams.length > 0) initialFilters.verticale = verticaleParams;
  if (hasEmailParam === "yes" || hasEmailParam === "no") initialFilters.hasEmail = hasEmailParam;

  useEffect(() => {
    async function load() {
      try {
        const [leadsRes, statsRes] = await Promise.all([
          fetchLeads({
            limit: 500,
            sortBy: "score",
            sortDir: "desc",
            ...(villeParams.length > 0 ? { city: villeParams } : {}),
            ...(verticaleParams.length > 0 ? { category: verticaleParams } : {}),
            ...(hasEmailParam === "yes" || hasEmailParam === "no" ? { hasEmail: hasEmailParam } : {}),
          }),
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const displayStats = stats || {
    totalLeads: total,
    withEmail: leads.filter((l) => l.email).length,
    withPhone: leads.filter((l) => l.telephone).length,
    withWebsite: leads.filter((l) => l.site_web).length,
    avgScore:
      leads.length > 0
        ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length)
        : 0,
    byVerticale: {},
    byVille: {},
  };

  return (
    <div className="p-8 max-w-full">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{
              background: "var(--accent-subtle)",
              color: "var(--accent-hover)",
            }}
          >
            {displayStats.totalLeads.toLocaleString()}
          </span>
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {displayStats.totalLeads.toLocaleString()} entreprises &middot;{" "}
          {leads.length} affichees
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <QuickStat icon={<Users size={14} />} label="Total" value={displayStats.totalLeads.toLocaleString()} />
        <QuickStat icon={<Mail size={14} />} label="Avec email" value={displayStats.withEmail.toLocaleString()} accent="green" />
        <QuickStat icon={<Phone size={14} />} label="Avec telephone" value={displayStats.withPhone.toLocaleString()} />
        <QuickStat icon={<Globe size={14} />} label="Avec site web" value={displayStats.withWebsite.toLocaleString()} />
        <QuickStat icon={<Star size={14} />} label="Score moyen" value={String(displayStats.avgScore)} accent="amber" />
      </div>

      {/* Table */}
      <LeadsTable leads={leads} initialFilters={initialFilters} campaignId={campaignData?.activeCampaignId ?? undefined} />

      {/* Info */}
      <p className="text-center text-xs mt-6" style={{ color: "var(--text-muted)" }}>
        Top {leads.length} leads par score (sur {total.toLocaleString()} au total)
      </p>
    </div>
  );
}

function QuickStat({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "green" | "amber";
}) {
  const colorMap = { green: "var(--green)", amber: "var(--amber)" };
  return (
    <div
      className="rounded-lg p-3 border border-[var(--border)]"
      style={{ background: "var(--bg-raised)" }}
    >
      <div className="flex items-center gap-1.5 mb-1" style={{ color: "var(--text-muted)" }}>
        {icon}
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p
        className="text-lg font-semibold"
        style={accent ? { color: colorMap[accent] } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
