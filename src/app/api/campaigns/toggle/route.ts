import { NextResponse } from "next/server";
import { instantlyFetch } from "@/lib/lead-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/campaigns/toggle — Pause or resume an Instantly campaign.
 *
 * Body: { campaignId: string, action: "pause" | "resume" }
 * Instantly API v2: POST /campaigns/{id}/pause | /campaigns/{id}/resume
 */

interface ToggleBody {
  campaignId: string;
  action: "pause" | "resume";
}

export async function POST(request: Request) {
  let body: ToggleBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.campaignId || typeof body.campaignId !== "string") {
    return NextResponse.json(
      { success: false, error: "campaignId is required" },
      { status: 400 },
    );
  }

  if (body.action !== "pause" && body.action !== "resume") {
    return NextResponse.json(
      { success: false, error: "action must be 'pause' or 'resume'" },
      { status: 400 },
    );
  }

  try {
    await instantlyFetch(
      `/campaigns/${body.campaignId}/${body.action}`,
      "POST",
    );

    return NextResponse.json({
      success: true,
      campaignId: body.campaignId,
      newStatus: body.action === "pause" ? "paused" : "active",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      `[CampaignToggle] ${body.action} failed for ${body.campaignId}:`,
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json(
      { success: false, error: `Failed to ${body.action} campaign` },
      { status: 502 },
    );
  }
}
