# External APIs — 7 Integrations Tierces

> Chaque API externe est documentee : auth, endpoints, shapes, quotas, gotchas.

---

## 1. Google Places API v1 (Scraping)

**But** : Scraper des leads business depuis Google Maps par categorie + ville.

| Propriete | Valeur |
|-----------|--------|
| Base URL | `https://places.googleapis.com/v1/places:searchText` |
| Methode | POST |
| Auth | Header `X-Goog-Api-Key: {GOOGLE_PLACES_API_KEY}` |
| Env var | `GOOGLE_PLACES_API_KEY` |
| Timeout | - |
| Rate limit | 120ms entre requetes (auto-throttle) |
| Cout | ~$32 / 1000 requetes (estimation) |
| Fichier | `src/lib/google-places.ts` |

### Request
```json
{
  "textQuery": "dentiste Paris",
  "languageCode": "fr",
  "regionCode": "FR",
  "pageToken": "..."
}
```
Headers supplementaires : `X-Goog-FieldMask` avec les champs specifiques.

### Response
```json
{
  "places": [{
    "id": "ChIJ...",
    "displayName": { "text": "Cabinet Dentaire Dupont" },
    "formattedAddress": "12 rue...",
    "nationalPhoneNumber": "01 23 45 67 89",
    "internationalPhoneNumber": "+33 1 23 45 67 89",
    "websiteUri": "https://cabinet-dupont.fr",
    "rating": 4.5,
    "userRatingCount": 120,
    "types": ["dentist", "health"],
    "googleMapsUri": "https://maps.google.com/?cid=..."
  }],
  "nextPageToken": "..."
}
```

### Gotchas
- Pagination : max 3 pages = 60 resultats par query
- `nextPageToken` absent = derniere page
- Dedup par `id` (Google Place ID)
- Le field mask est obligatoire sinon reponse vide

---

## 2. Instantly.ai API v2 (Campagnes Cold Email)

**But** : Gerer les campagnes cold email — creer, lancer, uploader leads, suivre analytics.

| Propriete | Valeur |
|-----------|--------|
| Base URL | `https://api.instantly.ai/api/v2` |
| Auth | Header `Authorization: Bearer {INSTANTLY_API_KEY}` |
| Env var | `INSTANTLY_API_KEY`, `INSTANTLY_CAMPAIGN_ID` (optionnel) |
| Timeout | 30s |
| Fichier principal | `src/lib/lead-utils.ts` (`instantlyFetch()`) |

### Endpoints

#### GET /campaigns?limit=100
**But** : Lister toutes les campagnes
**Response** : `{ items: [{ id, name, status, timestamp }] }`

#### GET /campaigns/analytics?id=X&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
**But** : Analytics d'une campagne (12 derniers mois)
**Response** : Objet OU tableau (gerer les deux !) avec :
```json
{
  "campaign_id": "...",
  "total_leads": 500,
  "contacted": 450,
  "emails_sent": 1200,
  "emails_read": 540,
  "replied": 65,
  "bounced": 12,
  "unsubscribed": 3,
  "leads_who_read": 320,
  "leads_who_replied": 55
}
```

#### GET /accounts?limit=100
**But** : Lister les comptes email
**Response** : `{ items: [...] }` OU tableau nu (gerer les deux !)
```json
[{ "id": "...", "email": "john@company.com", "status": 1, "warmup_status": "completed", "daily_limit": 30 }]
```

#### POST /leads
**But** : Upload batch de leads dans une campagne
**Body** :
```json
{
  "campaign_id": "...",
  "skip_if_in_workspace": true,
  "skip_if_in_campaign": true,
  "leads": [{
    "email": "contact@example.fr",
    "first_name": "Jean",
    "last_name": "Dupont",
    "company_name": "Cabinet Dupont",
    "phone": "+33123456789",
    "website": "https://cabinet-dupont.fr",
    "custom_variables": { "city": "Paris", "category": "dentiste" }
  }]
}
```
**Limite** : 500 leads par batch
**Response** : `{ leads_uploaded, invalid_email_count, already_in_campaign, duplicate_email_count }`

### Gotchas
- Auth : Bearer token, PAS query param
- Analytics : response est objet OU tableau — le code gere les deux cas
- Accounts : response est `{ items: [...] }` OU tableau nu
- Leads upload : max 500 par batch, le code decoupe automatiquement
- `status: 1` = active, `status: 0` = paused

