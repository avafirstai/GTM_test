# Instantly.ai API v2 — Reference Operationnelle

## Auth
- Header: `Authorization: Bearer {INSTANTLY_API_KEY}`
- Base URL: `https://api.instantly.ai/api/v2`
- IMPORTANT: API keys V1 sont deprecated (jan 2026). Utiliser V2 uniquement.

## Endpoints principaux

### Leads
| Method | Endpoint | Usage |
|--------|----------|-------|
| POST | `/leads` | Ajouter un lead a une campagne |
| POST | `/leads/list` | Lister les leads (avec filtres) |
| POST | `/leads/update` | Mettre a jour un lead |
| POST | `/leads/delete` | Supprimer un lead |
| GET | `/leads/export/csv` | Exporter en CSV |

### Campagnes
| Method | Endpoint | Usage |
|--------|----------|-------|
| GET | `/campaigns` | Lister les campagnes |
| POST | `/campaigns` | Creer une campagne |
| PATCH | `/campaigns/{id}` | Mettre a jour |
| DELETE | `/campaigns/{id}` | Supprimer |
| POST | `/campaigns/{id}/activate` | Activer |
| POST | `/campaigns/{id}/pause` | Mettre en pause |

### Analytics
| Method | Endpoint | Usage |
|--------|----------|-------|
| GET | `/campaigns/{id}/analytics` | Stats d'une campagne |
| GET | `/analytics/campaign/overview` | Vue d'ensemble |

## Creer un lead
```python
import json
import urllib.request

data = {
    "email": "contact@example.com",
    "first_name": "Jean",
    "company_name": "Example SARL",
    "campaign": "campaign_id_here",
    # Custom vars pour personnalisation
    "website": "example.com",
    "city": "Paris",
    "lt_category": "Formation"
}

req = urllib.request.Request(
    "https://api.instantly.ai/api/v2/leads",
    data=json.dumps(data).encode(),
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    },
    method="POST"
)
```

## Regles critiques
1. **Pas de bulk upload** — Envoyer les leads un par un (plus fiable avec l'API v2)
2. **Custom vars** — Les valeurs doivent etre scalaires (string/number), pas d'objets
3. **Sequences** — Le champ `sequences` n'utilise que le premier element du tableau
4. **Rate limits** — Limite par workspace, pas par campagne. Respecter 1 req/sec
5. **Warmup** — Activer le warmup natif Instantly avant tout envoi reel
6. **Campaign ID** — Necessaire pour chaque lead. Default: `4cc21116-672d-43f5-8fb3-d98bcf8e1f01`

## Erreurs courantes
| Code | Cause | Solution |
|------|-------|----------|
| 400 | Format invalide | Verifier le schema du body |
| 401 | Token invalide | Verifier INSTANTLY_BEARER |
| 403 | Cloudflare block | Ajouter User-Agent header |
| 429 | Rate limit | Attendre 1s entre chaque requete |
