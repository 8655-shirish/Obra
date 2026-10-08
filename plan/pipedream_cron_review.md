# Lifetime Connection Audit

**Current status (2026-09-12):** All R1-R21 source fixes and V2/V3 are included in the full review change integrated with `origin/main` at `ceeb2ea`. V1 remains withdrawn, preserving R16's explicit failure contract. Integrated build, types, booking/calendar/transport suites, upstream contracts and disposable SQL acceptance passed; a separate scoped integration review found no material issue. See the final integration section of [pipedream_cron_recheck.md](pipedream_cron_recheck.md). Historical passes below retain their original scope, and no hosted acceptance is claimed.

Original audit: 2026-09-10. Closure review, audit-of-audit and item 6 correction: 2026-09-11. **The reopened private-INSERT recovery defect was fixed and independently vetted locally.** The earlier premature closure is retained below as history. Other closure records retain their stated scope; this targeted correction was not a fresh all-application audit or hosted acceptance.

**Historical follow-up:** the code-only recheck after that targeted fix found R1-R21 source defects and incomplete handoffs. Their subsequent fix-wave closure and V1-V3 dispositions are recorded in [pipedream_cron_recheck.md](pipedream_cron_recheck.md). The matrix below preserves earlier closure evidence, not current open findings or a final integrated all-clear.

Originally reviewed the then-uncommitted implementation on `fix/pipedream-lifetime-connection`, based on `7c1eb41`, in `/var/folders/1r/hvylr3cn7zs6bng006f512380000gn/T/opencode/obra-pipedream-lifetime`. All implementation paths and line numbers below refer to that review snapshot, not current integrated line numbers or the older shared checkout. Requirements and current PR-preparation status are in [pipedream_cron.md](pipedream_cron.md); the review follows [cursor.md](../cursor.md).

The original findings and their reproduction evidence are retained below as history. Their line references describe the pre-correction implementation unless a current reference is explicitly given. Authorized corrections closed many handoffs and added permanent regressions, but the closure review missed the distinction between a resolved private INSERT failure and an attendee-bearing CREATE failure. Passing tests did not justify claiming complete recovery.

## Historical Closure Audit

**Item 6 correction, completed after the finding below:** the existing connection now retains separate `calendar_probe_insert_blocked_at` and `calendar_probe_insert_verified_at` evidence. Private setup INSERT denial no longer writes the attendee CREATE blocker. The existing setup settlement clears private INSERT only after its current, fenced INSERT and cleanup proof, while independent attendee CREATE and DELETE evidence remain intact. Owner/background verification can schedule targeted recovery for the private blocker. Retry dispatch refreshes its own start time and discards old setup-write proof.

The new real-SQL regression begins without any booking, rejects reservation after private failure, resumes the existing owner-authorized probe through worker claim and persistence, then successfully reserves with unchanged account/calendar/revision. It next creates a real paid booking denial, proves private failure/recovery cannot clear that independent attendee blocker, and restores admission only through the booking's own successful effect. No direct blocker reset occurs in this regression. The former Google fixture resets were replaced with recovery assertions.

Verification: the new recovery assertion failed before the source change (`private-insert-recovery-red.log`). Full regular and managed-safeupdate local replay now pass (`private-insert-recovery-green.log`, `private-insert-recovery-safeupdate.log`), along with booking/calendar unit suites, schema/types, Bucket 2/3 verifiers and focused lint. One independent reviewer, not involved in implementation, inspected the changed capability/retry/fence paths and ran the regular SQL harness plus network-disabled lifecycle tests; no material finding remained in this scoped fix. No browser, visual, E2E or hosted operations were performed.

**Original P1 finding, now corrected:** item 6 had a same-configuration recovery dead end. Pre-correction references were `supabase/migrations/20260910120000_google_calendar_lifetime.sql:745-749`, `20260910130000_booking_calendar_lifetime.sql:1212-1218,1224-1248`, and `supabase/tests/google-calendar-lifetime.sql:622-644` in the implementation worktree.

The private setup probe's INSERT permission denial is placed in `calendar_create_blocked_at`, the same blocker used for attendee-bearing booking CREATE. A later successful retry of that private probe cannot clear it: setup success clears DELETE evidence only, and owner verification schedules capability recovery only for DELETE blockers. With no eligible booking to supply separate CREATE evidence, the same restored account/calendar remains unable to admit bookings. The regression explicitly expects this blocker to survive, then clears its columns directly to continue the fixture. It tests conservative blocking, not the complete failure-to-recovery outcome the plan requires.

The correction must retain capability/cause provenance: a successful private INSERT may resolve a prior private-INSERT failure, but must never clear an independent attendee/invitation CREATE denial. Recovery tests must follow real authorized transitions without directly clearing the blocker. This is source work, not a provider credential, deployment or end-to-end-test prerequisite.

