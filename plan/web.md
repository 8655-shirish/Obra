# Web Generation Product Requirements and Implementation Plan

## 1. Purpose

Build a unified website-generation path that consistently produces attractive, distinct, media-led contractor websites without weakening security, lead capture, media provenance, or the existing two-step/catalog path.

This plan replaces the current partial “generate more media” patch with one complete product flow. The root change is not more prompt text or fewer safety rules. It is a stronger handoff between four existing stages:

1. collect usable, provenance-aware media;
2. choose a distinct design direction and media plan;
3. create and curate the required media;
4. compose and validate the website from the resolved plan and assets.

## 2. Product decisions

These decisions are accepted for implementation.

### 2.1 Final media set

- Each new unified website uses **2–5 unique still assets** in its resolved composition manifest.
- At least one of those stills must be generated. The others may be usable contractor evidence or generated media.
- Strong contractor evidence is preferred for proof-oriented slots. Generated media can never be project proof.
- Reusing one still in multiple placements does not increase the unique-asset count. Byte-identical outputs count once.
- Each new unified website requires exactly **one generated MP4 motion asset**.
- One of the 2–5 stills is the MP4 source, poster, and reduced-motion fallback; it is not an additional still.
- GIF generation is not part of this release. Existing GIFs render as images and do not satisfy the MP4 requirement.
- These rules apply only to the new versioned unified format; historical unified versions remain compatible.

### 2.2 Runtime boundaries

Keep:

- the existing sandboxed iframe;
- the existing unified runtime seams: `LeadSlot`, `Button`, and `Media`;
- contractor-media identity and provenance checks;
- generated-versus-evidence provenance;
- source compilation and security checks;
- `contactHidden` behavior;
- the existing two-step/catalog generation and runtime contracts.

Do not add a second generated-code runtime or expose catalog layout components to unified generation.

### 2.3 Design references

- Treat `awesome-design-md-main` as research material, not a runtime prompt library.
- Do not identify source brands to the production agent.
- Do not pass full DESIGN.md files into model context.
- Distill a small set of brand-neutral recipes with original names and generic design rules.
- Do not reuse trademarks, logos, slogans, proprietary fonts, mascots, source photography, or a recognizable combination of exact brand traits.
- Preserve the upstream MIT notice when derived material is checked in.

## 3. User outcomes

A contractor or operator should see:

- a website whose layout reflects that business rather than the usual contractor-page skeleton;
- photos and motion used intentionally, not merely appended to a gallery;
- no unrelated company photos;
- meaningful variation when regenerating a design;
- a working quote form, phone links, media, and mobile layout;
- a clear failure instead of a saved incomplete unified draft.

An operator should not pay repeatedly for the same media when page-code generation or a background-job retry fails.

## 4. Scope

### In scope

- unified generation only;
- evidence-media validation and curation used by unified generation;
- minimal versioned unified brief;
- stable media slots and resolved media manifest;
- resumable media generation;
- bounded still concurrency and one dependent MP4;
- design-recipe selection and prior-version divergence;
- pre-persistence deterministic validation;
- deterministic source, media-manifest, lifecycle, and accessibility checks;
- progress and actionable failure messages.

### Out of scope

- changing two-step/catalog composition behavior;
- removing `LeadSlot`, `Button`, or `Media`;
- arbitrary generated-code network access;
- a second iframe/runtime bundle;
- GIF generation or MP4-to-GIF conversion;
- copying a named company’s visual identity;
- treating generated imagery as completed-project proof;
- a new general workflow/orchestration platform;

## 5. Current problems to replace

The implementation must remove or supersede these current behaviors rather than layering another workaround over them:

1. The unified plan is a short free-form brand description, so the code pass falls back to familiar layouts.
2. Prior-version divergence is requested but not meaningfully checked on the unified path.
3. The prompt’s universal “one accent / one rhythm / full-bleed moment” rules create a higher-level template.
4. Retrieved media is mostly represented by URL, MIME type, alt text, and origin.
5. Discovered URLs can count as available even when download or decoding failed.
6. Generated shot IDs, roles, prompts, and source relationships are lost before composition.
7. The page writer sees generic `props.media`, not a resolved media plan.
8. A generated page can ignore all paid images and video and still pass compilation.
9. A failed page-code attempt or job retry can purchase the media set again.
10. Long video generation does not reliably await the database heartbeat through the full callback chain.
11. The current uncommitted point-3 patch launches an unbounded batch and treats quantity as completion without solving reuse, placement, or curation.

