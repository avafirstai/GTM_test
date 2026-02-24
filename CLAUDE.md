# AVA GTM — Machine de Guerre Go-To-Market

> **Tu es l'architecte de la plus puissante machine GTM B2B jamais construite.**
> **Zero budget. Zero intervention humaine. Revenue maximum.**
> **Chaque decision est chirurgicale. Chaque action rapproche d'un client payant.**

---

## Mission

Plateforme GTM 100% autonome qui :
1. **Scrape** des leads B2B depuis Google Maps (gratuit, Playwright + Apify)
2. **Enrichit** chaque lead avec un email pro (scraping sites web, objectif 40-65% hit rate)
3. **Score** chaque lead (formule ponderee, 0-100)
4. **Uploade** dans Instantly pour des campagnes email automatisees
5. **Synchronise** avec Notion CRM pour pipeline tracking
6. **Booke** des demos via Cal.com
7. **Met a jour** le dashboard Supabase en temps reel
8. **Se deploie** automatiquement via Vercel

**Objectif final : 500 emails = 1 client payant a 199 EUR/mois MRR.**

---

## Etat Actuel (Checkpoint)

| Metrique | Valeur | Status |
|----------|--------|--------|
| Leads scrapes | 8,360 | FAIT |
| Leads dans Supabase | 8,360 | FAIT |
| Leads avec site web | ~7,415 (88.9%) | FAIT |
| Leads avec telephone | ~8,017 (95.9%) | FAIT |
| Leads avec email | 14 (0.17%) | QUASI ZERO — enrichissement a relancer |
| Campagnes Instantly | 0 | A LANCER |
| Dashboard live | Oui (Supabase + 30s refresh) | OPERATIONNEL |
| Pipeline cron | Pret (run_pipeline.sh) | A ACTIVER |

---

## Architecture

```
LEADS IN                                           REVENUE OUT
   |                                                    ^
   v                                                    |
 [SOURCING]    [ENRICHISSEMENT]    [OUTREACH]     [CONVERSION]
 Google Maps -> Email Scraper  -> Instantly    -> Cal.com
 Playwright     aiohttp+BS4      API v2          Booking
 Apify (done)   objectif 40%+    20 campagnes    Demo 7min
   |                |                |               |
   v                v                v               v
 [SUPABASE]   Table: gtm_leads (8,360 rows)
 PostgreSQL    Colonnes: name, city, phone, website, email,
               category, rating, reviews, score, apify_run
   |
   v
 [DASHBOARD]   Next.js 15 + Vercel
 /api/stats    Supabase real-time, refresh 30s
```

---

## Tech Stack

| Layer | Technology | Fichier |
|-------|-----------|---------|
| Frontend | Next.js 15 + React 19 + Tailwind 4 | `src/` |
| Database | Supabase PostgreSQL | `src/lib/supabase.ts` |
| API Stats | Next.js Route Handler | `src/app/api/stats/route.ts` |
| Scraping Maps | Python 3 + Playwright | `scripts/google_maps_scraper.py` |
| Email enrichment | Python 3 async (aiohttp + BS4) | `scripts/email_scraper.py` |
| Upload campagne | Python 3 (Instantly API v2) | `scripts/instantly_uploader.py` |
| Import Supabase | Python 3 (REST API) | `scripts/import_to_supabase.py` |
| Dashboard stats | Python 3 (CSV -> TS generator) | `scripts/update_dashboard_data.py` |
| Orchestration | Bash + cron | `scripts/run_pipeline.sh` |
| Hosting | Vercel (auto-deploy on push main) | `vercel.json` |
| CRM | Notion API | A connecter |
| Booking | Cal.com API v2 | A connecter |
| Cold Email | Instantly.ai API v2 | `src/lib/instantly.ts` |
| Git | GitHub (avafirstai/GTM_test) | `.git` |

---

## Structure du Repo

