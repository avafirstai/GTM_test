# AVA GTM — Machine de Guerre Go-To-Market

> Zero budget. Zero intervention humaine. Revenue maximum.

## Mission
Plateforme GTM 100% autonome : Scrape (Google Maps) → Enrichit (emails) → Score (0-100) → Upload (Instantly) → Sync (Notion CRM) → Book (Cal.com) → Dashboard (Supabase + Vercel).
**500 emails = 1 client payant a 199 EUR/mois MRR.**

## Produit AVA AI
Receptionniste vocale IA 24/7. Pitch : "Ne perdez plus un seul client a cause d'un appel manque."
Offre pilote : 14 jours gratuits, setup 24h, sans engagement.

## Architecture
```
Google Maps → Email Scraper → Instantly → Cal.com
  (Playwright)  (aiohttp+BS4)  (API v2)    (Booking)
        ↓            ↓             ↓           ↓
     [SUPABASE] Table: gtm_leads → [DASHBOARD] Next.js 15 + Vercel
```

## Tech Stack
- **Frontend** : Next.js 15 + React 19 + Tailwind 4 (`src/`)
- **DB** : Supabase PostgreSQL (`src/lib/supabase.ts`)
- **Scripts** : Python 3 (`scripts/`) — email_scraper, instantly_uploader, google_maps_scraper
- **Hosting** : Vercel auto-deploy on push main
- **Cold Email** : Instantly.ai API v2
- **CRM** : Notion API (a connecter) | **Booking** : Cal.com API v2 (a connecter)

## Pipeline (run_pipeline.sh)
```
email_scraper.py → instantly_uploader.py → update_dashboard_data.py → git push main
Cron: 0 6 * * *
```

## Credentials
Tous dans `.env.local` (gitignore). Voir `.claude/rules/20-security.md` pour details.

## Regles Absolues
1. GRATUIT (sauf Instantly gratuit) | 2. AUTONOME (cron) | 3. ANTI-SPAM (30/jour/inbox, warmup 2-3 sem)
4. PAS DE PII DANS LES LOGS | 5. DASHBOARD LIVE (Supabase real-time) | 6. SECRETS EN .ENV
7. SMALL DIFFS | 8. SCRAPING RESPECTUEUX | 9. SSL TOUJOURS ON | 10. BUNDLE LEAN (< 50KB)

Voir `.claude/rules/` pour details : 00-core, 10-anti-spam, 20-security, 30-code-style.

## URLs
| Dashboard | https://gtm-test-ava-firsts-projects.vercel.app |
|-----------|------------------------------------------------|
| GitHub | https://github.com/avafirstai/GTM_test |
| Supabase | https://supabase.com/dashboard/project/cifxffapwtksxhaphepv |
| Cal.com | https://cal.com/avafirstai/15min |

## Workflow : EXPLORE → PLAN → CODE → VERIFY
1. **EXPLORE** : Lire fichiers impactes, identifier patterns, poser questions si doute
2. **PLAN** : Objectif + fichiers + approche + risques → attendre "OK"
3. **CODE** : Diffs minimaux, un commit par changement logique
4. **VERIFY** : `export PATH="/opt/homebrew/bin:$PATH" && npm run build` doit passer

## MUST NOT
- Features/refactors non demandes | `any` en TS | force-push sans confirmation
- Code defensif pour scenarios impossibles | Abstractions one-shot | YAGNI

## Regles de Persistence (CRITIQUES)
- Enrichissement DB : email + enrichment_status toujours ensemble
- Supabase IDs sont des integers → `String(id)` pour localeCompare
- `cache: "no-store"` obligatoire sur `/api/leads`
- UI : enrichResults state (immediat) + DB (survit au refresh)
