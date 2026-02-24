# API Inventory — 21 Route Handlers

> Chaque route est un Next.js Route Handler dans `src/app/api/`.
> Toutes server-side, pas de middleware auth (outil interne).

---

## Scraping

### `GET /api/scrape/jobs`
- **Fichier** : `src/app/api/scrape/jobs/route.ts` (39 LOC)
- **But** : Historique des jobs de scraping
- **Params query** : aucun
- **Supabase** : `SELECT * FROM gtm_scraping_jobs ORDER BY created_at DESC LIMIT 20`
- **Response** : `{ jobs: ScrapingJob[] }`

### `POST /api/scrape/stream`
- **Fichier** : `src/app/api/scrape/stream/route.ts` (370 LOC)
- **But** : Lancer un scraping Google Maps en streaming SSE
- **Body** :
  ```json
  {
    "verticaleIds": ["dentiste", "plombier"],
    "villes": ["Paris", "Lyon"],
    "maxPagesPerQuery": 3
  }
  ```
- **API externes** : Google Places API v1 (POST text search)
- **Supabase** :
  - INSERT `gtm_scraping_jobs` (nouveau job)
  - INSERT `gtm_leads` (leads trouves, dedup)
  - SELECT `gtm_custom_verticales` (categories custom)
  - UPDATE `gtm_scraping_jobs` (progression)
- **SSE events** : `job_created`, `combo_start`, `combo_done`, `progress`, `done`, `error`
- **Rate limit** : 120ms entre chaque requete Google Places

---

## Enrichment

### `POST /api/enrich/v2/stream` ⭐ (principal)
- **Fichier** : `src/app/api/enrich/v2/stream/route.ts` (517 LOC)
- **But** : Enrichissement waterfall en streaming SSE
- **Body** :
  ```json
  {
    "categories": ["dentiste", "plombier"],
    "cities": ["Paris"],
    "limit": 50,
    "sources": ["dns_intel", "schema_org", "sirene"],
    "stopOnConfidence": 80,
    "useKaspr": false,
    "minScoreForPaid": 30,
    "leadIds": ["uuid-1", "uuid-2"]
  }
  ```
- **Supabase** :
  - SELECT `gtm_leads` WHERE `enrichment_status = 'pending'` + filtres
  - UPDATE `gtm_leads` (email, phone, siret, dirigeant, enrichment_status)
  - INSERT/UPDATE `gtm_enrichment_jobs`
- **SSE events** : `job_created`, `lead_start`, `lead_done`, `lead_error`, `progress`, `db_warning`, `done`, `error`
- **Timeout** : 120s par lead (Promise.race), 10s par source

### `POST /api/enrich/route` (legacy)
- **Fichier** : `src/app/api/enrich/route.ts` (271 LOC)
- **But** : Enrichissement batch sans streaming (fallback)
- **Body** : meme que v2/stream
- **Note** : Utilise pour fallback si SSE drop

### `GET /api/enrich/jobs`
- **Fichier** : `src/app/api/enrich/jobs/route.ts` (~40 LOC)
- **But** : Status d'un job d'enrichissement (polling fallback)
- **Params query** : `?id=job-uuid`
- **Supabase** : SELECT `gtm_enrichment_jobs` WHERE id

### `GET /api/enrich/sources`
- **Fichier** : `src/app/api/enrich/sources/route.ts` (62 LOC)
- **But** : Liste des sources d'enrichissement + statut de sante
- **Response** :
  ```json
  {
    "sources": [
      { "id": "dns_intel", "name": "DNS Intelligence", "tier": "free", "enabled": true, "configured": true },
      { "id": "kaspr", "name": "Kaspr", "tier": "paid", "enabled": false, "configured": false }
    ]
  }
  ```
- **Logique** : Verifie si les API keys sont presentes (KASPR_API_KEY, GOOGLE_CSE_API_KEY, etc.)

### `POST /api/enrich/people`
- **Fichier** : `src/app/api/enrich/people/route.ts` (178 LOC)
- **But** : Enrichir une personne/decideur specifique
- **Body** : `{ domain: "example.fr", name?: "Jean Dupont" }`
- **API externes** : Apollo.io (people search), Kaspr
- **Response** : `{ people: [{ name, title, email, linkedin_url, confidence }] }`

---

## Leads

### `GET /api/leads`
- **Fichier** : `src/app/api/leads/route.ts` (74 LOC)
- **But** : Recuperer les leads avec filtres
- **Params query** :
  - `?city=Paris` — filtre ville (ilike)
  - `?category=dentiste` — filtre categorie (ilike)
  - `?hasEmail=yes|no` — filtre email non-null
  - `?enrichmentStatus=enriched|pending|failed|skipped` — filtre statut
  - `?limit=100&offset=0` — pagination
- **Supabase** : SELECT `gtm_leads` avec filtres dynamiques
- **Response** : `{ leads: Lead[], total: number }`
- **Select columns** : id, name, city, phone, website, email, category, rating, reviews, score, address, siret, dirigeant, dirigeant_linkedin, mx_provider, has_mx, enrichment_source, enrichment_confidence, enriched_at, enrichment_status, enrichment_attempts, enrichment_failed_at, google_maps_url, source, created_at

