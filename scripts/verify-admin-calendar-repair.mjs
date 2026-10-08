import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260829093924_admin_auth_authority_closure.sql");
const lifetime = read("supabase/migrations/20260910130000_booking_calendar_lifetime.sql");
const session = read("src/lib/auth/admin-session.server.ts");
const operation = read("src/lib/booking-calendar-repair.server.ts");
const route = read("src/routes/api/admin/calendar-repair.ts");
const types = read("src/integrations/supabase/types.ts");

const finalRepair = lifetime.slice(
  lifetime.indexOf("create function public.requeue_booking_calendar_manual_repair"),
  lifetime.indexOf("create function public.get_booking_calendar_repair_context"),
);
const repairContext =
  lifetime.match(
    /create function public\.get_booking_calendar_repair_context\([\s\S]*?grant execute on function public\.get_booking_calendar_repair_context\(uuid,text\) to service_role;/,
  )?.[0] ?? "";
const validator = migration.slice(
  migration.indexOf("create or replace function public.validate_admin_session_v4"),
  migration.indexOf("create or replace function public.revoke_admin_session_v4"),
);

assert.ok(finalRepair.includes("public.validate_admin_session_v4(p_actor_token_hash,false)"));
assert.equal(finalRepair.includes("from public.admin_sessions s"), false);
assert.equal(finalRepair.includes("p_actor_user_id"), false);
assert.ok(finalRepair.includes("insert into public.booking_calendar_repair_audit"));
assert.ok(
  finalRepair.includes(
    "where id=p_link_id and desired_generation=p_expected_generation and reconcile_status='manual_repair' for update",
  ),
);
assert.ok(
  finalRepair.includes(
    "revoke all on function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb) from public,anon,authenticated,service_role,booking_worker",
  ),
);
assert.ok(
  finalRepair.includes(
    "grant execute on function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb) to service_role",
  ),
);
assert.ok(
  lifetime.includes(
    "drop function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text)",
  ),
);
for (const required of [
  "p_resolution jsonb default null",
  "public.booking_cutover_enabled(a.profile_id,a.environment)",
  "a.version<>expected_version or a.calendar_generation<>p_expected_generation",
  "prior.evidence is distinct from p_resolution",
  "original account is explicitly disconnected",
  "reservation repair requires the original deterministic event identity",
  "original record conflicts with retained calendar effect identity",
  "current selection is not original destination evidence",
  "'original_reservation_record'",
  "'retained_outbox'",
])
  assert.ok(finalRepair.includes(required), "missing repair authority: " + required);
assert.ok(repairContext.includes("public.validate_admin_session_v4(p_actor_token_hash,false)"));
assert.ok(
  repairContext.includes(
    "revoke all on function public.get_booking_calendar_repair_context(uuid,text) from public,anon,authenticated,service_role,booking_worker",
  ),
);
assert.ok(
  repairContext.includes(
    "grant execute on function public.get_booking_calendar_repair_context(uuid,text) to service_role",
  ),
);
assert.doesNotMatch(repairContext, /\b(?:insert|update|delete)\s+(?:into|public\.|from public\.)/i);
assert.ok(
  migration.includes(
    "revoke insert,update,delete,truncate on table public.appointments,public.integration_outbox,public.calendar_event_links",
  ),
);
assert.ok(
  migration.includes(
    "public.booking_late_payment_arbitrations,public.booking_late_payment_observations",
  ),
);
assert.ok(
  migration.includes(
    "public.booking_calendar_observations,public.booking_calendar_effect_attempts,public.booking_calendar_repair_audit",
  ),
);
assert.ok(
  migration.includes(
    "revoke all on table public.admin_principals,public.admin_sessions,public.admin_login_throttle_buckets from service_role",
  ),
);
assert.ok(
  migration.includes(
    "grant select(user_id,enabled,mfa_required,recovery_codes_issued_at) on table public.admin_principals to service_role",
  ),
);
assert.ok(migration.includes("booking_calendar_repair_audit_no_truncate"));
assert.ok(validator.includes("perform public.admin_auth_lock_v4(principal_id)"));
assert.ok(
  validator.indexOf("perform public.admin_auth_lock_v4(principal_id)") <
    validator.indexOf("p.enabled and p.mfa_required"),
);
assert.ok(validator.includes("u.deleted_at is null"));
assert.ok(migration.includes("old.deleted_at is distinct from new.deleted_at"));
assert.ok(migration.includes("after update of banned_until,confirmed_at,deleted_at on auth.users"));
assert.ok(
  migration.includes(
    "perform public.bump_admin_auth_epoch_v2(new.id,'provider_authority_changed')",
  ),
);
assert.ok(
  migration.includes(
    "perform public.bump_admin_auth_epoch_v2(item.user_id,'provider_user_soft_deleted')",
  ),
);

assert.ok(session.includes("requireAdminSessionTokenHash"));
assert.ok(session.includes("getCookie(ADMIN_SESSION_COOKIE, request)"));
assert.ok(session.includes("return hash(token)"));
assert.ok(operation.includes("requireAdminSessionTokenHash(request)"));
assert.ok(operation.includes('supabaseAdmin.rpc("requeue_booking_calendar_manual_repair"'));
assert.ok(operation.includes("p_actor_token_hash: actorTokenHash"));
assert.ok(operation.includes("p_resolution: input.resolution"));
assert.ok(operation.includes('"get_booking_calendar_repair_context"'));
assert.equal(operation.includes("p_actor_user_id"), false);

assert.ok(route.includes('createFileRoute("/api/admin/calendar-repair")'));
assert.ok(route.includes("assertAdminSameOriginMutation(request)"));
assert.ok(route.includes(".strict()"));
assert.ok(route.includes('"Cache-Control": "no-store"'));
assert.equal(route.includes("actorToken"), false);
assert.equal(route.includes("actorUser"), false);
assert.ok(route.includes("GET: async ({ request })"));
assert.ok(route.includes("getBookingCalendarRepairContext(request, appointmentId.data)"));
assert.ok(route.includes("Boolean(value.linkId) !== Boolean(value.resolution)"));
assert.ok(route.includes("googleEventId: z.string().regex(/^[0-9a-v]{5,1024}$/)"));
assert.doesNotMatch(
  route + operation,
  /(?:fetch\s*\(|pipedream\.server|createGoogleBookingEvent|deleteGoogleBookingEvent)/,
);

assert.ok(types.includes("requeue_booking_calendar_manual_repair: {"));
assert.ok(types.includes("p_actor_token_hash: string"));
console.log("verify-admin-calendar-repair: passed");
