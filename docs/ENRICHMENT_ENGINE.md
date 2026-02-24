# Enrichment Engine — Waterfall Pipeline Deep Dive

> 7 sources, 3313 lignes, cascade free → freemium → paid.
> Coeur du systeme : transforme un lead (nom + website) en contact qualifie (email + phone + SIRET + dirigeant).

---

## Architecture

```
POST /api/enrich/v2/stream
  │
  ├── SELECT leads WHERE enrichment_status = 'pending'
  │
  └── Pour chaque lead (batch de 3 en parallele) :
      │
      ├── Promise.race([ runWaterfall(lead), timeout(120s) ])
      │   │
      │   ├── Source 1: DNS Intel ─────── MX check, provider detection
      │   │   └── Si pas de MX → skip toutes les sources email
      │   │
      │   ├── Source 2: Schema.org ────── JSON-LD structured data
      │   │
      │   ├── Source 3: Deep Scrape ───── HTML regex multi-pages
      │   │
      │   ├── Source 4: SIRENE/INSEE ──── Registre entreprises FR
      │   │
      │   ├── Source 5: Email Permutation  Genere + verifie emails
      │   │
      │   ├── Source 6: Google Dork ───── Google CSE (disabled default)
      │   │
      │   └── Source 7: Kaspr ─────────── LinkedIn (paid, opt-in)
      │
      ├── Calcul confidence agregee
      │   └── Si confidence >= seuil (80) → early stop
      │
      ├── UPDATE gtm_leads (fire-and-forget)
      │
      └── SSE event (lead_done | lead_error)
```

---

## Registre des Sources

| # | Source | Fichier | LOC | Priorite | Cout | Confidence Base | API Externe |
|---|--------|---------|-----|----------|------|----------------|-------------|
| 1 | DNS Intel | `sources/dns-intel.ts` | 225 | 1 | FREE | 30 | Google DNS (`dns.google/resolve`) |
| 2 | Schema.org | `sources/schema-org.ts` | 333 | 2 | FREE | 85 | Fetch direct du website |
| 3 | Deep Scrape | `sources/deep-scrape.ts` | 305 | 3 | FREE | 65 | Fetch 5 pages du website |
| 4 | SIRENE | `sources/sirene.ts` | 273 | 4 | FREE | 90 | `recherche-entreprises.api.gouv.fr` |
| 5 | Email Permutation | `sources/email-permutation.ts` | 251 | 5 | FREEMIUM | 50 | `api.eva.pingutil.com` |
| 6 | Google Dork | `sources/google-dork.ts` | 225 | 6 | FREEMIUM | 55 | Google CSE (100/jour) |
| 7 | Kaspr | `sources/kaspr.ts` | 244 | 7 | PAID | 88 | `api.developers.kaspr.io` |
| - | LinkedIn Finder | `sources/linkedin-finder.ts` | 177 | helper | FREEMIUM | - | Apollo + Google CSE |

**Fichiers partages** :
- `waterfall.ts` (356 LOC) — Orchestrateur
- `confidence.ts` (203 LOC) — Scoring
- `types.ts` (168 LOC) — Interfaces
- `index.ts` (36 LOC) — Exports

---

## Source 1 : DNS Intel

**But** : Pre-check MX/SPF. Determine si le domaine peut recevoir des emails.

**API** : `GET https://dns.google/resolve?name={domain}&type=MX` (public, no auth)

**Champs extraits** :
- `hasMx` (bool) — le domaine a des enregistrements MX
- `mxProvider` — provider detecte (Google, Microsoft, OVH... 24 providers hardcodes)
- `mx_records` — liste MX (max 5)
- `spf_providers` — providers detectes dans le SPF
- `uses_marketing_email` — outils marketing dans SPF (Brevo, SendGrid...)

**Effet special** : Si `hasMx = false`, le flag `skipEmailSources` est leve → les sources 2/3/5 skipperont la recherche d'email pour ce domaine.

**Timeout** : 5s par lookup DNS

---

## Source 2 : Schema.org

**But** : Extraire les donnees structurees JSON-LD du site web.

**API** : Fetch direct `GET {lead.website}/` (8s timeout)

**Champs extraits** :
- `email` — depuis JSON-LD ou ContactPoint
- `phone` — depuis JSON-LD ou ContactPoint
- `dirigeant` — founder/employee name
- `business_name` — nom commercial
- `address` — adresse

**Logique** :
1. Fetch HTML du site
2. Regex `<script type="application/ld+json">` → extraire blocs JSON-LD
3. Pour chaque bloc : chercher types business (26 types : LocalBusiness, Organization, etc.)
4. Extraire email/phone/founder

