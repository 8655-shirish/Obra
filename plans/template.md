# Image-First Contractor Template — Product Requirements and Implementation Process

## Purpose

This document records **how to reason from an unknown contractor brief to a coherent, image-first website template**. It is a reusable process contract—not a description of Garden Delite’s sections and not a file-by-file diary.

The governing recursive loop is:

1. **What user-visible outcome must exist?**
2. **Why is each proposed ingredient load-bearing?**
3. **How can the outcome use an existing designed seam instead of a parallel system?**
4. **What evidence would falsify the claim that it works?**
5. Re-run the loop on every failure until the root criterion—not only its visible symptom—is resolved.

## Settled product decisions

- Use a dedicated TanStack route and bespoke React page; keep production LP behavior independent.
- **Always create a distinct website with a distinct design system.** Each template must have its own typography, palette, shape language, spacing rhythm, image art direction, hero composition, component anatomy, and motion behavior—not a reskin of an existing template.
- **Always make the website strictly imagery-led and imagery-heavy.** Imagery should occupy approximately 70–75% of the visual real estate in every section; copy and controls must support the visual narrative rather than dominate it.
- **Always create an aesthetically pleasing, visually coherent website.** Treat beauty, balance, hierarchy, restraint, and polish as release requirements—not optional decoration.
- **Always begin design work from the perspective of a seasoned UI designer.** Establish intentional hierarchy, rhythm, proportion, typography, color relationships, interaction states, responsive behavior, and accessibility before implementation details drive the composition.
- **After implementation, always vet the finished website from a seasoned UI designer’s perspective.** Review it across representative desktop and mobile viewports; identify and resolve weaknesses in visual hierarchy, spacing, alignment, density, readability, contrast, image crops, interaction feedback, responsiveness, and overall coherence before declaring it complete.
- Let imagery establish credibility before copy decorates it. Define art direction before layout ornament.
- Reuse existing conversion seams: homeowner booking remains the booking demo; contractor website purchase remains the shared plan/checkout/OTP flow.
- **Every `/templates/*` catalog page is a template purchase, not generic acquisition.** Register a canonical `tpl_*` id (assigned once, never renamed) in the overlay registry and pass `templateId` on `DemoLpChrome`. Omitting it, or passing only an unregistered slug, silently sends buyers to the unified workbench/`/setup` path after pay — that is a release defect, not a fallback. Direct LP buys still pass a verified `websiteId`. Overlay/Step 1 personalization is part of the same ship (see below); a silent unified landing is a release defect.
- Use motion for continuity and hierarchy, never as a separate visual subject.
- **Cross-template uniqueness is a release criterion, not a preference.** Every `/template/*` page must establish its own design system: a different display/body type strategy, palette logic, shape language, spacing rhythm, image art direction, hero composition, card/component anatomy, and motion behavior from every existing template. Reusing information architecture or conversion seams never permits cloning another template’s typography, section composition, visual tokens, generated subjects, or signature components. Before implementation, compare against existing templates; after implementation, make a side-by-side design audit and reject any result that could be mistaken for a reskin.
- Component libraries are evidence and raw material, not permission to assemble a generic catalog page. Select only patterns whose behavior advances the new brand idea; adapt them into one coherent grammar.
- **Never mention or display attribution to ThreeUI, Three.js, component libraries, pattern catalogs, or similar implementation references in the customer-facing website.**
- Keep sample people, ratings, reviews, and contact data visibly labeled as template content.
- Host generated media locally, optimize it, and verify it in a real browser.
- A transformation must preserve property, camera, structure, and perspective.
  A reviewer can understand the offer in the first viewport, see multiple coherent project scenes, distinguish capability from proof, use the same-property comparison, start a homeowner consultation demo, start the platform’s contractor purchase flow, and operate every critical control on desktop or mobile.

## Scope

### Finished Homeowner Copy

