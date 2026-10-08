# Bucket 1 generation operations runbook

## Ownership and alert delivery

- **Service:** server-owned unified site generation (background_jobs.job_type = site_generation, contract epoch 2).
- **On-call owner:** Generation on-call.
- **Alert destination:** #obra-generation-oncall through GENERATION_ALERT_WEBHOOK_URL.
- **Monitor:** an external scheduler must POST /api/cron/generation-monitor every minute with Authorization: Bearer GENERATION_MONITOR_SECRET. It must not run from the Supabase pg_cron or response-recorder being monitored.
- **Dedupe:** one incident per bucket1-generation:<alert-id>. Every monitor invocation sends all alert states; the destination opens/updates on firing and resolves on resolved.
- **Dashboard:** /admin/observability; trace-level attempt/media history is under /admin/traces → Generation.
- **Attestation keys:** historical HMAC fields (`BUCKET1_ATTESTATION_KEY_ID` / `BUCKET1_ATTESTATION_SECRET`) are unused on generate → save → preview → Go live. Persist and publish do not require a Chrome QA stamp.

## Production thresholds

| Signal                                                  | Alert threshold | Severity |
| ------------------------------------------------------- | --------------: | -------- |
| independent scheduler silence                           |         > 180 s | critical |
| scheduler delivery, rolling 24 h                        |           < 99% | warning  |
| oldest runnable pending job                             |         > 300 s | critical |
| expired lease not recovered                             |         > 120 s | critical |
| stage latency p95, rolling 24 h                         |         > 900 s | warning  |
| end-to-end latency p95, rolling 24 h                    |       > 1,800 s | warning  |
| reconciliation-required age                             |         > 900 s | critical |
| reconciliation-required time-to-terminal                |       > 3,600 s | critical |
| provider failure/indeterminate rate, at least 5 creates |           > 10% | warning  |
| terminal exhaustion rate, at least 5 terminal jobs      |            > 5% | critical |

These are explicit initial production thresholds. Rebaseline only from measured production evidence and change the code, this table, and the verifier together.

## Triage queries

All timestamps use database time. Use the service role or the admin dashboard; do not expose these projections publicly.

### Runnable, blocked, backoff, and stale-running jobs

```sql
with active as (
  select * from public.background_jobs
  where status in ('pending','running','finalizing')
), generation as (
  select g.*,
    exists (
      select 1 from active p
      where p.chain_id = g.chain_id
        and p.sequence_index < g.sequence_index
    ) as predecessor_blocked,
    exists (
      select 1 from active e
      where e.website_id = g.website_id
        and e.job_type = 'enrichment_platform'
    ) as enrichment_blocked
  from active g
  where g.job_type = 'site_generation' and g.generation_contract_epoch = 2
)
select id, agent_trace_id, website_id, generation_stage, status,
  case
    when status = 'running' and lease_expires_at <= clock_timestamp() then 'stale-running'
    when status = 'pending' and next_retry_at > clock_timestamp() then 'backoff-waiting'
    when status = 'pending' and (predecessor_blocked or enrichment_blocked) then 'dependency-blocked'
    when status = 'pending' then 'runnable-pending'
  end as projection,
  extract(epoch from clock_timestamp() - coalesce(lease_expires_at, created_at))::bigint as age_seconds
from generation
order by created_at;
```

### Reconciliation-required work

```sql
select j.id, j.agent_trace_id, j.website_id, j.generation_stage,
  s.slot_id, s.provider_name, s.provider_reservation_id, s.provider_idempotency_key,
  s.provider_operation_id, s.effect_certainty, s.reconciliation_required_at,
  s.reconciliation_deadline,
  extract(epoch from clock_timestamp() - s.reconciliation_required_at)::bigint as reconciliation_age_seconds,
  extract(epoch from clock_timestamp() - j.created_at)::bigint as end_to_end_age_seconds
from public.site_generation_media_slots s
join public.background_jobs j on j.id = s.job_id and j.website_id = s.website_id
where j.job_type = 'site_generation'
  and j.status in ('pending','running','finalizing')
  and s.status = 'reconciliation_required'
  and s.effect_certainty = 'indeterminate'
order by s.reconciliation_required_at;
```

### Scheduler delivery

