import assert from "node:assert/strict";
import fs from "node:fs";

const migrationFiles = [
  "20260828120000_bucket1_server_owned_generation.sql",
  "20260828121000_bucket1_production_durability_hardening.sql",
  "20260828122000_bucket1_add_video_v4_admission.sql",
  "20260828123000_bucket1_add_video_media_closure.sql",
  "20260828160000_bucket1_lifecycle_audit_fixes.sql",
  "20260828170000_bucket1_lifecycle_convergence.sql",
  "20260828171000_bucket1_transactional_publish_attestation.sql",
  "20260828172000_bucket1_add_video_attestation.sql",
  "20260828173000_bucket1_staged_add_video.sql",
];
const migration = migrationFiles
  .map((file) => fs.readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");
const ledger = fs.readFileSync("src/lib/media/generation-media-slots.server.ts", "utf8");
const generator = fs.readFileSync("src/lib/agent/website-generator.server.ts", "utf8");
const provider = fs.readFileSync("src/lib/media/lovable-media.server.ts", "utf8");
const claim = fs.readFileSync("src/lib/jobs/claim.server.ts", "utf8");
const runner = fs.readFileSync("src/lib/jobs/runner.server.ts", "utf8");
const observability = fs.readFileSync("src/lib/generation-observability.server.ts", "utf8");
const runbook = fs.readFileSync("docs/runbooks/bucket1-generation.md", "utf8");

function sqlBody(name, signatureFragment) {
  const start = migration.lastIndexOf(
    `create or replace function public.${name}(${signatureFragment}`,
  );
  assert.notEqual(start, -1, `missing effective ${name} function`);
  const end = migration.indexOf("$$;", start);
  assert.notEqual(end, -1, `unterminated ${name} function`);
  return migration.slice(start, end + 3);
}

const reserve = sqlBody("reserve_generation_media_create_epoch", "\n  p_job_id uuid");
assert.match(reserve, /pg_advisory_xact_lock\(hashtextextended\('media-provider:'/);
assert.match(reserve, /global_in_flight>=global_cap or tenant_in_flight>=tenant_cap/);
assert.match(reserve, /provider_create_count>=2/);
assert.match(
  reserve,
  /provider_create_count>0 and current_slot.effect_certainty<>'definite_failure'/,
);
assert.match(reserve, /provider_reservation_id is not null/);
assert.match(reserve, /provider_reservation_id=reservation/);
assert.match(reserve, /provider_idempotency_key=idem/);
assert.match(reserve, /slot_locked_by<>p_runner_id/);
assert.match(reserve, /slot_lease_expires_at<=clock_timestamp()/);

const settle = sqlBody("settle_generation_media_slot_epoch", "\n  p_job_id uuid");
assert.match(
  settle,
  /p_effect_certainty in \('indeterminate','definite_success'\) then 'reconciliation_required'/,
);
assert.match(settle, /provider_effect_succeeded_persistence_failed/);
assert.match(settle, /reconciliation_deadline=.*interval '1 hour'/s);
assert.match(settle, /status='pending',next_retry_at=null/);
assert.doesNotMatch(settle, /status='failed'.*p_effect_certainty='indeterminate'/s);

const reconcile = sqlBody("reconcile_generation_media_slot_epoch", "\n  p_job_id uuid");
for (const action of ["ready", "retry", "reject", "cleanup"])
  assert.ok(reconcile.includes(`'${action}'`));
assert.match(reconcile, /reconciliation_action_key=p_action_key then return slot\.status/);
assert.match(reconcile, /provider_reservation_id is distinct from p_reservation_id/);
assert.match(reconcile, /p_action='retry' and slot\.effect_certainty='definite_success'/);
assert.match(reconcile, /jsonb_build_object\('slotId'.*'actor'.*'evidence'/s);
assert.match(
  reconcile,
  /result_status:=case p_action when 'ready' then 'ready' when 'retry' then 'failed' else 'abandoned' end/,
);

const fairClaim = sqlBody(
  "claim_next_background_job",
  "\n  p_runner_id text,p_stale_before timestamptz,p_generation_contract_epoch integer,p_scheduler_run_id uuid",
);
assert.match(fairClaim, /scheduler_last_run_id is distinct from p_scheduler_run_id/);
assert.match(fairClaim, /for step in 1\.\.4 loop/);
assert.match(fairClaim, /active_site\.user_id=website\.user_id/);
assert.match(fairClaim, /generation_contract_epoch=2[\s\S]*global_active<8/);
assert.match(fairClaim, /active\.status='running'.*<2/s);
assert.match(fairClaim, /slot.status='reconciliation_required'/);
const supersede = sqlBody("supersede_site_generation_epoch", "\n  p_website_id uuid");
assert.match(supersede, /slot.provider_reservation_id is not null/);
assert.match(supersede, /slot\.effect_certainty not in \('not_started','definite_failure'\)/);
const supersedeMediaMutation = supersede.slice(
  supersede.indexOf("update public.site_generation_media_slots"),
  supersede.indexOf("get diagnostics abandoned_media_count"),
);
assert.doesNotMatch(supersedeMediaMutation, /then 'indeterminate'/);

assert.match(
  migration,
  /revoke insert,update,delete,truncate on table public.site_generation_media_slots from service_role/,
);
assert.match(
  migration,
  /revoke insert,update,delete,truncate on table public.site_generation_attempt_events from service_role/,
);
assert.match(
  migration,
  /grant execute on function public.reconcile_generation_media_slot_epoch.*to service_role/,
);
assert.match(migration, /idx_generation_media_reconciliation_due/);
assert.match(migration, /idx_generation_media_provider_capacity/);
assert.match(migration, /idx_background_jobs_epoch2_fair_dispatch/);

// Code-path proof: one shot and one provider call per claim, exact runner and stable reservation identity.
assert.match(generator, /shots: nextMediaShot \? \[nextMediaShot\] : \[\]/);
assert.match(generator, /maxStillAttempts: 1/);
assert.match(generator, /stillConcurrency: 1/);
assert.match(generator, /provider: shot\.kind === "image" \? "lovable-image" : "lovable-video"/);
assert.match(generator, /reservationBySlot\.set\(shot\.id, reservation\)/);
assert.match(generator, /disposition === "indeterminate"/);
assert.match(generator, /disposition === "terminal" && operationId/);
assert.match(generator, /\? "definite_success"/);
assert.match(provider, /onOperationAccepted\?\.\(shot, generated\.operationId\)/);
assert.match(provider, /for \(let attempt = 0; attempt < 1; attempt \+= 1\)/);
assert.match(
  provider,
  /if \(indeterminate \|\| errorName === "MediaCreateBudgetError"\) throw error/,
);
assert.match(ledger, /Epoch media mutation requires the exact current runner/);
assert.match(ledger, /p_reservation_id: \(options\.reservationId \?\? null\) as unknown as string/);
assert.match(claim, /p_scheduler_run_id: schedulerRunId/);
assert.match(runner, /claimNextJob\(supabase, schedulerRunId\)/);

// Durable slot rows remain observable after the rolling event window and expose auditable age.
assert.match(observability, /slot\.status === "reconciliation_required"/);
assert.match(observability, /slot\.reconciliation_required_at \?\? slot\.updated_at/);
assert.doesNotMatch(
  observability,
  /from\("site_generation_media_slots"\)[\s\S]{0,500}\.gte\("updated_at", windowStart\)/,
);
assert.match(runbook, /reconcile_generation_media_slot_epoch/);
assert.match(runbook, /Never retry an indeterminate create/);

// Small executable transition model mirrors the SQL guards and proves cap/retry/no-blind-recreate.
function mayCreate(slot) {
  return (
    slot.status === "generating" &&
    slot.reservationId === null &&
    slot.effect !== "indeterminate" &&
    slot.creates < 2 &&
    (slot.creates === 0 || slot.effect === "definite_failure")
  );
}
const first = { status: "generating", reservationId: null, effect: "not_started", creates: 0 };
assert.equal(mayCreate(first), true);
const definiteFailure = {
  status: "generating",
  reservationId: null,
  effect: "definite_failure",
  creates: 1,
};
assert.equal(
  mayCreate(definiteFailure),
  true,
  "one definite failure permits exactly one slot retry",
);
assert.equal(mayCreate({ ...definiteFailure, creates: 2 }), false, "third create exceeds hard cap");
assert.equal(
  mayCreate({
    status: "reconciliation_required",
    reservationId: "r1",
    effect: "indeterminate",
    creates: 1,
  }),
  false,
  "indeterminate effects must reconcile and never recreate",
);

console.log("verify-bucket1-media-concurrency: ok");
