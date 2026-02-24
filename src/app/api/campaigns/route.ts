import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Instantly API v2 — fetch real campaign data.
 * Uses server-side env var INSTANTLY_API_KEY (never exposed to browser).
 *
 * Endpoints used:
 *   GET /api/v2/campaigns              — list campaigns
 *   GET /api/v2/campaigns/:id          — single campaign details
 *   GET /api/v2/campaigns/analytics    — campaign analytics (param: id)
 */

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

interface InstantlyCampaign {
  id: string;
  name: string;
  status: string;
  timestamp: string;
}

interface InstantlyAnalytics {
  campaign_id: string;
  total_leads: number;
  contacted: number;
  emails_sent: number;
  emails_read: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  leads_who_read: number;
  leads_who_replied: number;
  new_leads_contacted: number;
}

interface CampaignWithAnalytics {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  analytics: {
    totalLeads: number;
    contacted: number;
    emailsSent: number;
    emailsRead: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    openRate: number;
    replyRate: number;
  };
}

async function instantlyFetch(endpoint: string): Promise<unknown> {
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) {
    throw new Error("INSTANTLY_API_KEY not configured");
  }

  const resp = await fetch(`${INSTANTLY_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    next: { revalidate: 0 },
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "unknown error");
    throw new Error(`Instantly API ${resp.status}: ${errorText.slice(0, 200)}`);
  }

  return resp.json();
}

export async function GET() {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const campaignId = process.env.INSTANTLY_CAMPAIGN_ID;

  // If no API key configured, return disconnected state
  if (!apiKey) {
    return NextResponse.json({
      connected: false,
      campaigns: [],
      error: "INSTANTLY_API_KEY not configured",
    });
  }

  try {
    // 1. List campaigns
    const campaignsRaw = (await instantlyFetch("/campaigns?limit=100")) as {
      items?: InstantlyCampaign[];
    };
    const campaigns: InstantlyCampaign[] = campaignsRaw.items ?? [];

    // 2. For the active campaign (or all), fetch analytics
    const campaignsWithAnalytics: CampaignWithAnalytics[] = [];

    for (const camp of campaigns) {
      try {
        // Instantly v2: /campaigns/analytics uses param "id" (not "campaign_id")
        // Date range required — fetch last 12 months of data
        const now = new Date();
        const yearAgo = new Date(now);
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        const startDate = yearAgo.toISOString().split("T")[0];
        const endDate = now.toISOString().split("T")[0];

        const analyticsRaw = (await instantlyFetch(
          `/campaigns/analytics?id=${camp.id}&start_date=${startDate}&end_date=${endDate}`
        )) as InstantlyAnalytics | InstantlyAnalytics[];

        // Response can be a single object or array depending on API version
        const analytics: InstantlyAnalytics =
          Array.isArray(analyticsRaw) && analyticsRaw.length > 0
            ? analyticsRaw[0]
            : !Array.isArray(analyticsRaw) && analyticsRaw && typeof analyticsRaw === "object"
              ? analyticsRaw
              : {
                  campaign_id: camp.id,
                  total_leads: 0,
                  contacted: 0,
                  emails_sent: 0,
                  emails_read: 0,
                  replied: 0,
                  bounced: 0,
                  unsubscribed: 0,
                  leads_who_read: 0,
                  leads_who_replied: 0,
                  new_leads_contacted: 0,
                };

        const emailsSent = analytics.emails_sent || 0;
        const emailsRead = analytics.emails_read || 0;
        const replied = analytics.replied || 0;

        campaignsWithAnalytics.push({
          id: camp.id,
          name: camp.name,
          status: camp.status,
          createdAt: camp.timestamp || "",
          analytics: {
            totalLeads: analytics.total_leads || 0,
            contacted: analytics.contacted || 0,
            emailsSent,
            emailsRead,
            replied,
            bounced: analytics.bounced || 0,
            unsubscribed: analytics.unsubscribed || 0,
            openRate: emailsSent > 0 ? Math.round((emailsRead / emailsSent) * 1000) / 10 : 0,
            replyRate: emailsSent > 0 ? Math.round((replied / emailsSent) * 1000) / 10 : 0,
          },
        });
      } catch {
        // Analytics fetch failed for this campaign — still include it with zero stats
        campaignsWithAnalytics.push({
          id: camp.id,
          name: camp.name,
          status: camp.status,
          createdAt: camp.timestamp || "",
          analytics: {
            totalLeads: 0,
            contacted: 0,
            emailsSent: 0,
            emailsRead: 0,
            replied: 0,
            bounced: 0,
            unsubscribed: 0,
            openRate: 0,
            replyRate: 0,
          },
        });
      }
    }

    // Find our configured campaign
    const activeCampaign = campaignId
      ? campaignsWithAnalytics.find((c) => c.id === campaignId) ?? null
      : null;

    // Aggregate totals across all campaigns
    const totals = campaignsWithAnalytics.reduce(
      (acc, c) => ({
        totalLeads: acc.totalLeads + c.analytics.totalLeads,
        contacted: acc.contacted + c.analytics.contacted,
        emailsSent: acc.emailsSent + c.analytics.emailsSent,
        emailsRead: acc.emailsRead + c.analytics.emailsRead,
        replied: acc.replied + c.analytics.replied,
        bounced: acc.bounced + c.analytics.bounced,
      }),
      { totalLeads: 0, contacted: 0, emailsSent: 0, emailsRead: 0, replied: 0, bounced: 0 }
    );

    return NextResponse.json({
      connected: true,
      activeCampaignId: campaignId || null,
      activeCampaign,
      campaigns: campaignsWithAnalytics,
      totals,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        connected: false,
        campaigns: [],
        error: message,
      },
      { status: 502 }
    );
  }
}