- Painter templates must not display dummy/demo labels, invented reviews or contacts, "illustrative generated finish study", or instructions to replace media before publishing. Omit unsupported claims instead of removing a label while keeping misleading content.
- Keep generation provenance and required image attribution in media ledgers and linked credits, not scattered through homeowner copy.
- Without a configured live business, offer local project planning rather than simulated homeowner appointments or payments. This supersedes historical sample/demo requirements in this document. The real contractor template-purchase flow remains separate and must carry the registered template ID.
- Test every article and planner after scrolling to the bottom on a small touch screen. Close must stay visible, pass hit-testing and work by tap; Escape alone is not sufficient verification. Include landscape, enlarged text and visual-viewport zoom.

### In scope

Information hierarchy, art direction, responsive composition, restrained motion, accessibility, local media, truthful sample-proof labeling, homeowner booking, contractor purchase, and deterministic plus browser verification.

### Out of scope

Inventing customer claims; changing LP, Stripe, OTP, database, Pro-setup, or publishing behavior merely to host a static template; deployment or source-history changes without request; claiming ThreeUI, Three.js, shaders, or the private block catalog without executable evidence.

## Root-problem model

Blank composition, weak trust, generic media, confused conversion, and excessive motion usually collapse into one root mismatch: **the page has no explicit evidence hierarchy**.

The hierarchy is:

1. atmosphere—the desired future is tangible;
2. point of view—the contractor demonstrates taste;
3. capability—services explain what can be bought;
4. proof—the same-property comparison demonstrates change;
5. trust—clearly labeled sample reviews show the intended proof structure without deception;
6. help—field notes and FAQs reduce uncertainty;
7. action—homeowner booking and contractor purchase remain distinct.

Every component must advance one layer. Space without narrative purpose is not automatically premium. If it reads as missing media, correct the evidence hierarchy instead of adding ornament.

## Ingredient selection from first principles

### Route and shell

**What:** a thin route owns metadata/noindex and delegates to a dedicated page. **Why:** metadata and application composition are route work; storytelling is page work. **How:** use TanStack file routing and generated route-tree tooling; never hand-edit the generated tree.

### Typography and palette

**What:** establish a template-specific display/body/type-detail hierarchy and palette from the business category’s own materials and emotional promise. **Why:** typography and color are primary brand signals; carrying either across contractor templates turns a new concept into a reskin. **How:** audit every existing `/template/*` page first, then select a materially different font strategy, weight/width contrast, case behavior, tracking rhythm, and color logic. Local/system faces are valid when they support the concept; never default to another template’s setup merely because it already exists. Never use diminutive monospaced, typewriter-style, or all-caps utility typography in customer-facing top strips, headers, navigation, persistent metadata, or primary actions. In particular, do not use `SFMono-Regular`, `Roboto Mono`, `Consolas`, or equivalent typewriter faces in these surfaces. They are core wayfinding surfaces, not an implementation console: use a readable brand-compatible sans at a legible size or remove the strip entirely.

### Image system

**What:** define a central manifest and a template-exclusive, role-based shot list before generation. **Why:** isolated “pretty garden” prompts produce incoherent light, architecture, geography, and crops. **How:** define shared region, materials, light, horticulture, and realism constraints, then role-specific composition:

- heroes reserve quiet contrast behind type;
- services survive overlay crops;
- point-of-view images provide tactile vertical details;
- journal media supports landscape cards;
- before/after edits one source while preserving camera and structure.

For this implementation, missing roles were generated with the authenticated Higgsfield CLI and Seedream 4.5 under current repository billing/model rules. Every result was inspected. A care image with an artificial label was regenerated. An unsupported aspect ratio was corrected to a supported ratio rather than worked around.

### Motion system

**What:** use one short, silent, locally hosted landscape film as the moving hero background. **Why:** a coherent continuous shot makes the first fold feel alive without carousel mechanics or competing controls. **How:** generate a five-to-seven-second image-to-video clip from the approved hero frame with Seedance 2.0 Mini (the lightweight Seedance 2.0 variant exposed by the local Higgsfield catalog), constrain the prompt to subtle scene-appropriate motion, transcode to a fast-start browser MP4, and loop it with muted autoplay and inline playback. Serve the static poster instead when reduced motion is requested. **Never add a visible pause/play control to a contractor-template hero:** the short, subtle film remains atmospheric rather than an interactive control surface; preserve the static reduced-motion fallback.