The implementation should revise that patch in place; it should not ship the narrow patch first and then add a parallel replacement.

## 6. End-to-end unified flow

### Stage A — Build a usable media inventory

1. Load candidate photos from stored enrichment.
2. Admit photos only from contractor-matching sources.
3. Persist candidate photos to controlled storage.
4. Count a photo as usable only when it:
   - downloaded successfully;
   - passed MIME and byte-size validation;
   - decoded as an image;
   - meets minimum dimensions;
   - has a content hash not already selected;
   - retains source and contractor-match provenance.
5. Record deterministic metadata:
   - width and height;
   - aspect ratio and orientation;
   - MIME type;
   - content hash;
   - source platform and source URL;
   - storage path;
   - evidence/generated origin;
   - proof eligibility;
   - alt text.
6. Keep uncertain or unrelated media out of the usable evidence inventory.

Media admission is limited to deterministic file, source, provenance, and metadata checks.

### Stage B — Select design recipes

1. Start with six brand-neutral recipes:
   - editorial ledger;
   - cinematic showcase;
   - utilitarian field manual;
   - warm craft journal;
   - image-led portfolio;
   - playful workshop.
2. Each recipe defines:
   - suitable business/evidence profile;
   - density and spacing;
   - type-role relationship using generic font categories;
   - geometry and surface treatment;
   - allowed section shapes;
   - patterns to avoid;
   - media hierarchy, aspect-ratio families, and crop behavior;
   - mobile adaptation.
3. Keep a small versioned recipe registry. Filter out recipes that are incompatible with the available media or repeat a recently used recipe.
4. Give the planning pass 2–3 compatible recipes and let it select one.
5. Record recipe-selection outcomes during rollout. Add deterministic ranking only if evaluation shows that model selection is unreliable.
6. Persist both `recipeId` and `recipeVersion`.

Recipes are compact source files, not a loader for all 74 external documents. Target 500–1,200 tokens per recipe. Preserve the upstream MIT notice and keep a reviewable record of the source documents used to derive each neutral recipe.

### Stage C — Produce a minimal versioned unified brief

Replace the free-form plan with one minimal, versioned unified brief containing:

- `planSchemaVersion`;
- `recipeId` and `recipeVersion`;
- hero topology and ordered section topology;
- responsive intent;
- conversion and `LeadSlot` placement;
- media slots;
- a small canonical divergence tuple describing the required differences from recent versions.

Do not ask the model to duplicate the recipe’s visual policy across overlapping fields. Accept the brief only when its canonical divergence tuple differs from recent briefs on at least three planning axes. The brief may omit unsupported content sections, but it must preserve a clear conversion path and place `LeadSlot` when contact is visible.

### Stage D — Resolve the final 2–5 still slots

Each media slot has:

- stable `slotId`;
- role: hero, proof, support, atmosphere, texture, or motion-poster;
- intended section;
- evidence or generated provenance requirement;
- required/optional status;
- target aspect ratio;
- crop and focal-safe-area guidance;
- whether text overlay is allowed;
- mobile treatment;
- proof eligibility;
- generation prompt when generated.

Resolution rules:

1. Resolve 2–5 unique still assets and map them to one or more placement slots.
2. Use strong evidence for proof slots and never use generated assets as project proof.
3. Include at least one generated still and generate any other missing hero, atmosphere, or support assets.
4. Do not append every remaining image to the composition manifest. Unused evidence may remain stored but is not automatically a page asset.
5. Select one of the 2–5 still assets as the MP4 source, poster, and reduced-motion fallback.
6. Repeated placement aliases the same asset ID; it does not create another unique asset.
7. Deduplicate byte-identical outputs before enforcing the 2–5 count. Generate a replacement when deduplication leaves a required slot unresolved.

### Stage E — Generate media safely and resumably

Store the accepted unified brief once in the existing job payload. Add one durable media-slot ledger tied to that background job; do not duplicate the whole brief in each slot row.

Recommended table: `site_generation_media_slots`.

Minimum fields:

