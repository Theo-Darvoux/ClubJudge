#!/usr/bin/env bash
set -euo pipefail

out="${1:-backups/clubjudge-$(date -u +%Y%m%dT%H%M%SZ).dump}"
mkdir -p "$(dirname "$out")"

docker compose exec -T db sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$out"

test -s "$out"
echo "Backup written to $out"
