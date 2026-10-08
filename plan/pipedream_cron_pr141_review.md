# PR 141 Holistic Review

Date: 2026-09-12. Reviewed PR #141 at `cea35b942492a96260cd28049f020a66eb2dfb86` against base `8354719a6189a669a402b1457365e94407580136`, [pipedream_cron.md](pipedream_cron.md), and [cursor.md](../cursor.md).

**Historical review verdict at `cea35b9`: seven P2 source issues and a CI fixture failure.** The findings below are preserved as history. The implementation/verification closure below supersedes their open status without claiming hosted acceptance or zero possible bugs.

## Post-Push Sanity Check

Reviewed the latest correction `1959d14` and merged head `3778ef0` against the plan. One P2 discovery gap remains in shipped-state recovery; no additional material issue was confirmed in the scoped purchaser/public, provider-evidence, scheduling, alert or template-integration checks. The earlier closure records describe the transitions tested, not proof of autonomous discovery of every retained obligation.

**P2: elapsed paid-expiry orphans still require another webhook to enter recovery.** The repair at `supabase/migrations/20260910130000_booking_calendar_lifetime.sql:455-465` executes only within the Stripe-event reducer. A checksum-pinned shipped `8354719` expiry authority can leave captured money on a `cancelled/late_payment_arbitration` appointment with no arbitration or refund command. Current migration installation and recurring workers do not discover that cohort without another accepted event.

Actual disposable PostgreSQL validation reproduced both an unrefunded and an already-fully-refunded record. After installing current lifetime authority, arbitration, refund-outbox, session-expiry, payment-inbox, ambiguous-checkout and calendar claims returned zero. Hold/abandoned-checkout expiry and notification projection repair also did no work. Actual inbox, outbox and lifecycle workers completed without failures or provider calls; both receipts remained `settling`, refund state `not_requested`, with zero arbitration/refund rows. Only a subsequently injected webhook repaired them, after which the existing outbox issued exactly one required remainder refund and no refund for the already-refunded case. The upgrade test at `scripts/test-booking-financial-recovery.mjs:1043` supplies that missing event, so its pass does not cover no-new-event recovery.

This is a demonstrated compatibility/discovery omission against plan section 6, not a claim that the new code creates those states or that production contains them. Correction should narrowly discover the retained, evidence-qualified cohort during forward repair and use the existing financial/refund authority; already-refunded records must converge without another refund. Add an upgrade regression with no synthetic follow-up webhook. No application/test/migration edits, commits or pushes were made during this sanity review; the local database and generated probe artifacts were cleaned up.

