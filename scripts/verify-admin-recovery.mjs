import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name) => fs.readFileSync(name, "utf8");
const foundationName = "supabase/migrations/20260829093919_admin_auth_lifecycle.sql";
const migrationName = "supabase/migrations/20260829093924_admin_auth_authority_closure.sql";
const lifecycleMigrations = fs
  .readdirSync("supabase/migrations")
  .filter(
    (name) =>
      name.includes("admin_auth_lifecycle") || name.includes("admin_auth_authority_closure"),
  );
assert.deepEqual(lifecycleMigrations.sort(), [
  "20260829093919_admin_auth_lifecycle.sql",
  "20260829093924_admin_auth_authority_closure.sql",
]);

const foundation = read(foundationName);
const migration = read(migrationName);
const session = read("src/lib/auth/admin-session.server.ts");
const functions = read("src/lib/admin.functions.ts");
const gate = read("src/components/admin/AdminGate.tsx");
const settings = read("src/components/admin/AdminAuthSettings.tsx");
const constants = read("src/lib/auth/constants.ts");

for (const identity of [
  "auth_epoch",
  "recovery_code_hashes",
  "bootstrap_admin_principal_v4",
  "provision_admin_principal_v4",
  "authorize_admin_session_handoff_v4",
  "consume_admin_session_handoff_v4",
  "begin_admin_recovery_v4",
  "validate_admin_session_v4",
  "global_admin_signout_v4",
  "set_admin_session_impersonation_v4",
  "admin_password_epoch_v2",
  "admin_mfa_factor_epoch_v2",
])
  assert.ok((migration + foundation).includes(identity), "migration chain lacks " + identity);
assert.ok(migration.includes("pg_advisory_xact_lock"), "bootstrap is not serialized");
assert.ok(migration.includes("admin_bootstrap_state"), "bootstrap lacks permanent tombstone");
assert.ok(
  migration.includes("p_actor_token_hash"),
  "principal provisioning lacks opaque actor authority",
);
assert.ok(migration.includes("s.auth_epoch=p.auth_epoch"), "session validation is not epoch-bound");
assert.ok(migration.includes("auth.jwt()->>'aal'"), "handoff does not prove caller AAL2");
assert.ok(
  migration.includes("impersonated_profile_id=p_profile_id"),
  "impersonation is not DB-bound",
);
assert.equal(
  migration.includes(
    "grant execute on function public.bootstrap_admin_principal_v4(uuid) to authenticated",
  ),
  false,
);

for (const identity of [
  "ADMIN_BOOTSTRAP_SECRET",
  "ADMIN_AUTH_FLOW_SECRET",
  "ADMIN_RECOVERY_SECRET",
  "challengeAndVerify",
  "authorize_admin_session_handoff_v4",
  "consume_admin_session_handoff_v4",
  "begin_admin_recovery_v4",
  "validate_admin_session_v4",
  "global_admin_signout_v4",
  "set_admin_session_impersonation_v4",
])
  assert.ok(session.includes(identity), "server lifecycle lacks " + identity);
assert.ok(
  session.includes("aes-256-gcm"),
  "transient bearer flow is not encrypted and authenticated",
);
assert.ok(session.includes('path: "/"'), "staged auth flow cookie cannot reach server functions");
assert.ok(
  session.includes('setResponseHeader("Set-Cookie", ['),
  "session handoff does not compose response cookies",
);
assert.equal(
  session.includes("p_actor_user_id"),
  false,
  "provisioning still trusts a caller actor UUID",
);
assert.equal(
  constants.includes("obra_impersonate_profile_id"),
  false,
  "legacy impersonation cookie remains",
);

for (const fn of [
  "adminVerifyMfa",
  "adminStartMfaEnrollment",
  "adminFinishMfaEnrollment",
  "adminRecover",
  "adminBootstrap",
  "adminProvisionPrincipal",
  "adminChangePassword",
  "adminLogoutEverywhere",
])
  assert.ok(functions.includes("export const " + fn), "missing server function " + fn);
for (const copy of [
  "Set up admin MFA",
  "Save recovery codes",
  "Recover admin MFA",
  "Authenticator code",
])
  assert.ok(gate.includes(copy), "admin MFA UI lacks " + copy);
for (const copy of ["Provision admin", "Change password", "Sign out all admin sessions"])
  assert.ok(settings.includes(copy), "admin lifecycle UI lacks " + copy);

console.log("verify-admin-recovery: admin auth lifecycle ok");