**Audit-process correction:** the final re-reviews were scoped, and some followed fixes made by the same agents. They were not an independent reread of the entire final combined diff. The recorded local test passes are supported, but their fixtures and terminal assertions must be compared to the original acceptance contract. This pass inspected the audit, current source/tests, and retained regular/safeupdate completion logs; it did not rerun the complete suite or start a fresh exhaustive application audit.

Targeted cross-checking did not establish another material overclaim in items 8, 13, 14, 16, 19 or 20. The deployment-receipt provenance, explicit cron privilege bootstrap, evidence-dependent legacy repair, finite email replay window, and operational monitoring qualifications remain legitimate within their documented limits. No broader zero-bug or production-readiness conclusion follows.

## Historical Closure Matrix

All paths below are in the isolated implementation worktree. "Fixed locally" means source correction plus code-level regression evidence, not hosted provider behavior. None of the five new migrations has been applied to a deployed database.

| Item                          | Current correction                                                                                                                                                                           | Evidence                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Cancellation authority     | Financial reducer preserves deliberate cancellation/refund intent; real owner cancellation during arbitration prevents recovery; receipt remains provisional while arbitration is unresolved | Booking SQL tests invoke actual cancellation, signed financial reduction, arbitration and receipt RPCs                                           |
| 2. Receipt identity           | `bookingConfirmationNonceHash` preserves the existing JSON-string nonce encoding through checkout, recovery and return; receipt-token hashing is unchanged                                   | Actual-handler cookie/digest/receipt contract tests, without a browser                                                                           |
| 3. Worker fencing             | Every provider dispatch and authentication retry consumes shared continuation/deadline authority                                                                                             | Worker-deadline and Pipedream transport tests                                                                                                    |
| 4. Editor revision            | Saved revision and pending-setup configuration key travel from view to discovery/save and SQL reservation; stale edits cannot legitimize themselves by rereading today's revision            | Code-only pending-setup, handler authorization and revision-collision tests                                                                      |
| 5. Setup completion           | Owner-authorized setup remains resumable through configuration commit; obsolete probes retain cleanup ownership; failed choices can be superseded safely                                     | Google lifecycle SQL and runtime interruption/supersession tests                                                                                 |
| 6. Capability recovery        | **Fixed locally after reopening:** private INSERT, attendee CREATE and DELETE have independent evidence; successful private retry restores only its own capability                           | Red/green real reservation and mixed-cause recovery tests with no direct blocker reset; regular/safeupdate replay and one independent scoped vet |
| 7. Absence evidence           | Calendar access is verified before attributable Google 404 proves event absence; unknown proxy failures stay unresolved                                                                      | Provider-contract access-loss/tombstone tests                                                                                                    |
| 8. Trigger contract           | Successful pinned-deploy response is captured as a fenced deployment receipt; definition ID is optional; later exact resource/component readback uses that provenance                        | 27 real-adapter/mocked-transport provenance scenarios and receipt SQL tests                                                                      |
| 9. Rejection evidence         | Observed HTTP rejection survives expired optional diagnostics, without permitting more dispatch after timeout                                                                                | Rate-limit/body-deadline/settlement tests                                                                                                        |
| 10. Checkout continuation     | Eligible pre-dispatch holds resume from persisted snapshots; expired unstarted or pre-handoff creating holds release capacity under lock                                                     | Checkout replay and full booking SQL expiry/concurrency tests                                                                                    |
| 11. Cancellation messages     | Current cancellation invalidates unsent confirmations; calendar recovery copy distinguishes CREATE from DELETE and waits for proven absence                                                  | Notification worker/SQL dispatch-fence tests                                                                                                     |
| 12. Supported templates       | Painter11 and plumber pass admitted live-booking callbacks to the parent dialog; gated purchased content never falls back to demo                                                            | Source/callback checks and type checks; final browser/end-to-end acceptance reserved for the user                                                |
| 13. Unattended alerts         | Existing monitor/admin surface consumes actual health, evaluates conditions and sends fenced, deduplicated owner-action notices                                                              | Actual SQL-to-evaluator/monitor/notification code tests; independent caller and real destinations still require rollout                          |
| 14. Cron privileges           | Narrow bootstrap grants and explicit privilege checks support constrained migration ownership without superuser assumptions                                                                  | Stock-equivalent ACL, bootstrap rollback and constrained-owner SQL tests; apply bootstrap only under approved deployment authority               |
| 15. In-flight reconfiguration | Unresolved deployment attribution survives supersession and late responses remain owned for retirement                                                                                       | Google SQL/runtime interleaving tests                                                                                                            |
| 16. Connect exclusion         | Owner/browser-correlated Connect operations permit distinct-account recovery while tombstoning deleting identities                                                                           | Connect/disconnect and late-result tests                                                                                                         |
| 17. Failure refresh           | Failed verification consumes settled negative facts; unreadable facts become unknown while forms remain intact; pending setup exposes actual remediation                                     | Code-only pending-setup and public-readiness tests                                                                                               |
| 18. Fresh fast path           | Runtime, environment, temporal eligibility and cutover apply before new-admission provider reads regardless of freshness                                                                     | Fresh/stale public admission tests                                                                                                               |
| 19. Legacy repair             | Existing audited AAL2 admin repair accepts unresolved appointments with attributable original-destination evidence, then binds/enqueues once                                                 | Real repair SQL and API authorization tests                                                                                                      |
| 20. Email ambiguity           | First dispatch freezes payload and 24-hour replay evidence; known acceptance retries DB settlement only; out-of-window unknowns enter review                                                 | Actual notification worker/SQL 23/24/48-hour tests                                                                                               |
| 21. Conditional deletion      | Matching read ETags authorize destructive writes; 412 preserves conflicts for booking and probe cleanup                                                                                      | Provider and lifecycle read/edit/delete tests                                                                                                    |
| 22. Delivery capacity         | Notification claims repeat just in time within budget; known suppression/review settles and does not block unrelated messages                                                                | Real worker/cron/SQL ten-message drain and lost-fence tests                                                                                      |
| 23. Health projections        | Completion age is independent of dispatch age; real retry states are counted; successful Stripe projections reset old failure metadata                                                       | Scheduler/Stripe SQL and monitor schema tests                                                                                                    |
| 24. Capability ordering       | Success/denial precedence uses attributable effect evidence and operation-specific state, not readback settlement time                                                                       | Overlapping effect-order SQL regressions                                                                                                         |

