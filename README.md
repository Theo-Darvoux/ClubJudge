# ClubJudge

Plateforme de programmation compétitive du **Club Code de Télécom SudParis**.
Trois sections : liste de problèmes (arbre de compétences), compétitions, cours
avec TP interactifs.

Le plan complet du projet vit dans [`PLAN.md`](PLAN.md) — c'est la source de vérité.

## Structure du monorepo

```
backend/    API FastAPI (auth, problèmes, contests, cours, import de contenu)
frontend/   SPA React + TypeScript + Vite
content/    Contenu versionné : problèmes et cours (importés par la plateforme)
docs/       Documentation d'exploitation
```

## Démarrage rapide (développement)

Prérequis : Docker + Docker Compose, [uv](https://docs.astral.sh/uv/), Node ≥ 22.

```sh
cp .env.example .env          # puis ajuster les secrets
docker compose up -d          # PostgreSQL + Judge0
cd backend && uv sync && uv run alembic upgrade head
uv run fastapi dev app/main.py
# dans un autre terminal :
cd frontend && npm install && npm run dev
```

- API : http://localhost:8000 (doc interactive sur `/docs`)
- Front : http://localhost:5173

## Tests

```sh
cd backend
uv run pytest                  # tests unitaires
uv run pytest -m integration   # nécessite docker compose up (Judge0)
```

## Sécurité

Judge0 exécute du code arbitraire. Il ne doit **jamais** être exposé hors du
réseau Docker interne : seul le backend lui parle (voir `docker-compose.yml`).
