# Architecture Technique — AVA GTM Machine

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│                    LAYER 1: DATA ACQUISITION                     │
│  Google Maps (Playwright/Apify) → 8,360+ leads B2B France       │
│  PagesJaunes (Playwright) → Expansion future                    │
└─────────────────┬───────────────────────────────────────────────┘
                  │ CSV / Direct Supabase
┌─────────────────▼───────────────────────────────────────────────┐
│                    LAYER 2: ENRICHMENT & SCORING                 │
│  email_scraper.py (aiohttp + BS4) → 68% email hit rate          │
│  Lead Scorer (formule ponderee) → Score 0-100, Tiers A/B/C/D    │
│  Kaspr (futur) → LinkedIn URLs → emails pro                     │
└─────────────────┬───────────────────────────────────────────────┘
                  │ Enriched leads
┌─────────────────▼───────────────────────────────────────────────┐
│                    LAYER 3: OUTREACH ENGINE                      │
│  Instantly.ai (API v2) → Cold email par verticale                │
│  LinkedIn (manuel/Kaspr) → Top 50 leads                         │
│  WhatsApp (conservatif) → Groupes pro infiltration               │
└─────────────────┬───────────────────────────────────────────────┘
                  │ Replies + Events
┌─────────────────▼───────────────────────────────────────────────┐
│                    LAYER 4: CONVERSION                           │
│  Reply Handler → Classification 8 intents                        │
│  Cal.com → Booking demos (15min)                                 │
│  Demo Script → Format 7min (probleme/solution/offre)             │
│  Pilote → 14 jours gratuit → Client payant                      │
└─────────────────┬───────────────────────────────────────────────┘
                  │ Analytics + Pipeline
┌─────────────────▼───────────────────────────────────────────────┐
│                    LAYER 5: TRACKING & INTELLIGENCE              │
│  Notion CRM → Pipeline lead tracking                             │
│  Supabase → Donnees brutes + analytics                           │
│  Dashboard → Next.js 15, refresh 30s, Vercel                     │
│  n8n → Orchestration webhooks (futur)                            │
└─────────────────────────────────────────────────────────────────┘
```

## Base de donnees (Supabase)

### Table: gtm_leads
```sql
CREATE TABLE gtm_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  city TEXT,
  phone TEXT,
  website TEXT,
  email TEXT,
  category TEXT,
  rating NUMERIC,
  reviews INTEGER,
  score INTEGER DEFAULT 0,
  apify_run TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Tables futures (Phase 3+)
```sql
-- Outreach events (envois, opens, replies)
CREATE TABLE outreach_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES gtm_leads(id),
  campaign_id TEXT,
  event_type TEXT, -- sent, opened, replied, bounced
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaigns tracking
CREATE TABLE campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instantly_id TEXT UNIQUE,
  verticale TEXT,
  name TEXT,
  status TEXT DEFAULT 'draft',
  stats JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Pipeline d'execution

### Flux quotidien (run_pipeline.sh)
```
06:00 — Cron demarre
  |
  ├─ 1. email_scraper.py
  │     Input: Supabase (leads sans email)
  │     Output: Update Supabase (champ email)
  │     Duree: ~10 min pour 1,000 sites
  │
  ├─ 2. instantly_uploader.py
  │     Input: Supabase (leads avec email, non uploades)
  │     Output: Leads dans Instantly par campagne/verticale
  │     Duree: ~5 min (1 req/sec)
  │
  ├─ 3. git push main
  │     Trigger: Vercel auto-deploy dashboard
  │
  └─ FIN — Dashboard mis a jour automatiquement
```

## API Dashboard (/api/stats)

### Endpoint: GET /api/stats
Response:
```json
{
  "stats": {
    "totalLeads": 8360,
    "withEmail": 0,
    "withPhone": 8017,
    "withWebsite": 7415,
    "emailRate": 0,
    "phoneRate": 95.9,
    "websiteRate": 88.7,
    "avgRating": 4.2,
    "avgScore": 0,
    "byVerticale": {"Formation": 1200, "Dentaire": 800, ...},
    "byVille": {"Paris": 2100, "Lyon": 900, ...}
  },
  "pipeline": [...],
  "apifyRuns": [...],
  "enrichment": {...},
  "categoryEmailRates": [...],
  "cityEmailRates": [...]
}
```

## Integrations externes

### Instantly.ai (Cold Email)
- API v2, Bearer token auth
- 1 campagne par verticale (20 campagnes max)
- Upload one-by-one (pas de bulk)
- Voir `.claude/skills/instantly-api.md`

### Notion (CRM Pipeline)
- API v2022-06-28
- Database pipeline avec statuts
- Voir `.claude/skills/notion-api.md`

### Cal.com (Booking)
- Lien public: cal.com/avafirstai/15min
- Webhooks pour sync pipeline
- Voir `.claude/skills/calcom-api.md`

### Supabase (Database)
- Project: cifxffapwtksxhaphepv
- Table: gtm_leads (8,360 rows)
- Client: `src/lib/supabase.ts`
- Anon key safe pour browser (RLS active)
