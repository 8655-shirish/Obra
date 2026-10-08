# Calendar Worker Operations

## Scope And Status

These changes maintain saved Google and Stripe evidence without an owner browser, and keep booking servicing separate from new admission. They do not create immortal OAuth grants or establish production readiness, installed schedules, actual hosting limits, alert delivery, or provider acceptance.

**Current correction (2026-09-13):** a new PR based on reported HEAD `206674d` replaces the failed cross-owner policy prerequisite with native owner-scoped scheduling. Full implementation, tests and review are ongoing; the primary owns source, Git, tests, journal and final evidence. Earlier local verification is historical, not a pass for this revision. Per the primary/user report, `206674d` (titled `Applied bootstrap`) changes only a type file; the title is not evidence of deployed SQL, grants or schedules. This docs-only update performs no deployment. See [the plan](../../plan/pipedream_cron.md) for historical findings and release boundaries.

The scheduling migration is `supabase/migrations/20260910140000_calendar_worker_schedules.sql`. Committing a file is not applying it to Lovable Cloud. Installation checks native scheduler-owner grants, defines RPCs and retains the existing cron ledger extensions; it **does not register, activate, or dispatch any job**, even in a migration dry run. Registration is a separate RPC and always leaves this owner's four exact jobs for the requested environment inactive; re-registration pauses them. Configuration/origin checks occur at activation and dispatch, not registration. No generation or attachment schedule is changed. Keep `pg_cron`, `pg_net` and the existing ledger; no queue, application job registry or new table is introduced.

The pinned production origin is `https://obratech.co`, matching deployed `PUBLIC_APP_URL`. Prior authorized deployment evidence established that `https://obra-tech.lovable.app` returns a 307 to that origin. The alias is rejected: using it would strip the bearer on the cross-origin redirect and prevent cron authentication. Target the canonical host directly, including for the migration runner.

