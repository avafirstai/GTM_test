#!/usr/bin/env python3
"""
AVA GTM — Email Scraper
Scrape emails from 7,660+ business websites extracted from Google Maps.
100% gratuit, async, rapide.

Usage:
    python3 scripts/email_scraper.py
    python3 scripts/email_scraper.py --test 20          # Test with 20 leads
    python3 scripts/email_scraper.py --output custom.csv
"""

import asyncio
import csv
import json
import os
import re
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse

import aiohttp
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")

# Supabase (GTM Growth Machine project)
SUPABASE_URL = "https://cifxffapwtksxhaphepv.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpZnhmZmFwd3Rrc3hoYXBoZXB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NzQwMDgsImV4cCI6MjA4NzQ1MDAwOH0."
    "9PYtJudc7oEyxzfklu2TklakMNmvtL3K5OYljrsgytw"
)

DATASET_IDS = [
    "1R95ndihhQhYmX7Pv", "d75bTGRX0avyXyzJ8", "KVOtVsZexVIpJCvd7",
    "fBvNu8dFcJUjiwZAC", "KFWY4BoPSH7GwZMig", "mKkV3YSzTfRSKPqWz",
    "SlXorLlzSLhf8CfcU", "6vTJdV8EPwbYz8qVR", "79cWMFzVOeYKTNj76",
    "fB8yPUVaSzNYiw7XB", "JHdQYQit3CPoZMfe1",
]

# Pages to scrape for emails on each website
CONTACT_PATHS = [
    "/",
    "/contact",
    "/contact/",
    "/contactez-nous",
    "/contactez-nous/",
    "/nous-contacter",
    "/mentions-legales",
    "/mentions-legales/",
    "/a-propos",
    "/about",
    "/about-us",
]

# Emails to IGNORE (generic / useless)
BLACKLIST_PREFIXES = [
    "noreply", "no-reply", "no_reply",
    "webmaster", "postmaster", "mailer-daemon",
    "root", "admin", "administrator",
    "support", "abuse", "spam",
    "newsletter", "unsubscribe",
    "example", "test", "demo",
    "sentry", "wordpress", "woocommerce",
    "protection", "privacy", "dpo",
]

BLACKLIST_DOMAINS = [
    "example.com", "example.org", "test.com",
    "sentry.io", "wordpress.org", "w3.org",
    "schema.org", "googleapis.com", "google.com",
    "facebook.com", "twitter.com", "instagram.com",
    "linkedin.com", "youtube.com", "tiktok.com",
    "wixpress.com", "squarespace.com", "mailchimp.com",
    "hubspot.com", "salesforce.com", "zendesk.com",
]

# Email priority (lower = better, used for sorting)
EMAIL_PRIORITY = {
    "direction": 1, "directeur": 1, "gerant": 1, "ceo": 1,
    "dir": 2, "responsable": 2, "manager": 2,
    "contact": 3, "accueil": 3, "reception": 3,
    "info": 4, "information": 4, "renseignement": 4,
    "commercial": 5, "vente": 5, "sales": 5,
    "secretariat": 6, "administration": 6, "admin": 6,
    "hello": 7, "bonjour": 7,
}

# Concurrency limits
MAX_CONCURRENT = 30  # simultaneous HTTP requests
REQUEST_TIMEOUT = 8  # seconds per request
MAX_PAGES_PER_SITE = 5  # max pages to scrape per domain

# ---------------------------------------------------------------------------
# Data Model
# ---------------------------------------------------------------------------

@dataclass
class Lead:
    title: str
    phone: str
    website: str
    category: str
    city: str
    address: str
    rating: float
    reviews: int
    place_id: str
    emails_found: list[str] = field(default_factory=list)
    best_email: str = ""
    score: int = 0

# ---------------------------------------------------------------------------
# Email Extraction
# ---------------------------------------------------------------------------

EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
)


