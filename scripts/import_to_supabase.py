#!/usr/bin/env python3
"""Import leads from CSV into Supabase gtm_leads table."""

import csv
import json
import urllib.request
import urllib.error
import sys
import os

# Supabase credentials from environment — NEVER hardcode
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

CSV_PATH = os.path.join(os.path.dirname(__file__), "leads-enriched-emails.csv")
BATCH_SIZE = 500


def upsert_batch(rows: list[dict]) -> int:
    """Insert a batch of rows into Supabase via REST API."""
    url = f"{SUPABASE_URL}/rest/v1/gtm_leads"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    data = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  ERROR {e.code}: {body[:200]}")
        return e.code


def main() -> None:
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables")
        sys.exit(1)

    if not os.path.exists(CSV_PATH):
        print(f"CSV not found: {CSV_PATH}")
        sys.exit(1)

    rows: list[dict] = []
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Map CSV columns to DB columns
            email = (row.get("best_email") or "").strip()
            rating_str = (row.get("rating") or "").strip()
            reviews_str = (row.get("reviews") or "").strip()
            score_str = (row.get("score") or "").strip()

            lead = {
                "name": (row.get("title") or "").strip(),
                "address": (row.get("address") or "").strip() or None,
                "city": (row.get("city") or "").strip() or None,
                "phone": (row.get("phone") or "").strip() or None,
                "website": (row.get("website") or "").strip() or None,
                "email": email if email else None,
                "category": (row.get("category") or "").strip() or None,
                "rating": float(rating_str) if rating_str else None,
                "reviews": int(reviews_str) if reviews_str else 0,
                "score": int(score_str) if score_str else 0,
            }
            rows.append(lead)

    total = len(rows)
    print(f"Loaded {total} leads from CSV")
    print(f"With email: {sum(1 for r in rows if r['email'])}")
    print(f"Uploading in batches of {BATCH_SIZE}...")

    inserted = 0
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        status = upsert_batch(batch)
        if status == 201:
            inserted += len(batch)
            print(f"  Batch {i // BATCH_SIZE + 1}: {len(batch)} rows → {inserted}/{total}")
        else:
            print(f"  Batch {i // BATCH_SIZE + 1}: FAILED (status {status})")

    print(f"\nDone! {inserted}/{total} leads imported into Supabase.")


if __name__ == "__main__":
    main()
