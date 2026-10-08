# Template Purchase → Personalized Site — Product Requirements and Implementation Plan

## 1. Purpose

Replace the current post-purchase landing (the agent workbench at `/user/$userId`, which renders the same `WorkspaceShell` family as admin tooling) with a guided, from-scratch purchaser flow:

```text
LP CTA click > Stripe checkout > email OTP verification > /user/<profileId>
```

OTP stays post-payment (today's checkout OTP), which removes the need for a new pre-payment OTP purpose.

`/user/<profileId>` hosts four step cards (content personalization, Google Calendar, availability, Stripe Connect) plus a bookings card. Step 1 scrapes the buyer's real business facts via Firecrawl and has an agent fit them into the purchased template's mold — content and images only, never design — then publishes a warnings-free `/lp/<website-id>`. An edit-mode page gives direct inline editing with AI assist, image upload, and draft/publish semantics.

This plan also removes the existing flow after the `/templates` purchase click. It ports nothing from `/admin`: no admin components, routes, or patterns are reused for the purchaser experience.

## 2. Locked decisions (user-confirmed)

1. **Selection UX**: direct inline editing — tapping editable text turns it into an editable field in place; the toolbar (edit affordances, wand for text) appears after editing.
2. **URL identity**: `<license-id>` is the existing opaque profile UUID (today's `/user/$userId` param). License numbers stay out of URLs (enumerable → IDOR risk); the license number is displayed inside the UI.
3. **Step scope**: the website edit flow and its card are common to Starter and Pro. Pro shows four cards after order confirmation, in 1-2-3-4 order: website content, Google Calendar, availability, Stripe Connect. `/setup/*` is retired into `/user`.
4. **Firecrawl source**: purchase-time business identity only (business name, license, city). No extra input, no URL field — matches the existing search-based enrichment seam.
5. **Plan location**: this document lives at `plan/template-purchase.md` alongside `plan/guide.md` and `plan/web.md`.
6. **Scope**: template and direct website-id Pro purchases both land on `/user`. `/setup/*` is a redirect shim only.
7. **Re-host rule**: server verification predicates stay the same (calendar ready → availability configured → payments). Step 2 is Google Calendar only; availability is Step 3; Stripe is Step 4. A post-Pipedream complete path persists one writable calendar and deploys the trigger. Unlocking Stripe still requires that chain — no payments bypass.
8. **Menu model**: hamburger menu on `/user` with Home, Appointments, Bookings (Pro only), Sign out. Starter sees My Appointments (website leads); Pro sees My Appointments + My Bookings.
9. **Blogs**: trade-relevant blog packs ship per template family (specified as trade-relevant rather than literal painter-everywhere — veto to change); all blog text editable with the wand like normal text.

## 3. Current-state evidence (why this plan looks the way it does)

### 3.1 The template-identity gap (load-bearing finding)

Today the system never records *which* template was bought:

- `DemoLpChrome` omits `websiteId` for template purchases (`src/routes/templates.painter11.tsx:9`), intentionally selecting generic acquisition.
- `ensureCheckoutWebsite` (`src/lib/checkout.functions.ts:526-532`) calls RPC `ensure_checkout_website`, which inserts a bare `websites` row (`status='draft'`, no version, no template reference — `supabase/migrations/20260829093903_verified_website_entitlements.sql:309-330`).
- `/lp/$websiteId` resolves **only** `website_versions.config_json` (`src/routes/lp/$websiteId.tsx:100-175`). No template branch exists.

Consequence: a purchased template currently has no user-owned site copy at all, and `/lp/<website-id>` 404s for it. Step 1 is therefore impossible without (a) capturing the template slug at purchase and (b) a template→version instantiation mechanism. Both are specified below as prerequisites, not assumptions.

### 3.2 What the purchaser sees today (the teardown map)

- Stripe `success_url` → `/checkout/success?session_id=` (`src/lib/checkout.functions.ts:583`).
- `checkout.success.tsx` and `verify-otp.tsx`: completed purchases with a profile go to `/user/$userId?websiteId=` (template id forwarded when present). Pending → `/verify-otp?flow=checkout`.
- `/user/$userId` renders `WorkspaceShell` — the agent chat + preview workbench (`src/routes/user/$userId.tsx:30-37`, `src/components/workspace/WorkspaceShell.tsx:58+`). This is the "same panel as admin" complaint: same component family as admin tooling (`AgentChatPanel`, `PreviewPanel`, `JobProgressPanel`).
- `/login` is contractor OTP login → `/user/$userId` (`src/routes/login.tsx:31-36`, `verify-otp.tsx:55-65`). Admins never touch `/login` (`AdminGate` in `src/routes/admin.tsx`).
- Setup chain: order-confirm → calendar → availability → payments, with `availability configured` gating payments (`src/lib/booking-readiness.ts`), all pro-gated (`hasCurrentActiveConfirmedPro`). New traffic uses `/user` hashes (`#step-2` / `#step-3` / `#step-4`); `/setup/*` redirects there.
- `/bookings` uses `Future`/`Past` views with detail dialog, cancel rules, and an Availability Settings link (`src/routes/bookings.tsx:20-28, 94-129, 186-348`).

### 3.3 Reusable seams (no new infrastructure where threading suffices)

- **Agent tools** (`src/lib/agent/tools/registry.ts`, all `serverOnly`): `firecrawl_scrape` (enqueue enrichment chain), `getEnrichmentSummary`, `suggestCopy` (feeds the wand), `applyConfigPatch` (categories `content|logos|media|reviews|contact|service_form`, audited to `website_edit_events`), `publishToLp` (optimistic-concurrency publish → `/lp/<id>?version=`), `generateSiteImage/Video`. **Constraint derived from the brief**: Step 1 and edit-mode may call patch-category tools only — `generateVariants` creates new designs and is forbidden in this flow.
- **Fact gating** (`src/lib/site-fact-sheet.ts:1-5`): quotes, ratings, photos, trust hrefs come only from contractor-matched Firecrawl hits. This is the user-required "filtered Firecrawl data."
- **Draft/publish model**: `websites.status` + `active_version_id`, `website_versions.status (draft|selected|discarded|live)` + `revision` CAS, `publish_website_version_atomic` RPC, live-fork-to-draft on live edits (`src/lib/agent/apply-config-patch.server.ts:353-358`, RPC `fork_website_version_with_media`).
- **Uploads**: `uploadSiteMedia` (`src/lib/upload.functions.ts:226-284`, `site-media` bucket, `upload` namespace, MIME/byte validation) powers the image edit popup; chat attachments already exist.
- **Providers**: Pipedream Connect calendar flow (`src/lib/booking-provider.functions.ts`, `pipedream.server.ts`) and Stripe Connect Express onboarding/verify (`src/lib/stripe-connect.server.ts`, `.functions.ts`) are reused 1:1, UI re-hosted.

## 4. Architecture decision: template-overlay versions (locked)

Static template pages (e.g. `PainterElevenTemplatePage`) are code, not config — `applyConfigPatch` cannot target them, and `/lp` cannot render them. The plan therefore makes each template page a pure function of **(static mold + per-user content overlay)**:

1. New forward migration adds `websites.template_slug` (nullable `text`, immutable once set, service-role write only) and a `website_versions.config_json` convention `{ kind: "template", templateSlug, content: {...}, media: {...} }` (no schema change to the jsonb column itself).
2. At purchase, the template slug is captured (see §5) and a version seeded from the template's default content manifest (checked-in per template, derived from its current static copy — a mechanical extraction, not a redesign).
3. `/lp/$websiteId` gains a branch: if the resolved live version config has `kind: "template"`, render the matching template component with the version's content/media instead of the unified renderer. Same mold, user data. Preview-token draft preview path is reused for edit-mode.
4. The Step 1 agent and edit-mode write **only** overlay keys (text, images, reviews, blogs, contact) via the existing patch-category semantics and `website_edit_events` audit; `generateVariants` is never invoked; layout/CSS/component tree are unreachable by construction (overlay type has no layout keys; server validation rejects unknown keys).
5. Publish reuses `publish_website_version_atomic` + `active_version_id` unchanged, but the `publishWebsiteVersion` wrapper gains a `kind==="template"` branch: template versions are validated by a new `validateTemplateVersionForPublish` (every overlay key inside the template's allowlist; every media storage path owned + attested via the existing attestation; lengths inside slot budgets) INSTEAD OF the unified brief/manifest/media-slot parity checks (`src/lib/agent/publish.server.ts:41-83`), which would otherwise refuse template configs. "Warnings-free" means: no demo banner content inside the page, no sample attributions in user-filled slots (slots the agent could not fill from matched facts keep neutral generic copy — never fake reviews, never invented credentials; see §8).

Why not generate a fresh unified-schema site instead: the brief forbids design change ("fit into the existing website mold"), and template pages are not expressible in the unified config schema. Overlay is the only option satisfying the constraint; it also makes "layout cannot change" structurally true rather than prompt-hoped.

## 5. New purchase flow (replaces post-click flow)

The `DemoLpChrome` dialog order is unchanged (plan → details → legal → Stripe); OTP stays post-payment exactly as today. The only purchase-dialog change is capturing `templateSlug` for template buys:

1. **LP CTA click** (template floating buy CTA): opens the existing checkout dialog (plan → details → legal consent), extended only with `templateSlug` capture for template buys.
2. **Stripe checkout open** (`createSaasCheckout` unchanged except the `templateSlug` parameter; reservation/immutability RPCs untouched).
3. **Email OTP verification post-payment** via the existing checkout OTP path (`/verify-otp?flow=checkout`, `verifyOtpAndLinkProfile`, resend included) — unchanged.
4. **Landing**: webhook-verified completion → `/checkout/success` → `/user/<profileId>` for every completed purchase with a profile. Direct website-id Pro buys no longer land on `/setup`. Pending path still routes through OTP completion first.

Edge cases: OTP expiry/invalid/resend behave exactly as today's checkout OTP; buyer abandons before Stripe (no charge, no site mutation; attempt expires via existing intent expiry); email already linked to a different license (existing guard stays); double-click CTA (reservation disposition `reused_pending_otp` already handled); Stripe cancel URL unchanged.

## 6. What is removed / retired (exact)

- Retired as post-purchase landings: `/setup/$websiteId` no longer receives checkout or OTP traffic (`checkout.success.tsx`, `verify-otp.tsx`). Purchaser cards live on `/user/$userId`.
- `/setup/*` routes remain as redirect shims so old bookmarks and in-flight Connect tokens resume on `/user` with `connect` preserved and hashes `#step-2` / `#step-3` / `#step-4`. Wizard UI is deleted.
- `/bookings` Availability Settings and purchaser BookingsCard link to `/user/…#step-3`.
- The new flow reuses, unmodified: `reserve_checkout_intent`, checkout session lifecycle + expiry, webhook reducer authority (browser never manufactures completion), legal evidence capture, OTP storage/context helpers, `DemoLpChrome` purchase chrome shell (dialog content reordered only).

## 7. `/user/<profileId>` page spec

Route stays `/user/$userId` (profile UUID). `beforeLoad` keeps `getWorkspaceBootstrap` + `Unauthorized → /login`. New component replaces `WorkspaceShell` for purchaser context. Layout: header (business name, license number, plan badge, published-site link when live, sign-out), then cards.

### 7.1 Order-confirm gate (Pro only)

- Pro purchasers see an order banner above the cards until `acknowledgeBookingOrder` succeeds (existing function, existing copy intent: payment alone does not confirm booking setup). Starter never sees it (no booking order exists on Starter).
- States: unconfirmed (primary button "Confirm booking order") → confirming (disabled, spinner) → confirmed (banner collapses; cards unlock) → failure (inline error, retry; RPC idempotent).

### 7.2 Step 1 card — website content (Starter + Pro)

States, in order (same card, no navigation except edit-mode):

1. **Fresh**: explains that the template still shows demo content; primary CTA "Get my information"; secondary line naming the source ("Uses your business name, license and city — no extra input needed"); disabled while any step-1 job runs.
2. **Scraping** (loading on the same card): indeterminate progress + step text ("Finding your business information…"). Server enqueues the existing `firecrawl_scrape` chain keyed by website; card polls job status (reuse `useJobProgress` pattern). Timeout: chain has no result in N minutes → failure state with Retry (re-enqueue idempotent by website+purpose key).
3. **Agent fitting** (same card, same loading animation continuing): "Fitting your information into your website…". Agent (server-side, no chat UI — the user explicitly requires no agent interface) reads `getEnrichmentSummary` + fact-sheet, writes overlay keys to a fresh draft version forked from the seeded template version, then `publishToLp` via the template publish branch (§4). Execution is headless (no chat UI): a `personalize_template` turn runs through the existing turn runner with tools hard-restricted to getEnrichmentSummary/suggestCopy/applyTemplatePatch/publishToLp (prompt listing + model API filter); the turn lease owns fenced mutations, so full agent-trace audit applies — never synthetic chat history, never generateVariants. Onboarding facts come from the existing `seedOnboardingFromProfile` seeding (`checkout.functions.ts:897+`); business facts come from the fact-sheet only. Layout-fit rules enforced: text clamped to slot budgets (per-template manifest max lengths; overflow truncates with ellipsis at render, never reflows layout), images cover-fit into fixed-aspect slots (`object-fit: cover`, fixed ratios from manifest), unmatched slots keep neutral generic copy (never invented reviews/credentials/phone numbers — phone/email come from purchase identity or stay empty with a "add in edit mode" hint, never fabricated).
4. **Done**: card shows live preview (owner-preview render of the live version), the published URL `/lp/<website-id>`, and CTA "Edit website" → `/user/<profileId>/edit-mode`. Returning later shows "Continue editing" instead only if a draft exists (see §8); otherwise "Edit website". Demo chrome is entitlement-gated (`showDemo = !entitlement`, `booking-readiness.ts:58`), so a live entitled site renders no banner or buy CTA regardless of version kind.
5. **Failure states**: scrape found nothing matched (fact-sheet empty → card explains nothing verifiable was found, offers Retry + "Edit manually" which opens edit-mode on the seeded draft); agent patch validation failure (draft discarded, error logged to `website_edit_events`-adjacent diagnostics, card shows Retry); publish fence conflict (revision mismatch → rebase draft onto live and retry once, then surface error). Every failure keeps the card, never a dead end; all actions idempotent.

Media rules: contractor-matched enrichment photos persisted via existing `persist-scraped-media` into `site-media` `enrichment/` namespace; generated template art stays unless replaced; user uploads go to `upload/` namespace; `proof` slots require evidence provenance per existing check. First-fold/hero motion slots are excluded from overlay media keys (not editable in Step 1 or edit-mode); other images update only with contractor-matched real images; insufficient matched images → keep template dummy art as-is (never empty slots, never unmatched fill).

### 7.3 Step 2 card — Google Calendar (Pro, after order confirm)

Status chip, not a wizard. Pipedream return with `connect=success` runs `completeGoogleCalendarConnection` (one healthy account, one writable calendar, email required, persist + signed trigger). Active requires readiness `calendar === "ready"` and a usable `account_email`. Empty Connect state when email is missing. Needs reconnect shows Reconnect plus Connect to different account. Availability is not embedded here.

### 7.4 Step 3 availability and Step 4 Stripe Connect (Pro)

Step 3 mounts today's `AvailabilityEditor` once Step 2 is actually connected (calendar ready and named email). Saving hours refreshes overview so Step 4 unlocks. If availability is already configured, Step 4 unlocks as soon as Step 2 is connected.

Step 4 is Stripe Connect Express onboarding, locked until `availability === "configured"` (and Step 2 connected). `connect=return` auto-reconciles; `connect=refresh` resumes onboarding. No payments bypass of the calendar/availability predicates.

### 7.5 Post-completion persistence

Cards persist as-is; each completed card flips to its edit state rather than resetting: Step 1 → preview + URL + Edit/Continue-editing; Step 2 → verified status + reconfigure/disconnect; Step 3 → ready status + dashboard/re-verify. Progress is derived from live readiness facts on every load (no client-cached completion flags), so refresh, re-login, and multi-device always show truth.

### 7.6 Navigation, appointments, and bookings

Navigation on `/user` is a hamburger menu with **Home** (overview), **Appointments**, **Bookings** (Pro only — hidden on Starter, not disabled), and **Sign out** (new thin control clearing the contractor session and redirecting to `/login`; no existing call sites found).

- **My Appointments** (Starter + Pro): recent website leads received, via existing `getLeadsPage` (`src/lib/leads.functions.ts:203`, profile-scoped, cursor-paginated): website, submitted-at, and form data per lead, with a "View all" deep-link to the existing `/leads` page. Same data behind today's lead flows; no new lead pipeline. Lead views inherit the existing per-lead governance audit traffic by design.
- **My Bookings** (Pro only): mirrors `/bookings` semantics with today's terminology — **Future** and **Past** tabs (not upcoming/previous), rows linking out to the full page for detail and cancellation (no duplicated dialog; destructive cancel stays on `/bookings` with its confirm flow), Availability Settings deep-link. New: none — reuse queries; the card is a compact embedding, full page remains at `/bookings`. Card visible when the profile has booking admission or ≥1 booking row; otherwise hidden.

## 8. Edit-mode page (`/user/<profileId>/edit-mode`)

Separate page (not a dialog): header (back to overview, prompt line "What do you want to change?", draft status pill: "No draft changes" / "Draft — N changes" / "Saving…"), the site preview, footer action bar.

- **Preview**: owner-preview-token render of the working draft in a contained frame (desktop/mobile width toggle; mobile toggle is view-only aid, not a separate draft). If no draft exists, entering edit-mode forks live (or seeded) → draft via existing fork RPC; "Continue editing" deep-links the existing draft. Entering edit-mode mints a short-lived owner preview token for the working draft; the frame loads `?version=<draftId>&preview=<token>`; tokens are single-flight per draft, rotated on publish, and expire per existing preview-token policy (implementation first confirms per-draft token support in `preview-token.server`, extending it minimally if absent).
- **Editable scope** (only): text, images, reviews, blogs, contact info. Text/contact/review/blog nodes render inside an editable container carrying an edit icon; clicking the container or the icon starts the inline flow. (Molds without a node kind expose only what they render — e.g. painter11 has no review list, so reviews are schema-validated and agent-writable but have no tap targets until a mold renders them.) Images show only the edit icon and only the icon is clickable. Non-editable regions never highlight and carry no icon. `logos` and `service_form` patch categories are out of scope for edit-mode (logo comes from Step 1 business identity only; lead-form fields fixed per template). A content-key→selector manifest per template (checked in with the template) maps overlay keys to DOM nodes — unknown nodes are not editable by construction.
- **Text flow** (user-chose direct inline editing): click the container or its edit icon → the text becomes an editable field in place → on commit, a toolbar appears with the edited value: **Improve with AI** (wand + label; calls existing `suggestCopy` constrained to the edited string's context; suggestion previews diff-style with Accept/Discard; Accept replaces field value, still unsaved until Publish) and per-item Reset. Escape/blur commits; empty string is rejected with inline error (slots have min lengths).
- **Images**: click the edit icon (the only hit target — the image itself is not clickable) → upload popup (file picker + drag-drop; existing `uploadSiteMedia` validation: MIME allowlist, byte check, size cap) → preview in slot (cover-fit) → part of draft on confirm; cancel discards the upload (orphaned storage objects garbage-collected by existing attestation/ownership checks — uploads only attach on draft save).
- **Reviews/contact**: same tap→edit→commit flow, no wand. **Blogs**: same flow WITH wand, like normal text. Reviews keep sample/fictional labeling rules: editing a seeded sample review clears its sample attribution immediately in the draft preview (it becomes the user's words, logged in edit events); a seeded sample published UNEDITED retains sample attribution — publish validation rejects sample-marked slots published as real.
- **Draft semantics**: every committed edit writes the working draft version (autosave with "Saving…/Saved" pill; revision CAS via `expectedRevision`; conflict → reload draft, preserve the user's in-flight field value, show "Updated underneath you — review and save again"). **Delete Draft** (enabled after ≥1 edit): confirm dialog → discards draft (and its media-slot rows), returns overview to pre-draft state. **Publish changes**: validates (all overlay keys known, media owned+attested, lengths in budget) → `publishToLp` → overview with fresh preview + URL. Publish is disabled while saving or with zero changes.
- **Return**: after publish, user lands back on `/user/<profileId>` (overview reloads readiness + preview). "Continue editing" CTA appears on the Step 1 card whenever a draft exists.

## 9. Data model + migrations (all forward-only, applied per cursor.md deployment ops)

1. `websites.template_slug` nullable text + immutability guard (set-once at purchase seeding; service-role write).
2. Checkout capture: `templateSlug` travels DemoLpChrome → `createSaasCheckout` → stored against the checkout intent (new nullable column or `context_json` extension — implementation to choose the smaller diff; must respect the paid-identity immutability trigger) and copied to `websites.template_slug` at entitlement grant (`grant_verified_website_entitlement` path).
3. Template default-content manifests: checked-in JSON per template (extracted mechanically from current static copy) used only for seeding; not user-editable, versioned with code. Manifests co-locate with their template component; a CI check fails the build when overlay keys referenced in code lack manifest entries (and vice versa).
4. No new OTP purpose: post-payment OTP reuses the existing checkout OTP (`resendCheckoutOtp` / `verifyOtpAndLinkProfile`); no new OTP tables.
5. No changes to: reservation/immutability RPCs, webhook reducer, provider RPCs, `website_versions`/`website_edit_events`/media-slot tables, publish RPCs, RLS posture (contractor rows scoped by profile+website ownership as today; license-number lookup endpoints must not enumerate — rate-limit + exact-match only).

## 10. Server functions (new vs reused)

- New: `getPurchaserOverview` (single bootstrap for the new page: profile, plan, order-confirm state, step readiness facts, draft existence, live URL — one round trip; bookings/leads counts stay on their dedicated queries), `runTemplatePersonalization` (enqueue firecrawl chain + agent fitting job; status endpoint reusing job-progress; headless execution per §7.2: turn-lease-owned fenced mutations, job id recorded inside `patch_json` metadata with no schema change, no chat UI), template-overlay read/write validators (key allowlist per template), `validateTemplateVersionForPublish` (template-kind publish gate for the `publishWebsiteVersion` wrapper branch).
- Reused unchanged: `createSaasCheckout` (+slug param), `finalizeStripeCheckout`, `verifyOtpAndLinkProfile`, `acknowledgeBookingOrder`, all `booking-provider.*`, `saveBookingAvailability`, all `stripe-connect.*`, `getBookingSetup`/readiness derivations, bookings queries, `uploadSiteMedia`, agent `firecrawl_scrape`/`getEnrichmentSummary`/`suggestCopy`/`applyConfigPatch`/`publishToLp`, fork/publish RPCs, `getLeadsPage`.
- Retired from the template-purchase path only (direct website-id purchases keep today's setup/workspace routing untouched; routes stay mounted): setup auto-redirects in `checkout.success.tsx` and `verify-otp.tsx` keyed on templateSlug presence; `WorkspaceShell` replaced for template purchasers.

## 11. Security, abuse, and honesty rules

- OTP (post-payment, unchanged): the existing checkout-OTP rate limits, resend cooldown, attempt binding, and guards stay exactly as they are; no new OTP abuse surface.
- IDOR: every user-page load asserts profile ownership via session (`assertWebsiteWorkspaceAccess` pattern); license numbers never in URLs; owner-preview tokens stay unguessable and short-lived; draft/preview endpoints re-check ownership.
- Uploads: existing MIME/byte/size validation;SVGs and executables rejected as today; storage paths namespaced per website.
- Publish fencing: `expectedRevision` CAS everywhere; double-publish and back-button resubmits are no-ops via idempotency keys.
- Honesty (non-negotiable, from template.md): no fabricated reviews/credentials/phone numbers — unmatched slots stay neutral or empty-with-hint; user-entered content is labeled as theirs; seeded sample content keeps sample attribution until replaced; the global demo chrome banner is out of scope for this plan.
- Webhook authority unchanged: only signed Stripe events advance payment state; the UI never manufactures completion.

## 12. Edge-case catalog (must all be handled, not listed)

Purchase/OTP: OTP to typo'd email (correction control invalidates prior code); buyer closes mid-Stripe (resume via same attempt while intent live; expired intent → restart, no duplicate profile — `upsertProfileForCheckout` idempotent); plan switch mid-flow (details step re-renders offer, reservation re-issued, old intent expired); existing-profile-already-has-auth-user (today's "Log in and purchase from the website…" guard preserved); duplicate purchase of second template (new website row per purchase; overview supports N sites via site switcher — specify max and chooser UX); payment succeeds but webhook delayed (checkout.success polls `pending` as today before showing steps).
Identity/entitlement: starter tries to open step 2/3 deep links (server denies: not pro; UI never links); pro downgrades mid-onboarding (cards re-derive: steps 2-3 + bookings hide, drafts retained, live site unaffected); subscription past-due/canceled/refunded (entitlement exits active/grace → steps 2–3, bookings, and appointments re-derive from readiness; live site follows existing entitlement-unavailable behavior; drafts retained); license number changes (profiles keyed by id; license displayed from profile row).
Scrape/agent: business not found anywhere (empty fact-sheet path, §7.2.5); multiple same-name businesses (contractor-match gate drops non-matching hits; card names the matched sources count; never merges strangers); Firecrawl outage (retry with backoff, then manual-edit fallback); agent produces over-length text (validator rejects key, job retries with tighter budget once, then surfaces field-level error in card); image hotlink dead (persist step skips + logs; slot keeps template art with hint).
Edit-mode: concurrent sessions two tabs (revision CAS + "updated underneath you"); upload of 50MB+ or wrong MIME (client pre-check + server reject, slot untouched); Delete Draft with in-flight autosave (save queue drained/cancelled first); Publish with zero changes (disabled); network drop mid-publish (idempotency key; overview re-derives truth on load); user edits seeded sample review then publishes (their text replaces sample + attribution cleared — logged in edit events).
Providers/bookings: calendar disconnect mid-flow (step 2 returns to pending; step 3 locks with reason); Stripe requirements newly due (step 3 flips to needs-attention; live booking admission unaffected until readiness recompute); bookings empty (card hidden per §7.6; page empty-states as today).

## 13. UI/UX rules carried across the new surfaces

Loading is always on the acting card (never a full-page spinner for card actions); every async action has disabled + labelled busy states; destructive actions (Delete Draft, disconnects) always confirm; phone/tel targets ≥44px; dialogs trap and return focus (existing booking-demo pattern); reduced-motion disables films/marching indicators; keyboard reaches every control including inline fields (Enter commits, Escape cancels); optimistic UI only where server-confirmed within the same interaction (draft saves), never for payment/publish truth. Highlight/edit affordances are ≥44px targets; tap-vs-scroll disambiguation (a tap under ~10px movement selects, anything more scrolls through); keyboard focus-visible parity from above covers Enter-to-edit and Escape-to-cancel.

## 14. Rollout + verification gates

1. Migrations (template_slug capture) reviewed → PR → merged → user-confirmed → dry-run → apply, per deployment ops. No app code depends on them before apply (feature-flagged reads).
2. Ship order: (a) purchase capture (template slug) + always-to-overview redirects (OTP path untouched); (b) overview page + order gate + Step 1 pipeline, starting with the painter11 pilot and then the plumber mold; (c) edit-mode; (d) steps 2–4 on `/user` (calendar complete path, availability, Stripe); (e) `/setup` is a redirect shim.
3. Gates per stage: tsc/eslint, production build, browser passes (desktop/mobile/reduced-motion/keyboard, zero console errors), contract checks (publish CAS, OTP rate-limit tests, IDOR probes across profiles, fact-sheet negative tests with lookalike businesses), and the falsifiable exit: a fresh test purchase of painter11 or plumber with an unknown business yields a live `/lp/<id>` with zero sample attributions in filled slots, layout pixel-identical to the template mold, no demo banner or buy CTA (`showDemo=false` asserted on the rendered page), and all three cards reaching edit states.

## 15. Open questions (explicit unknowns, not assumptions)

1. N-site overview: cap purchases per profile? Specify chooser UX when N>1 (decision needed before §7 header build). Note the license-URL alias resolves only with exactly one purchased live site (`lp/$websiteId.tsx:87-95`); a second live site loses the alias (UUID URLs only) — the switcher must surface per-site URLs.
2. `context_json` vs new column for template slug capture — smaller safe diff to be chosen at implementation against the immutability trigger (noted in §9.2).
3. Seeded-sample-review retention window: how many publishes may keep sample reviews before the card nags? (Policy call.)
4. `/setup/*` is retired into `/user` hashes; leftover `/setup` URLs redirect. Wizard UI is gone.

## 16. Workstream B — trade-relevant blog packs for /templates

Today every template's guide/blog strip is generic shared excerpts plus a sample disclosure. This workstream authors checked-in, trade-relevant posts per template family — painter posts for painter templates, plumbing posts for the plumber template, landscape posts for the landscape template (specified as trade-relevant rather than literal painter-everywhere; veto to change) — and wires them through the same overlay/edit/publish path as all other content.

- **Shape**: 3 posts per template, matching the current 3-card anatomy (category, title, excerpt, image). Fixed count of 3: layout slot budgets depend on it.
- **Authorship**: agent-generated at build time from a per-family brief, human-reviewed, checked in as overlay defaults (replacing the generic guide cards). Sample-labeled until personalized.
- **Images**: reuse existing family media (`help-*`, planning, journal assets); no new generation unless a family lacks coverage. Never hotlink, never unmatched fill.
- **No detail routes**: cards only. Upholds the template non-goal of no real blog routes; cards are the entire surface.
- **Step 1 agent**: keeps business-fitting posts and personalizes wording via overlay keys; never invents client stories, results, or credentials.
- **Edit-mode**: all blog text editable with the wand like normal text (§8); images via the upload popup; drafts/publish/Delete-Draft identical to text.
- **Cases**: business with no blog-worthy angles → keep generic trade posts (never fabricate); image shortage → reuse category media; category labels from a fixed per-family set; a family with fewer than 3 defensible topics still ships 3 slots filled with evergreen trade guidance (maintenance, hiring, seasonality), never filler about the template itself.
- **Acceptance**: packs live on the pilot template; every blog string editable with wand end-to-end; a drafts→publish round-trip leaves card copy, images, and attribution intact.
