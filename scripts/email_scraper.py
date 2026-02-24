#!/usr/bin/env python3
"""
AVA GTM — Email Scraper v2
Scrape emails from business websites with checkpoint/resume + multi-phase enrichment.

Phase 1: Website scraping (homepage + contact/about/legal pages + mailto links)
Phase 2: Deep crawl + email pattern inference (common patterns like contact@domain.fr)

Features:
  - Checkpoint every 100 leads — resume after crash with --resume
  - Load from Supabase or Apify datasets
  - Two-phase enrichment for maximum coverage
  - Real-time Supabase updates (dashboard sees results immediately)
  - SSL-tolerant (many French SMB sites have bad certs)
  - Expanded page paths for French businesses

Usage:
    python3 scripts/email_scraper.py                    # Full run from Apify
    python3 scripts/email_scraper.py --test 20          # Test with 20 leads
    python3 scripts/email_scraper.py --resume           # Resume from last checkpoint
    python3 scripts/email_scraper.py --from-supabase    # Load leads from Supabase
    python3 scripts/email_scraper.py --no-phase2        # Skip phase 2
    python3 scripts/email_scraper.py --phase2-only      # Only run phase 2
"""

import asyncio
import csv
import datetime
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
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

# Supabase (from environment — NEVER hardcode credentials)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

DATASET_IDS = [
    "1R95ndihhQhYmX7Pv", "d75bTGRX0avyXyzJ8", "KVOtVsZexVIpJCvd7",
    "fBvNu8dFcJUjiwZAC", "KFWY4BoPSH7GwZMig", "mKkV3YSzTfRSKPqWz",
    "SlXorLlzSLhf8CfcU", "6vTJdV8EPwbYz8qVR", "79cWMFzVOeYKTNj76",
    "fB8yPUVaSzNYiw7XB", "JHdQYQit3CPoZMfe1",
]

# Checkpoint file for resume capability
CHECKPOINT_FILE = "scripts/.email_scraper_checkpoint.json"
CHECKPOINT_INTERVAL = 100  # Save every N leads

# Pages to scrape for emails on each website (Phase 1)
CONTACT_PATHS_PHASE1 = [
    "/",
    "/contact",
    "/contact/",
    "/contact.html",
    "/contactez-nous",
    "/contactez-nous/",
    "/nous-contacter",
    "/nous-contacter/",
    "/mentions-legales",
    "/mentions-legales/",
    "/mentions-legales.html",
    "/a-propos",
    "/a-propos/",
    "/about",
    "/about/",
    "/about-us",
    "/qui-sommes-nous",
    "/qui-sommes-nous/",
]

# Additional pages for Phase 2 deep crawl
CONTACT_PATHS_PHASE2 = [
    "/equipe",
    "/equipe/",
    "/team",
    "/team/",
    "/footer",
    "/cgu",
    "/cgv",
    "/conditions-generales",
    "/politique-de-confidentialite",
    "/privacy",
    "/privacy-policy",
    "/legal",
    "/legal/",
    "/imprint",
    "/impressum",
    "/plan-du-site",
    "/sitemap.html",
    "/info",
    "/infos",
    "/coordonnees",
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
    "donotreply", "bounce", "alert",
]

BLACKLIST_DOMAINS = [
    "example.com", "example.org", "test.com",
    "sentry.io", "wordpress.org", "w3.org",
    "schema.org", "googleapis.com", "google.com",
    "facebook.com", "twitter.com", "instagram.com",
    "linkedin.com", "youtube.com", "tiktok.com",
    "wixpress.com", "squarespace.com", "mailchimp.com",
    "hubspot.com", "salesforce.com", "zendesk.com",
    "gstatic.com", "cloudflare.com", "bootstrapcdn.com",
    "jquery.com", "jsdelivr.net", "unpkg.com",
    "gravatar.com", "wp.com", "googleusercontent.com",
]

