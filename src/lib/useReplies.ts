"use client";

import { useEffect, useState, useCallback } from "react";

export type ReplyLeadStatus = "replied" | "clicked" | "opened" | "sent";

export interface ReplyLead {
  email: string;
  name: string;
  company: string;
  status: ReplyLeadStatus;
  lastActivity: string;
  snippet: string;
  interestStatus: string;
}

export interface ReplyStats {
  total: number;
  replied: number;
  opened: number;
  clicked: number;
  sent: number;
}

export interface ThreadEmail {
  id: string;
  type: "sent" | "received";
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
}

interface RepliesResponse {
  success: boolean;
  leads: ReplyLead[];
  stats: ReplyStats;
  nextCursor: string | null;
  error?: string;
}

interface ThreadResponse {
  success: boolean;
  email: string;
  emails: ThreadEmail[];
  uniboxUrl: string;
  error?: string;
}

const REFRESH_INTERVAL = 30_000; // 30s

export function useReplies(campaignId: string | null) {
  const [leads, setLeads] = useState<ReplyLead[]>([]);
  const [stats, setStats] = useState<ReplyStats>({ total: 0, replied: 0, opened: 0, clicked: 0, sent: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReplies = useCallback(async () => {
    if (!campaignId) {
      setLeads([]);
      setStats({ total: 0, replied: 0, opened: 0, clicked: 0, sent: 0 });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/replies?campaignId=${encodeURIComponent(campaignId)}&limit=50`, {
        cache: "no-store",
      });
      const data: RepliesResponse = await res.json();
      if (data.success) {
        setLeads(data.leads);
        setStats(data.stats);
        setError(null);
      } else {
        setError(data.error || "Failed to fetch replies");
      }
    } catch {
      // Keep previous data on network error
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    setLoading(true);
    fetchReplies();
    const interval = setInterval(fetchReplies, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchReplies]);

  return { leads, stats, loading, error, refetch: fetchReplies };
}

export function useThread(email: string | null, campaignId: string | null) {
  const [emails, setEmails] = useState<ThreadEmail[]>([]);
  const [uniboxUrl, setUniboxUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThread = useCallback(async () => {
    if (!email) {
      setEmails([]);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (campaignId) params.set("campaignId", campaignId);

      const res = await fetch(`/api/replies/${encodeURIComponent(email)}?${params.toString()}`, {
        cache: "no-store",
      });
      const data: ThreadResponse = await res.json();
      if (data.success) {
        setEmails(data.emails);
        setUniboxUrl(data.uniboxUrl);
        setError(null);
      } else {
        setError(data.error || "Failed to fetch thread");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [email, campaignId]);

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  return { emails, uniboxUrl, loading, error, refetch: fetchThread };
}