## Earlier Re-Review

Independent code-level reviews covered provider/setup authority, booking/payment/receipt/notification transitions, scheduling/monitoring and UI integration. Additional findings were corrected and re-reviewed before closure: expired `held/creating` capacity; real owner cancellation during provisional arbitration; truthful provisional receipts; waiting for actual absence before cancellation-repaired email; settled suppression/review draining; pending-setup remediation controls; setup write-denial readiness feedback; stale-revision cleanup ownership; structured setup permission reasons; and unobserved concurrent pending-editor changes.

The audit-of-audit correctly invalidated the premature closure for item 6. The subsequent cause-specific correction and one independent post-implementation vet now close that identified defect, without retroactively broadening the earlier review coverage. Ambiguous provider effects without sufficient evidence remain visible and fail closed; successful evidence for a known private-probe failure is no longer ignored.

## Earlier Verification

These are retained pre-integration results. The primary's full integrated verification remains ongoing and is not covered by these passes.

- Passed the complete code-level booking/calendar/public/receipt/authorization/provider/worker unit suite, including pending-setup controls without a browser.
- Passed full disposable PostgreSQL replay in regular and managed-safeupdate modes with constrained roles, exact ACL checks, concurrency, and all five new migration suites.
- Passed local notification and observability integration scripts using actual SQL and mocked outbound provider transport.
- Passed application and payment-fixture TypeScript checks, Supabase schema/RPC contract parity, focused lint/format, foundation/Bucket2/Bucket3/leads/money/notification/admin verifiers, and Cloudflare production build.
- After the user's explicit restriction, no further browser, visual, screenshot or end-to-end tests were executed. Earlier browser evidence is historical and is not final acceptance of the revised implementation. The user will test end to end.
- No hosted provider/DB/cron calls, credential changes, charging activation, staging, commits or deployment were performed for these corrections.

## Release Boundary

The identified source findings are dispositioned as recorded above; integrated verification and release acceptance remain separate. Migrations `20260910120000_google_calendar_lifetime.sql`, `20260910130000_booking_calendar_lifetime.sql`, `20260910133000_booking_notification_lifetime.sql`, `20260910140000_calendar_worker_schedules.sql`, and `20260910150000_calendar_action_notifications.sql` require application through the existing reviewed Lovable/Supabase sequence, explicit user merge confirmation and application authorization, then successful exact-checksum dry runs before apply. No deployed migration/provider/cron operations have occurred for this change, and raising the PR does not authorize them. Cron registration/activation/dispatch, monitor and notice opt-in, secrets, constrained cron privilege bootstrap and independent caller remain separately controlled operations. The item 6 correction was made in the new 120/130 migration files during local development.

The separate Pipedream production entitlement denial is not repaired by lifecycle code or cron. This implementation retains the Connect proxy/managed-trigger architecture and does not change the provider subscription, scopes, or billing environment. Resolve required provider capability during operational acceptance; do not infer it from successful Google authentication or local tests.

## Original Audit (Historical)

The findings, coverage, verification and correction strategy below retain the original pre-correction evidence and verdict. They are not current open items; see the current status and closure records above.

## Evidence Rules

