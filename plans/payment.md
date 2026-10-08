# Payments, Booking, and Calendar — Product Requirements and Implementation Plan

## 1. Purpose

Build one trustworthy appointment-booking product across contractor website demos, contractor onboarding, live customer bookings, Google Calendar, Stripe Connect, and the existing Obra website builder.

The release replaces the current post-purchase setup-preview timestamps and dummy purchased-site checkout with a first-class booking domain. Obra is the system of record for appointment workflow and availability rules; Google Calendar is an external conflict source and synchronized calendar representation; Stripe is the source of truth for money.

The product has two deliberately separate Stripe domains:

1. **Obra billing** — Obra charges contractors for their Obra plan.
2. **Contractor customer payments** — customers pay a contractor through that contractor's Stripe connected account.

No provider credential is stored in browser code. Pipedream and Stripe secrets are configured manually in Lovable after the PR merges and before provider-backed rollout is enabled.

## 2. Confirmed product decisions

These decisions are accepted for this plan.

### 2.1 Pre-purchase demonstration

Every eligible pre-purchase published website uses one runtime-owned primary CTA label: **Book Appointment**.

The CTA opens:

```text
Dummy calendar
  -> dummy customer/payment form
  -> dummy booking confirmation
```

The demonstration:

- is clearly marked as a demo at every step;
- creates no appointment, reservation, customer, or payment row;
- calls neither Google/Pipedream nor Stripe;
- never sends dummy card fields to the server;
- resets when closed;
- cannot produce a real confirmation identifier or receipt.

### 2.2 Contractor post-purchase onboarding order

After Obra checkout, payment verification, OTP authentication, and contractor/profile linking, a Pro contractor follows this mandatory sequence:

```text
Order confirmation
  -> Authenticate Google Calendar through Pipedream Connect
  -> Choose calendars, configure availability, and set the full price per slot
  -> Set up Stripe Connect
  -> Provider readiness verification
  -> Existing Obra website-builder workspace
```

A provider redirect is not proof of readiness. The server verifies each completed capability before advancing.

Onboarding is resumable. Refresh, browser closure, expired Connect links, incomplete Stripe requirements, and transient provider outages return the contractor to the first incomplete step without discarding verified work.

### 2.3 Workspace actions

The existing contractor website-builder workspace exposes entitlement-aware contractor actions:

- **Website Leads** — shown to purchased Starter contractors and opens the authenticated `/leads` page containing quote requests submitted across that contractor's websites.
- **My Bookings** — opens the authenticated `/bookings` page for that contractor. The default view shows all future appointments. **Past Bookings** switches to previous appointments. Each appointment appears as a summary card and opens a complete detail dialog. Eligible future bookings expose **Cancel Booking**.
- **My Payments** — creates an authenticated, short-lived Stripe connected-account dashboard/login link server-side and redirects the contractor. A permanent or account-derived dashboard URL is never stored or exposed.

There is no **Change Availability** workspace CTA. Availability is configured during onboarding and later edited through a secondary **Availability Settings** action on `/bookings`. Saving the shared business configuration updates availability and price for every website owned by that contractor.

Starter contractors retain **Website Leads** even when subscription collection is degraded so previously collected requests remain operationally accessible; entitlement controls collection of new leads, not access to existing records. Admin impersonation must not create a connected-account login link or cancel a booking unless an explicit, separately authorized and audited support policy is implemented. The initial release hides or disables these contractor actions in admin mode.

### 2.4 Live booking enablement

A purchased Pro site enters real booking mode only when the server computes all of these facts:

- Obra subscription entitlement permits booking;
- Google/Pipedream connection is healthy;
- at least one readable blocking calendar is selected;
- exactly one writable destination calendar is selected;
- availability configuration is valid and active;
- Stripe connected account is ready for the required charge and payout capabilities;
- the booking service and price configuration is active;
- environment mode is consistent across Obra, Stripe, and Pipedream.

Before readiness, a purchased site does not show the dummy payment experience. It shows **Online booking is being configured** and preserves a quote/contact route.

### 2.5 Provider ownership

- Obra owns appointment workflow, availability rules, internal reservations, integration mappings, and mirrored payment status.
- Stripe owns payment execution, balances, payouts, refunds, and disputes.
- Contractors manage customer money in their Stripe connected-account portal.
- Google owns external calendar events; Obra retains the stable mapping and command/reconciliation state. Pipedream real-time events may invalidate availability, but external Google edits never mutate Obra appointment records.
- Provider readiness is represented by relational state and verified capability fields, never timestamps in `websites.onboarding_state`.

### 2.6 Initial Connect model

The planned integration uses:

- one connected account per contractor business/profile;
- Stripe-hosted or Stripe-managed onboarding;
- direct charges created in the connected-account context;
- no Obra application fee;
- a Stripe-hosted connected-account dashboard or login-link destination for **My Payments**.

This must be confirmed against the options enabled on the actual Stripe platform account before provider implementation is merged. Do not silently substitute destination charges.

### 2.7 Obra subscription pricing

- **Starter:** $79 USD per month.
- **Pro:** $129 USD per month.
- There is no one-time website or setup fee.
- The product owner creates one recurring Stripe Product/Price for each plan in test mode and again in live mode.

### 2.8 Legal documents

MSA and DPA changes are outside this implementation. Their current content must not be used to alter product behavior or block engineering in this plan.

## 3. User outcomes

### 3.1 Prospective contractor/customer viewing an unpurchased site

The visitor can experience the complete visual booking journey without creating data or being charged. The experience explicitly communicates that real appointment collection activates after the contractor purchases and connects services.

### 3.2 Contractor after purchase

The contractor can:

1. see an authenticated order confirmation;
2. connect the correct Google account;
3. select conflict calendars and one booking calendar;
4. configure recurring availability in a Calendly-like editor;
5. configure scheduling limits, duration, buffers, and booking price;
6. complete Stripe Connect onboarding;
7. resume incomplete provider requirements;
8. arrive in the existing website builder only after the onboarding sequence finishes;
9. open `/bookings` from **My Bookings**, review future and past appointments, inspect appointment details, cancel an eligible future booking, and open the secondary **Availability Settings** editor;
10. open their own Stripe payment portal from **My Payments**.

### 3.3 Contractor customer after activation

The customer can:

1. click **Book Appointment**;
2. see only currently bookable slots in the contractor's configured time zone, with the customer's display zone and full configured price clearly identified before selection;
3. provide name, email, phone, service address, optional notes, and optional images/attachments;
4. temporarily reserve the selected slot;
5. pay through Stripe Checkout in the contractor's connected-account context;
6. return to an Obra confirmation route;
7. see a truthful pending state until a signed Stripe event confirms payment;
8. receive a confirmed booking identifier and appointment details;
9. never receive a confirmed slot that overlaps an internal reservation; Google conflicts are checked with bounded freshness and a newly unavailable slot is rejected at final reservation with a reselection path.

## 4. Scope

### In scope

- exact pre-purchase CTA/demo behavior;
- authenticated, resumable post-purchase setup route;
- Pipedream Connect Google authentication;
- explicit Google account and calendar selection;
- Calendly-inspired availability setup and editing;
- one shared appointment type per contractor business/profile, including duration, buffers, scheduling limits, and one contractor-entered full booking price in USD applied to every website that contractor publishes;
- live availability computation;
- transactionally constrained slot reservations;
- Stripe connected-account creation/onboarding/readiness;
- direct-charge connected-account Checkout;
- separate SaaS and Connect webhook paths;
- webhook deduplication and reconciliation;
- hardened quote-request lead records/projections plus appointment, customer, calendar, payment, operation, and outbox records;
- Google event creation after payment confirmation and cancellation of the corresponding event/invite;
- Pipedream deployed-trigger synchronization for near-real-time calendar cache invalidation and connection health;
- workspace **My Bookings** and **My Payments** actions;
- contractor bookings page with future/past views, detail dialog, and idempotent cancellation/full-refund flow;
- private customer image/attachment upload and authorized contractor access;
- RLS, authorization, idempotency, audit, retry, and observability;
- test/live environment separation;
- Lovable migration and secret-configuration runbook;
- focused unit, database, integration, and browser tests;
- Starter **Website Leads** workspace action and authenticated `/leads` card/detail experience.

### Out of scope for the initial release

- teams, pooled resources, crews, rooms, or capacity greater than one;
- multiple services/prices per contractor;
- recurring appointments;
- rescheduling in any contractor or customer surface;
- customer self-service cancellation;
- partial refunds or refund amounts chosen in Obra;
- application fees or revenue sharing;
- coupons, discounts, tips, taxes, or multi-currency;
- cash/pay-later and saved-card charging;
- Google Meet creation;
- native mobile applications;
- importing historical Stripe transactions or Google events as appointments;
- replacing the existing website builder;
- MSA/DPA changes.

## 5. Current behavior to replace

The implementation must remove or supersede these behaviors rather than add a second path:

1. Purchased Pro sites currently render `SiteBookingPayDemo`.
2. `ProSetupWizards` marks Google and Stripe setup complete without contacting providers.
3. `saveProSetupStep` uses service-role writes without contractor ownership authorization.
4. `checkoutConfirmedAt`, `calendarSetupAt`, and `stripeConnectSetupAt` are treated as capability state.
5. Post-checkout OTP sends a purchased live contractor to the public landing page instead of a dedicated setup flow.
6. The same Stripe webhook endpoint/domain currently represents only Obra subscription billing and has no durable event inbox.
7. No appointment, reservation, calendar connection, connected account, or booking-payment domain exists.
8. The booking amount is a hard-coded dummy value.

The pre-purchase visual component may be retained only as a strictly client-side demo with a name and contract that cannot be mistaken for the live flow.

## 6. Experience and route architecture

### 6.1 Contractor routes

Add authenticated, no-index routes aligned with the existing contractor session:

- `/setup/$websiteId` — setup shell and authoritative step router;
- `/setup/$websiteId/calendar` — Google connection and calendar selection;
- `/setup/$websiteId/availability` — availability and booking configuration;
- `/setup/$websiteId/payments` — Stripe Connect onboarding/readiness;
- `/leads` — authenticated Starter lead-management page, resolving the contractor from the session rather than a trusted query parameter and aggregating quote requests across that contractor's websites;
- `/bookings` — authenticated contractor booking-management page, resolving the contractor from the session rather than a trusted query parameter, with a secondary **Availability Settings** action for the shared business schedule and price;
- existing `/user/$userId` — website builder with **My Bookings** and **My Payments** actions.

