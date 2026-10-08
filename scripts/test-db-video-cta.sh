#!/usr/bin/env bash
set -Eeuo pipefail
# Keep this exact version in the command (rather than a floating latest tag) for reproducible local/CI runs.
readonly SUPABASE_CLI_VERSION="2.39.2"
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly FIXTURE="$ROOT_DIR/supabase/tests/video-cta.sql"
readonly TEST_DIR="${TMPDIR:-/tmp}/obra-video-cta-db-$$"
readonly TEST_PROJECT_ID="obra-video-cta-test-$$"
readonly DB_PORT="${VIDEO_CTA_DB_PORT:-55432}"
readonly API_PORT="${VIDEO_CTA_API_PORT:-55431}"
readonly SHADOW_PORT="${VIDEO_CTA_SHADOW_PORT:-55430}"
STACK_STARTED=0
fail(){ printf 'test:db:video-cta: ERROR: %s\n' "$*" >&2; exit 1; }
cleanup(){ local status=$?; if [[ "$STACK_STARTED" == 1 ]]; then (cd "$TEST_DIR" && pnpm --silent dlx "supabase@$SUPABASE_CLI_VERSION" stop --no-backup >/dev/null 2>&1) || true; fi; rm -rf "$TEST_DIR"; exit "$status"; }
trap cleanup EXIT INT TERM
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required for pinned Supabase CLI $SUPABASE_CLI_VERSION."
command -v docker >/dev/null 2>&1 || fail "Docker is required; this test never uses a remote database."
docker info >/dev/null 2>&1 || fail "Docker is installed but its daemon is unavailable. Start Docker and retry."
command -v psql >/dev/null 2>&1 || fail "psql is required to run assertions with ON_ERROR_STOP."
[[ -f "$FIXTURE" ]] || fail "SQL fixture is missing: $FIXTURE"
mkdir -p "$TEST_DIR/supabase"
cp -R "$ROOT_DIR/supabase/migrations" "$TEST_DIR/supabase/migrations"
cat > "$TEST_DIR/supabase/config.toml" <<CONFIG
project_id = "$TEST_PROJECT_ID"
[api]
port = $API_PORT
[db]
port = $DB_PORT
shadow_port = $SHADOW_PORT
major_version = 15
CONFIG
printf 'test:db:video-cta: Supabase CLI %s; disposable project %s\n' "$SUPABASE_CLI_VERSION" "$TEST_PROJECT_ID"
cd "$TEST_DIR"
pnpm --silent dlx "supabase@$SUPABASE_CLI_VERSION" start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor
STACK_STARTED=1
pnpm --silent dlx "supabase@$SUPABASE_CLI_VERSION" db reset --local --no-seed
DB_URL="$(pnpm --silent dlx "supabase@$SUPABASE_CLI_VERSION" status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
[[ -n "$DB_URL" ]] || fail "Supabase CLI did not report local DB_URL after migration replay."
case "$DB_URL" in postgres://postgres:postgres@127.0.0.1:"$DB_PORT"/*|postgresql://postgres:postgres@127.0.0.1:"$DB_PORT"/*) ;; *) fail "Refusing unexpected DB URL; only local disposable port $DB_PORT is allowed.";; esac
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$FIXTURE"
printf 'test:db:video-cta: PASS\n'