```sql
select schedule_name, request_id, requested_at, responded_at, status_code, timed_out, outcome
from public.background_job_cron_health
where schedule_name = 'obra-run-background-jobs'
order by requested_at desc
limit 120;
```

### Full attributable trace

```sql
select j.id as job_id, j.agent_trace_id, j.status as job_status, j.generation_stage,
  e.id as event_id, e.claim_epoch, e.stage_attempt, e.event_type, e.cause_code,
  e.effect_certainty, e.disposition, e.severity, e.runner_id, e.invocation_id,
  e.deployment_id, e.started_at, e.completed_at, e.created_at
from public.background_jobs j
left join public.site_generation_attempt_events e on e.job_id = j.id
where j.id = '<job-id>'
order by e.created_at, e.id;

select job_id, slot_id, role, kind, status, required, claim_epoch, slot_claim_epoch,
  slot_locked_by, slot_lease_expires_at, effect_certainty, provider_name, provider_create_count,
  provider_reservation_id, provider_idempotency_key, provider_request_hash, provider_operation_id,
  reconciliation_required_at, reconciliation_deadline, reconciliation_actor, reconciliation_reason,
  reconciliation_evidence, reconciled_at, cleanup_required, cleanup_completed_at,
  asset_id, storage_path, content_hash, error_message, claimed_at, abandoned_at, updated_at
from public.site_generation_media_slots
where job_id = '<job-id>'
order by updated_at, slot_id;
```

## Response procedure

1. **Acknowledge and identify the projection.** Open /admin/observability; copy the alert ID, oldest age, job IDs, and observed timestamp into the incident.
2. **Correlate one job end to end.** Open its trace and Generation tab. Confirm job, trace, event, media slot, result version, claim epoch, and deployment identity. Treat missing termination detail as unknown; never invent a platform subtype.
3. **Scheduler silence:** verify the external monitor itself is still invoking. Then inspect background_job_cron_health. A missing request means scheduling failed; missing_response/timeout/non-2xx means delivery or application failed. Do not use the monitored cron to prove its own health.
4. **Runnable pending:** check scheduler health first, then overlap/claim activity. Preserve the existing request/checkpoint. Do not enqueue a replacement request.
5. **Stale running:** wait for the next claim cycle to perform fenced DB-time lease recovery. If age continues past threshold, confirm worker deliveries and compare claim epoch/event history; never clear ownership manually.
6. **Dependency blocked/backoff:** identify the exact predecessor/enrichment dependency or next_retry_at; this is not runnable backlog. Escalate only when its own age/SLO is breached.
7. **Reconciliation required:** this is nonterminal and excluded from ordinary claims. Verify provider status using the stable reservation ID, provider idempotency key, operation ID (when available), content hash, and storage path. Never retry an indeterminate create or update the ledger directly. Once evidence establishes certainty, invoke only the audited service RPC described below.
8. **Latency/provider/exhaustion:** group failures by stage, cause, deployment, and provider operation. Stop new generation admission if there is a broad active incident; preserve unrelated jobs and the same checkpoints.
9. **Resolution:** require two consecutive external monitor evaluations with the alert state resolved and no affected job older than threshold. Record the final terminal projection for every affected job.

## Media provider reconciliation (service only)

Owner: application on-call. Acknowledgement SLO: 900 seconds from `reconciliation_required_at`; resolution/escalation deadline: `reconciliation_deadline` (one hour). The durable slot row—not the rolling event window—is the alert authority. Provider/global concurrency is capped at 8 and per customer at 2 by DB-time, transaction-locked reservations; a slot permits at most two creates and create #2 requires a recorded definite failure.

1. Load the exact slot diagnostic above. Record job, website, slot, provider reservation, idempotency key, operation ID, claim epochs, required flag, age and deadline.
2. Establish one outcome with non-secret evidence: `ready` (provider/storage success), `retry` (definite provider failure and create count below two), `reject` (attributable abandonment), or `cleanup` (orphan removed/reference-safe cleanup completed). Indeterminate evidence is not authority.
3. Call only:

   `select public.reconcile_generation_media_slot_epoch('<job>','<website>','<slot>','<reservation>','<stable-action-key>','<ready|retry|reject|cleanup>','<actor>','<reason>','<evidence-json>'::jsonb);`

   For `ready`, evidence must include canonical `storagePath`, full SHA-256 `contentHash`, and `mimeType`. A retry clears only the resolved reservation and returns the same slot to its single remaining retry unit. Reject and cleanup converge to `abandoned`; cleanup additionally records cleanup completion.