**Filtres** : 26 domaines exclus (example.com, sentry.io, wixpress.com, etc.)

---

## Source 3 : Deep Scrape

**But** : Scraper 5 pages (/, /contact, /about, /mentions-legales, /nous-contacter) avec regex.

**API** : Fetch direct des 5 pages en parallele (8s timeout chacune)

**Champs extraits** :
- `emails` — depuis `mailto:` + regex + deobfuscation (8 patterns : [at], (at), {at}, [dot], etc.)
- `phones` — depuis `tel:` + regex phone FR (`+33/0033/0`)

**Ranking emails** :
1. Same-domain > personal > generic (contact@/info@)
2. Depuis `mailto:` = plus haute qualite

**Filtres** : Prefixes exclus (noreply, no-reply, webmaster, support@wordpress...), 26 domaines exclus

---

## Source 4 : SIRENE/INSEE

**But** : Registre officiel des entreprises francaises (40M+).

**API** : `GET https://recherche-entreprises.api.gouv.fr/search?q={name}&commune={city}&etat_administratif=A` (public, no auth)

**Champs extraits** :
- `siret` (14 chiffres)
- `dirigeant` — CEO/gerant/president (selection par priorite de role)
- `dirigeantFirstName` / `dirigeantLastName`
- `siren`, `nom_complet`, `activite_principale`, `adresse`, `commune`, `code_postal`
- `effectif`, `date_creation`, `nature_juridique`

**Selection dirigeant** : Priorite gerant > gerante > president > presidente > directeur general > ...
Filtre : `type_dirigeant == "personne physique"` (personne reelle, pas societe)

**Normalisation** : Supprime suffixes legaux (SARL, SAS, SA, EURL, etc.) du nom avant recherche

---

## Source 5 : Email Permutation

**But** : Generer 12 permutations email (prenom.nom@domain) et verifier via API.

**API verification** : `GET https://api.eva.pingutil.com/email?email={email}` (public, 5s timeout)

**12 patterns** (exemple : Jean Dupont @ example.fr) :
1. jean.dupont@ — 2. jeandupont@ — 3. j.dupont@ — 4. jdupont@
5. dupont.jean@ — 6. dupontjean@ — 7. jean@ — 8. dupont@
9. jean-dupont@ — 10. jean_dupont@ — 11. jd@ — 12. contact@ (fallback)

**Logique** :
1. Generer 12 permutations
2. Verifier les 6 premieres via eva.pingutil.com
3. Preference : SMTP-verified > syntax-valid
4. Stop a la premiere email SMTP-verifiee

**Fallback** : Si pas de nom de dirigeant → tente seulement `contact@{domain}`

---

## Source 6 : Google Dork (disabled par defaut)

**But** : Chercher des emails mentionnes sur des pages externes via Google CSE.

**API** : `GET https://www.googleapis.com/customsearch/v1?key=...&cx=...&q="@{domain}" email&num=5`

**Champs extraits** :
- `email` — depuis les snippets Google (title + snippet + link)
- `linkedinUrl` — URLs LinkedIn trouvees dans les resultats

**Quota** : 100 queries/jour free tier. Non suivi dans le code.

**Desactive par defaut** car le quota est trop limite pour du batch.

---

## Source 7 : Kaspr (opt-in, paid)

**But** : LinkedIn → email + phone verifie (500M+ contacts).

**API** : `POST https://api.developers.kaspr.io/profile/linkedin`
Auth : `Authorization: {API_KEY}` (raw, PAS Bearer)

**Pre-requis** : URL LinkedIn du dirigeant (trouvee par sources precedentes ou linkedin-finder)

**Champs extraits** :
- `email` — selection : work verified > work > direct verified > direct > personal
- `phone` — premier disponible
- `dirigeant` — full_name depuis Kaspr

**Guards** :
1. KASPR_API_KEY configure
2. LinkedIn URL disponible dans le contexte
3. `useKaspr = true` (opt-in)
4. `lead.score >= minScoreForPaid`

**Cout** : 1 credit par resultat

---

## LinkedIn Finder (helper)

**But** : Trouver l'URL LinkedIn d'un decideur. Utilise par Kaspr.

