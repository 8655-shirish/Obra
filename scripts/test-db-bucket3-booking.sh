#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to an already restored and fully migrated isolated PostgreSQL database}"
: "${CUTOVER_TENANT:?Set CUTOVER_TENANT to an enabled test tenant UUID prepared outside the rolled-back smoke transaction}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v cutover_tenant="$CUTOVER_TENANT" -f supabase/tests/bucket3-booking.sql