4. Exact replay with the same action key returns the existing status. Changed action/evidence or stale reservation identity must not succeed. The RPC appends an attributed event; it never creates a successor job/version.
5. Verify slot status is `ready`, `failed`, or `abandoned`, reconciliation age is absent from /admin/observability, and any `ready`/`retry` parent job is runnable. Continue normal finalization; do not manually change parent checkpoint/version state.

## Explicit administrative supersession

This is an administrative exception path, not normal admission. The product's second generation request remains busy while an active request exists. Do not add UI wiring, a queue, a renderer, timeout-driven supersession, or automatic invocation. Only the service-role database client may call `supersede_site_generation_epoch`. Historical epoch-1 and cancellation behavior remains supported.

Use supersession only after an operator has proved that one exact epoch-2 request must be terminated so a separately submitted later request can proceed. Lease expiry is not authority. Capture the website ID, job ID, generation request ID, current claim epoch, a stable actor identity, and a non-secret reason in the incident record.

1. Confirm the target is `job_type = 'site_generation'`, `generation_contract_epoch = 2`, and `status in ('pending','running','finalizing')`. Confirm no version was persisted and there is no running external trace operation.
2. Invoke only the exact scoped service RPC; do not update tables directly:

   `select public.supersede_site_generation_epoch('<website>', '<job>', '<request>', <claim_epoch>, '<actor>', '<reason>');`

3. A `true` result means either the atomic supersession committed or an exact same actor/reason/website/job/request/claim replay was verified. A `false` result means stale or mismatched identity, non-active state, or a different terminal outcome; investigate rather than broadening the selector. Database exceptions indicate an unsafe or inconsistent projection and roll back the whole call.
4. Verify the same terminal identity across all projections:
   - `background_jobs.status = 'superseded'`, exact `superseded_at = completed_at`, actor/reason, cleared lease/locks/retry, `generation_result_version_id is null`, and result status `superseded`;
   - the accepted handoff message was reused as `generation_terminal_message_id` with safe replacement text and matching job/request/claim payload (no second message);
   - the bound trace is completed; every unattached planned/generating/ready/failed media slot is abandoned and attached/versioned material is unchanged;
   - exactly one append-only `site_generation_attempt_events` row has key `<job>:<claim>:superseded`, event type/status `superseded`, disposition `supersede`, and the audited actor/reason.
5. Repeating the exact call is the only valid idempotent replay. A changed actor, reason, request, claim epoch, or incomplete terminal projection must not succeed.
6. Submit any successor through the existing request path only after verification. The first request's supersession never creates or admits a successor.

Diagnostic query:

`select id, website_id, generation_request_id, claim_epoch, status, superseded_at, supersession_actor, supersession_reason, generation_terminal_message_id, generation_terminal_message_payload, result_json from public.background_jobs where id = '<job>';`

Then inspect the same job in `site_generation_attempt_events` and `site_generation_media_slots`, plus its exact handoff message and trace. Never place credentials, tokens, provider prompts, or customer source content in the actor/reason fields.

## Forward rollback and escalation

- Pause only new generation enqueues/claims through the existing generation flag/control; do not disable unrelated background jobs or cron.
- Fence active owners and preserve/requeue the same checkpoints. Never restore browser ownership, create a second worker, or silently replan.
- Deploy the declared known-good app/server worker that reads the expanded schema at a new forward epoch. Verify claim/lease compatibility before re-enabling.
- Escalate immediately to the application owner for cross-tenant backlog, repeated indeterminate provider effects, duplicate version/media evidence, or any job approaching the 3,600-second reconciliation terminal bound.
- Record app commit, deployment, DB generation-contract epoch, schedule evidence, smoke evidence, outage start/end, and every affected request/job/terminal result.

## Acceptance drill

Before Bucket 1 cutover and after monitor/destination changes:

1. Use an isolated test/staging environment and point GENERATION_ALERT_WEBHOOK_URL at the named test channel.
2. Pause only the background-job scheduler for more than 180 seconds while leaving the external monitor running. Confirm one scheduler-silence firing notification with the expected dedupe key.
3. Restore the scheduler. Confirm a resolved notification on the same dedupe key.
4. Seed controlled old timestamps/fixture rows for runnable pending, stale running, reconciliation required, provider failure, and exhaustion. Invoke the external monitor and confirm each expected firing notification.
5. Remove/settle every fixture, invoke twice, and confirm resolution delivery for each key.
6. Capture destination message IDs, dashboard screenshots, fixture/job IDs, and observed timestamps as release evidence. Production traffic must never be mutated for this drill.

## Production activation evidence (mandatory exit gate)

Bucket 1 local code gates do not authorize production cutover. Keep Bucket 2 production integration disabled until every item below has durable evidence.

> Site builds finish on the existing `/api/internal/run-jobs` Cloudflare loop: compose and save. They do not launch Playwright, mint a QA stamp, or wait for `browser_ready`. Do not add a second queue, a VPS, or a fake “passed QA” stamp. The library Chromium validator remains off the product path.

1. Apply the ordered Bucket 1 chain through `20260828120000_bucket1_server_owned_generation.sql`, `20260828121000_bucket1_production_durability_hardening.sql`, `20260828122000_bucket1_add_video_v4_admission.sql`, `20260828123000_bucket1_add_video_media_closure.sql`, `20260828160000_bucket1_lifecycle_audit_fixes.sql`, `20260828170000_bucket1_lifecycle_convergence.sql`, and every later Bucket 1 forward migration in timestamp order; archive migration IDs, timestamps, successful transaction output, and the resulting function/grant/cron catalog.
2. Regenerate `src/integrations/supabase/types.ts` from that migrated Cloud schema and prove the generated diff contains the epoch-2 job/media/interruption/finalizer contracts without hand-maintained seams.
3. Configure `JOB_RUNNER_SECRET`, generation monitor secret, alert webhook destination, and canonical application URL. Prove secrets are present without recording secret values. Chrome QA HMAC secrets are not required for generate → save → Go live.
4. Prove `POST /api/internal/run-jobs` is scheduled and heartbeating (any capability, last_seen within two minutes). That heartbeat is the admission gate: enqueue refuses only when the loop is silent, not when Chromium is absent. The `BUCKET1_EPOCH2_CLAIMS_ENABLED` flag is retired; the Cloudflare runner always claims epoch-2 `site_generation`. Prove the external generation monitor is independently scheduled.
5. Before cutover, collect the plan-required production-like baseline P50/P95/P99 for acceptance-to-claim, each stage, lease recovery, and end-to-end terminal completion. Record sample count, workload, environment, deployment, timestamps, and percentile query/output.
6. Run migration/rollback rehearsal, stale lease recovery, scoped cancellation, provider indeterminate reconciliation, terminal replay, empty/evidence-only manifest, schema-v4 Add Video, alert firing/resolution, and success/failure/cancel terminal projection drills in an isolated target environment.
7. Run deployed generation proof after refresh/reopen: submit once, close every observer, allow the Cloudflare job runner to compose and save, reopen, and verify the same request/trace/job/checkpoint/version/media/terminal identity. Publish (Go live) must succeed on that preview without a QA stamp.
8. Confirm every Bucket 1 SLO/diagnostic/alert gate passes for the observation window. Only then enable the Bucket 1 production writer. Bucket 2 remains disabled until the Bucket 1 exit decision and evidence links are recorded.

### Capability-gated admission

Epoch-2 site-generation and Add Video admission is fail-closed on **job-runner liveness**, not Chromium. The `/api/internal/run-jobs` loop heartbeats `last_seen` (capability 2, `browser_ready=false`). Insert refuses only when no runner has been seen within two minutes. A dead cron must not create a silent 0% backlog. Do not insert or replay epoch-2 jobs manually to bypass this gate. Pending rows are not failed after five minutes for missing Chrome.

Lifecycle maintenance now runs in a separate transaction before claiming. Maintenance errors are logged but cannot roll back or block an unrelated claim. Generated-media cleanup is a live hourly reference-checked deletion job; it marks ledger cleanup complete only after physical deletion succeeds.
