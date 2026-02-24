# Supabase Schema — 5 Tables

> Project ID : `cifxffapwtksxhaphepv`
> Acces : Supabase JS Client (REST), anon key, pas de SDK auth.
> Pas de migrations locales — schema gere dans Supabase Dashboard.

---

## Table 1 : `gtm_leads` — Leads principaux

La table centrale du projet. Contient tous les leads scraped + enrichis.

### Colonnes

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| `id` | UUID | NON | gen_random_uuid() | PK |
| `name` | TEXT | OUI | NULL | Nom du business |
| `city` | TEXT | OUI | NULL | Ville |
| `phone` | TEXT | OUI | NULL | Telephone (format +33...) |
| `website` | TEXT | OUI | NULL | URL du site web |
| `email` | TEXT | OUI | NULL | Email enrichi |
| `category` | TEXT | OUI | NULL | Verticale/niche (ex: "dentiste") |
| `rating` | NUMERIC | OUI | NULL | Note Google Maps (1-5) |
| `reviews` | INTEGER | OUI | NULL | Nombre d'avis Google |
| `score` | INTEGER | OUI | NULL | Score qualite lead |
| `address` | TEXT | OUI | NULL | Adresse complete |
| `google_maps_url` | TEXT | OUI | NULL | URL Google Maps (dedup key) |
| `source` | TEXT | OUI | NULL | Origine du lead |
| `apify_run` | TEXT | OUI | NULL | Legacy : ID run Apify |
| `siret` | TEXT | OUI | NULL | SIRET 14 chiffres (SIRENE) |
| `dirigeant` | TEXT | OUI | NULL | Nom du dirigeant/gerant |
| `dirigeant_linkedin` | TEXT | OUI | NULL | URL LinkedIn du dirigeant |
| `mx_provider` | TEXT | OUI | NULL | Provider email (Google, Microsoft...) |
| `has_mx` | BOOLEAN | OUI | NULL | Domaine a des MX records |
| `enrichment_source` | TEXT | OUI | NULL | Sources qui ont enrichi (csv) |
| `enrichment_confidence` | INTEGER | OUI | NULL | Score confidence 0-100 |
| `enriched_at` | TIMESTAMPTZ | OUI | NULL | Date d'enrichissement |
| `enrichment_status` | TEXT | OUI | 'pending' | Statut : pending/enriched/failed/skipped |
| `enrichment_attempts` | INTEGER | OUI | 0 | Nombre de tentatives |
| `enrichment_failed_at` | TIMESTAMPTZ | OUI | NULL | Date du dernier echec |
| `created_at` | TIMESTAMPTZ | NON | now() | Date creation |
| `updated_at` | TIMESTAMPTZ | OUI | NULL | Derniere modification |

### Valeurs `enrichment_status`

| Valeur | Signification | Condition |
|--------|--------------|-----------|
| `pending` | Jamais enrichi, eligible | Defaut |
| `enriched` | Enrichi avec succes | Email ou phone trouve |
| `failed` | Tentative echouee | Rien trouve apres waterfall |
| `skipped` | Skip technique | Timeout (>120s) ou erreur |

### Index

| Index | Colonne(s) | But |
|-------|-----------|-----|
| `idx_gtm_leads_enrichment_status` | `enrichment_status` | Filtre rapide pour enrichissement |
| PK index | `id` | Lookup par ID |

### Fichiers qui lisent/ecrivent

| Fichier | Operations |
|---------|-----------|
| `src/app/api/leads/route.ts` | SELECT avec filtres (city, category, hasEmail, enrichmentStatus) |
| `src/app/api/enrich/v2/stream/route.ts` | SELECT pending, UPDATE apres enrichissement |
| `src/app/api/enrich/route.ts` | SELECT + UPDATE (legacy) |
| `src/app/api/scrape/stream/route.ts` | INSERT (nouveaux leads scrapes) |
| `src/app/api/stats/route.ts` | SELECT aggregate (count, group by) |
| `src/app/api/launch/route.ts` | SELECT + UPDATE campaign_id |
| `src/app/api/orchestrate/stream/route.ts` | SELECT + UPDATE |
| `src/lib/leads-data.ts` | Types + mapping |
| `src/lib/lead-utils.ts` | Helpers validation |

### Requetes frequentes

```typescript
// Leads pour enrichissement (seulement pending)
supabase.from("gtm_leads")
  .select("id, name, website, email, phone, city, category, score, enrichment_attempts")
  .not("website", "is", null)
  .neq("website", "")
  .or("email.is.null,email.eq.")
  .eq("enrichment_status", "pending")
  .limit(50)

// Leads avec filtres multi-select
supabase.from("gtm_leads")
  .select("*")
  .or("category.ilike.%dentiste%,category.ilike.%plombier%")
  .ilike("city", "%Paris%")

// Stats aggregees
supabase.from("gtm_leads").select("*", { count: "exact", head: true })
```

