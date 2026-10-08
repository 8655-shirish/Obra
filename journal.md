## 2026-09-14 - Independent vet of redirect:manual fix (3 scopes, no blockers)

Three independent read-only reviews of fix/workers-redirect-manual, adjudicated: (1) Transport/security: no credential-to-second-host path (no Location/response.url following anywhere; safe-remote-media is the sole follower and its two callers pass only Accept/User-Agent/Referer — checked, nothing secret); no success-confusion (all 8 sites fail closed on non-ok). Two accepted residuals: a 302 carrying a rateLimit body could same-URL retry (bounded, fenced, no cross-host leak); a 302 with valid Stripe-shaped JSON would satisfy the SDK (requires Stripe itself misbehaving; old code threw here, noted). (2) Runtime-compat: zero redirect:error residue in src (all spellings swept); several version-gate flags dismissed with prod evidence (ALS/AbortSignal.timeout/process.env demonstrably execute — the mapped error codes prove the chain runs); remainder (Buffer, node:crypto, AbortSignal.any single-signal, getStripe default client, perf cross-clock) pre-existing and untouched. (3) Test-integrity: all 10 scripts exact-match source; guard wired (paths/quote-style/consumption verified). Acted on review: guard now also covers safe-remote-media and forbids redirect:follow. Re-ran guard + deadline + owner-outcome green; eslint still at HEAD baseline. No additional bugs or bystander issues; branch ready.

---

## 2026-09-14 - Workers redirect:manual fix across all 8 transports (PR)

