# Exploitation

> README d'exploitation — à enrichir à chaque déploiement (PLAN.md §7, bus factor).

## Déployer

```sh
git pull
docker compose --profile full up -d --build
docker compose exec backend uv run alembic upgrade head
docker compose exec backend uv run clubjudge-content import /content
```

Le profil `full` monte `./content` en lecture seule dans `/content`. L'import est
volontairement explicite : il valide les solutions de référence via Judge0 avant
de synchroniser problèmes, cours et arbre de compétences.

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
- [ ] `GET /api/health` répond `{"status": "ok", ...}` sans authentification.
- [ ] Depuis une session administrateur, `GET /api/health/deep` indique `database=ok`
      et `judge0=ok`. Cet endpoint n'est plus public.

## Sauvegardes

Créer un dump PostgreSQL compressé :

```sh
./scripts/backup-db.sh
```

Vérifier réellement qu'un dump se restaure dans une base temporaire du même
serveur PostgreSQL (la base temporaire est supprimée automatiquement) :

```sh
./scripts/verify-backup.sh backups/clubjudge-YYYYMMDDTHHMMSSZ.dump
```

Automatiser `backup-db.sh` quotidiennement côté hôte, copier les dumps hors de la
machine et exécuter `verify-backup.sh` régulièrement. Un backup non restauré en
test n'est pas considéré comme valide.

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
