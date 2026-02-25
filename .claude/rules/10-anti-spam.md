# 10 — Anti-Spam & Deliverabilite

## Regles de volume email (NON-NEGOCIABLE)

### Paliers progressifs
| Etape | Emails/jour/inbox | Inboxes | Total/jour | Condition |
|-------|-------------------|---------|------------|-----------|
| Warmup (S0-S2) | 5-15 progressif | 3 | 15-45 | Inscrit dans Instantly warmup |
| Start (S3) | 30 | 3 | 90 | Warmup OK, reputation validee |
| S4 | 40 | 3 | 120 | Bounce < 3%, 0 spam reports |
| S5 | 50 | 4 | 200 | Stable 2 semaines |
| S6+ | 50 | 6 | 300 | Ajout domaines secondaires |
| M2+ | 50 | 10 | 500 | Machine rodee |

### Domaines email
- **JAMAIS** utiliser avafirstai.com pour cold email
- Creer des domaines secondaires : ava-solutions.fr, ava-business.fr, etc.
- 1 domaine = max 3 inboxes
- SPF, DKIM, DMARC configures sur chaque domaine
- Tester la deliverabilite avec mail-tester.com avant chaque campagne

### Warmup obligatoire
- Nouveau domaine : 14-21 jours de warmup AVANT envoi reel
- Utiliser le warmup natif Instantly
- Volume progressif : 5/jour -> 10 -> 15 -> 20 -> 30
- Verifier le placement inbox (pas spam) avant de lancer

### Metriques de sante
| Metrique | Seuil acceptable | Action si depasse |
|----------|-----------------|-------------------|
| Bounce rate | < 3% | Nettoyer la liste, verifier emails |
| Spam complaints | 0 | STOP immediat, analyser le contenu |
| Open rate | > 40% | Si < 20% : revoir sujet et deliverabilite |
| Unsubscribe | < 1% | Revoir le ciblage et la frequence |

### Contenu email — regles anti-spam
- Pas de mots spam : "gratuit", "offre limitee", "urgent", "cliquez ici"
- Pas plus de 1 lien par email
- Pas d'images dans le premier email
- Objet court (< 50 caracteres)
- Personnalisation obligatoire (prenom/entreprise)
- Toujours un lien de desinscription
- Ratio texte/HTML : privilegier le plain text

### Sequence standard (3 touchpoints max)
- **J0** : Email initial (valeur, pas de pitch)
- **J+3** : Follow-up (preuve sociale, stats)
- **J+7** : Dernier rappel (urgence douce, pas agressive)
- Si pas de reponse apres 3 emails : STOP. Ne pas insister.
