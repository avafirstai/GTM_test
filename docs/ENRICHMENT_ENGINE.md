# Enrichment Engine — Waterfall Pipeline Deep Dive

> 8 sources + 1 helper, ~4000 lignes, cascade free → freemium → paid.
> Coeur du systeme : transforme un lead (nom + website) en contact qualifie (email + phone + SIRET + dirigeant).
> Regle d'or : **QUALITE > VITESSE**. Le pipeline prend le temps necessaire pour atteindre Kaspr.

*Derniere mise a jour : 2026-02-25 — Post multi-dirigeant + Kaspr pipeline fix*

---

## Architecture

```
POST /api/enrich/v2/stream (batch SSE) ou /api/enrich/v2/single (1 lead)
  │
  ├── SELECT leads WHERE enrichment_status = 'pending'
  │   └── + decision_makers, email_dirigeant, dirigeant, dirigeant_linkedin (preserve existants)
  │
  └── Pour chaque lead :
      │
      ├── runWaterfall(lead, config) — 8 sources en cascade
      │   │
      │   ├── Source 1: DNS Intel ──────── MX check, provider detection
      │   │   └── Si pas de MX → skip sources email (email_perm, google_dork, kaspr)
      │   │
      │   ├── Source 2: Schema.org ─────── JSON-LD structured data (email, phone, founder)
      │   │
      │   ├── Source 3: Deep Scrape ────── HTML regex multi-pages + extraction NOMS DIRIGEANTS
      │   │   └── 3 strategies : HTML structure, "Name – Title", proximity search
      │   │   └── Scrape 13 URLs : /, /contact, /equipe, /mentions-legales, etc.
      │   │
      │   ├── Source 4: SIRENE/INSEE ───── Registre officiel FR → SIRET + DIRIGEANTS
      │   │   └── Extrait TOUS les dirigeants physiques (gerant > president > directeur)
      │   │
      │   ├── Source 5: Email Permutation ─ Genere prenom.nom@ + verifie SMTP
      │   │   └── Multi-DM : genere pour chaque DM sans email (max 5 DMs)
      │   │
      │   ├── Source 6: Google Dork ────── Google CSE → LinkedIn URLs pour DMs
      │   │   └── Query: site:linkedin.com/in "Nom Dirigeant" "Entreprise"
      │   │   └── Assigne linkedinUrl directement sur les DM objects
      │   │
      │   ├── Source 7: LinkedIn Search ── Backup LinkedIn finder (Google CSE)
      │   │   └── Cherche LinkedIn pour DMs sans URL (max 2 DMs)
      │   │
      │   └── Source 8: Kaspr ─────────── LinkedIn → Email verifie + Phone
      │       └── Multi-DM : appelle Kaspr pour chaque DM avec LinkedIn URL (max 3 DMs)
      │       └── Confidence 88 — emails cross-references sur 150+ sources
      │
      ├── mergeDecisionMakers(existingDMs, newDMs) — JAMAIS perdre de donnees
      │
      ├── classifyEmails(global vs dirigeant)
      │   └── bestEmail = emailDirigeant ?? emailGlobal
      │
      ├── UPDATE gtm_leads (await — persistence garantie)
      │
      └── SSE event (lead_done | lead_error)
```

---

## Pipeline Multi-Dirigeant (LE COEUR)

Le pipeline est concu pour trouver PLUSIEURS decideurs par entreprise, pas juste un :

```
Deep Scrape         → trouve noms (Max 5) : "Jean Dupont — Gerant", "Marie Martin — Directrice"
                          ↓
SIRENE              → confirme/ajoute dirigeants officiels (gerant, president, etc.)
                          ↓
updateAccumulated() → MERGE field-level : meme nom = fusionner, nouveau nom = ajouter
                          ↓
Email Permutation   → genere prenom.nom@domain pour chaque DM sans email (max 5 DMs)
                          ↓
Google Dork         → site:linkedin.com/in "Nom" "Entreprise" (max 2 DMs)
                     → assigne linkedinUrl sur les DM objects
                          ↓
LinkedIn Search     → backup: findLinkedInUrl() via Google CSE (max 2 DMs)
                          ↓
Kaspr               → POST /profile/linkedin pour chaque DM avec LinkedIn URL (max 3 DMs)
                     → retourne email verifie (88% confiance) + phone
                          ↓
updateAccumulated() → merge: email + phone + linkedinUrl sur chaque DM
                          ↓
Resultat final      → Array de DecisionMakerData[] — chacun avec email, phone, linkedin, titre
```

