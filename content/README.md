# Contenu ClubJudge

Problèmes et cours de la plateforme, versionnés ici et importés par le backend.
Le format est défini dans `PLAN.md` §3 et sera outillé en Phase 1
(CLI `clubjudge-content validate`, CI sur les PR).

```
problems/<slug>/   problem.yaml, statement.fr.md, editorial.fr.md, hints.yaml,
                   tests/, generator.py, validator.py, solutions/
courses/<slug>/    course.yaml + articles Markdown
```