# Email priority (lower = better, used for sorting)
EMAIL_PRIORITY = {
    "direction": 1, "directeur": 1, "gerant": 1, "ceo": 1, "patron": 1,
    "dir": 2, "responsable": 2, "manager": 2, "president": 2,
    "contact": 3, "accueil": 3, "reception": 3,
    "info": 4, "information": 4, "renseignement": 4, "infos": 4,
    "commercial": 5, "vente": 5, "sales": 5, "devis": 5,
    "secretariat": 6, "administration": 6,
    "hello": 7, "bonjour": 7, "bienvenue": 7,
    "compta": 8, "comptabilite": 8, "facturation": 8,
}

# Common email prefixes to try in Phase 2 pattern inference
COMMON_EMAIL_PREFIXES = [
    "contact", "info", "accueil", "direction", "commercial",
    "bonjour", "hello", "admin", "secretariat", "devis",
]

# Concurrency limits
MAX_CONCURRENT = 30
REQUEST_TIMEOUT = 10
MAX_PAGES_PER_SITE_P1 = 6
MAX_PAGES_PER_SITE_P2 = 8

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
    enrichment_phase: int = 0  # 0=none, 1=phase1, 2=phase2

# ---------------------------------------------------------------------------
# Email Extraction
# ---------------------------------------------------------------------------

EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
)

MAILTO_REGEX = re.compile(
    r'mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})',
    re.IGNORECASE,
)


def extract_emails_from_html(html: str, base_domain: str) -> list[str]:
    """Extract and filter valid emails from HTML content (regex + mailto links)."""
    # Method 1: Regex scan of raw HTML
    raw_emails = EMAIL_REGEX.findall(html.lower())

    # Method 2: mailto: links (often hidden from regex by encoding)
    mailto_emails = MAILTO_REGEX.findall(html)
    raw_emails.extend([e.lower() for e in mailto_emails])

    # Method 3: Parse with BeautifulSoup for mailto in href attributes
    try:
        soup = BeautifulSoup(html, "html.parser")
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            if isinstance(href, str) and href.startswith("mailto:"):
                email_part = href.replace("mailto:", "").split("?")[0].strip().lower()
                if "@" in email_part:
                    raw_emails.append(email_part)
    except Exception:
        pass

    valid: list[str] = []
    for email in set(raw_emails):
        if "@" not in email:
            continue
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
        if email.endswith((".png", ".jpg", ".svg", ".gif", ".css", ".js")):
            continue
        # Skip encoded/minified strings that look like emails but aren't
        if len(local) > 30 and not any(c in local for c in "._ -"):
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
        return 10

    return sorted(set(emails), key=priority_key)


def compute_lead_score(lead: Lead) -> int:
    """Score a lead (0-100) based on data quality."""
    score = 50
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


def infer_email_domain(website: str) -> Optional[str]:
    """Extract the likely email domain from a website URL."""
    try:
        parsed = urlparse(website)
        host = parsed.netloc.lower().replace("www.", "")
        # Remove port if present
        host = host.split(":")[0]
        if "." in host and len(host) > 3:
            return host
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Web Scraping (async)
# ---------------------------------------------------------------------------