```
GTM_test/
├── CLAUDE.md                    # CE FICHIER — master brain
├── .claude/
│   ├── rules/                   # Contraintes et regles absolues
│   │   ├── 00-core.md           # Regles fondamentales
│   │   ├── 10-anti-spam.md      # Anti-spam et deliverabilite
│   │   ├── 20-security.md       # Secrets et securite
│   │   └── 30-code-style.md     # Conventions de code
│   ├── skills/                  # References API externes
│   │   ├── instantly-api.md     # Instantly.ai API v2 reference
│   │   ├── notion-api.md        # Notion API reference
│   │   └── calcom-api.md        # Cal.com API v2 reference
│   └── agents/                  # Sous-agents specialises
│       ├── lead-scorer.md       # Scoring et qualification
│       ├── email-writer.md      # Generation sequences email
│       └── reply-handler.md     # Classification et reponse
├── docs/
│   ├── architecture/
│   │   └── system-design.md     # Architecture technique detaillee
│   ├── playbooks/
│   │   ├── week-1-launch.md     # Playbook semaine 1
│   │   ├── week-2-4-scaling.md  # Playbook semaines 2-4
│   │   └── troubleshooting.md   # Guide de depannage
│   └── api-references/
│       └── instantly-v2.md      # Doc complete Instantly API v2
├── ava-growth-machine/          # Playbooks GTM (29 fichiers)
│   ├── CLAUDE.md                # Brain growth machine
│   ├── README.md                # Setup guide + 30-day plan
│   ├── 00-foundations/          # Positioning, objections, ROI
│   ├── 10-icp/                  # ICPs par verticale (6)
│   ├── 20-sourcing/             # Google Maps, signals
│   ├── 30-outreach/             # Cold email, LinkedIn, WhatsApp
│   ├── 40-demos/                # Script demo + case studies
│   ├── 50-content/              # Content engine + LinkedIn posts
│   ├── 60-analytics/            # KPIs et reporting
│   ├── 70-partnerships/         # Programme partenaires
│   ├── 80-crm/                  # Pipeline Notion
│   └── 90-automation/           # n8n, prompts, scoring
├── src/
│   ├── app/
│   │   ├── api/stats/route.ts   # API endpoint (Supabase live stats)
│   │   ├── page.tsx             # Dashboard home (client component, 30s refresh)
│   │   ├── campaigns/page.tsx   # Gestion campagnes email (server, data.ts)
│   │   ├── enrichment/page.tsx  # Pipeline enrichissement (server, data.ts)
│   │   ├── launch/page.tsx      # Lancement campagne (client, SIMULATION ONLY)
│   │   ├── leads/page.tsx       # Base de leads (server, leads-data.ts)
│   │   ├── scraping/page.tsx    # Status scraping Apify (server, data.ts)
│   │   ├── settings/page.tsx    # Parametres / integrations (server, data.ts)
│   │   ├── social/page.tsx      # Social media (PLACEHOLDER)
│   │   └── verticales/page.tsx  # 14 verticales + scoring ROI (server, verticales.ts)
│   ├── components/
│   │   ├── Sidebar.tsx          # Navigation (USES data.ts = stale data)
│   │   ├── StatCard.tsx         # Card metrique
│   │   ├── Pipeline.tsx         # Pipeline funnel (BUG: division trompeuse)
│   │   ├── EmailFunnel.tsx      # Funnel scrape->phone->web->email
│   │   ├── CampaignTable.tsx    # Table campagnes
│   │   ├── VerticaleChart.tsx   # Chart horizontal par verticale
│   │   ├── GeoMap.tsx           # Carte des villes
│   │   ├── ScoreDistribution.tsx # Distribution score + rating
│   │   ├── ScrapingStatus.tsx   # Runs Apify (UNUSED imports)
│   │   ├── EnrichmentProgress.tsx # Progress par verticale
│   │   ├── LeadsTable.tsx       # Table leads complete (filtres, tri, expand)
│   │   └── ActionItems.tsx      # Actions prioritaires (100% STATIQUE)
│   └── lib/
│       ├── supabase.ts          # Client Supabase (env vars)
│       ├── instantly.ts         # Client Instantly API v2 (NO error handling)
│       ├── verticales.ts        # 14 verticales + scoring formula
│       ├── data.ts              # AUTO-GENERATED stats snapshot (STALE)
│       └── leads-data.ts        # AUTO-GENERATED 500 leads (323KB! PERF ISSUE)
├── scripts/
│   ├── email_scraper.py         # Scraper emails (async, Supabase live update)
│   ├── instantly_uploader.py    # Upload Instantly par verticale
│   ├── google_maps_scraper.py   # Scraper Google Maps (Playwright)
│   ├── import_to_supabase.py    # Import CSV dans Supabase (one-time)
│   ├── update_dashboard_data.py # Genere data.ts + leads-data.ts depuis CSV
│   ├── run_pipeline.sh          # Orchestrateur pipeline complet
│   └── requirements.txt         # Dependencies Python
└── vercel.json                  # Config Vercel
```

---

## Problemes Connus (Audit Fevrier 2026)

### CRITIQUES (a fixer avant tout)
1. **Credentials hardcodees** dans `email_scraper.py` (L37-41) et `import_to_supabase.py` (L11-12) — Supabase URL + anon key en clair dans le code source
2. **SSL=False** dans `email_scraper.py` — verification SSL desactivee
3. **leads-data.ts = 323KB** — 500 leads hardcodes dans le bundle JS client

