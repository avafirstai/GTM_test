#!/usr/bin/env python3
"""
AVA GTM -- Google Maps Website Scraper (Playwright)
Scrape business NAMES + WEBSITES from Google Maps search results.

NOTE: For bulk scraping (1000+ leads), prefer the Apify Google Maps actor
which is more reliable and already produced our 8,360 lead dataset.
This script is useful for small targeted scrapes (< 200 results).

Usage:
    python3 scripts/google_maps_scraper.py --verticale dentiste --ville Paris --limit 20
    python3 scripts/google_maps_scraper.py --all --villes 10 --limit 30
    python3 scripts/google_maps_scraper.py --list-verticales

Requirements:
    pip install playwright
    python3 -m playwright install chromium
"""

import argparse
import csv
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright, Page, Browser, TimeoutError as PwTimeout

REQUEST_TIMEOUT = 15_000
DELAY_BETWEEN = 2

FRENCH_CITIES = [
    "Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes",
    "Strasbourg", "Montpellier", "Bordeaux", "Lille", "Rennes",
    "Reims", "Saint-Etienne", "Toulon", "Le Havre", "Grenoble",
    "Dijon", "Angers", "Nimes", "Villeurbanne", "Clermont-Ferrand",
    "Le Mans", "Aix-en-Provence", "Brest", "Tours", "Amiens",
    "Limoges", "Perpignan", "Metz", "Besancon", "Orleans",
    "Rouen", "Mulhouse", "Caen", "Nancy", "Avignon",
]

VERTICALE_QUERIES: dict[str, list[str]] = {
    "dentiste": ["dentiste"],
    "medecin": ["medecin generaliste"],
    "immobilier": ["agence immobiliere"],
    "avocat": ["avocat"],
    "comptable": ["expert comptable"],
    "formation": ["centre de formation"],
    "coiffeur": ["salon de coiffure"],
    "beaute": ["institut de beaute"],
    "restaurant": ["restaurant"],
    "veterinaire": ["veterinaire"],
    "plombier": ["plombier"],
    "electricien": ["electricien"],
    "garage": ["garage automobile"],
    "auto_ecole": ["auto ecole"],
    "architecte": ["architecte"],
    "kine": ["kinesitherapeute"],
    "osteopathe": ["osteopathe"],
    "opticien": ["opticien"],
    "pharmacie": ["pharmacie"],
    "assurance": ["courtier assurance"],
}


@dataclass
class ScrapedBusiness:
    nom_entreprise: str = ""
    telephone: str = ""
    adresse: str = ""
    ville: str = ""
    website: str = ""
    verticale: str = ""
    source: str = ""


def create_browser(pw: object) -> Browser:
    return pw.chromium.launch(
        headless=True,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    )


def new_page(browser: Browser) -> Page:
    ctx = browser.new_context(
        locale="fr-FR",
        timezone_id="Europe/Paris",
        viewport={"width": 1280, "height": 800},
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
    )
    return ctx.new_page()


def _extract_website_from_detail(page: Page) -> str:
    """Extract website URL from Google Maps detail panel using multiple strategies."""
    # Strategy 1: Look for website link by aria-label pattern
    for selector in [
        "a[data-item-id='authority']",
        "a[aria-label*='site Web']",
        "a[aria-label*='Website']",
        "a[aria-label*='site web']",
    ]:
        el = page.query_selector(selector)
        if el:
            href = el.get_attribute("href") or ""
            if href and "google" not in href and not href.startswith("/"):
                return href

    # Strategy 2: Find links in the info section that look like websites
    # Google Maps shows website links with a globe icon
    links = page.query_selector_all("a[href^='http']")
    for link in links:
        href = link.get_attribute("href") or ""
        # Skip Google/social/maps links
        if any(skip in href for skip in [
            "google.com", "google.fr", "maps.app",
            "facebook.com", "instagram.com", "twitter.com",
            "linkedin.com", "youtube.com", "tripadvisor",
        ]):
            continue
        # Must look like a real website
        if re.match(r"https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", href):
            return href

    return ""


