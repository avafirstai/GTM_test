"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  const [refreshing, setRefreshing] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const { data: campaignData } = useCampaigns();
  const [serverSearch, setServerSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((query: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setServerSearch(query), 400);
  }, []);

  // Parse URL params into initial filters
  const initialFilters: Partial<LeadFilters> = {};
  const villeParams = searchParams.getAll("ville");
  const verticaleParams = searchParams.getAll("verticale");
  const hasEmailParam = searchParams.get("hasEmail");
  if (villeParams.length > 0) initialFilters.ville = villeParams;
  if (verticaleParams.length > 0) initialFilters.verticale = verticaleParams;
  if (hasEmailParam === "yes" || hasEmailParam === "no") initialFilters.hasEmail = hasEmailParam;

  // Stable reference for URL params used in fetch
  const paramsKey = searchParams.toString();

  const loadLeads = useCallback(async (offset = 0, append = false, search = "") => {
    if (append) {
      setLoadingMore(true);
    } else if (leads.length === 0) {
      // Full-screen spinner only on very first load (empty state)
      setLoading(true);
    } else {
      // Soft refresh — keeps table visible, shows subtle indicator
      setRefreshing(true);
    }

    try {
      const BATCH = 2000;
      const fetchStats = !append && !search;
      const [leadsRes, statsRes] = await Promise.all([
        fetchLeads({
          limit: BATCH,
          offset,
          sortBy: "score",
          sortDir: "desc",
          ...(search ? { search } : {}),
          ...(villeParams.length > 0 ? { city: villeParams } : {}),
          ...(verticaleParams.length > 0 ? { category: verticaleParams } : {}),
          ...(hasEmailParam === "yes" || hasEmailParam === "no" ? { hasEmail: hasEmailParam } : {}),
        }),
        // Only fetch stats on initial load (not on "load more" or search)
        ...(fetchStats ? [fetch("/api/stats").then((r) => r.json())] : []),
      ]);

      if (append) {
        setLeads((prev) => [...prev, ...leadsRes.leads]);
        setLoadedCount((prev) => prev + leadsRes.leads.length);
      } else {
        setLeads(leadsRes.leads);
        setTotal(leadsRes.total);
        setLoadedCount(leadsRes.leads.length);
        if (statsRes) setStats(statsRes.stats);
      }
    } catch (err) {
      console.error("Failed to load leads:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  useEffect(() => {
    loadLeads(0, false, serverSearch);
  }, [loadLeads, serverSearch]);

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
      <div className="relative">
        {refreshing && (
          <div className="absolute top-0 left-0 right-0 z-10 flex justify-center">
            <div className="px-3 py-1 rounded-b-lg text-xs font-medium flex items-center gap-1.5" style={{ background: "var(--accent-subtle)", color: "var(--accent-hover)" }}>
              <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              Recherche...
            </div>
          </div>
        )}
        <LeadsTable leads={leads} initialFilters={initialFilters} campaignId={campaignData?.activeCampaignId ?? undefined} onSearchChange={handleSearchChange} />
      </div>

      {/* Load more / Info */}
      <div className="text-center mt-6 space-y-2">
        {loadedCount < total && (
          <button
            onClick={() => loadLeads(loadedCount, true, serverSearch)}
            disabled={loadingMore}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--border)] hover:bg-[var(--bg-raised)] transition-colors disabled:opacity-50"
          >
            {loadingMore ? "Chargement..." : `Charger plus (${(total - loadedCount).toLocaleString()} restants)`}
          </button>
        )}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {leads.length.toLocaleString()} leads affichees sur {total.toLocaleString()} au total
        </p>
      </div>
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
