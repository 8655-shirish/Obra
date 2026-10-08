import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath = "supabase/migrations/20260829093924_admin_auth_authority_closure.sql";
const sessionPath = "src/lib/auth/admin-session.server.ts";
const routePath = "src/routes/api/agent/message.ts";
const read = (path) => fs.readFileSync(path, "utf8");
const migration = read(migrationPath);
const session = read(sessionPath);
const route = read(routePath);

assert.equal(
  fs
    .readdirSync("supabase/migrations")
    .filter((name) => name === "20260829093924_admin_auth_authority_closure.sql").length,
  1,
  "authority closure must be one additive migration",
);

for (const required of [
  "admin_bootstrap_state",
  "admin_auth_handoffs",
  "admin_recovery_attempts",
  "admin_auth_audit_events",
  "bootstrap_admin_principal_v4",
  "provision_admin_principal_v4",
  "revoke_admin_principal_v4",
  "authorize_admin_session_handoff_v4",
  "consume_admin_session_handoff_v4",
  "begin_admin_recovery_v4",
  "complete_admin_recovery_provider_reset_v4",
  "validate_admin_session_v4",
  "revoke_admin_session_v4",
  "global_admin_signout_v4",
  "handle_admin_ban_change_v4",
])
  assert.ok(migration.includes(required), "missing migration authority: " + required);

assert.ok(
  migration.includes(
    "update public.admin_principals set auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp()where user_id is not null;",
  ),
  "authority cutover epoch invalidation must have a primary-key predicate for managed pg-safeupdate",
);
assert.doesNotMatch(
  migration,
  /update public\.admin_principals set auth_epoch=auth_epoch\+1,updated_at=pg_catalog\.clock_timestamp\(\);/,
  "authority cutover must not retain an unqualified managed-safeupdate-incompatible UPDATE",
);

for (const retired of [
  "create_admin_session(text,uuid)",
  "create_admin_session_v2(text,uuid)",
  "create_admin_session_v3(text)",
  "bootstrap_admin_principal_v2(uuid)",
  "provision_admin_principal_v2(text,uuid)",
  "validate_admin_session_v2(text,boolean)",
  "global_admin_signout_v2(text)",
])
  assert.ok(
    migration.includes("drop function if exists public." + retired),
    "old authority survives: " + retired,
  );

assert.match(migration, /gotrue_session_id uuid not null unique/);
assert.match(migration, /join auth.sessions gs on gs.id=gotrue_session and gs.user_id=p.user_id/);
assert.match(migration, /item->>'timestamp'/);
assert.match(migration, /on conflict\(token_hash\)do nothing/);
assert.match(migration, /handoff\.consumed_at is not null/);
assert.match(migration, /recovery_attempt_token_hash/);
assert.match(migration, /live recovery continuation required/);
assert.match(migration, /where token_hash=handoff\.recovery_attempt_token_hash/);
assert.match(migration, /revoke execute on function public\.create_admin_session_v3/);
assert.match(migration, /from public,anon,authenticated,service_role/);
assert.match(migration, /delete from auth.refresh_tokens/);
assert.match(migration, /delete from auth.sessions/);
assert.match(migration, /update public\.admin_principals set auth_epoch=auth_epoch\+1/);
assert.match(migration, /revoked admin cannot be reprovisioned/);
assert.match(migration, /cannot revoke final enabled admin/);
assert.match(migration, /consumed_at=pg_catalog\.clock_timestamp\(\),consumed_by=p_user_id/);
assert.match(migration, /admin auth audit is append-only/);
assert.match(migration, /authority_closure_cutover/);
assert.doesNotMatch(
  migration,
  /grant execute on function public.consume_admin_session_handoff_v4[^;]*authenticated/,
);

for (const required of [
  "assertAdminSameOriginMutation",
  'request.headers.get("origin")',
  'request.headers.get("sec-fetch-site") !== "same-origin"',
  "exactVerifiedTotp",
  "factorId !== flow.factorId",
  "pendingRecoveryCodes",
  "p_recovery_attempt_token_hash",
  "MFA recovery is required before enrolling a replacement factor",
  "recoverCommittedHandoff",
  "authorize_admin_session_handoff_v4",
  "consume_admin_session_handoff_v4",
  "begin_admin_recovery_v4",
  "complete_admin_recovery_provider_reset_v4",
  "revoke_admin_session_v4",
  "global_admin_signout_v4",
  "revokeAdminPrincipal",
])
  assert.ok(session.includes(required), "missing server closure: " + required);

assert.doesNotMatch(session, /create_admin_session_v3/);
assert.doesNotMatch(session, /global_admin_signout_v2/);
assert.doesNotMatch(session, /replace_admin_recovery_codes_v2/);
assert.doesNotMatch(session, /\.find\(\(item\) => item\.status === "verified"\)/);
assert.ok(
  session.indexOf('adminRpc("revoke_admin_session_v4"') <
    session.indexOf(
      "clearAdminCookiesOnly();",
      session.indexOf("export async function clearAdminSessionCookies"),
    ),
  "local logout must revoke before cookie deletion",
);
assert.ok(
  session.includes("assertAdminSameOriginMutation"),
  "admin session mutations must stay origin-bound",
);
{
  const reader = session.slice(session.indexOf("export async function getAdminSession"));
  const cookie = reader.indexOf("getCookie(ADMIN_SESSION_COOKIE, actualRequest)");
  const missing = reader.indexOf("if (!token) return null");
  const origin = reader.indexOf("assertAdminSameOriginMutation(actualRequest)");
  assert.ok(
    cookie !== -1 && missing !== -1 && origin !== -1 && cookie < missing && missing < origin,
    "cookieless POSTs must not run the admin origin guard",
  );
}
assert.doesNotMatch(
  route,
  /assertAdminAutoKickoffAuthority/,
  "retired kickoff must not keep a privileged agent back door",
);
assert.match(route, /personalize_template/);

console.log("verify-admin-authority-closure: authority contracts present");