### Merge Rules (updateAccumulated)

- **Matching** : normalized name (NFD, accents retires, lowercase)
- **Merge** : non-null ecrase null, confiance superieure gagne
- **Ajout** : nom inconnu = nouveau DecisionMaker dans l'array
- **Jamais de perte** : array final >= array existant

---

## Fichiers Cles

| Fichier | LOC | Responsabilite |
|---------|-----|----------------|
| `src/lib/enrichment/types.ts` | 199 | Types partages : EnrichmentResult, WaterfallConfig, DecisionMakerData |
| `src/lib/enrichment/waterfall.ts` | 550 | Orchestrateur : runWaterfall(), updateAccumulated(), classifyEmails() |
| `src/lib/enrichment/confidence.ts` | 204 | Scoring : computeConfidence(), selectBestEmail() |
| `src/lib/enrichment/sources/dns-intel.ts` | 226 | Source 1 : MX/SPF check |
| `src/lib/enrichment/sources/schema-org.ts` | 334 | Source 2 : JSON-LD extraction |
| `src/lib/enrichment/sources/deep-scrape.ts` | 542 | Source 3 : HTML scraping multi-pages |
| `src/lib/enrichment/sources/sirene.ts` | 307 | Source 4 : Registre INSEE |
| `src/lib/enrichment/sources/email-permutation.ts` | 307 | Source 5 : Permutations + SMTP verify |
| `src/lib/enrichment/sources/google-dork.ts` | 285 | Source 6 : Google CSE dorking |
| `src/lib/enrichment/sources/linkedin-finder.ts` | 90 | Helper : trouver LinkedIn URLs |
| `src/lib/enrichment/sources/kaspr.ts` | 306 | Source 8 : Kaspr API (paid) |
| `src/app/api/enrich/v2/stream/route.ts` | 663 | Endpoint SSE : batch enrichissement |

---

## Configuration par Defaut

```typescript
DEFAULT_SOURCES (8 sources en ordre de priorite) :
  1. dns_intel      (free,     priority 1)
  2. schema_org     (free,     priority 2)
  3. deep_scrape    (free,     priority 3)
  4. sirene         (fr_public, priority 4)
  5. email_permutation (fr_public, priority 5)
  6. google_dork    (freemium, priority 6)
  7. linkedin_search (freemium, priority 7)
  8. kaspr          (paid,     priority 8)

DEFAULT_WATERFALL_CONFIG :
  stopOnConfidence: 80
  maxSources: 8
  timeoutPerSource: 300_000ms (5 min par source — qualite > vitesse)
  useKaspr: true
  minScoreForPaid: 30
```

---

## Confidence Scoring (0-100)

### Scores de Base par Source

| Source | Base | Justification |
|--------|------|---------------|
| pappers | 95 | Registre officiel (non implemente) |
| sirene | 90 | Registre gouvernemental FR |
| kaspr | 88 | 500M+ contacts, cross-ref 150+ sources |
| schema_org | 85 | Donnees structurees du site officiel |
| deep_scrape | 65 | Regex HTML — peut etre bruite |
| google_dork | 55 | Recherche web indirecte |
| email_permutation | 50 | Pattern genere, verification variable |
| linkedin_search | 40 | Metadata seulement |
| dns_intel | 30 | Metadata MX, pas de contact |

### Bonus / Penalites

| Condition | Ajustement |
|-----------|-----------|
| Email same-domain que le lead | +15 |
| SMTP verification passe | +20 |
| Email generique (contact@, info@, accueil@) | -10 |
| Phone trouve en plus | +5 |
| SIRET trouve en plus | +5 |
| Dirigeant trouve en plus | +5 |
| Meme email par 2+ sources | +20 (multi-source bonus) |

### Confidence Agregee

```
aggregateConfidence = max(individual confidences) + multi_source_bonus
```

Si le meme email est trouve par 2+ sources → +20 bonus (signal tres fort).
Clampe a 0-100.

---

## Source 1 : DNS Intelligence

**Fichier** : `src/lib/enrichment/sources/dns-intel.ts` (226 LOC)
**Cout** : GRATUIT (Google Public DNS API)
**But** : Determiner si le domaine recoit des emails. Circuit breaker pour le pipeline.

