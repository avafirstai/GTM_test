import { NextResponse } from "next/server";
import { instantlyFetch } from "@/lib/lead-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/replies?campaignId={id}&limit=50&starting_after={cursor}
 *
 * Fetches leads from Instantly for a campaign and classifies them by activity:
 * - replied: has timestamp_last_reply
 * - clicked: has timestamp_last_click
 * - opened: has timestamp_last_open
 * - sent: no activity timestamps
 *
 * For replied leads (max 10), fetches the last reply snippet via /emails endpoint.
 */

interface InstantlyLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  lead_status?: string;
  interest_status?: string;
  timestamp_last_reply?: string;
  timestamp_last_open?: string;
  timestamp_last_click?: string;
  timestamp_created?: string;
  [key: string]: unknown;
}

interface InstantlyLeadsResponse {
  items?: InstantlyLead[];
  next_starting_after?: string;
}

interface InstantlyEmail {
  id?: string;
  from_address_email?: string;
  to_address_email?: string;
  subject?: string;
  body?: string;
  reply_text?: string;
  reply_subject?: string;
  timestamp_created?: string;
  is_reply?: boolean;
  [key: string]: unknown;
}

type EmailsResponse = InstantlyEmail[] | { items?: InstantlyEmail[] };

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

function classifyLead(lead: InstantlyLead): ReplyLeadStatus {
  if (lead.timestamp_last_reply) return "replied";
  if (lead.timestamp_last_click) return "clicked";
  if (lead.timestamp_last_open) return "opened";
  return "sent";
}

function getLastActivity(lead: InstantlyLead): string {
  return (
    lead.timestamp_last_reply ||
    lead.timestamp_last_click ||
    lead.timestamp_last_open ||
    lead.timestamp_created ||
    ""
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const startingAfter = searchParams.get("starting_after");

  if (!campaignId) {
    return NextResponse.json(
      { success: false, error: "campaignId is required" },
      { status: 400 },
    );
  }

  try {
    // Fetch leads with activity timestamps from Instantly
    const listBody: Record<string, unknown> = {
      campaign_id: campaignId,
      limit,
    };
    if (startingAfter) {
      listBody.starting_after = startingAfter;
    }

    const raw = (await instantlyFetch(
      "/leads/list",
      "POST",
      listBody,
    )) as InstantlyLeadsResponse;

    const items = raw.items ?? [];

    // Classify each lead
    const leads: ReplyLead[] = items.map((lead) => ({
      email: lead.email,
      name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email.split("@")[0],
      company: lead.company_name || "",
      status: classifyLead(lead),
      lastActivity: getLastActivity(lead),
      snippet: "",
      interestStatus: lead.interest_status || "",
    }));

    // For replied leads, fetch their last email snippet (max 10 to avoid rate limits)
    const repliedLeads = leads.filter((l) => l.status === "replied").slice(0, 10);

    await Promise.all(
      repliedLeads.map(async (lead) => {
        try {
          const emailsRaw = (await instantlyFetch(
            `/emails?lead_email=${encodeURIComponent(lead.email)}&limit=1`,
            "GET",
          )) as EmailsResponse;

          const emails = Array.isArray(emailsRaw) ? emailsRaw : (emailsRaw.items ?? []);
          const lastEmail = emails[0];
          if (lastEmail) {
            const replyText = lastEmail.reply_text || lastEmail.body || "";
            // Strip HTML and truncate for snippet
            lead.snippet = replyText
              .replace(/<[^>]*>/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120);
          }
        } catch {
          // Silent — snippet stays empty
        }
      }),
    );

    // Compute stats
    const stats = {
      total: leads.length,
      replied: leads.filter((l) => l.status === "replied").length,
      opened: leads.filter((l) => l.status === "opened").length,
      clicked: leads.filter((l) => l.status === "clicked").length,
      sent: leads.filter((l) => l.status === "sent").length,
    };

    return NextResponse.json({
      success: true,
      leads,
      stats,
      nextCursor: raw.next_starting_after ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Replies] Failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { success: false, error: "Failed to fetch replies" },
      { status: 502 },
    );
  }
}
