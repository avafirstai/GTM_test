# Cal.com API v2 — Reference Operationnelle

## Auth
- Header: `Authorization: Bearer {CALCOM_API_KEY}`
- Base URL: `https://api.cal.com/v2`

## Lien de booking
- URL publique: `https://cal.com/avafirstai/15min`
- Event type: 15 minutes
- Timezone: Europe/Paris

## Endpoints principaux

### Event Types
| Method | Endpoint | Usage |
|--------|----------|-------|
| GET | `/event-types` | Lister les types d'events |
| GET | `/event-types/{id}` | Details d'un event type |

### Bookings
| Method | Endpoint | Usage |
|--------|----------|-------|
| GET | `/bookings` | Lister les reservations |
| GET | `/bookings/{id}` | Details d'une reservation |
| POST | `/bookings` | Creer une reservation |
| DELETE | `/bookings/{id}` | Annuler |

### Availability
| Method | Endpoint | Usage |
|--------|----------|-------|
| GET | `/availability` | Creneaux disponibles |

## Webhook (pour sync avec pipeline)
Cal.com peut envoyer des webhooks sur :
- `BOOKING_CREATED` — Nouveau RDV booke
- `BOOKING_CANCELLED` — RDV annule
- `BOOKING_RESCHEDULED` — RDV deplace

## Integration avec le pipeline
1. Lead repond a l'email → clique sur le lien Cal.com
2. Booking cree → webhook envoye
3. Webhook → update Notion pipeline (statut = "Demo")
4. Webhook → notification email/Slack
5. Post-demo → update Notion (statut = "Pilote" ou "Perdu")

## Regles
- Toujours inclure le lien Cal.com dans le CTA des emails
- Format du lien : `https://cal.com/avafirstai/15min`
- Ne PAS mettre le lien dans le premier email (trop agressif)
- Mettre le lien dans J+3 ou J+7
