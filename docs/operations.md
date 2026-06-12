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

## Administration

### Promouvoir un admin

Les rôles se gèrent par CLI (pas d'UI pour ça — volontaire) :

```sh
docker compose exec backend uv run clubjudge-admin promote alice@exemple.fr
docker compose exec backend uv run clubjudge-admin demote alice@exemple.fr
docker compose exec backend uv run clubjudge-admin list
```

Un admin voit l'onglet **Admin** dans la nav : création/édition de contests
et outils de rejudge.

### Annonces Discord

Renseigner `DISCORD_WEBHOOK_URL` (variable d'environnement du backend ou
`.env` à la racine, vide par défaut = annonces désactivées) avec l'URL d'un
webhook du serveur Discord du club. Annoncés automatiquement : création d'un contest,
début (avec lien), first bloods pendant la fenêtre, résultats finaux (podium).
Best-effort : un échec d'envoi est loggé mais ne bloque jamais la plateforme.

## Rejuger / dépanner

Après correction d'un test ou d'une limite (re-import du contenu), rejuger
depuis la page **Admin** : par soumission (id) ou par problème (slug, rejuge
tout). Les soumissions repassent en file ; date et rattachement contest sont
préservés, donc le scoreboard d'un contest se recalcule tout seul. Un rejudge
postérieur à la fin d'un contest ne ré-annonce pas de first blood sur Discord.
