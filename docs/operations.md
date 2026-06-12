# Exploitation

> README d'exploitation — à enrichir à chaque déploiement (PLAN.md §7, bus factor).

## Déployer

```sh
git pull
docker compose --profile full up -d --build
docker compose exec backend uv run alembic upgrade head
```

Un reverse proxy TLS (Caddy ou nginx sur l'hôte) doit pointer vers
`127.0.0.1:5173` (front, qui proxifie `/api` vers le backend).

## Checklist premier déploiement sur le serveur cible

- [ ] Droits Docker (les workers Judge0 exigent `privileged`).
- [ ] cgroups : Judge0 1.13.1 requiert cgroup v1, absent des hôtes modernes
      (vérifié le 2026-06-12 : « Internal Error » sur toute soumission, log
      worker « Failed to create control group /sys/fs/cgroup/memory/box-N »).
      Deux solutions :
      1. `ENABLE_PER_PROCESS_AND_THREAD_{TIME,MEMORY}_LIMIT=true` dans
         `judge0/judge0.conf` (actif actuellement) : isolate tourne sans `--cg`,
         limites via rlimit. Suffisant en dév ; la mesure mémoire est par
         processus, pas par groupe.
      2. Pour une isolation stricte en prod : paramètre noyau
         `systemd.unified_cgroup_hierarchy=0` + reboot, puis repasser les deux
         flags à `false`. À trancher avant le premier contest (test de charge).
- [ ] Vérifier que le port Judge0 (2358) n'est PAS accessible depuis l'extérieur.
- [ ] SMTP disponible ? (conditionne la vérification d'email en Phase 1a)
- [ ] `GET /api/health/deep` répond `{"database": "ok", "judge0": "ok"}`.

## Sauvegardes

À mettre en place dès les premiers vrais utilisateurs (Phase 1a) :
dump PostgreSQL quotidien + test de restauration documenté ici.

## Rejuger / dépanner

À documenter en Phase 2 (outils admin de rejudge).
