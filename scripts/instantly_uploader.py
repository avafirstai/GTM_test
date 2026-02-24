#!/usr/bin/env python3
"""
AVA GTM — Instantly Uploader
Upload enriched leads to Instantly campaigns by verticale.
Uses Instantly API v2 with Bearer token.

Env vars:
    INSTANTLY_API_KEY      — Instantly API key (required)
    INSTANTLY_CAMPAIGN_ID  — Default campaign ID (or use --campaign)

Usage:
    python3 scripts/instantly_uploader.py --campaign <id>
    python3 scripts/instantly_uploader.py --test 5 --campaign <id>
    python3 scripts/instantly_uploader.py --csv custom.csv --campaign <id>
"""

import csv
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2"
INSTANTLY_API_KEY = os.environ.get("INSTANTLY_API_KEY", "")

# Campaign ID — set via env var or pass --campaign on CLI
DEFAULT_CAMPAIGN_ID = os.environ.get("INSTANTLY_CAMPAIGN_ID", "")

# CSV input (output of email_scraper.py)
DEFAULT_CSV = "scripts/leads-enriched-emails.csv"

# Verticale grouping by category keywords
VERTICALE_MAP: dict[str, list[str]] = {
    "formation": ["formation", "enseignement", "école", "ecole", "université", "college", "lycée", "académie", "apprentissage", "éducation", "education"],
    "immobilier": ["immobilier", "agence immobilière", "real estate", "location", "gestion locative"],
    "restaurant": ["restaurant", "restauration", "brasserie", "bistrot", "pizzeria", "traiteur", "café"],
    "hotel": ["hôtel", "hotel", "hébergement", "auberge", "chambre d'hôte", "gîte"],
    "sante": ["médecin", "dentiste", "kiné", "ostéopathe", "pharmacie", "clinique", "santé", "health", "cabinet médical", "infirmier", "opticien", "laboratoire"],
    "beaute": ["coiffeur", "coiffure", "salon de beauté", "esthéticien", "spa", "nail", "barbier"],
    "auto": ["garage", "automobile", "auto", "carrosserie", "mécanique", "concessionnaire", "pneu"],
    "juridique": ["avocat", "notaire", "juridique", "cabinet d'avocat", "huissier"],
    "comptabilite": ["comptable", "expert-comptable", "comptabilité", "audit", "fiduciaire"],
    "batiment": ["bâtiment", "construction", "plombier", "électricien", "peintre", "maçon", "artisan", "rénovation", "menuisier", "couvreur", "chauffagiste"],
    "commerce": ["commerce", "magasin", "boutique", "épicerie", "supermarché", "boulangerie", "pâtisserie", "fleuriste"],
    "tech": ["informatique", "développement", "agence web", "digital", "startup", "logiciel", "it", "tech"],
    "sport": ["sport", "fitness", "salle de sport", "gym", "yoga", "pilates", "arts martiaux", "danse"],
    "transport": ["transport", "déménagement", "livraison", "logistique", "taxi", "vtc"],
    "assurance": ["assurance", "mutuelle", "courtier"],
    "nettoyage": ["nettoyage", "ménage", "propreté", "entretien"],
    "evenement": ["événement", "événementiel", "mariage", "photographe", "dj", "animation", "traiteur"],
    "conseil": ["conseil", "consulting", "consultant", "accompagnement", "coaching", "coach"],
    "veterinaire": ["vétérinaire", "animal", "animalerie", "toilettage"],
    "autre": [],  # fallback
}


def classify_verticale(category: str, title: str) -> str:
    """Classify a lead into a verticale based on category and title."""
    text = f"{category} {title}".lower()
    for verticale, keywords in VERTICALE_MAP.items():
        if verticale == "autre":
            continue
        for kw in keywords:
            if kw.lower() in text:
                return verticale
    return "autre"


def extract_first_name(title: str) -> str:
    """Try to extract a meaningful first name / contact name from business title."""
    # For businesses, use the business name as identifier
    parts = title.strip().split()
    if len(parts) >= 2:
        return parts[0]
    return title.strip()[:20] if title else "Contact"


def instantly_api_request(
    method: str,
    endpoint: str,
    data: Optional[dict[str, object]] = None,
) -> dict[str, object]:
    """Make an API request to Instantly v2."""
    url = f"{INSTANTLY_API_BASE}{endpoint}"
    headers = {
        "Authorization": f"Bearer {INSTANTLY_API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AVA-GTM/1.0",
    }

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        print(f"  [API Error] {e.code}: {error_body[:200]}")
        return {"error": True, "status": e.code, "message": error_body[:200]}
    except Exception as e:
        print(f"  [API Error] {e}")
        return {"error": True, "message": str(e)}


def get_or_create_campaign(verticale: str, campaign_id: str) -> str:
    """Get campaign ID for verticale. Currently uses a single campaign."""
    return campaign_id