**Check-count correction:** the prior assistant statement of 16/17 passing checks was unsupported and is withdrawn. GitHub Actions run [34695299728](https://github.com/satyavva/obra-tech/actions/runs/34695299728), for exact head `3778ef0`, has seven jobs: six successful and the browser `availability-editor` job intentionally skipped. Zero jobs failed. The earlier OpenSSL fixture failure belongs to run `34649390628` at old head `cea35b9`; the corrected fixture passes in the current run. The token cannot enumerate separate Checks/Deployments API contexts, so no broader 17-context count is asserted.

## Fix And Pre-Commit Closure

Reviewed correction commit: `1959d14`. Latest main `e9fcdf8` (#143) was subsequently merged with only a journal conflict; both histories were retained. Independent targeted review verified upstream template/overlay/media/review changes alongside booking callbacks, and post-merge app/fixture types, template parity, identity/research and public-booking checks passed. Financial/lifecycle SQL was unchanged by the merge.

The user explicitly required holistic vetting under `cursor.md` before any commit. Five independent review scopes examined the combined corrections, actual callers and effective SQL rather than accepting passing tests as specifications. Verified follow-up findings were fixed and re-reviewed; each reviewer confirmed closure in its scope before commit preparation. No published history was rewritten and no deployed database/provider/cron operation occurred.

| Item | Implemented Correction | Verification |
| --- | --- | --- |
| H1 | Actual Auth-dispatch observation; same-fence deferral releases unsent reserved attempts, including lost begin replies; stopped lanes report deadline after settlement | Actual SDK/worker/route tests; 12 unsent attempts without budget exhaustion; eight actual rejected sends still exhaust; stale/duplicate deferral rejected |
| H2 | Causal dispute classification preserved across payment/refund/cancel/failure paths; real shipped-state recovery; zero-remainder refunds converge receipt/notifications without another refund | Exact checksum-pinned `8354719` authorities, 16 upgrade cases, real ingestion/claims/reducer and private-helper ACL checks |
| H3 | SQL owner authority agrees with effective confirmed active/grace Pro policy and finite timestamp/expiry checks | Actual owner/save/OAuth handler-to-SQL tests, both environments, state/timestamp/race negative controls |
| H4 | Unknown scope metadata remains temporary; attributable saved-account scope/role and thrown Google permission denials settle revision-fenced negative evidence | Healthy admission before denial and denied reservation afterward; candidate/stale revision/machine/proxy/unknown negative controls |
| H5 | Optional Google observation failure retains known entitlement/page/configuration facts but denies provider/booking actions; strict entitlement failures retain R16 behavior | Actual initial/refresh Pro/Starter handlers and SDK failure probes; unknown/recovery/owner controls |
| H6 | Unknown cutover observations permit bounded retry only when independently known restrictions do not forbid it | Actual helper/LP mixed-negative tests, both cutover read orders, disabled payments/entitlements/selection/runtime controls |
| H7 | Nine exact SELECT-visible identities include the foreign response recorder; mutation ownership remains four jobs per environment | Constrained SQL/evaluator foreign-recorder success/absence/inactivity and unrelated-row/write denial |
| CI | Portable OpenSSL fixture: restrictive temporary key file, certificate stdout, cleanup and PEM-redacted errors; redirect assertions unchanged | macOS OpenSSL/LibreSSL and local libcurl tests passed; Linux confirmation follows the PR push |

Pre-commit review additionally closed item/time fairness with independent, fairly shared Google classes; retained availability drafts across locks/reload failures; immutable ambiguous checkout payloads with shared input validation and explicit `not_attempted` refusal before reservation; truthful disputed receipt copy; and current incident evidence separate from older frozen email delivery. First known checkout refusals remain editable, but a later refusal cannot erase an earlier unknown/in-flight request. Temporary observations and old delivery acceptance cannot falsely resolve a recurrent incident.

Final combined code-only verification passed: build; application/payment-fixture types; schema contracts (94 tables/145 migrations); full booking/calendar/public/transport unit aggregate; foundational/authorization/receipt/money/source checks; normal and managed-safeupdate PostgreSQL 15.19 full-chain replay; 67 actual Google completion SQL scenarios; financial upgrade tests; scheduler/outcome/notification/monitor and constrained worker-role suites. Subsequent schema/fixture/admin presentation handoffs were typechecked and reviewed. No browser/DOM/E2E tests ran. All owned local clusters stopped. Broad generated/unrelated lint was not rewritten; changed executable files were linted separately.

Remaining release prerequisites are unchanged: merge review, explicit migration authorization and exact-checksum dry-run/apply, target bootstrap/configuration, worker/monitor activation, production Pipedream entitlement and user-run real-provider/capacity/no-owner-traffic acceptance. No broader template live-booking support is claimed beyond painter11/plumber. Request retention in the dialog is in-memory, not full-page-reload persistence.

## Historical Review

No application, migration or test source was changed. No browser/DOM/visual/E2E, live provider, hosted database or cron operation was performed. In-memory probes used actual handlers/SDKs at mocked transport boundaries. The dispute and recorder findings additionally used actual SQL in disposable local PostgreSQL, with cleanup verified. This report and journal updates are local; no commit or push was made during review.

## Confirmed Findings

### H1. Unsent OTP Becomes Manual-Only Ambiguity

P2; new shared-worker bystander regression. `src/lib/checkout-otp-outbox-worker.server.ts:55-59,99-107` sets `deliveryUnknown` if continuation stops after the dispatch-intent RPC but before invoking Auth. The worker knows it has not sent the OTP, yet records the same state used for an unknown provider response.

Actual worker plus Supabase SDK, with fake fetch and a work-deadline crossing at the begin-RPC response, produced zero Auth requests and invoked `mark_saas_checkout_fulfillment_delivery_unknown`. The existing SQL excludes that state from automatic claims (`20260901110000_saas_checkout_authority_and_entitlement_lifecycle.sql:425,478-493`). A paid customer's automatic verification-code fulfillment can therefore stop without any message having been sent.

Correction: preserve the known not-dispatched outcome and use the existing fenced retryable completion. Keep ambiguous state for a genuinely dispatched/unknown Auth request. Add a begin-success -> deadline-stop -> zero-Auth -> retryable-settlement regression. This is the same dispatch-permission versus outcome-evidence distinction already required by plan sections 2 and 4.

### H2. Older Events Clear Disputed Payment State

P2; preexisting financial-reducer residual retained in the replacement SQL. `supabase/migrations/20260910130000_booking_calendar_lifetime.sql:392,405-406` unconditionally writes `paid` from a successful PaymentIntent/Charge snapshot before `:436-439` decides whether dispute evidence is causally current.

Actual reducer SQL with enabled financial guards and role-scoped ingestion/claims reproduced:

| Event | Payment / Appointment Payment | Retained Dispute |
| --- | --- | --- |
| `charge.dispute.closed`, lost | disputed / disputed | lost |
| Older `charge.dispute.created` | paid / paid | lost |
| Delayed Checkout-completed, independently from lost state | paid / paid | lost |

Each event settled and became processed. The newer dispute timestamp/rank remained intact, while both payment projections contradicted it. The financial guard checks reducer authority, not precedence, so it permits the overwrite. This does not establish a duplicate charge or irreversible loss.

Correction: derive the ordinary paid projection from the retained authoritative dispute state, and let only causally accepted dispute evidence change that classification. Update appointment and payment consistently. Add out-of-order dispute and delayed-Checkout regressions to the existing reducer suite. Plan section 6 requires preserving the existing financial authority, not only payment arrival.

### H3. Google SQL Rejects Service-Entitled Grace Owners

P2; new authorization mismatch. `supabase/migrations/20260910120000_google_calendar_lifetime.sql:135-140` requires `e.state='active'`, while the unchanged `src/lib/provider-authorization.ts:20-35` explicitly permits currently effective, confirmed Pro entitlements in `active` or `grace`.

Static handler-to-SQL trace: a grace-only owner passes `providerMutationContext`, then fails the new Connect start/completion or setup-reservation owner assertion with `42501`. They cannot reconnect or save calendar choices despite remaining service-entitled. Existing authorization tests cover grace in TypeScript but the lifetime SQL fixture uses active entitlement.

Correction: align the SQL predicate with the existing entitlement authority, including grace and the timestamp conditions. Test the complete handler/SQL seam rather than either predicate alone. Do not change product entitlement policy or bypass ownership checks.

### H4. Missing Scope Metadata Is Reported As Lost Permission

P2; new unattended classification gap plus retained owner-path residual. `src/lib/pipedream-trigger-reconciliation.server.ts:244-245` classifies missing optional `authorized_scopes` as `calendar_permissions_changed`; `src/lib/booking-provider.functions.ts:391-394,571-574` instead tells the owner to reconnect.

Actual in-memory save/verifier probes using the exact healthy account with omitted scope metadata produced those outcomes. Omitted metadata is not evidence that scopes were revoked. The setup worker already distinguishes it correctly at `src/lib/google-calendar-state.server.ts:359-369`: unavailable scope evidence is unknown/temporary, while a known insufficient array is permission failure.

Correction: thread that distinction through existing save/completion/saved-verification paths. Remain fail-closed for admission, retain scheduled recovery, and request OAuth only when evidence supports that remedy. Add omitted-metadata cases across all three callers. This closes an inconsistent implementation of plan section 2's evidence classification.

### H5. Optional Calendar Failure Blocks Known-Entitlement Overview

P2; baseline page coupling expanded by the new mandatory pending-setup RPC. `src/lib/booking-readiness.server.ts:202-206` awaits pending Google setup even for Starter sites. Its error escapes `src/lib/template-purchase.functions.ts:79-86` and triggers the full-page error at `src/components/purchaser/PurchaserOverview.tsx:172-186`.

Actual overview-handler probes with successful website/profile/entitlement/configuration reads, but a `57014` from only the pending-setup RPC, rejected for both Pro and Starter. Draft lookup was not reached; Step 1, editing links and engagement cards were unavailable through the overview. The bootstrap fallback does not isolate this second independent request.

**Correction to the earlier V1 withdrawal:** the attempted blanket `unknownBookingReadiness` fallback was wrong because it discarded known entitlement and fabricated Starter/unconfirmed state. That did not prove there was no source defect or that a new cache was required. Existing successfully read entitlement/configuration can be retained while the calendar observation is marked unknown and mutation authority remains denied. A pure projection probe preserved real Pro/Starter, order confirmation and configured availability without granting booking admission. Entitlement-read failure should still reject and preserve the prior overview, as R16 requires.

Correction: isolate the optional observation inside the existing reader and thread unknown status to consumers without allowing stale provider actions. Add first-load known-entitlement/pending-RPC-failure tests in addition to the existing failed-refresh regression. Do not revive the blanket fallback.

### H6. Transient Cutover Error Has No Retry Presentation

P2; new public-admission handoff regression. `src/lib/booking-availability.server.ts:85-86` collapses a returned cutover RPC error and definite denial into `booking_cutover_unavailable`. If other facts are fresh and the later cutover table read succeeds, `src/routes/lp/$websiteId.tsx:230-263` identifies neither an unknown observation nor another refreshable reason.

Actual helper/LP-loader probe: the RPC returned `57014`, the table then returned enabled/contract 2, and the result was `liveBooking=false`, `showBookingPay=false`, `bookingRetryAvailable=false`, `bookingConfigurationPending=false`. Contact/lead content remained, but supported booking buttons were disabled without the temporary-outage/retry banner.

Correction: distinguish RPC errors from a known false result through the existing `booking_readiness_unknown` projection. Keep admission closed while making the scoped retry reachable. Add this error-then-success cross-read scenario; existing tests exercise the two reads separately.

### H7. Valid Foreign-Owned Recorder Is Hidden From Health

P2; new observability bug under the supported constrained-owner configuration, not an assertion about hosted ownership. `supabase/migrations/20260910140000_calendar_worker_schedules.sql:504-505` treats an empty recorder query as missing. The required bootstrap policy at `:9-11,38-41` exposes eight calendar-job names, not `obra-record-background-job-responses`.

Actual constrained SQL probe passed bootstrap preflight, installed an active foreign-owned recorder and recorded a successful response. Service health still returned `registered=false,active=false`; a same-owner control returned true/true. The health function's SECURITY DEFINER owner is neither BYPASSRLS, superuser nor cron-table owner. The service caller's privileges do not override that context. `src/lib/calendar-observability.server.ts:281-287` raises a permanent false critical recorder condition.

Correction: provide SELECT-only visibility for the exact recorder identity through the reviewed bootstrap and matching preflight, without writes, ownership, role membership or broad catalog access. Add a healthy foreign-owned recorder regression. Existing foreign-calendar collision tests do not cover this identity.

## CI Verification Blocker

GitHub run [34649390628](https://github.com/satyavva/obra-tech/actions/runs/34649390628), for the reviewed head, failed in `source-contract`: `scripts/test-calendar-cron-redirects.mjs:26-45` received exit 1 while generating its local OpenSSL TLS fixture, then asserted `local TLS fixture generation must succeed`. Both outputs target `/dev/stdout`; the test discards diagnostic stderr. The exact OpenSSL failure cause is not established by the log, so this is not proof of a production redirect/credential defect.

All preceding unit/public/shared-deadline tests, CI build/types and booking source checks passed. The safeupdate/SQL handoff job and all four PostgreSQL 16/17 worker-role variants passed. The browser job was skipped as requested. Later source-contract steps were skipped after failure. Resolve portable fixture generation and expose safe diagnostics before treating the required CI result as green.

## Qualified Limits

- Maintenance routes cap scheduled Google/Stripe checks at three per minute. A zero-latency, 48-account, cron-only model yields 16-minute repeat intervals, but the plan specifies no supported tenant count and public checks can refresh eligible sites. This is a real capacity bound and mixed-workload test gap, not demonstrated production unavailability or a confirmed P1. Google prioritizes disconnect/setup before recurring checks; measure fairness as part of supported-volume acceptance.
- Step 3 conditional unmount can lose an unsaved draft on a completed authorized disconnect, then remount stale revisions before refetch settles. Actual component probes confirm the conditional behavior, but ordinary health failures preserve saved selections, pending disconnect remains configured, and no UI disconnect caller was found. Record as a narrower baseline residual, not a routine-outage regression.
- Painter11/plumber are the explicitly supported live-booking molds. Other registry templates retain baseline demo/checklist behavior; this review does not certify broader live-template booking. Upstream lookup/auth/Step 1/field-note integration showed no material regression in the inspected paths.
- Hosted migration application, cron bootstrap/registration/activation, production Pipedream entitlement, independent monitoring destinations and real-provider/E2E/capacity/no-owner-traffic soak remain outstanding. They are release prerequisites, not substitutes for the source fixes above.

## Root-Cause Assessment

The confirmed failures do not justify additional queues, caches or orchestration. They are disagreements between existing authorities: not-dispatched versus ambiguous outcomes, observed versus unknown capability, known entitlement versus optional provider reads, causal dispute state versus a paid snapshot, and a health reader versus its actual RLS visibility. Fix those shared handoffs and test transitions spanning both sides. Passing isolated predicates or narrowing one unsuccessful patch does not establish the general-case contract.
