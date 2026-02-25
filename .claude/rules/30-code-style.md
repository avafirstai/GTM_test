# 30 — Conventions de Code

## Python (scripts/)

### Obligatoire
- Type hints sur toutes les fonctions
- Docstrings sur les fonctions publiques
- `sys.stdout.flush()` apres chaque print de progression
- try/except autour de chaque requete HTTP avec timeout
- Credentials via `os.environ.get()`

### Style
```python
# CORRECT
def classify_verticale(category: str, title: str) -> str:
    """Classify a lead into a verticale based on category and title."""
    text = f"{category} {title}".lower()
    ...

# INCORRECT
def classify(cat, t):
    return ...
```

### Imports (ordre)
1. Standard library (os, sys, json, csv, time)
2. Third-party (aiohttp, beautifulsoup4, supabase)
3. Local imports

## TypeScript (src/)

### Obligatoire
- strict mode dans tsconfig.json
- Interfaces pour toutes les structures de donnees
- `unknown` au lieu de `any` — utiliser type guards
- Pas de `// @ts-ignore`

### Composants React
```typescript
// Server Components par defaut (pas de directive)
export default async function Page() { ... }

// Client Components uniquement si interactivite
'use client';
export function InteractiveComponent() { ... }
```

### Imports
```typescript
// Utiliser @/ aliases
import { StatCard } from '@/components/StatCard';
import type { Lead } from '@/lib/types';

// JAMAIS de chemins relatifs profonds
// import { X } from '../../../components/X';  // NON
```

## Git

### Commits
- Prefixe obligatoire : `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- Message en anglais
- Court et descriptif : `feat: add email enrichment progress to dashboard`
- Un commit = un changement logique

### Branches
- `main` = production (auto-deploy Vercel)
- Feature branches pour les gros changements
- JAMAIS de force push sur main
