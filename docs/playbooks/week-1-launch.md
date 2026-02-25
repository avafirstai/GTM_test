# Playbook Semaine 1 — Lancement

## Pre-requis
- [ ] 3 domaines secondaires achetes et configures (SPF, DKIM, DMARC)
- [ ] 3 inboxes creees (1 par domaine) dans Instantly
- [ ] Warmup active sur les 3 inboxes (14 jours minimum)
- [ ] Compte Instantly configure
- [ ] Email scraper termine (objectif: 3,000+ emails)
- [ ] Notion pipeline database creee

## Jour 1 — Setup Instantly
1. Connecter les 3 inboxes warmup
2. Verifier le placement inbox (mail-tester.com > 8/10)
3. Creer 3 campagnes pilotes :
   - Formation (Tier 1, plus gros volume)
   - Cabinet Dentaire (Tier 1, plus haute valeur)
   - Agence Immobiliere (Tier 1, cycle court)
4. Configurer les sequences email (3 touchpoints)
5. Charger les leads enrichis (email + score > 50)

## Jour 2 — Sequences Email
### Sequence V1 : Value Hook (Formation)
**J0 — Objet :** `{{company_name}} — appels manques ?`
- Probleme: 35% des appels manques en formation
- Stat: 75% ne rappellent jamais
- Question: "Combien d'inscriptions perdez-vous par mois ?"
- PAS de lien

**J+3 — Objet :** `Re: {{company_name}} — resultats`
- Preuve: Gift Education → 23 inscriptions en 3 mois
- ROI: 92,000 EUR generes
- CTA: "15 min pour voir si ca marche pour vous ?" + lien Cal.com

**J+7 — Objet :** `Derniere question, {{first_name}}`
- Recap: "Je sais que le temps presse"
- Offre: 14 jours gratuit, setup 24h, pas d'engagement
- CTA: Lien Cal.com

## Jour 3 — Lancement (Lundi matin, 9h)
1. Activer les 3 campagnes
2. Volume: 30 emails/jour/inbox = 90 emails/jour total
3. Monitoring: verifier les premieres metriques a 14h et 18h
4. Objectif J1: > 50% open rate, 0 bounce, 0 spam

## Jours 4-5 — Monitoring
| Heure | Action |
|-------|--------|
| 9h | Verifier les opens de la veille |
| 12h | Traiter les replies (< 2h pour les positifs) |
| 14h | Verifier bounce rate et spam reports |
| 18h | Rapport quotidien dans Notion |

## Objectifs fin de semaine 1
| Metrique | Objectif |
|----------|----------|
| Emails envoyes | 450 (90/jour x 5 jours) |
| Open rate | 45-60% |
| Reply rate | 3-5% |
| Replies positifs | 7-12 |
| Demos bookees | 3-5 |

## Red flags (action immediate)
| Signal | Seuil | Action |
|--------|-------|--------|
| Bounce rate | > 5% | STOP, nettoyer la liste |
| Open rate | < 20% | Revoir les objets et la deliverabilite |
| Spam reports | > 0 | STOP, analyser le contenu |
| 0 opens apres 24h | — | Verifier que les emails partent |