Root cause (pinpointed, 4 legs) is Cloudflare Workers rejecting `redirect: "error"` with a pre-network TypeError; PR141 introduced the mode and Node suites accept it, so prod broke while tests stayed green. Fix is a pure mode swap to `redirect: "manual"` at all 8 sites (pipedream fetchJsonOnce, workerProviderFetch, Stripe SDK wrapper, Resend ×3, scanner, alert webhook): nothing is ever followed — 3xx/opaqueredirect falls into the existing non-ok fail-closed handling, preserving the credential-strip policy with no new error paths, union, or classify changes. Added a Bucket2 verifier guard asserting the forbidden mode absent on all six transport files. Updated 9 scripts asserting the old mode. Debugging lesson recorded: mock-fetch assert throws are swallowed by route try/catch and surface as downstream count mismatches (a missed 2-space-indented assert cost a full bisect: interleave A/B runs, probe don't guess). Verified: worker/pipedream-deadline, cron routes/transports/redirects, observability, notification lifetime, stripe refresh, public-booking, owner-outcome, bucket2-start, receipts/attachments/safe-media verifiers, calendar-lifetime + bucket3 aggregates, project tsc, scoped eslint at HEAD baseline, production build. No migration, cron activation, provider calls, or secrets.

---

## 2026-09-14 - Abort-vs-network flag on Connect-start codes

User's live code is `[pd-temporary 0/Pipedream authentication/network_error]`: machine-token POST to `https://api.pipedream.com/v1/oauth/token` got no HTTP response. Pipedream status is fully operational, so not a vendor outage. Excluded by the code itself: missing creds would be `[pd-platform .../invalid_configuration]`, bad creds a 401, exhausted budget `deadline_exceeded`, SQL failure revealed text/`[rpc-settle]`. Remaining mask: our own 10s abort rejects fetch with AbortError, which loses the race to the timeout rejection and wraps as `network_error` — a timeout and a network-layer failure (DNS/TLS/reset/egress) wear one code. This change adds optional `aborted` to `PipedreamError` (precedent: `dispatched`), set only in the `fetchJsonOnce` no-response wrap from `timedOut || signal.aborted || AbortError name`, and appends `/aborted=true|false` to the pd codes. Reason/retry classification untouched, so deadline/worker suites are unaffected (re-ran green). Owner-outcome contract gains an aborted=true case; Bucket2 verifier requires the flag. Project tsc clean; the two prettier warnings on pipedream.server.ts pre-date this at HEAD. No migration, behavior, cron, or provider change. Next: one live click — `aborted=true` means the 10s oauth wait fired, `false` means production egress to api.pipedream.com fails at the network layer.

---

## 2026-09-14 - Connect-start failure codes (diagnostic PR)

User re-clicked on production running latest main and still sees the bare fallback, so the live class is still undiscriminated (RCA: the fallback is a five-class sink; #149/#151 treated other paths, #150/#152/#153 narrowed but never diagnosed the live class). This change appends bracket machine codes without altering control flow: `[rpc-settle]` for collapsed settlement, `[pd-temporary status/operation/reason]` and `[pd-platform ...]` for provider classes (status/operation/reason are documented machine codes; bodies never cross), `[non-error typeof=]` for shape failures, `[client-non-error]` for a non-Error client catch (serialization-loss detector). User copy is otherwise byte-identical. Owner-outcome contract asserts the exact suffixed strings; Bucket2 start verifier requires the new codes. Focused suites, project tsc, and scoped eslint pass. No migration, behavior, cron, or provider change. Next: user clicks once and reports the bracket code.

---

## 2026-09-13 - Holistic vet of owner Connect redirect (PR153)

Vetted PR153 `10d0335` against the owner-redirect policy and cursor.md. The disease was one adapter serving worker settlement and owner redirect. The PR finishes the existing `revealOwnerFailure` / mutation-`attempts` knobs; it does not add a second flag, unwind reserve-before-redirect, unstamp, log, or change Check/Review/Save. `revealOwnerFailure` remains only on `startGoogleCalendarConnect`; every other `googleCalendarLifetimeRpc` still blank-catches. Owner abort still collapses on `AbortError`/`TimeoutError` only — not `code: ABORT_ERR`, which would re-collapse interactive 503 (`Database transport failed`) and restore the skip. Connect token POST is `{ attempts: 1 }` like other mutations; `pdFetch` now actually applies that budget to machine-token fetch (the comment already claimed this). Worker reads without `attempts` still retry (deadline suite still expects two oauth 503s on `listGoogleAccounts`). Cookie-first admin origin is already on main (#151), not this PR; this HAR was not Forbidden. Honest residuals that are not defects: real Pipedream outage still shows the fallback after one attempt; stamp-before-link plus 55P03 on a fast retry is the agreed reserve; abort still skips Google. `deletePipedreamTrigger` still defaults to three attempts — worker DELETE, not this owner-redirect class; left alone. Local calendar-lifetime aggregate passed. No code change from this vet.

---


Owner Connect still used worker settlement after the abort-budget change: `googleCalendarLifetimeRpc` blank-caught every throw (including interactive 503 transport) into `GoogleCalendarStateError`, and `createGoogleConnectLink` used `pdFetch`'s default 3 attempts so oauth/token 5xx retried ~2.6s then collapsed to the same fallback—never returning a Connect URL. `revealOwnerFailure` now rethrows non-abort errors (AbortError/TimeoutError still collapse; workers unchanged). Connect token minting is a one-shot mutation (`attempts: 1`), and `pdFetch` threads that attempt budget into machine-token fetch. Reserve-before-redirect, cookie, and abort-skip-Google are unchanged. No migration.

---

## 2026-09-13 - Owner Connect save is not worker 5s settlement

Owner `startGoogleCalendarConnect` reused `googleCalendarLifetimeRpc`'s worker `min(budget, 5_000)` abort, then skipped Pipedream. The save now aborts only with remaining handler time minus `REQUEST_TIMEOUT_MS` (10s for the Google link). Workers keep the 5s cap. `revealOwnerFailure` is still the only owner-start policy knob. Reserve-before-redirect and abort collapse are unchanged. No migration. Independent of the cookieless admin-origin PR.
## 2026-09-13 - Cookieless POSTs skip the admin origin guard

`getAdminSession` ran `assertAdminSameOriginMutation` on every POST before reading `obra_admin_session`. Preview and `www` contractors then failed Connect (and any other POST that checks impersonation) with `Forbidden: same-origin admin request required` even though they had no admin session. Cookie is read first; missing token returns null. A present admin cookie still requires `Origin === PUBLIC_APP_URL` and `sec-fetch-site: same-origin`. Login/sign-out/impersonate still call the guard directly. No www alias, no migration.

---

## 2026-09-13 - H3 start expects SQL Pro copy after owner reveal

CI `booking-safeupdate` on PR150 c37b31c failed `test-google-calendar-completion.mjs --sql`: H3 start still asserted `/could not be settled/` after SQL 42501 `Active confirmed Pro authority required` (grace expired after handler auth). That is the owner-reveal policy working; complete/save still collapse. The start assertion now expects the SQL sentence. No production handler change. Non-SQL completion suite still passes. Local postgres is not installed, so the SQL replay waits on CI.

---

## 2026-09-13 - Holistic vet of owner Google Connect start (PR150)

Vetted PR150 `c37b31c` against the agreed owner-redirect policy and cursor.md. Same helper, two policies: workers still collapse (no `revealOwnerFailure` at any other `googleCalendarLifetimeRpc` call in app/worker code); owner `startGoogleCalendarConnect` reveals PostgREST `error.message` and maps `PipedreamError` via `classifyPipedreamFailure` (platform vs fallback). Aborts stay collapsed (ownerFailure is set only from a returned RPC error, then thrown after the catch). Step 2 `startConnect` is the only Google catch changed; it matches Stripe `error.message` and still renders `{message}` on the card. TanStack server-fn path serializes thrown `Error` with seroval and rethrows `instanceof Error` on the client — same seam Stripe already uses. Connect / Reconnect / Connect to different account share `startConnect`. Check/Review/Save/complete, overview, cooldown disable, logging, and reserve-before-redirect were left alone on purpose. SQL 55P03 sentence is already in the lifetime migration; no new migration. Focused owner-outcome + Bucket2 start contracts re-passed on HEAD. No load-bearing defect found; no code change. Still unsettled: why the live click failed (55P03 vs later connect-link). CI not part of this vet.

---

## 2026-09-13 - Owner Google Connect start reveals SQL/provider outcomes

Implemented the agreed owner-redirect policy for `startGoogleCalendarConnect`. Workers still collapse PostgREST/abort into `GoogleCalendarStateError`. The owner start path passes `{ revealOwnerFailure: true }` so SQL `error.message` (including 55P03 "Google Connect was recently started; retry shortly") is thrown as an `Error`; aborts stay collapsed. Pipedream connect-link failures are classified: platform copy vs the existing fallback. Step 2 `startConnect` now shows `error.message` like Stripe. New unit contract covers worker collapse, owner 55P03, abort collapse, temporary/platform Pipedream mapping. Bucket2 start verifier requires the reveal flag, SQL sentence, and card catch. No migration, no overview catch, no cooldown disable, Check/Review/Save catches unchanged. This surfaces the opaque sentence; it does not prove why the live click failed.

---

## 2026-09-13 - source-contract 403 deadline flake fixed on PR149

CI `source-contract` on 5e56abb failed in `test-pipedream-deadline.mjs`: after a 401 with stalled diagnostics, leftover budget started a machine-token refresh, cleared `cachedToken` before a replacement existed, and the next 403 deploy was reported as auth `network_error`. Same leftover-budget class also let a caught timeout start another provider effect (DELETE / POST-then-GET). Restored the previous token when refresh fails; dispatch/settlement expiry now fences every Pipedream scope that shares that wall-clock deadline. Checkout-replay's DB mock now accepts `abortSignal` on optional Google reads so that suite can run after the deadline test. Node 22.14 and 24.20: pipedream-deadline and checkout-replay pass. No migration, no overview catch, no visual/browser work.

---

## 2026-09-13 - Owner-scoped calendar scheduling implemented and independently vetted

Replaced the never-applied cross-owner cron policy prerequisite with native owner-scoped scheduling on branch fix/owner-scoped-calendar-scheduling from 206674d. Migration 140 keeps pg_cron/pg_net/existing ledger and all Stripe/capture bodies; registration/activation/dispatch filter by definer owner; health reports scheduler_scope plus nullable recorder registry with shared-ledger response evidence. Recorder unknown omits the alarm without resolving prior state; owned inactive fires. Focused native-privilege/foreign-hidden/unknown-monitoring regressions, restored type contracts, and rollout docs updated. verify:types, tsc, worker SQL, observability monitor, and scoped lint pass. Three independent pre-commit reviews found no material findings. No applied migration edited, no deployment/cron activation, no hosted/browser operation. Migration 140 keeps its filename with a new checksum requiring fresh authorization/allowlist/dry-run/apply, then unchanged 150.

---

## 2026-09-13 - Final main sync includes newly merged PR147

PR147 merged during publication of the PR146 integration, moving main to ca13945. Merged its research-subject changes; only journal conflicted and both histories remain. Preserved website-scoped purchaser lookup plus lifetime readiness, new admin research navigation and nullable research/website job subjects. Independent overlap review found two incoming composite RPC type returns missing research_row_id/nullability; aligned them with background_jobs Row and added exact type-equality assertions. App/fixture types, schema parity (96 tables/148 migrations), contractor-research/template-lookup/retirement checks pass. No published migration was altered/applied. The known historical paid-expiry recovery P2 remains separate and open.

---

## 2026-09-13 - Main through PR146 integrated with both intents preserved

Fetched main530f3e5 and merged PRs144-146 into PR141. Six textual conflicts were resolved: availability editor, setup cards, admin home, observability, local SQL harness and journal. Preserved main's whole-hour notice/tooltips/zero-on-save buffers, workbench and unused HTTP retirement, AdminShell, and expanded Auth fixture; retained lifetime draft/revision/async guards, unknown readiness, calendar repair/observability and constrained loopback SQL authority. No old workbench or buffer controls were restored. Both journal histories and the prior local review notes are retained.

Code-only verification passed: app/fixture TypeScript, schema parity (94 tables/147 migrations), full booking/calendar/public/transport unit aggregate, retirement/enqueue/cancel/leads/Bucket2/Bucket3/pricing checks and production build. The new main confirmation-sync trigger exposed one fixture mismatch: clearing only email_confirmed_at restored it from confirmed_at. Corrected the qualified test UPDATE to clear both; final managed-safeupdate replay passed all eight SQL suites and actual monitor SQL/runtime passed 16 checkpoints. Independent integration review found no material issue in the six resolutions. The separately recorded historical paid-expiry discovery P2 remains open; this merge does not fix it. No deployed migration/provider/cron or browser/DOM/E2E operation occurred.

---

## 2026-09-12 - Post-push sanity vet and check-count correction

The user requested a vet of the latest implementation and an explanation of the previously stated 16/17 result. Verified PR141 remains OPEN/MERGEABLE at3778ef0 and current Actions run34695299728 has exactly seven jobs: six successful, browser availability-editor intentionally skipped, zero failed. The 16/17 statement was unsupported and explicitly corrected. Checks/Deployments API contexts are not readable with the available token; no external-context count or failure is inferred. The old TLS fixture failure was on cea35b9 and is fixed in the current successful run.

Three independent quick scopes reviewed the last correction and plan coverage. One P2 remains: shipped elapsed paid-expiry orphans have retained captured/refunded evidence but no arbitration/refund work, and the new repair only runs on a subsequent Stripe event. Actual local SQL and current workers with no extra event produced zero claims/provider calls and unchanged settling receipts; later webhook positive controls converged correctly. The existing upgrade test supplies that extra event and therefore missed autonomous discovery. Recorded the scoped result and required no-new-event regression in plan/pipedream_cron_pr141_review.md and linked it from the plan. No application, migration or test source changed, no commit/push, hosted provider/DB/cron or browser/DOM/E2E operation. All review-owned local fixtures were cleaned up.

---

## 2026-09-12 - Reviewed fixes integrated with PR143

After pre-commit independent closure, created 1959d14 for the H1-H7/recovery corrections. Merged latest main e9fcdf8 (#142 tree-identical resync and #143 template quality) without rewriting history. Only journal conflicted; both histories are retained. Independent integration vet confirmed all 70 non-overlap upstream files match main, the two supported molds retain both new overlay/review behavior and live booking guards, and package scripts preserve both sides. Application/fixture TypeScript, template parity, identity/research verifiers and the full public-booking aggregate pass after merge. No financial/lifecycle SQL changed during this sync. No browser/E2E or hosted operations; CI confirmation follows push.

---

## 2026-09-12 - Mandatory pre-commit holistic gate completed

Implemented H1-H7 and portable TLS fixture correction, then ran the required independent holistic review before any commit. The first review found remaining lost-intent OTP budget/health, historical financial/refund convergence, owner thrown-permission evidence, slow/fast maintenance fairness, mixed known/unknown retry, immutable checkout/definite rejection, disputed receipt and recurrent-incident/delivery handoffs. Corrected each through existing authorities with regressions, and independent targeted re-reviews confirmed closure. No review assertion was treated as proof without checking the actual shipped base or transition. The unshipped first-won compatibility claim was withdrawn on exact-base evidence; real shipped expiry/refund states were tested and recovered instead.

Final full code-only booking/calendar/public/transport unit aggregate, app/fixture types, schema contracts, normal+safeupdate SQL, 67 handler SQL scenarios, financial upgrade cases and scheduler/notification/monitor/role suites pass. Build passes. Changed runtime/test code is linted without rewriting generated/unrelated formatting. OTP uses proven send observation and same-fence budget-neutral deferral; Google has three independently scheduled classes with fair initial item shares and unused-share lending; current incident is separate from old frozen email review on the same JSON authority; checkout uses one shared schema and closed ready/not-attempted result with sticky prior uncertainty. Admin presentation shows current incident versus original delivery separately. No deployed migration/provider/cron, browser/visual/E2E, credentials or Git publication has occurred in this fix wave yet.

Main advanced to e9fcdf8 (PR143) during work; inspected overlap shows only journal/package and the two originally supported template molds. Commit the reviewed correction first, then preserve latest template changes with a non-rewriting merge and targeted integration vet before push. Five existing PR migrations remain unapplied and require renewed exact-checksum review/dry-run/apply after explicit merge/application authorization. Detailed historical findings and closure are in plan/pipedream_cron_pr141_review.md.

---

## 2026-09-12 - H1-H7 fixes in progress; explicit pre-commit holistic gate

The user authorized holistic fixes including CI, then explicitly required an independent holistic vet against cursor.md before creating any commit on PR141. The todo list now makes combined verification, independent cross-boundary review, resolution/retest of verified findings and evidence-backed closure prerequisites to any commit/push. No commit or push has been created in this fix pass.

H2-H7, scheduler throughput/fairness, retained availability drafts and portable local TLS fixtures are implemented locally with scoped regression evidence. H1 now threads an actual send observation through the existing Auth/worker fetch seam so known-unsent work settles through bounded retry, while dispatched missing/5xx responses remain ambiguous. The new actual-worker/SDK regression failed before the fix and passes afterward, including fence loss inside the SDK transport; a real-SQL retry/claim regression is added for integrated replay. Updated main at 8a9320f is a tree-identical field-note resync, not a new application/schema change. Combined tests and independent review are pending; scoped author passes are not a holistic all-clear. No browser/visual/E2E, hosted provider/DB/cron or credential operations occurred, and no migration was applied to a deployed database.

---

## 2026-09-12 - PR141 quick holistic code review finds remaining handoff defects

Reviewed fixed PR141 head cea35b9/base8354719 against pipedream_cron.md/cursor.md across five independent scopes, then adjudicated candidates with actual in-memory handlers/SDKs and narrow disposable SQL probes. Seven P2s remain: known-unsent OTP stranded as delivery_unknown; older Stripe events overwrite disputed payment projections (preexisting reducer residual); SQL rejects grace owners accepted by existing authorization; missing scope metadata becomes permission/OAuth advice; optional pending-setup RPC blocks overview despite known entitlement; cutover RPC error loses temporary retry presentation; narrow cron RLS hides a healthy foreign-owned response recorder. The dispute and recorder counterexamples were reproduced with actual SQL and cleanup verified. No runtime, migration or test source was changed.

Corrected earlier V1 reasoning: the naive fallback discarded entitlement, but that failed patch did not disprove the underlying known-entitlement/unknown-calendar isolation defect. Capacity at three scheduled checks/minute and Step 3 draft loss after completed gated disconnect were narrowed to conditional capacity/residual limits, not advertised as P1/routine-outage bugs. Added plan/pipedream_cron_pr141_review.md and linked it from plan/recheck. CI run34649390628 is failed at OpenSSL fixture generation in test-calendar-cron-redirects.mjs:45; preceding behavior/build/types and SQL/PG16/17 worker-role jobs passed, browser job skipped. Exact OpenSSL stderr was discarded, so the log does not establish a production redirect defect. No browser/visual/E2E, secrets, hosted provider/DB/cron, commit or push. Documentation/journals only; seven source corrections and CI repair remain before approval.

---

## 2026-09-12 - Full lifetime PR requested; current main checked

Final remote check found #140 newly merged at 8354719. Included it with a second clean merge, preserving its eight field-note/overlay files; application TypeScript, template-manifest parity and the full public-booking suite passed again. No additional source conflict or migration change.

Integration completed against ceeb2ea with a non-rewriting merge. Preserved #136-#139 lookup/auth/Step 1/registry/scroll/overlay changes and the new personalization migration. Resolved only the four actual conflict files; protected template implementations/media/catalog/generated routes match main. Adapted code-only registry/overlay fixtures, added dedicated Stripe-scope and Step 3 retry regressions, and included the full plan/audit records. CI runs the lifetime/SQL suites and defers the browser job for the explicitly code-only PR. Fresh build, application/fixture types, full booking/calendar/public/transport tests, upstream template/auth checks, pricing/security/leads/receipt contracts, normal+safeupdate SQL, actual-handler SQL and six local acceptance suites passed. Independent integration review found no material issue in its scope. Broad lint retains generated/unrelated baseline formatting failures; no broad cleanup was made. All local clusters stopped. No hosted migration/provider/cron operation or browser test occurred. Publishing the full branch for review is authorized; merging/applying/activation remains separate.

The user authorized a PR for the entire Pipedream lifetime/cron implementation, with current main checked first. Fetched origin/main at ceeb2ea, including PRs #136-#139 and the intervening personalization admission migration. No open PR has the same lifetime/cron intent; #140 is unrelated field-note work. Seven files overlap the existing implementation: journal, package scripts, purchaser overview, template-purchase functions, LP rendering, and the painter11/plumber molds. Preserve both the newer lookup/auth/Step 1 behavior and shared mold/scrolling/overlay contract while retaining bounded booking readiness and the previously supported booking callbacks. The five lifetime migration names do not collide with upstream; hosted application and scheduler activation remain unauthorized.

Checkpointing only authored lifetime source, migrations, tests and runbooks before a non-rewriting merge of main. Generated caches, temporary bundles and test results stay untracked. The shared checkout and its parallel painter work remain untouched. Integrated verification and the PR publication result will be recorded after completion; earlier passing checks are not fresh integrated evidence.

---

## 2026-09-11 - V1–V3 fixes applied, V1 reverted on R16 evidence

V2 fixed in src/lib/stripe-connect.server.ts: retrieveSavedAccount throws WorkerDeadlineError when workerCanContinue() is false, then builds the same per-call Stripe client with workerProviderFetch in-scope and plain fetch out-of-scope; redirect:error, per-request timeout/retry, dynamic stripe import preserved. Rejected an intermediate getStripe()-singleton form because test-stripe-connect-refresh failed (default transport lost redirect:error and timeout observability); final form passes. V3 fixed in src/components/purchaser/SetupStepCards.tsx: StepThreeCard tracks availabilityError + availabilityReload, renders failure copy with Retry schedule re-running getBookingSetup; editor/locking untouched. V1 implemented then fully reverted: try/catch fallback to unknownBookingReadiness broke the R16 page-isolation regression (overview must reject so prior forms persist) and would resolve false Starter/unconfirmed, hiding Pro setup — the R16 defect itself. Template-purchase.functions.ts net unchanged. Evidence: tsc/eslint/diff clean, calendar-transports pass, public-booking exit 0, bucket3-booking exit 0. No browser/E2E, provider/hosted DB/cron, staging/commits, migration apply. V2 fence-loss pre-check has no dedicated retrieve-level regression (pattern covered by boundedFetch hung-transport scenarios); noted as limit in the shared recheck doc.

---

## 2026-09-11 - Post-fix-wave holistic vet recorded, no app changes

Five independent code-only scopes vetted the current dirty worktree vs pipedream_cron.md/cursor.md with no application, migration or test edits. Lifecycle, financial, scheduler and most transport/UI checks: no new material findings. Three verified defects appended to shared plan/pipedream_cron_recheck.md: V1 High overview initial-load block on readiness throw (mirror jobs.functions unknown-readiness fallback in template-purchase DTO only); V2 Medium retrieveSavedAccount raw-fetch bypass of workerProviderFetch/fence (reuse fenced getStripe client + workerCanContinue); V3 Medium StepThreeCard error/loading conflation (add error flag + retry of existing read). Existing suite passes do not cover V1-V3. Concurrent-OAuth and orphan-probe races traced and judged non-material, no fix proposed. No browser/E2E, credentials, provider/hosted DB/cron, staging/commits, migration apply or parallel-work changes.

---

## 2026-09-11 - R1-R21 fix wave closed locally, code-only verified

All R1–R21 fixes implemented locally with existing authorities; final independent review's 2 P2s dispositioned on evidence (off-mode resume path is read-only STABLE RPC + Stripe retrieve + cookie; cron visibility is separately-approved bootstrap asserted by migration, not created by it). Code-only verification passed: unit suites, disposable SQL regular + safeupdate, types, tsc, diff-check, build. No browser/visual/E2E, provider/hosted DB/cron, staging/commits/deployment. Five new migrations remain local; release needs PR/merge, explicit auth, checksum dry-run/apply, target bootstrap verification, activation, provider entitlement, user E2E/soak.

---

## 2026-09-11 - Scheduling/observability recheck R8, R13, R14, R15

Implemented this owned slice in the isolated lifetime worktree. R8 restores bounded 25-item payment/refund invocation loops with their existing one-row claims, parallel lane opportunities, deadlines and family fences. R14 consumes the concurrently updated worker totals and all known lifecycle failure details, records partial failure/unsuccessful heartbeat, avoids double-counting and keeps missing/interrupted/skipped totals null. Worker/reducer/deadline source remains with its parallel owner.

R13 adds an uncapped allowlisted reason-to-count binding_failures JSON aggregate in unapplied migration 140 and threads it through Zod/evaluation/admin reports. Current account/revision/profile/environment matching and disabled/disconnect exclusions prevent retired-configuration incidents; idle success/future retry/fresh account evidence cannot clear a retained trigger failure. Real successful trigger projection resolves the same reason condition. No table columns or migration 150/action-notice behavior changed. R15 extends the separately approved bootstrap with one exact-eight-name permissive SELECT RLS policy for the migration-runner owner, no raw writes/BYPASSRLS/role membership/PUBLIC expansion. A private invoker preflight validates actual runner identity, object privileges, sole policy grantee/command/predicate and restrictive-policy interference using PostgreSQL-normalized expressions; inactive registration and explicit activation/deactivation controls remain.

Fresh local proof passed: real route/Stripe SDK ten-payment plus ten-refund drain (26 ms in the final scoped run), 25-item cap, empty/error/deadline/renewal cases, manual-repair positive counts, exact/unknown totals; constrained non-superuser scheduler SQL and runbook bootstrap with foreign-owner/other-environment collisions and policy drift; uncapped 120-tenant binding counts/exclusions; full schema plus existing Google/booking/notice SQL replay and actual monitor/admin/evaluator code including failure -> idle -> successful trigger recovery; nine hung-transport scenarios; focused lint/format and diff checks. All DB fixtures were ephemeral loopback with inert cron/net/Vault, and all provider transport was mocked. Full TypeScript still reports concurrently owned errors: LP bookingRetryAvailable return shape and booking-stripe-inbox-worker action narrowing; no scheduler/observability type error was reported. Earlier transient 130/Google-test blockers were resolved by their owners and the full monitor runner subsequently passed.

Handoff: get_calendar_worker_health still returns Json with required binding_failures (sparse finite-reason numeric counts), application report bindingFailures; add private assert_calendar_worker_cron_privileges(p_require_visibility?:boolean) returning void to generated function types. No Row/Insert/Update changes. Generated types are owned by primary integration. Runtime/bootstrap/140 SQL must deploy together only through reviewed Lovable/Supabase migration order and separately explicit privileged-bootstrap approval. No browser/visual/E2E, credential inspection, provider API/hosted DB/cron operation, stage or commit; public pg_cron source was read only to cross-check ownership semantics.

---

## 2026-09-11 - Fresh holistic current-code recheck, no all-clear

User requested a new holistic implementation vet against pipedream_cron.md/cursor.md after the private-INSERT fix. Reviewed the current complete dirty implementation and unchanged consumers with independent Google, financial/fulfillment, provider/shared-transport, scheduling/monitoring and UI scopes. The prior targeted private-INSERT fix held and is not re-reported; the broader integration still has material source gaps. Added shared `plan/pipedream_cron_recheck.md` with 21 severity-ranked findings, current references, evidence qualifications, introduced/preexisting distinctions, cross-layer root causes and release decision. Updated the plan and original closure report to link the new no-all-clear result without erasing earlier fix evidence.

Highest-priority verified failures: pending-setup reader SELECTs a disconnect ledger whose service-role table privilege is revoked; actual OAuth completion replaces pending B calendars with primary or old saved A; a valid pre-dispatch hold starts first payable Checkout in off mode; cancellation drops negative capability evidence from an already-dispatched write; Stripe auth failure leaves autonomous inbox/expiry recovery terminal after credentials recover; recurring-series changes are ignored by one-off matching and can be deleted as a whole; pre-dispatch deadline loss leaves an unsent deployment ambiguous; core payment/refund invocation limits throttle one item per minute. Other findings concern intra-lifecycle fairness, cancelled unresolved-destination repair, refund-pending copy after completion, Auth diagnostic rejection lost to body timeout, premature trigger-alert resolution, ignored lifecycle failure counts, RLS-hidden cron owner conflicts, duplicated entitlement fallbacks, booking errors aborting outer routes, inaccessible early-Connect retry, missing customer retry/error-versus-empty distinction, hidden independent calendar receipt failures and baseline Future/Past list state.

Evidence includes actual handlers/SDKs with mocked outbound transport and disposable PostgreSQL full-chain/effective-role probes. Service SELECT was explicitly tested as service_role (not booking_worker); RLS bypass does not bypass the revoked table grant. Cron foreign-owner collision remains conditional on stock-style owner RLS, not a claim about hosted jobs. Credential recovery is an automatic-servicing dead end, not irreversible money loss. Core burst proof processed one of ten payments in 9 ms, not a claim all finite backlogs starve. Trigger alert failure clears prematurely while account evidence is fresh, not proven blindness for its full hourly retry. UI findings in unchanged template-purchase/jobs/bookings/receipt consumers are labeled baseline residuals, some amplified by new polling, not all introduced regressions.

Fresh primary code-only unit aggregate and verify:types passed; reviewers also ran scoped suites and isolated regular SQL replay, yet the adversarial handoffs above fail. No visual/browser/DOM/E2E tests, no credentials, real provider calls, hosted database/cron/migration operations, staging, commits or source/test/migration edits. Only review documentation and journals changed. Prior safeupdate/build passes were not presented as newly rerun. Disposable review clusters were stopped/removed. Production-plan entitlement and user-run hosted acceptance remain separate from these source corrections.

---

## 2026-09-11 - Reopened private INSERT recovery implemented and vetted once

Implemented the user's explicitly requested leftover, not just audit wording. The cause mismatch was private setup INSERT denial sharing the attendee-bearing booking CREATE blocker. Added exactly two nullable evidence timestamps on existing calendar_connections (calendar_probe_insert_blocked_at / calendar_probe_insert_verified_at), kept aggregate readiness derived, and threaded the separate capability through existing denial, preservation, setup settlement and owner/background recovery. Successful private INSERT plus cleanup clears only private INSERT evidence; attendee CREATE and DELETE evidence remain independent. Each INSERT retry records its own dispatch start and invalidates older setup-write proof, preserving conservative overlap ordering and current account/calendar/revision/lease/disconnect checks. Changes are in the uncommitted, unapplied 120/130 migrations plus generated type shapes and tests; historical applied SQL is unchanged.

Red/green evidence: replaced the old Google test's blocker-survives/manual-reset sequence with actual same-configuration recovery assertions and ran it before the fix; private-insert-recovery-red.log contains the expected failure. Added a booking SQL regression with no preexisting booking: private failure blocks reserve_live_booking; owner request, worker claim, probe phases and configuration persistence restore actual reservation. A subsequent real paid booking CREATE denial survives private failure/recovery and clears only after its own successful effect, then new admission succeeds. No direct blocker clearing occurs in that regression or in the corrected private-recovery fixture. The broader SQL suite continues to test concurrency, stale fences, supersession, disconnect and evidence ordering.

Passed complete disposable SQL replay both regular and managed-safeupdate, full booking/calendar/provider/public/receipt/authorization/worker unit aggregate, Bucket2/Bucket3 verifiers, schema/RPC parity, application and fixture TypeScript, focused lint and diff checks. Logs private-insert-recovery-green.log and private-insert-recovery-safeupdate.log in the approved temporary directory retain completion evidence; safeupdate line17 verifies the extension was actually loaded. Ran exactly one independent post-implementation correctness vet for this fix: reviewer had no implementation role, inspected private-versus-attendee/delete provenance and current fences, reran regular SQL and network-disabled lifecycle tests, and found no material issue in the scoped change. This is not a new all-application zero-bug assertion.

Updated shared audit/plan status with this specific closure while preserving the earlier audit-process correction. No browser, visual, screenshot or E2E tests; no provider/hosted DB/cron calls, credentials, charging flags, staging, commits or deployment. User end-to-end testing and the mandatory reviewed Lovable/Supabase migration/activation process remain separate. The known Pipedream production entitlement restriction is unchanged.

---

## 2026-09-11 - Audit-of-audit reopens capability recovery

User asked to vet the closure audit itself. Checked the closure matrix against current source/tests and retained regular/managed-safeupdate completion logs, with an independent targeted evidence review. The statement that all 24 findings were closed is withdrawn: item 6 remains partial. A confirmed private setup INSERT denial sets calendar_create_blocked_at; a later successful private probe cannot clear it because setup recovery clears only DELETE evidence, and explicit verification only starts DELETE recovery. With no eligible attendee-bearing booking write or changed destination, restored permission cannot restore readiness. The existing regression at supabase/tests/google-calendar-lifetime.sql:622-643 expects the retained blocker, then directly resets it at line 644; it demonstrates conservative blocking, not the required same-cause recovery.

Root audit error was checking implementation and test agreement without checking whether that agreed terminal state met the original recovery contract. Final reviews were scoped and included author rechecks, not a wholly independent final-diff certification. The targeted cross-check supports the other examined qualifications (deployment-receipt provenance, explicit cron bootstrap privileges, evidence-dependent legacy repair, finite email replay window and independently configured monitoring), but is not another comprehensive zero-bug claim.

Corrected the shared plan/audit status and closure row, retained prior evidence as history, and removed the browser command from the current observability runbook verification list to match the user's restriction. No application/migration/test behavior changed, no new browser/visual/E2E or provider/DB operations, no credentials, no stage/commit/push. This pass did not rerun the full suites; retained passes remain valid only for their asserted scope. Required follow-up is capability/cause provenance that lets private success clear private failure without clearing an independent attendee denial, with real authorized recovery tests rather than fixture resets.

---

## 2026-09-11 - Final booking handoff corrections, code-only

Implemented the three final review findings in the isolated lifetime worktree. Appended effective expiry, contractor-cancellation and receipt-projection definitions to unapplied migration 20260910130000_booking_calendar_lifetime.sql; no historical migration, 133 notification authority, notification worker, provider adapter, admin repair or type signatures changed. Expired pre-handoff creating holds now release capacity under the appointment lock after their lease expires, preserving dispatch/payment evidence and fencing stale completions. Real owner cancellation during provisional arbitration persists deliberate intent and the existing refund obligation. Retained calendar links stay cancel_pending until exact absence readback, so an accepted CREATE cannot prematurely authorize event-removed mail. Provisional receipts use existing settling/terminal=false and the page changes only copy/poll predicates.

Permanent SQL regressions exercise claim interruption, live/expired leases, partial/full dispatch markers, cross-environment exclusion, second-backend appointment-lock contention, reuse of freed capacity, late paid evidence through the sole reducer, the real owner cancellation RPC and replay, signed pending/completed refunds, issued/consumed receipts, and audited legacy repair through CREATE acceptance, cancellation, DELETE and absence-gated notification authorization. Added pure-function receipt status tests without loading React, a DOM or any browser. Aligned one checkout mock projection with the concurrent readiness owner's added setup fields; no readiness runtime change.

Passed full regular isolated PostgreSQL 17 migration replay and all SQL suites, 13 receipt/checkout/status scenarios, 10 checkout replay scenarios, booking worker mock suite, full strict TypeScript, Supabase schema/contract checks, focused lint and diff checks. No browser, visual, E2E, hosted DB/provider, secrets, cron activation, staging or commit operations. Migration remains local/unapplied and requires the normal reviewed Lovable/Supabase rollout with explicit deployment authorization.

---

## 2026-09-11 - All lifetime audit corrections and final code review closed locally

Completed the user's request to fix all 24 items in the shared `plan/pipedream_cron_review.md`, following cursor.md and the explicit additional requirement for holistic review before completion. Corrections remain in isolated `fix/pipedream-lifetime-connection` based on 7c1eb41; no commits, staging, push, PR, hosted database/provider operations or schedule activation were performed. Applied historical migrations were not edited. Five new unapplied migrations now cover Google lifecycle, booking/calendar authority, notification lifetime, scheduling/health, and action-required notices. Only painter11/plumber booking integration was changed under the all-findings request; designs, other templates, media, catalog and generated route source remain untouched.

Closed the full handoffs rather than badge/timer symptoms: owner setup through saved configuration, browser-correlated Connect and explicit disconnect, pinned trigger deployment response through durable provenance, scoped read/write capability evidence, pre-Checkout immutable destinations, persisted Checkout continuation and receipt nonce identity, cancellation/refund/late-payment intent, content/ETag-verified event convergence, bounded and replay-window-safe notification delivery, current-revision UI editors, actual supported-template live callbacks, and real calendar monitor/admin/action-email integration. The final trigger solution uses documented pinned deploy request plus successful returned component/resource identity captured under the exact dispatch fence, not the removed unavailable metadata-lookup shim or an invented mandatory Connect definition ID.

Independent code-level holistic reviews exposed additional boundary cases; all were corrected and re-reviewed: expired held/creating reservations before handoff, real owner cancellation during provisional arbitration, provisional receipt status, cancellation waiting for true event absence, authoritative notification suppression/review not blocking unrelated queue work, missing pending-setup remediation, current-destination probe denials missing readiness blockers, stale-revision cleanup dropping ownership, actionable setup permission checks misclassified temporary, and unobserved same-revision pending-editor changes. Material saved and pending configuration identities are now both fenced; setup denial evidence survives disconnected authorization state without clearing reauthorization. Final scoped reviewer conclusions reported no remaining known material source defect in reviewed paths; they do not guarantee absence of all bugs.

Final passing code verification: full booking/calendar/provider/authorization/public/receipt unit aggregate, including 38 public/receipt scenario groups and pending-setup code-only controls; provider provenance/404/ETag/deadline tests; nine hung real-route/SDK transport cases and loopback libcurl auth stripping; actual SQL-backed notification and monitor/owner-notice integration; full regular and managed-safeupdate PostgreSQL 15 replay with constrained application/extension owners, exact ACL equality, concurrency and all five migration suites; application plus payment-fixture TypeScript; Supabase schema/RPC parity (94 tables, 144 migrations); foundation/Bucket2/Bucket3/leads/money/notification/admin verifiers; focused lint/format, diff checks and Cloudflare production build. An integration-only monitoring fixture initially lacked the newly required DELETE dispatch timestamp; corrected fixture and rerun passed. Updated stale source-check/mocked-Zod expectations without weakening runtime invariants.

User explicitly prohibited further visual, browser or E2E tests and reserved end-to-end testing for later. No such tests were run after that restriction. Earlier browser runs predate it and are not final acceptance of the corrected revision. Current checks are source/type/build, in-memory mocked application/SDK tests, loopback transport and disposable SQL only; test scripts containing optional browser branches were run without enabling them.

Updated shared plan/audit with the full 24-item closure matrix and code-versus-deployment boundary; retained original findings as history. Remaining release work is review/merge, explicit authorization and exact-checksum dry-run/apply for all five new migrations, approved narrow cron privilege bootstrap, independent monitor/notice/worker configuration and activation, required provider capability and user-run hosted end-to-end/soak/capacity acceptance. The separate Pipedream production Connect entitlement denial is unaffected: no subscription/scope/environment workaround or architectural switch is included. Provider ambiguity without attributable evidence remains visible and fail-closed; local success does not establish live invitation/email receipt.

---

## 2026-09-11 - Audit 13 calendar evaluator and unattended action delivery

Implemented only in the isolated obra-pipedream-lifetime worktree, after reading the shared audit finding 13 and cursor agreement. New calendar-observability.server.ts consumes the actual 140 health RPC plus minimal action/setup health, evaluates 180-second dispatch/completion, 120-second overdue/lease/notification, 900-second freshness and 300-second paid-fulfillment conditions, and emits environment-scoped calendar firing/resolved keys through a bounded HTTPS/redirect-rejecting adapter. Missing, malformed or truncated evidence is unknown, not a false resolution. The existing protected generation monitor runs generation and calendar independently, preserves generation-only behavior without calendar opt-in and reports calendar failures without starving generation. The existing admin observability server/dashboard displays safe schedule, obligation and action-review states through existing admin middleware; it is read-only and does not send.

New migration 20260910150000_calendar_action_notifications.sql adds exactly five connection columns: action_notice JSONB, action_notice_due_at, action_notice_lease_token, action_notice_lease_expires_at and action_notice_fencing_token. Three service-only RPCs are claim_calendar_action_notice, transition_calendar_action_notice and get_calendar_action_notice_health. Private connection projection/guard/scope functions capture recovery between monitor polls, freeze immutable saved/setup choices and cause episodes, respect exact disconnect authority, and deny raw service notice-field writes. No fake appointments, booking notification coupling, queue/table, credential store or scheduler is added. Verified profile/auth email is the sole recipient; external_user_id/account_email never is. Confirmed consent/access/selection conditions produce specific login/action copy without owner traffic; temporary/platform failures and superseded probe cleanup do not invent OAuth revocation. Targeted write recovery does not duplicate the same saved permission incident.

Preauthorization freezes recipient/payload and a stable environment/connection/incident Resend key before sending. SQL grants at most ten seconds bounded by a 55-second fence/lease and first-dispatch plus 24 hours; the caller subtracts authorization round-trip time. Known acceptance retries only DB settlement, including committed-response loss and recovery after dispatch. Unresolved effects cannot be erased by reconfiguration or replayed after the provider window; they remain admin-visible review and block another automatic notice on that connection. Freshly recurring recovered episodes may send again. Added own runbook and relevant disabled/empty .env.example names; no live values touched.

Passed locally: scripts/test-calendar-observability.mjs (full actual migration replay with constrained owner; actual SQL roles/raw-write guard, concurrency, stale config/fence, partial-write, recurrence/publish idempotency, setup choices, recipient, recovery, 48-hour review; actual monitor/admin using real SQL and mocked outbound provider including 24-hour key retention; generation independence/auth/config failures; threshold resolution and bounded stalled HTTP); existing Google, booking-calendar and booking-notification lifetime SQL suites with the trigger installed; scripts/test-calendar-observability-browser.mjs (actual dashboard on loopback Chrome at 1440/390/320px, review-to-unknown refresh, independent generation and no page overflow); strict full TypeScript, focused ESLint/Prettier, verify:types against the type owner's integrated contracts, generation observability verifier/alert tests, and diff checks. No production build, hosted provider acceptance, independent caller/destination configuration or soak is claimed.

No edits to primary Google/booking/notification/scheduler migrations or provider/booking runtime, purchased templates, generated types, package or shared harness. Existing concurrent changes were preserved. No staging, commit, push, credentials inspection, hosted database/provider operation or real cron activation. Migration remains code/local-only and needs the normal reviewed Lovable/Supabase rollout and explicit authorization; an independent monitor caller and real alert/email acceptance remain deployment work.

---

## 2026-09-10 - Holistic lifetime audit rejects release readiness

User requested a holistic correctness, missing-piece, edge-case and bystander review against `cursor.md` and the full lifetime plan. Reviewed the complete dirty implementation against 7c1eb41 with independent non-overlapping Google authority, booking/money/delivery, provider/shared transport, scheduling/Stripe, and public/purchaser audits. No application, migration or test source was changed. Added the consolidated review to the shared workspace at `plan/pipedream_cron_review.md` and corrected that plan's completion status. The earlier core-complete conclusion was too broad.

The report records 24 grouped findings, distinguishing introduced regressions, preexisting in-scope defects, missing implementation and conditional contract/privilege risks. Release blockers include: pending refund evidence reversing a contractor cancellation; incompatible checkout/return nonce hashes; a new Pipedream mutation after shared continuation-fence loss; polled account B paired with cached editor actions on account A; setup completion/supersession dead ends; incomplete operation-specific write-blocker recovery; inaccessible-calendar 404 interpreted as cancellation; required trigger identity absent from the documented Connect response; known rejection status lost to diagnostic timeout; non-resumable pre-dispatch Checkout holds; false cancellation-related confirmation emails; demo-only CTAs on both wired purchased templates; unwired calendar alerts/action notices; and constrained cron-owner privileges not established by current stubs. Further findings cover in-flight reconfiguration attribution, overbroad Connect exclusion, stale failed-refresh displays, fresh-path cutover/environment bypass before provider reads, missing unresolved-destination repair, notification idempotency retention, conditional DELETEs, notification throughput and inaccurate health projections.

Evidence: actual runtime mocks and loopback Chrome for user/transport cases; disposable PostgreSQL state transitions and complete regular migration replay for money/calendar cases; official Pipedream, Google and Resend contracts. A separate overlapping-claims SQL precedence issue is qualified because ordinary current-worker concurrency reachability was not established. Documented trigger shape and stock-equivalent pg_cron ACL failures are conditional, not observed hosted failures. Existing five previously fixed integration issues were not simply reported again.

Fresh `pnpm test:unit:bucket3-booking` including calendar/public/receipt/transport suites and `pnpm verify:types` passed; reviewers also reran focused suites and isolated regular SQL replay. Temporary adversarial probes still reproduced the gaps. Full prior browser/build/managed-safeupdate acceptance was not rerun in this review; those earlier passes do not invalidate the new findings. Temporary databases were stopped; no credentials inspected or live provider/hosted database/cron operations performed. No staging, commits, push, deployment, template edits, or parallel-work reversion. Source corrections and missing alert/template integration must precede another release-readiness claim and any approved migration rollout.

---

## 2026-09-10 - Lifetime calendar implementation completed locally

Sanity-vetted `plan/pipedream_cron.md` under `cursor.md`; no blocking design issue remained. Implemented in isolated `fix/pipedream-lifetime-connection` from current main 7c1eb41. Shared branch files/staging and concurrent painter/template work were not used or modified. The only public LP edit changes the shared server readiness loader; template layouts, overlays, catalog, media and generated routes are unchanged.

Saved authorization now has non-destructive health transitions, tenant/revision-scoped read-only refresh, full account/calendar pagination, real pinned component-ID verification, durable trigger deployment/retirement and explicit-disconnect recovery. Temporary failures stay scheduled beyond eight attempts; permission/write blockers are not cleared by unrelated reads. Stable private capability probes recover interrupted cleanup without asserting unearned write success. Pipedream and shared worker transports bound token acquisition, retry, response-body reads and settlement using request-local deadlines, including existing Stripe/Supabase/notification/OTP/scanner transport seams without changing their authority.

Booking reservation binds its immutable destination before Checkout. Financial projection no longer depends on today's mutable selection, and unbound historical checkouts preserve paid truth with explicit unresolved-destination review. Paid event recovery retains original epochs, respects disconnect intent, verifies event contents and compensates cancellation races. Public projection/slots/new-checkout share bounded rate-limited provider refresh; authorized existing-checkout replay can recover during current readiness loss without admitting new work. Receipt validation accepts the new review state. Purchaser cards distinguish durable setup from operational freshness, retain saved forms, and use scoped display-only refresh instead of false reconnect prompts.

Three forward-only local migrations implement lifecycle, booking and scheduling authority. Cron supports stock pg_net with exact environment/path/body identity and canonical https://obratech.co, not the observed redirecting Lovable alias. Registration leaves jobs inactive; migration application itself neither registers nor dispatches them. Existing request/response and worker ledgers expose meaningful health, not merely HTTP 200. The runbook records actual supported transport assumptions, budgets and mandatory migration/activation sequence.

Independent review found and fixed five concrete integration defects: Google write denials missing readiness feedback; retained destinations unable to resume permission recovery after reselection; provably unsent/rejected deployments stuck ambiguous; wrong-version created IDs losing cleanup ownership; and deleted-probe 410 causing endless retry. Regression tests and targeted re-review confirm resolution. Also aligned stale source-presence tests with current reducer/outbox authority rather than weakening their invariants, and corrected a safeupdate-rejected backfill.

Passed: complete booking/calendar unit suites, 19 public-booking/receipt cases, 79 Chrome browser tests, nine real-route/SDK hung-transport cases, libcurl loopback redirect-auth tests, full disposable PostgreSQL 15 replay both regular and managed-safeupdate with all three new lifecycle SQL suites/concurrency/ACL assertions, worker-role migration test, foundation/Bucket2/Bucket3/leads/static/type checks, focused lint/format, diff check and Cloudflare production build. Provider/DB HTTP boundaries are mocked for runtime tests; SQL uses disposable local databases with inert platform stubs. These are not hosted end-to-end or 24-hour soak results.

Not deployed: migrations remain local, schedules unregistered/inactive, no provider accounts/events or credentials touched, no charging flags enabled, no commit/push/PR. Remaining operational acceptance includes approved migration/deployment, provider response smoke, hosted scheduler/capacity/soak, independent alert evaluator/destination and contractor action-required notification delivery, plus supported purchased-template live-booking acceptance outside protected template changes. Never present local health inspection or tests as those operational guarantees.

---

## 2026-09-12 - Vet of the claim/View/CSV follow-up (no code change)

The three follow-up fixes on PR #147 are the right shape. No further edit.

Claim: the live dispatcher (20260829190000) still inner-joined `websites`. The replacement is that function with only a left join and “row or website exists.” Purchaser jobs with a site still claim; orphaned `website_id` still does not. Admin Start can leave pending and actually run.

View: unmatched hits were already on the dossier; the popup now shows them. Existing website / Social pages are the plan’s headings on data already scraped.

CSV: “already uploaded” is row count, not filename. A failed insert leaves the empty upload control so the admin can retry. No new upload RPC.

Migration still local. Do **not** apply until merge **and** explicit Lovable confirmation.

---



Holistic vet of PR #147 against the plan and `cursor.md`. Three load-bearing gaps, not nits:

1. **Start would never run.** `claim_next_background_job` inner-joined `websites`. Admin jobs have `website_id` null. Same unapplied migration now left-joins and requires `research_row_id` or a website row. Purchaser claim path unchanged.
2. **View omitted unmatched hits.** Dossier already built them; the popup now lists them. Existing website / Social pages are separate headings with the same classifier copy.
3. **Failed CSV insert stuck the tab.** Guard is “this tab already has rows,” not “filename was set.” Empty tab can retry the upload.

Photos stay `<img>`. Shared extract still has `facebook_url` / `instagram_url`. No fake websites. No Start-all. Migration still local — do **not** apply until merge **and** explicit Lovable confirmation.

---

## 2026-09-12 - Implement admin Contractor Research (shared Firecrawl subject)

Admins on `/admin` get **Contractor Research**. Each CSV upload is a durable tab. The grid is the CSLB columns as uploaded, plus **Research** (Start → loader → View) and **Comments**. Photos in View are `<img>` tags, not URL text.

Root cause: enrichment jobs were website-shaped (`background_jobs.website_id` NOT NULL). The scrape was already identity-shaped. Jobs now belong to a subject — purchaser website or admin sheet row — so Start does not mint websites. Merge/finalize for a row writes only that row. Purchaser Get my information still merge/persist/fit as before.

Shared extract now asks for `facebook_url` / `instagram_url`. `buildResearchDossier.social` is that list for View and the purchaser enrichment summary. No 14th platform.

Migration `supabase/migrations/20260912220000_contractor_research_sheets.sql` is in the PR only. Do **not** apply until this PR is merged **and** you explicitly confirm Lovable apply.

No Start-all. Residual: 72 Starts share the one-job-per-minute runner with live Get my information.

---

## 2026-09-12 - Plan: admin Contractor Research (CSV + same Firecrawl chain)

PRD in `plans/contractor-research.md`. Main after PR #145. CSLB export: disclaimer preamble, then 72 rows (`BusinessName`, `Address`, `City`, `State`, `ZipCode`, `License`, `PhoneNumber`). No trade column.

Prior: do not mint websites per row (that is retired kickoff). Enrichment jobs today require `website_id`; generalize the subject so purchaser sites and admin rows share `enqueueEnrichmentChain` / `scrapePlatformContext` / `buildResearchDossier`. Admin Start does not personalize a template. Website/social is a dossier section on data already scraped (Facebook/Instagram + listed website), not a 14th platform. Tabs/comments persist. No Start-all (one job/minute runner). No migration applied.

---

## 2026-09-12 - Widen booking-safeupdate auth stub for GoTrue seeds (PR #146)

`booking-safeupdate` was failing on `main` and this PR because the disposable replay stub's `auth.users` lacked GoTrue columns. The hardcoded-admin seed migrations insert `instance_id` / `email_confirmed_at` / related fields; hosted Auth has those, the stub did not. This is a harness mismatch, not a bad production migration.

Did not rewrite the published seed SQL. Did not skip those files (they also install `mint_fixed_admin_session_v1`). The bucket3 stub now accepts that insert shape and keeps `confirmed_at` aligned with `email_confirmed_at` so existing tests and the mint function still see a confirmed user. Projection verifier locks the stub and keeps those seeds in the replay.

Verified: `verify-combined-migration-projection`, then `scripts/test-db-bucket3-local.sh` on PostgreSQL 15 with CI's pg-safeupdate revision. No production SQL. Catalog `/templates` and `/user` unchanged.

---

## 2026-09-12 - Remove unused enqueueEnrichment HTTP wrapper

PR #145 merged before this could land on it, so this is a new branch from current `main`.

`enqueueEnrichment` was a TanStack server fn with no UI caller. Purchaser Step 1 still starts lookup through `runTemplatePersonalization` → `enqueueEnrichmentChain`. The generator still uses that helper. `getWorkspaceBootstrap` / `getJobProgress` stay. No SQL.

---

## 2026-09-12 - Re-vet leftover cleanup + /admin left nav vs previous prompt (PR #145)

Vet only. No code change. Same open PR #145 on `cursor/retire-workspace-admin-b458`.

Previous prompt had two parts: (1) delete the named unused start/stop substrate (`enqueueSiteGenerationChain`, `apply-config-patch`, `drain-site-generation`, add-video/cancel server fns) while keeping in-flight workers/execute/SQL/enrichment/purchaser bootstrap; (2) same PR, authenticated `/admin` gets a collapsible left nav (Home, Agent traces, Observability, Log out), Home = Records then auth, other options keep working, login unchanged.

Part 1 matches. App `src/` has none of those names. The named files are gone. `enqueueEnrichmentChain`, `executeSiteGenerationJob` / `executeAddVideoJob`, `add-video-worker.server.ts`, `apply-template-patch.server.ts`, `getWorkspaceBootstrap`, `getJobProgress`, and `UNIFIED_SITE_AGENT_DEFAULT = false` remain. `verify-workbench-retired` passed. Unused HTTP still present but **not named** in that cleanup: `enqueueEnrichment` createServerFn (live path uses the chain helper) and unmounted `useJobProgress`. Treating those as the next deprecation would be a treadmill.

Part 2 matches the product outcome, not a sidebar that only exists on `/admin` then vanishes. `AdminShell` wraps Home, traces, and observability. Login stays full-screen. Sidebar Log out is this-session `adminLogout`; the Home card still signs out every admin session. Wrapping all three routes is the general case of “those options work as-is.” Collapse uses the existing shadcn sidebar (`collapsible="icon"`, trigger, rail). Each route remounts `SidebarProvider`, so a collapsed panel expands again after a nav click; the primitive writes a cookie it never reads. That is not what the prompt asked to change.

The `legal-documents.server` lazy import is extra vs the nav prompt. It was the failing Vite trace (`node:crypto` pulled into the client via the root checkout-availability loader). `checkout.functions.ts` still statically imports profile/stripe server modules from `__root`. Do not split that barrel unless it actually breaks again.

Not claimed: signed-in sidebar clicks, collapse, mobile sheet. This environment has no Supabase URL/service role, so admin login cannot complete. No SQL.

---

## 2026-09-12 - Admin SaaS left nav + leftover-cleanup vet (PR #145)

Vet of the unused-substrate cleanup against the previous prompt: the named start/stop surfaces are gone. App TS no longer calls `enqueueSiteGenerationChain`, `apply-config-patch`, `drain-site-generation`, or the add-video/cancel server fns. Enrichment enqueue, job execute, add-video worker, and SQL RPCs remain. Generation flag stays false. Purchaser `/user` still uses `getWorkspaceBootstrap` / `getJobProgress`. Remaining unused (not named in that cleanup): `enqueueEnrichment` createServerFn and unmounted `useJobProgress`. SQL generation/add-video RPCs stay callable by service_role so already-queued rows can finish.

This turn also puts a collapsible left nav on authenticated `/admin`, `/admin/traces`, and `/admin/observability`. Home is Records + admin auth. Agent traces, Observability, and Log out keep their existing behavior, now from the same chrome so the layout does not disappear after a click. Login stays full-screen. No SQL.

Browser smoke of that nav was blocked until `checkout.functions.ts` stopped statically importing `legal-documents.server` (`node:crypto`) into the client via the root checkout-availability loader. Legal evidence is now loaded only inside the server checkout handlers. After that fix, `/admin` served the login form. Authenticated sidebar clicks were not smoked here: this environment has no Supabase URL/service role, so admin sign-in cannot complete.

---

## 2026-09-12 - Delete unused generation start/stop substrate (PR #145)

Same branch/PR as workspace retirement. The leftover was unused HTTP and helpers, not Kickoff by another name: nothing in the UI called `enqueueSiteGenerationChain`, `apply-config-patch`, `drain-site-generation`, or the add-video/cancel server fns. Those start/stop surfaces could still be invoked by crafting a request.

This turn deletes that substrate. Purchaser Step 1 still enqueues enrichment. In-flight `site_generation` and `add_video` rows still run through job execute and the add-video worker. SQL RPCs stay. `UNIFIED_SITE_AGENT_DEFAULT` stays false. Edit-mode still patches through `apply-template-patch`. No new SQL.

Removed: `enqueueSiteGenerationChain` / cancel-generation / cancel-workspace helpers, `apply-config-patch.server.ts`, `drain-site-generation.server.ts`, chat-owned claim, and the unused add-video/cancel TanStack server fns. Verifiers that required those files now assert they are gone and keep worker/purchaser/execute checks.

`pnpm exec tsc --noEmit` and ESLint on touched TS passed. Rewritten enqueue/drain/add-video/config-patch verifiers passed, plus `verify:video-cta`, job-liveness, gacha, generation-mode-gate, staged-generation, purchaser bootstrap (`getWorkspaceBootstrap`). No local app server, and this turn has no new UI, so `/admin` was not smoked in a browser.

---

## 2026-09-12 - Vet of workspace retirement (PR #145)

Holistic vet against the retire-workspace-admin plan and cursor.md, on `cursor/retire-workspace-admin-b458` (`bc888f4`), not the calendar or overlay branches.

The architectural prior holds: catalog purchase still lands on `/user` `PurchaserOverview`; `/admin` no longer starts a custom site. Kickoff, simulate, and the generation toggle are gone from both the page and their backends. The agent HTTP door accepts only `personalize_template`. Edit-mode still publishes and uploads through `approveWebsiteVersion` / `uploadSiteMedia`. `/lp` still classifies `generator: "unified-site-agent"`. The generation flag default is still false; execute still does not re-read it for queued jobs. No SQL. Purchaser “not WorkspaceShell” checks are intact.

Leftover modules (`apply-config-patch`, `drain-site-generation`, unused `enqueueSiteGenerationChain`, add-video/cancel server fns with no UI) are unused substrate, not a second start button. The rewritten add-video verifier still requires those job fns because the worker for already-queued rows stays. That matches the plan’s keep of execute/generator, not a hidden kickoff. Stale `/lp` “Regenerate it” copy on incomplete unified drafts is pre-existing and out of copy scope. No local server, so `/admin` was not smoked in a browser.

No code change this turn.

---

## 2026-09-12 - Retire workspace product from /admin

The live buyer path is catalog `/templates/*` → Stripe → OTP → `/user` (`PurchaserOverview`). Kickoff, simulate-subscription, and the unified-generation toggle on `/admin` were leftover start buttons for a workbench that `/user` no longer mounts. Hiding the cards would have left the functions, chat intents, and generate-on-chat tools callable.

This turn removes both the buttons and the start paths: no `adminKickoff`, no `simulatePostCheckout`, no generation-flag write, no workbench UI, no workbench-only server fns, and the agent HTTP door accepts only `personalize_template`. `UNIFIED_SITE_AGENT_DEFAULT` stays false; in-flight jobs still honor payload `generationMode`, and existing `/lp` unified sites still render. Purchaser overlay, edit-mode, checkout, OTP, Records, and “Open workspace” (into `/user`) are unchanged. No SQL.

Verifiers now assert the old screen is gone instead of locking `WorkspaceShell`. `pnpm exec tsc --noEmit` passed. No local app server was up, so `/admin` layout was not smoked in a browser.

## 2026-09-12 - Delete unused PlanPurchaseDialog; leave leftover buffers

Nobody had set buffers, so stored pads stay as they are — no zeroing migration. Unused `PlanPurchaseDialog` is deleted; live checkout is the template popup (`DemoLpChrome`). Pricing verify now treats that popup as the checkout surface.

The demo license gate is a different screen (preview unlock), not template checkout. Left as-is.

No SQL migration. Still PR #144.

Verification: `pnpm verify:production-pricing`. No browser tests.

---

## 2026-09-12 - Holistic vet of hours, field help, legal back, save copy

The four asks were implemented on the right surfaces. One hole in the legal fix: swapping into the same purchase popup made the dialog X, Escape, and overlay close checkout and wipe the form. Nested legal used to only close the agreement. Close while reading legal now goes back to the form, same as Go back.

Hours stay minutes in the RPC. i-copy is end-user. Save copy is persistent by the button. No migration.

Verification: `node scripts/test-booking-availability-save.mjs` (44 passed). No browser or visual tests.

---

## 2026-09-12 - Availability hours, field help, legal back, live-site save copy

Buyers set minimum notice in hours (still stored as minutes). Each availability field has an i-button that explains it in plain language. Template/plan purchase no longer stacks a second legal dialog (that freeze is why the agreement could not scroll); the same popup shows the documents with Go back. After save, copy says the live website updates and they can change it here anytime. No migration.

Verification this turn: `node scripts/test-booking-availability-save.mjs` (44 passed). No browser or visual tests.

---

## 2026-09-12 - Vet of the license-only name/rating patch

Last turn gated listing names and stars, then stopped. That was a field list, not the prior.

License-in-URL on Google/Yelp is still not this contractor’s listing. A Hope Pinc Google hit that only matched the license could still write their phone, address, and website into schema, onto the generated site, into dossier identity, and into the platform card Step 1 reads — and could mark their site as the listed website. Same mismatch as the quotes. Name-matched listings (or a CSLB license record) may supply those facts. Admin still sees the mismatched Google name so they can tell the scrape was wrong; the personalize agent does not. Photos stay on `hitMatchesContractor` as the plan specified.

The photo-dialog revision copy from last turn is the plan’s existing message. No change.

No SQL migration. Still PR #143.

---

## 2026-09-12 - Holistic vet: reputation still leaked on license-only hits

The overlay contract (stills, copy-fit, purchased review lists, replace dialog) held up. The identity gate did not.

Schema merge already skipped quotes and star fields without a name match, but a license-in-URL Google/Houzz hit with someone else’s `business_name` could still write `google_name` / `yelp_name`, put that listing’s stars on generated-site trust badges, and show the rating on the research dossier card the personalize agent reads. Same class as Hope Pinc quotes: license-in-URL is not this business’s reputation. Name match now gates listing names, trust-marker ratings, and dossier card ratings. CSLB identity/contact fields are unchanged. Edit-mode revision conflicts in the photo dialog now reuse the existing “Updated underneath you” copy instead of the raw CAS error.

No SQL migration. Still PR #143.

Verification this turn: `pnpm verify:enrichment-identity-gate`, `pnpm verify:research-dossier`, plus parity/eslint/tsc after the patch.

---

## 2026-09-12 - Overlay media completeness and identity-gate rewrite

Holistic vet of the purchased-template overlay plan found three load-bearing gaps, not polish.

Replaceable stills that the page already showed were still hardcoded (service bands, process strips, study photos, painter8 intro pair, and similar). Those are now `media.*` slots with `data-tkey` on the img/poster. Locked list stays hero motion and matched before/after (plus painter18 wallpaper peel). Catalog `/templates/*` is unchanged: empty overlay keeps template art. Parity now fails if a replaceable `IMAGE.*` src bypasses overlay.

License-in-URL hits could still write ratings as this business. Ratings and review counts now require `namesMatchContractor`, same extra gate as quotes. Merge rebuilds schema and images from gated platform blobs so a re-crawl actually drops Hope Pinc rows instead of first-empty-wins keeping them. Read path was already rebuilt; write path matches it. Empty uploads are rejected. Painter8’s review photo counts as a review section so personalize can fill matched quotes there.

No SQL migration. No second PR — this is #143.

Verification: `pnpm verify:template-manifest-parity`, `pnpm verify:enrichment-identity-gate`, `pnpm verify:research-dossier`, focused ESLint, `tsc --noEmit`. Catalog routes `/templates/painter8`, `/templates/painter10`, `/templates/painter5`, `/templates/painter11`, `/templates/painter17`, `/templates/painter18`, `/templates/plumber`, `/templates/painter` return 200. Edit-mode Replace→Save was not re-run (no signed-in purchaser draft).

---

## 2026-09-12 - Availability step no longer exposes booking buffers

Step 3 on `/user` let buyers set Buffer before/after minutes. Those fields are gone. Saves still send the existing RPC shape, with both buffers forced to 0, so leftover stored values cannot round-trip from the editor. Slot math, appointment overlap, and the DB columns stay — they keep working at 0. No migration.

cursor.md vet: this is a product-setting removal, not a booking-engine rewrite. Did not drop columns or ignore buffers at hold time. Residual: a service that already has non-zero buffers keeps them until the next availability save.

---

## 2026-09-11 - Step 1 live site is a button, edit is a text link

After personalization, Step 1 showed the raw `/lp/<id>` path and a purple Edit website button. The live URL is now an "Open my website" button that opens the published site in a new tab (`noopener`). Edit website / Continue editing is underlined text to edit-mode, not a button. Header "View live site" is unchanged. Failed-state "Edit manually instead" is unchanged. No new components.

cursor.md vet: native `<a target="_blank">` inside the existing Button (not `window.open`); draft.copy still threads `overview.draft.exists`; did not restyle the header or failure CTA.

---

## 2026-09-11 - Personalize uses the shared agent-message session

Step 1 fitting POSTed `/api/agent/message` with only Content-Type. That route reads contractor identity from Bearer via `getContractorAuthUserId`; server functions already get it from `attachSupabaseAuth`. Lookup succeeded; personalize returned 401 before the turn started.

One browser client now attaches `supabaseBrowser.auth.getSession()` for both chat and Step 1. Missing token fails closed as 401 without an anonymous POST. No cookie auth, no new turn/RPC, no job for fitting.

Verification: `pnpm verify:agent-message-auth` (helper requires Bearer; both callers use it; no other raw fetch to the endpoint); Prettier/ESLint on touched files; `tsc --noEmit`.

---

## 2026-09-11 - Step 1 lookup follows chain state, not clocks

Purchaser Step 1 treated a durable 13-platform enrichment chain as a 12-minute page request and reused completed work from `created_at` on one sibling row with a 5-minute window. A normal run takes slightly over 12 minutes (one search per cron tick), so the card declared timeout, Retry missed reuse, and a second 13-search run started. Fit never began until that redundant run finished.

Fix threads existing signals: in-flight is any chain with `hasActiveWork`; usable `research_status` (`complete`/`partial`) reuses a fully completed chain with no clock; empty/failed research may spend again. The card polls until the chain is terminal and no longer treats a failed sibling as done while later platforms are still queued. Cancel remains the escape. Fitting stays the designed SSE turn. No timeout bump, no scheduler change, no migration.

cursor.md vet: clocks were the root mismatch, not the numbers. Dropped stall detection, auto-fit on load, and facts-first-over-in-flight as speculation or incident-specific. Mixed terminal chains still fail the card (separate product question); Retry can scrape again unless an older complete chain exists. Fitting's 10-minute SSE cap left as a different substrate.

Verification: `pnpm verify:template-lookup` (RCA reuse, empty re-scrape, chain-grain attach, mid-run failed sibling waits, source clocks gone); Prettier/ESLint on touched files; `tsc --noEmit`. No browser walkthrough: the flow needs an authenticated purchaser site and ~13 minutes of Firecrawl/cron, which this environment cannot exercise end to end.

---

## 2026-09-10 - PR 135 booking-safeupdate CI repair, test harness only

Confirmed the original PR diff contains only Painter 16-18 pages/media, template-only helpers, template catalog/identity registrations, generated route entries, template verification/media scripts and documentation. It does not modify booking/calendar/Stripe runtime code or SQL migrations. The shared primary workspace and parallel agent changes were left untouched during this repair.

GitHub run 34455094360 failed in inherited main migration `20260909223840_2e80086c-328c-4a29-810d-43f6ff7105db.sql`: a one-off production account repair inserts a checkout row for a hard-coded subscription absent from the isolated test database. The preceding `20260909223245_5ad3e2d5-9ae8-4bee-b91f-9faeb552b684.sql` is an operational data wipe that also erases the replay's historical booking fixtures. Main run 34413288656 has the same failing job; the earlier main run 34410823781 passed. Reproduced the missing-subscription failure locally before the fix.

Extended the existing test replay exclusions with those two exact data-operation filenames, without changing their published SQL, inventing production account fixtures, or disabling constraints, safeupdate probes or downstream booking assertions. The existing projection verifier pins both reviewed SQL checksums; the replay invokes it before creating or accessing the database. The verifier now resolves paths relative to its own module so invocation is independent of the working directory. Only `scripts/test-db-bucket3-local.sh`, `scripts/verify-combined-migration-projection.mjs` and this journal are changed by the CI follow-up.

Verification passed: full disposable PostgreSQL 15.19 replay both without and with CI's exact pg-safeupdate revision `37dbc9c4acf5e2504adf2b218e9c6b41751022f3` (download checksum verified, compiled locally without installing globally); availability transactions, historical cutover assertions, concurrent migration/offer fences, admin authority, booking lifecycle and checkout fulfillment-recovery tests all complete. `pnpm verify:bucket3`, migration quote hygiene, projection verification from repo and another directory, shell syntax, focused lint/format and diff checks pass. Independent review confirmed the CI path executes the checksum guard and production behavior is unchanged. No migration was created, edited or applied to any deployed database.

---

## 2026-09-10 - Painter 16-18 and mobile reading-dialog audit

Prepared one scoped Painter 16/17/18 PR from current main c32ec28, leaving the original branch's unrelated staged work untouched. The old P16/P17 worktree was gone and its index/reflog contained only the pre-template baseline. Recovered their original completed Higgsfield photo/video jobs without new generation or billing changes, reconstructed the Ink Wash and Alpine Enamel pages, and brought the photographic Lavender Estate implementation into the clean branch. Each has a dedicated `/templates/painter16`, `/templates/painter17` or `/templates/painter18` route, canonical/noindex metadata, catalog card with local photography, and canonical template ID registered in all four existing identity maps. Personalization molds remain in the existing explicit pending state; no claim of end-to-end purchased-site delivery or payment testing is made.

Reproduced the reported mobile blog-close failure: the old absolutely positioned Close belonged to the scrolling dialog, moving to y=-310 after reading the first article on a 320x568 screen. Replaced that anatomy for all three templates with a non-scrolling dialog shell and an inner content scroller. Close remains a visible 44px tap target, with focus return and background scroll locking. The shell follows visualViewport dimensions/offsets during pinch zoom or keyboard changes; shrinkable grid tracks and wrapping prevent enlarged-text overflow. P18's long planner and expanded FAQ use the same fix. Removed invented checkout business prefills and kept no visible hero player controls, per the template contract.

All three pages use finished homeowner-facing guidance instead of dummy/demo/generated-study publishing instructions, fabricated reviews, contacts or booking transactions. Media attribution and generation provenance remain in linked credits and ledgers. Physical paint samples are legitimate homeowner guidance, not dummy content. A useful local checklist replaces simulated service booking; clipboard denial exposes selectable text. P17's colour chooser identifies its two different cabin photographs rather than pretending they form a same-property recolour. P16/P17 media integrity verification and P18's photographic, font, source and film verifier pass. No model image viewing is available, so browser geometry and interaction checks are not presented as pixel-level aesthetic sign-off.

Added `scripts/audit-painter16-18-browser.mjs`: all three pages pass desktop1440x900, tablet768x1024, phone390x844, small-phone320x568 and landscape844x390; every article is scrolled to its end, Close is checked against the visual viewport and hit-test target, then tapped by coordinates without locator auto-scroll or Escape. The suite also covers 200% pinch zoom, doubled text size, focus return, rendered-copy bans, decoded media, six-second muted inline films, no reduced-motion MP4 request, planner clipboard, surface/colour interactions, and cards on both `/templates` and `/templates/`. During this pass fixed a P16 tablet image-aspect/min-height overflow and tightened its imagery balance. The existing P18 audit also passes, including sampled hero text contrast at three film frames and short-phone purchase-dock clearance. Full strict TypeScript, focused ESLint/Prettier, production build and diff checks pass. No database migration, deployment, real checkout or provider/account mutation was performed. Corrected preview: `http://127.0.0.1:4216/templates/painter18` (siblings painter16 and painter17).

---

## 2026-09-10 - Stripe workspace compatibility surfaced before actions

Implemented on isolated fix/stripe-workspace-environment from main 74764f4. The existing Stripe status response now includes the stored workspace environment, validated deployment Stripe environment, and a safe compatibility explanation. Missing/invalid Stripe configuration fails closed without exposing credentials. canOnboard combines the existing Pro eligibility with environment compatibility. Onboarding checks compatibility after owner/Pro authorization and before readiness reads; creation, reconciliation, inbox and dashboard retain the shared server guard before provider mutations.

Step 4 displays an explicit unavailable state instead of offering Stripe actions that cannot service the workspace. Connect/Continue, Check status, My Payments and automatic return/refresh actions wait for compatible status. Loaded status is bound to its website, and request-scope checks prevent stale responses/redirects after a workspace switch or lock. Other steps, payment identity, client credentials, provider-account creation parameters, charge flags, database schema and environment immutability are unchanged. This is early compatibility gating, not mixed-mode processing or conversion of test purchases into live accounts; the underlying workspace/deployment modes still require deliberate alignment.

Verification passed: 228 server compatibility/authorization cases using actual billing/Connect logic with mocked external dependencies; all 44 browser payment tests including 16 Stripe card cases; strict TypeScript, focused ESLint/Prettier, authorization seams and Stripe source contracts; production build. The initial browser regression exposed stale previous-website status authorizing a return action, corrected before delivery. Independent review reported no actionable findings; delayed onboarding/dashboard response races are guarded in code but not separately exercised in browser tests. No live Stripe calls, credential changes, database writes or migration. The actual diff excludes every painter/template/LP file, catalog and generated route tree; the shared checkout and parallel-agent staging area were not changed.

---

## 2026-09-10 - Stripe persisted-environment and Pipedream reload RCA only

The previous temporary calendar worktree no longer exists. Created an isolated read-only investigation worktree from current main 74764f4; did not reset/prune/restore any other worktree or touch the shared staging area or parallel painter16/17/18 files. User prioritized the persistent Stripe environment error while the earlier calendar-reload investigation was running. No implementation requested or made.

Stripe's exact error is emitted only after billingEnvironment has accepted the deployment mode and matching secret-key prefix, when that mode differs from the website environment supplied by providerOwnerContext. Provider ownership already requires website.environment=profile.environment. Exercised the real billingEnvironment/Connect guard with dummy test/live keys and mocked DB: opposite deployment/workspace modes reproduce the exact error before reservation or provider calls; matching modes reach reservation; inconsistent key/deployment settings emit a different error. This proves the failure class, not the current hosted values (Stripe and database/service credentials are absent locally). The historical Bul grid was test, but no new row snapshot was obtained.

Underlying mismatch: getStripe uses one deployment-wide key and billing mode, while profile/website/subscription/provider environments are durable tenant identity. Login and primary-site selection do not check compatibility with that deployment mode, and Stripe canOnboard only reports Pro eligibility, so a stored test tenant can reopen and receive an unusable Connect CTA after a live switch. The foundation migration defaulted existing/unspecified profile, website and subscription environments to test, then added immutable environment triggers and tenant/environment composite FKs. Admin profile creation still omits environment; normal current checkout instead explicitly writes p_environment and rejects an existing mismatched profile. No evidence that a new live checkout through that current path silently creates a test row. A credential switch cannot safely promote historical payment/provider records; no blanket rekey or guard removal proposed as a correction.

Earlier Pipedream reload findings retained: ordinary configuration/readiness reads do not call account deletion. The pure readiness function marks otherwise healthy/active unchanged stored state non-ready after 15 minutes without fresh connection/selection/trigger evidence; StepTwoCard turns any saved email plus non-ready state into Needs reconnect and ignores granular reason codes. Synthetic-time reproduction: immediate reload remains ready; 15 minutes plus 1 ms produces stale verification/trigger and missing eligible calendar reasons, with account identity unchanged. This explains a time-dependent reconnect prompt, not a proven immediate disconnection on every reload. Cron /api/cron/pipedream-inbox is the verification maintenance entry point but no checked-in schedule installs it; actual hosted scheduler health is unobserved. Worker order is mark_verified before projection (not the hypothesized reversed-order lease bug). No live cron, provider mutations, database writes, application edits, migrations, commits or pushes performed.

---

## 2026-09-09 - User-requested Lovable resync of PR #132

GitHub PR #132 merged as 9ef448f and its reviewed application/migration contents are already in main. The user confirmed a known Lovable sync issue and explicitly requested another PR to trigger a fresh merge event. Created chore/lovable-resync-pr132 from current main with this documentation-only sync note; no application code was reverted, duplicated, or changed. The Step 3 price/save fixes and migration remain exactly as reviewed in #132. No migration application or parallel painter16/17/18, LP, catalog, route-tree, or shared-worktree changes are part of this resync. A new GitHub merge event is the requested mechanism; Lovable synchronization is not claimed as verified.

---

## 2026-09-09 - Step 3 price entry and atomic availability save fixed for review

Implemented on isolated branch fix/booking-availability-save from main 5731888. Price is now editable decimal text rather than a one-cent spinbutton with per-keystroke formatting. Validated decimal digits convert exactly to positive safe integer cents for preview/save; initial empty, clearing, sequential typing, replacement, and paste remain editable. Price edits participate in dirty state. Saves lock the existing fieldset to avoid overwriting in-flight edits, preserve values on failure, and distinguish validation, revision conflicts, internal failure, and a committed save whose refresh failed. Confirmed saves requiring reload do not raise the unsaved-changes unload warning.

The forward-only 20260909100000_fix_booking_availability_override_aliases.sql replaces the ten-argument RPC wrapper with qualified JSON column aliases and distinct PL/pgSQL variables. Its signature, owner, SECURITY DEFINER/empty search_path, service-only execution, private base saver, transactional updates, limits, revisions, and entitlement/ownership semantics are preserved. Existing applied migration files are unchanged. Server handling logs only a bounded-format SQLSTATE/PostgREST code and operation, never raw database details or user payloads, and no longer labels backend programming failures as invalid settings. Safe integer cents are also enforced server-side.

Verification: the full disposable PostgreSQL 15.19 migration harness reproduced the original SQLSTATE 42702 with empty overrides before the new migration, then passed actual first saves, updates, exact amounts, empty/unavailable/custom overrides, revision/authorization/entitlement rejection, and aggregate rollback after validation failures. Existing booking and checkout recovery SQL tests also passed. Optional safeupdate-library execution was not available locally; the existing managed-safeupdate CI path includes the new tests. Browser suite passed 28 tests (25 real AvailabilityEditor cases plus 3 existing payment cases); server-boundary suite passed 44 cases. Strict TypeScript, Supabase type parity, focused ESLint/Prettier, relevant source contracts, shell syntax, diff checks, and production build passed. Independent review found one confirmed-save unload-warning inconsistency, corrected and regression-tested before delivery; no remaining actionable findings were reported.

The browser mocks only its save boundary, and server tests mock external services; PostgreSQL tests execute the real migrated RPC. These checks are not a claim of a deployed authenticated end-to-end test. No deployed database or provider mutations occurred. Migration remains unapplied outside the disposable local database and requires PR review/merge plus explicit authorization before allowlist verification, dry run and apply. Painter16/17/18, LP/template code, generated route tree, shared-worktree files/staging and generated test artifacts are excluded from this PR.

---

## 2026-09-09 - Proposed Step 3 corrections, not implemented

Clarified confidence: the actual UI price-entry defect and committed SQL's child name collision were reproduced independently; the deployed save request's SQLSTATE remains unobserved. Proposed keeping price as editable decimal text, converting validated dollars to integer cents at the save boundary, and incorporating that text into dirty-state/save validation. Proposed a forward-only migration correcting ambiguous variable/column references in the existing availability wrapper without changing transactional, ownership, entitlement, or revision semantics. Server errors should retain a safe SQLSTATE/operation for diagnosis and distinguish settings/conflicts from internal failures instead of blaming all errors on settings. Verification must exercise real browser keystrokes and successful first/repeat saves through the actual migrated RPC, including empty/custom overrides, stale revisions, and rollback. No implementation, migration file, commit, push, deployed mutation, or parallel painter16/17/18 changes this turn.

---

## 2026-09-09 - Step 3 price and availability save RCA only

User confirmed calendar setup succeeds and reported one-cent price increments plus "Check your settings / Unable to save availability" on Step 3, requesting no implementation. Inspected latest main 5731888 in the isolated worktree. AvailabilityEditor defines a native number input with step=0.01, derives its value from integer cents via toFixed(2), and converts every keystroke immediately with Number/Math.round. Executed the actual component in headless Chrome, bundling in memory and mocking only the save server function: ArrowUp takes 0.00 to 0.01; clearing restores 0.00; select-all then sequential 1,0,0 leaves 1.00; one-shot fill of 100 yields 100.00 and save serializes amountMinor=10000, null initial revisions, five weekday intervals, and empty overrides. Thus this is an edit-state/formatting defect, not a database one-cent increment.

The latest effective save_shared_booking_availability wrapper in 20260829093905_bucket1_closure.sql declares child jsonb and also uses child as a jsonb_array_elements SQL alias in preflight queries at lines 437/440. Reproduced the exact colliding expression with empty overrides inside BEGIN READ ONLY on a disposable local PostgreSQL 15 instance: SQLSTATE 42702, column reference "child" is ambiguous (PL/pgSQL variable vs table column). The wrapper analyzes this statement before invoking the base saver, so ordinary empty overrides still hit the collision before service/schedule insertion. Local server stopped afterward; no deployed database mutation or function invocation performed. This is a demonstrated defect in the committed SQL; the actual live RPC error/installed function definition has not been retrieved.

The save handler maps every non-revision RPC error to "Unable to save availability" and logs no SQLSTATE. The editor labels every non-success message "Check your settings", misattributing a backend programming error to input. Real-validator/mocked-handler and fake-fetch Supabase serialization probes confirmed first-save null revisions survive and numeric cents pass; stripped currency/paymentPolicy keys are not the blocker because SQL supplies USD/full_amount itself. Existing SQL coverage only rejects NULL overrides before the colliding query; it never successfully saves a first configuration. Browser tests do not exercise AvailabilityEditor. These are independent defects hidden by untested end-to-end boundaries; Google auth and the earlier Pipedream fixes are not on the availability-save path. No app code, migration, commit, push, or painter16/17/18/LP changes; only this journal was updated.

---

## 2026-09-09 - PR #131 scope verified; painter16/17/18 excluded

User explicitly excluded locally present painter16, painter17, painter18 and their LP code. Verified the actual GitHub PR #131 file list and branch diff: only journal.md, scripts/test-booking-providers.mjs, scripts/test-google-calendar-completion.mjs and src/lib/pipedream.server.ts are changed. PR is open/mergeable at 2680f19. Work remains in the isolated calendar worktree; no template, LP route, generated route tree, shared-worktree staging, or parallel-agent source files were changed. This constraint note is local and not part of the pushed PR.

---

## 2026-09-09 - Verified optional deployed-trigger cursor fix

Implemented the narrow provider-contract correction on fix/pipedream-trigger-pagination from main ff263ec. listDeployedPipedreamTriggers still requires a data array and page_info object, but treats omitted/null/empty end_cursor as terminal, matching Pipedream's documented optional fields and SDK semantics. Invalid cursors, immediate repeats, malformed known trigger rows, and the 100-page bound still reject; no catch-and-return-empty fallback or partial inventory success was added.

Both regression suites failed with the exact reported error before the parser change. They now pass with the observed first-time response (data=[], page_info={count:0,total_count:0}), empty and populated terminal pages, multipage accumulation, malformed envelopes and cursors, invalid later pages, row validation, and the page limit. The fixed application function also parsed the real development deployed-trigger endpoint successfully as [], with both token and list HTTP 200. Only token acquisition and the read-only list GET were permitted during that live check.

Independent diff review found no actionable issues. Strict TypeScript, focused ESLint/Prettier, provider/completion tests, reconciliation and booking-worker regressions, trigger/lifecycle contracts, diff checks, and production build passed. Live trigger deployment/full onboarding were not exercised, so this verifies the reported parser failure rather than claiming all subsequent provider operations succeed. No migration, UI, route-tree or parallel painter changes; only provider parser, two existing test files, and this journal are included.

---

## 2026-09-09 - RCA: valid empty deployed-trigger response rejected

User requested RCA first for "Pipedream returned an invalid deployed-trigger list" after PR #130. Inspected fresh main ff263ec. Live read-only GET for the previously supplied Bul profile in development returned HTTP 200 with data=[] and page_info={total_count:0,count:0}; no start_cursor/end_cursor keys. Request b8ef5210-a384-4a6c-b07d-91a43550deba. Executing the unmodified application listDeployedPipedreamTriggers against the same live endpoint reproduced the exact reported error, with token and list HTTP 200 and no provider mutation.

Immediate defect is pipedream.server.ts's mandatory `"end_cursor" in body.page_info` guard. The provider documents PageInfo cursor fields as optional, and its SDK terminates when endCursor is absent/null. Our parser rejects omission before reaching its own undefined-cursor termination branch. New-user empty deployed inventory is normal and should let configureGoogleCalendarTrigger choose deployment, but the exception prevents that branch. The guard predates the scope fix; resolving the 403 made the next provider-contract defect reachable.

Underlying verification failure: tests modeled the consumer's assumed shape instead of actual provider variants. The only successful deployed-list fixture used data=[] with end_cursor:null, so it could not catch an omitted optional field; failure fixtures tested HTTP 403, not valid successful empty envelopes or real pagination. PR #130 live checks stopped at registry list and pinned definition. Own this as incomplete boundary verification, not another Google auth, merge, or deployment issue. Proper correction is optional-cursor termination with strict malformed-envelope/row validation, preserving pagination/loop safeguards and using the observed response as a regression fixture. No implementation, migration, commit, push, calendar edit, or trigger deployment this turn.

---

## 2026-09-09 - Implement verified Pipedream Connect scope fix

Changed only the server client-credentials scope to connect:* after the controlled live comparison established that the same development trigger-list request fails with the granted fine-grained scopes and succeeds with Connect-wide authority. This explicitly broadens the server token within Connect; it does not use unrestricted * or widen browser Connect tokens, which retain connect:accounts:read connect:accounts:write. Updated both existing token-contract assertions; completion tests still verify project/environment/account boundaries and provider failures. No change to Google consent, calendar selection, trigger deployment logic, UI, database, generated route tree, or parallel painter templates. The live comparison verified trigger discovery and pinned-definition reads, not full live onboarding or trigger deployment.

Verification passed: strict TypeScript, focused ESLint/Prettier, provider tests, all 28 completion cases, six reconciliation regressions, and authorization seams. Executed the updated application module against Pipedream in development with a guard blocking all requests except OAuth token creation and GET: token, trigger list, and pinned definition each returned 200; the expected Google Calendar trigger and definition parsed successfully. No calendar or deployment mutations were performed; no credentials or tokens were printed. No migration is required.

---

## 2026-09-09 - Live read-only scope comparison isolates trigger denial

User supplied the development trigger-list result: HTTP 403, JSON error "Insufficient scope". Pipedream credentials are now present in root .env.local (presence checked without printing values), allowing direct read-only reproduction instead of further user diagnostics. Fresh token response and locally inspected scope claims both include all seven requested application scopes, including connect:triggers:*. The exact trigger-list GET still returns 403 Insufficient scope (request 239025cd-aae8-4a5c-9070-1bdf7156b6a0).

Controlled scope comparison with the same OAuth client, project, environment, and GET: connect:triggers:* -> 403; adding connect:apps:* -> 403; adding connect:actions:* -> 403. Existing application scopes also receive 403 on the known Google trigger-definition GET. Pipedream's documented Connect-wide connect:* scope -> 200 on the exact list request, with the expected google_calendar-new-or-updated-event-instant entry; fetching that entry's pinned definition also returns 200 with configurable_props. Successful requests 86fc9577-6a30-4900-86e6-693256332216 and 1cdfff72-027c-4ac3-9000-f3ba7ff9af30. This establishes a fine-grained-scope vs Connect-wide authorization mismatch in the observed provider behavior, not which internal Pipedream check is defective. connect:* is a verified discovery remedy but broader than the current scoped token; no automatic privilege-widening retry was implemented.

All tokens stayed in memory; outputs contain only scopes, HTTP status, booleans and request ids. No Google account/calendar reads or writes, trigger deployment, database mutation, or application edit was performed. Full completion with the broader scope remains untested. The customer's prior request remains diagnosis-only; any production scope change must be an explicit reviewed change, not a claimed already-shipped fix.

---

## 2026-09-09 - Development trigger-denial replay command

User confirmed the affected Pipedream environment is development. Supplied one copy-paste terminal command with x-pd-environment fixed to development, using the deployed settings from ignored .env.local and the existing server scope list. It prints the trigger-list HTTP status, selected response headers, and credential-redacted denial body, never the token response. The command was not executed because local provider credentials are absent. No application implementation or production changes.

---

## 2026-09-09 - Inspecting the trigger denial without app changes

Explained that browser DevTools cannot recover the discarded server-to-server response. Rechecked the exact server OAuth scope string, environment header, trigger-list URL and query on current code. Provided a one-shot local replay: use the deployed app's credentials privately in ignored .env.local, obtain a fresh server token in memory, issue only the read-only trigger-list GET in the affected website's environment, and inspect status/request correlation plus the credential-redacted denial body. No token response or request authorization headers are printed. A successful replay would establish that this fresh request works, not prove the original failure fixed; execution from a different runtime does not preserve all original request conditions. Local provider credentials are absent, so no authenticated probe was executed. No application code, migration, commit or push.

---

## 2026-09-09 - Trigger failure remains unresolved

Clarified fix status in response to the user's direct question: no verified remedy for the live trigger-discovery 403 yet. PR #129 exposed the failing operation and corrected separate permission defects; it did not resolve this incident. The misleading Reconnect classification has a known code correction, but changing that UI cannot authorize trigger access. The next discriminating evidence is the upstream denial response from the same authenticated trigger-list request, not another purchase or Google consent flow. Local Pipedream credentials remain unavailable. No application implementation, migration, commit, or push was performed.

---

## 2026-09-09 - Trigger-discovery 403 RCA only

User reports "Pipedream trigger discovery failed (403)" plus Reconnect/Connect to different account, and explicitly requests diagnosis only. Inspected current main b3f6636, which includes PR #129. In automatic completion, account lookup, scope checks, CalendarList, FreeBusy, the event-write probe, and configuration persistence precede configureGoogleCalendarTrigger. Its first provider operation is GET /v1/connect/{project}/triggers?app=google_calendar&registry=public&limit=100, authenticated with the application's Pipedream OAuth token, not a Google proxy request. The new error locates the denied boundary; it does not prove this failure began after the previous patch.

The request and requested connect:triggers:* scope match current official Pipedream docs. No trigger-specific plan/enablement requirement or extra scope was established. The actual provider denial reason remains unknown: the error reader preserves only known codes, and local provider credentials are absent. The UI independently misclassifies any saved email plus non-ready aggregate calendar status as Needs reconnect, including failed monitoring setup. Thus repeating Google consent is not a demonstrated remedy for this registry denial. PR #129 fixed verified permission gaps and exposed the failed operation, but did not establish or resolve this incident's live trigger-access cause. No implementation, migration, commit, or push this turn.

---

## 2026-09-08 - Google Calendar permissions and safe provider failures

Fixed the verified code gaps on isolated latest-main branch fix/google-calendar-permissions. Setup/manual selection require CalendarList, FreeBusy, and event-write grants before proxy calls; insufficient grants return explicit reconnect instructions. Server OAuth now includes account-write permission for the existing authorized disconnect. Every Pipedream request carries a static operation label and errors retain only allowlisted provider machine codes from a bounded, timed body read; raw messages, headers, URLs, credentials, and body fragments are neither returned nor logged. Resource status/class behavior and 401 refresh/404/410 handling remain intact.

Review caught and corrected bystander behavior before delivery: typed HTTP failures must not match reconciliation's text-based account-health invalidation; steady-state verification does not require unused CalendarList grants. Reconnect no longer automatically deletes other connected accounts, since existing booking destination epochs still need those credentials. Account selection keeps the newest saved account on repeated completion instead of switching back to an older retained account. Added strict completion, denial/redaction, permission, account retention, and reconciliation regressions to CI and the booking unit suite. No migration or template/rendering changes; painter16/painter17 and the shared checkout remain untouched. The actual live upstream 403 reason is not yet established; this patch fixes the proven permission gaps and makes any remaining provider refusal diagnosable rather than claiming mocked tests prove production success.

Verification passed: provider-mocked booking tests; 28 completion-path cases including 10 denied provider stages; six reconciliation regressions; provider authorization seams; account selection/readiness and trigger contracts; booking-worker regressions; strict TypeScript, focused ESLint, diff checks, and production build. No live provider or database mutations were performed. Changes are confined to calendar/provider code, focused tests, test commands/CI, and this journal.

---

## 2026-09-08 - Google Calendar 403 investigation on latest main

Pulled origin/main with --ff-only into the isolated obra-calendar-rca worktree at f129055 (PR #128). The shared checkout and staging area contain parallel template work and were not changed. User supplied the exact text "Pipedream request failed (403)" after successful Google authentication; the attached screenshot could not be read and was not used as evidence.

Traced StepTwoCard's connect=success effect through completeGoogleCalendarConnection: account discovery, CalendarList, FreeBusy, temporary event creation/deletion, and signed trigger deployment. All use pdFetch, which throws a status-only PipedreamRequestError and discards the failing operation and upstream body. The proxy can relay a Google denial, so the visible message does not identify either the source or the reason. The Obra authorization guard emits different errors and runs before these calls. Verified current official Pipedream contracts: www.googleapis.com is an allowed Google Calendar proxy domain; query identities and proxy target encoding match the provider contract/SDK. No deployment or cache diagnosis was made.

Two concrete permission gaps: hasGoogleCalendarWriteScope accepts calendar.events alone even though CalendarList and FreeBusy also need qualifying read/freebusy grants; the server OAuth scope list omits connect:accounts:write although account deletion uses it. The latter's extra-account cleanup error is swallowed, so it cannot be asserted as the displayed completion error. Neither gap establishes the actual denied operation for this account. Provider credentials are not configured in the local environment checked, so no authenticated provider calls or calendar mutations were attempted.

Verification: test-booking-providers.mjs and verify-google-calendar-readiness.ts pass. An isolated synthetic-response probe against the real wrapper reproduced identical messages for account-list and proxied Google CalendarList 403s, confirmed loss of the provider reason, the event-write-only scope gate, and absent account-delete scope. Existing mocks do not exercise completeGoogleCalendarConnection or enforce provider authorization. Runtime RCA remains open pending the failed operation plus a sanitized upstream error code/reason; no application changes, migration, commit, or push were made.

---

## 2026-09-07 — Vet of the calendar email / CAS / hash landing fixes

The three fixes hold. Email is whichever Pipedream account field looks like an email (`name` in Connect’s Google payload; `external_id` is `obra:env:profileId`). Reconnect no-op uses the same ready predicate as the chip, so stale 15-minute reconnect re-stamps verify/trigger. `/user` hashes scroll after the overview cards exist; Continue setup uses typed resume props. Persist already stamps `permission_verified_at`; trigger deploy stamps `last_health_at`. Leftover discover/save share the persist helper. No further code change. No migration.

---

## 2026-09-07 — Vet of purchaser onboarding complete path (#126)

The plan’s surface is in place (login resend, `/user` hashes, chip states, Step 3/4 locks, `/setup` shims). Three load-bearing misses would have made Google return look broken:

1. Pipedream puts the Gmail on account `name`; `external_id` is our Connect user id (`obra:env:profileId`). Complete required an email-shaped `external_id`, so every return failed closed. Persist now takes whichever account field looks like an email.
2. Reconnect CAS treated healthy + active trigger as done and skipped persist/trigger, so a stale 15-minute chip stayed Needs reconnect after Google OAuth. CAS now requires the same `projectGoogleCalendarReadiness` ready predicate as the chip.
3. `/user#step-3` (and Continue setup) landed on “Loading your website…” without the step ids. Overview now scrolls the existing hash after the cards mount; Continue setup uses `contractorResumeTo` so query+hash are real Link props; unauthenticated `/user` keeps the hash on `next`.

Leftover discover/save server fns stay (auth-seam tests). Persist-then-trigger split is the old wizard’s. No migration.

---

## 2026-09-07 — Purchaser onboarding: login resend, calendar complete, Steps 3–4, retire /setup

Login OTP resend is on `/verify-otp?flow=login` via existing `sendOtp`; `/login` stays identity-only. Step 2 is no longer the 5-CTA wizard: Pipedream returns with `connect=success` and `completeGoogleCalendarConnection` picks one healthy account, one writable calendar (keeping the saved destination on same-account reconnect), requires `account_email`, persists, deploys the trigger, and deletes leftover Pipedream accounts. Missing email fails closed. `connect` survives `contractorResumeTo` and `/user` search. Active means calendar ready **and** a named email; nameless rows stay empty Connect. Availability is Step 3 (`onSaved` refreshes overview; weekday row toggles). Stripe is Step 4 and auto-reconciles on `connect=return` only. Checkout/OTP/`nextPath`/Connect fallbacks go to `/user` hashes; `/setup/*` is a redirect shim. Bucket 2 source-contracts now assert the complete path. No migration.

---

## 2026-09-08 — Vet of #125 (OAuth resume + /user purchaser)

The two prompt items hold. Resume is typed `to`/`params`/`search` with an allowlisted `next`; this router only document-reloads when `href` parses as an absolute URL (`new URL(href)`), which is the loop class. `/user` always mounts purchaser cards; overview heals identity from the latest completed checkout session without calling `ensureTemplateSeeded` (landscape has no overlay). Login resume now fails closed to the OTP form if `getSession` throws.

Bystander that is the deprecation, not a miss: `WorkspaceShell` is unmounted. Admin kickoff still navigates to `/user` after impersonation, so unified generation no longer has a UI. Pipedream "App not found" is the Connect `app=` slug / PD environment, not this hop. No migration.

---

## 2026-09-08 — /user is only the purchaser home; OAuth resume is typed

Pipedream/Stripe document returns still 302 to `/login` (no contractor cookie). Resume now uses typed `to`/`params`/`search` so TanStack cannot treat an absolute `href` as `window.location` and loop. `/user` no longer fail-opens the agent workbench when identity is missing: every contractor lands on the purchaser cards. Overview heals `template_id`/`template_slug` from the latest completed checkout session so a later `/login` (no search `templateId`) still knows the mold. Landscape has no overlay; Step 1 may stay mold-pending. WorkspaceShell remains in the tree for agent internals/verifiers but is not mounted from `/user`. No migration.

---

## 2026-09-08 — Vet of OAuth return session + landscape /user split

Session resume: stored OTP session was already the data; `/login` now reads it and client-navigates with a same-origin `next`. That is the class they asked for, not a cookie, so document GET to `/user` still cannot authenticate by itself. Relative `navigate({ href })` stays client-side in this TanStack version because `new URL('/user/…')` throws; an absolute href would full-reload and loop. Allowlist on `next` is load-bearing. Copy-to-website at checkout OTP is best-effort and swallowed — later `/login` has no `templateId` search, so an untagged row still opens `WorkspaceShell`.

Landscape correction: `/templates/landscape` is registered; the other email seeing purchaser is not proof the landscape email’s website row is tagged. `/user` fail-opens the agent workbench whenever bootstrap has no identity and the URL has no `templateId`. Deprecating that default is the product question, not a missing overlay map.

---

## 2026-09-08 — Contractor session survives Pipedream document return

Pipedream Google success already stored the Supabase session in the browser. `/user` SSR `beforeLoad` only reads `Authorization: Bearer`, which a top-level GET does not send, so it 302'd to `/login` and dropped `websiteId`. `/login` now resumes that stored session with a client navigation (Bearer attached) and contractor-gated routes pass a same-origin `next` so the return keeps the workspace. Not a cookie rewrite; document GET still cannot see the token, but the login hop no longer looks like a logout. No migration.

Landscape `/templates/landscape` already has `tpl_landscape` in all four overlay maps and `DemoLpChrome templateId`. The Garden Delite workbench after `/login` is the old login-without-intent seam: OTP `/login` goes to `/user/$id` with no `templateId`, and purchaser cards require `bootstrap.templateSlug` or search `templateId`. #122's painter default does not tag new post-backfill rows. If the Garden Delite website was not dual-written at grant, `/login` loads an untagged site → `WorkspaceShell`. Checkout OTP would still have passed session `templateId`. Investigation only; no landscape code change in this branch.

---

## 2026-09-07 — Template.md: catalog pages must ship registered templateId

Painter 13/14 (and any future `/templates/painter15`) can still follow the old conversion-seams sentence — omit websiteId for “generic acquisition” — and after pay `/login` shows the workbench. The two #121 checklist lines were not enough: the How still taught omitting identity. Settled decision + conversion seams now require a canonical `tpl_*` id in all four overlay maps and `DemoLpChrome templateId`; CHK-T01 fail-closed; no applied-SQL rewrites; overlay/manifest may lag; silent unified landing is a release defect. No code or migration.

---

## 2026-09-07 — #122 CI: types.ts missing template_id

`source-contract` / `verify:bucket3` failed on `verify:types`. `20260907130000` added `websites.template_id` and `checkout_sessions.template_id` but generated types still lacked the column, so the migration/types contract check failed. Same mismatch exists on current main; this PR's Verification job is the one that surfaced it. Added the nullable `template_id` field to Row/Insert/Update for both tables. `node scripts/verify-supabase-types.mjs` now passes. No migration or production apply.

---

## 2026-09-07 — Vet of pre-capture identity backfill (#122)

The implementation matches the failure: NULL `template_id`/`template_slug` made `/login` treat a catalog purchase as a unified workspace, and Pro checkout fell through to `/setup`. Session-copy-first, then operator-confirmed painter default for remaining purchased versionless rows, then id-first bootstrap + tagged-site preference on login, is the right architecture — not a new routing stack.

Holds: SQL regression covers copy-vs-default vs versioned vs unpurchased-draft; set-once compatible; `/setup` bounce reuses existing `getSetupRedirectTarget` once the row is tagged; Step 1 already client-gates unwired molds (`painter` has no manifest) so the overview still renders.

Real issues, not theater: (1) step 3 tags every purchased versionless untagged website as painter — correct for the confirmed `/templates/painter` buy, wrong for any generic catalog or empty-site checkout that looks the same; (2) tagged-site preference was placed on shared `findPrimaryWebsiteId`, so checkout onboarding-seed and admin kickoff inherit it; login-only would have been the smaller consumer branch; (3) step 4 mirrors identity onto all untagged checkout sessions for that website, including pending/expired — should be completed/pending_otp only. None of these block the reported `/login` bug for a single tagged painter site. Still must not apply until merge + explicit authorization.

---

## 2026-09-07 — Pre-capture template identity backfill + login prefers tagged site

Login after `/templates/painter` (and any other pre-capture catalog buy) showed the agent workbench, and Pro checkout landed on `/setup`, because `websites.template_slug` and `template_id` were both NULL. `/login` never carries purchase intent; workspace bootstrap picked the oldest website and treated a null identity as a unified/agent site. That is the template-identity gap from `plan/template-purchase.md` §3.1, not missing purchaser UI.

Fix is two-sided, no new routing stack: (1) forward migration `20260907200000_backfill_pre_capture_template_identity.sql` copies known checkout-session identity onto the website, then tags remaining purchased, versionless, still-untagged websites as `painter` / `tpl_painter` (operator-confirmed pre-capture catalog purchase). Agent-built sites (they have versions) and unpurchased `ensureWebsite` drafts stay untagged. (2) `findPrimaryWebsiteId` prefers a tagged website over an older untagged draft, and `getWorkspaceBootstrap` resolves identity id-first so a tagged row renders `PurchaserOverview` on `/login` with no search params.

Migration is local/code-only until the PR is merged and apply is explicitly authorized. `/templates/painter` is in the purchase registry but has no overlay manifest yet, so Step 1 may show the existing mold-pending support state; the purchaser cards still replace the workbench.

---

## 2026-09-07 — Painter 12 Lemonade Stand prepared for review

Added `/templates/painter12` and its `/templates` catalog card as a distinct, image-first residential painter site. The Lemonade Stand design uses local Fredoka/Caveat Brush fonts, sunny neighborhood colors, painted-sign controls, a mobile film-first hero, four same-property project postcards, four service scenes, preparation/planning evidence, three complete painter field notes, three review-copy examples, FAQs, estimate action, the shared homeowner scheduling flow, and the shared template purchase CTA. Media is entirely local and photorealistic: 21 Seedream 4.5 stills with 800/1200/1600 variants, four reference-edited before/after pairs, and a silent six-second Seedance 2.0 Mini hero film, all recorded in the media ledger. Recursive design review covered desktop/mobile hierarchy, media realism and role fit, first-fold visibility, content completeness, truthfulness, contrast, crops, rails, keyboard/focus, reduced motion, overflow, and cross-template distinction. Verification includes `verify-painter12`, full TypeScript, production build, focused formatting/lint, and browser audits at 320, 390, 430, 768, 1280 reduced-motion, and 1440 widths. No migration or production state change is required.

---

## 2026-09-06 — Vet: async SubtleCrypto HMAC is the disease, implementation holds

Asked whether #115 is a band-aid. It is not. Production is Cloudflare Workers; Nitro `cloudflare-module` resolves Stripe with `workerd`/`worker` export conditions to `stripe.esm.worker.js` → SubtleCrypto. `constructEvent` is synchronous and throws `CryptoProviderOnlySupportsAsyncError` before HMAC runs. The handler mapped every throw to 400 Invalid signature, so a matching test secret looked like a bad signature. #113/#114 owned the signed body; they did not make HMAC executable on this runtime. The fix is Stripe’s own async path: one `constructEventAsync` + SubtleCrypto owner for both SaaS and Connect webhooks. Vetted the implementation against Stripe 22.6.1: `undefined` tolerance is DEFAULT_TOLERANCE 300; explicit SubtleCrypto does not depend on which Stripe entry was bundled; post-construct API-version and livemode checks stay; catch now logs the throw. Did not restore a catch-string API-version branch — this SDK does not throw that during construct. Did not change Pipedream (node:crypto) or the #114 wrap. No code change from the vet. Production still needs merge of #115 plus a Lovable deploy.

---

## 2026-09-06 — Stripe webhook HMAC never ran: sync constructEvent on Cloudflare SubtleCrypto

Checkout still stuck on "Payment received. Sending your verification code…" after #114 with a matching test webhook secret. Production `POST /api/stripe/webhook` returns 400 Invalid signature for any signed delivery because the Cloudflare `workerd` Stripe build uses SubtleCrypto, and `constructEvent` is synchronous — it throws `CryptoProviderOnlySupportsAsyncError` before HMAC is compared. The handler mapped every throw to Invalid signature, so a correct secret looked like a bad signature. Both Stripe webhook routes now `constructEventAsync` with SubtleCrypto. The #114 one-body wrap stays. No migration. Production needs a Lovable deploy after merge.

---

## 2026-09-06 — Vet: Stripe webhook one-body PR matches the contract

Vetted PR #114 against the one-owner contract and this stack's source. Worker entry reads POST once, rebuilds the Request as `application/octet-stream`, handlers `request.text()` that same string; cache/header/fallback are gone; trailing-slash webhook paths match; `/api/stripe/webhook`, connect, and Pipedream are the HMAC routes from #113. Vite points TanStack Start at `src/server.ts`, so local and production share the wrap. Request-middleware CSRF is filtered to server functions and does not read webhook bodies. Internal `src/server.ts` JSON readers return null unless their own `/api/internal/*` path matches. TanStack Start API handlers do not call h3 `readBody` before `server.handlers`; the load-bearing invariant is the captured string being the handler body, not a content-type gate inside `readBody` (which JSON-parses unless urlencoded if it is called). `/api/resend/webhook` is the same HMAC-over-body class and is not in this wrap; it was not in the #113 path list and is not on the checkout-stuck path. No bystander on other JSON POSTs. CI on `e2a377d` is green. Remaining production 400 after Lovable deploy is `STRIPE_WEBHOOK_SECRET` mismatch, not this pipeline. No code, migration, or production state changed.

---

## 2026-09-06 — Stripe webhook HMAC: one owner of the signed body

Checkout success stayed on "Payment received. Sending your verification code…" because Stripe webhook ingest returned 400 Invalid signature, so `checkout_sessions.status` never left `pending_payment`. PR #113 stashed a cloned body in a global cache and still fed `application/json` into h3, with handlers falling back to `request.text()` on a cache miss — two owners of the signed bytes, and the fallback is the original hole. The fix reads the POST once in the Worker entry, rebuilds the Request with `application/octet-stream` so h3 cannot JSON-parse it, and handlers `request.text()` that same string. Trailing-slash webhook paths are included. No cache, header, or JSON-body fallback. No webhook logic, data model, or production state changed. Production needs a Lovable deploy after merge; a remaining 400 after deploy is a `STRIPE_WEBHOOK_SECRET` mismatch with the Stripe endpoint, not this body pipeline.

---

## 2026-09-06 — Vet PR #116 and restore checkout recovery audit authority

Recursively vetted PR #116 from the provider request through the browser redirect and from the final migration order through effective PostgreSQL privileges. The Pipedream fix now resolves and validates `PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG` before creating any external token, preserves Pipedream's `token` and `connectLink` parameters, and appends the configured `app`; the provider-mocked production-module test also proves invalid app configuration fails before a provider call. Added the same app-link invariant to the booking source verifier executed by pull-request CI. The remaining `booking-safeupdate` failure was independent but real: migration `20260906122300_e3b1860d-87e8-4c07-98a4-09694198e62b.sql` accidentally granted direct `service_role` DML on `saas_checkout_fulfillment_resolution_audit`, undoing the original anti-forgery boundary. New forward-only migration `20260906170000_restore_saas_fulfillment_resolution_audit_authority.sql` revokes direct access from browser, service, and worker roles while leaving the required `SECURITY DEFINER` AAL2-admin recovery RPC and direct fulfillment-outbox access intact. The exact full local PostgreSQL migration/behavior replay, focused ESLint, provider-mocked Pipedream behavior, nonincremental TypeScript, production build, production-pricing, SaaS-checkout security, Bucket 3/type contracts, and Bucket 1 generation contracts pass. The migration remains unapplied to deployed databases pending PR merge and explicit authorization.

---

## 2026-09-06 — Fix Pipedream Google Calendar Connect Link app context

Root-caused Pipedream's hosted `Please include the app in the Connect URL` error to `createGoogleConnectLink`: Obra created a valid user-scoped Connect token but returned Pipedream's generic `connect_link_url` unchanged, while Pipedream Connect Link requires an `app` query parameter. The server now preserves the token URL and existing query parameters and appends the already-configured `PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG`. The provider-mocked production-module test verifies `token` and `connectLink` remain intact, `app=google_calendar` is present, and Obra sends the intended allowed origin and success/error redirects when creating the token. Focused ESLint, provider-mocked Pipedream/Google behavior, nonincremental TypeScript, and the production build pass. The broader `pnpm verify:bucket2-start` aggregate remains independently red on current `main` because older static verifiers still search for authorization code inline after that authority was centralized in `provider-authorization.server.ts`; no unrelated verifier rewrite was bundled into this fix. No migration, provider configuration, account connection, deployment, or production state changed.

---

## 2026-09-06 — Repair CI frozen lockfile after main merge

All six pull-request checks failed before their job-specific commands at the shared `pnpm install --frozen-lockfile` step. Reproduced against remote PR commit `ae4ab62` with the workflow-pinned pnpm `10.29.3`: `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` reported that `package.json`'s `pnpm.overrides.entities` value was absent from `pnpm-lock.yaml`; the lockfile also lacked the newly merged Lovable/React Email dependency graph. Regenerated only `pnpm-lock.yaml` with pnpm `10.29.3`. The exact frozen install now succeeds, and the complete `source-contract` sequence passes: nonincremental TypeScript, production build, production-pricing and SaaS-checkout security contracts, Bucket 3 source contracts/type parity, and Bucket 1 generation contracts. The five PostgreSQL jobs had not reached database execution in CI because their identical install step failed first. No application behavior, migration, deployment, provider, database, or production state changed.

---

## 2026-09-06 — Fix: Stripe webhook HMAC signature verification failure caused by h3 body re-serialization

Root-caused the persistent "Invalid signature" (400) on Stripe webhook delivery: h3 (TanStack Start's HTTP layer under Nitro) auto-parses POST bodies with `application/json` content-type, which re-serializes the payload at byte level. Stripe's HMAC signature is computed over the exact original raw bytes; the re-serialized body produces a different HMAC, so `constructEvent` rejects it. The fix captures the original raw body in `src/server.ts` (the Cloudflare Workers entry point) before h3 processes the request, stashes it in a global `Map<string, string>` keyed by a one-time UUID passed via `x-stripe-raw-body-id` header, and each webhook handler (`/api/stripe/webhook`, `/api/stripe/connect-webhook`, `/api/pipedream/webhook`) reads from the cache via a shared `readStripeRawBody()` helper, falling back to `request.text()` when the header is absent (local dev outside Nitro). The cache entry is cleaned up in a `finally` block. No webhook logic, data model, or production state changed. PR: pending.

---

## 2026-09-05 — Live Google/Pipedream onboarding test authorized by configuration

The user confirmed the production Pipedream secrets are configured. The implemented Google Calendar onboarding flow may now be tested for one staff-controlled contractor with a confirmed active Pro entitlement, provided the required booking migrations are already applied. It does not require public customer-booking admission or worker execution: retain `BOOKING_LIVE_ENABLED=false` and `BOOKING_WORKER_MODE=off`. The test sequence is order acknowledgement, Pipedream-hosted Google authorization, connected-account discovery, at least one blocking calendar plus exactly one writable destination selection, Obra's FreeBusy and create/delete probe, and signed Pipedream trigger activation. No configuration, account, trigger, deployment, migration, charge, or production state was changed by this guidance.

---

## 2026-09-05 — Pipedream client/project scope clarified

Clarified Pipedream Connect authentication: Obra exchanges the workspace OAuth client ID/secret for a server-side access token, then supplies `PIPEDREAM_PROJECT_ID` in every Connect API path to select the project. The API authorizes that client to projects it owns or can access in the same workspace; no separate UI binding is needed for this application. A workspace OAuth client may access multiple authorized projects, but Obra has one deployment-wide project ID, so production should use one dedicated production project and a dedicated production OAuth client rather than sharing a client across environments or unrelated projects. No configuration or production state changed.

---

## 2026-09-05 — Pipedream project ID location

Verified Pipedream's current UI documentation: open the relevant Connect project from the Projects area, open its Settings, and copy the project ID beginning with `proj_`. This is the value for `PIPEDREAM_PROJECT_ID`, not the workspace ID or OAuth client ID. No configuration or production state changed.

---

## 2026-09-05 — Sandbox offer registration order

Clarified the minimum safe order for repointing the unused deployment to Stripe sandbox. The user first creates the exact sandbox Starter/Pro Products and monthly Prices and supplies their four non-secret `prod_`/`price_` IDs. A reviewed forward migration then registers and activates those tuples as `test` offers while the current live configuration remains unchanged; Lovable secret updates do not populate `saas_offer_contracts` automatically. After merge, explicit migration authorization, checksum allowlist verification, dry run, apply, and replay verification, the user switches the sandbox key, Price IDs, both webhook secrets, `SAAS_BILLING_ENVIRONMENT=test`, and `BOOKING_WORKER_ENVIRONMENT=test` together and redeploys. No configuration, migration, deployment, account, charge, or production state changed.

---

## 2026-09-05 — Minimum in-place Stripe sandbox switch

Clarified that zero users/purchases makes an in-place temporary sandbox switch operationally reasonable, but changing Stripe credentials alone is insufficient unless Supabase already contains matching active `test` offer contracts. Obra retrieves each configured sandbox Price/Product from Stripe and then `reserve_checkout_intent` requires the same environment/plan/Price/Product/amount tuple in `saas_offer_contracts`. The minimum switch is therefore sandbox key, sandbox Price IDs, both sandbox webhook secrets, `SAAS_BILLING_ENVIRONMENT=test`, and matching active test offer contracts; Product IDs are not Lovable variables but are part of that database contract. Public booking and workers remain off. No configuration, migration, deployment, account, charge, or production state changed.

---

## 2026-09-05 — Stripe sandbox cardholder name

Clarified that Stripe sandbox Checkout accepts any fictional cardholder name; recommended `Obra Test Contractor`. This value is only test payment data and does not need to match the contractor business or legal identity. No state changed.

---

## 2026-09-05 — Purchase OTP delivery prerequisite clarified

Clarified that contractor purchase OTP uses Supabase Auth `signInWithOtp`, not the later Resend booking-notification path. A paid Stripe webhook finalizes the checkout and enqueues `saas_checkout_fulfillment_outbox`, but the webhook does not synchronously dispatch the OTP. Delivery requires `SAAS_CHECKOUT_FULFILLMENT_WORKER_ENABLED=true` plus an authenticated invocation/schedule of `/api/cron/stripe-inbox` using `STRIPE_INBOX_CRON_SECRET`. Supabase Auth email must be enabled and the Magic Link/OTP template must include `{{ .Token }}`; the default Supabase mailer sends only to organization-authorized addresses and is heavily rate-limited, otherwise custom SMTP is required. Public customer booking and booking workers can remain off. No configuration, schedule, email, data, deployment, or production state changed.

---

## 2026-09-05 — Sandbox Pro purchase test steps

The user confirmed the sandbox Stripe Checkout page now opens after correcting the Product/Price contract. Directed the first end-to-end sandbox test: complete the $129 Pro subscription Checkout with Stripe card `4242 4242 4242 4242`, a future expiry, any CVC, and a real staff-controlled email; verify the sandbox SaaS webhook returns 200, complete the Obra OTP, and confirm redirect to the checkout-created website's setup route. Then test order acknowledgement, Pipedream-development Google connection, calendar selection/trigger, availability/full price, and Stripe Express sandbox onboarding with Stripe test identity/bank values. Keep `BOOKING_LIVE_ENABLED=false` and `BOOKING_WORKER_MODE=off`; this proves contractor onboarding only, not customer booking. No data, configuration, deployment, migration, session, payment, or charge was changed by this guidance.

---

## 2026-09-05 — CHK-O01 narrowed to Stripe contract mismatch

The user confirmed Stripe returned HTTP 200 for the configured Price retrieval. This rules out an invalid key and a Price ID from another sandbox; `CHK-O01` is therefore caused by one of `verifiedOfferForPlan`'s strict Price/Product assertions. The most likely mismatch is the editable Product name or exact description, followed by active/livemode, USD fixed recurring amount, monthly interval/count, licensed usage, or an unexpected trial/meter/tier/currency option. If only Product metadata differs, edit it in Stripe and retry without a migration. If the immutable Price contract differs, create a correct new sandbox Price and use a new reviewed offer-rotation migration before changing Lovable. No data, configuration, deployment, migration, session, payment, or charge changed during diagnosis.

---

## 2026-09-05 — Sandbox checkout CHK-O01 diagnosis

Traced the reported `CHK-O01` after resolving the profile-environment error. The atomic Supabase checkout begin and active test-offer lookup have already succeeded when this reference is emitted; failure occurs while `verifiedOfferForPlan` retrieves and strictly validates the configured sandbox Price and expanded Product, before Stripe Checkout Session creation. Likely causes are a secret key and Price IDs from different Stripe sandboxes, an invalid/expired key, or a Price/Product that does not exactly satisfy the active USD fixed licensed monthly 7900/12900 contract and canonical product name/description. Webhook and Pipedream settings are not involved. Stripe Workbench request logs for the Price retrieval distinguish 401/403/404 provider access errors from a 200 response followed by local contract rejection. No data, configuration, deployment, migration, session, payment, or charge changed during diagnosis.

---

## 2026-09-05 — Sandbox checkout CHK-P01 diagnosis

Traced the reported `CHK-P01` after switching Lovable to Stripe sandbox. The error is raised before Stripe Checkout when `begin_saas_checkout` finds an existing globally license-keyed Obra `profiles` row whose immutable `environment` differs from `SAAS_BILLING_ENVIRONMENT`; “account” here means the Obra contractor profile, not a Stripe account. A prior live checkout attempt can create this profile/draft identity before payment completes, so no current user or completed purchase is required. Recommended confirming the normalized license row in Supabase and using a fresh disposable sandbox license/email for the fastest test; do not edit the environment column directly. Reusing the same license requires audited cleanup of the old profile and dependent graph. No data, configuration, deployment, migration, or production state changed.

---

## 2026-09-05 — Applied Stripe sandbox offer activation

The user confirmed PR #112 was merged and explicitly authorized migration application. Verified merge commit `1398217`, exact `origin/main` migration bytes, and production allowlist entry for `20260905181159_activate_sandbox_saas_offers.sql` at SHA-256 `61a8bed01385fba4f07a7c32a96e0bf2f14220ddbeb9282d4b58717e83f00592` (1,635 bytes). The exact rollback-only request returned `dry_run_ok`; the matching apply returned `applied`. Exact replay returned HTTP 409 `already_applied`, recorded the same checksum, and reported ledger timestamp `2026-09-05T19:17:35.487787+00:00`. The atomic migration completed its `assert_saas_offer_readiness('test')` check, so the user-confirmed sandbox Starter and Pro routes have matching audited installation evidence; the migration is test-scoped and leaves live routes unchanged. Lovable runtime variables have not been switched yet, and no Checkout Session, subscription, payment, charge, booking admission, or worker execution was created or enabled by this migration.

---

## 2026-09-05 — Current deployment may become temporary sandbox

The user confirmed there are no live users or existing purchases. The current Lovable deployment can therefore be deliberately repointed to Stripe sandbox for end-to-end Pro onboarding, but not by changing only the key. The safe transition gates checkout off, creates exact sandbox $79/$129 Products and Prices plus separate SaaS/connected-account webhooks, registers and activates their exact tuples as `test` offer contracts through a new reviewed forward migration, then changes all mode-coupled Lovable values together (`sk_test_`, sandbox Price IDs and webhook secrets, `SAAS_BILLING_ENVIRONMENT=test`, `BOOKING_WORKER_ENVIRONMENT=test`) before re-enabling SaaS checkout. Public booking and booking workers stay off. Pipedream automatically uses its development environment for test websites. Test profiles have immutable `test` environment and globally unique licenses, so use a disposable unused test license or an isolated database and reconcile/remove test data before live launch. No configuration, migration, deployment, account, charge, or production state changed.

---

## 2026-09-05 — Stripe sandbox switch boundary

Clarified that the existing live Obra deployment and live website records must not be switched in place to Stripe sandbox keys. Stripe objects cannot cross modes, and Obra enforces equality between the deployment billing mode and each profile/website environment. The safe test path is a separate staging Lovable deployment (preferably with an isolated staging Supabase project), a Stripe sandbox with its own $79/$129 recurring Prices, SaaS and connected-account webhook destinations targeting the staging host, and staging-only `sk_test_`/`whsec_` values with `SAAS_BILLING_ENVIRONMENT=test`. A fresh staff test purchase then creates test-environment records and can exercise Google/availability/Stripe Connect without affecting live identities. Public booking and workers remain off. No configuration, deployment, account, migration, charge, or production state changed.

---

## 2026-09-05 — Template purchase versus Pro setup identity

Traced purchases initiated from `/templates/*`. Those routes call the shared checkout without a `websiteId` or template slug, so checkout creates or selects a real draft website, binds the Pro entitlement to that website, and routes successful OTP to `/setup/<websiteId>`. Google Calendar, availability, and Stripe Connect are profile/business-scoped and therefore serve that entitled website and any later booking-entitled websites for the same contractor. However, the selected template identity/design is not carried into checkout or persisted on the website: only the real website ID is stored. This does not block testing provider onboarding through the resulting setup route, but it is a blocker to claiming that the contractor received the exact template selected from `/templates`. No code, configuration, deployment, migration, charge, or production state changed.

---

## 2026-09-05 — Pipedream OAuth client UI steps

Verified Pipedream's current UI guidance for the client Obra needs: in the Pipedream workspace API settings, create a named client-credentials OAuth client and copy its ID plus one-time secret; this is the server-to-Pipedream client, not a Google OAuth client and not a contractor account. The Connect project ID and Google Calendar app slug are separate values. In Lovable production, store `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_PROJECT_ID`, `PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG`, and `PUBLIC_APP_URL`, then redeploy while retaining booking admission and worker execution off. No configuration, account, deployment, migration, charge, or production state changed.

---

## 2026-09-05 — Pipedream Connect creation clarified

Clarified that the required Pipedream action is creating Obra's production Connect project and its server-side OAuth client, not manually creating an individual contractor's connected Google account. Obra creates the contractor-scoped Pipedream account during the authenticated Google Calendar setup step. No configuration, account, deployment, migration, charge, or production state changed.

---

## 2026-09-05 — Stripe Connect account-creation boundary

The supplied screenshot could not be inspected in this environment. Clarified the implemented boundary: configure Obra's Stripe Connect platform in the Stripe Dashboard, but do not manually create a contractor connected account there. After a staff-controlled contractor completes confirmed Pro purchase, Google Calendar, and availability setup, Obra's authenticated `/setup/<websiteId>/payments` flow creates or safely reuses the US Express account with an idempotency key and sends that contractor to Stripe-hosted onboarding. No configuration, account, deployment, migration, charge, or production state changed.

---

## 2026-09-05 — Ordered Pro onboarding operator checklist

Separated the next rollout into three explicit phases. For setup-only testing, create a production Pipedream Connect project/OAuth client with Google Calendar, place its client ID/secret/project ID/app slug plus the existing live Stripe settings in Lovable, redeploy, and retain `BOOKING_LIVE_ENABLED=false` plus `BOOKING_WORKER_MODE=off`; no onboarding feature flag exists. Then run one staff-controlled confirmed Pro through the implemented order: order acknowledgement, Google authorization/account discovery, blocking and writable calendar selection, create/delete permission probe, automatic signed trigger deployment, shared availability/full price, Obra-created US Express account onboarding, direct status reconciliation, and Express Dashboard link. Only after that passes should provider reconciliation schedules, restricted booking-worker authority, Resend/scanner settings, one-tenant cutover, `drain`/`active`, and finally the controlled `BOOKING_LIVE_ENABLED=true` canary be considered. No configuration, flag, account, schedule, deployment, migration, charge, or production state changed.

---

## 2026-09-05 — Pro post-purchase test boundary

Mapped the implemented live Pro sequence after the user confirmed $79/$129 contractor purchase and the Connect webhook are configured. No additional feature flag enables onboarding: a current confirmed Pro entitlement routes the contractor through order confirmation → Pipedream Google connection/calendar selection/signed trigger → availability and full booking price → Stripe-hosted US Express onboarding/readiness. The immediate prerequisite is production Pipedream configuration (`PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_PROJECT_ID`, `PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG`, and `PUBLIC_APP_URL`); `PIPEDREAM_INBOX_CRON_SECRET` is needed for the later recovery schedule. Keep `BOOKING_LIVE_ENABLED=false` and `BOOKING_WORKER_MODE=off` during this setup-only test. `BOOKING_WORKER_ENVIRONMENT=live` may be configured while off but grants no execution. No configuration, flag, deployment, account, migration, charge, or production state changed.

---

## 2026-09-05 — Stripe Connect setup instructions

Clarified the live Connect setup matching the implemented `2026-08-26.dahlia` contract: enable the Stripe platform for US Express accounts, direct connected-account card charges, payouts, zero Obra application fee, and Express Dashboard access; register the connected-account webhook; then let an authenticated confirmed Pro contractor create and complete their account through Obra after Google Calendar and availability setup. No configuration, deployment, account, charge, or production state changed.

---

## 2026-09-05 — Next gate after contractor Checkout

The user reported that live Stripe Checkout for contractor Obra subscriptions is working. This is user-reported evidence, not an independently retained Step 12 receipt; Step 12 is complete only if the exact amount, one Stripe subscription, correct website/plan entitlement, signed webhook processing, and duplicate-safe retry were also confirmed. Read `plan/guide.md`: its “Current position” block is stale, but its sequence remains useful. The next unproven work is not broad booking enablement; it is to complete and retain evidence for live Stripe Connect platform readiness, the Connect webhook, Pipedream/Google, Resend, restricted booking-worker identity/schedules, webhook size limits, and alerts. Once those prerequisites pass, run Step 13 as one staff-controlled Pro canary through order confirmation → Google/calendar selection → availability/full booking price → Stripe Connect/readiness → one small real customer booking → cancellation and exactly one refund, with every other tenant disabled. Keep `BOOKING_LIVE_ENABLED=false` and booking workers unauthorized until that controlled canary window is explicitly approved. No configuration, deployment, charge, migration, or production state changed this turn.

---

## 2026-09-05 — Painter10 complete mobile rhythm audit

Reopened the full Painter10 mobile composition after user review found extra image gaps in the first two sections and reviews. The root cause was inherited desktop sizing rather than missing assets: mobile hero/overture/planning/reviews still used large fixed-height canvases with absolutely anchored copy, so imagery remained technically occupied while hundreds of pixels had no adjacent narrative job. Audited every section at 320, 360, 390, and 430px inside `DemoLpChrome`, measuring section/image/text bounds, first/last narrative positions, section transitions, all-open FAQ growth, host-dock intersections, decoded media, target sizes, root overflow, and inter-block text collisions.

Converted the reported mobile sections to content-driven flow. The hero image now begins at the section boundary rather than after a 130px cut, and the normal first-fold trailing runway is 24px. A narrow-phone-only host seam keeps the finish scale above the purchase dock without pulling the edition/heading out of view. The point-of-view section uses a 240px establishing image before copy instead of 420px. Planning and reviews no longer use fixed 1320/1740px canvases: their headings, visible note/quote sequences, and disclosures define height; planning’s intro-to-notes pause dropped from 220px to 80px, and reviews use a continuous 48px intro-to-first-quote transition with tighter quote/source cadence. The FAQ image lead dropped from 480px to 320px and remains content-sized under all-open answers. Proof disclosure and journal section gaps were also reduced; closing image height dropped from 1450px to 1240px.

Definitive mobile evidence passes at all four widths: no runtime/hydration errors, failed requests, missing images, root overflow, FAQ clipping, undersized targets, or purchase-dock intersections. Every reported section has continuous narrative occupancy; first/second/review heights are now 640px, roughly 890–975px, and roughly 1310–1405px depending on text wrapping. Text-range audit reports no clipping, and geometry reports zero overlap for review heading/quotes/disclosure, planning heading/notes, and proof copy/labels. Desktop/tablet behavior remains governed by the unchanged larger-screen rules. No migration, deployment, commit, push, or production state changed. Preview: `http://localhost:8080/templates/painter10`.

---

## 2026-09-05 — Stripe dummy-card scope on production host

Confirmed Stripe test cards cannot be used with live-mode keys or live Checkout Sessions. The application binds checkout, webhook, worker, database environment, Price IDs, and Stripe key mode through deployment-wide `SAAS_BILLING_ENVIRONMENT`; switching the production Lovable deployment to test mode would affect every checkout rather than one controlled payment and would violate the committed test/live isolation rule. Recommended a separate preview/staging deployment configured entirely with Stripe test keys, test recurring Prices, test webhook secret, `SAAS_BILLING_ENVIRONMENT=test`, and the checkout gate enabled; then Stripe's standard test card can be used without creating a real charge. No configuration, charge, deployment, or production state changed.

---

## 2026-09-05 — Environment cleanup verified on merged `main`

Verified PR #110 merged into `origin/main` as `1ff8b34`. The current `main` tree no longer contains tracked `.env`; only placeholder `.env.example` is tracked, while `.env`, `.env.*` except the example, `.agent-secrets/`, and `session-logs/` are ignored. A current-tree scan found no populated secret-like environment assignments. Previously committed values remain in Git history, so `AGENT_LOGS_TOKEN` and `MIGRATION_RUNNER_SECRET` still require rotation; ignore rules also cannot prevent an explicit forced add. No credential, deployment, database, or production state changed during this verification.

---

## 2026-09-05 — Credential cleanup committed and pushed

Recreated the tracked environment cleanup on a fresh `chore/env-credential-cleanup` branch from current `origin/main`, leaving concurrent Painter 10/template work untouched. Environment-free dependency installation, Node syntax checks, diff checks, and the full production build passed. Committed the seven intended tracked files as `504557e` (`chore: stop tracking local credentials`) and pushed the branch to GitHub. The branch removes `.env` from the current tree but does not erase published history; `AGENT_LOGS_TOKEN` and `MIGRATION_RUNNER_SECRET` still require Lovable Cloud rotation and local `.env.local` replacement. No PR was opened, no merge occurred, and no production credential, deployment, database, or runtime state changed.

---

## 2026-09-05 — Local credentials consolidated into `.env.local`

Consolidated the legacy credential-bearing `.agent-secrets/lovable-operations.env`, `token.txt`, and `migration-runner-token.txt` files into the ignored root `.env.local`, preserving existing `.env.local` values on conflicts and importing the non-conflicting operations base URL, job-runner secret, and media-diagnostics secret. Removed all three redundant credential files; `.agent-secrets/` now holds diagnostic JSON and documentation only. Removed one ignored session log containing exact operational credential copies, retained `.env.local` mode `0600`, and added a strict working-agreement rule against future raw token files or secret-bearing logs. A final exact-value scan found no copies of the five local operational credentials elsewhere in the current working tree, and both updated script files pass Node syntax checks. Direct canonical-host checks verified the retained agent-log and migration credentials with HTTP 200 and the retained repair/diagnostics credentials by authenticated HTTP 400 input-validation responses; these checks changed no production data. Earlier cross-host probes were inconclusive because redirects stripped authorization, so no claim is made about the discarded conflicting values. `AGENT_LOGS_TOKEN` and `MIGRATION_RUNNER_SECRET` still require rotation in Lovable Cloud and replacement in `.env.local` because their old values remain in published Git history. The repository cleanup remains local and uncommitted.

---

## 2026-09-05 — Environment cleanup summary

Summarized the required end state: rotate `AGENT_LOGS_TOKEN` and `MIGRATION_RUNNER_SECRET` in Lovable Cloud, mirror the new values in ignored `.env.local`, and redeploy; merge the pending tracked-`.env` deletion and ignore rules; optionally remove legacy `.agent-secrets/` copies if `.env.local` must be the sole local credential store. Public Supabase URL/project/publishable configuration does not require rotation. No production credential or deployment changed.

---

## 2026-09-05 — Local secret-storage scope qualified

Confirmed the user should replace `AGENT_LOGS_TOKEN` and `MIGRATION_RUNNER_SECRET` with matching new values in Lovable Cloud and ignored `.env.local`, then publish/redeploy. The repository is not yet literally `.env.local`-only: ignored legacy files under `.agent-secrets/` still hold operational credentials, including old agent-log/migration tokens and a separate Lovable operations file with job-runner/media credentials. The removed tracked `.env` also remains in published Git history, so rotation rather than history rewriting makes its old credentials harmless. The pending ignore rules block `.env` variants except `.env.example` once committed, but cannot prevent forced adds or secrets placed under unrelated filenames. No production credential was rotated or deployment changed.

---

## 2026-09-05 — Tracked environment credential rotation scope

The deleted tracked `.env` contained two server credentials requiring rotation because their prior values remain in published Git history: `AGENT_LOGS_TOKEN` and `MIGRATION_RUNNER_SECRET`. Supabase URL/project identifiers and publishable keys are intentionally client-visible and do not require rotation for this incident; `MEDIA_REPAIR_SECRET` existed only in ignored `.env.local` and was not exposed by the tracked file. Rotation must happen in Lovable Cloud, followed by a redeploy and replacement of the corresponding ignored local values; no production credential was rotated this turn.

---

## 2026-09-05 — Painter10 hero/proof/planning/FAQ/reviews rethink

Reopened `/templates/painter10` under cursor.md after user review identified four concrete composition failures. The issues collapsed into two root mismatches: technical annotation was substituting for homeowner evidence in hero/proof/reviews, while intentional desktop offsets were being inherited as broken list indentation in planning/FAQs.

Rebuilt all four section contracts rather than adjusting margins. The hero no longer renders the competing decorative `MIDNIGHT / LACQUER` billboard; “Midnight Lacquer” is now a compact edition line and the first viewport has one homeowner promise, “A finish that holds the light.” The before/after section no longer stacks two distant frames: both source-referenced images occupy the exact same camera frame and an accessible paint-pass reveal supports pointer drag plus Arrow/Page/Home/End keys, with labels moved to the lower edge so they never overlap explanatory copy. A custom `role=slider` replaced the native range after the TanStack/React dev SSR path produced a divergent empty style attribute; server-only, load-only, hydrated, and immediate-interaction cases now have stable markup and no hydration warning.

Removed alternating indentation from planning and FAQs. Desktop planning notes use one four-column baseline, tablet uses two aligned columns, and mobile uses one shared left edge; no note horizontally overflows. All eight FAQ rows use the same left/right alignment at every audited viewport and can remain expanded without clipping. Rebuilt the review section from scratch with three explicitly fictional sample quotes and identities from the established painter-family sample set, project context, repeated visible `Sample review` labels, and the existing no-verified-reviews disclosure. Google and Yelp vectors render unfiltered at their intrinsic aspect ratios on neutral white source tabs; no empty review slots remain.

Final browser evidence across 1440x900, 820x1180, and 390x844 verifies: no decorative hero billboard; same-frame before/after geometry; reveal values 0/100/99 under Home/End/Arrow; zero proof copy/label collisions; zero review heading/voice/disclosure collisions; three contained sample quotes with source, identity, project, and truthful labels; zero planning overflow; aligned planning/FAQ positions; every image loaded with nonzero area; advancing/changing hero frames; no dock overlap, FAQ clipping, runtime/request errors, root/shell overflow, undersized controls, or duplicate IDs; and no MP4 request under reduced motion. The corrected line-by-line rendered-pixel audit reports zero text contrast failures in the rewritten hero, proof, planning, reviews, and expanded FAQ sections across all three viewports.

No application outside Painter10, migration, deployment, commit, push, or production state changed. Preview: `http://localhost:8080/templates/painter10`.

---

## 2026-09-05 — Painter10 principal text/readability audit

Reopened `/templates/painter10` under the strict cursor.md loop after user review reported clipped and invisible text. The prior audits had proved element containment but had not proved line-level readability against generated image pixels. Built a text-range audit that walks every visible text node through the real nested preview viewport, captures the exact underlying page with text temporarily transparent, samples contrast across each rendered line box, and separately traces ancestor clipping, line-box ratio, shared-image text collisions, host-chrome intersections, root scroll geometry, expanded FAQ state, and normal/reduced media loading.

The first principal pass found 60 desktop, 70 tablet, and 50 mobile contrast failures, 1/9/17 clipped text ranges, 21 sub-glyph line-height findings per viewport, and real intro/item collisions in the first service, method, and journal images. The root causes were systemic: serif display line-height below the font ink box; text lines crossing out of narrow directional falloffs into bright image detail; low-contrast oxblood micro-labels; essential planning content placed in a clipped horizontal rail; mobile finish controls extending beyond the viewport; decorative negative-inset blurs increasing hidden root width; and introduction/item copy assigned to the same image coordinates.

Corrected the typography/composition contract rather than nudging individual labels. Display and item headings now use a 1.0 line-height. Broad feathered reading halos create stable contrast behind text without cards or opaque panels; dark FAQ copy uses a continuous pearl field. Small dark-image signals use a contrast-safe pink-red while light-image FAQ indexes use deep oxblood. Planning notes are always-visible grid annotations (four/two/one columns), not horizontally hidden content. Compact finish controls are a true four-column scale. Intro and first-item copy now occupy opposite image fields with measured zero intersection at desktop/tablet/mobile; mobile receives additional first-image runway rather than smaller typography. Section-level paint containment keeps halos visual without adding 23–76px of clipped root width.

The definitive expanded-state pixel audit now reports zero contrast failures, zero ancestor clipping, and zero tight line boxes across 1440x900, 820x1180, and 390x844. Shared-image geometry reports zero overlap area for service intro/interior copy, method intro/Inspect copy, journal intro/first guide copy, and overture disclosure/specs at all three sizes. The consolidated release matrix passes zero root/shell overflow, every image decoded with nonzero area, no FAQ clipping with all eight answers open, no purchase-dock/finish-control overlap, no undersized controls or duplicate IDs, Home/End radiogroup behavior, booking open/focus return, advancing/changing hero frames, and no runtime/request errors. Reduced motion requests no MP4 and keeps the hidden video paused at `readyState 0`. No application outside Painter10, migration, deployment, commit, push, or production state changed. Preview: `http://localhost:8080/templates/painter10`.

---

## 2026-09-05 — Painter10 deep runtime and seasoned-design correction

Reopened the rebuilt `/templates/painter10` after user review reported missing imagery, a non-playing hero film, and residual boxiness. The audit separated three root causes. First, the port-8080 Vite process had remained in poster-only SSR state after a concurrent `.env.local` restart; the isolated route and media were valid, and restarting only the preview process restored hydration. Second, the source still made video mounting depend on a post-hydration `reducedMotion` state initialized to `true`, so the poster-only state was structurally fragile. Third, many files were decoded but looked absent because near-black photography sat below 80–94% overlays, while the finish selector, material details, FAQ, and estimate facts still read as segmented rows.

Hardened hero media so stable SSR markup always includes poster plus video, the `<source>` itself is limited to `prefers-reduced-motion: no-preference`, CSS hides video under reduced motion or provider failure, and one motion listener controls play/pause across preference and visibility changes. Normal mobile loading now requests the MP4, reaches `readyState 4`, remains unpaused, and advances; reduced motion makes no MP4 request, keeps the poster, and leaves video hidden/paused at `readyState 0`. A restrained local specular sweep raises visible motion from a barely perceptible generated-film delta (about 2% of pixels changing substantially over 1.4s) to about 7%, and disappears under reduced motion. The H.264 High/yuv420p 1470x630 film decodes end to end at 24fps and serves range requests.

Corrected the design from a seasoned UI perspective: lifted hero and empty-proof luminance; reduced static duplicate masking; replaced repeated hard four-sided polygons with asymmetric edge fades; retained hard geometry only for the hero razor cut and action arrow; localized/lowered overlays; changed boxed CTAs to open underlined actions; changed the segmented sheen bar to a slanted calibrated scale; staggered material notes; offset FAQs; and converted checklist/review separators to partial light rules. Added directional contrast falloff behind planning and closing annotations. The remaining grid declarations are semantic alignment only, not image/card layout.

Adversarial UI review found and fixed two additional real defects: the shared purchase dock crossed the hero finish controls at desktop/tablet/mobile, and fixed-height `overflow:hidden` FAQ canvases clipped answers when several native details were open. Painter10 now reserves a host-chrome runway with zero dock/control intersection, keeps the homeowner CTA fully inside the first viewport at all audited sizes, and lets FAQ height grow with content; all eight answers can remain open without clipping. Final browser evidence verifies every media response (`200`, hero range `206`), all lazy images decoding during ordinary scrolling, nonzero rendered media areas, visible frame changes, no overflow or failed requests, all finish controls clickable, booking focus return, and no dock collision. Nine seams from 360–1600px have no outside annotations, sub-11px visible text, or undersized controls. Semantic audit passes unique IDs, continuous heading levels, alt/name coverage, skip-to-main, radiogroup Arrow/Home/End behavior, live finish state, and logical focus order.

No application outside Painter10, migration, deployment, commit, push, or production state changed. Preview: `http://localhost:8080/templates/painter10`.

---

## 2026-09-05 — Painter10 recursive non-box layout rebuild

Re-derived `/templates/painter10` from the evidence hierarchy after user review found the initial finish-dossier implementation repeated the same rectangular/card grammar as prior painter templates. The root issue was not border radius or spacing: every content type had been translated into a box, so a new palette still read as the same landing-page system. Replaced the Painter10 page anatomy and CSS wholesale while preserving its route, factual shared painter content, local media ledger, homeowner booking demo, and shared contractor-purchase seam.

The rebuilt grammar is one continuous lacquer surface cut by light: a near-full-height diagonal hero field behind giant editorial watermark type; irregular full-image surface chapters; a two-frame transformation flowing through a narrow matched-camera seam; five staggered preparation ribbons; and full-canvas planning, empty-proof, FAQ, journal, and estimate scenes with free annotations. Section headings now begin on the first image rather than in standalone preface panels. Tablet/mobile retain a slim horizontal section rail; planning notes remain a named focusable horizontal sequence. The cursor/click/keyboard matte-to-high-gloss inspection interaction and static reduced-motion fallback remain intact, with no hero pause control.

Recursive designer audits corrected a first-fold CTA/finish-rail collision, low image union coverage caused by standalone heading bands, excessive ribbon overlap, 10px essential microcopy, missing compact-layout navigation, a nested FAQ scroll region, and excessive repeated travel. Final isolated-browser evidence across 1600x1000, 1280x800, 820x1180, 390x844, and reduced-motion 390x844 passes hydrated hero video or static poster as appropriate, every local image, finish interaction by pointer/click/keyboard, homeowner booking open/focus return, canonical/noindex metadata, no horizontal overflow, no undersized route controls, no browser/request errors, no purchase-dock collision, and catalog presence. Nine breakpoint seams from 360–1600px keep every free-positioned annotation inside its section with no sub-11px visible route text. Measured union image coverage is approximately 69–80% for desktop/tablet narrative bands and higher for full-canvas/mobile bands. Cadence was reduced from roughly 21k to 17–19k pixels depending on viewport without dropping content or media.

Production build, focused ESLint, Prettier, diff checks, exact 21-asset SHA/byte/file-set verification, macOS Vision no-text media audit, and matched-camera feature-distance evidence remain valid. The shared contractor purchase CTA remains intentionally disabled by the current fail-closed checkout state. Full repository TypeScript still has the unrelated pre-existing Stripe API-version literal mismatch at `src/lib/stripe.server.ts:74`. No migration, deployment, commit, push, or production state changed. Preview remains `http://localhost:8080/templates/painter10`.

---

## 2026-09-05 — Painter10 Midnight Lacquer local template

Implemented the local-only `/templates/painter10` Midnight Lacquer painter website and catalog entry. It preserves the shared True Coat homeowner content, simulated `SiteBookingPayDemo`, and `DemoLpChrome` contractor-purchase seam while introducing a distinct finish-dossier system: Italiana + Instrument Sans typography, obsidian/oxblood/champagne/pearl palette, razor-edged continuous showroom bays, serial finish notation, full-image translucent information rails, stacked matched-camera proof reel, and a cursor/keyboard finish-inspection light that moves through matte, satin, gloss, and high gloss. Reduced motion uses the static poster and removes the video; no hero pause control was added.

Generated and locally optimized 20 stills plus one silent 6.04-second H.264 hero film through the authenticated Higgsfield CLI. The exact 21-file set, byte lengths, and SHA-256 hashes match `public/templates/midnight-lacquer/media-ledger.json`. macOS Vision found no readable text in the final still set; two rejected journal images were regenerated after the first pass detected accidental lettering/off-brief automotive classification. The paint-only pair is source-referenced and Vision feature-print distance confirms it is substantially closer to its source (`0.310`) than two unrelated room images (`0.738`, `0.717`).

Recursive desktop/tablet/mobile UI audits corrected image-canvas specificity, narrow-screen text-band drift, sub-12px essential first-fold/caveat text, service/process/planning/journal image ratios, review-source sample labeling, and dock/footer clearance. Final Chromium evidence across 1600x1000, 1280x800, 820x1180, 390x844, and reduced-motion 390x844 showed exact canonical/noindex metadata, no horizontal overflow, every rendered image loaded, no pause control, no undersized route control, no console/page/request errors, working pointer/click/keyboard finish changes, reduced-motion static media, catalog click-through, no purchase-dock overlap, and homeowner booking through simulated payment to no-charge completion with focus return and no card fields. The shared contractor purchase dock is present but disabled by the repository's current fail-closed checkout availability; Painter10 does not bypass it. Production build, focused ESLint/Prettier, diff checks, canonical production-pricing verification, and SaaS checkout-security verification pass. Full `tsc --noEmit` remains blocked only by the pre-existing unrelated Stripe API-version literal mismatch in `src/lib/stripe.server.ts:74`. No migration, deployment, commit, push, or production state changed. Local preview: `http://localhost:8080/templates/painter10`.

---

## 2026-09-05 — Local environment-file inventory

Checked filenames only and found `.env`, `.env.local`, and `.env.example` at the repository root. Their contents were not read or exposed. No application or production state changed.

---

## 2026-09-05 — Higgsfield CLI access verified

Verified that `higgsfield` is available at the active Node installation and reports version `1.1.24`. An authenticated `higgsfield account status --json` request completed successfully with its output suppressed, so local credentials are usable without exposing account details or tokens. No generation job ran, no credits were consumed, and no application or production state changed.

---

## 2026-09-05 — Repository context refreshed

Read the complete current `cursor.md` and `journal.md` before further work. The active agreement requires evidence-backed root-cause/general-case fixes through existing seams, minimal architecture, end-user framing, no speculative compatibility or transitional debt, and a journal update after every turn. Production migrations remain strictly gated by PR review, the user's explicit post-merge authorization, allowlist/checksum verification, dry run, apply, ledger/behavior verification, and replay protection. No application code, migration, deployment, or production state changed.

---

## 2026-09-05 — Template and working-agreement context review

Read `plans/template.md`, `cursor.md`, and the full current `journal.md` before further work. The active template contract requires a bespoke, image-first design system, distinct homeowner-booking and contractor-purchase seams, truthful sample content, local optimized media, responsive designer review, and deterministic plus browser verification. The repository working agreement requires root-cause/general-case fixes through existing seams, evidence-backed claims, minimal architecture, explicit end-user framing, and strict PR review → user merge confirmation → allowlist/checksum dry run → apply → replay handling for any production migration. No application code, migration, deployment, or production state changed.

## 2026-09-05 — User-confirmed Stripe sandbox offer activation

The user supplied the exact sandbox mappings for Starter (`price_1U90KGEjgAPzsVsTmS6lgHnQ` / `prod_V9Iw1h1tesmf0h`) and Pro (`price_1U90KYEjgAPzsVsTLzMO54Sd` / `prod_V9IwztC1fi8sqi`) and asked to prepare the current unused deployment for sandbox testing. Added forward-only migration `20260905181159_activate_sandbox_saas_offers.sql`, which labels the user-confirmation time rather than asserting an independent Stripe API observation, registers only the canonical test $79/$129 monthly tuples, activates them only from empty test routes or exact replay, and leaves live routes unchanged. It creates no Checkout Session, subscription, payment, or charge. Added exact static and local PostgreSQL behavior checks for tuple/provenance/readiness, unchanged live routes, unchanged checkout/subscription counts, exact migration replay, and rejection of a conflicting active test route. The existing offer lifecycle fixture now acquires the global registry lock before transaction-local route isolation. Current `main` had again lost SQL-backed null/range semantics during generated-type refresh, so added a separate semantic type contract and immediate-RPC adapter rather than editing generated `types.ts` again; raw schema inventory remains generator-owned while the three affected call sites now use actual nullable values and non-null range results. Strict types, root TypeScript, checkout security, pricing, Bucket 3, full Bucket 1 generation, production build, focused lint/format, and the full disposable PostgreSQL migration/behavior replay pass. This is PR-only work and must remain unapplied until review, merge, the user's separate post-merge authorization, production allowlist/checksum verification, exact dry run, apply, behavior/ledger verification, and replay rejection.

---

## 2026-09-05 — PR #110 generated-contract CI repair

The four failed checks were one duplicated static failure: every PostgreSQL 16/17 and bootstrap-role matrix leg ran `pnpm verify:bucket3` before its database test, and the current `main` Supabase snapshot failed three strict semantic assertions. Preserved the expanded current 94-table/316-function snapshot rather than restoring the older 293-function file. Restored the migration-backed nullable `ingest_provider_event` arguments, textual non-null `tstzrange` transport across the appointments table and all appointment-returning RPCs, and nullable compare-and-swap predecessor for initial SaaS offer activation; added strict assertions across those surfaces and removed the now-unneeded local casts. Corrected the stale booking-payment cardinality assertion to the actual PostgREST metadata: the composite FK is not itself an exact unique key, so embeds are arrays even though the separately asserted `unique (appointment_id, environment)` guarantees at most one payment row; the UI now consumes only that array shape. Moved the unchanged Bucket 3 static gate to the source-contract job and release proof so it runs once, while all four matrix legs now execute only their PostgreSQL-sensitive worker-role behavior. Strict types, Bucket 3, full Bucket 1 generation, production pricing/checkout security, production build, focused lint/format, and a local PostgreSQL worker-role replay passed. A malformed local Playwright cache was removed; the browser-unavailable runtime contract then passed without downloading Chromium. GitHub Verification run `33961094238` passed source-contract, booking-safeupdate, and all four PostgreSQL 16/17 × postgres/managed-bootstrap jobs on repair commit `30ce03c`. No migration or production state changed.

---

## 2026-09-05 — Stop tracking local environment credentials

Removed the tracked root `.env`, added ignore rules for `.env` variants while retaining the placeholder-only `.env.example`, and changed the two scripts with explicit dotenv readers to use ignored `.env.local`. Added empty `AGENT_LOGS_TOKEN` and `MIGRATION_RUNNER_SECRET` example entries and documented that local credentials belong only in permissioned `.env.local`; session logs are now ignored because command diagnostics can capture credentials. The local credential files under `.agent-secrets/` were consolidated outside Git and are not part of this commit. This forward cleanup does not erase published history, so both exposed operational credentials still require rotation in Lovable Cloud and replacement in local `.env.local`. No production credential, deployment, database, or runtime state changed.

---

## 2026-09-04 — Template purchase chrome + Painter8

`DemoLpChrome` bottom bar is now a floating purchase CTA only — no white strip, contractor copy, or checkout-disabled helper text. Painter8 (Candy Capsule Lab) ships with catalog card, route, media, and the plan/FAQ/hero layout pass. Preview: `http://localhost:8080/templates/painter8`

---

## 2026-09-04 — User-confirmed initial live SaaS offer activation PR

The user confirmed both exact live Stripe Price/Product mappings directly in the Stripe Dashboard and explicitly directed this work to start from a narrow forward-only activation migration, without a separate API audit or durable receipt. Created `20260904141500_activate_live_saas_offers.sql`: it registers only the canonical $79 Starter and $129 Pro monthly USD contracts, uses the UTC time of the user confirmation as a clearly labeled confirmation timestamp (not an asserted Stripe API observation), acquires the registry lock, allows initial activation only from empty live routes, and fails closed on any different existing route. It does not create Checkout Sessions, customers, subscriptions, payments, or charges.

Added static exact-tuple/no-charge verification and local PostgreSQL behavior coverage for empty-route live activation/readiness. Passed the activation verifier, checkout security suite, strict type verification, full source TypeScript check, and local booking migration test suite. This is PR-only work; it must not be applied until reviewed, merged, and separately authorized under cursor.md's mandatory dry-run → apply → replay order.

---

## 2026-09-04 — PR #105 CI repair and live-offer activation safety review

Repaired the five failing PR verification jobs by restoring the last source-compatible committed Supabase generated contract snapshot, rather than hand-patching a 10,572-line unproven regeneration. The schema verifier now recognizes PostgreSQL `xid8` columns and bracket-quoted generated properties. Strict generated-contract assertions now protect the `tstzrange` transport type, `xid8` field, and one-to-one booking-payment relationship shape. Root TypeScript, strict `verify:types`, production build, production pricing, checkout-security, full source-contract generation suite, and the PostgreSQL 16 local booking-worker/booking migration replay pass.

The independent adversarial review found the proposed live activation migration was unsafe to approve: it had no reviewable successful Stripe catalog receipt, recorded database apply time as provider observation time, deadlocked against concurrent rotation, allowed a concurrent exact-install unique race, and could silently restore a stale price route. The unverified live activation migration was therefore removed from this PR; no live offer contract was applied and checkout remains fail-closed until a receipt-backed activation PR exists.

Added forward-only, local-tested hardening migrations for the committed migration runner (global transaction advisory lock before all ledger reads/writes) and owner-only offer registry writers (registry-first lock ordering, all-constraint exact-install convergence, provenance equality, installation-evidence requirement, and compare-and-swap rotation with an explicit predecessor). Local behavioral coverage now races two applies and two exact installations successfully, alongside dry-run → apply → replay and stale-route rejection. These hardening migrations themselves remain unapplied to any deployed database and still require review, merge, a separate user apply authorization, exact checksum dry run, apply, and replay verification.

---

## 2026-09-02 — Production subscription pricing contract

Implemented the confirmed current offer: Starter $79/month for the website and Website Leads; Pro $129/month for the website plus Google Calendar booking and visitor payments through Stripe Connect; no setup fee. Centralized plan amounts/copy, updated all production UI/SEO/admin/template surfaces and the current payment specification/README, while leaving dated historical journal and migration records unchanged.

Hardened subscription charging so configured Starter and Pro Stripe Price IDs must be distinct and each retrieved Price must be active, single-currency USD, fixed per-unit, licensed rather than metered, monthly recurring, interval count one, and exactly 7900/12900 minor units before Checkout creation. Checkout pins USD and disables adaptive pricing. Browser-return and signed checkout-completion reduction independently require one quantity-one line item, matching local/provider plan evidence, and authoritative USD subtotal/total with the same Price contract before granting entitlement.

Revised MSA and DPA to version 1.1 so the accepted documents match the two current tiers, monthly-only/no-setup-fee billing, persistent lead records, the absence of a current lead-email monitoring copy and contractor-specific deployed legal notices, Pro Google Calendar/Pipedream/Stripe Connect flows, subprocessors, retention posture, and current permission/document-delivery behavior; synchronized exact SHA-256/byte acceptance receipts. Added executable pricing/provider/legal verification to payment acceptance and added both that verifier and the checkout safety/legal-byte verifier to PR/release workflows.

No migration was added or applied. No Stripe Price ID, secret, provider registration, live charge, booking admission, worker, or schedule was enabled. Safe rollout gates remain unchanged: SAAS_LIVE_CHARGING_ENABLED=false, BOOKING_LIVE_ENABLED=false, and BOOKING_WORKER_MODE=off until production provider and migration evidence passes.

---

## 2026-09-02 — Painter 4 recursive UI-system audit

- Reopened the local-only Painter 4 implementation after user review; no commit or push is authorized.
- Read `cursor.md` before acting. The root issue is architectural rather than a list of isolated spacing defects: Painter 4 currently expresses its content through repeated rectangles—overlay panels, cards, contact-sheet frames, bordered fact cells, ledgers, and accordion rows—so even strong imagery inherits a familiar LP/card grammar.
- The replacement direction will use a continuous **worktable manuscript**: full-bleed or freely cropped imagery, curved/fanned swatch movement, marginal annotations, staggered type baselines, tool-line rules, and overlapping paper/canvas fragments without card containers. Information remains legible and truthful, but geometry should feel assembled by a craftsperson rather than placed into a component grid.
- User explicitly requested removal of first-fold pause controls from both Painter 4 and Painter 3. Preserve reduced-motion still fallbacks; remove the controls and associated dead state/import/CSS rather than merely hiding them.
- Next: audit actual desktop/mobile output recursively, refactor the global visual grammar, then validate content, media, accessibility, booking, and both painter routes.
- Implemented the root fix as one worktable-manuscript grammar: open ruled actions, fan-deck pivot, torn/capsule image leaves, alternating margin annotations, connected arched process apertures, joined curved comparison lens, dot-led facts, and a horizontal mobile page index. Removed nested dark overlays, bordered cells, Polaroid shells, card grids, and boxed action language.
- Removed Painter 3 and Painter 4 first-fold pause controls at source (imports, state, handlers, markup, and dead CSS). Because both generated films are 5.04 seconds, changed them from infinite loops to muted one-shot playback so removing the control does not create an inaccessible perpetually moving region; reduced-motion still fallbacks remain.
- Recursive evidence found and resolved: overlong service cadence, process captions/disclosure colliding with the shared purchase dock, sub-11px informational typography, cross-template Google/Yelp trust-logo leakage in empty review roles, and a curved diptych mask clipping its first caption.
- Deterministic nested-scroll screenshots were used because DemoLpChrome owns the overflow container; shared top disclaimer and bottom purchase dock were explicitly treated as host chrome, not route defects.
- Final evidence: 8 browser scenarios passed across Painter 4 wide/desktop/tablet/mobile plus reduced motion/catalog/content/booking and Painter 3 desktop/mobile/reduced motion; every route-owned interactive target is at least 44px; no horizontal overflow, hidden-content clipping, runtime errors, card-credential fields, or pause controls; visible Painter 4 leaf text has an 11px minimum; both videos stop at 5.04s; independent final UI audit found one caption-clipping issue and the fix was mathematically verified at desktop/mobile.
- The final responsive audit additionally found and closed the 561–900px section-nav gap, an unnamed/clipped process rail at 901–1000px, clipped fan tabs, low-contrast note copy, stale looping ARIA, a generated comparison mislabeled “Documented,” missing intrinsic image dimensions, under-12px essential caveats, and the 5.04-second motion threshold. Both films now stop near 4.5 seconds; the process rail is named, focusable, instructed, and snapped; all twelve breakpoint seams from 390–1600px pass.
- Moved the canonical route from `/painter4` to `/templates/painter4`, preserved `/painter4` as a 308 compatibility redirect, and updated the `/templates` catalog card to the nested href while retaining its visible `painter` chip. Browser verification passed canonical/noindex metadata, redirect destination, exact catalog chip/card/href, and click-through.
- Final static gate passed Prettier, targeted ESLint, full TypeScript, exact 20-asset ledger SHA/byte/file-set/rights validation, no-pause-control source scan, diff whitespace, and full client/SSR production build. Work remains local and uncommitted.

## 2026-09-01 — PR #72 integrated through current main and PR #91

Merged current `origin/main` through `4ae574f315a1ec85c6a56062684a94ba9ed4cdf1` into `fix/payment-buckets-1-3` without rebasing or rewriting history. Current main remains authoritative for generation, chat, media, provider-wait, job lease/fencing, and bound Supabase RPC semantics, including PR #91's eight-minute still wait from media claim and pulse-leftover deferral. Payment code is layered only through its product, security, workspace, route, environment, migration, and generated-contract surfaces.

The semantic overlap review bound lead, appointment, entitlement, chat, onboarding metadata, and agent mutations to the selected website. Strict Stripe readiness remains the booking-admission authority, while “My Payments” remains available under recoverable degradation when the reconciled account and completed-onboarding prerequisites still support a dashboard link. The combined Supabase contract was regenerated/reconciled to 89 tables across 124 repository migrations while retaining exact payment RPC compile-time assertions and current-main generation/runtime contracts.

Evidence: `BOOKING_TEST_PG_PORT=55530 pnpm verify:payment-acceptance` passed, including the populated historical checkout regression, provider mocks, three Chromium fixture flows, and a fresh PostgreSQL 15 combined semantic-revision replay with payment/admin SQL smokes. The replay deliberately applies each canonical/Lovable-aliased Bucket 1 generation revision once, selects the unique `20260829093506` hosted-history compatibility patch, and applies forward closure `20260901100000_restore_gacha_yield_after_lovable_alias.sql` so the late Lovable mirror cannot erase contract-3 identity or planning-wait semantics; every published migration file remains untouched. `pnpm test:bucket1-generation`, `pnpm verify:workspace-lifecycle`, nonincremental TypeScript, generated-contract parity, production build, focused ESLint, and diff checks passed. This is local/static/mock evidence, not hosted migration/provider/security acceptance. No Cloud migration, live charge, provider registration, booking admission, worker, or schedule was enabled; rollout remains NO.

---

## 2026-09-01 — PR #91: stills wait like Add Video

Opened https://github.com/satyavva/obra-tech/pull/91 (`1a65029` on `fix/still-wait-like-video`). App-only; no migration.

---

## 2026-09-01 — Vet: still wait like Add Video

Confirm stills get 8 minutes from the media claim, not from job enqueue. Add Video can use `created_at` because that job is the media wait; site generation includes photo wait before stills. Pulse leftover still yields instead of starting a still. Chat drain still has no pulse deadline. No migration.

---

## 2026-09-01 — PR #90: stills wait for the gateway

Opened https://github.com/satyavva/obra-tech/pull/90 (`7a0f524` on `fix/still-wait-for-gateway`). App-only; no migration.

---

## 2026-09-01 — Stills wait for the gateway again

Confirm was dying on “creating media” because the still POST aborted itself at 45s and parked the hero in reconciliation. Chat already keeps that request open; the extra timer was the cut. The image call now waits for the gateway or for the user to leave. Cron leftover can still hit the 50s pulse. No migration.

---

## 2026-09-01 — PR #89: generate on chat SSE

Opened https://github.com/satyavva/obra-tech/pull/89 (`ff5ab66` on `fix/generate-on-chat-sse`). App-only; no migration.

---

## 2026-09-01 — Vet of generate-on-chat SSE fixes

Progress attaches at enqueue (`tool_end` before drain), so Confirm shows the existing job bar while the stream stays open. The JSON pulse still uses `deadlineSignal`; a closed tab is a cooperative abort, not `invocation_deadline`. Chat already returned SSE; comment pings are ignored by the client parser. No second open PR for this intent. No migration.

---

## 2026-09-01 — Vet: generate-on-chat SSE

The page write is on the existing chat stream with an immediate byte, then 15s pings, and this site’s job is drained without the 45s pulse cut. That matches the product split. Two gaps were real and are fixed: chat hid generate progress until the page was done (Confirm would sit on “Running generateVariants…”), and closing the tab was labeled as the pulse deadline. Leaving still stops this request; leftover work can hit the short pulse. Host wall-clock is unchanged. No waitUntil, no new endpoint, no migration.

---

## 2026-09-01 — Generate stays on the chat stream

Confirm/Regenerate used to enqueue and hang up. Page write then ran on the 45s JSON job pulse and died at “Composing the page…”. Chat now keeps the existing SSE open, sends a 15s ping so proxies do not idle-timeout, and drains this site’s generate job on that request without the pulse deadline. Cron still heartbeats admission and can pick up leftover work if you leave. No migration.

---

## 2026-09-01 — PR #88: gacha-only look

Opened https://github.com/satyavva/obra-tech/pull/88 (`80ac73c` on `fix/gacha-only-look`). App-only; no migration.

---

## 2026-09-01 — Vet: gacha-only look path

Read the live generator, checkpoint parser, execute, persist SQL (`20260830200000`), publish, and Add Video. New generate always draws a lock, saves only that lock, and writes `{ gacha }` on the page. Resume after planning requires that lock. A leftover planner snapshot is an unknown checkpoint field, so those jobs fail closed. Persist matches the whole composed candidate and does not need a stored plan. Old published pages that still have a plan essay keep publishing and Add Video; new pages use section markers. Photo wait still keys off contract 3 because new jobs enqueue as 3. The unused planner prompt text is leftover documentation, not a second look path. No migration.

---

## 2026-09-01 — Generate has one look path: gacha

A rebuild could lock a gacha look and still write the old planner snapshot next to it. Resume then rejected the job because a look must be exactly one of those two. Generate now only draws, saves, and resumes a locked look. The writer still receives in-memory slot recipes from that pack; published pages carry `gacha`, not a stored plan essay. In-flight planner jobs fail closed; start a new generate. No migration.

---

## 2026-09-01 — Regenerate must not re-scrape; Cancel must stop generate and enrichment

Regenerate was sitting on “Waiting for business photos…” because gacha treated zero attested stills as “run Firecrawl again,” even when research was already complete and the user only asked for a new look. Cancel all jobs did nothing: it cancelled `activeChain`, which was the newer Enrichment chain, and that path requires a site-generation request id.

Generate now enqueues a photo scrape only for an **initial** build whose research is not complete. Regeneration always draws from frozen context (including a zero-photo pack). Frozen context requires `generationKind` so a regenerate cannot fall through to the first-build scrape. Cancel all jobs targets the generate chain the header is tracking, uses the live `claim_epoch` so the wait loop cannot miss, then cancels leftover enrichment on that site. No migration.

Vet: identity CHECK `request_id = generation_request_id` so the cancel lookup is the same id the UI sends. Panel Cancel is only on active site generation; cancelled cards only Dismiss, so cancelling enrichment is not reachable from an old row. In-flight waits that already set `scrapeEnqueued` still need one Cancel after this ships, then a new regenerate.

---

## 2026-08-31 — Applied identity-check admission migration

PR #86 is on `main` (`16c7175`). Production allowlist listed `20260831200000_admit_gacha_generation_identity.sql` with checksum `604c562440638bb516853c0bb9b79e3a8fb399eb2f80b30a3720819fa9945c8c`. Dry run returned `dry_run_ok`. Apply returned `applied`. Replay returned `409 already_applied` at `2026-08-31T15:43:41Z`. Start a new generate; do not retry the 13:57 traces.

---

## 2026-08-31 — PR #86 merged; identity-check migration not yet on production allowlist

User confirmed merge of #86 (`16c7175`, 15:20:37Z) and authorized apply. Local/origin checksum for `20260831200000_admit_gacha_generation_identity.sql` is `604c562440638bb516853c0bb9b79e3a8fb399eb2f80b30a3720819fa9945c8c`. Production `POST https://obratech.co/api/internal/apply-migration` `{list:true}` still has 96 files ending at `20260831180000_gacha_generation_admission.sql`. No dry-run or apply. Retry after Lovable publishes main.

---

## 2026-08-31 — Vet of identity-check admission (#86)

The new CHECK body is the live `20260829150000` predicate with only `generation_contract_version` widened to `in (2, 3)`. Claim (site_generation classes 0/3) does not pin version. Execute already accepts versions 2 and 3. VALIDATE is a relaxation of `= 2`, so existing epoch-2 rows still pass. Mapper logs RPC fields and maps identity-check / check-constraint `23514` without swallowing tenant-identity `23514`. No extra bystander that would block a new generate after apply. Apply remains after merge + confirm; app-only merge does not enqueue.

---

## 2026-08-31 — Admit contract 3 on the generation identity CHECK

Regenerate and chat rebuild both died at enqueue with “Unable to enqueue site generation job” and no `site_generation` row. PR #85 and migration `20260831180000` admitted contract 3 in the enqueue function; `background_jobs_generation_identity_check` still required `generation_contract_version = 2`, so the insert (and every later update of a contract-3 row) failed check `23514`. The mapper only recognized runner-offline and already-active, so chat paraphrased a generic enqueue failure.

Forward migration `20260831200000_admit_gacha_generation_identity.sql` copies the live identity CHECK and allows versions 2 and 3. Enqueue now logs RPC `code`/`details`/`hint` and maps identity-check / check-constraint `23514`. Apply that migration on `https://obratech.co/api/internal/apply-migration` after this PR is merged and you confirm apply. Until then, new generate still cannot enqueue. Start a new generate after apply; do not retry the 13:57 traces.

---

## 2026-08-31 — Vet: 15 openings were named; two were not executable

The 15 first-band treatments are new names, not the named-layout list. The vet found they were not fully implemented: chorus and spine described a procession/spine of real photos but the media recipe still emitted two generic proof slots; the portfolio family forced every opening, including dispatch and horizon, to need two project photos. Chorus/spine now carry three proof frames of their own shape. Photo need follows the opening, not the family. Family mobile is scoped to later bands so it cannot turn a ticket into a poster.

Density still only adds a second still. Lantern remains the closest cousin to type-on-photo; fold to a split. Apply `20260831180000_gacha_generation_admission.sql` in Lovable after merge and your confirm.

---

The first band was five catalog-shaped buckets (overlay / split / stacked / gallery / type-led) with one shared atmosphere prompt, so tickets could share an id pattern and still open the same way. Replaced that axis with 15 authored openings (billboard, keyhole, dock, diptych, triptych, capstone, inset, spine, chorus, horizon, fold, specimen, dispatch, lantern, cascade). Each has its own spatial rule, crop, and image prompt. Drum is 10 families × 15 openings × 4 densities = 600. Density still only changes spacing.

Last turn’s wait fixes still stand: planning may wait like media does; wait includes photo persist (`finalizing`); a requested look id is not replaced after scrape. Those need migration `20260831180000_gacha_generation_admission.sql` applied in Lovable after merge and your confirm. Writer section markers remain prompt-binding, not a stored plan.

---

The pipeline matches the product split: chat calls `generateVariants`, Confirm/Regenerate stay closed on that same tool, and the generate job draws a locked look instead of grading a design essay. First builds with no owned photos could not actually wait in that job — planning was only allowed to jump to media, so a scrape wait looked like the generate was cancelled. Photo copy-in-progress (`finalizing`) was treated as “no scrape running,” which could start a second scrape and cancel the copy. A look id the chat already picked could be replaced by a 0-photo look after scrape.

Folded planning→planning into the existing unapplied `20260831180000_gacha_generation_admission.sql` (same seam media already uses). Wait now includes photo persist. Requested look ids stay locked. Writer is told to put `data-site-section` on section roots so Add Video can read the saved page. 200 look tickets exist as family×hero×density; atmosphere prompts are shared — count is met, “200 actually different pages” is not proven.

Apply that migration in Lovable after this PR is merged and you confirm apply. Until then live enqueue still rejects contract 3, and photo wait cannot yield.

---

## 2026-08-31 — Chat owns generate; the builder draws a look

The stall was not a missing prompt tweak. Chat was forbidden from starting generate, the server auto-started a job with an empty instruction box, and a second model had to emit a graded design-plan essay before any page existed. Those were one mismatch: look and photos were treated as a plan the host had to accept.

Chat can now call `generateVariants` (the Confirm / Regenerate buttons still invoke that same tool directly). The generate job draws one locked gacha pack, waits on scrape inside the job if owned photos are missing, joins only attested proof files, and writes the page. New versions carry `gacha` + `mediaManifest` + markers in `themeSource`. Add Video and publish read that, not a stored plan essay. In-flight planner jobs (contract 2) finish on the old machine.

Apply migration `20260831180000_gacha_generation_admission.sql` in Lovable after this PR is merged and you confirm apply. Until then, new generate enqueue will be rejected by the live RPC that still requires contract version 2.

---

## 2026-08-31 — Planning still fails after prompt/parser alignment (#84)

**Problem.** A site cannot leave “Choosing a design direction…” until the server accepts a design plan. Today the builder writes that plan as freeform text; the server then checks it against a strict checklist. If the write-up does not match, the site never gets built — even when the words in the instructions already described the checklist. PR #84 aligned those words with the checklist and put the real failure reason on the job row. That was necessary but not sufficient.

**Evidence after #84 merged** (`9750f53`, 21:06Z). VSA CONSTRUCTION (`990233`), trace `5675bfc4`, job `0b4df708`: three planning tries, 22%, no saved plan, `site_generation_exhausted:unified-design:plan operational validation failed`. Chat trigger was the canned regenerate line; instruction stayed empty. Not the old chat-preference reject, not a provider crash (`interruption_count=0`), not missing photos at this stage (16 scrape URLs, zero owned files — that is a later wall). INTERNATIONAL WATERPROOFING’s last fail (`97910ea0`, 20:31Z) was the unnamed sentinel before #84; do not treat it as proof of the same throw.

**Root cause deprecator (next, not band-aid).** Stop treating worded instructions as the rules. The checklist the server already uses (`currentUnifiedPlanSchema`) must be what the builder is allowed to fill in — schema-constrained decode on the planner call. Not looser validation, not more prompt English, not logging Zod paths after rejection. Until that ships, expect more “We could not finish this website” at planning despite aligned prompts.

---

## 2026-08-31 — Plan prompt matches the plan parser

Regenerate died at “Choosing a design direction…” after three planning tries with `site_generation_exhausted:unified-design`. The plan prompt marked `generationPrompt` optional and wrote purpose labels the parser does not accept (`Visual`, `host operations`). The parser already requires a prompt on every generated/either slot and only accepts `visual` / `host-operation`. The prompt now interpolates those enums and states the same generationPrompt rule; the slot shape does not list generationPrompt as always present. Exhausted errors now put `lastFailure` on `error.message`, so the job row names provider vs JSON parse vs operational validation instead of dropping it. No migration. Start a new generate after merge.

---

## 2026-08-31 — Applied empty-instruction freeze migration

PR #83 is on `main` (`c91f656`). Production allowlist listed `20260831010000_freeze_generation_instruction_empty.sql` with checksum `96bb500a680e24b573f2197106e2f00318b99d319aef63bd157a895bc6f6a66f`. Dry run returned `dry_run_ok`. Apply returned `applied`. Replay returned HTTP 409 `already_applied` at `2026-08-30T20:30:29.730093+00:00` with the same checksum. Start a new generate; do not rewrite old frozen jobs.

---

## 2026-08-31 — Generate does not fail-closed on the chat line

Regenerate was dying in context because the frozen chat sentence was run through the design-preference checker. Context now starts from empty default preferences. The checker is unchanged. The empty box is not a missing brief — look-and-feel stays on the saved setup, and the builder still chooses the rest.

The leftover lie is gone: generate no longer copies the chat hash onto that box, and the checkpoint no longer requires preferences to prove they were parsed from the chat line. New jobs freeze `instruction` as empty; the bubble stays on the agent turn. Apply migration `20260831010000_freeze_generation_instruction_empty.sql` in Lovable after this PR is merged and you confirm apply. Merged PR ≠ live DB. Extra notes are not re-filed as a generate brief.

---

## 2026-08-31 — Bind Supabase RPC on the job runner

Production regenerate claims died in under a second with HTTP 500 `Cannot read properties of undefined (reading 'rest')`. The chat turn had already finished; the job wrote 10% then the runner crashed, so the row stayed running and the card kept saying queued. Supabase implements `.rpc()` as `this.rest.rpc(...)`. Helpers that did `const rpc = supabase.rpc; rpc(name, args)` dropped `this`. All of those calls now go through `callSupabaseRpc`, which invokes it as a method. This unmasks the first context error instead of swallowing it; it does not by itself finish a website. No migration.

---

## 2026-08-30 — Vet: copy off generate; drop backfillNext walker

The split matches the decision: generate overlays live `storagePath` onto the frozen URL set and does not fetch; research finalize still calls `persistScrapedSiteMedia`; historical copy is persist-per-website on the existing repair endpoint, fail-open, 25s, not a new job.

The vet found one load-bearing miss in the backfill I added: `backfillNext` was a second walker. Its cursor was license-number keyed, so a second website on the same license would be skipped, and the 25s abort started before the list scan so persist could no-op. That is not “persist per website.” Removed. Fleet copy is `listAffectedLicenses` then `persistEnrichment` per `websiteId` until `imagesRemaining` is 0. Remaining is counted from the live profile after write-back, not from persist’s in-memory return. If that re-read fails, remaining stays at the pre-copy count so the operator retries instead of treating the site as done.

Full repair still forks live versions and does not set `proofEligible`, so generate’s usable-photo filter would still skip those files. Use persistEnrichment, not full repair, for this copy. Start a new generate after files exist. No migration.

---

## 2026-08-30 — Copy stays off generate; persist on research and per-site backfill

Generate froze on “Checking business photos…” because context downloaded scrape URLs inside the 45s job budget and never yielded. Building a site now only uses photos already in `site-media`: it overlays live `storagePath` onto the frozen URL set and does not fetch. Copy stays where it belongs — `persistScrapedSiteMedia` when research finishes — and that persist fail-opens on abort instead of hanging the scrape job.

Existing contractors with URL-only enrichment (this one included) use the existing `/api/internal/repair-contractor-media` seam: `persistEnrichment: true` copies one website. Same persist path, fail-open, 25s budget, not a new copy job and not a fleet cron. Full repair still forks live versions; persistEnrichment only writes enrichment files.

`pnpm test:bucket1-generation`, `verify-site-evidence`, `verify-site-theme`, and `verify-media-repair` pass. Start a new generate after files exist. No migration.

---

## 2026-08-30 — Applied freeze contactHidden migration

PR #80 is on `main` (`85ebe3c`). Production allowlist listed `20260830210000_freeze_contact_hidden_boolean.sql` with checksum `48aa233417b56e635924d31320270d8ff3b59b8c5c317e3bec9b8d9717fed191`. Dry run returned `dry_run_ok`. Apply returned `applied`. Replay returned HTTP 409 `already_applied` at `2026-08-30T16:14:24.340316+00:00` with the same checksum. Start a new generate; do not rewrite old invalid jobs.

---

## 2026-08-30 — Holistic vet of freeze/persist

Merged `main` after #79 (admin research dossier). The only conflict was `journal.md`; both entries stay. `verify-site-evidence.mjs` auto-merged: persist reuse test plus listed-website URL classifier asserts. Opened PR #80.

Plan matches the branch: omitted `contactHidden` freezes as JSON `false`; the parser stays strict; owned enqueue is untouched; invalid checkpoints settle from the raw row without re-parse; persist/repair use Workers `fetch` for public `http(s)` (no host allowlist); generate copies frozen URL evidence into `site-media`; regenerates use frozen enrichment stills; preview still only signs owned paths.

The vet found one load-bearing persist hole: persist used to return the live profile merge, which could pull post-freeze scrape photos into this generate, and later stages re-downloaded the same URLs. Persist now overlays live `storagePath` onto the frozen URL set, skips re-fetch when those files already exist, writes the profile as a side effect, and returns the frozen-shaped enrichment. `pnpm test:bucket1-generation` and the evidence/media verifiers pass.

Honest leftovers, not misses: old invalid jobs are not rewritten; existing drafts with stripped gallery URLs need a new generate; explicit JSON `null` `contactHidden` still fails the parser; Cloudflare DNS rebinding is the named SSRF residual; a failed settle RPC can still leave a running lease. Do not apply `20260830210000_freeze_contact_hidden_boolean.sql` until merge and explicit confirmation.

---

## 2026-08-30 — Freeze contactHidden and persist URL evidence

Website generate was stuck at 0% because freeze SQL stored JSON `null` for omitted `contactHidden`, the worker threw `Invalid generation checkpoint: contactPolicy contract`, and execute re-parsed the same checkpoint in `catch` so the job stayed `running` until the 10-minute lease. Preview showed no photos because persist never copied evidence URLs on the Cloudflare runner (CDN-suffix gate), and regenerates used only empty/URL-only version slots.

Forward migration `20260830210000_freeze_contact_hidden_boolean.sql` coalesces `contactHidden` to JSON `false`. Invalid checkpoints settle fail-closed from the raw row without re-parse. Persist and repair fetch public `http(s)` URLs via Workers `fetch` (private IP literals still rejected; no host allowlist growth). Generation context copies those bytes into `site-media` and regenerates use frozen enrichment photos. Preview still only signs owned paths.

`pnpm test:bucket1-generation` passes. Apply the new migration on `https://obratech.co/api/internal/apply-migration` after merge and explicit confirmation — merged PR ≠ live DB. Start a new generate; do not rewrite old invalid jobs.

---

## 2026-08-30 — RCA: regenerate stuck on “Queued site generation…”

Production traces for INTERNATIONAL WATERPROOFING (`license 739431`, website `222de4bf-…`): closed `regenerate_variants` turn `c180b292-…` completed in ~2.4s with no error and enqueued site-generation job `8c6e06d4-…`. Eleven seconds later `/api/internal/run-jobs` claimed it (`obra-runner-production`, `claim_epoch=1`, epoch 2). Minutes later the row was still `running`, `generation_stage=context`, `progress_pct=0`, `status_message` still the enqueue copy “Queued site generation…”, `stage_attempts=0`, `locked_at`/`lease_expires_at` frozen at the claim instant (no 15s lease renew). Execute’s first write would have been 10% “Checking business photos…”. Context itself is cheap (normalize + yield). The UI is truthful. The job is an orphaned running lease: later cron ticks cannot reclaim it until the 10-minute stale window. This is not the old Chrome `browser_ready` admission failure (yesterday’s row on the same site was `epoch2_runner_capability_unavailable`; this row was claimed). Concurrent All Weather `admin_auto_kickoff` errors are a different website/path (Firecrawl 402 on enrichment). No implementation this turn.

---

## 2026-08-30 — Vet of admin research dossier

A plan-vs-code pass found two load-bearing bugs: platform cards used Firecrawl’s first hit (so Google could show a different contractor than the identity-gated listed website), and `website` fields without `https://` became in-app relative links. Cards now use the matched hit and absolute http(s) hrefs. Empty unmatched rows are dropped.

A follow-up vet found the same first-hit extract leak still in the listed-website walk and unmatched-hit display (`record.extract` is the first hit). Those paths now use only that hit’s extract. Unmatched listing links also go through `httpHref`. Residual: `getEnrichmentSummary` still has no job-state, so a live re-scrape can look finished to the agent; a news-site `hit.url` can still classify as custom; this env could not click Information on a real workspace (no service role).

---

## 2026-08-30 — Admin research dossier and listed-website detection

Admins opening a contractor workspace get an Information control that loads stored Firecrawl enrichment: listed website/domain (or unknown / none), photos, reviews, per-platform facts, and unmatched hits. Classification is read-time from every hit’s `extract.website` and `hit.url` (directory / builder / vendor / custom). Incomplete scrapes do not read as “no owned website.” `getEnrichmentSummary` and the traces Firecrawl column share the same classifier. No migration. EXTRACT_PROMPT now prefers an official site URL on future scrapes only.

---

## 2026-08-30 — Vet of generate_initial claim fix; PR opened

Re-read `claim_agent_turn` against the prior function: the only behavior change is adding `generate_initial` to the intent allowlist. Snapshot fencing is unchanged (regenerate still requires a version; initial still must not send one). App claim passes `intentType: generate_initial` with null snapshot on first confirm and create-without-preview. Admin kickoff still claims `admin_auto_kickoff`. Opened PR #78.

---

## 2026-08-30 — Holistic vet of owned generation without Chrome

A cursor.md re-vet of the plan against current code found one load-bearing miss: first-time confirm and create-without-snapshot claim `generate_initial`, but `claim_agent_turn` only allowed chat/onboarding/kickoff/regenerate/publish. That turn died with a generic “unable to start” error, so the contractor “yes, go” path never enqueued a build. Admin kickoff was unaffected (it still claims `admin_auto_kickoff`). The same forward migration now admits `generate_initial` with no source snapshot. Regenerates still require a snapshot.

The rest of the plan matches the code: closed initial admit, LLM still cannot call `generateVariants`, kickoff skips only when a preview or active site-generation job exists, compose→save without Chrome, claim epoch 2 on the existing runner, heartbeat is liveness not `browser_ready`, five-minute Chrome killer is a no-op, one active job remains fail-closed, Add Video does not launch Playwright. `pnpm test:bucket1-generation` passes. The transactional SQL suite was not run. Apply `20260830200000_persist_generation_without_chrome.sql` in Lovable after merge; it is not live yet.

---

## 2026-08-30 — Owned start-build, persist without Chrome

First-time kickoff/confirm and regenerate now share one owned `generateVariants` admit. Chat still cannot call that tool. Kickoff no longer treats chat history as “already generated”: it skips only when a preview exists or a site-generation job is already active. Incomplete onboarding, an already-active build, and a silent job runner surface as those errors instead of the generic agent message.

Site builds finish on the existing Cloudflare `/api/internal/run-jobs` loop: compose then save. Playwright, HMAC QA stamps, `bucket1ValidationInput`, and `browser_ready` are off generate → save → preview → Go live (and Add Video). Insert refuses only when no job-runner heartbeat exists. The five-minute “no compatible browser worker” killer is a no-op so stuck 0% rows stay runnable. One active site-generation job per website remains fail-closed.

Forward migration: `supabase/migrations/20260830200000_persist_generation_without_chrome.sql`. Merged PR ≠ live DB. TypeScript, `pnpm test:bucket1-generation`, and version-revision verifiers pass. The transactional SQL suite was not executed (no isolated `DATABASE_URL`).

---

## 2026-08-29 — Payment Buckets 1–3 clean PR extraction

Reconstructed the payment-scoped repository implementation described by `plans/payment.md` on a fresh non-history-rewriting branch from verified current `origin/main`, preserving newer generation/chat/media work while merging only payment-specific mixed hunks. Root-cause extraction work forward-renamed all 25 new SQL migrations above main's migration ceiling, updated persistent cutover markers and exact verifier consumers, and regenerated Supabase and TanStack/site-runtime outputs. Source defaults keep live booking, production workers, automatic schedules, and charging disabled; target-environment state requires independent deployment evidence.

Independent P0/P1 audits closed four extraction blockers: manual Google repair derives the immutable actor from a valid opaque AAL2 admin session; the signed SaaS Stripe webhook durably ingests, targets its event, and returns non-2xx after verification/projection/application failures so Stripe retries without a scheduler; booking return requires its browser-bound HttpOnly handoff; and legal evidence records displayed MSA/DPA Version 1.0 while out-of-scope legal text changes remain absent. These handoff-cookie and webhook-retry findings are repository implementation/static/SQL/provider-mock evidence; the Chrome fixture suite does not exercise their HTTP transport or browser-cookie security properties.

Evidence: `BOOKING_TEST_PG_PORT=55510 pnpm verify:payment-acceptance` passed static contracts, provider-mocked Node branches, and a fresh disposable local PostgreSQL 15 replay with Supabase compatibility shims and populated fixtures. That local wrapper replayed the selected repository migrations, ran `supabase/tests/bucket3-booking.sql` for final booking/worker ACLs plus selected lifecycle/lease behavior, and separately ran the narrower `supabase/tests/admin-auth-authority-closure.sql` contract. It also passed three Chromium fixture UI flows: disabled safe-default rendering, mocked `LiveBookingDialog` keyboard/ARIA/required-field behavior, and mocked receipt projections/manual refresh. Those fixtures are not hosted Checkout/cookie/303/transport/security/provider acceptance. Nonincremental TypeScript, production build, and focused ESLint pass (three Fast Refresh warnings). No `DATABASE_URL` restored-state test or hosted proof is claimed. The exact payment migration chain is the ordered, contiguous 25-file range `20260829093900` through `20260829093924`, with committed refund-correlation preflight `93920` before closures `93921`–`93924`. No hosted migration, provider setup, schedule/worker activation, or charge was performed; admission, worker execution, and schedules remain off by default.

---

## 2026-08-29 — Bucket 1 server-owned generation PR

Implemented Bucket 1 only on `feat/bucket1-server-owned-generation`: atomic attributable epoch-2 admission, canonical server-owned staged generation/Add Video execution, frozen checkpoints, provider identity and reconciliation, HMAC-attested validation/persistence, scoped cancellation, observability/monitoring, and operational runbooks. Browser generation continuation was removed; sibling payment, booking, lead-product, admin/auth, and Bucket 2 changes were excluded.

Local evidence passes: nonincremental TypeScript, Supabase static type parity, the complete `test:bucket1-generation` aggregate, site-theme verification, development production-path build, formatting, and diff checks. The transactional PostgreSQL suite is checked in and included in `test:bucket1-generation:release`, but was not run because no isolated `DATABASE_URL` is available. Chromium was not installed or run. The default `cloudflare-module` target cannot run the native Playwright validator, so epoch-2 claims and Bucket 2 production integration must stay disabled until one compatible production execution target and all 12 exit gates have durable evidence. Published as PR #71 (`https://github.com/satyavva/obra-tech/pull/71`) from initial implementation commit `9b507f79e9432e22d39b8bc40ad33e0171299f78`.

---

## 2026-08-27 — Chat-directed regeneration routing

Free-form whole-site redesign requests now pass through a narrow pre-claim classifier, bind the selected version and revision to the durable turn, and execute the same closed generateVariants path as explicit regeneration. Concurrent same-request classifications reconcile to the durable winner, the browser persists server-resolved regeneration identity for ambiguous retries, stale snapshots surface their actionable error, and the user’s creative direction is loaded by the worker from the fenced trace into unified planning rather than granting the chat model additional mutation authority.

A holistic follow-up audit fixed deeper lifecycle edges: ordinary chat can no longer call generateVariants if classification is unavailable, an explicit deterministic fallback catches unambiguous whole-site regeneration wording, browser storage failures cannot block chat, terminal error/cancellation identities are cleared for fresh retry, stream recovery restores regeneration callbacks, and closed-tool failures emit one bounded response without persisting a contradictory assistant completion. Migration `20260827120000_agent_turn_replay_before_snapshot_validation.sql` preserves immutable request replay after the mutable source revision advances while retaining strict snapshot validation for new claims.

---

## 2026-08-26 — PR #69 strict lifecycle and splitter re-vet follow-up

A second recursive audit corrected two deeper issues in the forward migration. The deployed-database repair now reproduces every invariant of the canonical owned-enqueue RPC—source snapshot fencing, durable request identity, replay-safe handoff reuse, conflicting trace rejection, and whole-chain binding verification—instead of installing a weaker parallel implementation. The forward migration now normalizes worker settlement and workspace cancellation to job-before-media, matching every media mutator; administrative recovery takes the website turn fence, locks the complete child-job set, then media, then the linked handoff chain. Terminal handoff settlement takes only the chain lock and never mutates job rows. This prevents enqueue/recovery and cross-row terminal-trigger deadlocks without admitting a late enqueue or post-recovery handoff rewrite. Regression checks now require canonical forward-RPC semantics plus the shared turn-before-job and terminal job-before-chain lock orders. Full lifecycle, ownership, liveness, reliability, TypeScript, ESLint, migration/type parity, build, and diff validation pass. The recovery migration still must be applied through Lovable/Supabase for production parity.

---

## 2026-08-26 — PR #69 strict lifecycle and splitter re-vet

A recursive cursor.md re-vet found four concrete issues beyond the original UI symptoms. The stable splitter now accepts only the primary button/pointer and gives both flex panes zero automatic minimum width, so secondary clicks cannot move it and intrinsic chat content cannot invalidate its announced or persisted percentage. The transcript-owned control now truthfully says “Cancel all jobs,” matching the existing workspace-wide cancellation operation.

The migration chain had duplicated the agent/job linkage transition and attempted to change an existing PostgreSQL function return type without dropping it. The canonical linkage migration now performs the required drop, and the later Lovable schema copy is an explicit no-op instead of replaying a one-time function rename. Administrative recovery now atomically abandons unfinished media, cancels linked generation before releasing the trace, and prevents recovered traces from later rewriting their handoff. This adds a new recovery-fence migration that must be applied through Lovable/Supabase.

Regression checks cover migration sequencing, recovery ordering, post-recovery settlement fencing, primary-pointer gating, flex minimum sizing, ownership projection, executor metadata, and cancellation labeling.

---

## 2026-08-26 — Booking, Stripe Connect, and Google Calendar requirements audit

Audited the current published-site CTA, dummy booking/payment modal, SaaS Stripe Checkout and webhook path, post-purchase setup wizard, Supabase foundation schema/RLS, and integration configuration under cursor.md. The requested pre-purchase experience is partially present, but the architectural boundary is not: purchased Pro sites still render the same in-memory dummy booking/payment component, while calendar and Stripe setup buttons only write timestamps into website onboarding JSON and do not contact either provider.

The root gap is the absence of a first-class booking/payments integration domain. There are no appointment, customer, service/availability, reservation, connected-account, calendar-connection, payment-ledger, provider-event, webhook-idempotency, or outbox/reconciliation records. Provider readiness is represented by self-asserted timestamps rather than verified capabilities. In addition, saveProSetupStep uses the service-role client without contractor authentication or website ownership authorization, so an arbitrary caller with a website UUID can mark setup complete.

The implementation requirements should split Obra SaaS billing from contractor customer payments, make bookings the product system of record, select an explicit Stripe Connect responsibility/charge model, drive all payment and account state from signed webhooks, and place Google/Pipedream behind a tenant-bound integration adapter with explicit account/calendar selection. Booking requires database-enforced slot reservation/idempotency, time-zone and availability rules, and asynchronous calendar synchronization/reconciliation. Operational setup, lifecycle policies, refunds/disputes wording, outage behavior, data retention, and test/live rollout all remain decisions before implementation.

No application code or migration was changed in this investigation. The journal update is the only repository change.

---

## 2026-08-26 — Holistic workspace and agent-turn lifecycle correction

A recursive cursor.md audit traced the screenshot symptoms and the nine ranked issues through UI state, polling, version inventory, request identity, database ownership, provider side effects, and administrative recovery. Archived-only workspaces now expose one direct Restore path rather than disabled generation controls; failed/cancelled history is separated from active polling and successful preview handoff; metadata/history reads and scroll intent are freshness-fenced; narrow layouts, mobile navigation, operation labels, and accessible announcements are explicit.

Agent turns now claim the canonical conversation atomically with payload-bound request IDs and truthful running/completed/error/cancelled replay. Ordinary identical chat messages receive distinct client identities, completed turns require a durable nonblank assistant response, and running turns are never superseded by elapsed time. Every durable mutation is owner-token fenced. Billable media calls acquire a non-expiring external-operation fence before provider invocation; ambiguous outcomes remain running, block normal/error settlement and administrative recovery, and require explicit audited abandonment. Provider persistence rechecks ownership before upload attempts. Canonical history creation, checkpoint conversation identity, deterministic checkpoint ordering, stable admin attribution, and an explicit gated rollout procedure close adjacent gaps found by the holistic pass.

The migration must deploy before the web bundle. Apply it with the runtime gate disabled, drain all legacy writers, enable the gate using the service-role setter, then deploy/start only the new bundle; disable it before rollback. Static verifiers, generated-type parity, TypeScript, targeted ESLint, and production build pass. Real Supabase interleavings and authenticated browser viewport behavior still require deployment/staging verification.

---

## 2026-09-04 — Deterministic public checkout support references

PR #108 proved the reservation failure had reached the server but could not be diagnosed from retained Worker logs. `createSaasCheckout` now returns a deterministic opaque `CHK-*` support reference with every validation, deployment/Stripe configuration, offer verification, legal-evidence, profile/website preparation, reservation, Stripe-session, and reused-OTP import failure. The reference is intentionally browser-visible because the checkout UI already surfaces the existing safe error text; it reveals no raw provider/database failure, checkout payload, identity, legal evidence, identifier, or secret.

The reservation path maps each recognized PostgREST/database class to a distinct reference, including `PGRST202` → `CHK-R08`, so one controlled retry gives an actionable diagnosis even where runtime logs are unavailable. Security regression coverage exercises malformed input, checkout gating, Stripe configuration, offer verification, profile lookup, Stripe session creation, recognized offer-contract rejection, an unclassified `PGRST202` message, and unknown-message `22023`/`P0001` cases, while asserting protected values do not enter the diagnostic logs. No migration or production data change is part of this follow-up.

---

## 2026-08-26 — Generated media path contract

## 2026-09-05 — Atomic SaaS checkout boundary

Replaced the public checkout's pre-reservation Stripe/Supabase request waterfall with one replay-safe `begin_saas_checkout` transaction that creates or reuses the profile, locks/selects the website, rejects existing entitlements, freezes the audited offer, and reserves the checkout before provider calls. Lost responses converge on the same checkout; attached provider sessions are retrieved rather than recreated; retries retain their historical offer across catalog rotation. Added opaque attempt-correlated application stage logs, sanitized transport/pool/timeout/deadlock/constraint references, and database-side stage/SQLSTATE/object logs without customer fields or secrets.

The implementation is stacked from PR #110's credential-cleanup head; after #110 merged, PR #111 targets `main`. App contract verification, full TypeScript, disposable PostgreSQL migration/behavior replay, production build, focused lint, and diff checks pass. Migration `20260905103000_atomic_saas_checkout_begin.sql` remains unapplied and requires merge, separate explicit authorization, allowlist/checksum verification, dry run, apply, and replay before the app path can work in production.

---

## 2026-09-07 — Template-purchase holistic vet (report-only, no code changes)

Vetted every slice fresh against the prior prompt and plan/template-purchase.md: EditModePage (720), PurchaserOverview (446), SetupStepCards (559), EngagementCards (159), template-purchase server/functions, template-edit functions, overlay/templates/painter11-view/plumber manifests, applier, publish branch, agent chain (message route, turn runner, prompts, registry, schemas, outputs, handlers, suggest-copy), lp route, checkout capture/verify/finalize, setup guard, user/edit-mode routes, bootstrap, jobs progress. `tsc --noEmit` exits 0 with all workdir files present. No bystander breakage found; checkout capture is non-fatal, copy-then-seed order is correct, media has no double-sign (resolveSiteMediaInConfig ignores overlay.media), publish validator enforces allowlist+budgets+detachment+contact regex, agent turn is allowlisted at prompt and API layers with lease fence and revision fail-fast, RPC writes website_edit_events with category template, plumber review attribution stays honest, P11 keeps its SAMPLE ONLY eyebrow.

Two HIGH findings: (1) edit-mode preview hardcodes PainterElevenTemplatePage (EditModePage.tsx:543), so plumber sites render the wrong mold with zero edit affordances and the 11 unwired slugs hit an "Unknown template mold" error page — needs a slug branch plus edit-link gating via overview.website.templateSlug (currently fetched but unused). (2) Duplicate data-tkey nodes (P11 contact.phone x6, plumber x2) produce duplicate React keys and stacked edit buttons — dedupe boxes by key in relayout. Seven MEDIUM: stale templateSlug return in verifyOtpAndLinkProfile (checkout.functions.ts:1444, pre-copy snapshot; setup guard heals it with one silent bounce); Step-1 cooldown blocks retry after fit/publish failures with a misleading lookup message; unwired slugs are purchasable (templates.painter10.tsx:11) but Step 1 loops on "Unable to prepare template version"; wand suggestions ignore slot budgets so Accept near-always fails on short slots; P11 reviews and both molds' blog images are write-only (validated, never rendered); a second template purchase on the same profile bricks on the retag refusal (concrete N-site failure); BookingsCard is website-unfiltered and shows empty state where the plan says hide. Nine LOW/nit items (proto-key lookup, impure setState updater, unshaped user-patch schema, conflict UX vs plan §8, key-order no-op check, string-matched support error, no fitting cancel/timeout, accepted plan deviations, shared-workdir collision with the parallel agent's unstaged routeTree/template-catalog/SiteBookingPayDemo changes). Pilot E2E remains the explicit next step, watching model round burn (MAX_TOOL_ROUNDS=10) and enrichment-photo media fills.

---

## 2026-09-07 — Template-purchase vet findings fixed (local, uncommitted)

Fixed every HIGH/MEDIUM/LOW finding from the morning vet as app-layer-only changes (no migration; none needed). Ran the fix list through cursor.md first: kept general fixes that thread existing data (slug/manifest/budget/revision already in the architecture), narrowed M5 to prompt-scoping and M7 to filtering, and dropped L5 canonical-compare, the embedded Step-1 preview, drag-drop upload, and diff-style suggestions as non-load-bearing. Edit-mode now branches preview by slug (plumber renders PlumberTemplatePage with a plumber content memo; unknown slugs get a support message, never a wrong mold), dedupes data-tkey boxes by key, reloads the draft on revision conflict with plan §8 "Updated underneath you" copy while preserving in-flight text, and updates preview URLs functionally. verifyOtpAndLinkProfile returns the freshly copied slug so template buyers route straight to /user. Step-1 retry reuses a recently completed enrichment chain (spend guard now gates the enqueue, not entry) with coded TEMPLATE_* support states, mold gating (unwired slugs get support copy, no error pages), a Cancel button, and a 10-minute fitting timeout. Wand and agent suggestCopy resolve the slot's manifest budget into the prompt. The personalize prompt carries per-slug rules (P11: no reviews; no mold renders blog images) plus revision threading, fed by a new templateSlug field on getEnrichmentSummary. Slug copy heals same-template partial failures (all existing versions already this template) and throws a truthful TEMPLATE_SITE_CONFLICT otherwise. BookingsCard filters to the current website. Applier/validator use own-property budget checks plus contact/identity value types. Setup-guard bounce lands on #step-2; /lp skips its duplicate website fetch. `tsc --noEmit` exits 0, eslint clean on all touched files (two pre-existing prettier drifts in prompts.ts/checkout.functions.ts left untouched). Uncommitted in the workdir alongside the parallel agent's unstaged routeTree/template-catalog/SiteBookingPayDemo changes — coordinate before staging.

---

## 2026-09-07 — Self-vet of the fix turn (cursor.md, report-only + one nit)

Re-vetted all fifteen fix files against the working agreement. Caller analysis: copyTemplateSlugToWebsite has exactly two callers (verify's best-effort catch, Step-1's coded surface) and saveTemplateContentEdit exactly one (EditModePage), so the throw/value-check changes are contained; unified flows are untouched on every path (M1 falls back, template branches are kind-gated, suggestCopy degrades to undefined budget, setup hash fires only for template sites, cards are purchaser-only). The prompts.ts/checkout.functions.ts lint drifts sit outside my hunks — pre-existing, left alone. End-to-end traces re-walked: plumber edit (preview → tap targets → patch → publish validator) matches what /lp renders by construction; Step-1 retry after a partial fit converges (all-no-op case covered by server-resolved revision); unwired slugs fail fast client-side with zero server spend. One genuine nit found and fixed: the M6 version-inspection query swallowed DB errors into a misattributed "refusing retag" log — now logged distinctly. Residuals honestly kept: pilot E2E still pending; retry-after-partial-fit may spend one model round on no-op patches; M6 refuses safe past 50 versions; direct-URL edit-mode on unwired slugs remains an error page (unreachable via UI); edit-mode chunk now also bundles the plumber mold. `tsc --noEmit` 0 and eslint clean re-verified after the nit fix.

---

## 2026-09-07 — PR branch pushed for the vet fixes (no gh CLI; user opens PR)

Committed the 16 vet-fix files (plus journal) as 8b672b2 on new branch fix/template-purchase-vet-findings, pushed to origin. Staged only my files; the parallel agent's unstaged routeTree/template-catalog/SiteBookingPayDemo edits and all untracked painter12/13/media files were left out. No gh CLI or tokens in this environment, so the PR itself must be opened from the compare link. Flagged to the user: the branch stacks on feat/template-redirect-routing, so if that base PR is still open the new PR should target its branch (not main) to avoid showing base commits twice — and if an open PR already covers these fixes, that one is canonical per the one-fix-one-PR rule.

---

## 2026-09-07 — PR conflict repair: sibling-template code out, journal united

Trial merge reproduced GitHub exactly: two conflicts, journal.md and routeTree.gen.ts. Forensics: my 8b672b2 had swept the parallel session's unmerged journal entries (8 mentions) because newest-first writes at the file top met my bottom-appends in one staging — and my c9206f7 tree fix lost to a workdir race (verified and committed in separate steps while the generator re-ran between them). Repair, all forward commits: journal rebuilt as main's blob plus only my own entries (their unmerged paragraphs dropped from the branch, preserved in the workdir backup); generated tree set to main's verbatim (this branch adds zero routes, so the union is exactly main's file — no sibling-template references remain in the PR). Guarded atomic commit (staged-blob scan rejects the sibling slug in both files), trial merge re-run to zero conflicts, then push. Standing rules: never verify-then-commit generated files across a step boundary in a shared workdir; never stage a shared changelog without diffing its staged hunks first.

---

## 2026-09-08 — Painter 13 (Blueberry Gelato) and Painter 14 (Juice Bar Renovation) PR branch

Cut `feat/painter13-painter14` off `origin/main` (c3fe9ac) in a separate worktree so the PR carries only the two new templates and none of the primary workspace's unrelated staged/untracked work. Copied the locally built routes, pages, CSS, generated media (17 photoreal stills + 800/1200 variants + 6.04s hero film each, with media ledgers), generators, verifiers, and browser audits. Adopted origin's `DemoLpChrome`/`SiteBookingPayDemo` as-is instead of the older local copies: the P13/P14 routes pass `templateId="tpl_painter13"` / `"tpl_painter14"` (same seam as painter12), and `overlay.ts` registers both slugs in `TEMPLATE_PURCHASE_SLUGS`, `TEMPLATE_IDS`, and both slug↔id maps so purchase identity fails closed rather than falling to the generic flow. Overlay/manifest wiring for 13/14 (`resolveTemplatePageView`) is deliberately left for a later PR. `verify-painter14.mjs` previously asserted the superseded `purchasingSpecificTemplate` chrome wording; both verifiers now assert the route's `tpl_*` id and the overlay registration instead, and the P14 browser audit checks the `Template purchase` aside / "Use this template" CTA. Catalog entries appended after painter12 (`job: "painter"`, so `/templates` renders painter chips with no catalog UI change). Added the typography rule to `plans/template.md` (no diminutive monospaced/typewriter/all-caps utility type in customer-facing strips, headers, nav, metadata, primary actions). Evidence in the worktree: prettier/eslint clean, `tsc --noEmit` 0, both verifiers pass, both browser audits pass against a worktree dev server on :4199 (1440/768/390), `pnpm build` 0, routeTree regenerated by the build (never hand-edited).
---

## 2026-09-08 — Painter 15 Moroccan Zellige PR (clean branch)

User requested the Mosaic Builder be removed and a PR raised only after the current `plans/template.md` checklist was met. Re-based this delivery on a clean worktree at `origin/main` 568c709 (`feat/painter15-moroccan-zellige`) after checking open PRs: only unrelated #126 was open, so no duplicate Painter 15 PR exists. Brought over only Painter 15 files; the primary workspace's staged/untracked P12–P14 and other work were untouched. Removed the Mosaic Builder as a complete feature removal: page section, color state, color controls, interactive page wash, builder tile animation/styles, Builder-only planning image references, its generator role, and the resulting orphan `planning*.jpg` assets/ledger entry. The hero's decorative static-to-settled mosaic mark remains as part of the visual identity, not an interactive builder. Updated hero secondary navigation and catalog/metadata wording to remove Builder language.

Applied current-main purchase identity rather than retaining the former slug-only seam: route passes `templateId="tpl_painter15"`; `overlay.ts` registers `painter15` / `tpl_painter15` in `TEMPLATE_PURCHASE_SLUGS`, `TEMPLATE_IDS`, `TEMPLATE_ID_BY_SLUG`, and `TEMPLATE_SLUG_BY_ID`. Existing main checkout resolves this shared seam and fails an unknown canonical id with CHK-T01 before a charge. P15 remains mold-pending in the existing overlay view resolver, explicitly allowed by the delivery checklist and not a workbench/setup fallback. Appended `painter15` to `templateCatalog` with `job: "painter"`, route href, preview, and palette. `/templates` renders the card and painter chip by its existing data-driven mapping (browser verified).

Checklist evidence: generated media remains local and role-based (17 still roles + responsive derivatives + media ledger, source-referenced same-property/same-camera before/after, 6.041667s silent fast-start hero film); page retains truthful generated-media, proof, and review-copy example labels with decorative Google/Yelp vectors marked Sample; independent homeowner walkthrough booking and shared template purchase flow remain; all customer-facing actions/nav stay at readable non-mono type and have accessible names. `node scripts/verify-painter15.mjs` checks route id, all registry maps, CHK-T01 source trace, catalog href/job, Builder removal, disclosure, motion, proof ledger, and media assets. `P15_AUDIT_ORIGIN=http://127.0.0.1:4200 node scripts/audit-painter15-browser.mjs` passes desktop 1440, tablet 768, mobile 390, reduced motion, plus `/templates` card/painter-chip/image decoding. Prettier, focused eslint, Python generator `py_compile`, strict `tsc --noEmit`, and `pnpm build` pass. Route tree regenerated by build tooling only. No migrations, shared checkout changes, or database operations in this PR.