- `id`;
- `job_id` and `website_id`;
- stable `slot_id` and `asset_id`;
- `kind` (image or video);
- `status` (planned, generating, ready, failed, abandoned, attached);
- current attempt/claim token and claim timestamp;
- `source_slot_id` and poster slot ID;
- provider idempotency key or operation ID when supported;
- `storage_path`, `mime_type`, dimensions, and `content_hash`;
- `error_message` and timestamps;
- unique `(job_id, slot_id)`.

The job ID is the stable generation-run identity. The attempt/claim token fences mutable work by the currently active worker.

Behavior:

1. Persist the accepted brief and slots before provider calls.
2. On retry, reuse ready slots and recorded resumable provider operations; generate only missing or retryable slots.
3. Claim each slot with the current attempt token using a compare-and-set database transition. Every later transition must match that token and expected status.
4. Run at most two still generations concurrently per site job. Add a deployment-wide provider limit if the existing deployment seam supports one.
5. Apply at most two retries with exponential backoff and jitter only to transient provider failures. Enforce per-call and total media-stage timeouts.
6. Share one abort signal; after a fatal failure, claim loss, or cancellation, stop new calls, request sibling cancellation, and await all started work before returning.
7. Persist each successful slot promptly. Ready slots and recorded resumable operations must never be repurchased.
8. Verify every required still before starting motion. Do not purchase MP4 generation after still completion has already failed.
9. Generate exactly one MP4 from its declared successful source still. Do not silently switch to text-to-video or an undeclared source.
10. Await the existing async progress callback through every layer so Veo polling renews the current attempt lock.
11. Late completion from an old, reclaimed, or cancelled attempt cannot mutate slot state, attach media, or create a version.
12. Verify the existing deployment scheduler reliably wakes delayed retries. If no supported wake-up exists, add that deployment prerequisite before relying on delayed backoff.
13. Mark unattached assets abandoned after a documented retention period. Defer physical deletion until reference accounting proves no website version or slot references the content-hashed object.

Provider operations must use documented interfaces only. Reference-image generation is enabled only after the actual Lovable image API contract is verified and covered by a test. Exactly-once provider spend is not promised across a crash after provider acceptance but before durable recording unless the provider supports request idempotency or operation recovery.

### Stage F — Hand the resolved manifest to composition

The page-writing pass receives:

- the minimal versioned unified brief;
- the compact selected recipe;
- the resolved media manifest with actual stable slot and asset IDs;
- the existing contractor content inputs;
- relevant prior brief tuples and recipe IDs;
- the existing runtime and security contract.

It does not receive all 74 DESIGN.md files or uncurated Firecrawl dumps as design instructions.

Extend the existing `Media` seam with a literal binding such as `<Media slotId="hero-primary" />`. The existing host resolves the slot through the manifest after applying the current storage-path signing flow. Keep the ordered media array only for backwards compatibility; new unified source must not rely on array position.

The runtime-owned manifest carries slot ID, asset ID, origin, role, proof eligibility, MIME type, dimensions, alt text, storage path/resolved URL, source slot, and poster slot. Provenance, MP4 source, poster, and reduced-motion behavior are enforced inside the runtime rather than inferred from surrounding free-form JSX.

### Stage G — Validate before version insertion

Hard validation must confirm:

- source compiles under unified policy;
- unknown or catalog-only bindings remain rejected;
- `LeadSlot` is present when contact is visible;
- required media appears through literal compiler-recognized slot IDs;
- every referenced slot exists in the resolved manifest;
- every required still appears at least once;
- exactly one MP4 asset is referenced, with its declared source/poster still;
- generated assets cannot occupy manifest-owned proof roles;
- dynamic lookup cannot bypass required-slot validation;

One MP4 asset may appear in explicit desktop/mobile branches, but it remains one manifest asset. Proof and poster policy is manifest/runtime-owned; the compiler must not guess section meaning from arbitrary JSX.

The operator reviews appearance in the existing preview. Production gates remain deterministic source, manifest, lifecycle, runtime-policy, and accessibility checks.

### Stage H — Persist the version atomically