def upload_leads_batch(
    campaign_id: str,
    leads: list[dict[str, str]],
) -> dict[str, object]:
    """Upload leads to Instantly campaign one by one (v2 API)."""
    total_uploaded = 0
    total_errors = 0

    for idx, lead in enumerate(leads):
        entry: dict[str, str] = {
            "email": lead["email"],
            "first_name": extract_first_name(lead.get("title", "")),
            "company_name": lead.get("title", ""),
            "campaign": campaign_id,
        }
        # Custom variables for email personalization
        if lead.get("website"):
            entry["website"] = lead["website"]
        if lead.get("city"):
            entry["city"] = lead["city"]
        if lead.get("phone"):
            entry["phone"] = lead["phone"]
        if lead.get("category"):
            entry["lt_category"] = lead["category"]

        result = instantly_api_request("POST", "/leads", entry)

        if isinstance(result, dict) and result.get("error"):
            total_errors += 1
        else:
            total_uploaded += 1

        # Progress every 50 leads
        if (idx + 1) % 50 == 0:
            print(f"    Progress: {idx + 1}/{len(leads)} ({total_uploaded} ok, {total_errors} err)")

    print(f"    Done: {total_uploaded} uploaded, {total_errors} errors")
    return {"uploaded": total_uploaded, "errors": total_errors}


def main() -> None:
    """Main upload flow."""
    print("=" * 60)
    print("  AVA GTM — INSTANTLY UPLOADER")
    print("  Upload enriched leads to Instantly campaigns")
    print("=" * 60)

    # Validate env vars
    if not INSTANTLY_API_KEY:
        print("[ERROR] INSTANTLY_API_KEY not set. Export it first:")
        print("  export INSTANTLY_API_KEY=your_key_here")
        sys.exit(1)

    # Parse args
    csv_path = DEFAULT_CSV
    test_limit: Optional[int] = None
    campaign_override: Optional[str] = None

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--test" and i + 1 < len(args):
            test_limit = int(args[i + 1])
            i += 2
        elif args[i] == "--csv" and i + 1 < len(args):
            csv_path = args[i + 1]
            i += 2
        elif args[i] == "--campaign" and i + 1 < len(args):
            campaign_override = args[i + 1]
            i += 2
        else:
            i += 1

    # Resolve campaign ID
    effective_campaign = campaign_override or DEFAULT_CAMPAIGN_ID
    if not effective_campaign:
        print("[ERROR] No campaign ID. Set INSTANTLY_CAMPAIGN_ID env var or pass --campaign <id>")
        sys.exit(1)

    # Read CSV
    csv_file = Path(csv_path)
    if not csv_file.exists():
        print(f"[ERROR] CSV not found: {csv_path}")
        print("  Run email_scraper.py first to generate the CSV.")
        sys.exit(1)

    leads_by_verticale: dict[str, list[dict[str, str]]] = defaultdict(list)
    total_with_email = 0
    total_without_email = 0

    with open(csv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            email = row.get("best_email", "").strip()
            if not email:
                total_without_email += 1
                continue

            total_with_email += 1
            verticale = classify_verticale(
                row.get("category", ""),
                row.get("title", ""),
            )
            leads_by_verticale[verticale].append({
                "email": email,
                "title": row.get("title", ""),
                "phone": row.get("phone", ""),
                "website": row.get("website", ""),
                "city": row.get("city", ""),
                "category": row.get("category", ""),
            })

    print(f"\n[CSV] Loaded {total_with_email} leads with email ({total_without_email} without)")
    print(f"[CSV] {len(leads_by_verticale)} verticales detected:")
    for v, leads in sorted(leads_by_verticale.items(), key=lambda x: -len(x[1])):
        print(f"  {v:20s} : {len(leads):5d} leads")

    if test_limit:
        print(f"\n[TEST MODE] Limiting to {test_limit} leads total")

    # Verify Instantly API connection
    print("\n[Instantly] Verifying API connection...")
    campaigns = instantly_api_request("GET", "/campaigns?limit=5")
    if isinstance(campaigns, dict) and campaigns.get("error"):
        print("[ERROR] Cannot connect to Instantly API. Check your Bearer token.")
        sys.exit(1)
    print("[Instantly] API connected successfully")

    # Upload by verticale
    print("\n[Upload] Starting upload by verticale...")
    start_time = time.time()
    total_uploaded = 0
    total_errors = 0
    uploaded_count = 0

    for verticale, leads in sorted(leads_by_verticale.items(), key=lambda x: -len(x[1])):
        if test_limit and uploaded_count >= test_limit:
            break

        # Apply test limit
        batch = leads
        if test_limit:
            remaining = test_limit - uploaded_count
            batch = leads[:remaining]

        campaign_id = get_or_create_campaign(verticale, effective_campaign)
        print(f"\n  [{verticale}] Uploading {len(batch)} leads to campaign {campaign_id[:12]}...")

        result = upload_leads_batch(campaign_id, batch)
        up = result.get("uploaded", 0)
        err = result.get("errors", 0)
        if isinstance(up, int):
            total_uploaded += up
        if isinstance(err, int):
            total_errors += err
        uploaded_count += len(batch)

    elapsed = time.time() - start_time

    # Summary
    print("\n" + "=" * 60)
    print("  UPLOAD COMPLETE")
    print("=" * 60)
    print(f"  Total uploaded:    {total_uploaded}")
    print(f"  Total errors:      {total_errors}")
    print(f"  Time:              {elapsed:.1f}s")
    print(f"  Campaign:          {effective_campaign[:16]}...")
    print("=" * 60)

    # Export stats
    stats = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_uploaded": total_uploaded,
        "total_errors": total_errors,
        "by_verticale": {v: len(l) for v, l in leads_by_verticale.items()},
        "campaign_id": effective_campaign,
        "duration_seconds": round(elapsed, 1),
    }
    stats_path = Path("scripts/upload-stats.json")
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)
    print(f"  Stats exported: {stats_path}")


if __name__ == "__main__":
    main()