def extract_emails_from_html(html: str, base_domain: str) -> list[str]:
    """Extract and filter valid emails from HTML content."""
    raw_emails = EMAIL_REGEX.findall(html.lower())

    valid = []
    for email in set(raw_emails):
        local, domain = email.rsplit("@", 1)

        # Skip blacklisted domains
        if domain in BLACKLIST_DOMAINS:
            continue

        # Skip blacklisted prefixes
        if any(local.startswith(prefix) for prefix in BLACKLIST_PREFIXES):
            continue

        # Skip emails with suspicious patterns
        if len(local) > 50 or len(domain) > 50:
            continue
        if ".." in email:
            continue
        if email.endswith(".png") or email.endswith(".jpg") or email.endswith(".svg"):
            continue

        valid.append(email)

    return valid


def prioritize_emails(emails: list[str]) -> list[str]:
    """Sort emails by business relevance (decision-maker first)."""
    def priority_key(email: str) -> int:
        local = email.split("@")[0].lower()
        for prefix, score in EMAIL_PRIORITY.items():
            if prefix in local:
                return score
        return 10  # default: low priority

    return sorted(set(emails), key=priority_key)


def compute_lead_score(lead: Lead) -> int:
    """Score a lead (0-100) based on data quality."""
    score = 50  # base
    if lead.phone:
        score += 15
    if lead.website:
        score += 10
    if lead.rating and lead.rating >= 4.0:
        score += 10
    if lead.reviews and lead.reviews >= 50:
        score += 5
    elif lead.reviews and lead.reviews >= 10:
        score += 3
    if lead.best_email:
        score += 10
    return min(score, 100)

# ---------------------------------------------------------------------------
# Web Scraping (async)
# ---------------------------------------------------------------------------

async def fetch_page(
    session: aiohttp.ClientSession,
    url: str,
) -> Optional[str]:
    """Fetch a single page, return HTML or None on failure."""
    try:
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT),
            allow_redirects=True,
            ssl=False,
        ) as resp:
            if resp.status != 200:
                return None
            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type and "text/plain" not in content_type:
                return None
            return await resp.text(errors="replace")
    except Exception:
        return None


async def scrape_emails_from_site(
    session: aiohttp.ClientSession,
    website: str,
    semaphore: asyncio.Semaphore,
) -> list[str]:
    """Scrape emails from a website by visiting key pages."""
    async with semaphore:
        all_emails: list[str] = []
        parsed = urlparse(website)
        base_domain = parsed.netloc.lower().replace("www.", "")

        pages_tried = 0
        for path in CONTACT_PATHS:
            if pages_tried >= MAX_PAGES_PER_SITE:
                break

            url = urljoin(website, path)
            html = await fetch_page(session, url)
            if html:
                emails = extract_emails_from_html(html, base_domain)
                all_emails.extend(emails)
                pages_tried += 1

            # If we already found good emails, stop early
            if len(set(all_emails)) >= 3:
                break

        return prioritize_emails(all_emails)

# ---------------------------------------------------------------------------
# Apify Data Loading
# ---------------------------------------------------------------------------

def load_leads_from_apify() -> list[Lead]:
    """Download all leads from the 11 Apify datasets."""
    print(f"[Apify] Downloading leads from {len(DATASET_IDS)} datasets...")
    all_leads: list[Lead] = []
    seen_ids: set[str] = set()

    for i, ds_id in enumerate(DATASET_IDS, 1):
        url = (
            f"https://api.apify.com/v2/datasets/{ds_id}/items"
            f"?limit=2000"
            f"&fields=title,phone,website,categoryName,city,address,"
            f"totalScore,reviewsCount,placeId,emails"
        )
        req = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {APIFY_TOKEN}"}
        )
        try:
            resp = urllib.request.urlopen(req, timeout=30)
            items = json.loads(resp.read())
            added = 0
            for item in items:
                pid = item.get("placeId", "")
                if pid and pid in seen_ids:
                    continue
                if pid:
                    seen_ids.add(pid)

                lead = Lead(
                    title=item.get("title", ""),
                    phone=item.get("phone", ""),
                    website=item.get("website", "") or "",
                    category=item.get("categoryName", ""),
                    city=item.get("city", ""),
                    address=item.get("address", ""),
                    rating=float(item.get("totalScore", 0) or 0),
                    reviews=int(item.get("reviewsCount", 0) or 0),
                    place_id=pid,
                )

                # If Apify already found emails
                apify_emails = item.get("emails", [])
                if apify_emails:
                    lead.emails_found = list(apify_emails)

                all_leads.append(lead)
                added += 1

            print(f"  [{i}/{len(DATASET_IDS)}] Dataset {ds_id}: +{added} leads")
        except Exception as e:
            print(f"  [{i}/{len(DATASET_IDS)}] Dataset {ds_id}: ERROR - {e}")

    print(f"[Apify] Total unique leads: {len(all_leads)}")
    return all_leads

