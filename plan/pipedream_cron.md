# Pipedream Lifetime Connection

## Current Status Addendum

2026-09-13: a new owner-scoped scheduler PR is in progress in `obra-calendar-owner-scoped`, based on reported HEAD `206674d`. Full implementation, tests and review are **ongoing**; the primary owns source, Git, tests, journal and the final evidence record. This docs-only update performs no deployment and claims no new test pass or all-clear. The known paid-expiry/no-new-webhook P2 remains open and outside this correction.

**Reported deployed state, not re-queried here:** migrations 120, 130 and 133 are **already applied and immutable**. Migration 140 failed and rolled back; the old policy-bootstrap attempt also rolled back. Migration 150 was never attempted. Edit/replace only unapplied 140 in the new PR, with the same filename and a **new checksum**, then resume with unchanged 150. Do not edit/reapply 120/130/133; an unexpected applied ledger entry means stop. Each remaining migration still needs explicit post-merge authorization, published allowlist/checksum verification, successful exact-checksum dry run and apply. Per the primary/user report, `206674d` (titled `Applied bootstrap`) changes only a type file, not evidence of deployed SQL/grants.

The agreed correction keeps `pg_cron`, `pg_net` and the existing ledger: native owner-only jobs, no protected-cron policy, queue, application job registry, new table or additional columns. Preserve existing Stripe/capture definition bodies, original worker/configuration/transport fences and all migration 150 business logic. [The worker runbook](../docs/runbooks/pipedream-calendar.md) records native-grant preflight, the no-hidden-bearer-job deployment constraint and recorder uncertainty. The integration/test findings below remain historical, not current deployment or verification claims.

## Historical Integration Status

Latest integration (2026-09-13): main `530f3e5` through PR #146 is merged with six intent-preserving conflict resolutions. Code-only types, full booking suites, retirement/source checks, build, managed-safeupdate replay and monitor integration pass. The historical paid-expiry no-new-webhook discovery P2 remains open; this merge is not its correction.

