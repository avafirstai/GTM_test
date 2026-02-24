# GTM_test — Project Overview

> Machine de generation de leads B2B pour le marche francais.
> Scrape → Enrichit → Lance des campagnes cold email — tout automatise.

---

## Mission

GTM_test est une plateforme interne de Go-To-Market qui automatise l'acquisition de leads B2B en France :

1. **Scraper** des leads depuis Google Maps par verticale (niche) et ville
2. **Enrichir** chaque lead via un waterfall de 7 sources (email, telephone, SIRET, dirigeant)
3. **Lancer** des campagnes cold email via Instantly.ai
4. **Suivre** les reponses et conversations email

Le tout dans une interface unique avec streaming temps reel (SSE).

---

## Stack Technique

| Couche | Technologie | Notes |
|--------|-------------|-------|
| Framework | Next.js 15.5 (App Router) | Monorepo — pas de backend separe |
| Langage | TypeScript (strict) | Zero `any`, zero `@ts-ignore` |
| Database | Supabase (PostgreSQL REST) | Anon key, pas de SDK auth |
| ORM | Supabase JS Client (`@supabase/supabase-js`) | REST queries, pas SQL direct |
| Email Campaigns | Instantly.ai API v2 | Bearer auth, REST |
| Lead Scraping | Google Places API v1 | Service key, POST text search |
| Enrichment | 7 sources custom (DNS, HTML, SIRENE, etc.) | Waterfall prioritise |
| People Search | Apollo.io API v1 | X-Api-Key, REST |
| LinkedIn Enrichment | Kaspr API | Raw key auth, paid |
| Email Verification | eva.pingutil.com | Public, gratuit |
| Google Search | Google Custom Search API | 100 queries/jour free |
| Hosting | Vercel | Auto-deploy depuis GitHub main |
| Repo | github.com/avafirstai/GTM_test | Branch main |

---

## Architecture Globale

```
┌─────────────────────────────────────────────────────┐
│  FRONTEND — Next.js App Router (src/app/)           │
│  8 pages client, 21 API routes, 2 composants       │
└────────────────┬────────────────────────────────────┘
                 │ fetch / SSE
┌────────────────▼────────────────────────────────────┐
│  API ROUTES — Next.js Route Handlers (src/app/api/) │
│  Server-side only, pas de middleware auth            │
│  Acces direct aux APIs externes + Supabase          │
└────────────────┬────────────────────────────────────┘
                 │
    ┌────────────┼──────────────┬──────────────┐
    ▼            ▼              ▼              ▼
 Supabase    Google Places   Instantly.ai   Enrichment
 (5 tables)  (scraping)      (campaigns)    (7 sources)
```

---

## Les 4 Pipelines

### Pipeline 1 : Scraping (Google Maps → Supabase)
```
/scraping → POST /api/scrape/stream (SSE)
  → Google Places API : recherche par categorie + ville
  → INSERT gtm_leads (dedup par place_id)
  → INSERT gtm_scraping_jobs (tracking)
  → SSE events : combo_start, combo_done, progress, done
```

### Pipeline 2 : Enrichment (Waterfall 7 sources)
```
/enrichment → POST /api/enrich/v2/stream (SSE)
  → SELECT gtm_leads WHERE enrichment_status = 'pending'
  → Pour chaque lead : waterfall (DNS → Schema.org → Deep Scrape → SIRENE → Email Perm → Google Dork → Kaspr)
  → UPDATE gtm_leads (email, phone, siret, dirigeant, enrichment_status)
  → INSERT/UPDATE gtm_enrichment_jobs (tracking)
  → SSE events : lead_start, lead_done, lead_error, progress, done
```

### Pipeline 3 : Campaign Launch (Instantly.ai)
```
/launch → POST /api/orchestrate/stream (SSE)
  → SELECT gtm_leads (filtres niche + ville + has email)
  → POST Instantly /api/v2/leads (upload par batch de 500)
  → POST Instantly /api/v2/campaigns/:id/accounts (lier comptes email)
  → SSE events : combo_start, combo_done, progress, done
```

### Pipeline 4 : Replies (Instantly Inbox)
```
/replies → GET /api/replies?campaign_id=X
  → GET Instantly /api/v2/leads (filtre campaign + status)
  → GET Instantly Unbox API (thread email par lead)
  → Affichage thread dans l'UI
```

---

## Structure des Dossiers

