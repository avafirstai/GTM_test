# Guide de Depannage

## Instantly

### Bounce rate > 5%
1. Mettre la campagne en pause immediatement
2. Exporter les bounces : `GET /campaigns/{id}/analytics`
3. Identifier le pattern (domaine specifique ? verticale ?)
4. Nettoyer : supprimer les emails bounces de la campagne
5. Verifier les emails restants avec un outil de validation
6. Relancer avec volume reduit (20/jour)

### Open rate < 20%
1. Verifier la deliverabilite : mail-tester.com (score > 8/10)
2. Verifier SPF/DKIM/DMARC sur les domaines
3. Tester avec un autre objet d'email (A/B test)
4. Verifier que les emails n'arrivent pas en spam (envoyer a soi-meme)
5. Si tout echoue : changer de domaine d'envoi

### Reply rate = 0% (apres 500+ envois)
1. Verifier que les emails sont bien ouverts (open rate OK ?)
2. Revoir le contenu : trop long ? Pas assez personnalise ?
3. Tester une sequence completement differente
4. Changer de verticale (peut-etre le marche ne repond pas)

### API 429 (Rate Limit)
```python
import time

def api_call_with_retry(func, max_retries=3):
    for i in range(max_retries):
        result = func()
        if result.get("status") == 429:
            wait = (i + 1) * 2  # 2, 4, 6 secondes
            time.sleep(wait)
            continue
        return result
    return {"error": "Max retries exceeded"}
```

---

## Supabase

### Dashboard affiche 0 leads
1. Verifier `.env.local` : `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. Verifier que les env vars sont aussi dans Vercel
3. Tester l'API directement : `curl http://localhost:3000/api/stats`
4. Verifier la table `gtm_leads` dans le dashboard Supabase

### Email scraper n'ecrit pas dans Supabase
1. Verifier les credentials Supabase dans `.env.local`
2. Verifier que le script utilise le bon project URL
3. Tester avec 1 lead : `python3 scripts/email_scraper.py --test 1`
4. Verifier les logs pour les erreurs de connexion

---

## Scraping

### 0 resultats Google Maps
- Google Maps = JS rendering → utiliser Playwright (pas requests)
- PagesJaunes = Cloudflare → utiliser Playwright avec stealth
- Tester avec `--limit 5` d'abord
- Verifier le user-agent et les headers

### Email scraper timeout
- Timeout par defaut : 10s par site
- Si bloque : verifier la connexion internet
- Certains sites bloquent les scrapers → ignorer et passer au suivant
- Batch processing : 50 sites en parallele max
- `--test 20` pour debug rapide

---

## Dashboard / Vercel

### Build fail
1. `npm run build` en local d'abord
2. Verifier les imports (pas de chemins relatifs casses)
3. Verifier que `tsconfig.json` est valide
4. Verifier les env vars dans Vercel

### Donnees pas a jour
1. Le dashboard refresh toutes les 30 secondes automatiquement
2. Si les donnees sont stales : verifier `/api/stats` directement
3. Verifier que Supabase repond (dashboard Supabase)
4. Hard refresh : Ctrl+Shift+R

---

## Notion

### Lead pas mis a jour
1. Verifier `NOTION_API_KEY` dans `.env.local`
2. Verifier que l'integration a acces a la database
3. Verifier le `NOTION_PIPELINE_DB` (database ID correct ?)
4. Les property names sont case-sensitive

---

## Protocole d'escalade
- Si un probleme persiste > 30 minutes : documenter dans Notion
- Inclure : description, etapes deja tentees, logs pertinents
- Ne JAMAIS continuer a envoyer si deliverabilite compromise