- **Runtime reproduction:** actual application code with in-memory DB/provider boundaries or loopback Chrome. No authenticated external provider requests.
- **SQL reproduction:** actual lifecycle functions in disposable PostgreSQL with inert provider/scheduler fixtures; some probes replayed the complete migration chain.
- **Contract evidence:** official provider documentation plus controlled replay of an allowed response. This does not establish what a hosted endpoint returned today.
- **Conditional finding:** the condition is explicit; do not present it as observed production state.
- Previously fixed review findings were not counted again merely because they had once failed. Related remaining failures are grouped by authority/handoff rather than framed as unrelated patches.

## Historical P1 Findings

### 1. Cancellation Authority

**A pending refund event can reverse deliberate cancellation.** Preexisting financial-policy defect left open by this scope; the new migration removes a name-resolution error that previously masked its execution.

Locations: `supabase/migrations/20260829093921_booking_money_authority_closure.sql:439-451`, `20260829093922_booking_google_convergence_closure.sql:385-399`; migration `20260910130000_booking_calendar_lifetime.sql:268-277` preserves this reducer logic while repairing name resolution.

SQL reproduction: reserve, pay, and contractor-cancel an appointment. A supported `refund.updated` snapshot with the refund still pending changes `contractor_cancelled/refund=pending` to `late_payment_arbitration/refund=not_requested`. A subsequent clear availability observation re-confirms the appointment despite `cancellation_requested_at` remaining set; no refund command is claimable. This can recreate a cancelled booking while refund servicing has been suppressed.

Correction: preserve deliberate cancellation/refund intent before considering late payment. Restrict arbitration recovery to genuinely expired unpaid holds, with cancellation-intent checks at settlement. Keep one financial reducer, not a second compensating payment path.

### 2. Receipt Identity

**Checkout and the return endpoint hash the same nonce differently.** Preexisting, unclosed customer-flow defect.

Locations: `src/lib/booking-live.functions.ts:75-76,235-238,352-376`; `src/lib/booking-confirmation.functions.ts:123-129,149-155`.

Runtime reproduction: checkout persists SHA-256 of the JSON-encoded nonce, while the return handler submits SHA-256 of raw nonce bytes. A valid paying browser is rejected before receipt exchange reaches Stripe; the return route responds with failure. The separate checkout and receipt tests supply their own matching mocks, so neither establishes the shared contract.

Correction: use the same persisted nonce encoding in both consumers, including recovery and capability issuance. Preserve the separate receipt-token hashing contract and add a checkout-to-return test using the exact issued cookie and persisted digest.

### 3. Worker Fencing

**Pipedream can issue a new mutation after the shared worker stop fence is lost.** New integration defect.

Locations: `src/lib/pipedream.server.ts:304-326,593-602`; `src/lib/booking-reconciliation.server.ts:287-361`.

Runtime reproduction: lose the core-family continuation fence while Pipedream refreshes its machine token. The provider adapter, using a separate deadline context and raw `fetch`, still sends the next event POST and records acceptance. This is a new dispatch after known loss, not an unavoidable mutation already in flight.

Correction: every provider dispatch, including internal token-refresh retries, must share the caller's work deadline, cancellation signal, and continuation authority. Keep database settlement separate; do not merely add another pre-call check outside an adapter that can issue subsequent requests.

### 4. Editor Revision

**The UI can display account B while discovery and save operate on retained account A.** New UI regression combined with a missing client-revision contract.

Locations: `src/components/purchaser/SetupStepCards.tsx:118-141,228-278`; `src/lib/booking-provider.functions.ts:312-329,374-380`.

Loopback Chrome reproduction: another tab changes the saved account to B; overview polling updates the displayed email, but the configuration cache reloads only when workspace identity changes. Review/save still sends `accountId: apn_A`. The server reads today's revision itself, so the user's obsolete editor is not rejected and can restore A for new bookings.

Correction: thread the existing material configuration revision through overview, editor, and save. Reload configuration on revision change and reject stale submitted revisions. Preserve unsaved edits with a visible conflict rather than silently overwriting them.

### 5. Setup Completion

**The durable setup operation does not own the whole setup lifecycle.** Two reproduced failures share this cause.

Locations: `supabase/migrations/20260910120000_google_calendar_lifetime.sql:611-621,638-661,681-705,711-735`; `src/lib/google-calendar-state.server.ts` and the owner persistence caller.

SQL reproduction A: a definite permission failure leaves an incomplete probe. Selecting an accessible different account/calendar is then rejected as pending cleanup, even when no event was successfully created. Background recovery insists on the old capability; on initial setup the saved account is still null, so normal disconnect cannot free the operation.

SQL reproduction B: successful probe settlement marks setup completed and removes its retry time before configuration is persisted in the separate owner request. Kill that request, or let a worker finish an interrupted probe: the result can be a completed operation, no saved account/selections, and no claimable continuation. The contractor must return to complete an operation intended to be background-resumable.

Correction: keep the owner-authorized operation live through configuration persistence, not just the probe. Distinguish definite rejection, unresolved cleanup, capability proof, and committed configuration; support scoped cleanup-only supersession without requiring the old write permission to succeed.

