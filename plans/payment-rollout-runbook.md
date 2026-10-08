# Bucket 3 Payment Acceptance and Rollout Runbook

This is the executable companion to plans/payment.md. It does not replace provider dashboards, a migrated Supabase project, or browser acceptance. Treat every gate below as fail closed.

## Release invariants

- `BOOKING_LIVE_ENABLED=false` is the unconditional baseline and rollback control for new-booking admission. `BOOKING_WORKER_MODE=off` is the default with no worker execution authorized; the cron endpoint performs no work, but owed obligations remain durable. After target-environment worker identity, scheduler, secrets, and families are explicitly authorized, `drain` runs the worker families to finish existing obligations while booking admission remains impossible. `active` runs those families, permits attachment-cleanup discovery, and satisfies the worker-mode prerequisite for admission; it still cannot admit a booking unless the live flag, tenant cutover, entitlement, and provider readiness also pass.
- No write-path wave starts until the prior migration is applied, catalog/ACL checks pass, and inventory is exported with an operator, timestamp, environment, migration head, and SHA-256 digest.
- Test and live identities never cross: Stripe key/livemode/account, Pipedream environment/account, Supabase project, Storage path, webhook endpoint, and worker token must agree.
- Only contract v2 may create or execute new provider obligations. Contract v1 effects are inventory/reconciliation/quarantine work only—the database blocks v1 effect claims—until the terminal/quarantine inventory is zero.
- The application role cannot mutate booking/payment/provider tables directly. The booking worker has RPC execute only; never give it table, sequence, generic service-role, or admin authority.
- Provider acceptance means signature/API-version/environment validation followed by durable ingress before HTTP 2xx. Worker/provider completion is lease- and fence-checked.
- Payment, refund, capacity, calendar, notification, attachment, and admin state have independent durable axes; a secondary provider failure cannot roll back money or capacity truth.

## Automated gates

| Gate | Command | What it actually runs |
| --- | --- | --- |
| Static/type compatibility | `pnpm verify:bucket3` | source/static contract checks and generated/type compatibility |
| Provider-mocked real-code branches | `pnpm test:unit:bucket3-booking` | Node production-module branches with mocked providers; no network/provider proof |
| Fresh migration replay | `BOOKING_TEST_PG_PORT=<unused-port> pnpm test:db:bucket3-local` | creates a fresh disposable local PostgreSQL cluster with Supabase compatibility shims; replays the selected repository migrations with populated legacy fixtures; runs `bucket3-booking.sql` and `admin-auth-authority-closure.sql` |
| Isolated restored-state booking smoke | `DATABASE_URL=... CUTOVER_TENANT=<enabled-test-tenant-uuid> pnpm test:db:bucket3-booking` | requires a pre-created enabled test tenant and assumes the non-production target is already restored and fully migrated; does not restore or migrate it; runs only `bucket3-booking.sql` |
| Isolated restored-state admin smoke | `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin-auth-authority-closure.sql` | runs the separate final admin authority contract on the already restored/migrated non-production target |
| Chromium fixture UI flows | `pnpm test:e2e:payment` | three local fixture flows using production UI components/routes but mocked booking server functions |
| Repository aggregate | `BOOKING_TEST_PG_PORT=<unused-port> pnpm test:bucket3-booking` | static checks, provider-mocked Node tests, fresh local replay, and the three fixture UI flows; it does not consume `DATABASE_URL` |

The booking SQL file rolls back its smoke transaction. It checks final booking/worker ACLs and selected receipt, notification, session-expiry, environment-scoped refund-claim, and worker-family lease behavior. The separate admin SQL file rolls back after checking final admin schema/RLS/grants, retired authority, invalidation/audit triggers, and absence of unrevoked old opaque sessions. The fresh local wrapper also commits migration/preflight fixture setup before running those files. These tests are not a complete cross-tenant/concurrency/PostgREST-JWT/provider/admin-UI matrix.

The three Chromium tests prove only fixture UI behavior: disabled safe-default rendering; keyboard/ARIA/required-field behavior for `LiveBookingDialog`; and mocked confirmation projections/manual refresh. They do **not** prove hosted Checkout redirects, opaque Session exchange, cookie flags, HTTP 303 cleanup, cross-booking rejection, transport security, provider behavior, cancellation/admin flows, or plan-complete browser/security acceptance. Retain those as separate real-runtime gates below.

## Secrets and authority checklist

Store secrets only in the production secret manager. Record owner, rotation date, environment, and last verified timestamp; never paste values into tickets or logs.

