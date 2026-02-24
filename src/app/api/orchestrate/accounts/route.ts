import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestrate/accounts — List email accounts configured in Instantly.
 *
 * Returns the list of email accounts the user can assign to campaigns.
 * Uses Instantly API v2: GET /api/v2/accounts
 */

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

interface InstantlyAccount {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: string;
  warmup_status: string;
  daily_limit: number;
}

export async function GET() {
  const apiKey = process.env.INSTANTLY_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { connected: false, accounts: [], error: "INSTANTLY_API_KEY not configured" },
    );
  }

  try {
    const resp = await fetch(`${INSTANTLY_API_BASE}/accounts?limit=100`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: 0 },
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "unknown");
      return NextResponse.json(
        { connected: false, accounts: [], error: `Instantly API ${resp.status}: ${errorText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await resp.json() as { items?: InstantlyAccount[] } | InstantlyAccount[];

    // Handle both response formats
    const accounts: InstantlyAccount[] = Array.isArray(data)
      ? data
      : (data as { items?: InstantlyAccount[] }).items ?? [];

    return NextResponse.json({
      connected: true,
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        firstName: a.first_name || "",
        lastName: a.last_name || "",
        status: a.status || "unknown",
        warmupStatus: a.warmup_status || "unknown",
        dailyLimit: a.daily_limit || 0,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { connected: false, accounts: [], error: message },
      { status: 502 },
    );
  }
}
