# 20 — Securite & Secrets

## Variables d'environnement

### Fichier .env.local (JAMAIS commite)
```bash
NEXT_PUBLIC_SUPABASE_URL=          # Safe pour le browser
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # Safe pour le browser
INSTANTLY_API_KEY=                  # Bearer token Instantly v2
INSTANTLY_BEARER=                   # Alias du token Bearer
CALCOM_API_KEY=                     # Cal.com API v2
NOTION_API_KEY=                     # Notion integration token
NOTION_PIPELINE_DB=                 # Notion database ID (pipeline)
```

### Regles
- Tous les secrets dans `.env.local` (gitignore)
- Python : `os.environ.get("KEY", "")` — jamais de valeur par defaut avec un secret
- TypeScript : `process.env.KEY` cote serveur, `NEXT_PUBLIC_` cote client
- JAMAIS de secret dans un commit, meme sur une branche
- JAMAIS de secret dans un log, meme en debug

### Vercel
- Env vars configurees dans le dashboard Vercel
- `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` obligatoires
- Ne pas mettre de secrets serveur dans NEXT_PUBLIC_

## Donnees sensibles (PII)

### JAMAIS dans les logs
- Emails
- Numeros de telephone
- Noms complets
- Adresses
- Transcripts de conversation

### OK dans les logs
- Nombre de leads traites
- Taux de succes (pourcentages)
- IDs internes (Supabase UUIDs)
- Timestamps
- Codes d'erreur HTTP

## Git
- `.env.local` dans `.gitignore`
- `scripts/*.csv` dans `.gitignore` (donnees PII)
- `scripts/__pycache__/` dans `.gitignore`
- Verifier chaque commit avant push : `git diff --staged`
