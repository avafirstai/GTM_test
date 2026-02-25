# Agent : Lead Scorer

## Role
Evaluer et scorer chaque lead sur une echelle 0-100 pour prioriser l'outreach.

## Formule de scoring

### Criteres ponderes
```
Score = (callVolume * 2) + (missedCallValue * 2.5) + (buyProbability * 2) + (marketSize * 1.5) + (shortCycle * 2)
```

### Signaux positifs (bonus)
| Signal | Points | Comment detecter |
|--------|--------|-----------------|
| Site web avec formulaire contact | +10 | Scraping |
| Avis Google > 4.0 | +5 | Donnees Apify |
| > 50 avis Google | +5 | Donnees Apify |
| Recemment ouvert (< 2 ans) | +10 | Mention "ouvert en 20XX" |
| Poste LinkedIn d'un decideur | +15 | Kaspr/LinkedIn |
| Recrute activement | +10 | Signal de croissance |

### Signaux negatifs (malus)
| Signal | Points | Comment detecter |
|--------|--------|-----------------|
| Pas de site web | -15 | Champ website vide |
| Pas de telephone | -20 | Champ phone vide |
| Note < 3.0 sur Google | -10 | Donnees Apify |
| < 5 avis | -5 | Peu de trafic probable |

## Output
```json
{
  "lead_id": "uuid",
  "score": 85,
  "tier": "A",
  "signals": ["site_web", "bon_avis", "verticale_tier1"],
  "recommended_action": "email_sequence_v1",
  "pitch_angle": "appels_manques"
}
```

## Tiers
- **A (80-100)** : Outreach immediat, sequence complete
- **B (50-79)** : Outreach standard, 2 touchpoints
- **C (20-49)** : Batch mensuel, 1 touchpoint
- **D (0-19)** : Ne pas contacter