```
src/
├── app/
│   ├── page.tsx                    # Dashboard (/)
│   ├── scraping/page.tsx           # Scraping Google Maps (/scraping)
│   ├── enrichment/page.tsx         # Enrichissement waterfall (/enrichment)
│   ├── leads/page.tsx              # Table des leads (/leads)
│   ├── campaigns/page.tsx          # Gestion campagnes (/campaigns)
│   ├── launch/page.tsx             # Lancement orchestration (/launch)
│   ├── replies/page.tsx            # Inbox reponses (/replies)
│   ├── settings/page.tsx           # Statut integrations (/settings)
│   ├── layout.tsx                  # Layout global + Sidebar
│   └── api/
│       ├── stats/route.ts          # Aggregation dashboard
│       ├── scrape/
│       │   ├── stream/route.ts     # SSE scraping
│       │   └── jobs/route.ts       # Historique scraping
│       ├── enrich/
│       │   ├── v2/stream/route.ts  # SSE enrichissement (principal)
│       │   ├── route.ts            # Legacy enrichissement
│       │   ├── jobs/route.ts       # Status enrichissement
│       │   ├── sources/route.ts    # Liste sources + health
│       │   └── people/route.ts     # Enrichissement personne
│       ├── leads/
│       │   ├── route.ts            # GET leads filtre
│       │   └── upload/route.ts     # POST upload batch
│       ├── campaigns/
│       │   ├── route.ts            # GET campagnes Instantly
│       │   └── toggle/route.ts     # POST pause/resume
│       ├── orchestrate/
│       │   ├── stream/route.ts     # SSE orchestration
│       │   ├── route.ts            # Legacy orchestration
│       │   └── accounts/route.ts   # GET comptes email
│       ├── replies/
│       │   ├── route.ts            # GET reponses
│       │   └── [email]/route.ts    # GET thread email
│       ├── custom-verticales/route.ts
│       └── custom-villes/route.ts
├── components/
│   ├── Sidebar.tsx                 # Navigation gauche (8 liens)
│   └── LeadsTable.tsx              # Table leads reutilisable (~600 LOC)
└── lib/
    ├── supabase.ts                 # Client Supabase init
    ├── leads-data.ts               # Types Lead + fetchLeads + mapping
    ├── lead-utils.ts               # instantlyFetch + email validation
    ├── google-places.ts            # Wrapper Google Places API
    ├── parseSSE.ts                 # Parser SSE events
    ├── useCampaigns.ts             # Hook campagnes (60s refresh)
    ├── useStats.ts                 # Hook stats (30s refresh)
    ├── useCustomData.ts            # Hook verticales + villes custom
    ├── useReplies.ts               # Hook reponses + thread
    ├── verticales.ts               # Liste verticales par defaut
    └── enrichment/
        ├── index.ts                # Exports publics
        ├── waterfall.ts            # Orchestrateur waterfall (356 LOC)
        ├── confidence.ts           # Scoring confiance (203 LOC)
        ├── types.ts                # Interfaces partagees (168 LOC)
        └── sources/
            ├── dns-intel.ts        # Source 1 : MX/SPF (225 LOC)
            ├── schema-org.ts       # Source 2 : JSON-LD (333 LOC)
            ├── deep-scrape.ts      # Source 3 : HTML regex (305 LOC)
            ├── sirene.ts           # Source 4 : INSEE (273 LOC)
            ├── email-permutation.ts # Source 5 : Permutations (251 LOC)
            ├── google-dork.ts      # Source 6 : Google CSE (225 LOC)
            ├── kaspr.ts            # Source 7 : LinkedIn (244 LOC)
            └── linkedin-finder.ts  # Helper : trouver URL LinkedIn (177 LOC)
```

---

## Navigation

```
Dashboard (/) ──────────────────────────────────────────┐
  ├── Scraping (/scraping) → view leads → /leads       │
  ├── Enrichment (/enrichment) → view enriched → /leads │
  ├── Leads (/leads) ← filtres URL params              │
  ├── Campaigns (/campaigns) → launch → /launch         │
  ├── Launch (/launch) → orchestrate stream             │
  ├── Replies (/replies) → thread email                 │
  └── Settings (/settings) → status integrations        │
────────────────────────────────────────────────────────┘
Sidebar fixe a gauche sur toutes les pages
```

---

## Patterns Cles

### SSE Streaming
3 endpoints utilisent le streaming SSE :
- `/api/scrape/stream` — scraping Google Maps
- `/api/enrich/v2/stream` — enrichissement waterfall
- `/api/orchestrate/stream` — lancement campagne

Pattern : `new ReadableStream` + `TextEncoder` + `data: JSON\n\n` format.
Frontend : `fetch()` + `reader.read()` + `parseSSE()` callback.

### Polling Fallback
L'enrichissement a un fallback polling si SSE drop :
- Toutes les 3s, GET `/api/enrich/jobs?id=X` pour recuperer le status
- Max 100 cycles (5 min) avant timeout

### Fire-and-forget DB Writes
Les UPDATE Supabase dans les streams SSE sont async sans `await` :
- Pro : stream rapide, pas de blocage
- Con : si Supabase down, donnees perdues silencieusement
- Mitigation : SSE `db_warning` event en cas d'echec

### Deduplication
- Leads scrapes : dedup par `google_maps_url` (UNIQUE constraint probable)
- Leads enrichis : `enrichment_status = 'pending'` filtre les deja traites
- Leads Instantly : `skip_if_in_campaign: true` evite les doublons

---

## Commandes

```bash
# Dev
export PATH="/opt/homebrew/bin:$PATH" && npm run dev

# Build production
export PATH="/opt/homebrew/bin:$PATH" && npm run build

# Deploy
git push origin main   # Vercel auto-deploy

# Supabase
# Project ID: cifxffapwtksxhaphepv
# Pas de migrations locales — schema gere dans Supabase Dashboard
```

---

## Variables d'Environnement

| Variable | Type | Requis | Usage |
|----------|------|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client | OUI | URL projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client | OUI | Cle anonyme Supabase |
| `INSTANTLY_API_KEY` | Server | OUI | Auth Instantly.ai |
| `INSTANTLY_CAMPAIGN_ID` | Server | NON | Campaign par defaut |
| `GOOGLE_PLACES_API_KEY` | Server | OUI | Scraping Google Maps |
| `APOLLO_API_KEY` | Server | NON | Recherche decideurs |
| `GOOGLE_CSE_API_KEY` | Server | NON | Google Dork enrichment |
| `GOOGLE_CSE_CX` | Server | NON | ID moteur CSE |
| `KASPR_API_KEY` | Server | NON | Enrichissement LinkedIn |

---

*Derniere mise a jour : 2025-02-24 — Post-refonte enrichissement v2*