### ARCHITECTURAUX
4. **Dual data** — Sidebar (data.ts statique) vs Dashboard (Supabase live) = chiffres incoherents
5. **API /api/stats** — fetche 8,360 rows entieres et compute en memoire (pas de GROUP BY cote DB)
6. **launch/page.tsx** — simulation pure (setTimeout), zero connexion backend
7. **Verticales dupliquees** — launch/page.tsx (20 inline) vs verticales.ts (14 officielles)

### FONCTIONNELS
8. **14 emails seulement** — enrichissement quasi pas demarre
9. **Pipeline.tsx** — progress bar trompeuse (divise par total au lieu de funnel)
10. **instantly.ts** — zero error handling, zero rate limiting
11. **Boutons decoratifs** — "Exporter CSV", "Nouveau scraping" sans onClick

---

## Verticales (14 secteurs, 3 tiers)

### Tier 1 — ROI Maximum (score > 80)
| Verticale | Score | Deal moyen | Pain point |
|-----------|-------|------------|------------|
| Cabinet Dentaire | 85 | 350 EUR/mois | Appels manques pendant les soins |
| Agence Immobiliere | 84 | 400 EUR/mois | Agents en visite, prospects perdus |
| Cabinet Medical | 83 | 300 EUR/mois | Standard sature, secretariat couteux |
| Cabinet Avocat | 82 | 400 EUR/mois | Avocats en audience, dossiers perdus |
| Centre Formation | 81 | 300 EUR/mois | Rush inscriptions Parcoursup |
| Expert-Comptable | 78 | 350 EUR/mois | Periode fiscale critique |

### Tier 2 — High Potential
Salon Beaute, Veterinaire, Restaurant HG, Artisan Premium, Hotellerie

### Tier 3 — Explore
Cinema, Auto-ecole, Concessions, Agences voyage

---

## Pipeline Autonome

### Flux complet (run_pipeline.sh)
```
1. email_scraper.py         -> Visite sites, extrait emails
2. instantly_uploader.py    -> Upload dans Instantly par verticale
3. update_dashboard_data.py -> Genere data.ts + leads-data.ts (legacy)
4. git push main            -> Vercel auto-deploy
```

### Cron (quotidien 6h)
```bash
0 6 * * * cd /path/to/GTM_test && ./scripts/run_pipeline.sh >> scripts/pipeline.log 2>&1
```

---

## Funnel de Conversion

```
1000 emails envoyes
  -> 500 ouverts (50%)
    -> 30 replies (3-5%)
      -> 15 positifs (50% des replies)
        -> 8 demos bookees (53%)
          -> 4 pilotes (50%)
            -> 2 clients payants (50%)

RATIO MAGIC : 500 emails = 1 client payant a 199 EUR/mois
```

---

## Phases du Projet

### PHASE 1 : FONDATIONS — FAIT
- [x] Dashboard Next.js 15 + React 19 + Tailwind 4
- [x] 8,360 leads scrapes via Apify (11 datasets)
- [x] Import dans Supabase (table gtm_leads)
- [x] Dashboard connecte Supabase (API /api/stats, refresh 30s)
- [x] Email scraper async (aiohttp + BS4)
- [x] Instantly uploader (API v2)
- [x] Pipeline orchestrateur (run_pipeline.sh)
- [x] Interface lancement campagne (/launch)
- [x] Deploy Vercel automatique
- [x] 14 verticales analysees avec scoring ROI

### PHASE 2 : ENRICHISSEMENT + CAMPAGNES — EN COURS
- [ ] Fixer les credentials hardcodees (scripts Python)
- [ ] Migrer data.ts/leads-data.ts vers Supabase-only
- [ ] Relancer le scraping email (objectif 40%+ des 7,415 sites)
- [ ] Upload massif dans Instantly par verticale
- [ ] Activer le pipeline cron quotidien
- [ ] Creer 3 inboxes warmup (domaines secondaires)
- [ ] Lancer 3 campagnes pilotes (Formation, Dentaire, Immobilier)
- [ ] Connecter Notion CRM

### PHASE 3 : SCALE
- [ ] 20 campagnes actives (1 par verticale)
- [ ] A/B testing sequences email
- [ ] LinkedIn outreach top 50 leads
- [ ] API stats optimisee (SQL aggregation vs in-memory)
- [ ] N8N automation workflows
- [ ] Cal.com integration booking