### `POST /api/leads/upload`
- **Fichier** : `src/app/api/leads/upload/route.ts` (151 LOC)
- **But** : Upload batch de leads vers Instantly.ai
- **Body** :
  ```json
  {
    "campaignId": "camp-uuid",
    "leads": [{ "email": "...", "first_name": "...", "company_name": "..." }]
  }
  ```
- **API externes** : Instantly.ai POST /api/v2/leads (batch de 500 max)
- **Response** : `{ uploaded: number, skipped: number, errors: number }`

---

## Campaigns

### `GET /api/campaigns`
- **Fichier** : `src/app/api/campaigns/route.ts` (217 LOC)
- **But** : Liste des campagnes Instantly + analytics
- **API externes** :
  - Instantly GET /api/v2/campaigns?limit=100
  - Instantly GET /api/v2/campaigns/analytics?id=X&start_date=...&end_date=...
- **Response** :
  ```json
  {
    "campaigns": [{
      "id": "...", "name": "...", "status": 1,
      "analytics": { "emails_sent": 100, "emails_read": 45, "replied": 12 }
    }]
  }
  ```
- **Gotcha** : analytics retourne un objet OU un tableau — code gere les deux

### `POST /api/campaigns/toggle`
- **Fichier** : `src/app/api/campaigns/toggle/route.ts` (65 LOC)
- **But** : Pause/resume une campagne Instantly
- **Body** : `{ campaignId: "...", action: "pause" | "resume" }`
- **API externes** : Instantly POST (pause/resume endpoint)

---

## Orchestrate

### `POST /api/orchestrate/stream`
- **Fichier** : `src/app/api/orchestrate/stream/route.ts` (296 LOC)
- **But** : Orchestration complete : select leads → upload → lier comptes → lancer campagne
- **Body** :
  ```json
  {
    "niches": ["dentiste"],
    "villes": ["Paris"],
    "leadCount": 100,
    "campaignId": "...",
    "accountIds": ["acc-1", "acc-2"]
  }
  ```
- **API externes** : Instantly (leads upload + accounts link)
- **Supabase** : SELECT `gtm_leads`, UPDATE campaign_id
- **SSE events** : `combo_start`, `combo_done`, `progress`, `done`, `error`

### `POST /api/orchestrate/route` (legacy)
- **Fichier** : `src/app/api/orchestrate/route.ts` (185 LOC)
- **But** : Orchestration sans streaming (fallback)

### `GET /api/orchestrate/accounts`
- **Fichier** : `src/app/api/orchestrate/accounts/route.ts` (77 LOC)
- **But** : Lister les comptes email Instantly
- **API externes** : Instantly GET /api/v2/accounts?limit=100
- **Response** : `{ accounts: [{ id, email, status, warmup_status, daily_limit }] }`
- **Gotcha** : response peut etre `{ items: [...] }` OU tableau nu

---

## Replies

### `GET /api/replies`
- **Fichier** : `src/app/api/replies/route.ts` (174 LOC)
- **But** : Recuperer les leads avec reponses pour une campagne
- **Params query** : `?campaign_id=...`
- **API externes** : Instantly GET /api/v2/leads (filtre campaign + reply status)
- **Response** : `{ leads: ReplyLead[] }`

### `GET /api/replies/[email]`
- **Fichier** : `src/app/api/replies/[email]/route.ts` (108 LOC)
- **But** : Thread email complet pour un lead
- **Params** : `email` (path param)
- **API externes** : Instantly Unbox API (custom endpoint pour threads)
- **Response** : `{ emails: EmailThread[] }`

---

## Custom Data

### `POST /api/custom-verticales`
- **Fichier** : `src/app/api/custom-verticales/route.ts` (76 LOC)
- **But** : Ajouter une verticale (niche) custom
- **Body** : `{ name: "Osteopathe", emoji: "🦴", google_maps_categories: ["osteopath"] }`
- **Supabase** : INSERT `gtm_custom_verticales`

### `POST /api/custom-villes`
- **Fichier** : `src/app/api/custom-villes/route.ts` (53 LOC)
- **But** : Ajouter une ville custom
- **Body** : `{ name: "Marseille" }`
- **Supabase** : UPSERT `gtm_custom_villes` (onConflict: name)

---

## Stats

### `GET /api/stats`
- **Fichier** : `src/app/api/stats/route.ts` (137 LOC)
- **But** : Aggregation pour le dashboard
- **Supabase** : SELECT `gtm_leads` (count, group by category/city)
- **Response** :
  ```json
  {
    "total": 5000,
    "withEmail": 1200,
    "withPhone": 800,
    "withWebsite": 4500,
    "byCategory": { "dentiste": 500, "plombier": 300 },
    "byCity": { "Paris": 1000, "Lyon": 500 },
    "enrichmentStats": { "pending": 3000, "enriched": 1200, "failed": 500, "skipped": 300 }
  }
  ```

---

## Resume

| Domaine | Routes | Methodes | SSE Streaming |
|---------|--------|----------|---------------|
| Scraping | 2 | GET, POST | OUI (stream) |
| Enrichment | 5 | GET, POST | OUI (v2/stream) |
| Leads | 2 | GET, POST | NON |
| Campaigns | 2 | GET, POST | NON |
| Orchestrate | 3 | GET, POST | OUI (stream) |
| Replies | 2 | GET | NON |
| Custom Data | 2 | POST | NON |
| Stats | 1 | GET | NON |
| **TOTAL** | **21** | | **3 SSE** |

---

*Derniere mise a jour : 2025-02-24*
