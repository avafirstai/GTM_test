# 00 — Regles Fondamentales GTM

## Priorite des actions
1. **Revenue** — tout ce qui rapproche d'un client payant
2. **Pipeline** — leads qualifies, emails envoyes, demos bookees
3. **Infrastructure** — scripts, dashboard, automatisation
4. **Contenu** — posts LinkedIn, templates email
5. **Documentation** — mise a jour CLAUDE.md, playbooks

## Workflow obligatoire
Avant toute action :
1. Lire CLAUDE.md pour contexte
2. Verifier l'etat actuel (Supabase, Instantly, pipeline)
3. Planifier l'action avec impact attendu
4. Executer avec verification
5. Mettre a jour CLAUDE.md si l'etat change

## Interdictions absolues
- Ne JAMAIS envoyer d'email sans warmup prealable (2-3 semaines min)
- Ne JAMAIS depasser 30 emails/jour/inbox
- Ne JAMAIS utiliser le domaine principal (avafirstai.com) pour le cold email
- Ne JAMAIS commiter des secrets (.env, API keys, tokens)
- Ne JAMAIS logger du PII (emails, telephones, noms complets)
- Ne JAMAIS supprimer de donnees en production sans backup
- Ne JAMAIS push directement sur main sans verifier le build

## Metriques de succes
| Metrique | Objectif S1 | Objectif S4 |
|----------|------------|------------|
| Leads charges | 500 | 3,000+ |
| Emails envoyes/semaine | 90 | 800+ |
| Open rate | 45-60% | 50%+ |
| Reply rate | 3-5% | 5-7% |
| Demos bookees | 3-5 | 8-12 |
| Clients payants | 0 | 1-3 |
