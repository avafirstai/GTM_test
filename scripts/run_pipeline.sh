#!/bin/bash
# ============================================================
# AVA GTM — Pipeline Orchestrator
# Runs the full GTM machine: scrape emails → upload to Instantly
#
# Dashboard data is live from Supabase — no static file generation needed.
# email_scraper.py updates Supabase directly as it finds emails.
#
# Usage:
#   ./scripts/run_pipeline.sh           # Full pipeline
#   ./scripts/run_pipeline.sh --test    # Test mode (20 leads)
#
# Required env vars:
#   APIFY_TOKEN           — Apify API token (for dataset download)
#   SUPABASE_URL          — Supabase project URL
#   SUPABASE_ANON_KEY     — Supabase anon key
#   INSTANTLY_API_KEY     — Instantly API key (for upload step)
#   INSTANTLY_CAMPAIGN_ID — Instantly campaign ID (for upload step)
#
# Cron (daily at 6am):
#   0 6 * * * cd /path/to/GTM_test && ./scripts/run_pipeline.sh >> scripts/pipeline.log 2>&1
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Load environment variables from .env.local or .env if they exist
for envfile in "$PROJECT_DIR/.env.local" "$PROJECT_DIR/.env"; do
    if [ -f "$envfile" ]; then
        set -a
        source "$envfile"
        set +a
        break
    fi
done

# Map NEXT_PUBLIC_* vars to the names Python scripts expect.
# .env.local uses NEXT_PUBLIC_ prefix (for Next.js), but Python scripts use plain names.
export SUPABASE_URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"

TEST_FLAG=""
if [[ "${1:-}" == "--test" ]]; then
    TEST_FLAG="--test 20"
    echo "[TEST MODE] 20 leads only"
fi

echo ""
echo "============================================================"
echo "  AVA GTM — PIPELINE START"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

# Pre-flight checks
missing=""
[ -z "${APIFY_TOKEN:-}" ] && missing="$missing APIFY_TOKEN"
[ -z "${SUPABASE_URL:-}" ] && missing="$missing SUPABASE_URL"
[ -z "${SUPABASE_ANON_KEY:-}" ] && missing="$missing SUPABASE_ANON_KEY"

if [ -n "$missing" ]; then
    echo "[ERROR] Missing required env vars:$missing"
    echo "  Set them in .env.local or export them before running."
    exit 1
fi

# Step 1: Email scraping (also updates Supabase in real-time)
echo "--- STEP 1/2: Email Scraper ---"
python3 scripts/email_scraper.py $TEST_FLAG
echo ""

# Step 2: Upload to Instantly (optional — skipped if no API key)
if [ -n "${INSTANTLY_API_KEY:-}" ] && [ -n "${INSTANTLY_CAMPAIGN_ID:-}" ]; then
    echo "--- STEP 2/2: Instantly Upload ---"
    python3 scripts/instantly_uploader.py $TEST_FLAG
else
    echo "--- STEP 2/2: Instantly Upload [SKIPPED] ---"
    echo "  Set INSTANTLY_API_KEY and INSTANTLY_CAMPAIGN_ID to enable."
fi

echo ""
echo "============================================================"
echo "  AVA GTM — PIPELINE COMPLETE"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""
echo "  Dashboard updates automatically via /api/stats -> Supabase"
echo ""