1. Row-lock or conditionally consume the active job claim using the same invariant used by cancellation.
2. In one database transaction, revalidate the current attempt token, insert the website version, and attach every required ready media slot to that version.
3. Persist `generatorSchemaVersion`, the minimal brief, recipe ID/version, and resolved manifest in the version config.
4. Reject the transaction if cancellation or reclamation won, a required slot is missing, or a slot belongs to another site/job/attempt.
5. Do not persist incomplete unified drafts. Physical media cleanup must independently confirm that no version or slot references the storage object.

## 7. Visual diversity policy

A regenerated unified page must differ from recent versions on at least three meaningful axes:

- recipe/archetype;
- hero topology;
- section-shape sequence;
- dominant alignment;
- media-placement sequence;
- typography category or scale contrast;
- spacing/density;
- geometry/corners;
- surface/elevation strategy;
- signature motif;
- form placement.

A different color alone is not divergence.

Store the canonical planning tuple inside the accepted brief. Before page writing, compare it with the active version and a documented recent-version window and require differences on at least three planning axes. Do not inspect generated source to judge visual similarity or trigger a design retry.

Historical versions without a stored planning tuple do not receive a source-derived substitute; use any recorded recipe ID when available and leave appearance comparison to the operator’s preview. If all compatible recipes were recently used, choose the least recently used compatible recipe and require differences on three other planning axes.

## 8. Prompt changes

### Planning prompt

- Present 2–3 compatible neutral recipes.
- Request the typed design and media plan.
- Include usable evidence metadata, not merely photo count.
- Include canonical prior brief tuples and selected recipe IDs.
- Require explicit slot placement and responsive behavior.
- Keep generated imagery labeled atmosphere, never proof.

### Page-writing prompt

- Treat the accepted design plan and resolved media manifest as fixed inputs.
- Require composition around named media slots.
- Replace universal layout instructions with quality guardrails.
- Keep runtime, media-provenance, and security constraints.
- On retry, include exact compile or manifest feedback without asking for an unrelated redesign.

## 9. Runtime, compatibility, and editing behavior

- Add `generatorSchemaVersion` to new unified configs. New brief/manifest rules apply only to the new schema version.
- Existing unified versions retain their current rendering and publishing behavior. Editing does not silently migrate them; regeneration creates a new-schema version. Unknown future schemas fail closed with an actionable regeneration message.
- Capture the chosen generation mode in the job payload. A feature-flag change cannot switch an in-progress job between unified and two-step generation.
- Disabling unified generation stops new unified jobs but does not break existing unified pages.
- `Media` remains the single rendering seam and uses the existing signed-URL hydration path.
- Add stable asset/slot and poster/source metadata to the existing media item shape.
- MP4 is muted for autoplay, plays inline, uses its declared poster, and displays that still when reduced motion is preferred. The page must remain understandable without motion.
- GIF remains an image and must not be rendered through `<video>`.
- Whitelist fields editable by ordinary content patches. Reserve the brief, recipe, schema version, and manifest from arbitrary patch edits.
- Media replacement is an explicit slot operation: it preserves the slot ID, validates MIME/role/provenance, and creates a new manifest revision. A required slot cannot be removed without a valid replacement.
- Publish revalidates the schema, manifest, required slots, storage references, and source. Regeneration may create a new media plan; normal text edits reuse current media.

## 10. Failure and progress behavior

User-facing stages:

1. Checking business photos
2. Choosing a design direction
3. Creating page media
4. Creating motion
5. Composing the page
6. Validating the page
7. Saving the draft

Failure messages should identify the failed stage and action:

- no trustworthy media available;
- image generation unavailable;
- motion generation unavailable;
- page could not use required media;
- generated source invalid;
- generation cancelled or superseded.

Retries resume successful media slots. They do not restart completed provider work.

## 11. Data and migration plan

Likely database work:

1. Add `site_generation_media_slots` with row-level access restricted to service execution.
2. Add foreign keys to `background_jobs`, `websites`, and the attached `website_versions` row.
3. Add the unique `(job_id, slot_id)` constraint.
4. Add only indexes required by current consumers: job lookup and unattached-abandoned cleanup.
5. Regenerate `src/integrations/supabase/types.ts`.

The version’s schema version, minimal brief, recipe ID/version, and resolved manifest remain inside `website_versions.config_json`; do not create separate permanent design-plan tables without a demonstrated query need.

Any migration added by implementation must be explicitly applied in Lovable/Supabase Cloud; merging code does not apply it.