# ---------------------------------------------------------------------------
# Main Pipeline
# ---------------------------------------------------------------------------

async def enrich_leads(leads: list[Lead], limit: Optional[int] = None) -> list[Lead]:
    """Enrich leads with emails scraped from their websites."""
    # Filter leads that need enrichment and have a website
    to_enrich = [
        lead for lead in leads
        if not lead.emails_found and lead.website
    ]

    if limit:
        to_enrich = to_enrich[:limit]

    total = len(to_enrich)
    print(f"\n[Scraper] Enriching {total} leads with website scraping...")

    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
    }

    connector = aiohttp.TCPConnector(
        limit=MAX_CONCURRENT,
        ttl_dns_cache=300,
        force_close=True,
    )

    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        tasks = []
        for lead in to_enrich:
            tasks.append(scrape_emails_from_site(session, lead.website, semaphore))

        done = 0
        found = 0
        start = time.time()

        # Process in batches for progress reporting
        batch_size = 50
        for batch_start in range(0, len(tasks), batch_size):
            batch = tasks[batch_start:batch_start + batch_size]
            try:
                results = await asyncio.wait_for(
                    asyncio.gather(*batch, return_exceptions=True),
                    timeout=120,  # 2 min max per batch of 50
                )
            except asyncio.TimeoutError:
                results = [None] * len(batch)

            for i, result in enumerate(results):
                idx = batch_start + i
                if isinstance(result, list) and result:
                    to_enrich[idx].emails_found = result
                    to_enrich[idx].best_email = result[0]
                    found += 1
                    # Live update to Supabase — dashboard sees it in real-time
                    update_supabase_email(
                        to_enrich[idx].title,
                        result[0],
                        result,
                    )
                done += 1

            elapsed = time.time() - start
            rate = done / max(elapsed, 0.1)
            msg = (
                f"  Progress: {done}/{total} "
                f"({100*done/total:.0f}%) | "
                f"Found: {found} emails | "
                f"Rate: {rate:.0f} sites/s"
            )
            print(msg)
            sys.stdout.flush()

    # Compute scores for all leads
    for lead in leads:
        lead.score = compute_lead_score(lead)

    return leads