- Supabase: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, a dedicated SUPABASE_BOOKING_WORKER_KEY whose JWT assumes only booking_worker, and any server-only service credential required for admission/admin/webhook ingress.
- Stripe: STRIPE_SECRET_KEY, SaaS webhook signing secret, Connect webhook signing secret, configured SaaS price IDs, exact API version, and Connect direct-charge/zero-application-fee policy.
- Pipedream/Google: PIPEDREAM_CLIENT_ID, PIPEDREAM_CLIENT_SECRET, PIPEDREAM_PROJECT_ID, trigger component/version, signing secret, selected readable calendars, exactly one active writable destination, and immutable destination epoch.
- Notifications: environment-scoped RESEND_API_KEY_TEST/RESEND_API_KEY_LIVE and BOOKING_EMAIL_FROM_TEST/BOOKING_EMAIL_FROM_LIVE, verified domain/DKIM/SPF/DMARC, and provider delivery-webhook secret.
- Attachments: scanner URL/token/provider/environment/config fingerprint, clean probe checksum, EICAR probe checksum, proof expiry, Storage download signing secret, private bucket policy, and lifecycle/retention ownership.
- Admin: provisioned principal UUIDs, verified MFA/TOTP, session cookie key/flags, throttling observability, and break-glass owner.
- Flags: BOOKING_LIVE_ENABLED, BOOKING_WORKER_MODE, BOOKING_ATTACHMENT_ENVIRONMENT, scanner proof/config variables, and any tenant-canary allowlist.

Rotation is expand/verify/switch/revoke: install the new value, verify both ingress and worker health, switch one environment, then revoke the old value. Webhook signing rotations overlap both secrets only for the provider-supported transition window.

## Webhooks

Provision separate public HTTPS endpoints and provider registrations for:

1. Stripe SaaS billing.
2. Stripe Connect account/payment/refund/dispute events.
3. Pipedream calendar triggers.
4. Notification delivery status.

For each endpoint, send valid, invalid-signature, stale-timestamp, duplicate, reordered, wrong-environment/livemode, wrong API-version, and oversized payload probes. A valid event must create exactly one inbox/delivery ledger identity before returning 2xx. Invalid evidence must return non-success without domain mutation. Configure provider retries and alerts; do not disable retries to hide failures.

## Schedules and workers

Leave booking schedules disabled while worker execution is unauthorized (`off`). After the target environment, dedicated `booking_worker` JWT/final-ACL proof, secrets, endpoint authentication, overlap protection, timeout, and alerts are approved, start with admission still off and use `drain` to finish existing obligations. Select `active` only for an explicitly approved canary environment. `BOOKING_WORKER_MODE` controls the application cron route; it neither provisions/revokes the worker JWT nor changes database grants, so protect direct PostgREST access separately. Enable one worker family at a time:

1. Stripe booking inbox and money reconciliation.
2. Hold/session expiry and ambiguous checkout reconciliation.
3. Refund outbox and refund reconciliation.
4. Calendar outbox and calendar reconciliation.
5. Notification claims/delivery state.
6. Attachment scan and cleanup only after current clean plus EICAR proof.

Initial cadence: ingress workers every minute, hold/session/reconciliation every 1–5 minutes, provider repair every 5 minutes, attachment cleanup/retention daily. Tune from measured queue age and rate limits, never by allowing concurrent unfenced work. Page on oldest due age over two intervals, repeated dead letters, lease churn, digest/quarantine growth, or scheduler silence.

Attachment deletion has an explicit serialized point of no return: the database validates the exact approved data-class policy and legal-hold epoch, then commits `deletion_authorized_at` before Storage removal. A legal hold committed before that authorization wins and revokes deletion; after authorization it is rejected because deletion is already operationally committed. Production approval requires legal/operations sign-off on this ordering plus a deterministic hold-versus-authorization race test.

Admin login rate attribution is valid only behind an ingress proxy that overwrites `CF-Connecting-IP` and strips/rebuilds `X-Forwarded-For`; direct origin access must be blocked and this topology retained in deployment evidence.

## Migration waves

### Wave 0 — freeze and evidence

Keep new admission off and worker execution unauthorized (`BOOKING_WORKER_MODE=off`, schedules disabled). Export the hosted migration ledger and checksums, table/constraint/function ACLs and owners, role memberships, provider registrations, cron jobs, feature flags, terminal/nonterminal v1 counts, unresolved quarantine, pending refund totals, calendar links, inbox/outbox ages, attachment proof, and admin principals. Hash and retain the export. If a pre-existing deployment already owes obligations, choose `drain` only under the separately approved safe-worker procedure; do not confuse pausing execution with cancelling obligations.