Every loader/server function calls `assertWebsiteWorkspaceAccess` or `assertProfileWorkspaceAccess`. Route parameters are locators, not authority.

The setup shell reads one server-computed setup projection and redirects forward/back to the first incomplete required step. Client state cannot skip a step. The first visit always renders an explicit authenticated **Order confirmed** step with plan and purchased-site context plus a **Connect Google Calendar** continuation CTA; acknowledging that screen is durable setup progress, not provider readiness. Later visits may resume at the first incomplete provider/configuration step.

### 6.2 Customer routes

- Existing public `/lp/$websiteId` renders demo, configuration-pending, or live booking mode from server facts.
- Add a public booking-session/Checkout creation endpoint or server function with strict website/service resolution.
- Stripe returns once with its Session ID to a server exchange endpoint; the server issues a short-lived Obra confirmation capability and redirects to a no-index confirmation route that no longer carries the Stripe Session ID.
- The confirmation route resolves only a minimal safe projection by the Obra capability; it never reveals another contractor's/customer's data and follows Section 15.1 security headers and expiry behavior.

### 6.3 Post-checkout transition

The SaaS success route continues payment verification and OTP linking, but after successful OTP for a purchased Pro website it navigates to `/setup/$websiteId`, not the public site.

Starter behavior is separate: after purchase it proceeds to the current workspace, does not enter Google/Connect onboarding, preserves quote-request forms on entitled published sites, and exposes **Website Leads** for reviewing those submissions.

### 6.4 Website Leads experience

- Purchased Starter workspace shows **Website Leads**; Pro workspace shows booking/payment actions. If a contractor has historical leads after upgrading, `/leads` remains accessible so existing data is not hidden.
- `/leads` defaults to newest quote requests first and uses cursor-based pagination; it does not issue an unbounded query.
- Each summary card shows submitter name, email, phone when supplied, submitted timestamp, a bounded project-details preview, and source website name/domain. Missing optional or custom fields render explicitly rather than shifting labels.
- Clicking a card opens an accessible detail dialog showing every submitted form field using the field label/schema snapshot captured at submission, source website, received time in the contractor's display zone, and safe contact actions (`mailto:`/`tel:` only after validation). Raw JSON, internal IDs, auth IDs, and untrusted HTML are never rendered.
- Leads are read-only in v1: no CRM status, assignment, deletion, export, bulk actions, or reply composer is implied. Empty, loading, error, retry, and no-longer-entitled-but-history-available states are defined.
- Contractor access is profile-scoped and website attribution is preserved. Anonymous users never read lead rows directly. Admin/support behavior follows the authorization matrix.
- Existing `leads.form_data` is insufficiently self-describing for changing/custom forms unless it stores a stable schema snapshot. Add a normalized safe projection or immutable field-definition snapshot so historical labels/order/required flags remain intelligible after website regeneration.
- Lead submission remains bounded, server-validated, rate-limited, spam-resistant, and idempotent enough to prevent accidental duplicate form submission. Validate website publication and Starter lead entitlement at submission time; do not trust client profile/license IDs. Define payload/field count/field length limits and retain only accepted fields.
- Lead PII follows the centralized retention/deletion/offboarding policy, is excluded from logs/metrics, and remains available only through authorized projections.

### 6.5 Availability UX

The UI should match Calendly's interaction model without copying protected visual assets:

- weekly schedule rows for Sunday–Saturday;
- enabled/disabled day toggle;
- one or more time intervals per day;
- copy one day's intervals to selected days;
- contractor IANA time-zone selector;
- calendar-style date overrides for unavailable or custom hours;
- service duration;
- start-time interval;
- minimum scheduling notice;
- maximum future booking horizon;
- pre/post buffer;
- location mode/details;
- required **Price per booking** field, charged in full for every slot, displayed in USD and persisted as integer cents;
- inline validation and a right-side or lower preview of customer-visible slots;
- explicit Save/Continue during onboarding and Save changes afterward;
- unsaved-change protection;
- accessible keyboard, focus, error-summary, and mobile behavior.

Persist normalized intervals, not a UI-specific JSON snapshot. A server preview endpoint uses the same availability engine as public booking.

### 6.6 My Bookings experience

- `/bookings` opens on **Upcoming / Active Bookings**, defined exhaustively as `end_at > database_now` and ordered by nearest start first; it includes in-progress and cancelled records with their status. A secondary **Availability Settings** action opens the same Calendly-inspired editor used during onboarding.
- **Past Bookings** is `end_at <= database_now`, ordered newest first. Cancelled bookings remain visible in the appropriate chronological view with a clear cancelled/refund status.
- Pagination or cursor-based loading prevents an unbounded appointment query. Search/filtering is not required for v1.
- Every summary card shows customer name, appointment date, local start/end time and time zone, service address, amount paid, payment/refund status, and appointment status.
- Clicking a card opens an accessible detail dialog showing booking reference; customer name, email, and phone; service address; customer notes; private attachment list with authorized download links; appointment date/time/time zone and duration; amount/currency; paid-at timestamp; Stripe payment status; refund amount/status/time; Google calendar delivery status; booked-at timestamp; cancellation timestamp; and safe failure/review status where applicable. Stripe secret identifiers and internal provider payloads are never displayed.
- Eligible future paid bookings show **Cancel Booking**. Past, already-cancelled, cancellation-pending, or unresolved-payment bookings do not.
- The CTA opens a destructive confirmation dialog that states the appointment time, customer, full refund amount, and that rescheduling is unavailable. Confirmation submits one idempotent cancellation command.
- Cancellation is a durable workflow, not a client sequence: atomically mark the appointment `cancelled`, release the internal slot once, and enqueue the independent Stripe refund, Google event cancellation, and Obra notification commands. Refund creation uses the connected-account context and a deterministic idempotency key. Google cancellation uses the stored event identity and sends attendee updates where supported.
- The appointment becomes **Cancelled** once the authorized command is durably accepted and the slot is released. The card separately derives **Refund pending** and **Calendar cancellation pending** from their independent axes. It shows **Cancelled · Refunded** only after the full refund succeeds and the Google cancellation is reconciled. A calendar `not found` result is treated as cancelled; a refund or calendar error remains visible as `refund_failed` or `calendar_cancel_failed`, alerts operations, and is safely retryable without a second refund.
- A contractor may cancel any appointment whose start time is still in the future. No additional cancellation cutoff applies in v1.
- Rescheduling is not available in v1.

### 6.7 My Payments behavior

- Visible only to authenticated contractors whose profile has a connected account.
- Server verifies profile ownership and account mapping.
- Server creates a fresh Stripe login/dashboard link in the connected-account context and returns an allowed Stripe HTTPS URL.
- Browser redirects only to that returned URL.
- Incomplete/restricted accounts show **Continue payment setup** instead.
- Provider errors leave the contractor in Obra with actionable retry copy.

## 7. Domain model

Use `profiles.id` as the contractor/tenant key because it is the existing ownership root. Add a relational purchase/entitlement association to each purchased `website_id`; `checkoutConfirmedAt` cannot remain that association. Booking configuration is business/profile-scoped: every website published by the same contractor uses the same appointment type, full price, availability schedule, Google connection/calendar selection, and Stripe connected account. Only each landing page's content/design differs. Every tenant-owned table has RLS and tenant-scoped uniqueness.

### 7.1 `booking_services`

The initial release creates exactly one default appointment type per contractor business/profile. During availability onboarding the contractor sets its full price per slot; every website published by that contractor displays and charges that same complete configured amount.

Core fields:

- `id` and unique `profile_id`; the service is intentionally shared across the contractor's websites rather than keyed to one website;
- name and safe customer-facing description;
- `duration_minutes`;
- `slot_interval_minutes`;
- `buffer_before_minutes`, `buffer_after_minutes`;
- `minimum_notice_minutes`, `booking_horizon_days`;
- `location_type` and location instructions;
- `amount_minor`, ISO currency;
- `payment_policy`, fixed to `full_amount` in v1;
- `active`, `revision`, timestamps.

Amounts are integer minor units. The public client never supplies the authoritative amount.

### 7.2 `availability_schedules` and `availability_intervals`

Schedule:

- profile/service ownership;
- canonical IANA time zone;
- active flag and revision;
- timestamps.

Intervals:

- schedule ID;
- weekday;
- local start and local end;
- interval ordering;
- constraint preventing invalid/overlapping intervals for the same weekday.

### 7.3 `availability_overrides`

- schedule/profile ID;
- local date;
- type `unavailable` or `custom_hours`;
- optional normalized intervals;
- reason safe for contractor display;
- unique schedule/date identity.

### 7.4 `booking_customers`

- profile ID;
- normalized email and phone;
- name;
- required service-address fields and optional customer notes;
- consent/source timestamps;
- optional contractor-scoped convenience index only; email/phone do not create an automatic unique-person identity.

Every appointment retains an immutable booking-party snapshot. Sensitive customer fields are not exposed through public table policies. Customer-entered data for v1 is name, email, phone, service address, optional notes, and optional images/attachments.

### 7.5 `appointments`

Core fields:

- IDs for profile, website, service, customer;
- public opaque reference;
- start/end UTC instants;
- original local date/time and IANA zone;
- location snapshot;
- service/price/duration snapshots;
- orthogonal appointment state and reason;
- payment, refund, calendar, and review states;
- current version;
- reservation expiry;
- confirmed, cancellation-requested, and cancelled timestamps; completion is derived from end time;
- created/updated timestamps.

The authoritative state axes and transition contract are defined in Section 15.1. Do not add payment, refund, calendar, or review outcomes to the appointment enum. State transitions occur only through guarded server/database commands, never arbitrary updates.

### 7.6 `booking_attachments` and private storage

- appointment/customer/profile/website IDs;
- private storage object key;
- original and safe display filename;
- MIME type, byte size, checksum, upload state, and timestamps;
- optional image dimensions;
- deletion/quarantine state.

Uploads use a private Supabase Storage bucket, signed upload/download URLs, tenant-bound object paths, server-authorized finalization, MIME/extension/magic-byte checks, and no public object URLs. V1 accepts images only: JPEG, PNG, and WebP; at most five images per booking; at most 10 MB each. Files remain quarantined until malware scanning succeeds through an available scanning service; failed or unavailable scans do not become downloadable by the contractor. Attachments are associated first with the opaque booking/hold context and become contractor-visible only after server finalization and a clean scan; abandoned or expired holds enqueue orphan cleanup. Attachments are not copied into Google Calendar event descriptions or Stripe metadata. Cancellation does not immediately delete attachments; retention follows the appointment-data policy.

