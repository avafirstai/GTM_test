# Known Bugs & Fragile Patterns

> Registre de tous les bugs connus, classes par severite.
> Mis a jour a chaque session. Reference pour prioriser les fixes.

---

## Legende severites

| Severite | Definition | Action |
|----------|-----------|--------|
| 🔴 HIGH | Perte de donnees, resultats incorrects, ou cout financier | Fix prioritaire |
| 🟡 MEDIUM | Comportement degrade mais pas de perte critique | Fix planifie |
| 🟢 LOW | Cosmetic, edge case rare, ou code mort | Fix opportuniste |

---

## 🔴 HIGH — Fix Prioritaire

### H1. Fire-and-forget DB writes — perte silencieuse de donnees
- **Fichier** : `src/app/api/enrich/v2/stream/route.ts`
- **Description** : Les UPDATE Supabase sont async sans await. Si Supabase est down, le stream SSE montre "enrichi" mais rien n'est persiste en DB.
- **Impact** : Perte totale des resultats d'enrichissement si Supabase indisponible pendant le job.
- **Mitigation actuelle** : Event SSE `db_warning` si le .then() detecte une erreur.
- **Fix propose** : Await les DB writes critiques (lead status), ou implementer une queue de retry.
- **Statut** : OPEN

### H2. Race condition enrichment_attempts
- **Fichier** : `src/app/api/enrich/v2/stream/route.ts`
- **Description** : Deux jobs concurrents lisent `attempts=0`, puis ecrivent tous les deux `attempts=1`. Un write est perdu.
- **Impact** : Compteur de tentatives incorrect. Leads re-enrichis plus que prevu.
- **Fix propose** : Utiliser un RPC Supabase pour increment atomique (`enrichment_attempts = enrichment_attempts + 1`).
- **Statut** : OPEN

### H3. Google Dork — query secondaire jamais executee (code mort)
- **Fichier** : `src/lib/enrichment/sources/google-dork.ts`
- **Description** : Le code definit 2 queries (primary: `@domain email`, secondary: `dirigeant domain email`) mais seule la premiere est executee.
- **Impact** : Si la query primaire ne retourne rien, la query secondaire (potentiellement meilleure) n'est jamais tentee. Source sous-performante.
- **Fix propose** : Executer la query secondaire si la primaire retourne 0 resultats.
- **Statut** : OPEN

### H4. Waterfall timeout vs error — pas de distinction
- **Fichier** : `src/lib/enrichment/waterfall.ts`
- **Description** : `runWithTimeout` retourne null pour TOUTES les erreurs (timeout, 500, network). Impossible de distinguer "API lente" vs "API cassee".
- **Impact** : Pas de diagnostic possible quand une source ne fonctionne pas. Debugging aveugle.
- **Fix propose** : Lever des erreurs typees (TimeoutError vs NetworkError vs ApiError) et les logger differemment.
- **Statut** : OPEN

---

## 🟡 MEDIUM — Fix Planifie

### M1. Leads skipped jamais re-enrichis
- **Fichier** : `src/app/api/enrich/v2/stream/route.ts`
- **Description** : Les leads `skipped` (timeout) restent `skipped` indefiniment. Seuls les `pending` sont requetes.
- **Impact** : Un lead temporairement lent est perdu pour toujours. Pas de recovery automatique.
- **Fix propose** : Bouton "Re-essayer les echoues" qui flip `skipped/failed` → `pending`. Ou cron qui reset apres 24h.
- **Statut** : OPEN

### M2. Google CSE quota non suivi
- **Fichier** : `src/lib/enrichment/sources/google-dork.ts`, `src/lib/enrichment/sources/linkedin-finder.ts`
- **Description** : 100 queries/jour, partage entre google-dork et linkedin-finder. Aucun compteur. Depasse silencieusement.
- **Impact** : Apres ~50 leads enrichis, Google CSE + LinkedIn finder echouent silencieusement pour le reste de la journee.
- **Fix propose** : Compteur global Redis/memory + warning SSE quand quota a 80%.
- **Statut** : OPEN