### PHASE 4 : REVENUE
- [ ] Premier client payant
- [ ] Case study publie
- [ ] Pipeline Notion complet
- [ ] Reporting hebdomadaire automatique
- [ ] 5-10 clients payants, MRR 1,000-4,000 EUR

---

## Produit AVA AI

### Ce qu'on vend
Receptionniste vocale IA 24/7 qui repond aux appels, qualifie les leads, et booke des RDV.

### Pitch en 1 phrase
> "Ne perdez plus un seul client a cause d'un appel manque."

### Stats cles
- 30-35% des appels sont manques par les PME
- 75% des gens qui tombent sur messagerie ne rappellent JAMAIS
- 850-3,000 EUR de revenue perdu par appel manque

### Pricing
| Plan | Prix | Volume |
|------|------|--------|
| Starter | 199 EUR/mois | Jusqu'a 100 appels/mois |
| Pro | 399 EUR/mois | Jusqu'a 500 appels/mois |
| Business | 799 EUR/mois | Illimite |

### Offre pilote
14 jours gratuits. Setup en 24h. Pas d'engagement.

---

## Credentials (JAMAIS dans le code)

```bash
# .env.local (gitignore)
NEXT_PUBLIC_SUPABASE_URL=          # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # Supabase anon key (safe for browser)
SUPABASE_URL=                      # Pour les scripts Python
SUPABASE_ANON_KEY=                 # Pour les scripts Python
INSTANTLY_API_KEY=                  # Instantly Bearer token
INSTANTLY_BEARER=                   # Alias
CALCOM_API_KEY=                     # Cal.com API v2
NOTION_API_KEY=                     # Notion integration
NOTION_PIPELINE_DB=                 # Notion database ID
```

---

## Convention de Code

### Python (scripts/)
- Type hints sur toutes les fonctions
- Docstrings sur les fonctions publiques
- Gestion d'erreurs (try/except) autour de chaque requete HTTP
- Credentials via `os.environ.get()` — JAMAIS hardcodees
- JAMAIS de PII dans les logs
- `ssl=True` par defaut (securite non-negotiable)

### TypeScript (src/)
- Strict mode (`strict: true` dans tsconfig.json)
- Interfaces pour toutes les donnees
- Server Components par defaut
- Client Components avec `'use client'` uniquement si interactivite requise
- Import paths avec `@/` alias
- Pas de `any` — utiliser `unknown` + type guards
- Pas de donnees massives en static (> 50KB = API route)

### Git
- Branche: `main` (production, auto-deploy)
- Commits: `feat:`, `fix:`, `chore:` prefix
- Commit message en anglais
- SMALL DIFFS — un changement logique par commit

---

## Regles Absolues

1. **GRATUIT** — Aucun outil payant sauf Instantly (plan gratuit).
2. **AUTONOME** — Pipeline via cron. Zero intervention humaine.
3. **ANTI-SPAM** — Max 30 emails/jour/inbox. Warmup 2-3 semaines. Domaines secondaires.
4. **PAS DE PII DANS LES LOGS** — Emails/phones jamais dans les messages d'erreur.
5. **DASHBOARD LIVE** — Supabase real-time prioritaire. Fichiers statiques = legacy a deprecer.
6. **SECRETS EN .ENV** — `os.environ.get()` partout, `.env.local` dans `.gitignore`. ZERO credentials dans le code source.
7. **SMALL DIFFS** — Un changement logique par commit.
8. **SCRAPING RESPECTUEUX** — Timeouts, retries, rate-limiting. Pas de DDOS.
9. **SSL TOUJOURS ON** — Jamais `ssl=False` en production.
10. **BUNDLE LEAN** — Pas de fichiers > 50KB dans le bundle client JS. API routes pour les donnees volumineuses.

---

## URLs

| Service | URL |
|---------|-----|
| Dashboard (prod) | https://gtm-test-ava-firsts-projects.vercel.app |
| GitHub repo | https://github.com/avafirstai/GTM_test |
| Instantly | https://app.instantly.ai |
| Cal.com | https://cal.com/avafirstai/15min |
| Notion Pipeline | (a configurer) |
| Supabase | https://supabase.com/dashboard/project/cifxffapwtksxhaphepv |
| Vercel | https://vercel.com/ava-firsts-projects |

---

## Quick Reference

### Lancer le pipeline
```bash
./scripts/run_pipeline.sh           # Full pipeline
./scripts/run_pipeline.sh --test    # Test mode (20 leads)
```

### Installer les deps Python
```bash
pip install -r scripts/requirements.txt
```

### Dev local
```bash
npm run dev                         # Dashboard local :3000
```

### Verifier le build
```bash
npm run build                       # Doit passer clean
```