### 7.7 No-overlap constraint

Use a PostgreSQL range over `[start_at, end_at)` plus effective buffers and an exclusion constraint for active blocking states, scoped to the profile/resource. If extension support or generated ranges are unsuitable in the deployed Supabase environment, use a service-role transactional RPC with a per-profile advisory lock and an overlap query protected by the same lock.

The constraint/RPC is authoritative. Browser slot display and Google FreeBusy are advisory inputs.

### 7.8 `appointment_operations`

- profile and appointment IDs;
- operation type;
- client request UUID;
- canonical request hash;
- state/result/error code;
- timestamps;
- unique profile/operation/request key.

Same key plus same hash returns the stored result. Same key plus a different hash is rejected.

### 7.9 `booking_payments`

- appointment/profile IDs;
- connected-account mapping ID;
- expected amount/currency snapshot;
- Stripe Checkout Session, PaymentIntent, Charge, and Refund IDs;
- payment and refund states;
- amount paid/refunded;
- paid-at, refund-requested-at, refunded-at, and failed-at timestamps;
- dispute state;
- safe failure details and receipt URL;
- provider created/updated timestamps;
- local timestamps.

No PAN/CVC, bank credentials, or Stripe secret is stored.

### 7.10 `stripe_connected_accounts`

- unique profile ID;
- Stripe account ID and livemode/environment;
- chosen account/controller configuration snapshot;
- onboarding state;
- `charges_enabled`, `payouts_enabled`, `details_submitted`;
- capability/requirements snapshot needed for UI;
- disabled/reconnect reason;
- last verified and timestamps.

### 7.11 `calendar_connections`

- profile ID;
- immutable Pipedream external user ID;
- exact Pipedream account ID;
- app slug and environment;
- account identity metadata safe to retain;
- health state and reconnect reason;
- last verified/synchronized timestamps;
- disconnected timestamp.

Do not store Google access/refresh tokens when using Pipedream-hosted authentication.

### 7.12 `calendar_selections`

- connection/profile IDs;
- Google calendar ID and display name;
- access role and time zone;
- `blocks_availability`;
- `receives_bookings`;
- active flag;
- unique connection/calendar identity;
- database constraint or transaction enforcing exactly one active destination calendar per profile.

### 7.13 `calendar_event_links`

- appointment/profile IDs;
- connection/account/calendar IDs;
- Google event ID, iCalUID, ETag;
- desired appointment version;
- sync state/error/attempt timestamps;
- unique appointment and unique provider-event mapping where appropriate.

### 7.14 `pipedream_bindings` and trigger ingress

- profile/website/connection IDs;
- deployed trigger ID and pinned component key/version;
- exact Pipedream account ID and selected calendar set;
- trigger state, configuration revision, deployment environment, last event/health timestamps, and safe error;
- webhook correlation identity;
- unique active binding per intended account/calendar subscription.

A Pipedream ingest-event table stores delivery/dedupe identity, binding ID, signature timestamp, processing state, attempts, and safe error. Raw payload retention is minimized and redacted.

### 7.15 Provider event inboxes and outbox

Use separate Stripe SaaS and Connect event context in one typed inbox or separate tables. Persist:

- event ID, account/context, livemode, type, API version;
- received/processed timestamps;
- processing state, attempts, safe error;
- unique event identity.

An `integration_outbox` stores deterministic calendar create/cancel and reconciliation work with desired appointment version, attempts, next attempt, terminal state, and last safe error. Reschedule/update operations are not part of v1.

## 8. Availability engine

### 8.1 Inputs

- active service and scheduling configuration;
- normalized weekly intervals and date overrides;
- contractor IANA time zone;
- current time, minimum notice, and horizon;
- internal active reservations/appointments including buffers;
- selected blocking Google calendars;
- Google FreeBusy intervals and per-calendar errors.

### 8.2 Algorithm

1. Generate candidate local intervals in the contractor's IANA zone.
2. Reject nonexistent DST wall times and deterministically disambiguate or reject repeated times according to the final product decision.
3. Convert candidates to UTC instants while retaining local representation.
4. Apply notice, horizon, duration, interval, and buffer rules.
5. Subtract internal blocking ranges.
6. Fetch/consume short-lived FreeBusy for every selected blocking calendar.
7. Fail closed for an affected contractor if any required calendar returns an inaccessible/partial error.
8. Union external busy intervals and subtract them.
9. Return a bounded range and safe customer-facing time-zone metadata.

Cache FreeBusy briefly. The cache key includes profile, Pipedream account, calendar set, requested range, schedule revision, and environment. Never cache an error as free availability.

### 8.3 Final reservation command

1. Validate public website and live-booking readiness.
2. Resolve service, price, duration, account, and calendar server-side.
3. Validate the requested slot shape.
4. Perform a fresh or explicitly bounded-staleness FreeBusy check outside the transaction.
5. Enter the database reservation transaction/advisory lock.
6. Recheck current schedule revision and internal overlap.
7. Insert an expiring appointment hold and operation identity.
8. Commit without waiting on Stripe or Google.
9. Create connected-account Checkout with Stripe idempotency.
10. Attach its IDs to the booking-payment record.
11. Return the Stripe URL.

If Stripe Session creation definitively fails, fail the operation and release the hold through the serialized protocol. Ambiguous outcomes are reconciled with the same persisted Stripe idempotency key. The 15-minute DB hold and Stripe's minimum 30-minute native Session expiry are distinct: at the DB deadline the worker explicitly expires/retrieves the Session and arbitrates with payment before releasing capacity. Late payment recovers only an atomically free slot; if reallocated, it deterministically enters automatic full-refund processing and notifies both parties. It must never create a second confirmed appointment for the slot.

## 9. Pipedream and Google Calendar integration

### 9.1 Server client

Add one server-only Pipedream module that:

- obtains and caches the client-credentials access token until a safe pre-expiry margin;
- sends `Authorization` and the pinned `X-PD-Environment` header;
- validates configured project/environment/origin;
- maps profile IDs to immutable external user IDs;
- normalizes errors without logging credentials or full provider payloads;
- supports Connect token creation, account discovery/listing, explicit-account proxy requests, and account disconnect.

No `@pipedream/sdk` is required unless current official docs make it necessary at implementation time.

### 9.2 Google connection flow

1. Authenticated server creates a one-use Connect token for the exact external user and allowed origin.
2. UI opens Connect Link.
3. Connection callback/polling discovers the account.
4. Server verifies returned account ownership and Google app slug.
5. Server lists calendars through the explicit account proxy.
6. Contractor chooses blocking calendars and one writable destination.
7. Server verifies FreeBusy access and performs a non-destructive write-capability check appropriate to Google/Pipedream behavior.
8. Connection becomes ready only after validation.

Multiple Google accounts may be connected, but the booking configuration references one explicit active account. Never use Pipedream's implicit most-recent account behavior.

### 9.3 Scopes

Request least privilege sufficient for:

- FreeBusy;
- calendar list selection;
- creating, patching, and deleting Obra booking events on the selected destination calendar.

Pipedream Connect is the permanent Google authentication and integration layer, not a temporary v1 choice. Use Pipedream-hosted Google OAuth. Revalidate the exact least-privilege Google scopes exposed by the selected Pipedream component during implementation.

### 9.4 Event synchronization

Payment confirmation inserts a deterministic outbox event. The calendar worker:

- drops stale desired versions;
- uses explicit Pipedream account/calendar IDs;
- creates an event with stable correlation properties and an idempotent/deterministic identity where supported;
- persists event ID, iCalUID, and ETag;
- transitions appointment sync state;
- retries only transient 408/429/5xx/network classes with capped jitter;
- routes exhausted or conflicting work to manual review.

No database transaction is held over Pipedream/Google network calls.

### 9.5 Real-time Pipedream trigger synchronization

Deploy a Pipedream Connect Google Calendar instant trigger for each active external user/account/calendar subscription. Current official component metadata indicates `google_calendar-new-or-updated-event-instant` as the likely component, but implementation must discover and pin the production component key/version and configured prop schema through Pipedream's trigger APIs rather than hard-code an unverified name.

- Deploy with the stable `external_user_id`, explicit Google account `authProvisionId`, selected calendar IDs, `emit_on_deploy: false`, and an Obra trigger-webhook URL.
- Persist the returned deployed-trigger ID and complete configuration. Updating `configured_props` replaces the prior props, so updates send a complete validated configuration.
- Verify `x-pd-signature` against the exact raw body using HMAC-SHA256, constant-time comparison, and a bounded timestamp tolerance. Deduplicate and enqueue before acknowledging.
- Treat trigger delivery as near-real-time invalidation, not the booking system of record. On relevant created/updated events, invalidate affected FreeBusy cache ranges so subsequent slot searches fetch current availability. Duplicate, delayed, or missed events remain safe because final reservation performs a bounded-freshness FreeBusy query and periodic reconciliation remains active.
- External event details are not imported into Obra appointments, and externally moving/deleting an Obra-created event is intentionally ignored as product workflow. The contractor owns those manual Google edits. Internal appointments remain authoritative.
- On account reconnect, calendar-selection change, or disconnect, redeploy/deactivate/delete the associated trigger and never rely on an implicit latest account. Monitor Pipedream account and trigger health.
- Pipedream manages the underlying Google watch/channel, incremental fetch, OAuth refresh, and renewal for the instant component; Obra manages tenant mapping, deployed-trigger lifecycle, signed ingress, dedupe, observability, and reconciliation.
- The likely new/updated component does not cover cancellation. Because external Google cancellations are explicitly ignored, no separate cancellation trigger is required for v1. Obra-initiated cancellation calls Google directly through Pipedream and reconciles that command.

