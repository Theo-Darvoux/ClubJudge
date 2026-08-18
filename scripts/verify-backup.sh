#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 backups/clubjudge-....dump" >&2
  exit 2
fi

dump=$1
test -s "$dump"
tmp_db="clubjudge_restore_check_$(date -u +%Y%m%d%H%M%S)_$RANDOM"

cleanup() {
  docker compose exec -T db sh -lc "dropdb -U \"\$POSTGRES_USER\" --if-exists \"$tmp_db\"" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose exec -T db sh -lc "createdb -U \"\$POSTGRES_USER\" \"$tmp_db\""
docker compose exec -T db sh -lc "pg_restore -U \"\$POSTGRES_USER\" -d \"$tmp_db\" --no-owner --no-privileges" < "$dump"
docker compose exec -T db sh -lc "psql -U \"\$POSTGRES_USER\" -d \"$tmp_db\" -v ON_ERROR_STOP=1 -Atqc 'SELECT version_num FROM alembic_version'"

echo "Restore verification succeeded for $dump"