### 6. Capability Recovery

**Write-blocker recovery is incomplete and over-coupled to unrelated state.** New defects plus missing planned recovery.

Locations: `src/lib/booking-reconciliation.server.ts:90-111`; `supabase/migrations/20260910130000_booking_calendar_lifetime.sql:648-670`; `src/lib/booking-provider.functions.ts:502-509`.

SQL reproduction A: a denied DELETE later succeeds with confirmed absence, yet its connection blocker cannot clear because the clearing rule accepts only attendee-bearing CREATE. The contractor stays restricted after actual recovery.

SQL reproduction B: an event create succeeds at appointment version 4; a financial dispute update moves version to 5 without changing calendar desire/configuration. Takeover confirms the correct event but cannot clear the blocker because the historical effect version differs from the unrelated current financial version.

Runtime/SQL reproduction C: successful same-account OAuth uses ordinary cooldown-limited refresh. It cannot wake an hourly retry immediately and has no cause-appropriate capability recovery path when no existing booking create can supply proof. Read-only refresh correctly preserves blockers, but that alone is not a complete recovery design.

Correction: retain the denied operation/cause and clear it only with an attributable later success of that capability on the same configuration. Separate calendar-intent identity from unrelated financial revisions for capability evidence. Give explicit owner reauthorization a scoped wake-up and continuation; do not let an attendee-free probe clear an attendee-specific denial.

### 7. Absence Evidence

**Calendar inaccessibility can be reported as successful event cancellation.** Preexisting provider-interpretation defect retained in scope.

Locations: `src/lib/pipedream.server.ts:1344-1355,1450-1458`; `src/lib/booking-reconciliation.server.ts:243-264`.

Contract/runtime reproduction: Google documents `404/notFound` both for nonexistent resources and for calendars the caller cannot access. Replaying the inaccessible-calendar response returns event `absent` and successful deletion. Cancellation can therefore converge while the real event/invitation still exists. Unattributed proxy 404 is accepted too.