Post-push sanity review at `3778ef0` identified one remaining P2: shipped elapsed paid-expiry orphans lack autonomous discovery unless another webhook arrives. See [the review record](pipedream_cron_pr141_review.md#post-push-sanity-check). Current GitHub Actions has six successful jobs and one intentionally skipped browser job, not a 16/17 result. Earlier implemented-fix closure below does not close this no-new-event recovery gap.

Latest implementation status: the seven source findings, CI fixture and verified pre-commit follow-ups in [PR 141 holistic review](pipedream_cron_pr141_review.md) are corrected and independently re-reviewed locally. Combined code-only tests passed before commit preparation. Linux CI confirmation follows the push; hosted deployment/activation and user acceptance remain separate. The historical records below retain their original scope.

Latest main integration: `e9fcdf8` (PR #143), following reviewed fix commit `1959d14`. The non-rewriting merge preserves template media/review/identity changes and the existing supported booking callbacks. Targeted independent integration review and app/fixture types, template parity, identity/research and public-booking checks passed.

Status (2026-09-12): Full Pipedream/cron change integrated with `origin/main` through `8354719` (PR #140) for review. Full verification passed on the #139 integration; application types, template parity and public-booking suites passed again after the clean #140 merge. Independent review of the #139 integration found no material issue in its scope. No deployed migration/provider/cron operations have occurred for this change, and raising the PR does not authorize them.

Original plan: 2026-09-10. Working agreement: [`cursor.md`](../cursor.md).

Historical source baseline: application snapshot `237a100` (merged PR #134), followed by local `origin/main` at `c32ec28` without changes to the inspected lifecycle application files. Implementation subsequently began from `7c1eb41`. Baseline observations below are retained as design rationale, not current open findings or claims about the installed production schema or today's provider accounts.

## Historical PR Preparation

All R1-R21 source fixes were implemented and tested locally before main integration. V1 was withdrawn: first-load failure remains an explicit error with Retry, and failed refreshes retain prior forms rather than inventing an entitlement downgrade, preserving R16. V2's Stripe shared fence and V3's schedule-read retry are fixed, with dedicated code-only regressions added during integration. See [pipedream_cron_recheck.md](pipedream_cron_recheck.md) for historical closure and final integration evidence. Local verification is not hosted release acceptance.

The historical holistic review covered combined code and unchanged shared consumers, not just the prior 24-item closure matrix. It reproduced pending-reader ACL failure, pending-choice loss through OAuth, off-mode payable continuation, provider-result loss after cancellation/deadline, retained financial credential-recovery gaps, worker-budget/throughput problems, and UI/observability bystander failures. Those pre-correction findings are retained in the review records, not presented as current open source issues. No application behavior was changed during that review.

The holistic review rejected the initial implementation. Subsequent corrections cover the recorded findings, including alert delivery and supported-template booking callbacks. The audit-of-audit then caught conflated private-probe INSERT and attendee CREATE evidence. That leftover is now separated on the existing connection: real SQL proves private recovery restores admission without a booking or manual reset, while an independent attendee denial survives. One independent post-implementation vet found no material issue in this specific correction.

Original implementation worktree: `/var/folders/1r/hvylr3cn7zs6bng006f512380000gn/T/opencode/obra-pipedream-lifetime`, on `fix/pipedream-lifetime-connection`. Original source implementation was isolated from the shared checkout and parallel template work. The main-integration contract preserves #136 lookup state, #137 auth helper, #138 Step 1 CTA, #139 shared renderer/scroll/overlay behavior, and the intervening admission migration. The full change includes generated Supabase types alongside lifecycle, provider deadlines, saved-config refresh, trigger/disconnect recovery, pre-Checkout destinations, paid-event recovery, truthful purchaser status, and inactive scheduling/health inspection.

Earlier pre-integration code-level validation passed: provider/worker/public-booking/receipt and authorization suites, full regular and managed-safeupdate PostgreSQL replay covering five new migrations, SQL concurrency/ACL tests, local notification/monitor integration, schema/type checks, focused lint/static checks, and production build. These are historical results, not a pass for the `ceeb2ea` integration. Tests use disposable databases, inert scheduling fixtures and mocked provider boundaries, not production accounts. Per the user's direction, no additional browser, visual or end-to-end tests were run; the user will perform end-to-end validation later. The primary will record final integrated commands/outcomes and actual PR/commit metadata when available.

Original migration order: `20260910120000_google_calendar_lifetime.sql`, `20260910130000_booking_calendar_lifetime.sql`, `20260910133000_booking_notification_lifetime.sql`, `20260910140000_calendar_worker_schedules.sql`, `20260910150000_calendar_action_notifications.sql`. At this historical PR-preparation checkpoint none was applied to a deployed database. The old privilege/visibility-bootstrap design is superseded by the current addendum and [runbook](../docs/runbooks/pipedream-calendar.md); installation still does not register, activate or dispatch jobs. The canonical target remains `https://obratech.co`, not its redirecting Lovable alias.

The five Sep 10 filenames remain unchanged; they do not conflict with upstream's unrelated Sep 11 `claim_agent_turn` migration. Normal and managed-safeupdate PostgreSQL 15.19 replay preapplied that upstream migration before the five lifetime migrations and checked its definition, owner, ACL and effective grants after every checkpoint and sorted reapplication. All remained unchanged. This is local compatibility evidence, not a hosted migration-history assertion or authorization to reapply deployed migrations.

Current remaining release work: new owner-scoped PR implementation/tests/review, merge and explicit migration authorization for corrected 140 then unchanged 150, native owner-grant verification and separately authorized inactive registration, approved rollout, required Pipedream production capability, schedule/monitor/notice configuration and activation, independent caller/operator destinations, and user-run real-provider/end-to-end/capacity/no-owner-traffic acceptance. The lifecycle implementation does not remove Pipedream's separate production-plan denial or change the Connect architecture. Booking wiring remains limited to supported painter11/plumber through the mold registry, preserving upstream designs and shared renderer/scroll/overlay behavior; no wider template booking support is claimed. Ambiguous provider outcomes lacking attributable evidence remain visible and fail closed rather than being blindly replayed.

## Product Contract

A contractor connects Google and chooses calendars once. While that authorization remains valid and the integration is enabled, calendar maintenance and booking delivery run without the contractor keeping a browser open, logging in, or periodically repeating OAuth.

- Logout, refresh, inactivity, ordinary access-token expiry, and server restarts must not require reconnect.
- Temporary provider, network, or scheduling failures recover in the background without losing saved selections or already-paid booking obligations.
- A customer can book only when current permissions, availability, payment readiness, entitlement, and internal capacity checks permit it.
- An accepted payment and unfinished calendar delivery remain separate, durable facts. Failures must be visible and recoverable, not silently discarded.
- Explicit disconnect is respected as an authorization intent. Recovery must never reconnect or select another retained account to bypass it.
- Revocation, removed calendar access, provider-required renewed consent, and outages remain possible. No implementation can promise uninterrupted access against those conditions.

"Lifetime connection" means durable, unattended authorization management and recovery. It does not mean an immortal browser session, a never-expiring access token, or guaranteed invitation-email receipt.

## Root Cause

The architectural mismatch is between a durable saved integration and a short-lived readiness snapshot whose maintenance and recovery are incomplete. The UI then presents all non-ready states as an OAuth problem. Cron installation alone cannot close this lifecycle.

| Observed behavior                                                                                 | Why it matters                                                                                            | Required correction                                                                                                 |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Google readiness expires after 15 minutes; verification is due again after 10 minutes.            | An unchanged saved account becomes non-ready without successful background verification.                  | Maintain evidence without user traffic; separate evidence freshness from authorization lifetime.                    |
| `StepTwoCard` maps a saved email plus `!calendarReady` to "Needs reconnect".                      | Stale evidence and monitoring trouble cause unnecessary OAuth.                                            | Thread existing reasons to consumers and offer the correct remedy.                                                  |
| Health-failure SQL increments `connection_revision`, invoking configuration invalidation.         | The worker can lose its fence, then delete the trigger as if the contractor changed calendars.            | Separate health observations from material configuration changes.                                                   |
| Claims exclude missing deployments; reconciliation mostly observes rather than repairs.           | Deleted, inactive, incomplete, or unfinished deployments can remain broken.                               | Make authorized saved configurations discoverable by the existing deployment/repair path.                           |
| Trigger retries stop scheduling after eight failures.                                             | A temporary outage can become a permanent operational failure.                                            | Retain low-rate recovery and escalation after fast retries.                                                         |
| Webhook key resolution requires active health although ingestion accepts degraded bindings.       | A transient failure can reject valid signed events.                                                       | Separate current webhook trust from operational health.                                                             |
| Public rendering and slot lookup reject readiness before provider checks.                         | A refresh added after those gates is unreachable for some customers.                                      | Refresh eligible stale evidence before the final gate, with bounded server authority.                               |
| Calendar destination is first selected during payment settlement, from current active selections. | Disconnect can roll back paid-state projection; reselection can change a checkout's intended destination. | Bind the admitted destination before external checkout and settle payment independently of present calendar access. |
| Calendar delivery treats remaining provider 401/403 responses as terminal regardless of reason.   | Platform authorization trouble can strand paid appointments.                                              | Classify the failing boundary and preserve recoverable dependency failures.                                         |
| Event ID and private appointment marker alone establish observed presence.                        | Wrong times, missing attendees, or cancelled events can look converged.                                   | Verify intended event contents and report unresolved delivery honestly.                                             |

The repository has scheduling infrastructure, but installed schedules, recent runs, current account state, and hosted runtime quotas have not been verified. Do not infer that cron is absent or Google revoked access.

## Existing Authority

Keep these as the sources of truth. Do not add a second connection store, credential vault, workflow platform, or booking queue.

| Concern                           | Existing source                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider identity and health      | `calendar_connections`: profile/environment, account, configuration revision, health, verification/reconnect reasons and timestamps                 |
| Desired calendars                 | `calendar_selections`: full blocking set, one writable destination, roles and permission timestamps                                                 |
| Trigger ownership and maintenance | `pipedream_bindings`: configuration, provider identities, signing-key reference, due time, attempts, deployment/reconciliation leases and fences    |
| Disconnect intent                 | `booking_provider_account_disconnects_v3`: account, actor, requested/completed state and timestamps                                                 |
| Incoming provider evidence        | `provider_event_inbox` and existing Pipedream/Stripe ingress and processing functions                                                               |
| Admission and capacity            | Entitlement, cutover controls, readiness projections, `booking_availability_cache`, `reserve_live_booking`, and transactional reservation exclusion |
| Existing booking destination      | Immutable `calendar_destination_epochs` and `calendar_event_links`                                                                                  |
| Calendar side effects             | Calendar claims, effect intents, observations, retry state and audited repair authority                                                             |
| Booking emails                    | `booking_notifications`, projection repair, provider acceptance and delivery-review records                                                         |
| Scheduler delivery                | `background_job_cron_requests`, `background_job_cron_health`, booking worker-family lease/heartbeat records                                         |

Pipedream owns the contractor's Google OAuth credentials and refresh. Our server separately renews its Pipedream machine access token. The 900-second browser Connect token only starts an interactive flow; neither cron nor paid booking execution should depend on it.

## Lifecycle Semantics

These are interpretations of existing facts, not another persisted state machine.

| Condition                                            | Contractor experience                         | Server responsibility                                      | New bookings                                      |
| ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| No saved account or selections                       | Connect Google / choose calendars             | Wait for authorized setup; do not choose unattended        | Not allowed                                       |
| Saved authorization and current healthy evidence     | Connected                                     | Continue maintenance                                       | Allowed through the full admission gate           |
| Verification overdue, no proven revocation           | Connected; checking connection                | Refresh saved configuration evidence without OAuth         | Only after required evidence is current           |
| Temporary network/provider failure                   | Connected; temporarily unavailable / retrying | Preserve identity and selections; retry and alert by age   | Fail closed when required evidence is unavailable |
| Broken trigger/webhook, account authorized           | Connected; monitoring is being repaired       | Repair deployment, not Google login                        | Restricted until trigger requirements pass        |
| Selected calendar missing or inaccessible            | Calendar access needs attention               | Identify the permission; restore access or owner reselects | Restricted                                        |
| Confirmed invalid/revoked Google grant               | Reconnect Google                              | Request reauthorization; retain obligations                | Restricted                                        |
| Pipedream client/project/scope configuration failure | Service issue, not repeated OAuth             | Operator repairs platform configuration                    | Restricted where required checks cannot run       |
| Explicit disconnect pending/completed                | Disconnected / finishing disconnect           | Resume that exact disconnect; never resurrect it           | Not allowed through that account                  |

Configuration completion and present booking readiness are different. A saved availability form does not become unconfigured during a provider incident. Showing the saved account must not imply permission to charge a customer.

Timestamp semantics must be explicit: `last_verified_at` currently also changes on some failures, and webhook receipt changes `last_health_at`. Preserve last-success evidence instead of presenting either value unconditionally as a successful independent check. Use `last_event_at` for event receipt and existing attempt/due fields for retry state. Add a field only when a required consumer cannot derive its fact from an existing authoritative record.

## Implementation Sequence

Implement one coherent lifecycle change in reviewable steps. A truthful badge can land independently, but is not acceptance of lifetime connectivity. Do not enable autonomous repair before its authority and recovery tests pass.

### 1. Lifecycle Authority

**What:** Make saved configuration, health observations, disconnect intent, and execution ownership agree.

**Why:** Running today's worker more frequently can amplify health-to-configuration invalidation and race with deliberate disconnects.

**How:**

- Restrict material `connection_revision` changes to real account/selection/configuration changes. Health refresh must not masquerade as contractor reconfiguration.
- Preserve invalidation for real changes. Permission loss invalidates unsafe availability evidence and restricts admission without silently replacing desired calendars.
- Use consistent connection-then-binding locking across reservation, verification, projection, invalidation, and disconnect. Preserve database-time leases, revisions, and fencing.
- Preserve the exact saved account, complete blocking set, and separate destination on unattended paths. Never use `completeGoogleCalendarConnection` as a general refresher: it can select accounts and replace selections/deployments.
- Treat pending disconnect as authority to stop new work against that account. Resume deletion and DB/audit settlement from the existing disconnect record after interruption, including after the connection was cleared.
- Bind disconnect reservation to the intended identity/revision and fence repair. Superseding a disconnect requires an explicit owner-authorized, auditable reauthorization; background code cannot infer it from an email match.
- Record disconnect dispatch/ambiguity on the same durable intent. An undispatched deletion may be fenced and superseded explicitly; once DELETE was dispatched or its outcome is unknown, do not reuse that provider identity until deletion resolves. Database revision checks cannot prevent a late provider DELETE from removing freshly reauthorized credentials. Permit a genuinely different owner-authorized account without redirecting old-identity cleanup to it.
- Preserve owner, impersonation, active-Pro mutation, and shared-provider disconnect checks. Servicing paid obligations must not require another purchase or browser login.
- Preserve historical destination epochs. Older authorized accounts may serve existing bookings while another account serves new ones; do not move historical events automatically.
- Retention is not permission to bypass revoked access. Stop use after explicit revocation and surface unresolved obligations for recovery.

Primary seams: `google-calendar-state.server.ts`, `booking-provider.functions.ts`, `provider-authorization.server.ts`, and effective Google/trigger/disconnect SQL functions.

### 2. Bounded Verification

**What:** Share saved-configuration verification between scheduled maintenance and eligible request-time checks.

**Why:** The browser does not own freshness; separate implementations would diverge in permissions, timestamps, and retries.

**How:**

- Keep `loadBookingReadinessFacts` a fact reader. Extract only the actual verifier needed by these concrete consumers, not a generic orchestration framework.
- Resolve identities from trusted stored tenant/environment/configuration state. Claim that specific tenant and revision; a public request must never invoke the global due-worker with `limit=1`.
- Verify account health independently of trigger health. Use an exact scoped lookup or complete validated pagination; incomplete/malformed inventory is unknown, not proof of deletion.
- Verify required OAuth scopes, current roles for selected calendars, and FreeBusy access to the complete blocking set. Use exact lookups or complete documented pagination before concluding a selection is missing. Do not introduce broader scopes without a required operation.
- Use read-only permission/availability observations for recurring verification. Do not insert/delete a calendar event every ten minutes indefinitely to renew a timestamp. Scopes, current roles, and successful provider reads establish operational permission evidence; actual booking writes remain independently reconciled.
- Feed confirmed account/destination write-capability failures from booking execution into the same scoped readiness evidence. Successful scopes/roles/FreeBusy reads must not clear a newer known write blocker. Do not promote an event-specific validation or identity conflict into a blanket account failure.
- Clear a known write blocker only with cause-appropriate success for that same account/calendar/configuration, or verified explicit reconfiguration. Reuse a bounded worker-owned capability probe only when resolving a known generic write blocker; an attendee-free probe does not prove a denied attendee/invitation operation is allowed. Eligible existing booking retries can provide equivalent write evidence. Public refresh is always read-only and cannot clear an unsupported write claim.
- Retain setup/reconfiguration and necessary targeted recovery write tests as distinct capability tests. Give each private, attendee-free temporary event a stable operation identity and recoverable cleanup on the existing setup/deployment authority. Lost INSERT responses or interrupted DELETEs must not accumulate orphan probes or be reported as completed cleanup. No periodic probe without a specific capability question.
- Preserve the verified `connect:*` machine-token requirement and narrower browser Connect scopes. Do not undo earlier contract fixes or broaden permissions as a retry strategy.
- Bound the complete operation: token acquisition, retries, backoff, response-body reads, DB settlement, and permitted provider effects. Per-fetch timeouts alone are insufficient.
- Stop starting work before deadline and reserve settlement time. Lease loss or an indeterminate claim response forbids further mutations. A timeout does not prove an already-sent provider write failed.
- Settle verification before fetching/storing slot evidence, because selection/verification updates can change `availability_generation`.

**Failure classification:** reuse sanitized operation, provider boundary, HTTP status and documented machine reasons. Do not parse arbitrary provider prose or log credentials/customer payloads.

| Evidence                                                        | Handling                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Ordinary machine-token expiry                                   | Renew with client credentials; retain bounded one-time 401 refresh                      |
| Timeout, network failure, 408, rate limit, retryable 5xx        | Backoff with jitter and documented retry guidance; retain authorization and obligations |
| Pipedream client/project/API-scope configuration failure        | Operator recovery; slow retries, not contractor OAuth or hot loops                      |
| Confirmed Google grant revocation for the exact account         | Contractor reauthorization; preserve identity and obligations                           |
| Selected-calendar permission denial                             | Restore access or owner reselection; no automatic alternative calendar                  |
| Unknown 401/403 or incomplete response                          | Restrict unsafe work and obtain scoped evidence; not automatic permanent revocation     |
| Trigger/webhook missing or incompatible                         | Repair monitoring for the saved configuration                                           |
| Event identity/content conflict or invalid stored configuration | Audited repair; no blind overwrite or indefinite automatic replay                       |

Do not infer the failing OAuth layer from `invalid_grant`, 401, or 403 alone. Platform authorization and the contractor's Google grant have different remedies.

### 3. Trigger Recovery

**What:** Close saved-configuration-to-working-monitoring recovery through existing deployment reservations and provider adapters.

**Why:** Current claims and reconciliation do not recover every state setup, crashes, and provider changes can leave behind.

**How:**

1. Discover due authorized configurations, including missing bindings/deployed IDs, expired deployments, and exhausted retries. Exclude disconnect intent and incomplete owner configuration. Use existing rows, not a repair queue.
2. Acquire configuration-scoped ownership. Recover expired operations, including stale `deployment_operation_id`, through that same authority; lease expiry must not leave projection permanently blocked.
3. Verify account/calendar capabilities without requiring an active trigger. Stop at the correct permission or reauthorization state when necessary.
4. Compare observed trigger/component version, exact account, complete blocking set, `newOnly:false`, webhook identity/destination, and signing-key availability against the desired contract.
5. Reuse matching deployments; repair webhook configuration; repair or replace missing, inactive, or incompatible deployments through the existing bootstrap, not the account-selection handler.
6. Resolve ambiguous deployment results by scoped provider discovery before another create. Never interpret an inventory failure as an empty list.
7. Settle only under the original current claim/revision. Never write an observed wrong component key back as the desired key or claim an unverified deployed version.
8. Retire obsolete identities before deletion under the same ownership rules, preventing concurrent adoption. A post-DELETE fence check cannot undo deletion of a reused resource.
9. Persist the next due time. Success returns to normal cadence; temporary failure remains scheduled after fast retries exhaust, with escalation rather than a null due date.

Do not delete Pipedream accounts as routine trigger cleanup. Account deletion remains explicitly authorized, not inferred from a retired epoch or stale readiness.

**Webhook continuity:** resolve signing keys for exact current authorized bindings even during temporary health degradation. Preserve environment/account/trigger/correlation checks, raw-body signature verification, replay protection, and idempotent intake. Reject disconnected and superseded identities. Event receipt does not itself restore permission verification or prove scheduler health.

### 4. Lovable Scheduling

**What:** Install reproducible, secret-protected recurring jobs within measured runtime capacity.

**Why:** An HTTP handler and a due timestamp do not schedule execution. Functions need not remain running between invocations; durable rows own unfinished work.

Use Lovable's existing Cloud/database scheduling capability with the repository's `pg_cron`/`pg_net`, Vault-backed HTTP pattern and existing `background_job_cron_requests` ledger. No queue, application job registry, new table, permanent server or second scheduler is added for this correction.

The expected migration-runner/scheduler definer is `postgres`, with LOGIN, cron schema USAGE, `cron.job` SELECT and native `cron.schedule(text,text,text)` / `cron.alter_job(bigint,text,text,text,text,boolean)` EXECUTE. Use existing owner RLS plus explicit `username = current_user` filters. Do not add policies on protected cron objects, BYPASSRLS, raw writes or self-elevation. Read-only grant/function-ACL/net/Vault metadata checks expose no secret values and need no platform-privileged setup; missing grants mean stop and ask the existing native grant authority. Those checks do not prove scheduling ability, which requires separately authorized inactive registration.

**Deployment constraint:** only these owned jobs are trusted for calendar scheduling, with no separately configured hidden HTTP bearer jobs invoking these workers. Cross-owner uniqueness is neither observable nor guaranteed; hidden foreign exact-name/other-environment jobs remain untouched. Neither an application registry, an owner-only catalog nor shared ledger history proves their absence. Do not widen privileges to manufacture that claim.

| Work                                                                        | Existing endpoint                                      | Initial schedule proposal                                  | Bearer secret                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------- |
| Google inbox and connection/trigger maintenance                             | `POST /api/cron/pipedream-inbox`                       | Every minute; healthy bindings remain due after 10 minutes | `PIPEDREAM_INBOX_CRON_SECRET` |
| Stripe Connect inbox and verification                                       | `POST /api/cron/stripe-inbox`                          | Every minute; verification follows account due times       | `STRIPE_INBOX_CRON_SECRET`    |
| Booking payments, calendar convergence, cancellations, refunds and recovery | `POST /api/cron/booking`, `{"family":"core"}`          | Every minute                                               | `BOOKING_CRON_SECRET`         |
| Booking email projection and delivery                                       | `POST /api/cron/booking`, `{"family":"notifications"}` | Every minute                                               | `BOOKING_CRON_SECRET`         |

These are proposed cadences, not installed jobs or service guarantees. Preserve separate attachment schedules when that existing capability is enabled; do not expand this scope into attachment redesign.

- Keep Google verification, Stripe account maintenance, booking payment intake, and notifications independently recoverable. A rejected SaaS inbox task must not skip Stripe verification, as the original baseline's sequential route could do.
- Retain booking worker families, the restricted `booking_worker` role, and scoped RPC allowlists. Provider-maintenance service access is not a reason to grant workers raw tables or broader financial authority.
- Use `BOOKING_WORKER_MODE=drain` to service existing obligations while admission is paused; `off` stops servicing. `active` and `BOOKING_LIVE_ENABLED` allow admission only with all existing entitlement/cutover/provider checks.
- Validate `BOOKING_WORKER_ENVIRONMENT`, `SAAS_BILLING_ENVIRONMENT`, Stripe key mode, stored tenant environment, and Pipedream development/production mapping. Never convert test rows to live or fall back across environments.
- At the original baseline, Pipedream claims spanned environments. Preserve explicit deployment/environment scope and its tests; do not infer provider identity from email.
- Preserve `SAAS_STRIPE_INBOX_WORKER_ENABLED` and `SAAS_CHECKOUT_FULFILLMENT_WORKER_ENABLED`. These do not control Connect verification or booking payment processing. Scheduling must not silently enable charging or unrelated fulfillment.
- Provision secrets through approved stores. The scheduler's Vault value must match the receiving runtime. `SUPABASE_BOOKING_WORKER_KEY` and provider secrets remain server-only, never in public `VITE_*` variables, job URLs, source, or logs.
- Validate configuration, canonical HTTPS origin and exact endpoint at activation and on every dispatch, not registration. Do not forward bearer secrets through arbitrary redirects or trust request-supplied callback origins. Missing secrets fail closed rather than dispatching an empty bearer.
- Register the four owner/environment-scoped jobs idempotently and inactive; re-registration pauses those same owned jobs. Activation rejects this owner's active other-environment jobs, not hidden foreign schedules. Change only this plan's exact owned job identities, not unrelated generation/attachment schedules or the legacy shared recorder. Reuse request/response correlation and retention in the existing cron ledger; keep configuration, credential, transport and original worker fences unchanged.

**Runtime budget:** the original baseline reconciler claimed 25 bindings sequentially, with several provider calls each and no invocation-wide deadline. Preserve the bounded-worker correction; do not restore that assumption.

- Start with small just-in-time claims and bounded concurrency; do not lease work that cannot fit the invocation.
- Budget below verified hosting and HTTP-caller limits, reserving settlement time. Existing 55-second HTTP timeouts and leases are not evidence of Lovable's actual runtime limit.
- If setup/repair cannot fit, persist progress on the existing deployment operation and resume its identity. Do not rely on detached promises, `setInterval`, or execution after the response.
- Propagate deadlines to all subworkers and response-body reads. One hung provider or inbox must not consume all verification capacity.
- Load-test supported tenant and booking volumes. All due checks must fit the 10-to-15-minute freshness margin; core and notification throughput must also meet the intended booking rate.
- Use due order, leases, and per-tenant backoff to avoid starvation. Increase measured capacity before inventing sharding or another platform.
- Record and budget Lovable runtime and Pipedream API/trigger usage. Every-minute scheduling is not every-minute verification of every contractor.

### 5. Booking Admission

**What:** Refresh eligible stale evidence without creating a weaker gate or allowing public traffic to provision integrations.

**Why:** Delayed maintenance should not require a contractor login, but anonymous requests must remain bounded and tenant-scoped.

**How:**

1. Resolve the real live website, owner, environment, entitlement, viewed version and deployment/cutover eligibility before any refresh. `/lp/$websiteId` currently hides booking before slot lookup can run.
2. If only refreshable evidence is stale, acquire the shared tenant/configuration claim and perform bounded read-only verification. Use per-tenant positive/negative cooldown, cross-request deduplication, early public rate limiting and an overall deadline.
3. Public verification cannot start OAuth, select accounts, replace calendars, create/delete probes, deploy/delete triggers, grant entitlement, enable cutover, or change payments. Repair needs remain on existing durable due work, not unrestricted provisioning inside a public request.
4. If another verifier owns the claim or the budget expires, return temporary unavailability with a bounded retry path and keep maintenance scheduled. Reread final facts after successful verification.
5. Apply the same pre-gate behavior to public projection, `loadLiveBookingSettings`, slot lookup, and new checkout. Avoid duplicate checks when checkout loads settings and slots. Drafts/previews and structurally ineligible sites must not generate provider traffic.
6. Separate existing-checkout replay/recovery from new admission. Validate capability, request hash and existing operation identity before rejecting replay for present provider staleness. Preserve confirmation and replay authorization.
7. Settle verification, acquire authoritative slot evidence, then reserve in SQL. Bind the admitted immutable destination epoch to the existing appointment/reservation before creating external Checkout; this binding alone must not schedule a calendar event or invitation. Preserve short FreeBusy caching, generation/calendar-set/revision matching, buffer coverage, rate limits, consent, idempotency, and exclusion constraints.
8. Align SQL as well as TypeScript. `reserve_live_booking` checks Google/trigger/Stripe freshness but not selection-permission freshness; `activate_pro_booking_admission` includes selection checks; `reserve_booking_hold` is separately service-role-callable. Define and test a coherent new-admission policy across these authorities and close unintended bypasses without breaking internal recovery.

Keep the 15-minute operational freshness bound initially; do not extend it to manufacture uptime. Trigger health remains required until a separately proven availability/invalidation policy can replace it. This plan does not bypass it or promise zero races against independently edited external calendars.

Test the real purchased site's booking affordance, not only a fixture dialog. At the original source baseline, the inspected template-rendering branch received content without the parent live-booking callbacks; do not assume all templates reach the same live path. Verify the supported shared integration. Protected painter/template/LP designs remain off-limits; any required integration change across that boundary needs coordination rather than a claim that unsupported templates passed.

### 6. Paid Delivery

**What:** Recover calendar and notification obligations without contractor presence or silent duplication.

**Why:** Payment confirmation currently precedes calendar delivery. A healthy connection badge is not fulfillment evidence.

**How:**

- Retain the financial reducer and payment-evidence checks, but remove its dependency on mutable active calendar selection. Today `enqueue_booking_calendar_create` looks up that selection inside payment settlement, so disconnect can roll back payment projection. Settle verified payment truth and the durable delivery obligation using the destination bound before Checkout, even if access was subsequently removed; execution remains blocked by disconnect/permission authority. This introduces neither capture-after-calendar nor automatic refunds solely for Google failures.
- For existing unbound checkouts, use attributable retained reservation/provider evidence to bind the original destination. Never guess from today's selected calendar. If the original destination cannot be established, record payment through the financial reducer with an explicit unresolved-destination obligation on the existing booking/review authority; do not roll back financial truth, silently choose a replacement, or enqueue an unowned event. Define this forward-only data transition and test late payment on both bound and unbound records.
- Keep original destination epochs, deterministic event IDs, appointment versions, desired generations, fenced effect intents and readback. A lost INSERT response is not permission to mint another event or destination.
- Check disconnect authority before historical and current account work. A verified new account does not establish access to an old epoch.
- Replace status-only terminal 401/403 classification. Recoverable dependency failures retain a due path and visible cause; exhausted fast retries lead to slower recovery and escalation, not abandonment.
- Resume same-account blocked work only after checking current desired state, appointment version, cancellation/time constraints, and ownership. Do not blanket-requeue identity conflicts, deliberately cancelled work, or failures with unknown causes.
- Inspect historical `manual_repair` rows through existing audited repair authority. A migration must not relabel all old failures transient or rewrite destination identities.
- Require correct account/calendar/event/appointment identity, expected start/end, intended customer attendee and non-cancelled status for observed success. Compare normalized instants and relevant semantics. Material content drift requires explicit repair rather than overwriting contractor edits.
- Preserve cancellation compensation. A DB fence cannot cancel an already-dispatched Google request; subsequent desired-state/readback convergence must safely remove unwanted events. Do not promise that no late invitation can escape a cancellation race.
- Report payment, calendar synchronization, and email delivery separately through existing booking/receipt and admin repair projections.
- Reuse notification deduplication and provider idempotency keys. Accepted, delayed, bounced, complained, and failed messages have different remedies; delay must not trigger blind resends.
- If an obligation cannot be fulfilled, use the existing authorized cancellation/refund workflow and communicate the outcome. Do not forget it or change money state outside the financial reducer.

**Invitation contract:** Google INSERT requests `sendUpdates=all` with the customer as attendee. The event is placed on the contractor's selected calendar; the contractor also has a separate confirmation-email path, but is not automatically another Google invitee. Google acceptance is not an invitation inbox receipt, and email-provider telemetry cannot prove Google invitation delivery.

### 7. Truthful Experience

**What:** Separate durable connection, current booking eligibility, and who must act.

**Why:** Routine maintenance must not look like repeated onboarding, and paid must not imply calendar delivery.

**How:**

- Thread existing verification/reconnect reasons, saved identity, last-success evidence, due time and monitoring state through current overview/configuration loaders to `StepTwoCard`.
- Fix the configuration loader's `verification_reason` to `reconnectReason` conflation. Verification error is not inherently a reconnect reason.
- Keep saved availability/payment configuration visible during calendar incidents. Audit step locks and other consumers so temporary failure does not erase completion or authorize stale onboarding actions.
- Reserve OAuth for real reauthorization. Show selection/access repair for permission changes, automatic-repair progress for monitoring, and service-issue messaging for platform problems.
- Refresh displayed facts on focus and with a bounded interval while work is pending. UI polling is display refresh, never maintenance ownership.
- Bind async results to website/profile/environment and ignore superseded views. Preserve Stripe's environment-compatibility guard.
- Distinguish temporary booking unavailability from missing configuration and preserve legitimate contact/quote fallbacks. Do not expose account emails, provider identities, raw errors or internal configuration publicly.
- Deduplicate action-required notices using existing authoritative connection/incident or booking-notification identities. Repeated cron failures must not create a notification storm; recovery clears the relevant incident.

## Schema Scope

The original five migration filenames remain. For this correction, edit only unapplied 140 under its existing filename with a new checksum; preserve its Stripe and capture definition bodies, add no columns or duplicate SQL, and leave 150 unchanged. Migrations 120/130/133 are reported applied and immutable. Do not edit/reapply them or build a parallel connection system.

| Existing authority                               | Planned change                                                                                                                     | Required invariant                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Connection/selection verification functions      | Separate health observations from configuration mutation; preserve last-success and scoped write-blocker precedence                | A transient failure cannot erase configuration; read success cannot clear a known write denial      |
| Trigger claim/reservation/projection functions   | Targeted claims, missing-binding discovery, expired-operation recovery, repair progress and guarded retirement                     | One current configuration/effect owner; stale owners cannot commit                                  |
| Trigger failure scheduling                       | Persist bounded fast retries followed by slow dependency recovery and escalation                                                   | Authorized recoverable work never silently disappears because attempts reached eight                |
| Webhook key lookup and ingestion                 | Separate current authorized identity from operational health                                                                       | Degraded can remain trusted; disconnected or superseded cannot                                      |
| Disconnect reservation/completion                | Fence identity; record dispatch/ambiguity; resume settlement and constrain explicit supersession                                   | Disconnect wins over repair; late DELETE cannot target a reused authorization                       |
| Admission/activation/hold authorities            | Align permission, configuration and freshness predicates and execution grants                                                      | No weaker entry point admits new work without required evidence                                     |
| Reservation destination and financial settlement | Bind epoch before external Checkout; settle money and unresolved obligations without a current-selection lookup                    | Reselection/disconnect cannot retarget admitted bookings or suppress payment truth                  |
| Calendar observation/failure/recovery functions  | Verify content, preserve structured dependency failures, narrowly resume eligible work                                             | No blind replay of conflicts, wrong destinations, or obsolete appointment state                     |
| Cron registration and observability              | Exact owner-scoped native jobs, inactive registration, safe activation, existing-ledger correlation and scope/recorder projections | No cross-owner uniqueness claim; shared response history is not worker success or recorder liveness |

The owner-scoped correction adds no fields. The original lifecycle schema rationale was to extend existing rows only for concrete behavior: a recoverable setup probe identity, unambiguous provider failure classification, durable operation progress, or last-success evidence that current fields could not express safely. Retain each field's writer, reader, fence, clearing rule and retention. Do not overload `safe_error` prose as a machine-state protocol or invent parallel status flags derivable from current rows.

Every new/replaced SECURITY DEFINER function must retain a safe `search_path`, explicit role grants, tenant/environment checks, current-identity checks and transaction boundaries. Generated Supabase types are included in the full change and must be verified against the integrated schema. Test rollback and concurrency in real disposable PostgreSQL, not only mocked RPC calls.

Persisted data is a concrete compatibility requirement: existing accounts, multi-calendar selections, booking epochs, pending disconnects and manual-repair obligations must survive. Schema introduction and app deployment must remain safe in their documented order; do not ship a second runtime path indefinitely for speculative compatibility.

## Operational Evidence

Use existing cron-delivery records, provider binding due/attempt state, booking-family heartbeats, calendar-link states and notification-review records. Extend the existing admin observability surface and alerts where appropriate; do not create an unrelated dashboard or monitoring store.

Record safe correlation: deployment, environment, tenant/binding/booking identity, operation, sanitized failure category, claim/fence, started/completed time and next retry. Never record access tokens, refresh tokens, webhook signing keys, authorization headers, full provider responses, or customer calendar contents.

The following are proposed initial release thresholds, not measurements or guarantees. Keep implementation, tests, and runbook thresholds together and revise only from evidence.

| Signal                                                                                | Initial target / alert                                                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Required owned every-minute job is missing/inactive/drifted, or has no dispatch/start | Immediate schedule alarm; dispatch/start alarm after three missed minutes, even without due rows; no global absence claim  |
| Shared response recorder registry                                                     | Alert when an owned row is inactive; if registered/active are null/null, omit the condition without clearing a prior alarm |
| Verification due but not completed                                                    | Warn at two minutes overdue; critical at the 15-minute freshness boundary                                                  |
| Expired claim not recovered                                                           | Alert when still runnable two scheduling cycles after lease expiry                                                         |
| Paid calendar work remains unresolved                                                 | Warn after two minutes; critical after five minutes, or immediately for a confirmed conflict/permanent blocker             |
| Notification ready to send but unprocessed                                            | Warn after two minutes; delivery failures/bounces use existing review escalation                                           |
| Retry exhaustion or dependency-blocked obligation                                     | Incident with reason, oldest age, next attempt and responsible actor; never a silent terminal row                          |
| Recovery                                                                              | Current successful evidence, resumed eligible work, and resolved incident; not merely a successful cron response           |

Distinguish scheduled, dispatched, authenticated, claimed, verified and delivered. A handler can return HTTP 200 while individual rows failed or the worker is `off`; neither is proof of normal operation. Detect missing schedule identities, not only failures of rows that happen to exist.

Health must report `scheduler_scope: {owner, visibility:"owner_only"}` (application report `schedulerScope`) and separate `response_recorder` (`responseRecorder`). A foreign/invisible legacy recorder yields `registered:null, active:null`, meaning registry unobserved, not absent; an optional owned row yields `true`/boolean. `last_recorded_response_at` is the shared existing ledger's `max(responded_at)` at or before observation, including other schedules/environments and failures. The recorder copies `net._http_response.created`: response-created time, not a collector heartbeat. A lack of retained history proves neither recorder absence nor inactivity; a fresh shared response cannot mask per-calendar stale/completion/outcome, binding or paid-obligation failures. Unknown registry omits `response-recorder` without false resolution of prior alarms, and the admin UI must show that coverage gap even when no assessed thresholds fire.

**Monitoring independence:** a watchdog scheduled only by the same `pg_cron` cannot detect complete failure of that scheduler in real time. Reuse the project's independent monitoring pattern or Lovable platform monitoring where its failure coverage is verified. This does not require moving application workers off Lovable. If no independent monitor is available, record that coverage gap and do not claim guaranteed outage alerts from a self-monitoring cron job.

Assign an application operator and a tested alert destination before rollout; do not invent a channel or imply someone is on call. Contractor action is for permissions/consent, not platform maintenance. Track the age of paid obligations through repair or authorized cancellation/refund to closure.

## Acceptance Matrix

Acceptance requires model/contract tests and actual SQL state transitions, plus later user-run browser integration and controlled provider tests. Current PR verification is code-only; browser/visual/E2E and hosted acceptance are not authorized by this plan. Mocks are useful for faults but cannot establish deployed scheduling or real provider delivery.

| Scenario                                                                               | Required result                                                                                                                                           |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contractor logs out; no owner browser traffic for 24 hours                             | Scheduled verification continues beyond many freshness/token-expiry cycles; test bookings and delivery do not require owner login                         |
| Immediate reload versus 15-minute-old evidence                                         | Both preserve account and selections; stale evidence displays checking/unavailable, not false revocation                                                  |
| Machine token expires or server instance restarts                                      | Server obtains a token; saved authorization and job identities remain unchanged                                                                           |
| Google refreshes ordinary access tokens                                                | Provider calls succeed without repeating the Connect-link flow                                                                                            |
| One verification fails, then provider recovers                                         | No configuration-revision cascade or trigger deletion; recovery restores current evidence                                                                 |
| Provider outage exceeds eight retry attempts                                           | Low-rate recovery remains scheduled; alert fires; healthy accounts are not starved                                                                        |
| Actual Google revocation versus unknown 401/403 versus invalid platform client         | Correct actor/remedy; unsafe new bookings stop; obligations remain visible                                                                                |
| Scopes, calendar roles and FreeBusy pass but event/attendee writes remain denied       | Known scoped write blocker restricts new admission; successful reads or an unrelated probe cannot clear it                                                |
| Blocking or destination access changes                                                 | Exact affected permission is reported; no silent loss/replacement of selected calendars                                                                   |
| Selected account/calendar is beyond first list page or list is malformed               | No false disappearance; complete bounded discovery or explicit unknown state                                                                              |
| Binding missing, trigger missing/inactive, webhook missing or URL drift                | Same desired configuration repairs without contractor login or duplicate active resources                                                                 |
| Wrong component key/version on successive passes                                       | Drift is never adopted as the desired contract; truthful observed version                                                                                 |
| Setup probe create/delete loses response                                               | Same private probe identity is resolved and cleaned up; no orphan accumulation or attendee notifications                                                  |
| Crash during deployment or an expired operation remains                                | Existing ownership is reclaimed and the same operation reconciles                                                                                         |
| Reconciliation overlaps reconnect/reselection/trigger cleanup                          | Only current configuration settles; old cleanup cannot delete an adopted resource                                                                         |
| Health failure changes SQL state                                                       | Does not invoke configuration cleanup or invalidate its own settlement fence                                                                              |
| Signed webhook during temporary degradation                                            | Accepted only for the exact authorized current identity; does not fabricate permission health                                                             |
| Invalid signature, stale correlation, other environment, retired binding               | Rejected without mutating readiness or bookings                                                                                                           |
| Disconnect interrupted before/after provider deletion and DB clear                     | Resumes the same intent and audit; automatic recovery cannot resurrect it                                                                                 |
| Owner reauthorizes while an old account DELETE is dispatched/ambiguous                 | No reuse of the deleting provider identity; a distinct new account is not targeted by late cleanup                                                        |
| Reconnect selects a new account while old bookings exist                               | New work uses the new configuration; historical work keeps its original epoch and obeys disconnect authority                                              |
| Many concurrent public requests for stale evidence                                     | One bounded scoped verifier; no global worker dispatch, probe/deployment effects, or cross-tenant work                                                    |
| Public projection suppresses booking while stale                                       | A supported site can reach bounded refresh/retry before the final gate; contact fallback remains honest                                                   |
| Google healthy but Stripe stale, or SaaS inbox fails                                   | Account maintenance independently recovers; paid checkout remains gated correctly                                                                         |
| Existing checkout is retried during provider outage                                    | Same authorized operation recovers; no duplicate checkout/payment or invalid new admission                                                                |
| Payment arrives after disconnect/reselection, including a legacy unbound checkout      | Payment truth settles once; original bound destination is preserved or explicit unresolved-destination review is retained; no current-account fallback    |
| Selection changes between verification, FreeBusy and reservation                       | Stale evidence is rejected by revision/generation and SQL checks                                                                                          |
| Concurrent same-slot reservations and external busy-range updates                      | Internal exclusion and current external-evidence rules remain intact                                                                                      |
| Paid Google INSERT succeeds but response is lost; worker restarts                      | Exact event identity is read back; no blind new event or duplicate invitation request                                                                     |
| Existing event has wrong time, missing attendee or cancellation                        | Not reported as successfully delivered; explicit repair state                                                                                             |
| Cancellation overlaps an already-dispatched create                                     | Desired-state compensation removes unwanted event and preserves financial state                                                                           |
| Historic manual-repair row has unknown cause or identity conflict                      | No automatic mass replay; audited scoped recovery only                                                                                                    |
| Email accepted/delayed/bounced or event accepted without receipt                       | Status reflects the evidence; no claimed Google inbox delivery or blind resend                                                                            |
| Worker deadline expires, claim renewal fails or provider body hangs                    | Bounded invocation; no unfenced new effect; durable continuation                                                                                          |
| Owned schedules disabled, wrong secret, `off` mode, or missing family                  | Observability detects actual servicing loss, not just HTTP reachability                                                                                   |
| Foreign exact-name or other-environment jobs hidden by native owner RLS                | Owner-only registration/activation leaves them untouched; no claimed global uniqueness; deployment constraint remains explicit                            |
| Recorder foreign/invisible or owned inactive; shared fresh response but stale calendar | Unknown registry preserves prior alarms and visible coverage; owned inactive alerts; shared history cannot suppress per-calendar stale/outcome conditions |
| Supported-volume backlog plus a bad account                                            | Freshness and paid-delivery targets hold for healthy work within measured quotas                                                                          |
| Test/live mismatch, unauthorized owner, impersonation or cross-tenant request          | Rejected without provider mutation or weakened financial/database authority                                                                               |

Use test tenants, test-mode Stripe, controlled calendars and consenting recipient addresses for provider tests. Do not create events, send messages, run mutation-bearing cron, or enable real charging on production accounts as an implicit diagnostic step.

### Existing Test Seams

Extend the current suites rather than creating a disconnected test harness:

- `scripts/test-booking-providers.mjs`, `test-google-calendar-completion.mjs`, and `test-pipedream-reconciliation-errors.mjs` for provider contracts, classification, saved selection preservation and bounded recovery.
- `scripts/test-provider-authorization-seams.mjs` and `test-stripe-connect-environment.mjs` for tenant, owner, environment and service boundaries.
- `scripts/test-booking-workers.mjs` and `test-admin-calendar-repair.mjs` for paid convergence, ambiguity and narrowly authorized repair.
- Disposable SQL tests for actual trigger invalidation, locks, fences, disconnect interruption, replay, admission consistency, native owner grants and owner-only scheduling/recorder uncertainty. Tests must own inert grant fixtures, not extract the removed runbook policy bootstrap. Mocked RPC success cannot establish these invariants; retain Stripe/capture definition-body and unchanged-150 checks in the primary's final record.
- Future user-run acceptance: `tests/e2e/payment` plus the real overview/public booking route for stale-state behavior and supported customer entry points. Existing component fixtures are not a deployed end-to-end test.

Code-only implementation/integration commands (references, not a record that the ongoing integrated run has passed):

```bash
pnpm verify:booking-foundation
pnpm verify:bucket2-start
pnpm verify:bucket3
pnpm verify:admin-recovery
BOOKING_REPAIR_BROWSER_TEST=0 pnpm test:unit:bucket3-booking
node scripts/test-provider-authorization-seams.mjs
pnpm test:db:bucket3-local
pnpm exec tsc --noEmit --incremental false
pnpm build
```

Run focused lint/format checks and `git diff --check` on intended files. Confirm the disposable DB harness cannot target a deployed database. Report unavailable test dependencies separately from failures, and distinguish local passing tests from hosted/provider acceptance.

Future user-run E2E command, outside the current code-only verification:

```bash
pnpm test:e2e:payment
```

This is not authorization to run browser tests or provider/hosted operations now. Real-provider delivery, deployed scheduling, capacity and the no-owner-traffic soak require their separately approved acceptance work.

## Rollout Order

This document records code-only implementation and planned rollout, not operational authorization. Provider tests, cron registration/activation/dispatch and database application remain separately authorized actions; the PR request does not authorize them.

1. Integrate current `main` in the isolated branch/worktree; inspect effective migrations and preserve unrelated work. Retain the upstream lookup/auth/Step 1 and shared renderer/scroll/overlay contracts without unrelated painter/template/media/catalog/generated-route changes.
2. Implement only the current owner-scoped correction by replacing unapplied 140 in place, without new columns or duplicate SQL; preserve Stripe/capture definition bodies, worker/configuration/transport fences and unchanged 150. Do not edit/reapply immutable 120/130/133, fix the separate paid-expiry P2 or change deployed services while developing.
3. Run code-only local contract, actual SQL, concurrency and failure-injection tests. Review the complete lifecycle diff, including generated types, grants and runtime budget assumptions. Browser/visual/E2E acceptance remains future user-run work.
4. Open one PR for the coherent change after checking for an existing PR of the same intent. Follow the repository's no-history-rewrite rule. The PR must identify code/migration order, schedule activation, and any remaining supported-template integration boundary.
5. Wait for the user to merge and then explicitly return with both merge confirmation and authorization to apply the migration. Approval, observed merge, or CI success alone is not authorization.
6. Only then verify the published allowlist and **new exact SHA-256 for corrected 140**, followed by unchanged 150. For each authorized migration, dry-run the exact name/checksum, inspect the complete response, then apply only after success and verify ledger/replay and intended function behavior. An unexpected applied entry, mismatch or error means stop; do not reapply 120/130/133 or reuse old-checksum authorization/results. Follow `cursor.md` Deployment OPs exactly; no SQL-editor shortcuts or SQL in the request.
7. Verify native owner grants read-only, then separately authorize inactive registration and runtime/Vault configuration. Record actual hosting limits, target origin, environment, credential presence and capabilities without exposing values. Missing grants mean stop and ask the existing native grant authority, not a protected-cron policy or self-elevation. Maintain the owned-only/no-hidden-bearer-job deployment constraint; catalog checks and a code merge prove neither scheduling ability nor global job absence.
8. With explicit operational authorization, exercise bounded workers using controlled accounts. Verify authenticated dispatch, due-time changes, exact provider identities, worker outcomes, and failure/recovery alerts. A disabled-handler response proves transport only, not processing.
9. Enable the reviewed schedules in the intended environment and service existing obligations in drain mode where applicable. Do not mark recovered historical records healthy without observation or automatically replay unknown manual-repair causes.
10. Complete the no-owner-traffic soak and paid-calendar/notification recovery drills on controlled accounts. Record app commit, migration checksums, schedule identities, test identities, timestamps and actual outcomes.
11. Enable new booking admission only under the existing approved entitlement/cutover/charging controls after acceptance passes. Monitoring must remain active. Report precisely what was verified and what remains restricted.

Creating or editing migration files is not applying them. The implementation handoff must state that only corrected 140 then unchanged 150 remain for the approved Lovable/Supabase process, with explicit post-merge authorization and successful exact-checksum dry runs for each. The first three migrations are already applied and immutable; this docs-only update authorizes and performs no deployment.

### Incident Recovery

- Pause unsafe new booking admission through existing controls; keep valid existing-obligation workers draining. Do not erase connections or tell every contractor to reconnect during a platform incident.
- If a new worker mutates incorrectly, stop that affected execution path and preserve all claims/evidence; use the reviewed previous compatible deployment or a forward fix. Do not restore a known unsafe worker merely to show activity.
- Leave schema expansion and durable history intact. No destructive rollback, account deletion, blanket timestamp refresh, or table-level replay resets.
- Repair exact affected identities through existing audited transitions. Require current evidence before restoring admission and resolve outstanding paid obligations explicitly.

## Release Evidence

Collect these during implementation and rollout, not as repeated prerequisite questions that delay the local work:

- Actual current deployment, database function versions, project/environment mapping, owner-scoped schedules and recent outcomes, with the explicit no-hidden-bearer-job deployment constraint. Owner-only visibility cannot establish cross-owner uniqueness; historical account snapshots are not current account evidence.
- Documented provider contracts for exact account/calendar lookup, pagination, trigger component versions, and reauthorization behavior. Preserve existing scopes unless a necessary operation proves more is required.
- Measured runtime/request limits, provider quotas, eligible tenant count and peak booking/notification rate. Set batching and backlog targets from those facts.
- A named operator, tested alert delivery, independent scheduler-silence coverage, and an explicit account-action notification path.
- The actual supported purchased-template booking entry path. Any protected integration change must be separately coordinated; it cannot be hidden behind passing dialog fixtures.

Provider outages and genuine revoked grants do not invalidate the design, but they limit the promise. The release is complete only when normal inactivity never requires OAuth, automatic repair services recoverable work, intentional disconnect is honored, unsafe admission stays blocked, and outstanding paid obligations remain visible until resolved.

## Scope Boundaries

- No browser keepalive, longer Connect-link expiry, synthetic timestamp refresh, indefinite readiness, or unconditional "Connected" badge.
- No new OAuth provider, Google refresh-token store, second queue, workflow engine, or permanent server.
- No protected-cron policy, BYPASSRLS, raw cron writes, self-elevation, application job registry, new table or additional columns for the owner-scoped correction; no unrelated paid-expiry P2 fix.
- No silent scope expansion, fallback account selection, test-to-live conversion, or bypass of revocation.
- No change to direct-charge payment ownership, capture timing, refund authority, or entitlement/cutover policy beyond threading current evidence consistently.
- No exactly-once invitation inbox guarantee or assumption that the contractor is an attendee on their own destination calendar.
- No template visual rewrite, broad cleanup, or unrelated modifications to concurrent painter/LP work. Booking wiring is limited to supported painter11/plumber through the mold registry; no wider template booking support or final E2E acceptance is claimed.

## Source Map

Paths refer to the historical source baseline above; integration review must use the effective definitions in the combined tree.

| Area                                    | Files / symbols                                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google provider/token contracts         | `src/lib/pipedream.server.ts`; `pipedream-trigger-contracts.ts`; `pipedream-trigger-event.ts`                                                                                                                                                 |
| Owner configuration and bootstrap       | `src/lib/booking-provider.functions.ts`: `configureGoogleCalendarTrigger`, `completeGoogleCalendarConnection`, `disconnectGoogleCalendar`                                                                                                     |
| Provider authority/state                | `src/lib/provider-authorization.server.ts`; `google-calendar-state.server.ts`                                                                                                                                                                 |
| Health and projections                  | `src/lib/google-calendar-readiness.ts`; `booking-readiness.server.ts`; `booking-readiness.ts`                                                                                                                                                 |
| Reconciliation and ingress              | `src/lib/pipedream-trigger-reconciliation.server.ts`; `pipedream-inbox-worker.server.ts`; `src/routes/api/pipedream/webhook.ts`                                                                                                               |
| Purchaser experience                    | `src/lib/template-purchase.functions.ts`; `src/components/purchaser/PurchaserOverview.tsx`; `SetupStepCards.tsx`                                                                                                                              |
| Public entry and reservation            | `src/routes/lp/$websiteId.tsx`; `src/lib/booking-availability.server.ts`; `booking-live.functions.ts`                                                                                                                                         |
| Stripe readiness                        | `src/lib/stripe-connect.server.ts`; `stripe-connect-inbox-worker.server.ts`; `stripe-connect.functions.ts`                                                                                                                                    |
| Booking and email delivery              | `src/lib/booking-reconciliation.server.ts`; `booking-stripe-inbox-worker.server.ts`; `booking-outbox-worker.server.ts`; `booking-notification-worker.server.ts`                                                                               |
| Worker authority and endpoints          | `src/integrations/supabase/booking-worker.server.ts`; `src/routes/api/cron/pipedream-inbox.ts`; `stripe-inbox.ts`; `booking.ts`                                                                                                               |
| Scheduling precedent                    | `supabase/migrations/20260824240000_canonical_lovable_job_cron.sql`; `docs/runbooks/bucket1-generation.md`                                                                                                                                    |
| Google state/ingress/trigger SQL        | `supabase/migrations/20260829093908_bucket2_google_readiness.sql`; `20260829093909_pipedream_calendar_ingress.sql`; `20260829093910_pipedream_trigger_lifecycle.sql`                                                                          |
| Reservation and delivery SQL            | `supabase/migrations/20260829093900_booking_authorization_foundation.sql`; `20260829093911_bucket3_live_booking_lifecycle.sql`; `20260829093921_booking_money_authority_closure.sql`; `20260829093922_booking_google_convergence_closure.sql` |
| Disconnect, notification and family SQL | `supabase/migrations/20260829093923_booking_customer_lifecycle_closure.sql`                                                                                                                                                                   |
| Entitlement activation SQL              | `supabase/migrations/20260901110000_saas_checkout_authority_and_entitlement_lifecycle.sql`: `activate_pro_booking_admission`                                                                                                                  |

Official infrastructure/provider references reviewed for this design:

- [Lovable Cloud](https://docs.lovable.dev/features/cloud)
- [Lovable Jobs](https://docs.lovable.dev/features/jobs)
- [Lovable Supabase integration](https://docs.lovable.dev/integrations/supabase)
- [Pipedream OAuth clients and managed refresh](https://pipedream.com/docs/connect/managed-auth/oauth-clients)
- [Pipedream Connect API proxy](https://pipedream.com/docs/connect/api-proxy)

## Cursor Self-Vet

| Agreement                      | How this plan satisfies it                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Root cause, not symptoms       | Connects identity, health, execution, admission and fulfillment instead of extending a timeout or renaming a badge                |
| Recursive what/why/how         | Each implementation step names its behavior, underlying failure and concrete existing authority                                   |
| General case                   | Covers inactivity, outages, missing deployments, permission loss, disconnect, retained accounts, concurrency and paid obligations |
| Evidence, not assumptions      | Separates source findings and proposed targets from unobserved hosted state and provider delivery                                 |
| Do not over-engineer           | Reuses provider auth, existing records, leases, queues, admin repair and Lovable scheduling; new fields require actual consumers  |
| No transitional debt by reflex | Replaces bad state semantics and duplicate gates rather than shipping a permanent keepalive workaround                            |
| End-user explanation           | Defines when the contractor acts, when the system repairs, and what customers may safely book or expect                           |
| Honest completion              | Requires runtime/provider tests, no-owner-traffic soak, explicit migration/activation steps and unresolved-obligation evidence    |
