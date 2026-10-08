#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a fully migrated PostgreSQL database}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
psql "$DATABASE_URL" -X --set ON_ERROR_STOP=1 --file "$ROOT_DIR/supabase/tests/bucket1-generation.sql"
exec psql "$DATABASE_URL" -X --set ON_ERROR_STOP=1 --file "$ROOT_DIR/supabase/tests/bucket1-regeneration-lifecycle-audit.sql"