Correction: require attributable Google evidence and current exact-calendar access before treating 404 as event absence. Preserve explicit tombstones as a separate proof and keep unresolved access failures retryable/actionable. See [Google error semantics](https://developers.google.com/workspace/calendar/api/guides/errors#404_not_found).

### 8. Trigger Contract

**Version verification depends on a field absent from the documented Connect trigger schema.** New provider-contract compatibility gap, not a proven hosted omission.

Locations: `src/lib/pipedream-trigger-reconciliation.server.ts:271-280`; `src/lib/pipedream.server.ts:1462-1481`; `src/lib/pipedream-trigger-contracts.ts`.

Contract/runtime reproduction: the official Connect Retrieve Trigger schema provides key/name/version/configurable props, but does not promise the saved `id` required by the reconciler. The parser accepts that documented shape; reconciliation rejects it forever as `trigger_version_unverified`, including an otherwise healthy deployed trigger. Positive fixtures inject `sc_...` IDs.

Correction: resolve deployed component/version provenance through a supported bounded metadata contract when the definition lacks an ID. Do not discard provenance checks or call a requested version observed evidence. See [Retrieve Trigger](https://pipedream.com/docs/connect/api-reference/retrieve-trigger). The actual hosted response still needs verification during authorized provider acceptance.

### 9. Rejection Evidence

**A diagnostic-body timeout discards a known rejection and prevents deployment recovery.** New transport/lifecycle integration defect.

Locations: `src/lib/pipedream.server.ts:369-373`; `src/lib/pipedream-trigger-reconciliation.server.ts:360-373,482-498`.

Runtime reproduction: a trigger create returns HTTP 429, but its optional error body exceeds the provider deadline. `remainingBudget()` throws before the catch preserves the observed HTTP response. The caller receives status 0, keeps the dispatch marker as ambiguous, then refuses another create despite an empty inventory after the rate limit recovers.

Correction: retain observed rejection status when bounded diagnostics fail; prohibit additional dispatch after budget expiry while still allowing already-known outcome settlement. Do not conflate missing diagnostics with an unknown send result.

### 10. Checkout Continuation

**A valid replay cannot resume a reservation whose Checkout never started.** New regression.

Locations: `src/lib/booking-live.functions.ts:205-264,338-365`.

Runtime reproduction: reservation commits, then attachment upload or the process fails before payment claiming. The same authorized request retries without a session ID and is unconditionally rejected as reconciling/non-payable. Background recovery requires a dispatched/creating payment context, so this `not_started` hold cannot progress and occupies capacity until expiration.

Correction: resume eligible pre-dispatch reservations from their persisted snapshots, capability and operation under the existing lease. Distinguish them from ambiguous dispatched work and terminal sessions; neither mint a replacement booking nor reread mutable selections as its identity.

### 11. Cancellation Messages

**Cancelled bookings can generate confirmation and invitation-restored messages.** Preexisting truthfulness defect amplified by more promptly projected calendar failures.

Locations: `src/lib/booking-notifications.server.ts:80-90`; `supabase/migrations/20260829093923_booking_customer_lifecycle_closure.sql:453-460`.

SQL/runtime reproduction: `calendar_failed` is current for a failed cancellation, but the email says the appointment remains confirmed. After DELETE recovery, `calendar_repaired` says an invitation is now available. An unsent original confirmation also remains eligible because it relies on historical confirmation rather than current cancellation state.

Correction: thread already-loaded appointment/calendar state into notification validity and copy. Suppress unsent confirmations after cancellation; use cancellation-specific failure/recovery wording without claiming invitation receipt.

### 12. Supported Templates

**Both supported purchased template CTAs still open demos instead of live booking.** Preexisting, acknowledged integration gap, now reproduced rather than merely untested.

Locations: `src/routes/lp/$websiteId.tsx:313-339`; `src/components/templates/PainterElevenTemplatePage.tsx:603-609`; `src/components/templates/PlumberTemplatePage.tsx:1198`.

Loopback Chrome reproduction: actual LP rendering with `liveBooking=true` opens template-local demo dialogs for painter11 and plumber and performs zero live-slot calls. The current plan cannot claim customer booking works on those purchased sites just because verification and the standalone dialog pass.

Correction: coordinate the protected shared integration boundary to thread eligibility and the existing parent booking callback into the templates without changing their design. No protected template source was edited by this review.

### 13. Unattended Alerts

**Calendar monitoring and contractor action-required delivery are not wired.** Acknowledged missing source implementation, not just pending secret/host setup.

Locations: `supabase/migrations/20260910140000_calendar_worker_schedules.sql:347-425`; `docs/runbooks/pipedream-calendar.md:148`.

Source trace: `get_calendar_worker_health` has no application consumer; the independent generation monitor remains generation-only. The health projection does not provide a complete aged paid-calendar/notification inventory, and no deduplicated connection-action notification path runs for an offline contractor. Existing booking status and booking-failure emails do not close this requirement.

Correction: connect existing health and obligation authority to the current monitor/admin mechanism, implement deduplicated action-required delivery, then configure and test the independent evaluator/destination. Merely activating schedules cannot provide these missing behaviors.

### 14. Cron Privileges

**Registration has an unhandled stock-extension privilege prerequisite.** Conditional deployment blocker, reproduced locally with stock-equivalent ACLs; hosted owner/grants are unknown.

Location: `supabase/migrations/20260910140000_calendar_worker_schedules.sql:156-160`.

Stock pg_cron revokes PUBLIC execution on `cron.alter_job`. When the SECURITY DEFINER owner is non-superuser, differs from the extension/function owner, and lacks the needed grant, registration fails with 42501 and rolls back all four jobs. Existing inert stubs leave default grants and do not expose this condition. A narrow grant permits registration in the reproduction.

Correction: establish and verify the exact extension privileges for the constrained definer through the approved bootstrap, and test that ownership arrangement. Do not assume superuser execution or grant broad cron administration to browser/worker roles. This is not a claim that the deployed owner necessarily lacks the grant.

## Historical P2 Findings

### 15. In-Flight Reconfiguration

**Material calendar changes can lose ownership of an in-flight trigger create.** New incomplete handoff atop an existing concurrency weakness.

Location: `supabase/migrations/20260910120000_google_calendar_lifetime.sql:122-136` and setup/persistence authority.

SQL interleaving: reserve and dispatch trigger creation, then save a new blocking set before its response. Invalidation erases the operation/dispatch evidence before a trigger ID is known. Late response adoption fails its fence, and future discovery filters against the new set, so the old provider resource is never owned for cleanup.

Correction: serialize material saves with unresolved deployment effects or retain the superseded operation for exact discovery/retirement. Immediate disconnect intent must still win, but cannot discard effect attribution.

### 16. Connect Exclusion

**Pending disconnect blocks genuinely distinct-account recovery, yet Connect start has no durable exclusion.** New overbroad guard plus an in-scope race.

Location: `supabase/migrations/20260910120000_google_calendar_lifetime.sql:558-565`.

SQL/runtime reproduction: any pending account deletion blocks all Connect starts for the tenant, although persistence can safely accept a distinct new identity. A disconnect committed after the precheck does not prevent link issuance; previously issued flows are not tracked. Actual provider same-ID reuse was not exercised.

Correction: use operation/account-scoped coordination that protects the deleting identity while allowing verified distinct identities. Removing the blanket guard alone is not sufficient.

### 17. Failure Refresh

**Failed checks retain obsolete healthy display facts.** New UI/public projection defect.

Locations: `src/components/purchaser/SetupStepCards.tsx:209-224`; `src/lib/booking-availability.server.ts:87-94`.

Runtime/browser reproduction: the verifier persists negative evidence and throws, but `checkStatus` refreshes facts only on success. The previous healthy badge remains, with no reconnect action and no pending poll loop. Public refresh similarly returns original failure reasons when every attempt rejects; its admission remains closed in the reproduced case.

Correction: consume settled facts after failed attempts within the available deadline. If the reread fails, display operational state as unknown rather than current; retain saved configuration separately.

### 18. Fresh Fast Path

**Fresh readiness bypasses runtime/environment/cutover checks before provider slot reads.** Preexisting gap not closed by the new public wrapper.

Locations: `src/lib/booking-availability.server.ts:15-48`; `src/lib/booking-live.functions.ts:276-302`.

Runtime reproduction: fresh snapshots return slots and invoke FreeBusy under disabled cutover or a mismatched worker environment. Checkout checks cutover only after those reads. SQL still rejects reservation, but customers see unusable availability and paused/ineligible traffic consumes provider capacity.

Correction: enforce structural/runtime eligibility before any new-admission provider read, regardless of freshness. Keep authorized replay separate from new admission.

### 19. Legacy Repair

**Unresolved legacy destinations have no usable calendar-fulfillment repair action.** New plan gap.

Locations: `supabase/migrations/20260910130000_booking_calendar_lifetime.sql:215-228`; `20260829093924_admin_auth_authority_closure.sql:535-541`.

SQL reproduction: a legacy unbound checkout correctly records paid truth and `unresolved_destination`, but has zero calendar links. Normal workers require a link; current audited admin repair requires an existing manual-repair link/generation. Even attributable original-destination evidence cannot be applied through the supported service API. Cancellation/refund remains possible, which is not the same as repairing fulfillment.

Correction: extend existing audited repair authority to the unresolved appointment, validate attributable original-destination evidence, bind/enqueue exactly once and clear review. Never select today's calendar as a fallback.

### 20. Email Ambiguity

**Acceptance ambiguity can be retried after the provider's idempotency retention window.** Preexisting plan gap.

Locations: `src/lib/booking-notification-worker.server.ts:91-110`; `supabase/migrations/20260829093923_booking_customer_lifecycle_closure.sql:483-489`.

SQL/runtime reproduction: an accepted send with unpersisted acceptance is reclaimed after a simulated 48-hour outage. A provider mock with 24-hour retention accepts a second email using the same key. Resend's official [idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys) confirms a 24-hour window; no hosted duplicate send was attempted.

Correction: retain first-dispatch and replay-deadline evidence, retry known acceptance settlement without a new send, and move unresolved beyond-window outcomes to existing delivery review rather than assuming keys are permanent.

### 21. Conditional Deletion

**Read-validated destructive operations do not consistently carry the ETag.** New superseded-probe gap plus preexisting booking-cancellation behavior.

Locations: `src/lib/google-calendar-state.server.ts:395-402`; `src/lib/pipedream.server.ts:1438-1455`.

Runtime reproduction: read a probe or booking at version 1, edit it to version 2, then cleanup/cancellation deletes the changed resource because `If-Match` is not passed. Normal probe cleanup already has a working conditional-delete negative control.

Correction: thread actual read ETags into destructive writes and preserve 412 as a conflict requiring renewed inspection, not permission to overwrite a contractor's edits.

### 22. Delivery Capacity

**Scheduled notification throughput regresses to one message per minute.** New regression.

Location: `src/routes/api/cron/booking.ts:195-199`.

Actual route/worker mock: ten ready messages, one sent, nine left, `completed` after 28 ms of a 45-second budget. Confirmations create both customer and contractor messages; one booking per minute already exceeds the schedule's send capacity. Previous invocation capacity was four messages.

Correction: retain small just-in-time claims but repeat while work and the family budget/fence permit. Stop on no work; do not trade bounded execution for a fixed throughput bottleneck.

### 23. Health Projections

**The new observability consumers do not consistently reflect existing durable facts.** Three introduced issues, all reproduced in PostgreSQL.

Locations: `supabase/migrations/20260910140000_calendar_worker_schedules.sql:118-123,362-374,421`.

- A new pending dispatch hides a ten-minute unanswered request because health selects only the latest request. Google/Stripe have no separate family heartbeat fallback, so continuous dispatch can conceal response-recorder failure.
- Notification failures are stored as `retry`, but the projection counts `retry_wait`, reporting zero while messages are retrying.
- Successful Stripe webhooks refresh readiness/due times without clearing the newly added maintenance error/attempt metadata if the failed claim was already released. The account is ready but still counted failed, and repeated webhooks can postpone cleanup of those obsolete facts.

Correction: evaluate completion age independently of dispatch age, consume the actual notification state vocabulary, and clear maintenance failure metadata atomically in every successful fenced/generation-checked Stripe observation path.

### 24. Capability Ordering

**SQL can discard a later denial because an older write's readback settled later.** Conditional SQL precedence defect; ordinary current-worker concurrency reachability was not established.

Locations: `supabase/migrations/20260910130000_booking_calendar_lifetime.sql:478-481,652`.

Two valid simultaneous claims reproduce: create A succeeds, later create B fails, A's readback writes its settlement time as capability-success time, then B's denial is rejected as older. The link keeps its failure, but connection health remains clear. Current application claims normally run sequentially under the core-family lease; do not describe this as an unconditional current cron failure.

Correction: order capability evidence by attributable provider effects rather than readback settlement time, conservatively retaining overlapping denial. This is the inverse of the sticky-blocker cases in finding 6.

## Historical Plan Coverage

| Plan area                                         | Audit result                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Durable saved identity and non-destructive health | Substantially implemented; setup, reconfiguration and editor handoffs remain incomplete                                      |
| Request-local bounded execution                   | Implemented and tested on shared SDKs; Pipedream dispatch is not fully inside shared continuation authority                  |
| Provider contract and trigger recovery            | Many recovery paths implemented; undocumented mandatory ID and lost rejection evidence can prevent progress                  |
| Explicit disconnect and reauthorization           | Basic fencing/retained identities implemented; distinct-account flow and explicit wake-up/continuation incomplete            |
| Safe admission and checkout replay                | Immutable destination and SQL gates present; early fresh-read gates and pre-dispatch replay remain wrong                     |
| Paid fulfillment and cancellation                 | Significant durable machinery present; cancellation intent, receipt identity, notification copy and recovery remain blocking |
| Truthful purchaser display                        | Better state distinctions; stale revision and failed-refresh handling are incorrect                                          |
| Lovable scheduling                                | Inactive definitions and safe-origin transport present; constrained-owner ACL and throughput/projection issues remain        |
| Monitoring, escalation, offline contractor action | Health inspection exists; evaluator/notifications remain missing source work                                                 |
| Existing purchased template path                  | Both currently wired molds reproduced using demo dialogs, not live admission                                                 |
| Local tests                                       | Passing, but several tests terminate before the next authoritative handoff or mock the assumption being tested               |
| Hosted acceptance                                 | Not performed or implied; requires approved rollout and controlled provider/scheduler/soak checks                            |

## Original Verification Record

Freshly reran `pnpm test:unit:bucket3-booking`, including calendar lifetime, public booking/receipt, authorization, worker deadlines, real-SDK hung transport and loopback libcurl suites: passed. `pnpm verify:types` passed. Reviewers also ran focused existing suites and an isolated regular full SQL replay. Their added temporary probes reproduced the failures above despite those passing suites.

This review did not rerun the entire 79-case browser suite, production build, or managed-safeupdate suite; those passed in the prior implementation turn. Targeted loopback browser tests exercised the actual UI/LP control flow with injected data, inert styling and mocked providers, not hosted visual/provider acceptance.

Temporary reproduction artifacts are under `/var/folders/1r/hvylr3cn7zs6bng006f512380000gn/T/opencode`:

- `gc-review-7e1bf4.mjs`: Google lifecycle SQL and callback interleavings.
- `booking-review-9cb7-driver.mjs`, `booking-review-9cb7-probes.sql`, `booking-review-9cb7-notifications.mjs`: financial/calendar SQL and actual notification worker/template cases.
- `review-pipedream-transport-20260910-c73f9e.mjs`: provider/shared-worker dispatch, diagnostic timeout, absence and deletion cases.
- `review-calendar-slice-829ac7.mjs`, `review-calendar-throughput-829ac7.mjs`: cron ACL/projections/Stripe evidence and one-message throughput.
- `review-userflow-7c1eb41-astra-20260910-a73f9.mjs`: checkout/receipt, replay, real LP dialogs, editor revisions and freshness failures.

These scripts reference the reviewed worktree; they are not permanent regression tests or immutable snapshots. Disposable PostgreSQL clusters were stopped. No live account/calendar/Stripe mutations, credentials inspection, migrations on hosted databases, cron activation, commits, or staging occurred in this review.

## Historical Correction Strategy

Use the existing seams rather than another orchestration layer. Close each complete handoff with an end-to-end local regression before proceeding: owner setup through saved configuration; admitted reservation through Checkout and receipt; cancellation intent through money/calendar/notification settlement; provider evidence through common dispatch fencing; and persistent operational facts through actual offline alert delivery.

Do not merge or apply the current migrations as a complete lifetime-connection release. Correct the verified source defects and missing integrations first, preserving explicit revocation, payment authority, immutable destinations and the protected template boundary. Then follow the existing review/merge/authorization/dry-run/apply sequence and separately verify real provider contracts, deployment privileges, throughput, alert delivery and the no-owner-traffic soak.

No review can prove the absence of all bugs. This audit can establish the narrower conclusion: there are concrete unresolved failures, so an all-clear is not justified.