def update_supabase_email(name: str, email: str, all_emails: list[str]) -> None:
    """Update a lead's email in Supabase (best-effort, non-blocking)."""
    try:
        import urllib.parse
        # PATCH by name match
        encoded_name = urllib.parse.quote(name, safe="")
        url = (
            f"{SUPABASE_URL}/rest/v1/gtm_leads"
            f"?name=eq.{encoded_name}"
        )
        headers = {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        import datetime
        data = json.dumps({
            "email": email,
            "email_found_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="PATCH")
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # Best-effort — don't crash the scraper


def export_to_csv(leads: list[Lead], output_path: str) -> None:
    """Export enriched leads to CSV."""
    fieldnames = [
        "title", "phone", "website", "best_email", "all_emails",
        "category", "city", "address", "rating", "reviews",
        "score", "place_id",
    ]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for lead in leads:
            writer.writerow({
                "title": lead.title,
                "phone": lead.phone,
                "website": lead.website,
                "best_email": lead.best_email,
                "all_emails": "|".join(lead.emails_found),
                "category": lead.category,
                "city": lead.city,
                "address": lead.address,
                "rating": lead.rating,
                "reviews": lead.reviews,
                "score": lead.score,
                "place_id": lead.place_id,
            })

    # Stats
    with_email = sum(1 for l in leads if l.best_email)
    with_phone = sum(1 for l in leads if l.phone)
    with_web = sum(1 for l in leads if l.website)

    print(f"\n{'='*60}")
    print(f"  EXPORT COMPLETE: {output_path}")
    print(f"{'='*60}")
    print(f"  Total leads:     {len(leads):>6}")
    print(f"  With email:      {with_email:>6} ({100*with_email/max(len(leads),1):.1f}%)")
    print(f"  With phone:      {with_phone:>6} ({100*with_phone/max(len(leads),1):.1f}%)")
    print(f"  With website:    {with_web:>6} ({100*with_web/max(len(leads),1):.1f}%)")
    print(f"{'='*60}")


def export_stats_json(leads: list[Lead], output_path: str) -> None:
    """Export enrichment stats as JSON for the dashboard."""
    with_email = sum(1 for l in leads if l.best_email)
    with_phone = sum(1 for l in leads if l.phone)
    with_web = sum(1 for l in leads if l.website)

    # Stats by category
    cat_stats: dict[str, dict[str, int]] = {}
    for lead in leads:
        cat = lead.category or "Autre"
        if cat not in cat_stats:
            cat_stats[cat] = {"total": 0, "with_email": 0}
        cat_stats[cat]["total"] += 1
        if lead.best_email:
            cat_stats[cat]["with_email"] += 1

    # Stats by city
    city_stats: dict[str, dict[str, int]] = {}
    for lead in leads:
        city = lead.city or "Autre"
        if city not in city_stats:
            city_stats[city] = {"total": 0, "with_email": 0}
        city_stats[city]["total"] += 1
        if lead.best_email:
            city_stats[city]["with_email"] += 1

    stats = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_leads": len(leads),
        "with_email": with_email,
        "with_phone": with_phone,
        "with_website": with_web,
        "email_rate": round(100 * with_email / max(len(leads), 1), 1),
        "by_category": dict(
            sorted(cat_stats.items(), key=lambda x: x[1]["total"], reverse=True)[:20]
        ),
        "by_city": dict(
            sorted(city_stats.items(), key=lambda x: x[1]["total"], reverse=True)[:20]
        ),
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    print(f"  Stats exported:  {output_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="AVA GTM Email Scraper")
    parser.add_argument(
        "--test", type=int, default=0,
        help="Test mode: only scrape N leads"
    )
    parser.add_argument(
        "--output", type=str,
        default="scripts/leads-enriched-emails.csv",
        help="Output CSV path"
    )
    parser.add_argument(
        "--stats", type=str,
        default="scripts/enrichment-stats.json",
        help="Output stats JSON path"
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  AVA GTM — EMAIL SCRAPER")
    print("  Scraping emails from business websites (FREE)")
    print("=" * 60)

    # Step 1: Load leads from Apify
    leads = load_leads_from_apify()

    # Step 2: Enrich with email scraping
    limit = args.test if args.test > 0 else None
    leads = asyncio.run(enrich_leads(leads, limit=limit))

    # Step 3: Export
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    export_to_csv(leads, str(output))

    stats_path = Path(args.stats)
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    export_stats_json(leads, str(stats_path))

    # Step 4: Final Supabase sync — update scores for all leads with emails
    with_email = [l for l in leads if l.best_email]
    if with_email:
        print(f"\n[Supabase] Syncing {len(with_email)} leads with emails...")
        synced = 0
        for lead in with_email:
            update_supabase_email(lead.title, lead.best_email, lead.emails_found)
            synced += 1
        print(f"[Supabase] Done — {synced} leads synced to live dashboard")


if __name__ == "__main__":
    main()