### Conversion seams

**What:** preserve two jobs: homeowner consultation opens the dummy booking/payment experience; Purchase this website opens plan → contractor details → legal consent → checkout as **this template**. **Why:** a homeowner deposit and SaaS acquisition have different semantics, and a catalog buy without recorded identity is indistinguishable from generic acquisition after pay (`/login` shows the agent workbench; Pro falls through to `/setup`). **How:** wrap the page with existing `DemoLpChrome` and pass a registered `templateId` (copy `src/routes/templates.painter12.tsx`). Before the route uses the id, add it in all four overlay maps in `src/lib/template-content/overlay.ts`: `TEMPLATE_PURCHASE_SLUGS`, `TEMPLATE_IDS`, `TEMPLATE_ID_BY_SLUG`, `TEMPLATE_SLUG_BY_ID` (e.g. `painter15` → `tpl_painter15`). Unknown `templateId` must fail checkout with CHK-T01 before any charge. Do not omit `templateId` on a `/templates/*` route; do not pass only `templateSlug` (unregistered slugs fail open into the unified path). Do not rewrite applied SQL CASE maps to introduce a new template — new purchases dual-write `template_id`/`template_slug` from the overlay registry. Direct `/lp` buys still pass `websiteId`. Keep the shared Stripe handoff, checkout finalization, same-tab OTP, and verification. Overlay manifests (painter11/plumber today) are a separate ship for Step 1 personalization; identity-only still must land on the purchaser cards. Do not duplicate the state machine.

### Overlay wiring (same ship as the template)

**What:** the mold renders purchaser content from the template overlay — business name, phone, email, and every personalized text/media slot — with the demo copy as fallback only. **Why:** a template that cannot display the buyer's details is catalog art, not a product; Step 1 fail-closes on unwired molds and publish refuses an incomplete overlay, so shipping unwired means selling a page that can never become the buyer's website. **How:** the page component accepts `{ content?: TemplateMoldContent }` and reads `content.text.<key>`, `content.businessName`, `content.phone`/`email`, `content.media`, `content.blogs`/`reviews`; every slotted node carries `data-tkey="text.<key>"` (or `contact.*`/`media.*`/`blogs.*`); a checked-in manifest in `src/lib/template-content/<slug>.ts` declares `textBudgets`, `mediaSlots`, and `defaultBlogs`; register the manifest in `getTemplateManifest` and the component in `MOLD_COMPONENTS` (`src/components/templates/molds.tsx`). No per-mold view adapter — `buildTemplateMoldContent` derives content from the manifest for every mold. `pnpm verify:template-manifest-parity` fails CI when page keys and manifest keys disagree, a slug lacks a manifest, or the brand is not overlay-driven.

### Review-source branding

**What:** use authentic locally stored Google and Yelp vectors in badges that still say Sample. **Why:** source recognizability improves fidelity, but dummy quotes must not imply platform verification. **How:** make the logo decorative, give the badge an accessible sample-attribution label, and retain the section disclosure.

## Evaluated ingredients deliberately not used

### ThreeUI / Three.js

The repository was inspected for ThreeUI, Three.js, React Three Fiber, shader primitives, and a supported runtime contract. None exists here. A journal entry about an external ThreeUI audit is not evidence that this website used it.

**Decision:** do not claim or add it. Layered images and Motion solve the visible behavior more simply. A future 3D requirement first needs a versioned host capability, validated props, planner eligibility, performance limits, and failure behavior.

### Private marketing-block catalog

A manifest exists, but block source is external and this page does not invoke its loader. It was not an implementation ingredient. Visual precedent may shape evaluation criteria but cannot be stated as source provenance.

## End-to-end creation stages

### 1. Establish evidence

Inspect reference hierarchy rather than brand copy. Inspect repository route, typography, conversion, motion, media, and policy seams. Separate known facts, dummy data, and missing assets.

**Exit:** every section has one user job and one evidence source.

### 2. Define art-direction contract

Write shared visual language, shot roles, crops, and rejection criteria: text artifacts, impossible anatomy/tools, irrelevant interiors, inconsistent structures, weak contrast, or implausible transformations.