---

## 3. Apollo.io API v1 (Recherche Decideurs)

**But** : Trouver des decideurs (nom, titre, email, LinkedIn) a partir du domaine d'une entreprise.

| Propriete | Valeur |
|-----------|--------|
| Base URL | `https://api.apollo.io` |
| Auth | Header `X-Api-Key: {APOLLO_API_KEY}` |
| Env var | `APOLLO_API_KEY` |
| Timeout | 8s (people match), 30s (people search) |
| Fichiers | `src/lib/enrichment/sources/linkedin-finder.ts`, `src/app/api/enrich/people/route.ts` |

### Endpoints

#### POST /v1/people/match
**But** : Trouver l'URL LinkedIn d'une personne
**Body** : `{ first_name: "Jean", last_name: "Dupont", organization_domain: "example.fr" }`
**Response** : `{ person: { linkedin_url, email, name } }`

#### POST /v1/mixed_people/search
**But** : Chercher des personnes dans une entreprise par domaine
**Body** :
```json
{
  "q_organization_domains": "example.fr",
  "page": 1,
  "per_page": 10,
  "person_titles": ["directeur", "gerant", "fondateur", "pdg", "ceo"]
}
```
**Response** : `{ people: [{ first_name, last_name, name, title, email, email_status, linkedin_url }] }`

