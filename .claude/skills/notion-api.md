# Notion API — Reference Operationnelle

## Auth
- Header: `Authorization: Bearer {NOTION_API_KEY}`
- Header: `Notion-Version: 2022-06-28`
- Base URL: `https://api.notion.com/v1`

## Database Pipeline
- ID: `8a1540ca-0ea6-479e-87cf-7fe614f18f65`
- QG Ops page: `31089259-81e0-812b-9ae0-c8f8ff5b15af`

## Endpoints principaux

### Pages
| Method | Endpoint | Usage |
|--------|----------|-------|
| POST | `/pages` | Creer une page (= un lead dans le pipeline) |
| PATCH | `/pages/{id}` | Mettre a jour une page |
| GET | `/pages/{id}` | Recuperer une page |

### Database
| Method | Endpoint | Usage |
|--------|----------|-------|
| POST | `/databases/{id}/query` | Chercher dans le pipeline |
| GET | `/databases/{id}` | Schema de la database |

## Schema du pipeline CRM
```
Pipeline Notion:
- Nom (title)
- Email (email)
- Telephone (phone)
- Entreprise (rich_text)
- Verticale (select)
- Statut (select): Nouveau | Contacte | Repondu | Demo | Pilote | Client
- Score (number)
- Source (select): Google Maps | LinkedIn | Referral
- Date Contact (date)
- Notes (rich_text)
- Campagne Instantly (url)
```

## Creer un lead dans le pipeline
```python
data = {
    "parent": {"database_id": "8a1540ca-0ea6-479e-87cf-7fe614f18f65"},
    "properties": {
        "Nom": {"title": [{"text": {"content": "Dr Martin"}}]},
        "Email": {"email": "contact@cabinet-martin.fr"},
        "Entreprise": {"rich_text": [{"text": {"content": "Cabinet Martin"}}]},
        "Verticale": {"select": {"name": "Dentaire"}},
        "Statut": {"select": {"name": "Nouveau"}},
        "Score": {"number": 85},
    }
}
```

## Regles
- Rate limit: 3 requetes/seconde
- Pagination: utiliser `start_cursor` pour les listes longues
- Les property names sont case-sensitive
- Utiliser le MCP Notion quand disponible (plus simple)
