import { NextResponse } from "next/server";
import { instantlyFetch } from "@/lib/lead-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/replies/{email}?campaignId={id}
 *
 * Fetches the full email thread for a specific lead.
 * Returns sent emails and replies in chronological order.
 */

interface InstantlyEmail {
  id?: string;
  from_address_email?: string;
  to_address_email?: string;
  subject?: string;
  body?: string;
  reply_text?: string;
  reply_html?: string;
  reply_subject?: string;
  timestamp_created?: string;
  is_reply?: boolean;
  [key: string]: unknown;
}

type EmailsResponse = InstantlyEmail[] | { items?: InstantlyEmail[] };

export interface ThreadEmail {
  id: string;
  type: "sent" | "received";
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ email: string }> },
) {
  const { email } = await params;
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId");
  const decodedEmail = decodeURIComponent(email);

  if (!decodedEmail) {
    return NextResponse.json(
      { success: false, error: "email is required" },
      { status: 400 },
    );
  }

  try {
    // Fetch emails for this lead
    const query = new URLSearchParams({
      lead_email: decodedEmail,
      limit: "20",
    });
    if (campaignId) {
      query.set("campaign_id", campaignId);
    }

    const raw = (await instantlyFetch(
      `/emails?${query.toString()}`,
      "GET",
    )) as EmailsResponse;

    const items = Array.isArray(raw) ? raw : (raw.items ?? []);

    // Map to unified thread format
    const emails: ThreadEmail[] = items.map((e, i) => {
      const isReply = e.is_reply === true || Boolean(e.reply_text || e.reply_html);
      return {
        id: e.id || `email-${i}`,
        type: isReply ? "received" : "sent",
        from: isReply ? decodedEmail : (e.from_address_email || "you"),
        to: isReply ? (e.to_address_email || "you") : decodedEmail,
        subject: isReply ? (e.reply_subject || e.subject || "(sans objet)") : (e.subject || "(sans objet)"),
        body: isReply
          ? (e.reply_text || e.reply_html || "").replace(/<[^>]*>/g, "").trim()
          : (e.body || "").replace(/<[^>]*>/g, "").trim(),
        timestamp: e.timestamp_created || "",
      };
    });

    // Sort chronologically (oldest first)
    emails.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Build Unibox deep link
    const uniboxUrl = `https://app.instantly.ai/app/unibox?search=${encodeURIComponent(decodedEmail)}`;

    return NextResponse.json({
      success: true,
      email: decodedEmail,
      emails,
      uniboxUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Thread] Failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { success: false, error: "Failed to fetch email thread" },
      { status: 502 },
    );
  }
}
