#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to a migrated local PostgreSQL database}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bucket1-foundation.sql