**Strategies** (dans l'ordre) :
1. **Apollo People Match** : `POST https://api.apollo.io/v1/people/match` (X-Api-Key)
2. **Google CSE Dork** : `site:linkedin.com/in "{name}" "{company}"` (partage le quota de 100/jour)
3. ~~Direct construction~~ (desactive — trop peu fiable)

---

## Confidence Scoring

### Bases par source

| Source | Base |
|--------|------|
| SIRENE | 90 |
| Kaspr | 88 |
| Schema.org | 85 |
| Deep Scrape | 65 |
| Google Dork | 55 |
| Email Permutation | 50 |
| DNS Intel | 30 |

### Bonus / Penalites

| Modificateur | Valeur | Condition |
|-------------|--------|-----------|
| Same domain | +15 | Email domain = lead website domain |
| Generic prefix | -10 | contact@, info@, accueil@ |
| Has phone | +5 | Email + telephone trouves |
| Has SIRET | +5 | SIRET confirme |
| Has dirigeant | +5 | Nom dirigeant trouve |
| SMTP verified | +20 | Email verifie par SMTP |
| Multi-source | +20 | Meme email trouve par 2+ sources |

### Formule finale
```
confidence = max(toutes_sources) + multi_source_bonus
clamp(0, 100)
```

### Early stop
Si `aggregateConfidence >= stopOnConfidence` (default 80) → arrete le waterfall pour ce lead.

---

## Timeouts

| Niveau | Valeur | Mecanisme |
|--------|--------|-----------|
| Per-source | 10s (configurable) | `Promise.race([source(), delay(10000)])` |
| Per-lead | 120s | `Promise.race([waterfall(), delay(120000)])` |
| DNS lookup | 5s | Fetch avec AbortController |
| HTML fetch | 8s | Fetch avec AbortController |
| Kaspr API | 15s | Timeout specifique (API lente) |

---

## SSE Events (8 types)

| Event | Payload | Quand |
|-------|---------|-------|
| `job_created` | `{ jobId, totalLeads }` | Job cree en DB |
| `lead_start` | `{ leadId, name, website, index, total }` | Lead en cours |
| `lead_done` | `{ leadId, bestEmail, bestPhone, dirigeant, siret, confidence, sourcesTried, status }` | Lead enrichi/echoue |
| `lead_error` | `{ leadId, name, error, status }` | Lead timeout/crash |
| `progress` | `{ processed, total, enriched, failed, skipped, percent }` | Apres chaque batch |
| `db_warning` | `{ leadId?, error, phase }` | Erreur Supabase (non-fatal) |
| `done` | `{ processed, enriched, failed, skipped, summary, sourceStats }` | Job termine |
| `error` | `{ message }` | Erreur fatale (stream ferme) |

---

## Lifecycle `enrichment_status`

```
                 ┌─────────┐
   Nouveau lead  │ pending │  ← defaut
                 └────┬────┘
                      │
              runWaterfall()
                      │
        ┌─────────────┼─────────────┐
        │             │             │
   email/phone     rien trouve    timeout
     trouve                      (>120s)
        │             │             │
   ┌────▼────┐  ┌─────▼─────┐  ┌───▼────┐
   │enriched │  │  failed   │  │skipped │
   └─────────┘  └───────────┘  └────────┘

Notes :
- Seuls les "pending" sont requetes pour enrichissement
- "failed" et "skipped" ne sont PAS re-enrichis automatiquement
- Pas encore de bouton "re-essayer les echoues" (TODO)
```

---

## DB Writes Pattern

### Fire-and-forget
Les UPDATE Supabase sont lances sans `await` dans le stream :
```typescript
supabase.from("gtm_leads").update({ ... }).eq("id", leadId)
  .then(({ error }) => { if (error) emit("db_warning", { ... }) })
```

**Avantage** : Stream rapide, pas de blocage
**Risque** : Si Supabase down, leads apparaissent enrichis dans le SSE mais pas en DB

### Ordre des writes
1. UPDATE lead (email, phone, status) — apres chaque lead
2. UPDATE job (progress_processed, progress_enriched) — apres chaque batch
3. UPDATE job (status=completed, summary, source_stats) — a la fin

---

## Recommandations d'Amelioration

1. **Race condition enrichment_attempts** : Utiliser `enrichment_attempts = enrichment_attempts + 1` atomique (RPC Supabase)
2. **Google Dork query secondaire** : Le code definit 2 queries mais n'execute que la premiere — code mort
3. **Quota tracking Google CSE** : Implementer un compteur, emettre un warning a 80%
4. **Retry des leads skipped** : Bouton pour flip `skipped` → `pending` apres N heures
5. **Batch size adaptatif** : Ajuster le parallelisme (3 actuellement) selon la vitesse des sources
6. **Meilleure deobfuscation email** : Ajouter patterns manquants (@@, /at/, <at>)
7. **Phone regex international** : Supporter +41, +49, +44 en plus de +33
8. **SIRET checksum** : Valider le format 14 chiffres avec l'algo INSEE

---

*Derniere mise a jour : 2025-02-24 — Post-refonte enrichissement v2*
