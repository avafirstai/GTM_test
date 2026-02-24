"use client";

import { useEffect, useState, useCallback } from "react";

export interface DashboardData {
  stats: {
    totalLeads: number;
    withEmail: number;
    withoutEmail: number;
    withPhone: number;
    withWebsite: number;
    highScore: number;
    mediumScore: number;
    lowScore: number;
    avgScore: number;
    avgRating: number;
    totalReviews: number;
    emailRate: number;
    phoneRate: number;
    websiteRate: number;
    byVerticale: Record<string, number>;
    byVille: Record<string, number>;
    bySource: Record<string, number>;
    byScore: { high: number; medium: number; low: number };
    lastUpdated: string;
  };
  pipeline: { name: string; count: number; color: string }[];
  apifyRuns: {
    runId: string;
    datasetId: string;
    status: string;
    queriesCount: number;
    verticale: string;
    resultsCount?: number;
  }[];
  enrichment: {
    method: string;
    cost: string;
    successRate: number;
    totalEmailsFound: number;
    totalLeadsProcessed: number;
    timestamp: string;
  };
  categoryEmailRates: { name: string; total: number; withEmail: number; rate: number }[];
  cityEmailRates: { name: string; total: number; withEmail: number; rate: number }[];
}

const REFRESH_INTERVAL = 30_000;

export function useStats() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DashboardData = await res.json();
      setData(json);
    } catch {
      // Keep previous data on error — silent retry next interval
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { data, loading };
}