### Gotchas
- `X-Api-Key` (pas Bearer, pas Authorization)
- Reponse peut etre vide si la personne n'est pas dans la base Apollo
- `email_status: "verified"` = email confirme, sinon incertain
- Si `APOLLO_API_KEY` manquant → retourne null silencieusement (pas d'erreur)

---

## 4. Google Custom Search API (CSE Dorking)

**But** : Chercher des emails et profils LinkedIn via Google Search (dorking).

| Propriete | Valeur |
|-----------|--------|
| Base URL | `https://www.googleapis.com/customsearch/v1` |
| Auth | Query params `key={GOOGLE_CSE_API_KEY}&cx={GOOGLE_CSE_CX}` |
| Env vars | `GOOGLE_CSE_API_KEY`, `GOOGLE_CSE_CX` |
| Timeout | 8s |
| Quota | **100 queries/jour** (free tier) |
| Fichiers | `src/lib/enrichment/sources/google-dork.ts`, `src/lib/enrichment/sources/linkedin-finder.ts` |

### Request
```
GET /customsearch/v1?key=...&cx=...&q="@example.fr" email&num=5
GET /customsearch/v1?key=...&cx=...&q=site:linkedin.com/in "Jean Dupont" "Cabinet Dupont"&num=5
```

### Response
```json
{
  "items": [{
    "link": "https://linkedin.com/in/jean-dupont",
    "title": "Jean Dupont - LinkedIn",
    "snippet": "Gerant chez Cabinet Dupont..."
  }]
}
```

### Gotchas
- **100 queries/jour max** — quota non suivi dans le code !
- Partage entre google-dork (enrichment) et linkedin-finder (LinkedIn lookup)
- Si quota depasse → HTTP 403/429, retourne null silencieusement
- Source desactivee par defaut dans l'UI (quota trop limite pour batch)
- `cx` = ID du moteur de recherche custom — doit etre configure dans Google Console

---

## 5. Kaspr API (LinkedIn → Contact)

**But** : Obtenir email + telephone depuis un profil LinkedIn (base de 500M+ contacts).

| Propriete | Valeur |
|-----------|--------|
| Endpoint | `https://api.developers.kaspr.io/profile/linkedin` |
| Methode | POST |
| Auth | Header `Authorization: {KASPR_API_KEY}` (raw, PAS Bearer !) |
| Env var | `KASPR_API_KEY` |
| Timeout | 15s (API peut etre lente) |
| Cout | 1 credit par resultat |
| Fichier | `src/lib/enrichment/sources/kaspr.ts` |

### Request
```json
{
  "name": "Jean Dupont",
  "id": "https://linkedin.com/in/jean-dupont"
}
```

### Response
```json
{
  "status": "success",
  "data": {
    "first_name": "Jean",
    "last_name": "Dupont",
    "full_name": "Jean Dupont",
    "title": "Gerant",
    "company": "Cabinet Dupont",
    "emails": [
      { "email": "jean@cabinet-dupont.fr", "type": "work", "verified": true },
      { "email": "jean.dupont@gmail.com", "type": "personal", "verified": false }
    ],
    "phones": [
      { "phone": "+33612345678", "type": "work" }
    ]
  }
}
```

### Selection email (par priorite)
1. work + verified
2. work
3. direct + verified
4. direct
5. personal

### Gotchas
- Auth `Authorization: {key}` — PAS `Bearer {key}` !
- Necessite une URL LinkedIn (trouvee par sources precedentes)
- Opt-in seulement (`useKaspr: true` dans la config)
- Guard : `lead.score >= minScoreForPaid` — ne gaspille pas de credits sur les leads faibles
- API peut etre lente (~15s), d'ou le timeout plus long

---

## 6. SIRENE/INSEE API (Registre Entreprises FR)

**But** : Obtenir SIRET, dirigeant, adresse d'une entreprise francaise.

| Propriete | Valeur |
|-----------|--------|
| Base URL | `https://recherche-entreprises.api.gouv.fr/search` |
| Auth | Aucune (API publique) |
| Timeout | 8s |
| Rate limit | Non documente (API gouvernementale) |
| Fichier | `src/lib/enrichment/sources/sirene.ts` |

### Request
```
GET /search?q=Cabinet%20Dupont&per_page=3&commune=Paris&etat_administratif=A
```
- `q` : nom normalise (sans SARL/SAS/SA)
- `commune` : ville (optionnel)
- `etat_administratif=A` : entreprises actives uniquement

### Response (simplifie)
```json
{
  "results": [{
    "siren": "123456789",
    "siret": "12345678901234",
    "nom_complet": "CABINET DUPONT SAS",
    "dirigeants": [{
      "type_dirigeant": "personne physique",
      "denomination": null,
      "nom": "DUPONT",
      "prenoms": "Jean Pierre",
      "qualite": "Gerant"
    }],
    "siege": {
      "adresse": "12 rue de la Paix",
      "commune": "Paris",
      "code_postal": "75001"
    },
    "activite_principale": "86.23Z",
    "tranche_effectif_salarie": "10 a 19 salaries",
    "date_creation": "2010-05-15"
  }]
}
```

### Gotchas
- API publique = pas de auth, mais peut throttle sans prevenir
- Normalisation du nom : supprime suffixes legaux (SARL, SAS, SA, EURL...)
- Selection dirigeant par priorite de role (gerant > president > directeur general)
- Retourne max 3 resultats — prend le premier (best match de l'API)
- Le SIRET n'est PAS valide (pas de checksum)

---

## 7. eva.pingutil.com (Verification Email)

**But** : Verifier si une adresse email existe (syntax check + SMTP verification).

| Propriete | Valeur |
|-----------|--------|
| Endpoint | `https://api.eva.pingutil.com/email?email={email}` |
| Methode | GET |
| Auth | Aucune (API publique gratuite) |
| Timeout | 5s |
| Rate limit | Non documente (~1000/jour estime) |
| Fichier | `src/lib/enrichment/sources/email-permutation.ts` |

### Response
```json
{
  "status": "valid",
  "data": {
    "valid_syntax": true,
    "disposable": false,
    "webmail": false,
    "deliverable": true,
    "catch_all": false,
    "gibberish": false,
    "spam": false
  }
}
```

### Gotchas
- API non documentee officiellement — response shape inferee
- Pas de Bearer/key, totalement publique
- `deliverable: true` = SMTP check passe (meilleure fiabilite)
- Si API down → fallback sur regex syntax check (pas de SMTP)
- Utilisee pour verifier 6 des 12 permutations email generees

---

## Resume

| Service | Type | Auth | Cout | Fichier(s) |
|---------|------|------|------|-----------|
| Google Places | Scraping | API Key header | ~$32/1000 req | google-places.ts |
| Instantly.ai | Campaigns | Bearer token | Subscription | lead-utils.ts, campaigns/, orchestrate/ |
| Apollo.io | People Search | X-Api-Key header | Freemium | linkedin-finder.ts, enrich/people |
| Google CSE | Dorking | Query params | 100/jour free | google-dork.ts, linkedin-finder.ts |
| Kaspr | LinkedIn Data | Raw key header | 1 credit/result | kaspr.ts |
| SIRENE/INSEE | Company Registry | Aucune | Gratuit | sirene.ts |
| eva.pingutil | Email Verify | Aucune | Gratuit | email-permutation.ts |

---

*Derniere mise a jour : 2025-02-24*