---

## Table 2 : `gtm_scraping_jobs` — Jobs de scraping

Tracking des jobs de scraping Google Maps.

### Colonnes

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| `id` | UUID | NON | gen_random_uuid() | PK |
| `status` | TEXT | OUI | 'running' | running/completed/failed |
| `verticale_ids` | JSONB | OUI | NULL | IDs des verticales scrapes |
| `villes` | JSONB | OUI | NULL | Villes scrapes |
| `total_combos` | INTEGER | OUI | 0 | Nombre de combos verticale x ville |
| `processed_combos` | INTEGER | OUI | 0 | Combos traites |
| `total_new_leads` | INTEGER | OUI | 0 | Leads trouves (nouveaux) |
| `total_duplicates` | INTEGER | OUI | 0 | Leads deja existants |
| `created_at` | TIMESTAMPTZ | NON | now() | Date creation |
| `updated_at` | TIMESTAMPTZ | OUI | NULL | Derniere modification |

### Fichiers

| Fichier | Operations |
|---------|-----------|
| `src/app/api/scrape/stream/route.ts` | INSERT + UPDATE (progression) |
| `src/app/api/scrape/jobs/route.ts` | SELECT (historique) |

---

## Table 3 : `gtm_enrichment_jobs` — Jobs d'enrichissement

Tracking des jobs d'enrichissement waterfall.

### Colonnes

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| `id` | UUID | NON | gen_random_uuid() | PK |
| `status` | TEXT | OUI | 'running' | running/completed/failed |
| `lead_count` | INTEGER | OUI | 0 | Total leads a enrichir |
| `progress_processed` | INTEGER | OUI | 0 | Leads traites |
| `progress_enriched` | INTEGER | OUI | 0 | Leads enrichis avec succes |
| `summary` | JSONB | OUI | NULL | Stats finales (emails, phones, avg confidence) |
| `source_stats` | JSONB | OUI | NULL | Stats par source (tried, found) |
| `lead_results` | JSONB | OUI | NULL | Resultats par lead |
| `error` | TEXT | OUI | NULL | Message d'erreur si echec |
| `completed_at` | TIMESTAMPTZ | OUI | NULL | Date completion |
| `created_at` | TIMESTAMPTZ | NON | now() | Date creation |
| `updated_at` | TIMESTAMPTZ | OUI | NULL | Derniere modification |

### Fichiers

| Fichier | Operations |
|---------|-----------|
| `src/app/api/enrich/v2/stream/route.ts` | INSERT + UPDATE (progression + completion) |
| `src/app/api/enrich/jobs/route.ts` | SELECT (polling fallback) |

---

## Table 4 : `gtm_custom_verticales` — Verticales custom

Niches ajoutees par l'utilisateur (en plus des defaut).

### Colonnes

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| `id` | UUID | NON | gen_random_uuid() | PK |
| `name` | TEXT | NON | - | Nom de la verticale |
| `emoji` | TEXT | OUI | NULL | Emoji affiche |
| `google_maps_categories` | JSONB | OUI | NULL | Categories Google Maps |
| `created_at` | TIMESTAMPTZ | NON | now() | Date creation |

### Fichiers

| Fichier | Operations |
|---------|-----------|
| `src/app/api/custom-verticales/route.ts` | INSERT + SELECT |
| `src/app/api/scrape/stream/route.ts` | SELECT (merge avec defaut) |

---

## Table 5 : `gtm_custom_villes` — Villes custom

Villes ajoutees par l'utilisateur.

### Colonnes

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| `name` | TEXT | NON | - | Nom de la ville (UNIQUE) |
| `created_at` | TIMESTAMPTZ | NON | now() | Date creation |

### Fichiers

| Fichier | Operations |
|---------|-----------|
| `src/app/api/custom-villes/route.ts` | UPSERT (onConflict: name) |
| `src/app/api/scrape/stream/route.ts` | SELECT |

---

## Patterns Supabase

### Client Init
```typescript
// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

### Filtre OR multi-valeurs
```typescript
// Pour filtrer par categories multiples
const orFilter = categories.map(c => `category.ilike.%${c}%`).join(",");
query = query.or(orFilter);
```

### Upsert avec dedup
```typescript
// Villes custom — insert ou ignore si existe
supabase.from("gtm_custom_villes")
  .upsert({ name: "Marseille" }, { onConflict: "name" })
```

### Fire-and-forget update
```typescript
// Pattern enrichissement — pas de await
supabase.from("gtm_leads")
  .update({ email, enrichment_status: "enriched" })
  .eq("id", leadId)
  .then(({ error }) => {
    if (error) emitSSE("db_warning", { leadId, error: error.message });
  });
```

---

*Derniere mise a jour : 2025-02-24*