### Wave 1 — expand schema

The payment chain is exactly these 25 files and must be applied in this filename order, with no gaps or reordering:

1. `20260829093900_booking_authorization_foundation.sql`
2. `20260829093901_starter_website_leads.sql`
3. `20260829093902_booking_setup_configuration.sql`
4. `20260829093903_verified_website_entitlements.sql`
5. `20260829093904_bucket1_audit_hardening.sql`
6. `20260829093905_bucket1_closure.sql`
7. `20260829093906_stripe_connect_express_onboarding.sql`
8. `20260829093907_stripe_connect_lifecycle.sql`
9. `20260829093908_bucket2_google_readiness.sql`
10. `20260829093909_pipedream_calendar_ingress.sql`
11. `20260829093910_pipedream_trigger_lifecycle.sql`
12. `20260829093911_bucket3_live_booking_lifecycle.sql`
13. `20260829093912_booking_cutover_inventory.sql`
14. `20260829093913_booking_refund_ledger.sql`
15. `20260829093914_booking_authoritative_evidence.sql`
16. `20260829093915_booking_receipt_notifications.sql`
17. `20260829093916_booking_attachment_audited_lifecycle.sql`
18. `20260829093917_admin_auth_hardening.sql`
19. `20260829093918_booking_worker_role.sql`
20. `20260829093919_admin_auth_lifecycle.sql`
21. `20260829093920_booking_refund_correlation_preflight.sql`
22. `20260829093921_booking_money_authority_closure.sql`
23. `20260829093922_booking_google_convergence_closure.sql`
24. `20260829093923_booking_customer_lifecycle_closure.sql`
25. `20260829093924_admin_auth_authority_closure.sql`

First run the fresh local replay gate, which is repository compatibility evidence rather than a target clone. Then restore the target backup into an isolated non-production database. In Wave 1 apply expansion files `93900` through `93919`, in order, and verify the interim ledger/catalog without enabling traffic or workers. Continue with `93920` and the closures only under Wave 2 below. Preserve outputs as clone evidence; none of this proves the hosted target until repeated there under authorization.

### Wave 2 — inventory and quarantine

On the isolated restored clone, apply `93920_booking_refund_correlation_preflight.sql` and commit it separately. Inspect its durable refund/payment-correlation quarantine; if any unresolved row exists, stop and reconcile it from exact provider evidence. Only after it is clear, apply `93921_booking_money_authority_closure.sql`, `93922_booking_google_convergence_closure.sql`, `93923_booking_customer_lifecycle_closure.sql`, and `93924_admin_auth_authority_closure.sql`, in that order. Run both restored-state SQL smoke files explicitly and verify final catalog, owners, ACLs, RLS, and migration checksums, including no table/sequence authority for `booking_worker` and no client write policies. Then run tenant cutover preflight per profile/environment. Reconcile null/legacy identities; never infer Stripe account, destination epoch, checkout/refund generation, or tenant from today's configuration. Quarantine ambiguity and record the exact digest accepted for every tenant. New v2 admission remains off until unresolved quarantine and nonterminal v1 effects meet the launch threshold (normally zero).

### Wave 3 — webhook ingress and provider probes

Enable signed webhook ingress while business admission stays off. There is no generic observe/shadow worker mode: inspect queues and provider state read-only first, then explicitly authorize `drain` only when executing existing test obligations is intended. Execute test-mode Stripe Checkout/late payment/refund/dispute, Google create/delete/reconciliation, notification accept/deliver/bounce, clean/EICAR scan, and admin login/MFA/session probes. Compare provider dashboards to ledgers and verify duplicates/reordering.

### Wave 4 — internal canary

With public admission still off, explicitly authorize the dedicated test-environment worker identity and scheduler, set `BOOKING_WORKER_ENVIRONMENT=test`, and select `BOOKING_WORKER_MODE=active`; the mode is environment-wide, not a per-tenant authorization mechanism. Activate only one staff-owned test tenant using its committed current cutover digest and verify every other tenant cutover remains disabled. For the controlled window, set the global live-admission flag only after that inventory check; the enabled tenant must still pass entitlement and provider readiness. Use low-value services and a reversible calendar, and limit rate/volume. Run real browser acceptance for availability, hosted checkout redirect, clean confirmation URL/cookie, contractor dashboard cancellation, refund, calendar recovery, notification audiences, attachment upload/download, and admin impersonation restrictions; the three checked-in fixture tests do not satisfy this gate.