### M3. Email deobfuscation incomplete
- **Fichier** : `src/lib/enrichment/sources/deep-scrape.ts`
- **Description** : 8 patterns geres ([at], (at), {at}, [dot], (dot), {dot}, [point], arobase). Manquent : `@@`, `/at/`, `<at>`, `--at--`, variantes majuscules.
- **Impact** : Emails obfusques rates sur certains sites.
- **Fix propose** : Ajouter les patterns manquants ou utiliser une lib.
- **Statut** : OPEN

### M4. Phone regex FR seulement
- **Fichier** : `src/lib/enrichment/sources/deep-scrape.ts`
- **Description** : Regex ne matche que `+33/0033/0` prefix. Pas +41 (Suisse), +32 (Belgique), +49 (Allemagne).
- **Impact** : Leads avec numeros non-FR sont ignores.
- **Fix propose** : Regex international pour les pays europeens principaux.
- **Statut** : OPEN

### M5. Confidence same-domain detection fragile
- **Fichier** : `src/lib/enrichment/confidence.ts`
- **Description** : `emailDomain.includes(leadDomain.replace(/^www\./, ""))` — string includes, pas egalite stricte.
- **Impact** : False positive — "example.fr" inclus dans "example-fr.com" donne +15 bonus injustifie.
- **Fix propose** : Utiliser `new URL()` pour parser correctement les domaines et comparer exactement.
- **Statut** : OPEN

### M6. SIRENE — normalisation trop agressive
- **Fichier** : `src/lib/enrichment/sources/sirene.ts`
- **Description** : Supprime SARL/SAS du nom, mais l'API SIRENE peut avoir "SARL Jean Dupont" comme nom officiel.
- **Impact** : Pas de match API si le nom officiel contient le suffixe legal.
- **Fix propose** : Tenter avec ET sans suffixe legal (2 requetes).
- **Statut** : OPEN

### M7. SIRENE — dirigeant priorite hardcodee
- **Fichier** : `src/lib/enrichment/sources/sirene.ts`
- **Description** : Gerant prioritise over President. En SAS/SA, le President est le vrai decideur.
- **Impact** : Mauvais decideur selectionne pour les societes par actions.
- **Fix propose** : Adapter la priorite selon `nature_juridique` de l'entreprise.
- **Statut** : OPEN

### M8. Email permutation — seulement 6 sur 12 verifiees
- **Fichier** : `src/lib/enrichment/sources/email-permutation.ts`
- **Description** : 12 permutations generees, mais seulement les 6 premieres sont verifiees via API.
- **Impact** : Si le bon email est en position 7+ (ex: `jean-dupont@`), il est rate.
- **Fix propose** : Verifier les 12, ou reordonner par probabilite (prenom.nom en premier).
- **Statut** : OPEN

### M9. Schema.org ContactPoint parsing fragile
- **Fichier** : `src/lib/enrichment/sources/schema-org.ts`
- **Description** : Assume que ContactPoint est objet ou tableau. Si c'est un string ou malformed, echec silencieux.
- **Impact** : Emails rates si JSON-LD non-standard.
- **Fix propose** : Validation de type avant parsing.
- **Statut** : OPEN

### M10. Kaspr email type priority ignore verification
- **Fichier** : `src/lib/enrichment/sources/kaspr.ts`
- **Description** : Un email "work" non-verifie est prefere a un email "direct" verifie.
- **Impact** : Email moins fiable selectionne.
- **Fix propose** : Ponderer verification + type ensemble (verified work > verified direct > unverified work).
- **Statut** : OPEN

### M11. OR filter non valide pour grandes listes
- **Fichier** : `src/app/api/enrich/v2/stream/route.ts`
- **Description** : `query.or("category.ilike.%X%,category.ilike.%Y%,...")` — si 100+ categories, peut depasser les limites query Supabase.
- **Impact** : Query echoue silencieusement pour grandes selections.
- **Fix propose** : Limiter a 20 categories max, ou utiliser un RPC.
- **Statut** : OPEN

### M12. Deep Scrape email ranking domain mismatch
- **Fichier** : `src/lib/enrichment/sources/deep-scrape.ts`
- **Description** : `leadDomain.includes(emailDomain)` — false positive si TLD different (example.fr vs example.com).
- **Impact** : Email hors-domaine classe comme same-domain.
- **Fix propose** : Comparer domaine sans TLD, ou utiliser egalite stricte.
- **Statut** : OPEN

