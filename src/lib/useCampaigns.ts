"use client";

import { useEffect, useState, useCallback } from "react";

export interface CampaignAnalytics {
  totalLeads: number;
  contacted: number;
  emailsSent: number;
  emailsRead: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  openRate: number;
  replyRate: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  analytics: CampaignAnalytics;
}

export interface CampaignsData {
  connected: boolean;
  activeCampaignId: string | null;
  activeCampaign: Campaign | null;
  campaigns: Campaign[];
  totals: {
    totalLeads: number;
    contacted: number;
    emailsSent: number;
    emailsRead: number;
    replied: number;
    bounced: number;
  };
  timestamp: string;
  error?: string;
}

const REFRESH_INTERVAL = 60_000; // 60s — Instantly rate limits are generous but no need to hammer

export function useCampaigns() {
  const [data, setData] = useState<CampaignsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns", { cache: "no-store" });
      const json: CampaignsData = await res.json();
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

  return { data, loading, refetch: fetchData };
}