**Supported scheduler transport:** dispatch uses stock five-argument `net.http_post`, not a hypothetical no-follow overload. Inspected [pg_net 0.19.5 source](https://github.com/supabase/pg_net/blob/v0.19.5/src/core.c) sets `CURLOPT_HTTPHEADER` and `CURLOPT_FOLLOWLOCATION`, never `CURLOPT_UNRESTRICTED_AUTH`. [libcurl's contract](https://curl.se/libcurl/c/CURLOPT_UNRESTRICTED_AUTH.html) strips custom `Authorization` when hostname, protocol or port changes; hostname stripping dates to 7.58.0 and the complete scheme/port check requires [7.83.0 or the security backport](https://curl.se/docs/CVE-2022-27774.html). Local libcurl redirect tests cover changed host/port and an unsafe-option negative control. The code targets only the fixed canonical HTTPS origin and exact paths; scheduled requests and results are checked for matching schedule/environment/path/body. The bearer appears only in `Authorization`, never another custom header, body or URL. Hosted extension/libcurl versions have not been queried; verify the supported security behavior during the authorized rollout, not by introducing a new service or scheduler.

**Finite invocation transport:** the cron routes now establish `withWorkerDeadline` at the existing Supabase/Stripe server network seams, including calls from booking reconciliation. Core payment/refund, SaaS inbox/OTP, notifications, scanner and storage effects all inherit that context. Provider requests stop before a reserved DB settlement window. Fetch headers and bodies are aborted and bounded, Stripe network retries are disabled for cron, and PostgREST retry-after sleeps are prevented inside this context. Routes await workers and transport cleanup, not a detached timeout race. This establishes a code execution bound; actual hosting limits, volume capacity and no-browser/provider soak remain deployment evidence, not a production-readiness claim.

## Deployment Order

Follow `cursor.md`'s mandatory review, authorization, dry-run and apply sequence exactly. The direct canonical endpoint below corrects its redirecting host alias without changing that sequence. This runbook does not authorize any hosted operation.

**Reported deployed state, not re-queried here:** `20260910120000_google_calendar_lifetime.sql`, `20260910130000_booking_calendar_lifetime.sql` and `20260910133000_booking_notification_lifetime.sql` are **already applied and immutable**. Migration 140 failed and rolled back; the old policy-bootstrap attempt also rolled back. `20260910150000_calendar_action_notifications.sql` was never attempted. Do not edit or reapply the first three migrations.

1. In the new PR, edit/replace only the **unapplied** `20260910140000_calendar_worker_schedules.sql`, using the same filename and a **new checksum**. Add no columns or duplicate SQL definitions for this correction. Preserve the existing Stripe and `capture_calendar_worker_cron_response` definition bodies; leave migration 150's business logic unchanged. If the ledger unexpectedly reports 140 or 150 applied, stop rather than rewriting or replaying it.
2. Test code and SQL in disposable local PostgreSQL with inert cron/net/Vault stubs. Keep the migration unapplied to **all deployed databases**. The primary local harness must run the SQL suite below with real PostgreSQL locking, rollback, privileges and safeupdate enabled.
3. Raise one review PR containing code and migration when requested. Do not apply SQL before or during review.
4. Stop and wait for the user to merge that PR. Approval, green CI or an observed merged state is not application authorization.
5. Wait for the user to return and explicitly confirm the merge **and** authorize migration application.
6. Only then inspect the production runner's published allowlist and the **new exact SHA-256 checksum for corrected 140**. Prior authorization or a dry run of the old bytes does not authorize the replacement. The endpoint is `POST https://obratech.co/api/internal/apply-migration`, authenticated with the server-only `MIGRATION_RUNNER_SECRET`. Never put arbitrary SQL or credentials in a request log.
7. Run the runner's default rollback-only dry run for the exact migration name/checksum; inspect HTTP status, result and SQLSTATE. Stop on any error, mismatch, missing allowlist entry or unexpected result.
8. Only after that successful dry run, apply the **same name and checksum** with `mode: "apply"`. No SQL-editor shortcut.
9. Verify the apply response, `migration_runs`, `applied_repo_migrations`, intended RPC signatures, grants, and schema. Apply through Lovable (Supabase / Cloud) only through this mandatory runner process.

Resume only with corrected **140, then unchanged 150**, each through explicit post-merge authorization, published allowlist/checksum verification, successful exact-checksum dry run, apply and ledger verification. Do not reapply migrations 120, 130 or 133. Keep worker schedules inactive and the application workers off during the schema/application transition: 140's fenced Stripe release signature deliberately removes the old unfenced overload. The health RPC reads the existing connection, paid-obligation and notification/review authorities. Generated-type parity and compatible lifecycle/transport/booking runtime deployment remain part of the primary's ongoing verification. Do not deploy a runtime with missing exports.

## Native Scheduler Preflight

The expected migration-runner and scheduler definer owner is `postgres`, not the service-role caller. It must have `LOGIN`, `USAGE` on schema `cron`, `SELECT` on `cron.job`, and effective `EXECUTE` on native `cron.schedule(text,text,text)` and `cron.alter_job(bigint,text,text,text,text,boolean)`. Stock `pg_cron` grants PUBLIC execution of the named schedule overload but revokes it for `alter_job`; schema access and job ownership do not confer function execution. Verify effective grants rather than assuming them from the role name or local tests.

Use native APIs and explicit `username = current_user` filters under the existing owner RLS, even if a role has wider visibility. No policy on protected `cron` objects, RLS bypass, `BYPASSRLS`, raw cron writes, ownership change or role elevation is required or permitted by this correction. It does not require a platform-privileged setup procedure. If required native grants are missing, stop and ask the existing native object grant authority; do not self-grant, invent a privileged RPC or use a SQL-editor workaround.

**Deployment constraint:** only these owned jobs are trusted for calendar scheduling, with no separately configured hidden HTTP bearer jobs invoking these calendar workers. Cross-owner uniqueness is neither observable nor guaranteed: foreign exact-name jobs and an active foreign environment may remain invisible and untouched. An owner-only catalog query, shared ledger or application registry cannot prove their absence. This constraint must be maintained by the deployment's scheduling configuration; it is not a global collision check. Unrelated generation/attachment schedules and supported manual bearer calls are not redesigned.

During an authorized investigation, the following **read-only** queries inspect current identity, owner grants, function ACLs and net/Vault metadata. They do not read secret values, function bodies or HTTP headers/bodies, and require no new privileged setup. Missing native objects, missing grants or an unexpected runner owner are stop conditions. Missing 140 functions before its application are expected. A null `proacl` means default ACLs; use the effective `runner_execute` result, not null as a denial.

```sql
select current_user as inspecting_role, session_user as login_role,
       r.rolname as runner_owner, r.rolcanlogin as runner_can_login,
       pg_catalog.has_schema_privilege(p.proowner, 'cron', 'USAGE') as cron_usage,
       pg_catalog.has_table_privilege(p.proowner, 'cron.job', 'SELECT') as cron_job_select,
       pg_catalog.has_schema_privilege(p.proowner, 'net', 'USAGE') as net_usage,
       pg_catalog.has_table_privilege(p.proowner, 'net._http_response', 'SELECT') as net_response_select,
       pg_catalog.has_schema_privilege(p.proowner, 'vault', 'USAGE') as vault_usage,
       pg_catalog.has_table_privilege(p.proowner, 'vault.decrypted_secrets', 'SELECT') as vault_select
from pg_catalog.pg_proc p
join pg_catalog.pg_roles r on r.oid = p.proowner
where p.oid = pg_catalog.to_regprocedure('public.apply_repo_migration(text,text,text,text,text)');

with runner as (
  select proowner from pg_catalog.pg_proc
  where oid = pg_catalog.to_regprocedure('public.apply_repo_migration(text,text,text,text,text)')
)
select p.oid::regprocedure as function_signature,
       pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
       p.proacl as explicit_acl,
       pg_catalog.has_function_privilege(r.proowner, p.oid, 'EXECUTE') as runner_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join runner r
where (n.nspname = 'cron' and p.proname in ('schedule', 'alter_job'))
   or (n.nspname = 'net' and p.proname = 'http_post')
   or (n.nspname = 'public' and p.proname in (
     'apply_repo_migration', 'assert_calendar_worker_cron_privileges',
     'register_calendar_worker_schedules', 'set_calendar_worker_schedules_active',
     'validate_calendar_worker_cron_configuration', 'dispatch_calendar_worker_schedule',
     'get_calendar_worker_health'))
order by n.nspname, p.proname, p.oid;

select extname, extversion from pg_catalog.pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault') order by extname;
select pg_catalog.current_setting('log_min_messages') as session_log_min_messages;
```

Verify the exact native signatures above and stock `net.http_post(text,jsonb,jsonb,jsonb,integer)`, not a different overload; installed calendar definers must share the runner owner. Catalog grants do not prove scheduling ability, valid runtime/Vault values or hosted transport behavior. Actual scheduling ability requires separately authorized **inactive registration** and verification through the native APIs, not an unapproved schedule/alter probe. The queries above are not executed by this documentation update.

`assert_calendar_worker_cron_privileges(p_require_schedule boolean default true)` is an unexposed SECURITY INVOKER preflight shared by installation/registration/activation. Missing native owner privileges fail closed with `42501`; it neither creates nor validates a cross-owner policy. Deactivation skips configuration and schedule-EXECUTE checks, but still requires owner LOGIN, cron USAGE, own-job SELECT and native alteration authority. The old machine-extracted policy-bootstrap block is removed; tests must own inert native-grant fixtures rather than extract executable setup from this runbook.

## Rollout Order

The order is **inactive -> transport -> worker -> soak -> activation**. There is no environment inference or auto-switch, and maintenance activation never grants entitlement or enables charging.

1. **Inactive:** after the migration/application deployment and registration are separately authorized, call `register_calendar_worker_schedules('test')` using service authority. It idempotently registers four every-minute jobs owned by the migration definer, then makes them inactive in the same transaction. Re-registration intentionally pauses these owned jobs, including previously active ones. Confirm owner, exact names and command equality without printing arbitrary command text or credential values. This confirms only the owner-scoped catalog, not absence of foreign jobs; maintain the deployment constraint above.
2. **Transport:** provision approved server-only stores. Vault `CALENDAR_WORKER_CRON_ORIGIN` must be exactly `https://obratech.co`, without trailing slash, credentials, port, path, query or fragment. Vault `CALENDAR_WORKER_CRON_ENVIRONMENT` must equal the intended `test` or `live` runtime. Provision each bearer in Vault to match the receiving runtime. Verify stock `net.http_post(text,jsonb,jsonb,jsonb,integer)` is installed, libcurl is at least 7.83.0 or has the equivalent scheme/port security backport, and `UNRESTRICTED_AUTH` is not enabled by a platform patch. Check the exact canonical POST endpoints are direct targets. Configuration and canonical-origin checks are enforced at activation and every dispatch, not registration; successful inactive registration is not evidence of valid transport configuration. A redirect across origins loses `Authorization` and cannot execute the worker; same-origin redirects to another route/body are rejected by scheduled identity checks. Confirm the background worker cannot emit credential-bearing cURL verbose logs: `log_min_messages` must not be `debug2` through `debug5` (activation/dispatch also reject that setting in their session). Never inspect/export credential-bearing `net.http_request_queue.headers`, use `--location-trusted`, or activate to test configuration.
3. **Worker:** verify the budget below on the real target runtime. Start controlled test invocations only with explicit authorization, no cron activation. `BOOKING_WORKER_MODE=drain` services existing obligations while admission stays paused; `off` stops booking servicing; `active` is not sufficient to admit a booking. `BOOKING_LIVE_ENABLED=false` stays separate. Preserve `SAAS_STRIPE_INBOX_WORKER_ENABLED` and `SAAS_CHECKOUT_FULFILLMENT_WORKER_ENABLED`; Connect maintenance does not depend on those flags. Check `BOOKING_WORKER_ENVIRONMENT`, `SAAS_BILLING_ENVIRONMENT`, Stripe key prefix and stored tenant environment agree. Google maps `test` to Pipedream `development`, `live` to `production`.
4. **Soak:** before recurring activation, obtain separately authorized controlled worker evidence in the intended test environment: multiple token/freshness cycles, outage/recovery beyond eight retries, body-read stalls, concurrent public/cron claims, stale fences, transient SaaS failure while Connect still verifies, off/drain, and lost provider/DB responses. Measure p50/p95/p99 wall time, oldest due age, throughput, tenant count, booking load and Pipedream usage. Identify an operator and a tested independent alert destination; none is assigned by this runbook. A no-browser 24-hour unattended soak with recurring jobs needs an explicitly approved test activation after the pre-activation soak, followed by deactivation/review before live activation.
5. **Activation:** only after the earlier evidence and explicit operator/user authorization, call `set_calendar_worker_schedules_active('test', true)`. Default `p_active` is `false`; registration/activation never sends HTTP itself. Activation rejects missing/empty bearers, noncanonical origin, wrong scope, unregistered or modified owned commands, missing stock transport, or this owner's active jobs in the other environment. It cannot inspect or reject hidden foreign jobs. Changing Vault environment is **not** a switch: explicitly disable the old owned environment before registering/activating the new one, after its own review and soak. Verify subsequent dispatch IDs, authenticated worker outcomes, per-row results and booking heartbeats. Do not flip booking or SaaS live charging flags as part of this step.

## Exact Interfaces

| RPC                                                                                                                                                                 | Authority / Result                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register_calendar_worker_schedules(p_environment text)`                                                                                                            | Service only; returns `schedule_name`, `job_id`, `active=false` for four jobs; re-registration pauses them; no dispatch or configuration/origin validation                                |
| `set_calendar_worker_schedules_active(p_environment text, p_active boolean default false)`                                                                          | Service only; returns number changed (four for a registered environment); explicit separate activation/deactivation                                                                       |
| `dispatch_calendar_worker_schedule(p_environment text, p_worker text)`                                                                                              | Definer owner/cron only, not service/browser/booking-worker executable; validates config on each dispatch, returns existing ledger `request_id`, inactive returns null                    |
| `get_calendar_worker_health(p_environment text)`                                                                                                                    | Service-only read projection; never dispatches or activates                                                                                                                               |
| `claim_stripe_connect_account_refresh(p_profile_id uuid, p_environment text, p_lease_token uuid)`                                                                   | Service-only, exact saved due tenant/account, zero or one existing account row                                                                                                            |
| `claim_due_stripe_connect_accounts(p_environment text, p_lease_token uuid, p_limit integer default 25)`                                                             | Existing identity; now claims at most **one** row through the same scoped refresh authority regardless of larger limit                                                                    |
| `apply_leased_stripe_connect_account_projection(...)`                                                                                                               | Adds `p_lease_token`/`p_fencing_token` to existing account projection arguments; checks exact account, generation, live DB-time lease and fence before delegating to the existing reducer |
| `release_stripe_connect_reconciliation_claim(p_profile_id uuid, p_environment text, p_lease_token uuid, p_fencing_token bigint, p_succeeded boolean default false)` | Service-only fenced release; old `(...,p_retry_at timestamptz)` overload is removed                                                                                                       |

The complete leased projection signature is:

```sql
apply_leased_stripe_connect_account_projection(
  p_profile_id uuid, p_environment text, p_stripe_account_id text,
  p_lease_token uuid, p_fencing_token bigint, p_reconciliation_generation bigint,
  p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean,
  p_capabilities jsonb, p_requirements jsonb,
  p_provider_created_at timestamptz, p_observed_at timestamptz
) returns public.stripe_connected_accounts
```

The only calendar job names managed by these RPCs, always scoped to the definer owner, are:

| Suffix (`test` or `live` replaces `<env>`)  | Endpoint / JSON Body                              | Runtime And Vault Bearer      |
| ------------------------------------------- | ------------------------------------------------- | ----------------------------- |
| `obra-calendar-<env>-google`                | `/api/cron/pipedream-inbox`, `{}`                 | `PIPEDREAM_INBOX_CRON_SECRET` |
| `obra-calendar-<env>-stripe`                | `/api/cron/stripe-inbox`, `{}`                    | `STRIPE_INBOX_CRON_SECRET`    |
| `obra-calendar-<env>-booking-core`          | `/api/cron/booking`, `{"family":"core"}`          | `BOOKING_CRON_SECRET`         |
| `obra-calendar-<env>-booking-notifications` | `/api/cron/booking`, `{"family":"notifications"}` | `BOOKING_CRON_SECRET`         |

All use `* * * * *`. Dispatch includes `X-Obra-Worker-Environment` and `X-Obra-Cron-Schedule`; routes validate environment, canonical origin, POST method, exact path, and exact scheduled body before work. `scheduleName` and `environment` are echoed in authenticated results; the ledger does not accept a different identity as worker success. Manual bearer consumers without schedule headers remain supported, including separately enabled attachment families. No request-supplied callback origin is consumed. `CRON_SECRET` remains the shipped runtime fallback for booking only; it is not a Vault scheduling fallback. Never store a bearer, provider key, `SUPABASE_BOOKING_WORKER_KEY`, or service-role key in `VITE_*`, SQL command text, job URLs, source, or logs.

TypeScript provider APIs:

```ts
refreshSavedStripeConnectAccount({
  profileId,
  environment, // "test" | "live", resolved by the trusted caller
  deadlineAt,  // absolute epoch milliseconds
}): Promise<{ checked: boolean }>

reconcileDueStripeConnectAccounts(limit = 25, options?: {
  environment: "test" | "live";
  deadlineAt: number;
})

processStripeConnectInbox(limit = 25, options?: {
  environment: "test" | "live";
  deadlineAt: number;
})

processPipedreamCalendarInbox(limit = 25, options?: {
  environment: "test" | "live";
  deadlineAt: number;
})
```

`refreshSavedStripeConnectAccount` lives in `stripe-connect-inbox-worker.server.ts`. Public admission must first resolve the actual eligible site/profile/environment, enforce rate limiting, and reread final readiness; `checked` means a saved-account observation was settled, **not** that charges are enabled. Busy, cooled, fresh, absent or insufficient-budget rows return `checked:false`. Missing/mixed-mode credentials reject before DB/provider work. No OAuth/onboarding, account enumeration, key changes, account mutation or fallback account is performed. Both scheduled and targeted refresh use `reconcileStripeConnectAccount` and the same claims. Never call the global worker with `limit=1` from public traffic.

Stripe global results are `{reconciled, failed, claimed, deadlineExceeded}`; the Connect and Pipedream inbox results are `{processed, failed, claimed, deadlineExceeded}`. Notification batches report `{processed, claimed, accepted, failed}`. Payment and refund lanes each permit at most 25 items per invocation; their internal SQL claims remain one row at a time and stop on no work or the shared deadline/fence. Both lanes start independently alongside lifecycle recovery, so one lane cannot monopolize the other's opportunity. The notification route likewise repeatedly claims one message while budget/fence permit; it does not stop at one message per minute. Exact `failed` totals are summed only when all core lanes supply them without skipped/deadline-unknown outcomes; otherwise the total stays null. All known positive lifecycle detail counters or lane failures still cause `partial_failure` and an unsuccessful family heartbeat. Details are not double-counted on top of lane totals. Rejected lanes/deadlines fail the invocation with sanitized output. Acceptance is provider acceptance, not email delivery. Existing interactive `reconcileStripeConnectAccount` and `reconcileStripeConnectInboxEvent` accept optional `deadlineAt`; the new saved refresh always supplies it.

Google lifecycle contract: `reconcileDuePipedreamTriggers(limit=25, options?: {environment:'test'|'live'; deadlineAt:number})`; transport `withPipedreamDeadline(deadlineAt, work)`. Booking integration contract: `reconcileBookingLifecycle(environment, canContinue?, deadlineAt?)`; the continuation fence still includes lease-renewal success and the route deadline.

Google maintenance runs up to three concurrent classes, with only one just-in-time claim in each. The first default 25-item wave reserves 9 disconnect, 8 setup and 8 verification opportunities; unused shares can be lent in later settled waves. All started work is awaited under inherited deadlines and settlement reserves. Both slow setup and fast-failing cleanup have dedicated multi-cycle tests so neither consumes all wall-clock or item opportunities for healthy verification. These bounds do not establish hosted quotas or supported tenant capacity.

## Budgets And Evidence

`CALENDAR_WORKER_BUDGET_MS` defaults to 45000, clamped to 10000..45000; `CALENDAR_WORKER_SETTLEMENT_MS` defaults to 5000, clamped to 3000..5000. Neither can be configured above the 55-second HTTP caller. These are not measured Lovable runtime limits. Routes stop admitting claims before the work deadline and reserve time for DB settlement. Scope-wide claims are small and just in time; work started is awaited, not detached.

Saved Google/Stripe maintenance routes pass the existing 25-item invocation limit, not three. This is an upper bound, not a leased batch or promised throughput: SQL claims remain one row at a time, and shared deadlines/continuation fences can stop earlier. Inbox/SaaS lanes retain their independent bounds. The local virtual-clock route fixture follows 48 healthy saved accounts per provider through 46 minute-spaced invocations, with 100ms observations and ten-minute due times, without owner/public traffic. Stripe uses the actual worker with mocked DB/HTTP; Google uses the existing reconciler signature/result with mocked lane execution. Repeat verification is at most 11 minutes in this fixture, within the ten-minute due cadence plus minute-schedule granularity. Mixed Google disconnect/setup/verification results test the route handoff, not the separately owned inner fairness algorithm. The route change removes the demonstrated three-item ceiling; this bounded simulation is not a supported tenant count, hosted capacity proof, provider quota measurement, or no-browser soak. Supported volume, slow/failing mixed work, real runtime limits and sustained freshness still require separately authorized measurement.

`withWorkerDeadline(deadlineAt, work, {workDeadlineAt?, canContinue?})` is an async-local, server-only invocation context, not a global fetch monkey patch. `workerSupabaseFetch` bounds each PostgREST/Auth/Storage request to five seconds or remaining budget, buffers at most 16 MiB while the abort signal remains armed, and prevents SDK network/retry-after backoff from escaping the deadline. Only PostgREST can use the DB settlement reserve; Auth OTP and storage effects stop at the provider cutoff. `workerProviderFetch` gives Stripe, notification and scanner requests the same overall deadline; existing ten/thirty-second per-call limits can only shorten it. `getStripe()` uses a separate fetch-based SDK client with zero retries only inside the worker context; existing interactive consumers retain their prior client behavior. Continuation fences prevent further provider calls after lease loss. An interrupted write is still ambiguous at the provider, not proved failed; existing idempotency and fenced reducers retain recovery authority. OTP transport status zero is recorded as delivery unknown, never definitive rejection.

OTP status zero after an actual dispatch remains unknown. If the existing Auth fetch adapter proves no dispatch occurred, the worker instead defers through `defer_saas_checkout_fulfillment`, even after a lost begin-intent response. Migration 133 makes that same live-fenced RPC release the reserved intent and return its provider-attempt budget, retaining a one-minute cooldown. Actual sends retain the eight-attempt policy. A stopped lane settles first, then reports `WorkerDeadlineError`; cron must not label it healthy completion. Failed or lost settlement remains conservative and cannot authorize an automatic duplicate send.

Stripe saved refresh is additionally capped at 15 seconds. Each SDK retrieve has `timeout <= 8000` and `maxNetworkRetries:0`, using the installed Stripe 22.6.1 fetch transport whose timer remains armed through body reads. `redirect:'error'` prevents authorization forwarding. DB reads/claims/projections/releases use remaining-budget abort signals. A timed-out RPC can have committed: never project without the original known fence, and never treat a missing release response as success.

Migration 140's existing Stripe fields are on `stripe_connected_accounts` only: `reconciliation_last_attempt_at`, `reconciliation_attempts`, `reconciliation_safe_error`; the owner-scoped correction adds none. Claim writes attempt time/count, a 55-second lease and a one-minute interruption cooldown. The existing account projector writes `last_verified_at`, the normal ten-minute due time, and resets count/error atomically under its generation check. Webhook projection proves its inbox lease, uses the same advisory-lock -> account-lock projector, and settles the inbox in the same transaction; an expired inbox settlement rolls the account observation back. Leased maintenance also proves its current account lease. Success clears old metadata even after a failed maintenance release or a lost release response. Fenced release otherwise persists a sanitized failure and one-minute retry, slowing to ten minutes at eight attempts. No failure advances last-success evidence or changes account identity. A newer verified webhook prevents an older release from replacing successful evidence with an error. Existing table/tenant retention applies; no second connection store.

Migration 140 retains its existing cron ledger additions, `background_job_cron_requests.worker_outcome` and `worker_counts`, without further columns. The existing response-recorder's update invokes the unchanged capture trigger that accepts only enumerated `outcome` and numeric `processed`, `failed`, `reconciled`, `accepted`, `claimed`; missing counters are null, not zero. It never copies provider payloads or arbitrary rejection text. Existing 30-day ledger retention applies. `background_job_cron_health` appends those fields plus `transport_outcome`; legacy generation outcomes are preserved. Calendar HTTP 200 without a recognized result is `transport_only`, not verification success; off/partial failures are distinguishable. `completed` means the route finished but legacy workers lack exact failure counts; it is deliberately not `succeeded`. Positive reported failure counts override `completed`/`succeeded` to `partial_failure`. This capture depends on the existing shared recorder actually recording responses; its cron row may be foreign and invisible. No replacement recorder or separate monitor is installed.

## Triage

Use service authority, never expose these projections publicly:

```sql
select public.get_calendar_worker_health('test');

select schedule_name, request_id, requested_at, responded_at, status_code,
       transport_outcome, worker_outcome, worker_counts, outcome
from public.background_job_cron_health
where schedule_name in (
  'obra-calendar-test-google', 'obra-calendar-test-stripe',
  'obra-calendar-test-booking-core', 'obra-calendar-test-booking-notifications'
)
order by requested_at desc
limit 120;
```

`get_calendar_worker_health` returns `environment`, `observed_at`, `scheduler_scope` (`owner` = the definer's `current_user`, expected `postgres`; `visibility="owner_only"`), `schedules`, `overdue_connections` (oldest 100; `overdue_connections_limit=100`), `binding_failures`, `row_failures`, `overdue_obligations`, `response_recorder` (`registered`, `active`, `last_recorded_response_at`), and `independent_monitor_verified=false`. The application report exposes `schedulerScope` and `responseRecorder`. All timestamps are ISO timestamptz values or null; counts and age seconds are numeric, with age zero when the corresponding inventory is empty. No PII or provider payloads are returned.

For the legacy shared `obra-record-background-job-responses`, no owned row means `registered:null, active:null`: **registry unobserved**, not absent or inactive. An optional visible owned row yields `registered:true, active:<boolean>`; registration never creates that recorder. `last_recorded_response_at` is the shared existing ledger's `max(responded_at)` at or before `observed_at`, across all schedules/environments and including failures. The recorder copies `net._http_response.created` into `responded_at`; this is response-created time, not a collector heartbeat. A lack of retained history proves neither recorder absence nor inactivity. A fresh shared response cannot mask stale/missing calendar completions, failed outcomes, binding failures or paid obligations. The evaluator alerts on a visible owned inactive recorder; when registry state is unknown it omits `response-recorder`, neither firing nor falsely clearing a previous alarm. The admin UI must keep this coverage gap visible even when no assessed thresholds fire.

`binding_failures` is an uncapped JSON object mapping each present allowlisted reconciliation reason to its exact current-binding count (`{}` when empty). Current means matching profile/environment/connection/account/revision, not retired configuration; disabled bindings and explicit disconnect intent are excluded. Future due time and fresh account evidence do not suppress it. Degraded rows with missing/unrecognized reasons map to `unknown`, never arbitrary provider text. The evaluator emits stable `google:binding:<reason>` operator conditions, including explicit resolution from an empty aggregate even when overdue inventory is capped. Successful trigger projection clears the retained reason; an idle cron response does not. This change adds no table column or new persisted incident.

Scoped type contract: `get_calendar_worker_health({p_environment:string})` still returns `Json`, with the required scope/recorder fields above and retained `binding_failures: Partial<Record<BindingFailureReason, number>>`; the application report exposes the latter as `bindingFailures`. `BindingFailureReason` is the finite list at `calendar-observability.server.ts` (`provider_*`, calendar permission/selection and trigger failure codes, plus `unknown`). The private preflight signature is `assert_calendar_worker_cron_privileges({p_require_schedule?:boolean}) -> void`; it remains unexposed SECURITY INVOKER authority. This correction changes no table Row/Insert/Update shapes or migration 150/action-notice authority. The primary owns generated-type alignment and final verification.

Each schedule has `schedule_name`, `registered`, `active`, `command_matches`, `schedule_matches`, `last_dispatched_at`, `request_id` (latest dispatch), `last_responded_at`, `last_response_request_id`, `transport_outcome`, `worker_outcome`, `worker_counts` (latest recorded response), `last_authenticated_completed_at`, `last_authenticated_requested_at`, `last_authenticated_worker_outcome` (latest identity-matched worker response), `oldest_unanswered_at`, `overdue_unanswered_count`, and existing family `last_started_at`, `last_completed_at`, `last_success`. Registration/activity describe only this owner's exact job; a missing owned schedule is not a claim of global absence. Ledger correlation remains by schedule identity, not a new owner registry, so the deployment constraint is essential. A new pending dispatch does not replace the previous recorded response or its off/failure outcome. An unanswered request at least three minutes old after the most recent authenticated request gives `missing_response`; a subsequent authenticated invocation clears that historical gap. No authenticated completion for three minutes gives `missed_authenticated_completion`, even if generic HTTP 200s continue. Inactive/drifted/missing schedules retain their explicit statuses. `missed_dispatch`, `missed_worker_start`, `off`, `worker_failed`, and the existing response outcomes remain distinct. Authentication is not successful verification or delivery.

`overdue_obligations.calendar` contains `count`, `oldestPendingAt`, `oldestPendingAgeSeconds`, `blockedCount`, `manualRepairCount`, `unresolvedDestinationCount`, `retryCount`, `expiredLeaseCount`, `oldestExpiredLeaseAt`, `oldestExpiredLeaseAgeSeconds`. It counts paid/disputed appointments with unresolved create/cancel delivery or unresolved destinations, not pre-Checkout destination bindings or already-successful drift scans. Create age begins at confirmation (creation fallback); cancellation age begins at cancellation request/completion (creation fallback). Retry timestamps never reset obligation age.

`overdue_obligations.notifications` contains `count`, `oldestPendingAt`, `oldestPendingAgeSeconds`, `retryCount`, `failedCount`, `deliveryDelayedCount`, `expiredLeaseCount`, `oldestExpiredLeaseAt`, `oldestExpiredLeaseAgeSeconds`, `reviewCount`, `oldestReviewAt`. Pending inventory is exactly `pending`/`processing`/`retry`; provider-accepted or delayed email is not unsent work. Review counts use unresolved `booking_notification_delivery_review_v3` rows. `row_failures.notifications` also uses the real `retry` state, not the calendar link's `retry_wait`.

Overdue connections expose provider/profile/environment, last-success evidence, due/lease times, `overdue_seconds`, `expired_lease_seconds`, attempts, `reason`, `has_error`, `severity`, and `freshness_expired`. `row_failures` includes inbox dead letters and reflects durable failure state, not "failures in this HTTP request." These projections feed the existing monitor/admin integration; no parallel monitor route or incident store is introduced.

| Signal                                                                        | Proposed Initial Threshold                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Expected owned minute schedule missing/inactive/drifted, or no dispatch/start | Immediate schedule alarm; dispatch/start alarm after three minutes, even without due rows        |
| Verification overdue                                                          | Warn at two minutes overdue; critical when successful evidence reaches 15 minutes                |
| Expired lease still runnable                                                  | Two scheduling cycles after lease expiry                                                         |
| Paid calendar obligation unresolved                                           | Warn after two minutes, critical after five; immediate escalation for conflict/permanent blocker |
| Notification ready but unprocessed                                            | Warn after two minutes; use existing delivery review for failures/bounces                        |

A 200, an accepted email, or a webhook receipt does not prove completed permission verification, correct booking event contents, or invitation inbox delivery. Failure counters absent from legacy workers stay null. Inspect row outcomes and next retry before declaring recovery; a degraded trigger's incoming webhook is not independent successful verification.

**Independent monitoring:** calendar evaluation, admin inspection and contractor action-required delivery use the existing generation-monitor entry point; see [calendar-observability.md](calendar-observability.md). Migration `20260910150000_calendar_action_notifications.sql` remains unchanged and unattempted; apply it only after corrected 140 through the sequence above, without replaying 120/130/133, and configure its opt-ins only after approval. `pg_cron` cannot detect its own complete outage, so the independently hosted caller, real operator/destination and actual delivery still require deployment acceptance. Code-level integration is not evidence that those operational services are configured.

To pause, call `set_calendar_worker_schedules_active('<exact environment>', false)` with service authority; missing/mismatched Vault configuration must not block deactivation. Keep booking drain available for paid obligations when safe, preserve retry/lease state, and never manually clear fences, switch provider accounts, or rewrite financial truth. Already-dispatched provider requests remain potentially ambiguous; deactivation is not cancellation of those effects.

## Code-Only Verification

The commands below are local code-only verification references, not results for the ongoing integrated PR checks. Future user-run E2E commands and acceptance boundaries are separated in [the plan](../../plan/pipedream_cron.md#existing-test-seams). Browser/visual/E2E, real-provider delivery and deployed scheduling/soak acceptance are not performed or authorized by this documentation update.

```sh
node scripts/test-stripe-connect-refresh.mjs
node scripts/test-stripe-connect-environment.mjs
node scripts/test-calendar-worker-inbox.mjs
node scripts/test-calendar-cron-routes.mjs
node scripts/test-calendar-worker-sql.mjs
pnpm test:unit:calendar-transports
```

The primary must update `test-calendar-worker-sql.mjs` and the shared disposable harness to own their inert native-grant fixtures, with separate non-superuser migration and extension owners and stock-equivalent cron ACLs/owner RLS. They must not extract a policy-bootstrap block from this runbook or depend on cross-owner visibility. Required cases include missing native grants, denied self-elevation/raw writes, rollback, inactive/idempotent registration, untouched hidden foreign exact-name/other-environment jobs, optional owned versus unobserved recorder, and shared response evidence that cannot clear per-calendar failures. Retain actual Stripe/migration-runner functions, notification/obligation/binding checks, concurrency, route deadlines and outcome aggregation. Full-chain replay, managed-safeupdate, monitor/evaluator and unchanged definition-body checks remain the primary's responsibility. Implementation/tests/review are ongoing; earlier policy-based suite results are historical, not acceptance of the new contract.

`supabase/tests/calendar-worker-schedules.sql` is also for the primary disposable PostgreSQL harness after the migration. It deliberately refuses real `pg_net`/`pg_cron` extensions and uses inert stub functions. Required harness interfaces are existing schema plus `cron.job(jobid,jobname,command,schedule,active,username)`, named `cron.schedule` upsert, `cron.alter_job(job_id, active := ...)`, inert `net._http_response`, and writable fake `vault.decrypted_secrets`. Begin the isolated suite without owned calendar jobs or `net.http_post`; require a missing-transport negative control before installing an inert **stock five-argument** stub and testing authorized activation. Do not run this suite on a hosted database. Real libcurl behavior is tested independently on loopback by `test-calendar-cron-redirects.mjs`; no hosted calls are made.

Required SQL coverage retains native-grant-checked installation without job registration/activation/dispatch, separate inactive registration, permissions, activation/dispatch configuration checks (absent config, empty bearer, missing/stock transport and origin rejection), exact owned activation, no automatic owned-environment switch, unchanged unrelated schedules, response classification, scoped Stripe cooldown, stale/expired fence rejection and rollback. The existing real-SDK/route transport contracts and original worker fences remain unchanged: stalled headers/bodies, PostgREST retry-after, deadline isolation, settlement reserve, family claims, financial/SaaS/OTP/notification/scanner/storage work and no late calls after response. The primary must record final commands and results rather than treating this coverage list as a pass. Neither local tests nor the SQL suite establish hosted scheduling, sustained throughput, no-browser durability, Google delivery, or production readiness.