### M13. Batch size enrichissement hardcode (3)
- **Fichier** : `src/app/api/enrich/v2/stream/route.ts`
- **Description** : 3 leads en parallele, pas de scaling adaptatif.
- **Impact** : Sous-optimal sur machines rapides, potentiellement trop pour APIs lentes.
- **Fix propose** : Configurable via body param, ou adaptatif selon temps de reponse.
- **Statut** : OPEN

---

## 🟢 LOW — Fix Opportuniste

### L1. DNS Intel — MX provider substring matching
- **Fichier** : `src/lib/enrichment/sources/dns-intel.ts`
- **Description** : Detection provider par substring (24 patterns hardcodes). Si un provider change de nom, non detecte.
- **Impact** : Metadata `mxProvider` incorrecte (cosmetic).
- **Statut** : OPEN

### L2. SPF parser simpliste
- **Fichier** : `src/lib/enrichment/sources/dns-intel.ts`
- **Description** : Simple extraction "include:" — ne gere pas soft fails (~include) vs hard fails (-include).
- **Impact** : Sur-reporting des providers email dans SPF.
- **Statut** : OPEN

### L3. SIRET sans checksum
- **Fichier** : `src/lib/enrichment/sources/sirene.ts`
- **Description** : Le SIRET retourne par l'API n'est pas valide (pas de checksum Luhn INSEE).
- **Impact** : Si l'API retourne un faux SIRET, il est accepte.
- **Statut** : OPEN

### L4. LinkedIn URL regex trop simple
- **Fichier** : `src/lib/enrichment/sources/linkedin-finder.ts`
- **Description** : Regex matche `linkedin.com/in/` mais pas les formats legacy ou `/company/`.
- **Impact** : Faux positifs possibles.
- **Statut** : OPEN

### L5. Email permutation accents non-francais
- **Fichier** : `src/lib/enrichment/sources/email-permutation.ts`
- **Description** : NFD + combining marks works pour FR (e→e) mais pas pour polonais (l), turc (c), etc.
- **Impact** : Noms non-francais mal normalises (edge case rare pour marche FR).
- **Statut** : OPEN

### L6. Google Dork EMAIL_REGEX trop broad
- **Fichier** : `src/lib/enrichment/sources/google-dork.ts`
- **Description** : Matche des emails incomplets dans les snippets tronques (ex: "Contact john@" sans TLD).
- **Impact** : False positives rares.
- **Statut** : OPEN

### L7. Kaspr phone selection sans ranking
- **Fichier** : `src/lib/enrichment/sources/kaspr.ts`
- **Description** : Prend le premier telephone, pas de tri par type (work > direct > personal).
- **Impact** : Mobile retourne au lieu de fixe pro (preference incertaine).
- **Statut** : OPEN

### L8. LinkedIn finder — code mort (strategie 3)
- **Fichier** : `src/lib/enrichment/sources/linkedin-finder.ts`
- **Description** : Strategie "direct construction" (linkedin.com/in/prenom-nom) desactivee mais code encore present.
- **Impact** : Code mort, confusion pour les futurs devs.
- **Statut** : OPEN

### L9. EXCLUDED_DOMAINS sans domaines regionaux
- **Fichier** : `src/lib/enrichment/sources/google-dork.ts`
- **Description** : `example.com` est exclu mais `example.fr` ne l'est pas.
- **Impact** : False positive theorique.
- **Statut** : OPEN

### L10. Confidence generic penalty non-proportionnelle
- **Fichier** : `src/lib/enrichment/confidence.ts`
- **Description** : -10 penalty identique que la base soit 95 (SIRENE) ou 50 (permutation). Devrait etre proportionnelle.
- **Impact** : Penalty disproportionnee pour sources haute-confiance.
- **Statut** : OPEN

---

## Resume

| Severite | Count | Exemples cles |
|----------|-------|---------------|
| 🔴 HIGH | 4 | Fire-and-forget DB loss, race condition, dead code |
| 🟡 MEDIUM | 13 | Quota tracking, skipped leads, regex limitations |
| 🟢 LOW | 10 | Cosmetic, edge cases, code mort |
| **TOTAL** | **27** | |

---

*Derniere mise a jour : 2025-02-24*
