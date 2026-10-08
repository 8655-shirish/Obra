#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?RELEASE_DATABASE_URL must be exposed as DATABASE_URL}"
command -v psql >/dev/null 2>&1 || {
  echo "verify-release-database: psql is required" >&2
  exit 1
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
applied_output="$(
  psql "$DATABASE_URL" -XAt --set ON_ERROR_STOP=1 \
    --command "select version::text from supabase_migrations.schema_migrations order by version"
)"
applied_versions=()
while IFS= read -r applied; do
  [[ -n "$applied" ]] && applied_versions+=("$applied")
done <<< "$applied_output"

missing=()
migration_count=0
shopt -s nullglob
migrations=("$ROOT_DIR"/supabase/migrations/*.sql)
if (( ${#migrations[@]} == 0 )); then
  echo "verify-release-database: no repository migrations found" >&2
  exit 1
fi
for migration in "${migrations[@]}"; do
  migration_count=$((migration_count + 1))
  filename="${migration##*/}"
  version="${filename%%_*}"
  found=false
  for applied in "${applied_versions[@]}"; do
    if [[ "$applied" == "$version" ]]; then
      found=true
      break
    fi
  done
  if [[ "$found" == false ]]; then
    missing+=("$version")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'verify-release-database: target is not fully migrated; missing version(s): %s\n' \
    "${missing[*]}" >&2
  exit 1
fi

printf 'verify-release-database: all %d repository migration versions are recorded\n' \
  "$migration_count"
exec bash "$ROOT_DIR/scripts/test-db-bucket1-generation.sh"