## 12. Implementation phases

### Phase 0 — Remove the partial shortcut

- Rework the current uncommitted 2–5/concurrency patch rather than committing it as a standalone solution.
- Preserve useful tests for cardinality and ordering, but replace count-only completion with slot completion.

Exit condition: no production code assumes that quantity alone means media-first composition.

### Phase 1 — Evidence quality and metadata

- Count only persisted, decoded, usable evidence.
- Capture dimensions, orientation, content hash, source, and proof eligibility.
- Fix GIF classification/rendering independently of generated MP4 support.
- Add media-provenance fixtures resembling competitor-image and mismatched-source cases.

Exit condition: broken or unrelated discovered URLs cannot suppress required generated media or appear as contractor proof.

### Phase 2 — Versioned unified brief and neutral recipes

- Distill six compact versioned recipes from the design corpus and preserve attribution.
- Add the minimal typed brief and `generatorSchemaVersion` validation.
- Filter incompatible/recent recipes and let the planner choose from 2–3 candidates; do not add speculative scoring yet.
- Include canonical prior brief tuples and recipe IDs.
- Add explicit legacy-version compatibility behavior.

Exit condition: every new-schema plan contains a concrete topology, conversion placement, responsive intent, and media-slot strategy without duplicating recipe policy.

### Phase 3 — Fenced media ledger and generation

- Verify delayed-job retry wake-up in the deployment environment.
- Add the slot-ledger migration and generated types; store the accepted brief once in the job payload.
- Add attempt-token slot claims, bounded still concurrency, transient per-slot retries, resume, cancellation settlement, and awaited heartbeat.
- Generate one MP4 only after all required stills succeed.
- Extend the claim-aware database transaction so cancellation, version insertion, and slot attachment share one invariant.

Exit condition: ready slots and recorded resumable operations are reused; stale attempts cannot write or insert a version; cancellation cannot race a successful insert.

### Phase 4 — Resolved manifest and composition

- Pass actual slot metadata to the page writer.
- Preserve IDs/roles in runtime props.
- Require required-slot use, motion fallback, and provenance-safe placement.

Exit condition: a unified page cannot compile as acceptable while ignoring required generated media.

### Phase 5 — Planning divergence and deterministic validation

- Persist the canonical planning tuple as part of the accepted brief.
- Before page writing, require differences on at least three planning axes against the active and recent stored briefs.
- Add deterministic source, manifest, accessibility, publish, and legacy-compatibility checks.
- Keep all post-generation aesthetic judgment in the operator’s existing preview.

Exit condition: every accepted regeneration differs on at least three planning axes and every new-schema version passes deterministic lifecycle and runtime checks.

### Phase 6 — Rollout

- Run a fixed operator-review matrix:
  - photo-poor plumber;
  - emergency electrician;
  - photo-rich remodeler;
  - premium finish carpenter;
  - playful landscaper;
  - utilitarian roofer.
- Compare against the current unified baseline on:
  - composition diversity;
  - mobile usability in operator preview;
  - media usage and crop quality in operator preview;
  - lead-path visibility;
  - generation time;
  - provider cost;
  - failure and retry rate.
- Roll out behind the existing unified feature flag.

Exit condition: no regression in lead flow and a material improvement in operator-rated diversity and media integration.

## 13. Test plan

### Unit tests

- evidence usability after download/decode;
- image dimensions/orientation/content-hash dedupe;
- media source identity and proof eligibility;
- recipe compatibility, selection, versioning, and prior exclusion;
- minimal brief and schema-version validation;
- 2–5 unique-asset resolution and repeated placement;
- generated/evidence role rules;
- literal slot-binding validation;
- bounded concurrency and fixed retry limits;
- abort and all-settlement behavior;
- attempt-token compare-and-set transitions;
- declared motion source/poster behavior;
- unique output handling;
- MP4 plus poster requirement;
- GIF rendered as image;
- planning-time three-axis divergence.

### Integration tests

