# Lifetime Implementation Recheck

Latest review/fix record: [PR 141 holistic review](pipedream_cron_pr141_review.md) now includes code-only closure of H1-H7, CI fixture and verified pre-commit follow-ups. The earlier V1 withdrawal was too broad; known-entitlement/unknown-calendar isolation is now implemented without the invalid blanket fallback. Independent reviewers closed their findings before commit preparation; deployment and real-provider acceptance remain outstanding. Earlier records below are historical scoped evidence.

**Current status (2026-09-12):** All R1-R21 source fixes and V2/V3 are included in the full review change integrated with `origin/main` at `ceeb2ea`. V1 remains withdrawn with R16's explicit-error behavior unchanged. Integrated code-only verification passed as detailed below, and independent integration review found no material issue within its scope. No deployed migration/provider/cron operations have occurred for this change, and the PR request does not authorize them.

## Final Main Integration

Final main check also picked up `8354719` (PR #140) during publication. Its field-note/overlay changes merged without conflict and were preserved unchanged. Application types, template-manifest parity and the complete public-booking aggregate passed again; SQL and cron files were unchanged by that sync.

Preserved PRs #136-#139: chain-based lookup/reuse, authenticated agent-message calls, Step 1 live-site/edit links, and shared template selection/scrolling/overlay content. Painter11/plumber retain live booking callbacks through the registry; other template implementations, catalog, media and generated routes remain unchanged relative to main. The earlier lifetime work is checkpointed at `ebf05f8`; main is integrated by merge, without rewriting published history.

Fresh code-only checks passed: `pnpm build`; `pnpm verify:types` (94 tables, 145 migrations); application and payment-fixture TypeScript; `BOOKING_REPAIR_BROWSER_TEST=0 pnpm test:unit:bucket3-booking` including lifetime/public/transport suites; foundation/Bucket2/Bucket3/leads verifiers; upstream template lookup/manifest/auth/ownership/publish contracts; SaaS pricing/security and receipt/money checks. The source-only leads verifier was updated to require the existing deadline-wrapped readiness call, not an obsolete direct-call spelling. Whole-repository lint is not a clean baseline; generated Supabase formatting and unrelated existing formatting violations were not broadly rewritten.

Disposable PostgreSQL 15.19 normal and managed-safeupdate replay passed all eight SQL suites. The unchanged Sep11 `claim_agent_turn` migration was preapplied before the five Sep10 lifetime migrations, then checked after each and after sorted reapplication: definition, owner, ACL and effective grants remained identical. The actual Google completion handler/SQL suite passed ten scenarios. Scheduler, Pipedream outcome, financial recovery, notification lifetime, monitor integration and constrained worker-role suites also passed. All clusters stopped; fixtures use loopback, inert scheduling interfaces and mocked provider transport.

Dedicated V2 regressions now run in the same AsyncLocalStorage scope as the real Stripe helper: fence loss or work-deadline expiry after begin produces zero provider GETs and unsuccessful release; valid scope succeeds once. V3 now has a code-only failed-read -> manual retry -> successful-editor regression, with no automatic save/retry or late unmounted writes. These close the earlier explicitly recorded test gaps.

PR CI now invokes the lifetime unit aggregate and SQL handoff suites. A `[code-only]` PR-body marker defers its browser job; default PR and post-merge main browser behavior is retained. No browser/visual/E2E test was run for this integration. The user retains deployed E2E/soak acceptance. Five migrations remain unapplied to deployed databases; review/merge, explicit application authorization, bootstrap, activation and provider entitlement remain separate.

Original recheck: 2026-09-11. **Historical pre-fix verdict: no holistic all-clear. Additional source defects and incomplete plan handoffs remain.** The private-INSERT recovery fix held in that review; its correction was not reported again. The later fix-wave closure and V1-V3 dispositions below supersede that source verdict without turning earlier local passes into integrated or hosted acceptance.

The original recheck reviewed the then-uncommitted `fix/pipedream-lifetime-connection` worktree at `/var/folders/1r/hvylr3cn7zs6bng006f512380000gn/T/opencode/obra-pipedream-lifetime`, based on `7c1eb41`, against [pipedream_cron.md](pipedream_cron.md) and [cursor.md](../cursor.md). Finding narratives and line references below describe the historical reviewed source unless explicitly recording a fix, not current integrated line numbers. No application, migration or test source was edited during that recheck.

Independent review scopes covered Google authority, money/fulfillment, provider/shared transport, scheduling/alerts, and UI/shared consumers. Evidence is source tracing, actual application code with in-memory transport boundaries, and disposable local PostgreSQL with inert platform fixtures. No browser, DOM, visual, screenshot or E2E tests were run. Hosted provider behavior and database configuration were not inspected.

## Historical P1 Findings

### R1. Pending-Setup Read Authority

**Pending setup cannot be loaded through the application's service-role authority.** New integration defect.

`src/lib/booking-readiness.server.ts:85-97` directly selects `booking_provider_account_disconnects_v3`, but the effective table ACL revokes SELECT from `service_role` (`20260829093923_booking_customer_lifecycle_closure.sql:938`). SQL120 does not restore that grant.

Reproduction used the actual configuration handler and effective SQL, executing this SELECT as `service_role`: `permission denied for table booking_provider_account_disconnects_v3` (42501), surfaced as `Unable to load pending Google Calendar setup`. BYPASSRLS does not bypass table ACLs. The mock getter tests return an empty disconnect result without enforcing those grants.

**Impact:** the owner loses setup/remediation data precisely when an operation is unfinished, and the failure can propagate through purchaser readiness. **Correction:** expose the narrow read through existing definer authority or return the necessary authorization fact from a scoped existing read RPC; do not grant broad raw access to the disconnect ledger merely to satisfy a new reader.

### R2. Reauthorization Changes Intent

**Explicit same-account OAuth completion replaces pending calendar choices with old saved choices or a default.** New lifecycle handoff defect.

`src/lib/booking-provider.functions.ts:594-639` validates the pending setup key but does not consume the pending setup's actual choices. It chooses active saved selections or a default writable calendar.

Actual handlers plus SQL reproduced both cases, with one unchanged healthy account in provider inventory: pending blocking B/destination B became `primary` during initial setup; with saved A and pending B, completion reinstated A and marked the operation completed. Both returned `{ completed: true }` with healthy monitoring. The actual issued Connect operation/cookie and SQL revision checks were used, not a bypassed completion fixture.

**Correction:** resume the captured current owner intent when OAuth belongs to that pending operation. Validate its scopes and exact calendars; do not treat successful reauthorization as permission to choose an alternative configuration.

### R3. Off-Mode Continuation

**An already-admitted hold can start its first payable Checkout while worker mode is `off`.** New runtime-control regression.

`src/lib/booking-live.functions.ts:216-219` applies deployment controls only when there is no reservation replay. A valid unexpired `held/not_started` replay proceeded through claim, handoff, Stripe create and settlement with `BOOKING_WORKER_MODE=off` and `BOOKING_LIVE_ENABLED=false`.

This is not duplicate charging, and `BOOKING_LIVE_ENABLED=false` alone is not the defect: legitimate continuation in `drain` is part of the plan. **Correction:** require a valid matching-environment servicing mode (`active` or `drain`) before mutation-bearing continuation. Preserve receipt/status access while off and do not reintroduce the old blanket admission gate over every replay.

### R4. Cancellation Drops Write Evidence

**Cancellation prevents recording a denial from a provider effect that was already authorized and dispatched.** New capability-feedback gap.

`20260910130000_booking_calendar_lifetime.sql:1040-1045` requires the calendar link's current processing lease to record the effect result. Actual cancellation clears that lease while the Google write may still be in flight.

SQL reproduction: begin attendee CREATE, cancel through the real owner RPC, then record the effect's scoped write-denied 403. Result settlement fails, fallback failure returns false, the unchanged connection remains healthy, and another real reservation succeeds.

**Correction:** distinguish authority to dispatch new effects from authority to retain the result of an old effect. Record the latter through its frozen dispatch identity and apply current account/calendar/revision-scoped negative capability evidence without reviving the cancelled appointment.

### R5. Financial Credential Recovery

**A Stripe credential/permission incident can end autonomous payment recovery even after credentials are restored.** Preexisting in-scope servicing gap.

`src/lib/booking-stripe-inbox-worker.server.ts:13-22` and `booking-reconciliation.server.ts:128-137` classify provider authentication/permission errors as terminal. A real Stripe SDK 401, mocked at HTTP only, produced a dead-letter payment event and `session_expiry_next_attempt_at=infinity` through actual failure RPCs. After successful provider responses were restored, neither path performed another read; the provider-paid fixture remained locally `payment_pending` with zero paid amount.

This is retained evidence stranded from automatic servicing, not proof of irreversible money loss. No existing application-admin booking-inbox requeue path was found; separately authorized manual recovery or later suitable provider evidence could change that, but was not exercised.

**Correction:** keep platform authorization dependencies on bounded slow retries, separate from invalid financial evidence. Recover the same event/payment identities without creating another charge or weakening snapshot validation.

### R6. Recurring Event Deletion

**A contractor-edited recurring series still passes the one-appointment event check and can be deleted as a whole.** Retained material-content validation gap.

`src/lib/pipedream.server.ts:1382-1400` checks initial times, attendee and marker but ignores recurrence. The actual booking reconciler with fake provider transport read a matching event with `RRULE:FREQ=WEEKLY;COUNT=20`, then sent one DELETE with its current ETag and reported convergence.

ETags protect against changes after inspection, not material changes already present when read. **Correction:** require one-off event semantics before declaring present, including rejection of recurrence, recurring-instance identity and unspecified end time. Use the existing conflict/repair path instead of deleting a modified series.

### R7. Dispatch-Evidence Handoff

**A locally prevented trigger deployment can be left permanently marked ambiguous.** New deadline/dispatch interaction.

`src/lib/pipedream-trigger-reconciliation.server.ts:386-423` persists dispatch intent before the adapter's final deadline/continuation check. In-memory reproduction expired the budget after the begin RPC but before provider POST: zero deployment POSTs occurred, yet `p_deployment_definitely_rejected=false` retained the marker. The next healthy pass stopped at `trigger_deployment_ambiguous`.

A separate probe returned HTTP 200 carrying a deployed resource just as continuation stopped; the caller lost that response to `deadline_exceeded`. That probe establishes loss of the returned response, not completed JSON parsing or a persisted receipt.

**Correction:** preserve explicit not-dispatched and completed-response outcome facts for fenced settlement. Stopping future execution must not discard known outcome evidence. Do not clear genuinely dispatched unknown effects merely because they timed out.

### R8. Financial Drain Capacity

**Scheduled payment and refund lanes are each capped at one item per invocation, despite available runtime budget.** New throughput regression.

`src/routes/api/cron/booking.ts:201-209` passes `limit=1` to workers whose internal loops already claim one row at a time and obey continuation fences. An actual route/worker/Stripe SDK probe processed one of ten payment events, left nine, and returned `completed` after 9 ms of a 45-second budget.

With the planned every-minute schedule, sustained arrival above one payment event per minute exceeds this lane's capacity. A finite backlog still drains in order; this is not proof of permanent starvation. The refund lane has the same source limit, but the burst proof tested payments.

**Correction:** allow bounded multi-item invocation loops while retaining small SQL claims, fairness and deadline/fence checks. Do not confuse small claims with one-item total throughput.

## Historical P2 Findings

### R9. Lifecycle Budget Fairness

**Calendar backlog can use all time before financial lifecycle recovery runs.** New deadline interaction.

`src/lib/booking-reconciliation.server.ts:576-601` runs the Google reconciliation batch before late-payment arbitration, hold/session expiry and ambiguous Checkout recovery with one shared budget. A controlled-clock run with four ten-second Google failures made zero calls to those later authorities. Repeated passes can exhaust an unrelated arbitration window.

**Correction:** allocate bounded opportunities to existing lifecycle responsibilities or interleave their small claims. Moving another unconstrained drain to the front does not solve fairness.

### R10. Cancelled Legacy Repair

**Cancelling an unresolved-destination booking leaves a calendar obligation the repair API cannot service.** New incomplete recovery branch.

`20260910130000_booking_calendar_lifetime.sql:1404-1410` accepts destination resolution only for future confirmed/unrefunded appointments. SQL reproduced a paid legacy-unbound booking then real owner cancellation: `cancel_pending/unresolved_destination`, no claimable calendar link, and valid AAL2 repair with original evidence rejected with 40001. Refund completion does not resolve it.

**Correction:** let the same audited authority resolve a cancelled appointment to absent desired state, or close with attributable evidence that no event effect occurred. Do not reconfirm or create an event.

### R11. Stale Refund Notification

**Refund-pending email can still be dispatched after refund completion.** Preexisting predicate gap retained in the new notification authority.

The effective `booking_notification_event_current_v4` branch in `20260829093923_booking_customer_lifecycle_closure.sql:455` tests historical `refund_requested_at`, not current refund state. Actual SQL completed the refund and accepted a completion notification, then authorized the older pending message through the new dispatch authorizer.

**Correction:** align event projection, repair scan and final dispatch validity so pending copy requires pending refund state. Preserve accepted and ambiguous-dispatch evidence rather than deleting notification history.

### R12. Auth Rejection Evidence

**Shared body buffering converts a known Auth 429 rejection into manual-only delivery ambiguity.** New shared-transport bystander defect.

`src/lib/worker-deadline.server.ts:136-172` discards the observed non-success status if its diagnostic body stalls. Actual Supabase Auth client/OTP worker probes compare one complete 429 (retryable fulfillment failure) with the same 429 headers plus a stalled body (status zero, `mark_saas_checkout_fulfillment_delivery_unknown`, excluded from automatic retry).

**Correction:** preserve observed non-2xx status through bounded diagnostic failure and the Auth SDK boundary. Keep unknown outcome only for genuinely missing responses; still prohibit dispatch after deadline.

### R13. Trigger Incident Resolution

**An idle successful cron call can resolve Google alerts while a trigger remains degraded.** New monitor handoff gap.

`20260910140000_calendar_worker_schedules.sql:531-557` includes a connection only when overdue or stale; failure aggregates at `:560-568` omit binding failures. `20260910150000_calendar_action_notifications.sql:335-337` counts connection/setup platform errors, not binding errors.

Actual fenced SQL plus evaluator reproduced successful account reads, trigger `provider_platform_error`, hourly retry, and the next idle invocation: `google:outcome` and all Google/platform conditions resolve while the trigger is still degraded. This occurs during fresh connection evidence (roughly minute 1); freshness alerts can return around minute 15. It is premature resolution, not proven blindness for the entire hour.

**Correction:** report current scoped binding failures independently of overdue inventory. Only successful trigger projection may clear the persistent trigger incident; an empty invocation cannot.

### R14. Contradictory Family Health

**The cron route ignores explicit lifecycle failure counters.** New aggregation defect.

`src/routes/api/cron/booking.ts:221-229,352-355,395-409` considers rejected promises and notification failures but ignores `googleFailures`/`latePaymentFailures`. An actual lifecycle manual-repair observation returned `googleFailures:1`; the route reported HTTP 200/completed, `failed:null`, and persisted family success.

**Correction:** consume known positive counters as partial failure and unsuccessful family servicing. Keep totals unknown where other workers do not provide counts, rather than fabricating zero. Separate obligation alerts do not make the contradictory family result correct.

### R15. RLS-Hidden Cron Owners

**The owner-conflict query cannot detect foreign-owned jobs hidden by stock-style RLS.** Conditional source defect, not an observed hosted collision.

`20260910140000_calendar_worker_schedules.sql:268-275` checks foreign owners under the constrained definer. With `cron.job USING(username=current_user)`, those rows are filtered out before the conflict predicate runs. Local PostgreSQL left two exact-name jobs: one old foreign-owned active job and one newly registered inactive job; the wrapper saw no conflict.

**Correction:** use the approved privileged bootstrap to provide SELECT-only visibility for the exact controlled job identities, or inspect/reconcile those identities through equivalent narrow authority. Do not grant raw writes or general BYPASSRLS. Hosted ownership/policies remain unobserved.

### R16. Entitlement Read Fallback

**A failed outer entitlement read can unmount Pro setup and discard edits.** Baseline residual amplified by new polling.

`src/lib/template-purchase.functions.ts:77-83,119-120` ignores the query error and falls back to Starter/unconfirmed independently of the checked readiness reader. Actual handler/component probes produced outer Starter/unconfirmed alongside inner Pro/confirmed readiness; a successful poll accepts this contradictory DTO and unmounts Steps 2-4.

**Correction:** derive the outer fields from the already-checked readiness authority or fail that refresh explicitly, retaining the current forms. Do not interpret unknown entitlement as a downgrade.

### R17. Outer Route Isolation

**Booking-status read errors can abort the whole workspace or public website.** Baseline residual and unclosed bystander boundary.

`src/lib/jobs.functions.ts:176-183`, `src/routes/user/$userId.tsx:22-43`, `src/lib/booking-availability.server.ts:15`, and `src/routes/lp/$websiteId.tsx:212-219` propagate these errors before the new unknown/retry UI can mount. Actual route probes rejected on readiness failure and prevented unrelated content/edit access.

**Correction:** keep authentication/tenant identity checks blocking but isolate booking-status failure from unrelated page content. Public booking remains disabled under unknown readiness; contact content should not disappear.

### R18. Early OAuth Retry

**A transient completion failure before setup reservation leaves no retry except fresh OAuth.** Baseline residual.

`src/components/purchaser/SetupStepCards.tsx:219-247,594-617` consumes `connect=success` after failure; when `booking-provider.functions.ts` fails account/calendar discovery before reserving setup, there is no saved account or pending setup to expose Check Status. The displayed message asks for an action that is absent.

**Correction:** expose bounded retry of the existing owner/browser-correlated completion while its operation/cookie remains valid. Do not require another authorization just because a provider read failed.

### R19. Temporary Customer Retry

**Temporary booking failure has no reachable retry and may be mislabeled as no appointments.** Baseline residual newly exercised through template wiring.

`src/routes/lp/$websiteId.tsx:243-249,321-354` provides disabled booking after an incomplete refresh, with no callback path to refresh it. `src/components/booking/LiveBookingDialog.tsx:62-77,165-196` displays an error and the successful-empty-result message after slot rejection, without a retry control.

**Correction:** distinguish pending/unknown availability from successful empty results and missing setup; offer retry through existing bounded readiness/slot paths without weakening admission. The disabled gate itself is safe and is not the defect.

### R20. Independent Receipt Status

**Receipt copy can hide calendar failure behind financial or appointment success.** Baseline residual.

`src/routes/booking.confirmation.tsx:34-60` returns refund-completed copy before showing `cancel_failed`, and late-payment-recovered copy before `create_failed`. Pure component/function probes confirmed both supported combinations hide the outstanding calendar obligation.

**Correction:** render calendar status independently of payment/refund and appointment state rather than choosing one message that suppresses the others.

### R21. Booking View State

**Future/Past navigation retains the old rows and pagination cursor.** Preexisting bystander defect; this route was not modified by the lifetime implementation.

`src/routes/bookings.tsx:34-44,54-66` initializes local state from loader data once, without remounting/synchronizing on view change. Code-only component reproduction showed Future customers under Past and the Future cursor retained for pagination.

**Correction:** scope list/detail/cursor state and in-flight pagination to the view, or remount by that view. This should not be presented as a newly introduced lifetime regression.

## Historical Root Causes

These findings are not a reason to add another queue or orchestration layer. They expose incomplete agreements between existing authorities:

- Read adapters and actual service-role grants diverge; provider mocks bypass the ACL they claim to exercise.
- Saved, pending and replayed intent are individually fenced but not consistently consumed by the next caller.
- Dispatch permission, provider outcome evidence and current appointment state are conflated at cancellation/deadline boundaries.
- Small claims became one-item invocation limits, and one lifecycle batch can monopolize a shared budget.
- Worker completion and empty polling are treated as successful recovery despite retained dependency failures.
- UI status readers remain duplicated or fail above the components intended to preserve unknown state and edits.

## Original Recheck Evidence

Fresh `BOOKING_REPAIR_BROWSER_TEST=0 pnpm test:unit:bucket3-booking` and `pnpm verify:types` passed. The isolated diff check passed. Reviewers also passed scoped existing suites, actual-handler/SDK probes and full regular SQL replay with inert platform interfaces. Their counterexamples still establish the failures above; passing the current suite is not holistic correctness evidence.

The private-INSERT cause separation, normal nonce exchange, existing revision/key collision tests, immutable destination reservation, template live callbacks, conditional ETag checks, 23/24/48-hour email behavior, and basic independent monitor/action delivery continued to pass within their tested scopes. They were not re-reported as failed merely because prior reports had findings.

No fresh managed-safeupdate replay or production build was run by the primary reviewer in this recheck; earlier passing runs remain historical evidence. No browser/DOM/visual/E2E execution or real provider/hosted DB/cron operations occurred. Full deployment, provider entitlement, external operator destination and user-run end-to-end/soak/capacity acceptance remain separate.

Retained code-level reproduction artifacts under `/var/folders/1r/hvylr3cn7zs6bng006f512380000gn/T/opencode`:

- `review-current-google-authority.mjs`: actual handler/SQL pending-reader permission and Connect intent tests.
- `holistic-booking-review-20260911-kPtDsh/`: actual booking SQL, SDK credential recovery, off-mode continuation and fairness probes; its disposable clusters were stopped.
- `calendar-review-runner.mjs` and `calendar-review-memory-imports.mjs`: scheduler RLS, payment throughput, lifecycle-result and trigger-alert probes.
- Transport and UI counterexamples executed inline/in memory. Their observations are retained in the review transcript, not standalone durable regression files. Do not describe them as newly committed tests.

## Historical Pre-Fix Decision

The implementation cannot be marked fully correct against the plan. The latest targeted private-INSERT fix remains valid, but the broader integration is not ready for a complete-lifecycle release. Address the verified source issues through existing authorities with tests spanning the affected handoffs; keep baseline bystander defects explicitly labeled and avoid silently broadening scope. Any subsequent migration application still requires the mandatory review, merge, explicit authorization, exact-checksum dry run and apply order.

## Fix-Wave Closure (Pre-Integration)

All R1–R21 items were implemented locally on `fix/pipedream-lifetime-connection` with existing authorities (no new queues/orchestration), plus permanent regressions. Code-only verification passed: `test:unit:bucket3-booking`, `test:unit:calendar-lifetime`, `test:unit:public-booking`, `test:unit:calendar-transports`, disposable SQL harness regular + managed-safeupdate, `verify:types`, `tsc`, `git diff --check`, `pnpm build`. No browser/visual/E2E, provider/hosted DB/cron, staging, commits or deployment.

Final independent review raised 2 P2s; both were dispositioned on evidence without code change:

- Off-mode `resumeSession` (`src/lib/booking-live.functions.ts:342-372`) calls only `recover_booking_checkout_handoff_v3`, which is `STABLE` with SELECTs only (`20260829093923_booking_customer_lifecycle_closure.sql:68-84`), plus Stripe retrieve (read) and a response cookie. Mutation-bearing claim/handoff/Stripe-create/settle paths remain gated on `active|drain` (`booking-live.functions.ts:384-388`). Receipt/status reads while `off` are intended, so no gate move.
- Cron owner-visibility is by design a separately approved bootstrap: the migration asserts the exact `obra_calendar_worker_visibility` SELECT-only policy for the 8 controlled job names (`20260910140000_calendar_worker_schedules.sql:6-54`) and fails closed without it; registration/conflict checks run under that assertion (`:295-300`). The policy itself is provisioned only via the reviewed bootstrap with cron-owner authority, never by the migration alone. Hosted owners/policies remain unobserved, so activation must still verify the bootstrap on the target.
- R13 idle-resolution is addressed in code: `binding_failures` aggregates independently of overdue inventory (`20260910140000_calendar_worker_schedules.sql:588-611`) and the evaluator raises persistent `google:binding:*` incidents (`src/lib/calendar-observability.server.ts:389-398`); only successful trigger projection clears them.

Release remains blocked on: PR review/merge, explicit migration authorization + exact-checksum dry-run/apply for the 5 new migrations, cron privilege bootstrap verification on the target, secrets/schedule/monitor activation, Pipedream production entitlement, and user-run E2E/soak/capacity acceptance.

## Post-Fix-Wave Vet (2026-09-11)

Fresh independent five-scope code-only vet of the current uncommitted `fix/pipedream-lifetime-connection` worktree (base `7c1eb41`) after the R1–R21 fix wave, per `cursor.md` (root cause, general case, evidence, no over-engineering). No application, migration or test source was edited. No browser/visual/DOM/E2E, credentials, live provider/hosted DB/cron, staging or commits. Lifecycle, financial, scheduler and much of transport/UI were read with in-memory or disposable-local-SQL probes and returned no new material findings; coverage and limits are noted per finding.

**Historical follow-up verdict: still no holistic all-clear for a complete-lifecycle release, but the follow-up changed the finding set: V1 is withdrawn as a non-defect (evidence below), and V2/V3 are fixed locally with code-only verification passing. No application behavior outside V2/V3 changed in that correction.**

### V1. Purchaser overview hard-fails on booking-readiness outage — WITHDRAWN (non-defect)

**The proposed fallback was wrong; the current explicit-failure behavior is the R16-prescribed contract.** Verifying the fix attempt against the suite proved it: `scripts/test-booking-page-isolation.mjs` (R16 regression) requires `getPurchaserOverview` to reject when the checked readiness read fails so the UI retains prior forms (`statusUnknown`, same React key, steps stay mounted). Falling back to `unknownBookingReadiness` resolves with plan Starter/unconfirmed, which unmounts paid Pro setup — the exact R16 false-downgrade defect ("do not interpret unknown entitlement as a downgrade"). On initial load there is no prior state to retain, so the full-page error with Retry is the honest R16 behavior ("fail that refresh explicitly"). The V1 edit was reverted; the suite passes unchanged. Initial-load resilience without misleading plan data would be new scope (cached prior DTO), not a correctness defect.

### V2. Stripe saved-account retrieve bypasses the shared worker fence (Medium) — FIXED locally

**A cron worker provider read can dispatch after lease/fence loss or past the work deadline.** New shared-transport defect against plan §4.

`src/lib/stripe-connect.server.ts:107-123` built a custom Stripe client with raw `fetch` when `deadlineAt` is set, checking only a local `deadlineAt-2000` bound. It never checks `workerCanContinue()` / `workDeadlineAt` / the scope abort signal and loses body-limit/buffering. Callers run inside `withWorkerDeadline` (`src/routes/api/cron/stripe-inbox.ts:73-81` → `processStripeConnectInbox` / `reconcileDueStripeConnectAccounts` → `reconcileStripeConnectAccount` / `reconcileStripeConnectInboxEvent` → `retrieveSavedAccount`), where `getStripe()` would already return the fenced `workerProviderFetch` client (`src/lib/stripe.server.ts:71-82`).

Impact is bounded: read-only `accounts.retrieve`, per-request `timeout` capped at 8s, `maxNetworkRetries:0`, so no duplicate money effect; the failure is lane-budget consumption and delayed settlement, not corruption.

**Fix (existing authority only, no new transport):** `retrieveSavedAccount` now throws `WorkerDeadlineError` when `workerCanContinue()` is false before dispatch, and builds the same per-call client but with `workerProviderFetch` as the fetch function inside a worker scope (scope abort, work-deadline cap, body limits) and plain `fetch` outside one. `redirect:"error"`, per-request timeout/retry options, and the dynamic `import("stripe")` shape are unchanged, so `scripts/test-stripe-connect-refresh.mjs` timeout observability still holds. A first attempt routing through the `getStripe()` singleton was rejected by that same suite (lost `redirect:"error"` and mock observability outside a worker scope) and reworked to this form.

### V3. Step 3 availability read failure traps as infinite loading (Medium) — FIXED locally

**A transient schedule read leaves no error state and no retry.** Preexisting baseline residual, unchanged by this wave.

`src/components/purchaser/SetupStepCards.tsx:1040-1057,1083-1091` catches `getBookingSetup` failure by setting `availabilityInitial` to `null`, which is indistinguishable from loading; the render then shows `Loading schedule…` forever. Unlike Step 2 (`configError` + reload) or Step 4 (Stripe status error), there is no failure copy or retry control; page reload is the only undiscoverable workaround.

**Fix:** `StepThreeCard` (`src/components/purchaser/SetupStepCards.tsx`) now tracks `availabilityError` separately from the loading null state plus an `availabilityReload` counter in the effect deps; failure renders "Unable to load the schedule. Saved settings are unchanged." with a "Retry schedule" button that clears the flag and re-runs the same read. No other props, locking, or editor behavior changed.

### V2/V3 Verification (Pre-Integration)

V2/V3 fixes verified without browser/visual/E2E, credentials, provider/hosted DB/cron, staging or commits: `tsc --noEmit` clean, `eslint` on touched files clean, `git diff --check` clean, `test:unit:calendar-transports` pass, `test:unit:public-booking` exit 0 (18/18 page-isolation scenarios, incl. the R16 refresh-rejection regression that refuted the V1 proposal), `test:unit:bucket3-booking` exit 0 (incl. `test-stripe-connect-refresh` timeout observability and the transports suite). The V2 fence-loss pre-check itself has no dedicated retrieve-level regression — coverage rests on the pattern-identical `boundedFetch` gate (9 hung-transport scenarios) plus the unchanged Stripe refresh suite; a scope-expired retrieve probe would need worker-scope orchestration the current harness does not provide. V1 needs no verification (reverted, suite unchanged). Release remains blocked on the same items: PR review/merge, explicit migration authorization + exact-checksum dry-run/apply, target bootstrap verification, activation, provider entitlement, user E2E/soak.

Lifecycle (service-only pending-setup RPC, consumed pending intent, setup-to-persist handoff, dispatch vs outcome evidence, retirement/tombstones, reauth proof, failure classification), financial (cancel/refund/arbitration precedence, receipt nonce/replay, pre-dispatch vs dispatched, frozen effect identity, cause-specific CREATE/DELETE/probe ordering, unresolved-destination repair, frozen notification payload with 24h replay bound, off/drain gates), scheduler/monitor (narrow bootstrap + RLS, inactive-by-default, bounded lanes, binding-failure persistence, known vs null-unknown counters, Stripe projection reset, alert thresholds/dedupe/recovery, generation independence) and the remainder of transport/UI checks in the reviewers' scopes returned no new material findings beyond V1–V3 above. Concurrent-OAuth attribution and post-disconnect orphan-probe races were traced statically and judged non-material (single-account newest-healthy selection; disconnect revokes the credential for event cleanup and the payload is inert/transparent with UI key tracking as backstop); no fix is proposed for those per no-over-engineering.