def scrape_google_maps(
    page: Page, query: str, ville: str, limit: int,
) -> list[ScrapedBusiness]:
    """Scrape names + websites from Google Maps search results."""
    url = f"https://www.google.com/maps/search/{quote(f'{query} {ville}')}"

    try:
        page.goto(url, timeout=REQUEST_TIMEOUT, wait_until="domcontentloaded")
    except (PwTimeout, Exception):
        return []

    # Accept cookies consent
    try:
        btn = page.query_selector(
            "button[aria-label*='Tout accepter'], "
            "button[aria-label*='Accept all'], "
            "button:has-text('Tout accepter')"
        )
        if btn:
            btn.click()
            time.sleep(1.5)
    except Exception:
        pass

    # Wait for results feed
    try:
        page.wait_for_selector("div[role='feed'], div.Nv2PK", timeout=10000)
    except PwTimeout:
        return []

    # Scroll to load more results
    feed = page.query_selector("div[role='feed']")
    if feed:
        for _ in range(min(limit // 5, 8)):
            feed.evaluate("el => el.scrollTop = el.scrollHeight")
            time.sleep(0.7)

    # Collect business names from the list
    businesses: list[ScrapedBusiness] = []
    seen: set[str] = set()
    cards = page.query_selector_all("div.Nv2PK")

    for card in cards:
        if len(businesses) >= limit:
            break

        name_el = card.query_selector(".qBF1Pd, .fontHeadlineSmall")
        name = (name_el.inner_text() or "").strip() if name_el else ""
        if not name or name in seen:
            continue
        seen.add(name)

        businesses.append(ScrapedBusiness(
            nom_entreprise=name,
            ville=ville,
            verticale=query,
            source="google_maps",
            website="",
        ))

    # Visit each place detail page to extract website
    for biz in businesses:
        try:
            all_cards = page.query_selector_all("div.Nv2PK")
            for c in all_cards:
                n = c.query_selector(".qBF1Pd, .fontHeadlineSmall")
                if n and (n.inner_text() or "").strip() == biz.nom_entreprise:
                    c.click()
                    time.sleep(1.5)

                    biz.website = _extract_website_from_detail(page)

                    # Navigate back to results list
                    back = page.query_selector(
                        "button[aria-label='Retour'], "
                        "button[aria-label='Back'], "
                        "button[jsaction*='back']"
                    )
                    if back:
                        back.click()
                    else:
                        page.go_back()
                    time.sleep(0.5)
                    try:
                        page.wait_for_selector("div[role='feed']", timeout=3000)
                    except PwTimeout:
                        pass
                    break
        except Exception:
            pass

    w = sum(1 for b in businesses if b.website)
    print(f"{len(businesses)}L/{w}W", end=" ")
    return businesses


def scrape_verticale(
    verticale: str, cities: list[str], limit: int = 30,
) -> list[ScrapedBusiness]:
    queries = VERTICALE_QUERIES.get(verticale, [verticale])
    all_biz: list[ScrapedBusiness] = []
    seen: set[str] = set()
    total = len(queries) * len(cities)
    done = 0

    with sync_playwright() as pw:
        browser = create_browser(pw)
        try:
            pg = new_page(browser)
            for query in queries:
                for city in cities:
                    done += 1
                    print(f"  [{done}/{total}] {query} -- {city}... ", end="")
                    sys.stdout.flush()

                    results = scrape_google_maps(pg, query, city, limit)

                    new_count = 0
                    for biz in results:
                        key = f"{biz.nom_entreprise}|{biz.ville}".lower()
                        if key not in seen and biz.nom_entreprise:
                            seen.add(key)
                            biz.verticale = verticale
                            all_biz.append(biz)
                            new_count += 1

                    print(f"-> +{new_count} (total: {len(all_biz)})")
                    time.sleep(DELAY_BETWEEN)
        finally:
            browser.close()

    return all_biz


def export_csv(businesses: list[ScrapedBusiness], path: str) -> None:
    fields = ["nom_entreprise", "telephone", "adresse", "ville", "website", "verticale", "source"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for b in businesses:
            w.writerow({
                "nom_entreprise": b.nom_entreprise,
                "telephone": b.telephone,
                "adresse": b.adresse,
                "ville": b.ville,
                "website": b.website,
                "verticale": b.verticale,
                "source": b.source,
            })
    print(f"\n[Export] {len(businesses)} leads -> {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="AVA GTM -- Google Maps Website Scraper")
    parser.add_argument("--verticale", type=str)
    parser.add_argument("--ville", type=str)
    parser.add_argument("--villes", type=int, default=10)
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--output", type=str, default="scripts/scraped-leads.csv")
    parser.add_argument("--list-verticales", action="store_true")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    print("=" * 60)
    print("  AVA GTM -- GOOGLE MAPS WEBSITE SCRAPER")
    print("  Goal: extract websites -> email_scraper gets emails")
    print("  NOTE: For bulk scraping, prefer the Apify Google Maps actor")
    print("=" * 60)

    if args.list_verticales:
        for v, q in sorted(VERTICALE_QUERIES.items()):
            print(f"  {v:20s} : {', '.join(q)}")
        return

    if args.all:
        cities = [args.ville] if args.ville else FRENCH_CITIES[: args.villes]
        all_leads: list[ScrapedBusiness] = []
        verts = list(VERTICALE_QUERIES.keys())
        print(f"\n  {len(verts)} verticales x {len(cities)} villes x {args.limit} limit\n")
        for i, v in enumerate(verts, 1):
            print(f"\n[{i}/{len(verts)}] === {v} ===")
            leads = scrape_verticale(v, cities, args.limit)
            all_leads.extend(leads)
            print(f"  -> {len(leads)} | Total: {len(all_leads)}")
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        export_csv(all_leads, args.output)
        w = sum(1 for lead in all_leads if lead.website)
        print(f"\n  DONE: {len(all_leads)} leads, {w} websites ({100*w//max(len(all_leads),1)}%)")
        return

    if not args.verticale:
        print("[ERROR] Use --verticale or --all")
        sys.exit(1)

    cities = [args.ville] if args.ville else FRENCH_CITIES[: args.villes]
    leads = scrape_verticale(args.verticale, cities, args.limit)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    export_csv(leads, args.output)
    w = sum(1 for lead in leads if lead.website)
    print(f"\n  DONE: {len(leads)} leads, {w} websites ({100*w//max(len(leads),1)}%)")


if __name__ == "__main__":
    main()