### Outputs
- `hasMx: boolean` — le domaine a des MX records
- `mxProvider: string | null` — provider detecte (google, microsoft, ovh, zoho, etc.)
- `skipEmailSources: boolean` — **CLE** : si pas de MX, les sources email downstream sont skippees

### Fonctionnement
1. Requete Google DNS API pour MX records du domaine
2. Requete TXT records pour analyse SPF
3. Detection provider par pattern matching (24 providers connus)
4. Extraction providers marketing depuis SPF includes

### Impact sur le Pipeline
Si `skipEmailSources = true` (pas de MX) :
- email_permutation → SKIP
- google_dork → SKIP
- kaspr → SKIP

Economise des credits et evite le bruit sur des domaines sans email.

---

## Source 2 : Schema.org / JSON-LD

**Fichier** : `src/lib/enrichment/sources/schema-org.ts` (334 LOC)
**Cout** : GRATUIT (fetch + regex, pas d'API)
**But** : Extraire les donnees structurees JSON-LD de la homepage.

### Outputs
- `email`, `phone`, `dirigeant` (founder)
- `metadata` : json_ld_count, business_name, address

### Fonctionnement
1. Fetch HTML de la homepage
2. Extraire tous les blocs `<script type="application/ld+json">`
3. Filtrer par types business (LocalBusiness, Organization, Dentist, Restaurant, etc. — 27+ types)
4. Extraire : email (ContactPoint), phone, founder name
5. Valider contre domaines exclus (example.com, sentry.io, etc.)

### Fiabilite
~30% des sites business FR ont du JSON-LD. Quand present, tres fiable (confidence 85).

---

## Source 3 : Deep HTML Scraping

**Fichier** : `src/lib/enrichment/sources/deep-scrape.ts` (542 LOC)
**Cout** : GRATUIT (fetch + regex)
**But** : Scraper plusieurs pages pour extraire emails, phones, noms de dirigeants.

### Pages Scrapees (13 URLs)
```
/, /contact, /nous-contacter, /contactez-nous,
/about, /a-propos, /qui-sommes-nous,
/mentions-legales, /legal,
/equipe, /notre-equipe, /team, /notre-team, /l-equipe, /lequipe
```

### Extraction Email (3 methodes en cascade)
1. Liens `mailto:` (meilleure qualite)
2. Regex general avec deobfuscation : `[at]→@`, `[dot]→.`, `(at)→@`, `arobase→@`, etc.
3. Meta tags, `link rel="author"`

### Extraction Phone
1. Liens `tel:`
2. Regex francais : prefixe +33/0033/0 + 9 chiffres

### Extraction Dirigeants (3 strategies)
1. **HTML structure** : `<h3>Jean Dupont</h3><p>Gerant</p>` (elements adjacents)
2. **Text pattern** : "Jean Dupont — Gerant" ou "Jean Dupont, Directeur"
3. **Proximity search** : mot-cle titre trouve → scan 200 chars autour pour un nom

### Titres Detectes
```
gerant, fondateur, directeur, president, CEO, PDG, DG, DGA,
co-fondateur, cogérant, associe, managing director, etc.
```

### Outputs
- `email` (meilleur classe par domaine), `phone`
- `dirigeant` (scalar backward compat)
- `dirigeants: DecisionMakerData[]` (max 5)
- `siret` (regex 14 chiffres sur le texte)

---

## Source 4 : SIRENE / INSEE

**Fichier** : `src/lib/enrichment/sources/sirene.ts` (307 LOC)
**Cout** : GRATUIT (recherche-entreprises.api.gouv.fr — pas d'auth)
**But** : Registre officiel FR (40M+ entreprises). SIRET + dirigeants.

### Strategie de Recherche (3 tentatives)
1. Nom entreprise + ville (plus precis)
2. Nom entreprise seul (le siege peut etre ailleurs)
3. Nom de domaine comme query (ex: "dupont-dentiste" depuis dupont-dentiste.fr)

### Extraction Dirigeants
- Filtre `type_dirigeant === "personne physique"` (personnes physiques uniquement)
- Tri par priorite : gerant > president > directeur general > directeur > autre
- Retourne TOUS les dirigeants (pas juste le premier)

### Normalisation Nom Entreprise
Supprime suffixes legaux : SARL, SAS, SA, EURL, SASU, SCI, etc.

### Outputs
- `siret`, `dirigeant`, `dirigeants: DecisionMakerData[]`
- `email: null`, `phone: null` (SIRENE n'a pas de contacts)
- `metadata` : siren, nom_complet, activite_principale, adresse, effectif, date_creation, nature_juridique

### Confidence : 90 (registre gouvernemental)

---

## Source 5 : Email Permutation + Verification

**Fichier** : `src/lib/enrichment/sources/email-permutation.ts` (307 LOC)
**Cout** : FREEMIUM (verification SMTP gratuite via eva.pingutil.com)
**But** : Generer des combinaisons email depuis nom+domaine, puis verifier.

### Permutations Generees (12 patterns, par frequence FR)
```
1.  prenom.nom@domain        (jean.dupont@)
2.  prenom@domain            (jean@)
3.  p.nom@domain             (j.dupont@)
4.  nom.prenom@domain        (dupont.jean@)
5.  nom@domain               (dupont@)
6.  prenomnom@domain         (jeandupont@)
7.  pnom@domain              (jdupont@)
8.  nomprem@domain           (dupontjean@)
9.  prenom-nom@domain        (jean-dupont@)
10. prenom_nom@domain        (jean_dupont@)
11. pn@domain                (jd@ — initiales rares)
12. contact@domain           (fallback generique)
```

### Verification
- API : eva.pingutil.com (SMTP check gratuit)
- Fallback : validation syntaxe seule si API down
- Resultat : `{ email, valid, smtpVerified }`

### Mode Multi-DM
- Tente les permutations pour max 5 DMs sans email
- Met a jour chaque DM avec l'email verifie
- Confidence : 70 (SMTP verifie) ou 50 (syntaxe seule)

### Normalisation Accents
NFD : e→e, a→a, c→c. Supprime tirets et apostrophes.

---

## Source 6 : Google Dork (CSE)

**Fichier** : `src/lib/enrichment/sources/google-dork.ts` (285 LOC)
**Cout** : FREEMIUM (100 queries/jour via Google Custom Search API)
**But** : Trouver emails + LinkedIn URLs via recherche Google.

### Strategies de Query

1. **Mode Multi-DM** : `site:linkedin.com/in "{dm.name}" "{company_name}"` (cap: 2 DMs pour economiser le quota)
2. **Scalar Dirigeant (backward compat)** : `site:linkedin.com/in "{dirigeant}" "{company_name}"`
3. **Fallback (pas de DM)** : `"@domain" email`

### Extractions
- Emails via regex depuis title, snippet, link
- LinkedIn URLs via regex
- Assigne la premiere LinkedIn URL trouvee au DM qui a declenche la recherche

### Limites
- **100 queries/jour** — quota partage avec linkedin_finder
- `MAX_GOOGLE_DORK_DM_QUERIES = 2` (economise le quota)
- Confidence : 55

---

## Source 7 : LinkedIn Search (Helper)

**Fichier** : `src/lib/enrichment/sources/linkedin-finder.ts` (90 LOC)
**But** : Backup pour trouver des URLs LinkedIn via Google CSE.

### Export Principal
`findLinkedInUrl(firstName, lastName, company, domain): Promise<{ url, strategy } | null>`

### Strategie
Google CSE dork — retourne le premier resultat avec `linkedin.com/in/`.
Cherche LinkedIn pour max 2 DMs sans URL.

---

## Source 8 : Kaspr API

**Fichier** : `src/lib/enrichment/sources/kaspr.ts` (306 LOC)
**Cout** : PAYE (1 credit par data point : email pro, email direct, phone)
**But** : Obtenir email verifie + phone depuis un profil LinkedIn.

### API
- Endpoint : `POST https://api.developers.kaspr.io/profile/linkedin`
- Auth : `Authorization: {KASPR_API_KEY}` (raw key, PAS Bearer !)
- Body : `{ name, id: linkedinUrl }`

### Selection Email (par priorite)
1. work + verified
2. work (unverified)
3. direct + verified
4. direct
5. personal

### Mode Multi-DM
- Appelle Kaspr pour max 3 DMs avec LinkedIn URL mais sans email
- Met a jour chaque DM avec email/phone de Kaspr
- Confidence : 88

### Guards
- Requiert `KASPR_API_KEY` en env var
- Requiert `config.useKaspr = true`
- Requiert `lead.score >= config.minScoreForPaid`
- Requiert au moins 1 LinkedIn URL (scalar OU dans un DM)

---

## Waterfall Orchestrator

**Fichier** : `src/lib/enrichment/waterfall.ts` (550 LOC)

### Fonctions Principales

| Fonction | But |
|----------|-----|
| `registerSource(name, fn)` | Enregistre une source dans le registry global |
| `extractDomain(website)` | Parse URL → hostname → supprime www. |
| `runWithTimeout(fn, lead, context, timeoutMs)` | Wrapper timeout autour d'une source |
| `updateAccumulated(context, result)` | Merge incrementiel des resultats dans le contexte |
| `classifyEmails(results, dirigeant, firstName, lastName)` | Separe emailGlobal vs emailDirigeant |
| `runWaterfall(lead, config?)` | **LE MOTEUR** — execute le pipeline complet |
| `runWaterfallBatch(leads, config?, concurrency=3)` | Batch avec concurrence limitee |

### Algorithme runWaterfall

```
1. Initialiser contexte (domain, accumulated data vide)
2. Trier sources par priorite (ascending = executee en premier)
3. Pour chaque source :
   a. Skip si : max sources atteint, Kaspr opt-in fail, pas de LinkedIn pour Kaspr,
      pas de MX et source email, source non enregistree
   b. Executer avec timeout (300s par defaut)
   c. Calculer score de confiance
   d. Mettre a jour contexte accumule (updateAccumulated)
   e. Verifier early-stop (confidence >= threshold)
   f. CRITICAL : NE JAMAIS early-stop avant 8 sources (qualite > vitesse)
4. Retourner resultat agrege : bestEmail, bestPhone, dirigeants[], confidence, sources tried
```

### Regle du "Jamais Early-Stop"

```typescript
MIN_SOURCES_BEFORE_EARLY_STOP = 8
```

Meme si la confiance depasse 80% apres la source 3, le pipeline continue jusqu'a Kaspr (source 8).
**Pourquoi** : un email personnel verifie de Kaspr vaut infiniment plus qu'un email generique contact@ a 80%.

### Classification Emails

```
emailGlobal    = email generique (contact@, info@) OU email non-lie au dirigeant
emailDirigeant = email personnel matchant le nom du dirigeant OU venant de Kaspr/email_permutation
bestEmail      = emailDirigeant ?? emailGlobal
```

---

## API Route (SSE Streaming)

**Fichier** : `src/app/api/enrich/v2/stream/route.ts` (663 LOC)
**Endpoint** : `POST /api/enrich/v2/stream`

### Request Body

```json
{
  "categories": ["dentiste", "plombier"],
  "cities": ["Paris", "Lyon"],
  "leadIds": ["uuid-1", "uuid-2"],
  "limit": 50,
  "sources": ["dns_intel", "schema_org", "sirene"],
  "stopOnConfidence": 80,
  "useKaspr": true,
  "minScoreForPaid": 30,
  "enrichmentFilter": "pending"
}
```

### Filtres d'Enrichissement

| Filtre | Comportement |
|--------|-------------|
| `"pending"` | Defaut — leads sans email, jamais enrichis |
| `"failed"` | Re-enrichir les leads failed/skipped |
| `"no_email"` | Tous les leads sans email, peu importe le statut |
| `"all"` | Force re-enrichissement total |

### SSE Events Emis

| Event | Payload | Quand |
|-------|---------|-------|
| `job_created` | jobId, totalLeads | Job cree en DB |
| `lead_start` | leadId, name, website, index, total | Debut enrichissement d'un lead |
| `lead_done` | leadId, bestEmail, emailDirigeant, confidence, decisionMakers, etc. | Lead enrichi avec succes |
| `lead_error` | leadId, name, error, status | Lead echoue |
| `progress` | processed, total, enriched, failed, skipped, percent | Progression batch |
| `done` | processed, enriched, failed, summary, sourceStats | Batch termine |
| `stopped/paused` | reason, processed, total, summary | Signal pause/stop detecte |
| `db_warning` | leadId, error, phase | Erreur DB non-bloquante |
| `error` | message | Erreur fatale |

### Batch Processing

- `BATCH_SIZE = 3` leads concurrents
- `LEAD_TIMEOUT_MS = 120_000` (2 min par lead)
- Max duree endpoint : 300s (5 min)

### Gestion des Echecs

| Scenario | Status DB | Comportement |
|----------|-----------|-------------|
| Timeout lead | `failed` | enrichment_attempts++ |
| Erreur waterfall | `failed` | Error loggee, pipeline continue |
| Succes avec resultats | `enriched` | Email, phone, siret, dirigeant persistes |
| Succes sans resultats mais DMs existants | `enriched` | Preserve donnees DM existantes |
| Erreur DB sur update | Stream non-bloque | `db_warning` event emis |

### Signal Pause/Stop
- Verifie `gtm_enrichment_jobs.signal` a chaque batch
- Sur `"pause"` ou `"stop"` : emit event, update job, ferme le stream

---

## Gotchas & Patterns Critiques

### 1. Qualite > Vitesse
`MIN_SOURCES_BEFORE_EARLY_STOP = 8`. Le pipeline ne s'arrete JAMAIS avant d'avoir tente les 8 sources. Un email personnel verifie Kaspr vaut plus qu'un contact@ a 80% de confiance.

### 2. MX comme Circuit Breaker
Pas de MX records → email_permutation, google_dork, kaspr SKIP. Economise les credits, evite le bruit.

### 3. Kaspr Opt-In Triple
Kaspr requiert :
- `config.useKaspr = true`
- `lead.score >= config.minScoreForPaid`
- Au moins 1 LinkedIn URL (scalar OU dans un DM)

### 4. Merge Dirigeants : Jamais de Perte
`updateAccumulated()` ne supprime jamais un DM existant. Matching par nom normalise. Non-null ecrase null. Confidence superieure gagne.

### 5. Classification Emails
Kaspr + email_permutation = toujours classe comme `emailDirigeant`. Schema.org/deep_scrape = classe selon le pattern du nom.

### 6. Backward Compatibility
Le champ scalar `dirigeant` est toujours rempli depuis le premier DM. Les anciennes sources retournant juste `dirigeant` (pas `dirigeants[]`) fonctionnent toujours.

### 7. Timeout par Source
300s par source (5 min). Si timeout → result null, log, pipeline continue vers la source suivante. Pas de crash.

### 8. Resilience aux Erreurs
Sources echouees ne crashent pas le pipeline. Leads echoues marques `failed`. Erreurs DB n'arretent pas le stream SSE.

### 9. Pas de PII dans les Logs
Jamais de phone, email complet, ou transcript dans les logs. Seulement : source name, email domain, confidence, duration.

### 10. Multi-Source Bonus
Meme email trouve par 2+ sources → +20 bonus confidence. Signal tres fort de validite.

---

## Types Cles (types.ts)

```typescript
interface DecisionMakerData {
  name: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  source?: string;
  confidence?: number;
}

interface EnrichmentPipelineResult {
  bestEmail: string | null;
  emailGlobal: string | null;
  emailDirigeant: string | null;
  bestPhone: string | null;
  dirigeant: string | null;
  siret: string | null;
  decisionMakers: DecisionMakerData[];
  finalConfidence: number;
  sourcesTried: string[];
  durationMs: number;
}

interface WaterfallConfig {
  sources: EnrichmentSource[];
  stopOnConfidence: number;     // 80 par defaut
  maxSources: number;           // 8
  timeoutPerSource: number;     // 300_000ms
  useKaspr: boolean;            // true
  minScoreForPaid: number;      // 30
}
```

---

## Resume

| Aspect | Valeur |
|--------|--------|
| Sources totales | 8 + 1 helper |
| Sources gratuites | 4 (DNS, Schema.org, Deep Scrape, SIRENE) |
| Sources freemium | 2 (Email Permutation, Google Dork — 100/jour) |
| Sources payantes | 1 (Kaspr — 1 credit/data point) |
| Concurrence batch | 3 leads simultanement |
| Timeout par lead | 120s |
| Timeout par source | 300s |
| Early-stop | Desactive avant 8 sources (qualite > vitesse) |
| Confidence max | 100 (clamp) |
| Multi-DM max | 5 dirigeants par lead |
| DB table | gtm_leads (email, phone, siret, dirigeant, decision_makers JSONB) |
| Job tracking | gtm_enrichment_jobs (status, progress, signal pause/stop) |

---

*Derniere mise a jour : 2026-02-25*