- delayed retries are woken by the supported deployment scheduler;
- media slots resume after process/job retry;
- ready slots and recorded resumable operations are not repurchased;
- Veo polling awaits the job heartbeat and cannot update a reclaimed attempt;
- code-generation retries reuse the same resolved media;
- required or unknown literal slots are rejected;
- generated media in a proof role is rejected;
- cancellation, insertion, and slot attachment obey one atomic claim invariant;
- late provider completion cannot mutate a newer attempt;
- manifest edits preserve slot identity and publish rejects invalid replacements;
- shared content-hashed assets are never deleted while any version or slot references them;
- old unified versions still render, edit, and publish under their legacy rules;
- a mid-job feature-flag change cannot switch generation mode;
- two-step remains optional, serial, capped at three stills, and fail-open;
- unified remains isolated from catalog layout bindings.

### Manual preview review

Before rollout, the operator checks the fixed contractor matrix in the existing desktop and mobile preview for layout quality, crop quality, purposeful still/MP4 use, reduced-motion fallback, lead-path visibility, and meaningful variation.

## 14. Acceptance criteria

The release is complete when all are true:

1. Every new-schema unified version has a validated minimal brief and recipe ID/version.
2. Historical unified versions retain their existing render, edit, and publish behavior.
3. Every new-schema version has 2–5 unique still assets, including at least one generated still, and exactly one generated MP4.
4. One of the 2–5 stills is the MP4 source, poster, and reduced-motion fallback.
5. Only usable, persisted evidence influences the final still set, and generated assets cannot occupy proof roles.
6. Every required slot is referenced through the literal slot contract.
7. Ready assets and recorded resumable provider operations are reused across code/job retries.
8. Long motion generation renews the active attempt lock, and stale attempts cannot write.
9. Concurrency and retries are bounded; abort waits for started work to settle.
10. Cancellation, version insertion, and slot attachment are atomic; no incomplete unified draft is inserted.
11. Before page writing, regeneration differs from active and recent stored briefs on at least three planning axes.
12. Ordinary edits cannot corrupt the brief or manifest, and publish revalidates both.
13. Shared assets remain protected from cleanup while referenced.
14. The existing two-step/catalog behavior and runtime remain unchanged.
15. The operator accepts the fixed desktop/mobile preview matrix for composition variety, media integration, and lead-path clarity.

## 15. Success measures

Track separately for unified generation:

- successful version rate;
- median and 95th-percentile generation time;
- image and video provider calls per successful version;
- reused-slot rate on retries;
- orphaned-asset count;
- evidence rejection rate by reason;
- required-media usage rate;
- runtime failure rate;
- operator preview acceptance rate;
- operator “looks like another generated template” rate;
- visible lead-form/CTA success rate.

Aesthetic success is not “more images.” It is better operator-preview acceptance, fewer pages judged templated by the operator, and media that visibly controls the final composition.

## 16. Review checkpoints

Before implementation starts, confirm the operational facts that cannot be proven from this repository alone:

- whether the Lovable image endpoint supports reference-image input and its exact documented format;
- whether the image/video providers expose request idempotency or recoverable operation identifiers;
- which existing deployment scheduler reliably wakes delayed retries;
- the initial per-call and total media-stage timeouts and deployment-wide provider limit;
- the abandoned-asset retention period and reference-safe cleanup owner.

These checks must not block the deterministic brief, manifest, slot-binding, recipe, or validation work. Unsupported provider features remain disabled rather than approximated with undocumented requests.

## 17. Good-to-have follow-ups

These items improve completion and operability but are not part of the core local implementation acceptance gate above.

### High priority

1. Add centralized, user-safe terminal error and cancellation states with actionable recovery choices such as retrying media or regenerating the design; retain raw provider/database details only in diagnostics.
2. Add an explicit atomic media-slot replacement workflow that preserves the stable slot ID, validates role/MIME/provenance and required-slot invariants, creates a manifest revision, and updates immutable version attachments without stale references.
3. Add validated deployment configuration for per-provider-call and total media-stage deadlines, combining those deadlines with the existing shared cancellation signal without inventing production timeout values in code.

### Lower priority

1. Expand the persisted canonical divergence tuple and strict accepted-plan schema to cover every visual axis listed in section 7, including alignment, typography/scale, density, geometry, surface strategy, and motif.
2. Separate placement slots from unique assets so multiple placements may intentionally alias one asset while retaining the 2–5 unique-still invariant.
3. After operators choose a retention period and owner, add a service-role cleanup executor that deletes abandoned content only when reference accounting proves no generation slot or website-version attachment still references it.