### Wave 5 — tenant canary

Expand to 1%, 5%, 25%, 50%, then 100% of eligible tenants. Hold each step for at least two provider retry windows and one reconciliation interval. Require the go/no-go checks below at every step. Do not combine a code deployment, secret rotation, migration, or provider configuration change with percentage expansion.

### Wave 6 — cleanup

After all v1 obligations are terminal and retained evidence is signed off, revoke legacy RPCs/credentials and remove old webhooks/schedules in a separate change. Preserve quarantine/audit evidence and documented retention. Cleanup is not a launch prerequisite and is never performed during incident rollback.

## Canary go/no-go

All must be green for the entire hold period:

- zero cross-tenant/environment access or provider identity mismatch;
- checkout creation and webhook ingress success within SLO;
- payment totals match Stripe by account/currency/session/PaymentIntent/Charge;
- no double capacity; late payments either provably recover or enqueue exactly one remaining refund;
- refund ledger/payment/appointment/command convergence and no negative/over-refunded totals;
- due inbox/outbox/notification/scan queue age below two schedule intervals; dead-letter rate below alert threshold;
- calendar event IDs/destination epochs stable; no unexplained orphan or duplicate events;
- confirmation URL contains no durable bearer after redirect and another booking/reference cannot consume it;
- customer and contractor notification ledgers are independent and delivery failures do not change payment/capacity;
- attachments remain private, five-slot bounded, clean-only readable, and EICAR rejected;
- admin requires provisioned MFA-backed authority; revoked/disabled/impersonated sessions cannot perform forbidden destructive work.

## Rollback

Rollback is control-plane first and forward-only for data:

1. Set BOOKING_LIVE_ENABLED=false to stop new public obligations.
2. Leave signed webhook ingress enabled so provider truth remains durable.
3. Decide worker authorization separately from admission: if the worker code, credential, target environment, or scheduler may be unsafe, set `BOOKING_WORKER_MODE=off` and disable schedules; owed obligations and evidence remain durable but paused. Otherwise explicitly authorize `BOOKING_WORKER_MODE=drain` and only the safe worker families needed to converge existing obligations. Do not use `active` during rollback.
4. Freeze canary expansion, capture queue/inventory/provider snapshots, and page payments, database, calendar, security, and support owners.
5. Reconcile money from Stripe authoritative objects before capacity/calendar/UI. Never delete inbox, outbox, refund, notification, quarantine, attachment audit, or admin-session evidence.
6. Disable attachment upload separately if scanner proof/config drifts. Existing clean reads remain governed by DB/Storage policy.
7. Revoke a compromised worker/admin/provider credential and rotate it via expand/verify/switch/revoke. Do not broadly grant service-role as a workaround.
8. Deploy a forward fix or compensating migration. Do not reverse destructive migrations, rewrite migration history, or manually relabel provider evidence.
9. Resume internal canary from Wave 4 after the full automated, provider, and browser gates pass.

## Required real-runtime evidence

The mocked unit scripts prove request construction, allowlists, error classification, idempotency/fence propagation, and provider identity handling in real production modules. They do not prove provider behavior.

Before launch retain links/screenshots/log IDs for:

- the fresh local migration replay artifact plus an isolated target-backup restore with the exact hosted ledger/checksums and both explicit SQL smoke files; separately retain a second-connection concurrency run for SKIP LOCKED, last-slot exclusion, and lease reclaim, plus RLS through PostgREST/auth JWTs (none of those concurrency/JWT properties is proved by the checked-in SQL smoke files);
- Stripe CLI/dashboard signed webhook delivery, test clocks/delayed methods, Connect account scoping, response loss, refund/dispute ordering, and provider reconciliation;
- Pipedream/Google OAuth scopes, FreeBusy freshness, create/delete, 404 idempotence, ambiguous timeout recovery, trigger signature/retry, and calendar UI evidence;
- Resend verified domain, provider idempotency, delivery/delay/bounce/complaint webhooks, and both audience inboxes;
- scanner clean and EICAR probes, content digest binding, private Storage signed download, expiry, fifth/sixth attachment concurrency, legal hold and cleanup;
- browser acceptance for hosted Checkout redirects, opaque Session exchange, HttpOnly/Secure/SameSite receipt cookie, 303 clean URL, cross-booking rejection, duplicate tabs, refresh/back, cancellation/refund dashboard, and admin MFA/idle/absolute/revoke/impersonation behavior.