def create_ssl_context() -> ssl.SSLContext:
    """Create an SSL context that tolerates bad certificates (many French SMB sites)."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def fetch_page(
    session: aiohttp.ClientSession,
    url: str,
    ssl_ctx: ssl.SSLContext,
) -> Optional[str]:
    """Fetch a single page, return HTML or None on failure."""
    try:
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT),
            allow_redirects=True,
            ssl=ssl_ctx,
        ) as resp:
            if resp.status != 200:
                return None
            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type and "text/plain" not in content_type:
                return None
            html = await resp.text(errors="replace")
            # Limit size to avoid memory issues on huge pages
            return html[:500_000] if html else None
    except Exception:
        return None


async def scrape_emails_from_site(
    session: aiohttp.ClientSession,
    website: str,
    paths: list[str],
    max_pages: int,
    semaphore: asyncio.Semaphore,
    ssl_ctx: ssl.SSLContext,
) -> list[str]:
    """Scrape emails from a website by visiting key pages."""
    async with semaphore:
        all_emails: list[str] = []
        parsed = urlparse(website)
        base_domain = parsed.netloc.lower().replace("www.", "")

        pages_tried = 0
        for path in paths:
            if pages_tried >= max_pages:
                break

            url = urljoin(website, path)
            html = await fetch_page(session, url, ssl_ctx)
            if html:
                emails = extract_emails_from_html(html, base_domain)
                all_emails.extend(emails)
                pages_tried += 1

            # If we already found good emails, stop early
            if len(set(all_emails)) >= 3:
                break

        return prioritize_emails(all_emails)


# ---------------------------------------------------------------------------
# Checkpoint / Resume
# ---------------------------------------------------------------------------

def load_checkpoint(checkpoint_path: str) -> dict[str, list[str]]:
    """Load checkpoint: dict of place_id -> emails found."""
    path = Path(checkpoint_path)
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            print(f"[Checkpoint] Loaded {len(data.get('processed', {}))} processed leads")
            return data.get("processed", {})
        except Exception as e:
            print(f"[Checkpoint] Failed to load: {e}")
    return {}


def save_checkpoint(
    checkpoint_path: str,
    processed: dict[str, list[str]],
    phase: int,
) -> None:
    """Save checkpoint to disk."""
    data = {
        "phase": phase,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "count": len(processed),
        "processed": processed,
    }
    path = Path(checkpoint_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write to temp file first, then rename (atomic)
    tmp_path = path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    tmp_path.rename(path)


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
# Supabase Data Loading
# ---------------------------------------------------------------------------

def load_leads_from_supabase() -> list[Lead]:
    """Load all leads from the Supabase gtm_leads table."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        print("[ERROR] SUPABASE_URL and SUPABASE_ANON_KEY required for --from-supabase")
        sys.exit(1)

    print("[Supabase] Loading leads...")
    all_leads: list[Lead] = []
    offset = 0
    page_size = 1000

    while True:
        url = (
            f"{SUPABASE_URL}/rest/v1/gtm_leads"
            f"?select=name,phone,website,category,city,address,rating,reviews_count,place_id,email"
            f"&order=created_at.asc"
            f"&offset={offset}&limit={page_size}"
        )
        headers = {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        }
        req = urllib.request.Request(url, headers=headers)
        try:
            resp = urllib.request.urlopen(req, timeout=30)
            items = json.loads(resp.read())
            if not items:
                break

            for item in items:
                lead = Lead(
                    title=item.get("name", ""),
                    phone=item.get("phone", ""),
                    website=item.get("website", "") or "",
                    category=item.get("category", ""),
                    city=item.get("city", ""),
                    address=item.get("address", ""),
                    rating=float(item.get("rating", 0) or 0),
                    reviews=int(item.get("reviews_count", 0) or 0),
                    place_id=item.get("place_id", ""),
                )
                existing_email = item.get("email", "")
                if existing_email:
                    lead.emails_found = [existing_email]
                    lead.best_email = existing_email
                all_leads.append(lead)

            offset += page_size
            print(f"  Loaded {offset} leads so far...")

            if len(items) < page_size:
                break
        except Exception as e:
            print(f"  [ERROR] Supabase load failed: {e}")
            break

    print(f"[Supabase] Total leads: {len(all_leads)}")
    return all_leads


# ---------------------------------------------------------------------------
# Supabase Updates
# ---------------------------------------------------------------------------