Official references: [Connect triggers](https://pipedream.com/docs/connect/components/triggers), [Deploy Trigger](https://pipedream.com/docs/connect/api-reference/deploy-trigger), [Connect webhooks](https://pipedream.com/docs/connect/webhooks), [Google push notifications](https://developers.google.com/workspace/calendar/api/guides/push), and [Google incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync).

## 10. Stripe implementation

### 10.1 Separate clients and context

One Stripe platform secret may access both domains, but code paths, metadata, webhook handling, and database records remain explicit:

- `kind=saas` for Obra billing;
- `kind=booking` plus connected-account context for customer charges.

Every Stripe create command uses an idempotency key derived from the durable local operation—not a random value regenerated on retry.

### 10.2 Connected-account onboarding

1. Authorized server command reuses or creates the profile's connected account.
2. Persist account ID before generating an onboarding link.
3. Generate a one-time Account Link or embedded onboarding session.
4. Refresh URL creates a new link after authorization.
5. Return URL retrieves account state; it does not mark readiness by itself.
6. Webhooks and explicit retrieval update capability state.
7. Setup completes only when the required direct-charge and payout readiness policy passes.

### 10.3 Customer Checkout

Create Stripe Checkout in the connected-account context using:

- server-resolved amount/currency and contractor branding where supported;
- appointment/payment/operation correlation metadata;
- customer email as convenience, not identity authority;
- the full configured per-slot price snapshot;
- success URL to the one-time server exchange endpoint containing Stripe's opaque Session ID; that endpoint immediately exchanges it for the Obra confirmation capability;
- cancel URL that returns to the website and permits hold recovery while unexpired;
- payment methods explicitly supported by the confirmation policy.

If delayed payment methods are enabled, confirmation handles asynchronous success/failure. Otherwise restrict the initial release to payment methods whose timing matches the desired immediate-booking experience.

### 10.4 Connect webhooks

- Verify raw-body signatures.
- Persist/dedupe before processing.
- Route by event ID, connected account, livemode, metadata, and object identity.
- Update mirrored state idempotently.
- Never trust delivery order.
- Retrieve current objects when ordering or thin-event behavior requires it.
- Confirm payment before advancing the appointment.
- Mirror refunds/disputes. The only Obra-initiated refund in v1 is the full refund produced by an authorized **Cancel Booking** command; partial/manual refunds remain in Stripe.
- Reject environment/account mismatches.

### 10.5 My Payments

Use Stripe's supported connected-account dashboard/login-link mechanism for the chosen account configuration. The implementation must be selected only after confirming that the chosen connected-account model supports the requested destination. If no direct login-link API exists for that configuration, use the supported Stripe-hosted account-management link—not a fabricated URL.

### 10.6 Obra SaaS billing hardening in the same program

Before end-to-end release:

- add durable SaaS webhook dedupe;
- make webhook state authoritative rather than the success-page redirect;
- handle relevant Checkout asynchronous completion;
- preserve richer subscription/entitlement state or a lossless provider status;
- add Stripe creation idempotency;
- separate SaaS and Connect webhook context;
- define reconciliation for missed events.

Obra billing is monthly-only: Starter is **$79/month** and Pro is **$129/month**, with no website/setup fee. The user will create those two recurring Stripe products/prices. Customer Portal, taxes, discounts, upgrades, downgrades, and prorations remain out of scope unless separately approved.

## 11. Booking confirmation and calendar failure semantics

Stripe-confirmed payment is the money boundary. Recommended initial semantics:

1. signed webhook marks payment paid;
2. appointment becomes `confirmed`, calendar becomes `create_pending`, and the appointment blocks availability;
3. customer confirmation page says the appointment is confirmed and calendar delivery is being finalized;
4. outbox creates the Google event;
5. success changes calendar to `created`;
6. repeated failure changes calendar to `create_failed` and review to `calendar_reconciliation`, alerts operations and contractor, but does not change confirmed payment/appointment state or trigger an automatic refund.

This avoids making a paid customer wait on Google availability while retaining honest synchronization status and is a confirmed decision in Section 19.

## 12. Authorization and security

- Replace `saveProSetupStep`; do not extend it.
- Every contractor command authenticates and verifies profile/website ownership before service-role access.
- Public booking commands resolve account, calendars, price, service, and website ownership server-side.
- Never accept a client-provided Stripe account, amount, Pipedream account, Google calendar/event ID, profile ID, or provider state as authority.
- Apply RLS to every new tenant-owned table.
- Public/anonymous users receive no direct select policy on customers, appointments, payments, connections, or operations.
- Public endpoints return bounded projections and opaque references.
- Add CSRF/origin protection where cookie/session-based mutation paths require it.
- Rate-limit slot search, hold creation, Checkout creation, and confirmation lookup.
- Redact credentials, authorization headers, full provider payloads, payment details, customer notes, phone/email, and addresses from logs.
- Validate every provider redirect URL against allowed HTTPS origins.
- Store environment explicitly and prevent test/live cross-use.
- Account disconnect, deletion, and reconnect are authorized and audited.

## 13. Background work and reliability

Reuse the existing durable background-job and scheduler architecture where it fits instead of creating a second job framework. Add typed work for:

- calendar event create and cancellation for v1;
- expired hold settlement;
- connected-account health reconciliation;
- Stripe event retry/reconciliation;
- Pipedream account health;
- Pipedream deployed-trigger lifecycle and signed event ingestion;
- bounded periodic account/trigger health and Obra-created-event reconciliation;
- stale setup recovery and retention cleanup.

Every job carries profile, website/appointment, operation, environment, desired version, attempts, and safe terminal code. Workers use fenced claims, bounded backoff, stale-version dropping, DLQ/manual repair, and audited operator replay.

## 14. Workspace integration

Extend the existing workspace bootstrap with a server-computed booking-management projection, for contractor mode only:

- entitlement;
- setup/readiness state;
- availability summary/time zone;
- connected-account status;
- whether **Website Leads**, **My Bookings**, **Continue setup**, and **My Payments** are available.

Place actions in the existing workspace action/header/menu hierarchy, responsive on desktop and mobile. Avoid a parallel contractor dashboard in v1.

Suggested states:

- purchased Starter: **Website Leads**;
- ready Pro: **My Bookings**, **My Payments**;
- Google/availability incomplete: **My Bookings** plus **Continue booking setup**;
- Stripe incomplete/restricted: **My Bookings**, supported **My Payments**, plus **Continue payment setup**;
- provider degraded: retain operational access and add a precise remediation badge/action;
- Starter/no current entitlement: retain **Website Leads** when records exist; retain **My Bookings** when records exist and **My Payments** when a connected account exists; hide only new-booking setup/admission.

## 15. Readiness projection

Create one server/domain function that derives setup and public booking readiness from relational provider and configuration records. All consumers use it:

- setup router;
- workspace actions;
- public website mode;
- booking API admission;
- admin/support projection.

Do not duplicate readiness conditions in React components or persist a second boolean. Cache only if a measured need emerges.

## 15.1 Authoritative hardening requirements

Before implementation, this plan requires the following normative artifacts and invariants. They override any conflicting shorthand elsewhere in this document.

### Ownership, entitlement, repeat purchase, and routing

- Profile/business scope owns the shared service, price, availability, Google account/calendar selection, and Stripe connected account. Website scope owns purchase entitlement, publication/archive state, design/content, canonical URL, and booking-source identity. Shared settings apply only to booking-entitled websites and never grant entitlement.
- Public modes are exhaustive: unpurchased published = persistent demo; purchased Starter = quote/contact only; entitled Pro with incomplete/degraded shared setup = configuration pending; entitled and ready Pro = live booking; suspended/lost Pro entitlement = no new bookings but full operational access; archived/unpublished = no public booking.
- First Pro purchase runs full setup. A later Pro purchase reuses healthy shared setup and shows order confirmation plus a business-wide settings summary; degraded shared setup repairs only incomplete capabilities. Starter never enters booking setup.
- Each canonical public identifier resolves exactly one website. Legacy license redirects, previews/versions, archived/not-found behavior, and multiple live sites must never substitute the profile's first website. Appointment cards/details show source website name/domain.

### Orthogonal lifecycle and transition contract

Persist independent axes: appointment (held, payment_pending, confirmed, cancelled); payment (not_started, creating, pending, paid, failed, disputed); refund (not_requested, pending, succeeded, failed); calendar (not_required, create_pending, created, create_failed, cancel_pending, cancelled, cancel_failed); and review (none, late_payment, refund_failure, calendar_reconciliation, provider_inconsistency). Completion is derived from end_at <= database_now. UI labels are derived projections, never persisted aggregate states.

Every command/event has database-enforced preconditions, state changes, capacity effects, deterministic side effects, retry rules, and terminal outcomes. Required transitions include reserve, Checkout create, payment success, hold expiry, both late-payment outcomes, cancellation, manual refund/dispute, Google create/cancel, and provider reconciliation.

### Serialized hold, Checkout, expiry, payment, and cancellation

- Database time owns the 15-minute hold. Stripe native Checkout expiry is 30 minutes to 24 hours and is not the capacity deadline.
- One transaction creates the hold, operation, payment shell, upload context, server-resolved request hash, deterministic Stripe key, and deadline. Checkout operation states are reserved -> creating -> created | ambiguous | failed, under a fenced lease. Same key/hash returns the result or poll token; a different hash rejects.
- Checkout uses a supported native expiry. At 15 minutes, the expiry worker locks and marks the aggregate expiring, explicitly expires/retrieves an open Session, then re-locks/version-checks before releasing capacity. Payment webhook and expiry serialize on the same aggregate.
- Late payment recovers the slot only if atomically still free. If reallocated, record late payment, enqueue one idempotent automatic full refund, notify customer and contractor, and escalate only failed compensation. Indefinite manual-review-only handling is forbidden.
- Cancellation locks the appointment, verifies DB time is before start, creates one cancellation operation, marks appointment cancelled, releases once, and atomically enqueues refund, Google cancellation, and Obra email. Refund equals paid minus already refunded. Fully refunded is idempotent success; partial refund refunds the remainder; pending/failed refunds remain visible and retryable. Direct-charge refunds use connected-account context and may pend/fail for insufficient balance.
- Calendar commands carry desired appointment version. Cancellation advances it; stale creates cannot start; ambiguous/in-flight creates reconcile by deterministic event identity; any post-cancel create is deleted before calendar cancellation is reconciled.

### Tenant, authorization, inbox, and worker invariants

- Tenant/environment-inclusive candidate keys and composite foreign keys (or equivalent database constraints) prevent cross-profile composition of entitlement, website, service, customer snapshot, appointment, payment, connected account, calendar, operation, and attachment. Tenant/environment keys are immutable.
- Anonymous users have bounded command endpoints only and no direct sensitive-table reads. Contractors access only their records. Admin impersonation is denied server-side for cancellation, refunds, Stripe dashboard links, disconnect, and money-moving repair. Webhooks only insert verified inbox events. Workers and scanners use fenced claims and narrow transitions. Repair uses explicit audited RPCs.
- Every SECURITY DEFINER RPC revokes PUBLIC execute, pins search_path, schema-qualifies objects, authorizes actor/tenant internally, and forbids arbitrary state writes. Define and test role-by-table-by-operation RLS and Storage matrices.
- ACK provider delivery only after durable inbox insert. Inbox processing uses fenced leases and commits inbox outcome, domain transition, and deterministic outbox insertion atomically. Define stale-lease reclaim, replay, DLQ, and reconciliation.
- Stripe dedupe identity includes event family, event ID, connected account/context, destination, API version, and livemode. Pipedream dedupe uses binding/trigger plus emitted event identity or payload hash; signature timestamp is replay evidence, not identity. Metadata locates but never authorizes.

### Customer confirmation, availability, uploads, and privacy

- Exchange the Stripe Session ID once at the server return boundary for a high-entropy, short-lived Obra confirmation capability. Confirmation uses no-store, restrictive referrer policy, no third-party scripts, minimal projection, rate limits, and constant-shaped errors.
- Define customer projections for normal/prolonged pending, failed payment, unpaid expiry, recovered late payment, automatic-refund late payment, refund pending/failed, confirmed-calendar-pending/failed, and invalid/expired capability. Polling is bounded; safe refresh/reselection preserves non-sensitive entered data and clean uploads.
- Guarantee internal non-overlap only. Google availability is bounded-freshness; final reservation rechecks and rejects a newly busy slot. Define FreeBusy TTL and false-unavailability SLO. Pipedream created/updated events invalidate cache; deletions may remain stale until TTL/reconciliation.
- Create a durable pre-booking upload context. Each single-use upload capability binds tenant, website, context, exact key, MIME, size, checksum, quota slot, and expiry. Reserve five-file quota atomically; verify bytes; scan via CAS quarantine transitions; issue clean-only downloads; reference-check before cleanup. Visible states are uploading, scanning, ready, rejected, scanner unavailable, expired/deleted. Attachments remain feature-gated until a scanner is selected and proven.
- Every appointment stores an immutable booking-party snapshot; never merge identity automatically by email/phone or rewrite history. Before production, approve centralized retention/deletion/anonymization periods for all PII, attachments, appointments, provider events, audits, logs, caches, backups, abandoned holds, and offboarding. Production is blocked until this policy exists.
- Obra independently sends idempotent transactional email for booking confirmation, cancellation, refund initiated/succeeded/failed, and late-payment refund. Email failure never changes money/capacity state.

### UX and operational access

- /leads remains available for historical authorized records after upgrade or entitlement degradation; new lead collection follows each website's Starter entitlement projection.
- /bookings partitions exhaustively: Upcoming/Active is end_at > now; Past is end_at <= now, using DB UTC. Ordinary holds/failed attempts are excluded; confirmed, cancelled, completed-derived, and review records remain visible.
- My Bookings remains available for existing records regardless of entitlement/provider readiness. My Payments remains available whenever a connected account and supported dashboard access exist, alongside remediation. New-booking readiness alone controls admission.
- Demo always says **Demo — no appointment or charge will be created**, uses **Simulate payment** and **Demo complete**, and defines back/close/reset/refresh/focus behavior. Exactly one semantic primary CTA becomes Book Appointment; secondary contact/navigation links remain contact links.
- Configuration-pending shows contact only when a public channel exists and contact is not hidden. Business-wide settings show affected entitled-site count and preserve input on revision conflict.
- Add a route-state table for completed/repeat setup, missing OTP/session, forbidden/missing/archived website, failed provider returns, invalid confirmation, prolonged pending, and expired hold.

### Provider contracts pending/fixed

- Freeze Stripe Accounts v1/v2 plus exact controller/role tuple, requirements collector, dashboard type, fee payer, loss/negative-balance/support responsibility before creating connected accounts. My Payments branches by dashboard type: Express uses Login Links; full dashboard uses normal Stripe access; dashboard none requires embedded/custom management or is rejected.
- Connected-account readiness requires active requested card_payments, charges_enabled, chosen payout predicate, and no blocking currently_due, past_due, disabled_reason, or pending verification. Stored snapshots are UI aids; current state is reconciled.
- Pin Stripe event family/destination/API version and enforce livemode. Production destinations may receive test events.
- Choose one Pipedream webhook-key model per environment: project key or trigger-level returned signing key. Capture/rotate securely. authProvisionId lives inside the discovered app prop in complete configured_props; updates replace all props. Do not assume delivery retries.
- Google create/delete explicitly includes the customer attendee and sendUpdates=all. Persist a deterministic 5–1024 lowercase base32hex event ID derived from environment plus immutable appointment identity; reconcile ambiguous insert with events.get. Do not conflate ID and iCalUID.

## 16. Observability and audit

Append audit records for:

- Google connect/discover/select/reconnect/disconnect;
- availability and service configuration revisions;
- connected-account create/onboarding/readiness/restriction;
- Pipedream trigger deploy/update/deactivate/delete and signed delivery processing;
- quote-request submission/access, source attribution, entitlement gating, and hold, appointment, cancellation, refund, and calendar-cancellation state transitions;
- Checkout creation and ambiguous outcomes;
- Stripe webhook processing;
- calendar create/cancel attempts and Pipedream trigger lifecycle;
- contractor dashboard-link creation;
- operator replay/repair.

Metrics and alerts:

- lead submission success/rejection/rate-limit/spam signals and lead-list latency/errors (without PII labels);
- slot-query latency/error/staleness;
- holds created/expired/converted;
- overlap-constraint conflicts;
- Checkout creation and payment conversion;
- webhook age, duplicates, failures, and DLQ;
- connected-account readiness/restrictions;
- outbox lag and calendar sync failures;
- Pipedream/Google 401/403/429/5xx;
- reconciliation drift;
- cross-environment rejection.

Use tenant-safe correlation IDs without customer PII in metric labels.

## 17. Three-bucket implementation sequence

The phases below are delivered in three sequential development buckets. Complete, verify, and review one bucket before beginning the next. The buckets are organizational boundaries only; they do not weaken the invariants or completion criteria in this plan.

### Bucket 1 — Local product and data foundation

Implement everything that can be completed and verified without Stripe or Pipedream credentials:

- update product constants to Starter $79/month and Pro $129/month with no setup fee;
- add the authoritative profile-versus-website entitlement model, shared business booking configuration, orthogonal lifecycle columns, tenant/environment integrity, RLS/Storage/RPC authorization foundations, provider inbox/outbox and idempotency schemas;
- add provider-independent availability rules, overrides, one shared service/price, booking/customer/payment/calendar mapping shells, transition contracts, hold/concurrency primitives, and readiness projection types without making external calls;
- harden Starter quote-request submission with website entitlement/publication checks, immutable field-schema snapshots, bounded validation, duplicate/rate/spam foundations, and source-site attribution;
- implement the authenticated Starter **Website Leads** workspace CTA and /leads cards, pagination, details, empty/error states, historical access, and cross-tenant authorization;
- implement the exact pre-purchase demo wording and semantic primary **Book Appointment** CTA boundary without enabling live booking;
- add provider-independent setup/readiness route shells and business-wide availability editor foundation only where they do not pretend a provider is connected;
- add static/database/unit verification for schema contracts, tenant isolation, lifecycle/state projections, lead access, pricing, and route/UI foundations.

**Bucket 1 exit:** all local migrations, generated types, server functions, routes, and UI compile and pass verification; Starter leads work end to end locally; no screen or database timestamp falsely represents Google or Stripe readiness; no provider secret is required. The user applies the Bucket 1 migrations through Lovable/Supabase after merge.

### Bucket 2 — Provider onboarding and verified readiness

After the user configures secrets in Lovable, implement and verify provider connectivity:

- freeze the Stripe Accounts/controller/dashboard configuration from the user's Stripe screenshots, then implement account create/reuse, Stripe-hosted onboarding, readiness reconciliation, event destination/webhook inbox, and the supported **My Payments** branch;
- implement the Pipedream server client, hosted Google Connect, account discovery, explicit calendar selection, least-privilege verification, trigger deployment/signing-key lifecycle, signed ingest, cache invalidation, health/reconnect, and reconciliation;
- complete the resumable post-purchase order confirmation -> Google -> shared availability/price -> Stripe -> workspace flow, including repeat-purchase reuse and degraded-provider repair;
- activate the server-computed readiness projection while keeping live customer charging disabled;
- verify strict test/live and development/production isolation, webhook signatures, provider identity scoping, retries, and operator diagnostics.

**Bucket 2 exit:** a test contractor can complete and resume verified Google and Stripe onboarding, provider health is webhook/reconciliation-driven, **My Payments** uses the selected supported dashboard path, and no redirect alone marks readiness.

### Bucket 3 — Live booking, money movement, cancellation, and operations

Enable the customer-facing real flow only after Buckets 1 and 2 are accepted:

- implement live availability/FreeBusy, bounded cache, final revalidation, serialized 15-minute hold, Checkout creation/ambiguity/expiry, confirmation capability, attachments/scanning, and customer transactional email;
- implement signed payment transitions, late-payment recovery/automatic compensation, Google event creation, deterministic event identity, Pipedream invalidation, and truthful confirmation states;
- implement /bookings, future/active and past views, details, source-site attribution, **Availability Settings**, cancellation, remaining refundable amount, Google invite cancellation, and independent refund/calendar status;
- finish SaaS/Connect reconciliation, scheduled workers, DLQ/replay/repair, retention and purge jobs, observability, kill-switch drain behavior, canary rollout, and full concurrency/security/browser test matrices;
- remove the purchased-site dummy path only when live readiness admission and rollback behavior are verified.

**Bucket 3 exit:** the complete paid booking and cancellation journey passes provider test-mode, concurrency, crash-boundary, replay, cross-tenant, accessibility, and operational acceptance; production remains gated on Lovable migrations, secrets, webhooks, scanner, retention approval, and controlled live canary.

### Secret and environment boundary

Local implementation never requires production secrets. Code must fail closed with actionable configuration diagnostics and expose only documented server-only environment names. The user enters Stripe and Pipedream values through Lovable after merge. Missing credentials may block provider-backed Bucket 2/3 runtime verification, but must not block Bucket 1 implementation or lead to fake readiness.

## 17.1 Detailed implementation phases

### Phase 0 — Decisions and provider contract confirmation

- Lock the confirmed ownership model: each website has its own purchase entitlement and landing page, while all booking-entitled websites for one contractor share one business-level service, price, schedule, Google calendar configuration, and Stripe connected account.
- Lock confirmed product constants: Starter $79/month, Pro $129/month, no setup fee, one shared service, full USD payment, 60-minute duration, 30-minute interval, 24-hour notice, 60-day horizon, zero buffers, 15-minute hold, US-only Connect, and zero application fee.
- Confirm current Stripe connected-account configuration supports direct charges and the required hosted payment portal.
- Record a provisional test/live product, webhook, Connect, and Pipedream setup checklist.

Stripe operational configuration confirmation is required before provider-backed end-to-end testing, but it does not block provider-independent schema and UI implementation.

**Exit:** the shared contractor-level booking ownership model and all foundational product constants are reflected consistently in schema and domain contracts.

### Phase 1 — Database, entitlement, and authorization foundation

- Add the authoritative website/profile/subscription/environment association, lossless SaaS subscription mirror, durable SaaS webhook inbox, reconciliation, and entitlement projection before any live booking admission.
- Define admission for trialing, active, incomplete, incomplete_expired, past_due/grace, unpaid, paused, and cancelled states; entitlement loss stops new bookings but preserves operational access.
- Add normalized domain tables, tenant/environment composite integrity, orthogonal state axes, guarded transition RPCs, RLS/Storage policy matrices, event inbox, and outbox.
- Regenerate Supabase types.
- Add authorization/readiness domain functions.
- Deprecate insecure setup timestamp writes.
- Add provider-independent state-machine, hostile cross-tenant, lease/replay, crash-boundary, and entitlement tests.
- Approve centralized retention policy constants and select/prove a malware scanner before enabling attachments.

**Exit:** tenant graph integrity, authorization, entitlement, hold/payment/expiry/cancellation serialization, atomic inbox-domain-outbox, idempotency, revisions, retention gates, and valid state combinations pass database tests.

### Phase 1B — Starter Website Leads

- Harden lead submission with exact website/profile entitlement resolution, schema snapshots, bounded validation, rate/spam controls, and duplicate-submit protection.
- Add contractor-authorized cursor-paginated lead listing/detail projections with source-site attribution and safe custom-field rendering.
- Add `/leads` and the entitlement-aware **Website Leads** workspace action while preserving historical access after upgrade or entitlement degradation.
- Add retention/offboarding treatment, audit events, empty/error/retry states, and hostile cross-tenant tests.

**Exit:** a quote request submitted on one entitled Starter website appears once for its contractor with the correct source and field labels, cannot be read by another contractor, and remains historically accessible when new collection is disabled.

### Phase 2 — Contractor setup shell and availability

- Add order-confirmation/setup routing.
- Build Calendly-inspired schedule editor and preview.
- Add normalized save/load commands with ownership/revision checks.
- Capture the required full USD price per slot during availability onboarding.
- Add the same editor behind the secondary `/bookings` **Availability Settings** action with authorized revision-checked saves.

**Exit:** a contractor can configure and later edit one shared service's availability and price; every booking-entitled contractor website uses the update without gaining entitlement from it, and public slot computation works against rules/internal holds without providers.

### Phase 3 — Pipedream/Google

- Add server client and configuration validation.
- Implement Connect Link, discovery, explicit account/calendar selection, validation, health, and reconnect.
- Add FreeBusy adapter and outage/partial-error behavior.
- Add event create/cancel outbox worker and reconciliation foundation.
- Discover, pin, deploy, persist, and lifecycle-manage the Google Calendar instant trigger per account/calendar subscription.
- Add raw-body signed Pipedream webhook ingress, dedupe, cache invalidation, retry, and account/trigger health handling.

**Exit:** a test contractor connects Google, selects calendars, sees external busy time removed, receives a signed near-real-time change event that invalidates availability, and a test appointment creates exactly one mapped event under retries.

### Phase 4 — Stripe Connect

- Add account create/reuse, onboarding links, readiness, Connect webhooks, and reconciliation.
- Add **My Payments** authenticated redirect.
- Add connected-account Checkout creation and booking-payment mirror.

**Exit:** a test connected account onboards; a customer direct charge appears in that connected account; duplicate webhooks do not duplicate bookings; contractor can open supported Stripe management.

### Phase 5 — Live customer booking

- Split demo and live components.
- Add slot search, customer details, hold, Checkout redirect, confirmation route, payment-driven appointment transition, and Google outbox handoff.
- Introduce one semantic primary-conversion slot and render/intercept only that slot as exact **Book Appointment** when booking mode applies. Migrate existing `QuoteCta` or one explicitly designated site-kit `Button href="#contact"` into that slot; never intercept every matching contact button. `contactHidden` does not suppress an eligible booking CTA. Navigation and secondary contact links retain their original behavior.
- Add required name, email, phone, service address, optional notes, and private image/attachment upload.
- Add configuration-pending behavior.
- Add authenticated `/bookings` future/past views, detail dialog, and the idempotent Cancel Booking -> full Stripe refund -> Google event cancellation workflow.

**Exit:** two concurrent attempts cannot purchase the same slot; a successful full payment produces one appointment and one Google event; failed/expired payment releases the slot; an authorized cancellation refunds the remaining refundable amount at most once, cancels the mapped Google event/invite, and preserves a complete cancelled booking record.

### Phase 6 — Operations and rollout

- Verify and load-test the Phase 1 SaaS entitlement inbox/reconciliation in the target environments.
- Add scheduled hold/provider reconciliation and operator repair surfaces.
- Finish metrics, alerting, retention, and runbooks.
- Run test-mode end-to-end and staged production smoke tests.

**Exit:** operational checklist, migrations, secrets, webhooks, cron, rollback, and provider test matrices are complete.

## 18. Testing and acceptance matrix

### Product/browser

- pre-purchase demo never calls a server payment/booking endpoint;
- purchased Starter quote form creates one authorized website-attributed lead and **Website Leads** renders it without exposing another contractor's lead;
- lead cards/dialogs render custom-field snapshots safely, paginate, preserve historical access after upgrade/degradation, and cover empty/loading/error states;
- lead submission limits, rate controls, publication/entitlement checks, and duplicate-submit handling pass;
- post-purchase Pro resumes each incomplete setup step;
- route refresh and provider-return links cannot skip readiness;
- onboarding and `/bookings` Availability Settings use the same editor, support desktop/mobile/keyboard and unsaved changes, and updates apply across all booking-entitled contractor websites without changing entitlement;
- workspace **Website Leads** remains available for authorized historical leads, and **My Bookings** and supported **My Payments** remain available for existing records/accounts during entitlement or provider degradation, while new-booking actions follow readiness;
- bookings page future/past classification, card details, dialog accessibility, and pagination are correct;
- Cancel Booking requires confirmation and truthfully displays pending/failed/refunded states;
- authorized attachment upload/download succeeds and cross-tenant access fails;
- purchased unready site never displays dummy payment;
- confirmation remains pending until authoritative payment state arrives.

### Database/concurrency

- two customers attempt the last slot concurrently;
- same idempotency key/same payload replays;
- same key/different payload rejects;
- Stripe payment webhook and 15-minute hold-expiry worker race under one serialized protocol, with explicit Session expiration/retrieval and capacity released exactly once;
- buffers prevent adjacent overlap;
- schedule revision changes invalidate stale reservation attempts;
- cross-tenant table/RPC access fails;
- provider event IDs dedupe.

### Stripe

- account onboarding incomplete/ready/restricted/reconnect;
- direct charge belongs to connected account;
- Checkout create timeout is reconciled without duplicate charge;
- duplicate/out-of-order webhook delivery;
- asynchronous payment success/failure if enabled;
- refund and dispute mirror updates;
- duplicate Cancel Booking submissions create at most one refund for paid minus already-refunded amount; partial/manual/full prior refunds and insufficient connected-account balance are covered;
- refund succeeds while Google cancellation fails, and vice versa, without lying about composite status;
- wrong account/livemode rejected;
- dashboard-link authorization and expiry;
- SaaS and Connect events cannot cross-route.

### Google/Pipedream

- multiple accounts require explicit selection;
- selected calendar deleted/inaccessible;
- partial FreeBusy error fails closed;
- 401/403 causes reconnect state;
- 429/5xx uses bounded retry;
- timeout after successful event insert reconciles without duplicate;
- external busy event appears before final reservation;
- deployed trigger creation uses explicit external user, account, and calendars;
- signed trigger ingress rejects invalid/replayed signatures and deduplicates valid deliveries;
- duplicate/delayed/missed trigger events cannot expose an internally reserved slot;
- reconnect/calendar changes replace complete trigger configuration and clean up stale deployments;
- external Google edits are not imported into or applied to Obra appointment records;
- Obra cancellation handles Google `not found` idempotently.

### Time

- contractor/customer in different zones;
- daylight-saving gap and repeated hour;
- cross-midnight service;
- half-hour zone;
- override date and weekly schedule interaction;
- notice/horizon boundaries.

### Failure/recovery

- Stripe succeeds and Google fails;
- Google/Pipedream unavailable during slot search;
- every confirmation capability projection: ordinary/prolonged pending, failed, unpaid expiry, recovered late payment, automatic-refund late payment, refund failure, calendar pending/failure, invalid/expired capability;
- worker crashes between each durable transition;
- secrets missing/misconfigured fail closed with operator diagnostics;
- provider reconnect preserves valid internal bookings;
- repeat Pro purchase reuses healthy shared setup; entitlement loss blocks new bookings without hiding operational records;
- kill switch immediately turns new-booking admission off; with obligations and evidence preserved, separately authorized `drain` workers run the same core, notification, and attachment-scan families as `active` to reconcile open holds, Sessions, late webhooks, refunds, and triggers (only attachment-cleanup discovery is active-only), while `off` makes the cron route perform no work when the worker code or authority is unsafe. Worker mode is an application-route control and does not revoke a worker JWT's database RPC grants.

## 19. Confirmed decisions and remaining questions

### Confirmed

- Obra billing is monthly-only: Starter **$79/month**, Pro **$129/month**, no setup fee.
- The contractor configures one appointment type and one full USD price per slot during availability onboarding.
- Defaults are 60-minute duration, 30-minute interval, 24-hour notice, 60-day horizon, zero buffers, and a 15-minute hold.
- Payment confirms the appointment even if Google event creation later needs calendar reconciliation; no automatic refund occurs solely because calendar creation failed.
- Google/Pipedream outage fails closed.
- Late payment recovers only if the slot remains free; otherwise it automatically enters idempotent full-refund processing, not indefinite manual review, and escalates only if compensation fails.
- External Google edits are ignored as Obra appointment workflow; the contractor handles them manually.
- Contractor cancellation is allowed for any appointment whose start is still in the future; it issues a full refund and cancels the Google event/invite. Rescheduling and customer self-service cancellation are out of scope.
- Starter has no paid booking flow; entitled Starter websites collect quote requests and the contractor manages them through **Website Leads**.
- Customer fields are name, email, phone, service address, optional notes, and up to five optional JPEG/PNG/WebP images of at most 10 MB each; images remain quarantined until malware scanning succeeds.
- Only cards/immediate-confirmation payment methods are enabled.
- Connect rollout is US-only.
- Google integration always uses Pipedream-hosted Connect.
- Stripe uses direct connected-account charges with zero Obra application fee.
- Pipedream deployed triggers provide near-real-time created/updated-event delivery for availability invalidation; cancellations may remain falsely busy until the bounded cache TTL/reconciliation because the selected trigger excludes them.

### Remaining Stripe configuration confirmation

The product and architecture decisions are complete. Before testing Stripe Connect end to end, confirm in the Stripe Dashboard that the platform is enabled for US connected accounts and identify the connected-account configuration Stripe presents for hosted onboarding, dashboard access, direct charges, fee responsibility, and negative-balance/dispute-loss responsibility. This is an operational configuration check, not a request for secret values; see Section 20 for the exact information needed.

## 20. Lovable deployment and manual configuration

Migrations added under `supabase/migrations/` do not apply to production merely because the PR merges. Apply every booking/payment migration through Lovable/Supabase Cloud before deploying web code that requires the new schema.

After merge, use Lovable's secret configuration form to set the required values. Expected server-only configuration includes:

### Stripe — actions required from the product owner

Before Stripe-backed implementation can be exercised end to end:

1. In **test mode**, create two recurring monthly Products/Prices:
   - **Obra Starter — $79 USD/month**;
   - **Obra Pro — $129 USD/month**.
     Do not create a setup-fee Price. Share the two test Price IDs through Lovable secrets.
2. Activate/configure **Stripe Connect** for a US-only platform and confirm the connected-account configuration exposed by the account supports:
   - direct charges in the connected-account context;
   - Stripe-hosted onboarding;
   - a Stripe-hosted dashboard or supported login-link destination for **My Payments**;
   - connected-account refund and dispute management;
   - the intended responsibility for Stripe fees, negative balances, losses, and support.
3. Confirm platform branding, business/support details, statement-descriptor policy, and connected-account onboarding branding in Stripe.
4. Enable only cards and other payment methods that Stripe confirms immediately. Do not enable delayed methods for v1.
5. Register two HTTPS webhook destinations if Stripe configuration permits separate endpoints:
   - Obra SaaS billing events;
   - Connect events for connected accounts.
     Subscribe only to the event types the implementation consumes; include connected-account readiness, Checkout/payment success/failure, refunds, disputes, subscription changes/deletion, and invoice paid/payment-failed events as applicable.
6. Put the following test values into Lovable's server-only secret form:
   - platform test secret key;
   - SaaS webhook signing secret;
   - Connect webhook signing secret;
   - Starter recurring test Price ID;
   - Pro recurring test Price ID;
   - public application origin/return URLs as required.
7. After test-mode acceptance, repeat Products/Prices, Connect configuration, webhook destinations, and secrets in **live mode**. Test and live IDs/secrets must never be mixed.

No restricted key design or webhook event allowlist should be guessed before the selected Stripe Connect account configuration is visible. During implementation, provide screenshots of the relevant Connect settings pages or transcribe the displayed choices for the configuration items in Section 19; secret values themselves are entered only through Lovable and never shared in chat or committed.

### Pipedream

- client ID;
- client secret;
- project ID;
- explicitly pinned project environment;
- application origin;
- any webhook signature secret used by the selected trigger path.

No secret is prefixed `VITE_` or otherwise exposed to browser bundles.

Deployment order:

Before creating connected accounts, freeze and version the Stripe Accounts v1/v2/controller tuple, dashboard type, requirements collector, fee/loss/support responsibilities, event family/destination/API version, and My Payments branch. Map staging only to Stripe test plus Pipedream development and production only to Stripe live plus Pipedream production. Isolate connected-account/authProvision IDs, trigger IDs, webhook URLs/signing keys, and livemode. Verify Google OAuth production availability/scopes, allowed origins, discovered Pipedream component schema/version, quotas, webhook-key rotation, scheduler/DLQ/operator replay, and deploy/update/deactivate/delete/reconnect behavior. Canary one connected account before progressive rollout.

1. configure provider test projects/accounts and products;
2. apply migrations in Lovable/Supabase;
3. verify generated type parity and database probes;
4. configure test secrets and webhook endpoints;
5. deploy web code with live booking feature gate off;
6. complete test contractor onboarding and end-to-end charge/event tests;
7. enable for internal/test contractors;
8. configure live products, Connect, Pipedream production, secrets, and webhooks;
9. run production smoke test with controlled amounts;
10. enable live booking progressively;
11. retain a kill switch that changes purchased sites to configuration-temporarily-unavailable without reverting schema or showing the dummy flow.

## 21. Completion definition

The implementation is complete only when:

- pre-purchase websites provide the exact, safe demo flow;
- post-purchase Pro contractors are routed through verified Google -> availability -> Stripe setup;
- setup is resumable and cannot be forged by client timestamps;
- live sites expose only authoritative available slots;
- database constraints prevent internal double booking;
- customer payments are direct charges on the intended connected account;
- signed, deduplicated Stripe events drive payment state;
- paid bookings produce one internal appointment and one reconciled Google event;
- workspace **Website Leads**, **My Bookings**, and **My Payments** work under contractor authorization, and `/bookings` exposes secondary **Availability Settings**;
- `/bookings` accurately exposes future/past appointment details and safe private attachments;
- authorized cancellation refunds paid minus already-refunded amount at most once and cancels the mapped Google event/invite;
- signed Pipedream created/updated trigger events invalidate affected availability without becoming appointment authority; cancellation staleness is bounded by TTL/reconciliation;
- provider outages and incomplete setup fail closed with honest user copy;
- Starter lead entitlement, attribution, pagination, safe rendering, historical access, tenant isolation, booking idempotency, time-zone, retry, reconciliation, and operational tests pass;
- Lovable migrations, secrets, webhooks, schedules, rollout, and rollback are verified in the target environment.

## 22. Implementation journal — fourteen launch remediations

This is the durable reference for the ten launch blockers and four cursor.md discipline corrections from the 2026-08-28 audit. Complete means code plus executable regression plus applicable provider/Cloud evidence; source markers and builds alone are insufficient. Public live booking and production charging remain disabled until these items and Section 21 pass.

### Payment launch blockers

1. **Safe staged existing-data cutover.** Quarantine ambiguous legacy work, never reset unknown provider effects, fence v1/v2 writers and claims, and activate tenants only after committed current preflight.
2. **Database-authoritative Stripe evidence.** Reducers derive or strictly compare account, environment, IDs, amount, currency, event type, and causal cursor against locked immutable evidence.
3. **Atomic refund convergence.** Freeze one submission per generation and atomically persist exact provider truth, ledger/aggregate state, and command settlement under one fence.
4. **Fresh late-payment arbitration.** Recover only with current availability generation, calendar-set hash, and fresh FreeBusy under lock; otherwise automatically refund.
5. **Complete fenced Google recovery.** Freeze destination/event identity before dispatch and reconcile confirmed/cancelled × present/absent/conflict plus delayed create/delete races under leases.
6. **Multi-session server receipt flow.** Use server GET/303 exchange, per-booking HttpOnly cookies, locator-only clean URLs, response-loss replay, full Section 15.1 projections, and bounded polling/manual refresh.
7. **Complete transactional notifications.** Durable customer/contractor audiences cover confirmation, cancellation, refund pending/succeeded/failed, late-payment, and calendar repair outcomes; delivery failure never changes money/capacity.
8. **Complete scanner-backed attachments.** Bind fresh clean+EICAR proof to environment/config; keep bytes private until digest-bound clean verdict; add authorized download, outage retry, cleanup, legal hold, and approved retention.
9. **Complete admin authentication lifecycle.** Explicit principal provisioning and MFA enrollment/recovery; revoke opaque AAL2 sessions on disable, password/global-signout, MFA-factor, and recovery changes.
10. **Executable acceptance/deployment gates.** PostgreSQL, provider-mocked, browser/accessibility, concurrency/crash/replay, tenant, migration, hosted custom-role JWT, secrets/webhooks/schedules, canary, rollback, and runbook evidence satisfy Section 21.

### cursor.md discipline corrections

11. **Evidence before completion claims.** Record checks and limits; lint/type/build/substrings do not prove runtime behavior.
12. **One authority per invariant.** External evidence owns provider truth and one fenced database reducer owns each transition plus command settlement.
13. **Forward-only root-cause migration discipline.** Establish deployment state and use expansion → committed inventory → reconciliation → validation → canary → cleanup; never infer history.
14. **Complete matrices, not happy paths.** Test every state/evidence combination, timeout, retry, stale fence, response loss, reordering, tenant mismatch, and degraded configuration.

### Status journal

- **2026-08-28 audit:** all fourteen opened; BOOKING_LIVE_ENABLED=false and BOOKING_WORKER_MODE=off confirmed.
- **2026-08-28 remediation attempt (superseded):** implementations exist in all fourteen areas, but the strict follow-up audit rejected the prior completion claim. Presence of a migration, worker, runbook, or static verifier is not acceptance evidence.
- **2026-08-28 final repository remediation:** repository implementations for items **1–9 and 11** now pass the configured local verification aggregate; this does not complete the target/provider/browser matrices in Sections 18 and 21. Corrections include committed single cutover activation, immutable connected-account Stripe/refund evidence, fresh FreeBusy and six-state Google convergence, recoverable receipt exchange, complete notification repair projection, awaited attachment uploads, scanner/cleanup lease recovery, legal-hold/policy deletion revalidation through canonical v4 admin authority, final refund-generation fencing, least-privilege worker ACLs, synchronized generated types, and disabled-by-default environment-owned schedules.
- **Evidence actually obtained at that checkpoint:** `pnpm verify:payment-acceptance` passed repository checks, including migration quote hygiene; a fresh disposable local PostgreSQL 15 replay with Supabase compatibility shims and populated fixtures through the closure migrations; the booking SQL smoke plus the separate admin authority SQL smoke; provider-mocked Stripe/Google/Resend worker branches; generated-type verification; TypeScript; and three Chromium **fixture UI flows**. Those browser fixtures cover disabled safe-default rendering, `LiveBookingDialog` keyboard/ARIA/required fields with mocked server functions, and mocked receipt projections/manual refresh. They are not hosted Checkout/cookie/303/transport/security/provider acceptance. Focused ESLint and `pnpm build` also passed. This is repository evidence only, not a restored hosted-state test or hosted rollout proof.
- **Final supplemental blocker closure:** explicitly denied default PUBLIC/anon execution on every new definer; restored only explicit service/worker allowlists; fixed receipt checkout-session token binding; routed refund failures through reducer-owned settlement; quarantined inconsistent populated refund correlations; disabled unproven inherited retention approvals; enforced scanner readiness in SQL; introduced class-bound committed pre-delete authorization and documented its legal-hold point of no return; retired old attachment read authority; issued recovery codes to upgraded admins; fenced expired notification failures; required durable worker-family completion; revoked admin authority on provider confirmation loss; and made passive admin status non-touching.
- **Final environment-isolation correction:** the unscoped refund outbox claim was removed and replaced by `claim_due_booking_outbox(text,uuid,integer)`; SQL filters `o.environment`, cron passes the configured worker environment, the worker rejects mismatched rows, final ACL/types use only the scoped signature, and SQL/provider tests assert the boundary. Full acceptance passed afterward.
- **Strict PR-readiness vet (supersedes prior repository approval):** the environment-scoped refund claim correction is verified end to end: final SQL signature/filter and ACL, cron/worker threading, generated/compile-time types, a due test refund that a live claim cannot take but a test claim can, and the complete acceptance aggregate all pass. The vet nevertheless found repository P1 blockers outside that correction: transient refund/notification context reads can be terminalized; intermediate late-payment state can project false durable notices; payment-pending expiry is not dispatched; core expiry and Stripe-derived worker paths do not preserve the cron environment; legacy populated-data constraint validation can stop migrations before closure; and provider-work lease budgets lack renewal or a proved upper bound.
- **Still open / no PR (superseded by the 2026-08-29 vet below):** repository items **4, 7, 10, 12, 13, and 14** required correction or stronger evidence at this checkpoint.
- **2026-08-29 repository closure:** follow-up root-cause fixes closed the concrete repository P0/P1 findings: Stripe-object `livemode` is reducer-checked; the final worker ACL retains exact inbox renew/fail RPCs; late-payment and calendar work renew fenced item leases before provider calls and settlement; late recovery reapplies minimum notice; expired ambiguous Checkout creation releases capacity; transient Stripe/refund/session/notification/scanner obligations do not terminalize from attempt count; populated invalid notification recipients quarantine safely; corrected recipients can revive unsent suppressed events; payment mutations project refund notices transactionally; scanner verdict response loss never fabricates outage evidence; Google disconnect is contractor-reachable; Connect onboarding uses the collision-free `20260827121000` version and declares the column it writes; and refund-correlation quarantine moved to separately committed preflight `20260828179000` before the fail-closed money cutover. Pipedream account disconnect now reserves an actor-bound durable audit intent, issues an environment/external-user-scoped provider account DELETE, clears local readiness, and records completion; notification retry exhaustion uses bounded arithmetic and routes the still-unsatisfied delivery obligation to a private review queue.
- **Current repository evidence at that checkpoint:** `BOOKING_TEST_PG_PORT=55496 pnpm verify:payment-acceptance` passed on the then-current migration sequence. Its database leg created a fresh disposable local PostgreSQL 15 cluster (not a `DATABASE_URL` restore), installed Supabase compatibility shims, replayed selected migrations with populated fixtures, and proved refund mismatch evidence survives an intentionally failed money cutover plus populated invalid-recipient upgrade. It then ran `supabase/tests/bucket3-booking.sql` for final booking/worker ACLs and selected lifecycle/lease behavior and `supabase/tests/admin-auth-authority-closure.sql` for the narrower final admin authority contract. Provider-mocked lease/expiry/refund branches, generated types, and three Chromium fixture UI flows also passed. The fixture flows are not plan-complete transport/security/provider acceptance. `pnpm build`, TypeScript, focused ESLint, and the enhanced worker suite passed. Key SHA-256 receipts: refund preflight `a49024d2e6863c18651091fcb33e54cab36bc2d937b1a2d17f0ddca240ebb444`; money closure `3bf5ef87dee4d61cc063181a048a4b082721aa46ffcc33bc0056175c2f077304`; Google closure `f35835063c9a15935c9b72a71e1d3e98e3ff0e512b2696895ff493b9b3b91155`; customer closure `5b7fe104e42c92505312ef7d4da412b45b4dcf73efebc74eaf6397747ab32496`.
- **PR-readiness distinction:** the repository-side implementation is a viable payment change set, but **this checkout is not ready to raise a PR**. After fetching current `origin/main` at `eaf94609b8b7696d656add9f8a5050d826192c8c`, published HEAD `4c4fdae0f003683f571e0210a14c0a8423b4bcc5` is 47 commits behind with 102 tracked and 211 collapsed untracked status entries. Payment and unrelated work share tracked/generated files, so whole-file staging here is unsafe. Build a fresh non-history-rewriting branch/worktree from verified current main, reconstruct payment-specific paths/hunks, regenerate generated files, and rerun the complete matrix on that extracted SHA before raising a PR.
- **Rollout remains NO:** obtain the actual hosted Lovable/Supabase migration ledger/checksums, catalog/ACL/owners/data inventory, backup, custom-role JWT proof, real Stripe/Pipedream/Resend/scanner evidence, synchronized takeover/crash tests, broader browser/accessibility evidence, legal retention approval, canary, and rollback artifacts. SQL/RPC migrations are **not** applied by this source change alone and must later be explicitly applied through Lovable/Supabase Cloud only after authorization and preflight. No commit, push, PR, Cloud apply, provider registration, worker/schedule activation, or charge occurred. `BOOKING_LIVE_ENABLED=false`, `BOOKING_WORKER_MODE=off`, `BOOKING_WORKER_ENVIRONMENT=test`; migration schedules remain unscheduled.

### 2026-08-29 clean PR extraction

- Reconstructed only payment Buckets 1–3 on `fix/payment-buckets-1-3` from verified `origin/main` `eaf94609b8b7696d656add9f8a5050d826192c8c`. Mixed workspace/package/environment/site-kit hunks preserve newer main behavior; route tree, site runtime, and Supabase contracts were regenerated.
- All 25 new migrations use the forward-only contiguous range `20260829093900`–`20260829093924` above main's migration ceiling; cutover evidence markers use those durable names.
- Independent P0/P1 extraction audit fixes: manual Google repair derives its immutable actor from an opaque AAL2 admin session; durable SaaS webhook ingress processes only the signed durable event before ACK and returns non-2xx for settled projection failures; booking return requires its browser-bound HttpOnly handoff cookie; legal evidence records displayed Version 1.0 identifiers; and out-of-scope MSA/DPA content changes were removed.
- All static/provider-mocked checks passed; `BOOKING_TEST_PG_PORT=55510 pnpm verify:payment-acceptance` passed the fresh disposable local PostgreSQL 15 replay of the selected repository migrations with populated fixtures, the booking SQL smoke, the separate narrower admin authority SQL smoke, generated type parity, and all three Chromium fixture UI flows; nonincremental TypeScript, focused ESLint (zero errors; three Fast Refresh warnings), and `pnpm build` passed. `test:db:bucket3-booking` was not a restore step: when invoked with `DATABASE_URL` and `CUTOVER_TENANT`, it assumes an already restored/migrated isolated database plus a pre-created enabled test tenant and runs only `bucket3-booking.sql`. The three browser fixtures do not establish hosted redirects, cookies/303 exchange, transport security, cross-booking rejection, provider behavior, or the complete Section 18 matrix.
- Final closure SHA-256 receipts: preflight `a49024d2e6863c18651091fcb33e54cab36bc2d937b1a2d17f0ddca240ebb444`; money `8638b1e9ecfb69a901062d42bcab5f4e7f4040fa1578ba03436d1d93f913d345`; Google `11fe4c4cd56a72f96050864afd93c19c946c62e8fccf60b5543f83a2eabee74f`; customer `be4279986bd808cfe0caa999784f25ff6ea04cf4ed48195cae612066515bf9e4`; admin `00d0033090727ee64c62988f612b50acf6fd647ad7dbe0e126616d370b3042ab`.
- Rollout remains **NO**: hosted migration ledger/catalog/ACL/data inventory, an isolated restored-target-state migration/test artifact, target provider evidence, custom-role proof, legal approvals, full transport/security/browser acceptance, canary, and rollback receipts are still required. The exact payment chain is all 25 migrations in filename order from `20260829093900_booking_authorization_foundation.sql` through `20260829093924_admin_auth_authority_closure.sql`; `93920` is a separately committed refund-correlation preflight and must precede fail-closed closures `93921`–`93924`. No Cloud migration, provider registration, schedule/worker activation, or charge was performed; safe defaults remain `BOOKING_LIVE_ENABLED=false`, `BOOKING_WORKER_MODE=off`, and schedules disabled.

### 2026-09-01 current-main integration

- Merged current `origin/main` through `4ae574f315a1ec85c6a56062684a94ba9ed4cdf1` into PR #72 without rebasing or rewriting published history. Current main remains authoritative for generation/chat/media/job runtime, including PR #91's provider-wait semantics; payment functionality remains layered around those authorities.
- Combined generated Supabase contracts now cover 89 tables across 124 repository migrations. Shared workspace, chat, onboarding, and agent mutations are selected-website scoped. Strict Stripe readiness remains the booking-admission authority, while “My Payments” remains available under recoverable provider degradation when the reconciled account and completed-onboarding prerequisites still support a dashboard link.
- `BOOKING_TEST_PG_PORT=55530 pnpm verify:payment-acceptance`, `pnpm test:bucket1-generation`, `pnpm verify:workspace-lifecycle`, nonincremental TypeScript, production build, focused ESLint, and diff integrity passed. The local combined replay applies each duplicated canonical/Lovable generation revision once, retains the unique `20260829093506` compatibility patch, and applies `20260901100000_restore_gacha_yield_after_lovable_alias.sql` so the late Lovable mirror cannot erase contract-3 identity or planning-wait semantics; published migration history remains untouched.
- Rollout remains **NO**. Hosted ledger/checksum/catalog/data preflight must account for the 25 payment migrations sorting below already-hosted later main versions and the new forward-only gacha-yield closure. No migration may be marked applied without executing and proving its SQL. Charging, booking admission, workers, schedules, and provider delivery remain disabled.
