# Payment launch runbook

This runbook defines the evidence required for payment.md items 1-14; only completed, retained target-environment artifacts are evidence. It never authorizes launch by itself. Keep new-booking admission off with `BOOKING_LIVE_ENABLED=false`, keep worker execution unauthorized with `BOOKING_WORKER_MODE=off`, leave schedules disabled, and keep attachment upload disabled until the applicable gates below are recorded for the target environment. `drain` is not another safe default: it authorizes workers to finish already-owed obligations and may be selected only after the target environment, dedicated worker identity, scheduler, and worker families are explicitly approved.

## 1. Expansion

1. Back up the target database and record its hosted migration ledger, catalog/ACL/owner inventory, and data-inventory digest. A source checkout or local replay is not proof of that target state.
2. On an isolated clone first, apply the exact contiguous payment chain in filename order. Do not skip or reorder a file:
   - foundation: `20260829093900_booking_authorization_foundation.sql` through `20260829093905_bucket1_closure.sql`;
   - provider readiness: `20260829093906_stripe_connect_express_onboarding.sql` through `20260829093910_pipedream_trigger_lifecycle.sql`;
   - booking/admin expansion: `20260829093911_bucket3_live_booking_lifecycle.sql` through `20260829093919_admin_auth_lifecycle.sql`;
   - committed refund-correlation preflight: `20260829093920_booking_refund_correlation_preflight.sql`;
   - closures, only after the preflight quarantine is reconciled: `20260829093921_booking_money_authority_closure.sql`, `20260829093922_booking_google_convergence_closure.sql`, `20260829093923_booking_customer_lifecycle_closure.sql`, then `20260829093924_admin_auth_authority_closure.sql`.
   The complete 25-file manifest is recorded in `payment-rollout-runbook.md`; stop rather than forcing a closure migration past unresolved evidence. Do not enable a tenant while applying the chain.
3. Run `BOOKING_TEST_PG_PORT=<unused-port> pnpm verify:payment-acceptance` for repository acceptance. Its database leg creates a fresh disposable **local PostgreSQL** cluster with Supabase compatibility shims, replays the selected repository migrations with populated legacy fixtures, and then runs both booking and admin SQL smoke files. It neither restores nor inspects the hosted target.
4. Separately restore the target backup into an isolated non-production database, apply/verify the exact chain there, and run `DATABASE_URL=... CUTOVER_TENANT=<enabled-test-tenant-uuid> pnpm test:db:bucket3-booking`. The tenant must be prepared outside the smoke transaction. That wrapper does not restore or migrate the database and runs only `supabase/tests/bucket3-booking.sql`. Run the separate admin contract smoke with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin-auth-authority-closure.sql`.
5. Confirm, with target-environment evidence, that the booking worker JWT resolves to `booking_worker`, can execute only the final allowlisted RPCs, and cannot select booking tables. Local catalog assertions check expected ACL shape but do not prove hosted JWT issuance or claims. This proof is required before authorizing `drain` or `active`; route mode does not revoke a directly presented worker JWT.

## 2. Inventory and reconciliation

1. Inspect `booking_cutover_quarantine` and all contract-version-1 inbox/outbox rows.
2. Retrieve exact Stripe/Google objects for every ambiguous item. Never reset an unknown external effect.
3. Record a reviewed resolution and provider evidence for each quarantine row.
4. Re-run preflight under the tenant cutover advisory lock; store and compare its digest immediately before activation.

## 3. Secrets and destinations

Verify distinct test/live values for Stripe API/webhook secrets, Pipedream project/environment/token/webhook secrets, Resend API/webhook secrets, worker JWT, cron secret, booking HMAC secrets, scanner credentials/config version/proof secret, and admin rate/auth/recovery/bootstrap secrets. Confirm Stripe Connect account/livemode routing and Pipedream calendar destination epochs.

## 4. Test-mode acceptance

- Run both database paths described above: the fresh local PostgreSQL migration replay and the isolated restored-state checks. The booking SQL smoke covers final booking/worker ACLs plus selected receipt, notification, session-expiry, environment-scoped refund-claim, and worker-family lease behavior; the separate admin SQL smoke checks final admin schema/RLS/grants, retired authority, invalidation/audit triggers, and absence of unrevoked old sessions. Neither is the full concurrency, PostgREST/JWT, provider, or admin UI matrix.
- Exercise Stripe connected-account Checkout, signature verification, duplicate/reordered events, late payment refund, exact cumulative refund, disputes, and response-loss replay against test-mode provider/runtime infrastructure; provider-mocked Node tests are not this evidence.
- Exercise Google confirmed/cancelled × present/absent/conflict and delayed create/delete races against test provider/runtime infrastructure.
- Treat the three checked-in Chromium tests as fixture UI flows only: disabled safe-default rendering; keyboard/ARIA/required-field behavior for `LiveBookingDialog` with mocked server functions; and mocked confirmation projection/manual refresh. They do not prove hosted redirects, cookies, 303 exchange, cross-booking rejection, transport security, provider behavior, or the plan-complete browser/security matrix. Obtain those separately, including simultaneous receipt tabs and clean-URL behavior.
- Run Resend accepted/delivered/delayed/bounced/complained events and verify they never alter money/capacity.
- Run scanner clean and EICAR probes for the exact config fingerprint; test outage, digest mismatch, clean-only signed download, orphan cleanup, retention, and legal hold.
- Exercise admin TOTP enrollment, recovery-code rotation/use, password reset, global sign-out, factor removal, principal disable, and impersonation revocation.

## 5. Canary

1. Keep admission off. After target-environment JWT/ACL, scheduler, secret, and worker-family approval, authorize `BOOKING_WORKER_MODE=drain` only to converge already-owed obligations; do not create new obligations in drain mode.
2. Return to `off` if worker execution is unsafe. Otherwise, after the drain gate passes, activate one internal **test-environment** tenant with a freshly committed cutover digest.
3. Explicitly authorize the test worker deployment and set worker mode `active`; keep public live booking false. Mode text alone does not provision or authorize a worker identity or schedule.
4. Observe inbox/outbox age, dead letters, refunds, calendar reconciliation, notification delivery, and attachment cleanup for the agreed window.
5. Only after owner approval and separate production worker/scheduler authorization, activate one production canary tenant, verify every other production tenant cutover remains disabled, and then set the global public-live flag true for that controlled window. The tenant cutover, entitlement, and provider-readiness gates—not a nonexistent per-tenant worker mode—confine admission.

## 6. Rollback

1. Immediately set `BOOKING_LIVE_ENABLED=false` to stop admission; this is the unconditional rollback control.
2. Preserve already-owed obligations and their evidence. If the incident owner confirms the worker code, credentials, target environment, and scheduler are safe, explicitly authorize `BOOKING_WORKER_MODE=drain` so only those obligations converge. If worker execution or authority is suspect, use `off` and keep schedules disabled until repaired; `off` pauses work but does not cancel or erase obligations.
3. Mark tenant cutover blocked. Do not delete provider evidence or rewrite effects.
4. Reconcile Stripe refunds and Google events to desired state; record every manual provider action.
5. Roll application code forward with a corrective migration. Never reverse destructive schema or rewrite Lovable-connected history.

## Evidence record

Record timestamp, commit, migration head, environment, operator, command output/artifact URL, provider dashboard IDs, alarms checked, and approver for every gate. A green static verifier does not replace target PostgreSQL/provider/browser evidence.