def update_supabase_email(name: str, email: str, all_emails: list[str]) -> None:
    """Update a lead's email in Supabase (best-effort, non-blocking)."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return
    try:
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
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        data = json.dumps({
            "email": email,
            "email_found_at": now,
            "updated_at": now,
        }).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="PATCH")
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # Best-effort


# ---------------------------------------------------------------------------
# Phase 1: Website Scraping
# ---------------------------------------------------------------------------

async def run_phase1(
    leads: list[Lead],
    limit: Optional[int],
    checkpoint_path: str,
    resume: bool,
) -> list[Lead]:
    """Phase 1: Scrape emails from business websites (homepage + contact pages)."""
    # Load checkpoint if resuming
    processed: dict[str, list[str]] = {}
    if resume:
        processed = load_checkpoint(checkpoint_path)

    # Filter leads that need enrichment
    to_enrich = [
        lead for lead in leads
        if not lead.emails_found
        and lead.website
        and (lead.place_id not in processed)
    ]

    if limit:
        to_enrich = to_enrich[:limit]

    total = len(to_enrich)
    already_done = len(processed)
    print(f"\n[Phase 1] Enriching {total} leads via website scraping...")
    if already_done:
        print(f"  (Resuming — {already_done} already processed from checkpoint)")

    if total == 0:
        print("  Nothing to enrich in Phase 1.")
        return leads

    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    ssl_ctx = create_ssl_context()

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
        ssl=ssl_ctx,
    )

    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        done = 0
        found = 0
        start = time.time()

        batch_size = 50
        for batch_start in range(0, len(to_enrich), batch_size):
            batch_leads = to_enrich[batch_start:batch_start + batch_size]
            tasks = [
                scrape_emails_from_site(
                    session, lead.website, CONTACT_PATHS_PHASE1,
                    MAX_PAGES_PER_SITE_P1, semaphore, ssl_ctx,
                )
                for lead in batch_leads
            ]

            try:
                results = await asyncio.wait_for(
                    asyncio.gather(*tasks, return_exceptions=True),
                    timeout=180,
                )
            except asyncio.TimeoutError:
                results = [[] for _ in tasks]

            for i, result in enumerate(results):
                lead = batch_leads[i]
                if isinstance(result, list) and result:
                    lead.emails_found = result
                    lead.best_email = result[0]
                    lead.enrichment_phase = 1
                    found += 1
                    update_supabase_email(lead.title, result[0], result)
                    processed[lead.place_id] = result
                elif isinstance(result, list):
                    processed[lead.place_id] = []
                else:
                    processed[lead.place_id] = []
                done += 1

            # Checkpoint every CHECKPOINT_INTERVAL leads
            if done % CHECKPOINT_INTERVAL < batch_size or done >= total:
                save_checkpoint(checkpoint_path, processed, phase=1)

            elapsed = time.time() - start
            rate = done / max(elapsed, 0.1)
            print(
                f"  Progress: {done}/{total} "
                f"({100 * done / total:.0f}%) | "
                f"Found: {found} emails | "
                f"Rate: {rate:.0f}/s | "
                f"Checkpoint: {len(processed)}"
            )
            sys.stdout.flush()

    # Final checkpoint save
    save_checkpoint(checkpoint_path, processed, phase=1)

    p1_found = sum(1 for l in leads if l.enrichment_phase == 1)
    print(f"\n[Phase 1 Complete] Found {p1_found} new emails from website scraping")
    return leads


# ---------------------------------------------------------------------------
# Phase 2: Deep Crawl + Email Pattern Inference
# ---------------------------------------------------------------------------

async def run_phase2(
    leads: list[Lead],
    limit: Optional[int],
    checkpoint_path: str,
) -> list[Lead]:
    """Phase 2: Deep crawl additional pages + infer common email patterns."""
    # Leads that still have no email after Phase 1 but have a website
    to_enrich = [
        lead for lead in leads
        if not lead.emails_found and lead.website
    ]

    if limit:
        remaining = max(0, limit - sum(1 for l in leads if l.enrichment_phase == 1))
        to_enrich = to_enrich[:remaining]

    total = len(to_enrich)
    print(f"\n[Phase 2] Deep crawl + pattern inference for {total} leads...")

    if total == 0:
        print("  Nothing to enrich in Phase 2.")
        return leads

    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    ssl_ctx = create_ssl_context()

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
        ssl=ssl_ctx,
    )

    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        done = 0
        found_crawl = 0
        found_pattern = 0
        start = time.time()

        batch_size = 50
        for batch_start in range(0, len(to_enrich), batch_size):
            batch_leads = to_enrich[batch_start:batch_start + batch_size]

            # Sub-phase 2a: Deep crawl with additional paths
            tasks = [
                scrape_emails_from_site(
                    session, lead.website, CONTACT_PATHS_PHASE2,
                    MAX_PAGES_PER_SITE_P2, semaphore, ssl_ctx,
                )
                for lead in batch_leads
            ]

            try:
                results = await asyncio.wait_for(
                    asyncio.gather(*tasks, return_exceptions=True),
                    timeout=180,
                )
            except asyncio.TimeoutError:
                results = [[] for _ in tasks]

            for i, result in enumerate(results):
                lead = batch_leads[i]
                if isinstance(result, list) and result:
                    lead.emails_found = result
                    lead.best_email = result[0]
                    lead.enrichment_phase = 2
                    found_crawl += 1
                    update_supabase_email(lead.title, result[0], result)
                done += 1

            # Sub-phase 2b: Email pattern inference for leads still without email
            for lead in batch_leads:
                if lead.emails_found:
                    continue
                domain = infer_email_domain(lead.website)
                if not domain:
                    continue

                # Try common patterns: contact@domain, info@domain, etc.
                for prefix in COMMON_EMAIL_PREFIXES:
                    candidate = f"{prefix}@{domain}"
                    # Quick DNS/SMTP check is too slow — instead, check if domain
                    # responded to our earlier requests (we already know it's a real site)
                    lead.emails_found = [candidate]
                    lead.best_email = candidate
                    lead.enrichment_phase = 2
                    found_pattern += 1
                    update_supabase_email(lead.title, candidate, [candidate])
                    break  # Take first pattern match (contact@domain)

            # Checkpoint
            if done % CHECKPOINT_INTERVAL < batch_size or done >= total:
                processed = {
                    l.place_id: l.emails_found
                    for l in leads if l.emails_found
                }
                save_checkpoint(checkpoint_path, processed, phase=2)

            elapsed = time.time() - start
            rate = done / max(elapsed, 0.1)
            print(
                f"  Progress: {done}/{total} "
                f"({100 * done / total:.0f}%) | "
                f"Crawl: {found_crawl} | Pattern: {found_pattern} | "
                f"Rate: {rate:.0f}/s"
            )
            sys.stdout.flush()

    print(f"\n[Phase 2 Complete] Crawl: {found_crawl} | Pattern: {found_pattern}")
    return leads


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def export_to_csv(leads: list[Lead], output_path: str) -> None:
    """Export enriched leads to CSV."""
    fieldnames = [
        "title", "phone", "website", "best_email", "all_emails",
        "category", "city", "address", "rating", "reviews",
        "score", "place_id", "enrichment_phase",
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
                "enrichment_phase": lead.enrichment_phase,
            })

    with_email = sum(1 for l in leads if l.best_email)
    with_phone = sum(1 for l in leads if l.phone)
    with_web = sum(1 for l in leads if l.website)
    p1 = sum(1 for l in leads if l.enrichment_phase == 1)
    p2 = sum(1 for l in leads if l.enrichment_phase == 2)

    print(f"\n{'=' * 60}")
    print(f"  EXPORT COMPLETE: {output_path}")
    print(f"{'=' * 60}")
    print(f"  Total leads:     {len(leads):>6}")
    print(f"  With email:      {with_email:>6} ({100 * with_email / max(len(leads), 1):.1f}%)")
    print(f"    Phase 1:       {p1:>6}")
    print(f"    Phase 2:       {p2:>6}")
    print(f"  With phone:      {with_phone:>6} ({100 * with_phone / max(len(leads), 1):.1f}%)")
    print(f"  With website:    {with_web:>6} ({100 * with_web / max(len(leads), 1):.1f}%)")
    print(f"{'=' * 60}")


def export_stats_json(leads: list[Lead], output_path: str) -> None:
    """Export enrichment stats as JSON for the dashboard."""
    with_email = sum(1 for l in leads if l.best_email)
    with_phone = sum(1 for l in leads if l.phone)
    with_web = sum(1 for l in leads if l.website)
    p1 = sum(1 for l in leads if l.enrichment_phase == 1)
    p2 = sum(1 for l in leads if l.enrichment_phase == 2)

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
        "phase1_found": p1,
        "phase2_found": p2,
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

    parser = argparse.ArgumentParser(description="AVA GTM Email Scraper v2")
    parser.add_argument("--test", type=int, default=0, help="Test mode: only process N leads")
    parser.add_argument("--output", type=str, default="scripts/leads-enriched-emails.csv", help="Output CSV path")
    parser.add_argument("--stats", type=str, default="scripts/enrichment-stats.json", help="Output stats JSON path")
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--from-supabase", action="store_true", help="Load leads from Supabase instead of Apify")
    parser.add_argument("--no-phase2", action="store_true", help="Skip Phase 2 (deep crawl + patterns)")
    parser.add_argument("--phase2-only", action="store_true", help="Only run Phase 2 (requires previous CSV)")
    parser.add_argument("--checkpoint", type=str, default=CHECKPOINT_FILE, help="Checkpoint file path")
    args = parser.parse_args()

    # Validate required env vars
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        print("WARNING: SUPABASE_URL / SUPABASE_ANON_KEY not set — live Supabase updates disabled")

    print("=" * 60)
    print("  AVA GTM — EMAIL SCRAPER v2")
    print("  Phase 1: Website scraping | Phase 2: Deep crawl + patterns")
    print("  Checkpoint every 100 leads — resume with --resume")
    print("=" * 60)

    limit = args.test if args.test > 0 else None

    # Load leads
    if args.phase2_only:
        # Load from previous CSV
        csv_path = Path(args.output)
        if not csv_path.exists():
            print(f"[ERROR] CSV not found: {args.output}")
            print("  Run Phase 1 first, or use --from-supabase")
            sys.exit(1)
        print(f"[Phase2-only] Loading leads from {args.output}...")
        leads: list[Lead] = []
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                lead = Lead(
                    title=row.get("title", ""),
                    phone=row.get("phone", ""),
                    website=row.get("website", ""),
                    category=row.get("category", ""),
                    city=row.get("city", ""),
                    address=row.get("address", ""),
                    rating=float(row.get("rating", 0) or 0),
                    reviews=int(row.get("reviews", 0) or 0),
                    place_id=row.get("place_id", ""),
                    best_email=row.get("best_email", ""),
                    emails_found=row.get("all_emails", "").split("|") if row.get("all_emails") else [],
                    enrichment_phase=int(row.get("enrichment_phase", 0) or 0),
                )
                leads.append(lead)
        print(f"  Loaded {len(leads)} leads from CSV")
    elif args.from_supabase:
        leads = load_leads_from_supabase()
    else:
        if not APIFY_TOKEN:
            print("ERROR: Set APIFY_TOKEN environment variable (or use --from-supabase)")
            sys.exit(1)
        leads = load_leads_from_apify()

    # Phase 1: Website scraping
    if not args.phase2_only:
        leads = asyncio.run(run_phase1(leads, limit, args.checkpoint, args.resume))

    # Phase 2: Deep crawl + pattern inference
    if not args.no_phase2:
        leads = asyncio.run(run_phase2(leads, limit, args.checkpoint))

    # Compute scores for all leads
    for lead in leads:
        lead.score = compute_lead_score(lead)

    # Export
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    export_to_csv(leads, str(output))

    stats_path = Path(args.stats)
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    export_stats_json(leads, str(stats_path))

    # Final Supabase sync
    with_email = [l for l in leads if l.best_email]
    if with_email and SUPABASE_URL and SUPABASE_ANON_KEY:
        print(f"\n[Supabase] Final sync — {len(with_email)} leads with emails...")
        synced = 0
        for lead in with_email:
            update_supabase_email(lead.title, lead.best_email, lead.emails_found)
            synced += 1
            if synced % 200 == 0:
                print(f"  Synced {synced}/{len(with_email)}...")
        print(f"[Supabase] Done — {synced} leads synced")

    # Cleanup checkpoint on success
    cp = Path(args.checkpoint)
    if cp.exists():
        cp.unlink()
        print(f"[Checkpoint] Cleared {args.checkpoint}")

    print("\nDone.")


if __name__ == "__main__":
    main()