**Exit:** prompts are judged against falsifiable composition requirements, not taste alone.

### 3. Build structural hierarchy

Implement route and page skeleton. Order atmosphere, point of view, capability, proof, trust, help, and action. Use space to separate ideas; use media where narrative needs evidence.

**Exit:** the placeholder page still communicates offer, proof, and next action.

### 4. Generate, reject, optimize, integrate

Generate only missing roles with an allowed model. Inspect each output before wiring it. Regenerate failures rather than hiding them. Convert oversized sources to browser-sized local assets and remove intermediates.

**Exit:** every referenced image loads, fits its crop, supports adjacent copy, and belongs to the same world.

### 5. Add motion and interaction

Only after static hierarchy works, add the silent looping hero video, comparison, FAQ, menu, booking, and purchase dialogs. Thread reduced-motion handling, ARIA, keyboard, focus return, scroll locking, and touch targets through existing controls.

**Exit:** critical actions work by mouse, touch, and keyboard without competing modal states.

### 6. Recursive design audit

Audit first-viewport comprehension, pacing, image relevance, conversion clarity, truthful labels, responsive crops, keyboard/focus behavior, media loading, and overflow. When a failure appears, ask what higher-level contract caused it. A blank point-of-view section is not fixed by reducing padding if the real problem is missing visual evidence.

**Exit:** no correction merely masks a known root mismatch.

## Verification gates

- **TypeScript:** client/server contracts compose.
- **ESLint/Prettier:** source conventions pass.
- **Production build:** routing and bundling compile.
- **Browser:** hierarchy, crops, image completion, overflow, animation, modal stacking, focus, keyboard, and console errors.
- **Checkout source trace:** the template calls the same purchase component/server function as LP pages; this alone does not prove an external Stripe transaction.
- **Release:** only after deployment is requested; local success is not production reachability.

## Acceptance criteria

- Point-of-view media resolves the unexplained whitespace.
- One 5–7 second local hero video plays silently, loops continuously, uses the approved static hero as its poster, and is replaced by that poster for reduced motion.
- Authentic Google and Yelp vectors are visible while every dummy attribution remains Sample.
- The floating purchase CTA opens the shared plan selector, contractor fields, legal consent, and existing checkout submission.
- A test purchase from the template page carries its canonical template id end to end (dialog → checkout session → website row → purchaser flow), or fails fast with CHK-T01 before any charge.
- Homeowner booking remains independent.
- The before/after pair remains the same property and angle.
- Desktop/mobile have no overflow, missing media, inert controls, or browser errors.
- Type, lint, format, and build pass.

## Non-goals

Database ownership for the static template, a real paid Stripe transaction without safe configured test credentials, publishing sample proof, real blog detail routes, or 3D/shaders without a host contract.

## Delivery checklist

- [ ] Every ingredient has evidence and a user-visible reason.
- [ ] Missing media is generated under current model/billing rules and visually accepted.
- [ ] Local media is optimized and referenced centrally.
- [ ] Sample truthfulness survives logo integration.
- [ ] Booking and purchase are distinct existing seams.
- [ ] Purchase identity: `tpl_<slug>` is in `TEMPLATE_PURCHASE_SLUGS`, `TEMPLATE_IDS`, `TEMPLATE_ID_BY_SLUG`, and `TEMPLATE_SLUG_BY_ID`; the `/templates/*` route passes `templateId` (not omitted, not slug-only); a test buy records both columns and opens the `/user` purchaser flow, or CHK-T01 fails closed before charge. Workbench/`/setup` is never the landing.
- [ ] Overlay wiring: the page reads `content.text.*`/brand/contact from the overlay with `data-tkey` on every slotted node; the manifest is registered in `getTemplateManifest`; the component is in `MOLD_COMPONENTS`; `pnpm verify:template-manifest-parity` passes; a test purchase shows the buyer's business name and Step 1 copy on the live `/lp` site. Mold-pending is not shippable.
- [ ] Responsive browser and interaction checks pass.
- [ ] Type, lint, format, and build pass.
- [ ] Scope and verification claims remain honest.
