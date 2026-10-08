# Add Video CTA — Product Requirements and Implementation Plan

## 1. Purpose

Move video generation out of initial unified website generation and make it an explicit, optional edit started by an **Add video** CTA beside **Regenerate**.

The feature lets a user add one short generated MP4 to the design they are viewing without rerunning website generation, replacing the design, or losing completed work. The planner selects one unique section type from a server-validated eligible set, generates motion from an eligible owned still, updates only that section’s source subtree, validates the complete result, and commits all database-visible changes together.

This is not a new generic media editor and must not reuse the current synchronous chat-video workaround. It is a durable, version-bound edit flow built on the existing job runner, media ledger, generated-site runtime, and publishing checks.

## 2. Product decisions

These decisions define the release.

### 2.1 Initial website generation becomes still-only

- New unified website generation creates the accepted still-image set but does not request an MP4.
- Initial generation does not display a motion stage and cannot fail because the video provider is unavailable.
- The generated theme does not reference an uncreated video slot.
- Two-step/catalog generation is unchanged.
- Historical unified versions remain readable and publishable.

### 2.2 One optional video per version

- A compatible version may contain zero or one generated MP4.
- One click creates at most one video.
- The CTA is disabled once the selected version already has a video.
- Supporting multiple videos is out of scope. It requires a separate product decision based on cost, page weight, and placement quality.
- The generated MP4 is decorative brand atmosphere, never evidence of completed work.
- The MP4 uses an existing attached, generated, non-proof, nonanimated still as its source, poster, and reduced-motion fallback. Evidence/customer stills are excluded from this release to avoid implying motion that was never recorded.

### 2.3 Exact version targeting

- The click is bound to the exact source version UUID visible at click time. The enqueue transaction resolves and persists the target version UUID; they are identical for draft/selected sources and different only for a live-source fork.
- Changing the selected preview while the job runs does not retarget the job.
- For a draft or selected version, the successful edit preserves the version UUID and version number.
- A live version is never mutated in place. Clicking Add video on a live version first creates a draft using the existing live-to-draft fork, then binds the job to that new draft.
- The published site remains unchanged until the user publishes the edited draft.
- Discarded versions cannot be edited.

### 2.4 Atomic visibility

- Before the final commit, the target version and its attachments are unchanged.
- Code, manifest, attachment, edit event, version revision, ledger attachment, and job completion become database-visible in one transaction. Video upload necessarily happens before that transaction and can leave an unattached object for retention cleanup.
- A failed or cancelled job never leaves partially edited page code visible.
- Uploaded but unattached content-addressed objects are handled by reference-safe retention cleanup, not immediate compensating deletion.

### 2.5 Closed action, agent-chosen placement

- Add video is a closed action, like Regenerate: the UI sends a fixed intent rather than asking the chat agent to interpret free text.
- The planning agent chooses one eligible unique section type and one attached generated/non-proof still using the deterministic acceptance rules.
- The server assigns stable job and slot identities and enforces every operational constraint.
- The page-writing pass may change only the marked source subtree for the chosen unique section type and the manifest fields required for the literal video slot. Canonical comparison rejects changes elsewhere.

## 3. User outcomes

A user should be able to:

1. select a generated design;
2. click **Add video** beside **Regenerate**;
3. see the named progress stages in Section 7 and cancel before database commit;
4. keep using the existing preview while work runs;
5. receive the edited design on the same draft/selected version;
6. inspect the video inside the unique section type recorded in the accepted plan;
7. publish the edit through the normal Publish flow.

A user must not experience:

- full website regeneration;
- new design variants;
- repeated still-image purchases;
- retries of the same terminally failed provider operation;
- silent replacement of a concurrent edit;
- an edited public site before Publish;
- a video presented as contractor project proof;
- an unexplained infinite retry at the motion stage.

## 4. Scope

### In scope

- unified generated versions;
- removal of mandatory video from new unified generation;
- Add video CTA and progress/cancel UX;
- exact-version closed intent and authorization;
- atomic live-to-draft fork plus enqueue;
- one agent-selected section and one source still;
- one four-second generated MP4;
- retry-safe provider operation handling;
- still-only and one-video manifest contracts;
- targeted theme-source rewrite;
- complete candidate validation;
- optimistic version revision checks;
- atomic same-version finalization;
- publishing and version attachment compatibility;
- actionable terminal and retry messages;
- verified migration-history prerequisite, handled as a separately approved prerequisite rather than routine source cleanup;
- focused unit, integration, and end-to-end tests;
- workspace authorization plus a product-confirmed video entitlement/rate-limit policy before the CTA gate can enable; a confirmed terminal automatic replacement is part of the same request.

### Out of scope

- ThreeUI integration;
- multiple videos per version;
- user-uploaded video;
- video trimming, cropping, audio, captions, or timeline editing;
- arbitrary section selection by the user;
- changing two-step/catalog generation;
- mutating live versions in place;
- generated testimonial, project, before/after, or proof footage;
- a new workflow framework;
- guaranteed exactly-once provider creation unless the gateway exposes a verified idempotency or lookup contract.

## 5. Current behavior to replace

The implementation must remove or supersede these behaviors rather than layering another path beside them:

1. Initial unified generation always creates a required `brand-motion` clip.
2. Current manifest validation requires exactly one MP4.
3. Missing motion aborts otherwise successful website generation.
4. Terminally failed provider operation IDs are loaded from failed ledger rows and polled again on every outer retry.
5. The current synchronous `generateSiteVideo` chat tool generates/uploads media and then separately patches `mediaGallery`, bypassing the fenced generation ledger, attachment snapshot, complete compile checks, and atomic finalization.
6. Generic config edits can race with publish or another edit because they do not compare an expected version revision.
7. Retry UI replaces the stored cause with a generic countdown.
8. The repository contains duplicate full media-ledger migrations that make a clean chronological migration replay unsafe.

The Add video implementation becomes the only supported generated-video mutation path for every manifest-backed unified version. The synchronous chat-video path must be rejected for v2 and v3 and must not remain as a second source of truth.

## 6. Eligibility and CTA behavior

### 6.1 Placement

- Place **Add video** beside **Regenerate** in the workspace action area.
- Preserve the current visual hierarchy; Add video is a secondary action, not the primary Publish action.
- Button label states:
  - `Add video`
  - `Adding video…`
  - `Video added` only as transient success feedback, after which the button is disabled for that version.

### 6.2 Eligibility

The server is authoritative. The client may mirror these checks for responsive UX.

Enable when:

- one version is visibly selected;
- it belongs to the current website;
- its status is `draft` or `selected`, or it is `live` and can be forked;
- it is a supported unified version;
- its manifest contains no video;
- it has at least one attached generated, non-proof, nonanimated still;
- it has at least one eligible unique section type with one literal marker;
- no active Add video job exists for that version; ordinary edits and publish are permitted to race but are resolved by row locks, revision comparison, and exact snapshot checks rather than UI gating.

Disable with explicit reason when:

- no version is selected;
- generation is still running;
- the version already contains video;
- the version is discarded;
- the format is historical/incompatible and cannot be safely upgraded;
- no eligible generated non-proof still or uniquely marked section exists;
- an Add video job is already active for this version.

### 6.3 Live-version click

For any source version, use one service-role enqueue transaction keyed by `(websiteId, sourceVersionId, requestId)`. It first resolves and returns an existing matching request without requiring the source row to remain editable; only a new request locks and validates the source before creating anything. For a draft/selected source, `targetVersionId` equals `sourceVersionId`. For a live source, the same transaction copies its config and complete version-dispatched attachment set into one selected draft, persists that draft as `targetVersionId`, and enqueues the job. It returns `{ jobId, chainId, sourceVersionId, targetVersionId, status }`. The current separate fork helper is insufficient because a crash between fork and enqueue leaves an unexplained draft and cannot deduplicate concurrent live clicks.

If planning, generation, or cancellation later ends without commit, retain the unchanged forked draft for the stated retention period with Try again and Discard draft actions. Try again targets that draft as a new source/request and never creates another fork. The public live version remains unchanged.

### 6.4 Closed request shape

The client sends:

```ts
{
  type: "add_video";
  sourceVersionId: string;
  requestId: string;
}
```

- `sourceVersionId` is mandatory and is the exact visible version at click time. The server never expects the client to know a live fork’s future draft ID.
- `requestId` is a client-generated UUID and is stable across transport retries, double clicks, multi-tab replay, and page reload. Its uniqueness scope is `(websiteId, sourceVersionId, requestId)`. The job stores typed `source_version_id`, `target_version_id`, and `request_id` columns; result records and their uniqueness are retained for at least 30 days. Version lifecycle is soft-status-based during that window, and the typed source/target foreign keys use `ON DELETE RESTRICT`, so pruning cannot erase replay identity. After the idempotency window, one retention transaction may prune terminal jobs and then separately apply the established version-retention policy.
- Enqueue returns one stable typed shape for every replay: `{ jobId, chainId, sourceVersionId, targetVersionId, status, result?, errorCode? }`. Pending/running replay returns the active job, completed replay returns the stored result, and failed/cancelled replay returns the stored terminal code. An explicit user **Try again** action creates a new request ID and provider-create budget.
- Never fall back to newest draft or currently selected version on the server. A database uniqueness constraint on `(website_id, source_version_id, request_id)` prevents concurrent live clicks from creating multiple drafts.

## 7. User-visible progress, cancellation, and errors

### 7.1 Progress stages

Use the existing job card and progress subscription with Add-video-specific stages:

| Percent | Message |
| --- | --- |
| 10 | Preparing this design… |
| 22 | Choosing where video will help… |
| 38 | Preparing the source image… |
| 55 | Creating video… |
| 72 | Updating the selected section… |
| 85 | Validating the design… |
| 95 | Saving the video… |
| 100 | Video added |

Percentages communicate phase, not estimated elapsed time.

### 7.2 Cancellation

- Add a dedicated authorized cancel endpoint accepting `{ websiteId, chainId, requestId }`. It verifies workspace access plus matching website, request, and `add_video` job type, then cancels only that chain; the existing website-wide cancellation endpoint is not used.
- Planning and provider requests receive a shared abort signal.
- Poll delays and network requests are abort-aware and bounded.
- If cancellation locks the job before finalization, it marks the job cancelled and the exact attempt’s unresolved media slot abandoned in one transaction.
- The target version remains unchanged unless the database finalizer already committed.
- If finalization locks and commits first, cancellation is an idempotent no-op that returns the completed result. The UI waits for the authoritative response and never announces cancellation optimistically.

### 7.3 Error copy

Retry messages retain a bounded, safe cause:

- `Video provider is temporarily unavailable. Retrying the same request…`
- `Video finished but could not be saved. Retrying save…`
- `The video request was rejected. Preparing one replacement attempt…`

Terminal examples:

- `Video could not be added because the design changed while the job was running. Try again.`
- `Video generation is not configured. Contact support.`
- `The video provider rejected this request after the allowed replacement attempt.`
- `This design already contains a video.`

Never expose secrets, raw provider payloads, or stack traces.

### 7.4 Reload, multi-tab, and accessibility

- Progress/result APIs expose `requestId`, `sourceVersionId`, `targetVersionId`, fork status, terminal status, result/error code, and completion timestamp for Add video chains. An authorized request lookup returns recent terminal jobs; the current active-chain-only website progress view is insufficient.
- On reload, recover the request by URL/workspace state plus server lookup; never rely only on component state. Multiple tabs converge through database idempotency.
- The CTA exposes its disabled explanation in persistent accessible text or `aria-describedby`, not tooltip-only content.
- The action region uses `aria-busy` for its exact request. Phase changes use a polite live region; terminal failure uses an assertive announcement once.
- Retry, Discard draft, Cancel, and View edited design are keyboard reachable with visible focus. Enqueue/completion does not force focus or preview selection changes.

## 8. Agent video-placement contract

### 8.1 Inputs

The planner receives a bounded snapshot of:

- selected version ID and revision;
- accepted unified brief;
- selected recipe identity;
- existing section topology and rendered theme source;
- current media manifest;
- the accepted topology’s unique section types and each section’s literal `data-site-section` JSX source range;
- eligible attached generated/non-proof still slots with role, aspect ratio, dimensions, alt, and section association;
- contact visibility;
- grounded business/trade context needed for an atmospheric prompt;
- existing video count and allowed maximum.

Do not provide unrelated previous versions or ask for a complete redesign.

### 8.2 Section identity

The accepted unified brief already requires section types to be unique, so the section type is the placement identity; do not introduce synthetic duplicate-section IDs. V3 generation requires exactly one literal `data-site-section="<accepted-section-type>"` root for each topology entry. Static JSX analysis records each root’s source range and validates that the video’s literal `Media` use is within the selected range. Add video is disabled when markers are missing, duplicated, dynamic, or do not match the accepted topology.

### 8.3 Output

The model returns one top-level JSON plan:

```ts
{
  targetSection: UnifiedSectionType;
  sourceSlotId: string;
  placement: "inline";
  motionPreset: "slow-push" | "subtle-parallax" | "gentle-pan" | "ambient-depth";
}
```

Every output is a closed operational value. The server constructs a neutral provider prompt from the selected preset and source metadata; the model does not author provider prompt text. This removes untestable semantic filtering of arbitrary claims, people, logos, or credentials.

The server derives:

- stable `videoSlotId` from the job/request identity;
- poster slot from `sourceSlotId`;
- role `atmosphere`;
- provenance `generated`;
- proof eligibility `false`;
- required status for the committed candidate.

### 8.4 Deterministic acceptance

Reject the plan unless:

- target section type exists exactly once in the accepted topology and as one literal source marker;
- target is not proof/before-after/reviews/contact/footer;
- source slot exists in the attached manifest;
- source belongs to the website/version and is an attached generated, non-proof, nonanimated still;
- source is not a proof-only asset used in a misleading context;
- contactHidden is respected;
- motion preset is one of the four closed values; the server-owned prompt template allows camera/depth motion only and instructs the provider to preserve the source without adding people, text, logos, projects, credentials, or claims;
- placement is exactly `inline` for this release; background placement is deferred because unified themes do not expose the catalog `Section media/scrim` boundary;
- slot and poster linkage can be represented by the target manifest version.

One neutral retry may include bounded operational validation feedback. Do not coach the model toward a visual template.

## 9. Manifest and generated-version contracts

### 9.1 Explicit version dispatch

The current parser is not structurally version-dispatched, so v3 must not be introduced by weakening it in place. Implement separate `parseV2Manifest` and `parseV3Manifest` functions plus one dispatcher keyed by `generatorSchemaVersion`. Unknown future versions fail closed. Every consumer must use that dispatcher: render-mode classification, config-to-props, compile validation, publish validation, fork/copy SQL, atomic generation finalization, Add video enqueue/finalization, and admin/preview readers.

- Existing generator schema v2 remains frozen and readable with its current exactly-one-video semantics.
- Existing v2 versions continue to render and publish.
- Do not silently weaken the v2 parser.

### 9.2 Introduce generator schema v3

New still-only unified generation emits v3. V3 requires:

- 2–5 unique still assets;
- at least one generated still;
- zero or one generated MP4;
- unique stable slot IDs and asset linkage;
- proof provenance invariants unchanged.

When a video exists it must:

- be `video/mp4`;
- be generated and not proof eligible;
- be required by the committed theme;
- reference one existing attached generated/non-proof nonanimated still as both source and poster;
- identify one existing eligible unique section type and inline placement;
- be represented by one matching attachment row;
- be referenced literally in theme source.

### 9.3 V2 handling in Add video

- V2 already requires one video, so Add video is disabled for valid v2 designs.
- A malformed v2 design is not auto-repaired by Add video; it must be regenerated or handled by a dedicated repair flow.
- No v2-to-v3 upgrade is needed in the normal Add video path because new still-only designs originate as v3.

### 9.4 Runtime behavior

- `Media` remains the only video rendering seam.
- Existing `Media` behavior supplies generated-video autoplay, mute, loop, playsInline, poster lookup, and reduced-motion poster fallback.
- Poster still is always available before playback and under reduced motion.
- This release adds one minimal typed `motion="desktop" | "all"` prop to the injected `Media` binding; generated Add video markup always uses `motion="desktop"`. Desktop is the literal media query `(min-width: 768px)`. Before the query resolves, on narrower viewports, and under reduced motion, `Media` renders only the poster and does not assign the MP4 `src`. Query changes may unload the video by replacing it with the poster. The prop allowlist/compiler accepts only these literals, and the unified prompt explicitly permits this approved prop while continuing to reject motion-library imports.
- No raw `video`, `source`, `img`, or remote fetch is introduced. The existing trusted `Media` binding owns viewport policy and handles video load/decode/playback error by permanently replacing that instance with its poster without a reload loop; generated code receives no event-handler capability.

## 10. Remove motion from initial unified generation

Update the initial unified path so that it:

1. no longer creates the `brand-motion` shot;
2. no longer creates/plans a video ledger slot;
3. no longer loads/resumes video operations;
4. no longer requires `generatedMotionCount === 1`;
5. no longer emits Creating motion progress;
6. resolves a still-only v3 manifest;
7. instructs the page writer to use required still slots only;
8. validates and persists the still-only candidate;
9. retains all existing still reuse, provenance, retry, and attachment behavior.

Do not remove the shared video provider code because Add video uses it through the durable job path.

## 11. Durable Add video job

### 11.1 Job identity and payload

Add `add_video` to the background-job type contract and dispatcher.

Persist a validated payload containing:

```ts
{
  requestId: string;
  sourceVersionId: string;
  targetVersionId: string;
  expectedRevision: number;
  plan?: AcceptedAddVideoPlan;
  planHash?: string;
  videoSlotId?: string;
}
```

Persist the accepted plan, canonical plan hash, stable slot ID, and matching planned ledger row through one attempt-fenced transactional checkpoint RPC. Replaying the same hash returns the checkpoint; a different plan after checkpointing is rejected. Provider creation cannot begin until this checkpoint commits.

### 11.2 Atomic enqueue

Create a service-role-only `enqueue_add_video_job` RPC that:

1. resolves `(website_id, source_version_id, request_id)` and immediately returns the stored replay shape when it exists, even if the source is now discarded;
2. for a new request only, acquires a source-version transaction advisory lock, rechecks request absence, and then validates the source. The authenticated server function must have completed workspace and product-entitlement/rate-limit checks before invoking it;
3. verifies the trusted server already authorized workspace access and independently verifies relational website/source-version ownership and source status; the service-role RPC does not claim to infer end-user entitlement from `auth.uid()`;
4. requires draft/selected status for an in-place target, or live status for the atomic fork path; discarded sources fail only for new requests;
5. verifies a supported v3 still-only manifest on the source and copied target;
6. records the target revision;
7. enforces unique `(website_id, source_version_id, request_id)` using typed columns and returns the stable replay shape for every job status;
8. prevents more than one active Add video job for the target while allowing ordinary edits/publish to proceed under the shared revision conflict protocol;
9. does not cancel unrelated enrichment or generation jobs;
10. persists job results for at least the 30-day idempotency window;
11. inserts one pending job otherwise.

Authorization remains in the server function before the service-role RPC. The RPC independently enforces ownership/status invariants.

### 11.3 Worker disposition contract

The worker returns a structured disposition to the generic runner rather than relying on thrown-error retry defaults:

```ts
type AddVideoDisposition =
  | { kind: "complete"; result: AddVideoResult }
  | { kind: "retry"; reasonCode: string; retryAt?: string }
  | { kind: "fail"; reasonCode: string }
  | { kind: "indeterminate"; reasonCode: string };
```

Transient poll/download/storage failures and a confirmed terminal operation with remaining replacement budget return `retry`. Missing configuration/auth, exhausted provider budget, revision conflict, source-integrity failure, and invalid candidate after bounded correction return `fail`. Ambiguous create returns `indeterminate`; the generic runner must not convert `fail` or `indeterminate` into an outer retry. Integration tests cover each disposition through the actual executor.

### 11.4 Job execution

Each attempt:

1. loads the exact target version and expected revision;
2. verifies it remains draft/selected and still has no video;
3. reuses the persisted accepted plan or runs planning once;
4. atomically checkpoints the accepted plan and exactly one planned video ledger slot, then claims it;
5. loads any genuinely resumable provider operation;
6. generates/resumes/downloads/persists the MP4;
7. constructs the next manifest and targeted theme source;
8. validates the entire candidate;
9. invokes the atomic same-version finalizer.

A revision conflict is terminal for that job. Do not silently re-plan against newer code. Missing or hash-mismatched source bytes before provider creation are also terminal with zero provider spend; never substitute a different still after checkpointing. A user retry may re-plan under a new request.

## 12. Provider operation lifecycle

Use the existing slot statuses with precise meanings:

- `planned`: accepted slot, not yet claimed;
- `generating` with operation ID: provider work may still succeed and is resumable;
- `failed`: provider operation is terminal and must not be resumed; the row retains its retired ID and durable provider-create count;
- `ready`: MP4 is persisted and validated;
- `attached`: MP4 was atomically attached to the version;
- `abandoned`: cancelled or superseded work.

### 12.1 Outcome classification

Classify provider results at the provider boundary:

- **resumable**: poll transport failure, HTTP 408/429/5xx, bounded polling timeout, or content-download failure after accepted operation;
- **terminal operation**: provider status failed/cancelled/canceled/rejected/expired, or an explicit missing/expired operation response;
- **fatal configuration**: missing key, authorization failure, unsupported model/request;
- **indeterminate create**: request may have reached the provider but no operation ID was received.

### 12.2 State transitions

- Resumable outcome leaves the slot generating with its operation ID.
- Terminal operation retires the current ID and settles failed without resetting the durable provider-create count.
- Reclaiming failed may reserve a replacement only through an atomic create-budget transition that verifies `provider_create_count < 2`, increments it, and clears the active operation ID while retaining the retired ID for audit.
- Reclaiming generating from an older attempt preserves its operation ID and resumes it.
- The resumable-operation loader selects generating rows only.
- Completed operation with failed download/persistence keeps the operation ID and retries download/persistence rather than purchasing again. Before implementation, verify and test that completed provider content remains immutably redownloadable for the required retry window. If that contract is unavailable, stage the downloaded bytes content-addressably before the ready transition; do not claim same-byte crash recovery without one of these two durable sources.
- Fatal configuration ends the job immediately.
- Indeterminate create never automatically submits a second billable request. It returns an `indeterminate` job result. Until a provider lookup/idempotency contract exists, the UI offers a distinct “Try again may create another video” confirmation; accepting it creates a new request ID and budget.

### 12.3 Budgets and deadlines

- A durable `provider_create_count` on the slot starts at zero and is incremented atomically before each provider create. The hard maximum is two creates: initial plus one replacement after a confirmed terminal failure. Worker claim attempts do not affect this budget.
- Job retry count is not used as an unlimited replacement budget.
- Poll delay is abort-aware.
- Create, poll, content download, and storage operations have explicit per-call deadlines.
- Total Add video job runtime has a bounded deadline compatible with the background runner.
- Heartbeats remain attempt-fenced for the entire provider wait.

## 13. Targeted theme rewrite

### 13.1 Rewrite input

The page-writing pass receives:

- current validated theme source;
- complete current config and v3 still-only manifest;
- accepted placement plan;
- resolved video slot metadata;
- target section identity;
- explicit instruction to preserve all other content, bindings, facts, contact behavior, and media usage.

### 13.2 Rewrite output

Return only the complete next `themeSource`. Do not return a textual patch or arbitrary config mutation.

The rewrite must:

- use literal `<Media slotId="…" motion="desktop" lazy />` for the new inline video;
- place it within the exact source range marked for the selected unique section type;
- retain the linked poster/source still contract;
- keep all previously required media slots in use;
- preserve `LeadSlot` and contactHidden behavior;
- preserve business facts and evidence claims;
- avoid imports, fetch, raw media tags, handlers, scripts, iframes, and forbidden runtime behavior;
- remain within source-size limits.

### 13.3 Retry

- Compile/validation failures may receive bounded exact operational feedback.
- The accepted placement plan and media asset remain fixed across rewrite retries.
- A rewrite retry never regenerates or repurchases video.

## 14. Complete candidate validation

Before database finalization, validate:

### Version and snapshot

- exact website/version ownership;
- draft or selected status;
- expected revision unchanged;
- existing manifest/attachment relationship remains domain-valid;
- existing still-only manifest remains valid.

### Media

- one new ready MP4 from this job with durable attestation fields: byte size, duration milliseconds, width, height, normalized video codec/profile, audio presence/codec, validator version, and content hash;
- actual MP4 container signature, parseable metadata, H.264 codec/profile, bounded duration, nonzero dimensions, and audio-stream presence; the feature remains disabled until an explicitly chosen server-side parser/validator dependency provides these values;
- byte size at most 12 MiB and duration from 3,000 through 5,000 ms;
- owned storage path and content hash, with source bytes rehashed and compared before provider creation;
- source/poster still exists and is attached;
- no duplicate slot or asset IDs;
- generated/non-proof provenance;
- exactly zero-to-one video delta.

### Theme

- source compiles under unified policy;
- all required manifest slots are referenced literally exactly as permitted;
- new video slot is used once inside the selected section source range and nowhere else;
- no required old slot was dropped;
- contact behavior remains valid;
- no forbidden bindings or raw media access;
- render mode remains a supported manifest-backed unified mode;
- protected business/evidence facts remain unchanged.

### Validation authority boundary

TypeScript owns manifest v3 parsing, media-byte inspection, theme compilation, section-subtree verification, protected-content canonical diff, and candidate hashing. SQL does not duplicate those parsers. The finalizer rechecks only enforceable relational facts: immutable request/job/attempt identity, website/version/status/revision, ready ledger ownership, attachment uniqueness/count/provenance/proof eligibility, persisted media attestation bounds, candidate hash replay, and atomic writes. Any shallow JSON predicate owned by SQL must be explicitly enumerated and tested.

### Manifest/attachment parity

Require exact set equality, not only equal counts, for:

- slot IDs;
- asset IDs;
- MIME types;
- roles;
- provenance;
- storage paths;
- source/poster relationships;
- required flags;
- proof eligibility.

`website_version_media_slots` must gain a non-null `proof_eligible boolean` populated for all copied/new attachments. Publish, fork, generation finalization, Add video finalization, signed-media loading, generated Supabase types, and parity checks use that column; do not claim proof parity without storing it.

### Initial brief versus enhancement metadata

`unifiedBrief` remains the immutable initial design brief and its divergence tuple remains the regeneration-comparison input. Add video does not append a slot to `unifiedBrief.mediaSlots`. V3 stores the video’s operational enhancement metadata in the resolved manifest: unique section type, `placement: "inline"`, motion preset, source slot, and poster slot. Publish validates initial brief/recipe integrity separately from enhancement/manifest integrity.

## 15. Cross-cutting version mutation concurrency

Add `website_versions.revision bigint not null default 0`. Revision is the sole stale-write concurrency token for the version aggregate. Every transaction that mutates config, attachment set, or status compares expected revision and increments it exactly once, even when it changes several aggregate parts. A fork starts at revision 0 and locking/reading its source does not increment the source. Enumerate and migrate generic config/chat edits, version selection/status/discard paths, Add video finalization, publish, and any other version writer found by repository and database-routine inventory.

- Read revision when enqueuing.
- Increment revision for every in-place config or attachment mutation.
- Finalizer requires the expected revision. Config/attachment comparisons remain domain-integrity checks and candidate validation, not a parallel stale-write protocol.
- A mismatch returns a specific nonretryable conflict.
- The same revision seam must replace generic edit last-writer-wins behavior in this release; do not create an Add-video-only concurrency model while leaving other edits able to overwrite it.

Before Add video is enabled, ordinary config patching must use a revision-checked atomic update RPC that locks the version, requires draft/selected status and expected revision, updates config, increments revision, and inserts the edit event in one transaction.

## 16. Atomic same-version finalizer

Create a service-role-only `commit_add_video_to_version` RPC. Inputs include:

- job ID and exact attempt;
- website and target version IDs;
- expected revision and canonical candidate hash;
- complete next config;
- ready ledger slot ID;
- edit-event payload.

In one transaction it:

1. resolves the unique typed `(website_id, source_version_id, request_id)` tuple and locks that job by primary key. Completed replay with the same candidate hash returns stored success; a different hash is an idempotency conflict. Failed/cancelled/indeterminate replay returns its stored terminal status for that immutable request identity;
2. for unfinished work, validates the exact running attempt, then locks the version and requires draft/selected status;
3. verifies website ownership and expected revision;
4. uses revision as the stale-write authority and verifies the current manifest/attachment set remains domain-valid for the candidate;
5. locks the ready ledger row and validates job ownership/metadata;
6. verifies SQL-owned relational predicates only: exactly one new ready generated/non-proof video attachment from this job, no duplicate slot, valid source/poster attachment references, persisted attestation bounds, and the application-supplied canonical candidate hash;
7. inserts the version attachment exactly once;
8. updates config and increments revision without changing version ID/number;
9. inserts one website edit event;
10. marks the ledger row attached;
11. marks the job completed with result data;
12. returns and stores the unchanged target version ID, new revision, selected section type, slot ID, and canonical candidate hash.

Any failed check rolls back all writes. Replaying the same completed request returns the same result and never inserts a second attachment or edit event.

## 17. Publishing and preview

- Successful completion invalidates/refetches the exact edited version and its signed media.
- If the user has not changed selection, refresh the edited target in place. If the user selected another version while the job ran, preserve that choice and show a “View edited design” action. Never force-switch or display the result on the wrong version.
- Publish accepts v2 historical manifests and v3 zero/one-video manifests.
- Publish revalidates the complete theme, revision, and domain-valid attachment set.
- A live source fork remains unchanged until the edited draft is published.
- Version-pinned public URLs continue to resolve only live versions.

## 18. Prerequisites and database work

Three independently valuable root-cause repairs are release prerequisites, not incidental CTA subtasks:

1. **Migration-history reconciliation:** inspect deployed history and establish a clean, supported chain before authoring Add video SQL. This requires explicit operator approval because applied migration history is deployment state, not routine source cleanup.
2. **Provider lifecycle repair:** correct terminal-versus-resumable operation semantics, abortable polling, and deadlines in shared video code before Add video can call it.
3. **Version concurrency foundation:** migrate every current in-place config/attachment/status writer and publish/fork reader onto row-locked revision semantics before enabling Add video. The inventory includes generic config patching/chat edits, onboarding writes, version selection/status writes, live fork, publish, generation finalization, and the new Add video finalizer. A repository grep plus database routine inventory is part of the migration review; this list is not assumed exhaustive.

These workstreams may be separate pull requests, but their exit criteria gate the CTA.

### 18.1 Required schema/RPC changes

- add `add_video` to the background job type constraint;
- add typed nullable `request_id uuid`, `source_version_id uuid`, and `target_version_id uuid` columns to `background_jobs`, website/version foreign keys with `ON DELETE RESTRICT`, and a unique `(website_id, source_version_id, request_id)` constraint for Add video requests; terminal request rows remain for at least 30 days before coordinated pruning;
- add `website_versions.revision`;
- retain existing ledger `job_id` as the single owner and derive type through its `background_jobs` foreign-key join; generalize centralized RPC guards to allow `site_generation` or `add_video`, while every plan, checkpoint, claim, operation, settle, ready, abandon, attach, and loader query remains scoped to that job, website, and attempt; do not denormalize owner type;
- add durable provider-create count, retired-operation audit data, plan hash, and media attestation fields required by Sections 11–14; correct claim semantics for generating versus terminal failed operations;
- add cancellation cleanup for owned generating slots;
- add atomic enqueue and finalizer RPCs;
- add non-null `proof_eligible` to version attachments and include it, storage path, and source/poster linkage in exact parity checks;
- update generated Supabase types.

### 18.2 Duplicate migration prerequisite

The repository currently contains duplicate full media-ledger migrations. Before adding new migrations, record each environment’s state across all four cases: neither version recorded, only the earlier recorded, only the later recorded, or both recorded. For each environment, use the supported Supabase migration-history repair procedure selected from that evidence; never edit applied SQL blindly. Retain/reconcile source files to the repaired history, repoint verifier scripts, and prove the complete chronological chain on an empty database. Phase 0 cannot exit until both local replay and every deployed history are documented.

Do not edit applied migration content blindly and do not assume merging SQL applies it to production.

### 18.3 Rollout ordering

Use two independent server gates: `UNIFIED_SCHEMA_V3_WRITE_ENABLED` controls whether new generation writes v3; `ADD_VIDEO_ENABLED` controls enqueue/CTA availability. Deploy in compatibility order: (1) additive database/RPC changes and generated types; (2) readers, publish, fork, SQL guards, signed-media loading, compiler, runtime, and verifier scripts that understand both v2 and v3 while writers still emit v2; (3) verify production RPC signatures/grants with a read-only compatibility probe; (4) deploy Add video worker/UI with both gates off; (5) canary-enable v3 writes; (6) canary-enable Add video. Never emit v3 before every production consumer accepts it.

Rollback order is gate-first: disable `ADD_VIDEO_ENABLED` to stop new enqueue immediately. Already-running determinate jobs may finish safely, but cannot reserve a new provider replacement after rollback begins; indeterminate jobs settle for manual review. Drain or settle the Add video queue, then disable new v3 writes. Keep all v3 readers, publishing, fork, signed-media, and runtime support deployed so existing v3 versions continue to render and publish. Database additions remain backward compatible and are not rolled back during incident response.

### 18.4 Deployment requirement

All new SQL/RPC migrations must be applied through Lovable/Supabase Cloud. Merging application files alone does not deploy the database changes. Application code must fail closed with an actionable compatibility error if the required RPCs are absent.

## 19. Security, privacy, and provenance

- The authenticated server function authorizes workspace access and, once product confirms it, the video entitlement/rate limit. The service-role RPC receives no inferred user identity and independently enforces relational website/source-version ownership, source status, request uniqueness, and target derivation only.
- Keep enqueue/finalizer/media/cancel/retention RPCs service-role-only and revoke public, anon, and authenticated execution.
- Recheck ownership and status inside SQL transactions.
- Never expose provider keys or provider payloads to generated code or the browser.
- Use owned storage paths and content-addressed uploads.
- Generated video is always atmospheric and `proofEligible: false`.
- Never animate a customer photo in a way that implies unrecorded project conditions or outcomes.
- Generated code keeps the existing sandbox, CSP, and injected binding restrictions.
- Error messages are bounded and scrubbed.

## 20. Observability and operations

Emit structured server events through the existing server logging/admin-trace boundary for launch; if a production metrics backend exists outside this checkout, map the same fields there without changing semantics. Record:

- job, website, version, request, and attempt IDs;
- version revision at enqueue and commit;
- accepted section/source/placement;
- provider operation ID and disposition;
- create/poll/download/persist durations;
- whether an operation was resumed or replaced;
- final slot/asset/content hash;
- validation and revision-conflict codes.

Metrics:

- Add video click-to-completion rate;
- planning, provider, persistence, rewrite, validation, and conflict failure rates;
- median and p95 duration by phase;
- provider operations purchased per successful video;
- resumptions and replacements per job;
- cancellations;
- orphaned unattached assets awaiting retention, including oldest eligible age;
- MP4 bytes requested on desktop/mobile and time until lead controls/text are present.

Alerts:

- repeated terminal operation reuse must remain zero;
- more than two provider operations for one Add video request;
- completed jobs without one matching attachment;
- attached video without completed job;
- revision conflicts above expected baseline;
- migration/RPC compatibility failures.

Rates use terminal non-cancelled Add video requests as the denominator over rolling 24-hour and seven-day windows. Engineering owns launch alerts. Revision-conflict alert threshold is greater than 5% over 24 hours after at least 20 terminal non-cancelled requests. Partial commits are checked by a scheduled invariant query, not trusted as an emitted counter.

Canary promotion requires at least 30 terminal non-cancelled attempts over at least 24 hours with: completion rate ≥ 90%; p95 end-to-end duration ≤ 8 minutes; p95 MP4 size ≤ 12 MiB; mean provider create operations per success ≤ 1.10 and maximum ≤ 2; terminal-operation reuse count = 0; partial database commits = 0; mobile MP4 requests = 0. If volume does not reach 30 in seven days, keep the gate at canary and require an explicit product/engineering review rather than weakening thresholds.

## 21. Accessibility and performance

- Video is decorative unless a future product supplies meaningful authored content; decorative video has appropriate empty/neutral accessibility treatment.
- Poster conveys the same necessary visual context.
- Reduced-motion preference renders the poster and does not autoplay motion.
- No audio track is required or played.
- Mobile and reduced-motion always render the poster and do not request the MP4; desktop motion uses the typed `motion="desktop"` behavior.
- Inline placement must preserve surrounding text contrast and layout without relying on motion.
- Do not place essential text only inside motion.
- Inline video is lazy and does not block text or lead controls.
- The generated MP4 is at most 12 MiB; no new render-blocking request is introduced; desktop video loading must not delay lead controls or text rendering; mobile downloads no MP4. Playwright network assertions enforce these requirements.

### 21.1 Reference-safe orphan retention

Implement the minimal service-role sweeper before broad rollout, using the existing abandoned/unattached ledger index rather than a generic asset platform. It runs daily, first supports dry-run reporting, and considers only objects at least 24 hours old. Before deletion it checks every ledger row and every version attachment for the same storage path/content hash. Referenced objects are never deleted. Failures retry on the next run and are logged. Broad rollout requires zero eligible orphan older than seven days and fewer than 100 eligible orphan objects per environment; breaching either threshold pauses rollout.

## 22. Failure and recovery matrix

| Failure | Durable state | Next action |
| --- | --- | --- |
| Planner invalid output | no provider operation | one bounded correction retry, then fail |
| Definite create rejection | failed/no operation | retry only if classification permits and budget remains |
| Ambiguous create response | indeterminate terminal result | no automatic repurchase; offer only the explicit possible-second-charge confirmation path |
| Poll network/408/429/5xx | generating + operation ID | resume same operation |
| Poll timeout while pending | generating + operation ID | resume same operation within total deadline |
| Provider terminal state | failed + retired operation ID | one fresh replacement on later attempt |
| Completed operation, download fails | generating/completed operation ID | retry content download only |
| Upload fails | completed operation plus verified redownload contract, or durable content-addressed staged bytes | retry persistence without provider purchase; fail closed if neither durable source exists |
| Cancellation | abandoned | target version unchanged |
| Rewrite invalid | ready unattached video | retry rewrite only |
| Revision conflict | ready unattached video | fail nonretryably; do not overwrite version |
| Finalizer transient DB failure | ready unattached video | retry same atomic finalizer |
| Finalizer committed | attached + completed atomically | replay returns existing result |

## 23. Test infrastructure and plan

The repository currently has focused Node verifier scripts but no declared SQL-integration or browser-E2E harness. Add these named tools and CI commands before claiming coverage:

- `pnpm verify:video-cta`: new deterministic Node `.mjs` fixture runner following the repository’s existing verifier style, including a fake provider state machine and call counter; use TypeScript only if a test runner/transpiler is deliberately added as a dev dependency;
- `pnpm test:db:video-cta`: new Supabase CLI harness that starts an isolated local stack, resets a disposable Postgres, seeds deterministic website/version/job/media fixtures, runs SQL assertions with `psql -v ON_ERROR_STOP=1`, and tears down; pin/document CLI version, ports, local credentials, and CI service setup;
- `pnpm test:e2e:video-cta`: new Playwright dev dependency/harness that starts the real app against local Supabase on a documented test URL, injects fake provider configuration, seeds fixtures, runs Chromium, collects trace/screenshots on failure, and tears down. DSH is not the test harness;
- `pnpm test:video-cta`: runs all three in CI.

SQL rollback tests install transaction-local test triggers in the disposable database that raise after each finalizer write boundary, invoke the RPC, and then assert no persistent partial state. Production routines contain no test-only failure flag. The fake provider scripts accepted, pending, terminal, ambiguous-create, completed, and download-failure responses and asserts exact create/poll/download counts.



### 23.1 Unit tests

- CTA eligibility and disabled reasons for draft, selected, live, discarded, v2, v3, and already-video versions.
- Closed intent requires exact source-version and request IDs; target version is server-derived.
- Add-video plan acceptance/rejection matrix uses the existing unique topology. Fixtures reject duplicate/missing/dynamic `data-site-section` markers and require one supplied section/source/preset tuple.
- V2 exactly-one-video compatibility.
- V3 zero-video and one-video validity.
- Reject multiple videos, duplicate slots/assets, bad source/poster, proof placement, missing section, and hidden contact placement.
- Full candidate parser and attachment parity.
- Provider classification for terminal statuses, 408/429/5xx, timeout, download failure, auth/config failure, and ambiguous create.
- Abort during delay, create, poll, content download, upload, and rewrite.
- Error copy scrubbing and bounded length.

### 23.2 Media lifecycle tests

- Pending operation resumes with no new POST.
- Terminal operation is not resumed.
- Failed-slot reclaim clears the retired operation ID atomically.
- One terminal replacement creates exactly one fresh POST.
- Completed operation with download failure never regenerates.
- Upload retry uses the same bytes and operation.
- Operation-record callback failure does not silently continue.
- Stale attempt cannot record, settle, attach, or finalize.
- Cancellation abandons the exact claimed slot.

### 23.3 SQL integration tests

- Concurrent identical draft/live source requests create one job; live requests also create exactly one target draft.
- Two different active requests for one version cannot both run.
- Cross-website and unauthorized targets fail.
- Discarded sources fail; live sources succeed only through atomic fork/enqueue, and finalization rejects live/discarded targets.
- Replay resolves the typed immutable request and rejects mismatched candidate hashes; unfinished finalization rejects wrong job type/attempt, stale revision, wrong/unready slot, invalid relational metadata, or missing/out-of-bounds attestation.
- Injected failure at every finalizer statement rolls back all database effects; TypeScript semantic validation is tested separately rather than duplicated in SQL.
- Replay after success creates no duplicate attachment/event.
- Publish-versus-finalizer race permits exactly one valid winner.
- Concurrent edits obey revision comparison.
- Full empty-database migration application succeeds.
- RPC grants exclude public, anon, and authenticated roles.

### 23.4 End-to-end tests

- Add video binds the selected source version at click time; a live response returns its server-created target version.
- Live click forks and edits the draft while public site stays unchanged.
- Selection changes do not retarget the job.
- Duplicate click/request, multi-tab, transport retry, and reload replay one job/result and one live fork.
- Each persisted phase code maps to the exact label/percentage table in Section 7; cancellation before commit leaves canonical JSON and ordered attachment relations equal.
- Successful completion refreshes preview and preserves version ID for draft/selected targets.
- Canonical JSON/source-subtree diff shows all config fields, facts, old manifest slots, and source outside the marked target range are equal after normalization.
- DOM contains exactly one `[data-site-media]` for the video slot within the unique `[data-site-section="<planned-section-type>"]`; with reduced motion it contains `[data-site-media-fallback]` using the poster URL and no MP4 request.
- At a 390×844 viewport, and separately under `prefers-reduced-motion: reduce`, Playwright observes the poster and zero MP4 requests. Desktop playback/decode error switches once to the poster without a request loop.
- Publish succeeds with the expected revision and domain-valid v3 attachment set.
- Historical v2 versions still render and publish.
- Provider terminal/transient/indeterminate/fatal/conflict scenarios produce the exact worker disposition, runner status, message, create/poll/download counts, and durable create budget.

## 24. Release constants and explicit assumptions

These are product decisions for this plan. They are not inferred from an existing billing or performance contract and must be confirmed by the product owner before implementation begins:

1. **Entitlement assumption:** the checkout proves workspace authorization but exposes no separate video entitlement. Product must confirm whether every authorized workspace editor may incur video cost, plus per-user/website rate limits. Until confirmed, `ADD_VIDEO_ENABLED` remains off. No ordinary confirmation dialog or visible credit is assumed; one confirmed-terminal automatic replacement is part of the same request.
2. **Failed live fork:** retain the unchanged forked draft for 30 days with **Try again** and **Discard draft** actions. Try again targets that draft with a new request ID; it does not create another fork.
3. **Retry:** one automatic replacement is allowed only after a confirmed terminal provider state. Ambiguous create never auto-repurchases. A user-initiated Try again is a new request and provider budget.
4. **Placement:** only inline placement is supported. All Add video media uses `motion="desktop"`; the desktop predicate is `(min-width: 768px)`, while mobile and reduced-motion show the poster without assigning the MP4 source.
5. **Media limits:** one MP4, nominal four seconds, accepted duration 3.0–5.0 seconds, H.264/AAC-free or silent MP4, maximum 12 MiB, nonzero dimensions, no audio playback. Central named constants enforce the same values in validation and tests.

## 25. Implementation phases

### Phase 0 — Migration-history prerequisite

- Inspect remote migration history.
- Resolve duplicate media-ledger migration ownership safely.
- Add clean-chain migration verification.

Exit criteria: local empty-database migration replay succeeds and retained versions match deployed history.

### Phase 1 — Still-only unified generation and v3

- Add explicit v2/v3 parser dispatch and convert every schema-gated consumer before enabling v3 writes.
- Change new unified generation to still-only v3.
- Remove initial motion planning, generation, progress, and required checks.
- Update writer prompts and verifiers.

Exit criteria: new websites complete with zero video; v2 historical websites remain valid.

### Phase 2 — Provider lifecycle correction

- Add typed video outcome disposition.
- Correct resumable loader and claim transitions.
- Add abortable waits and request/job deadlines.
- Add cancellation abandonment and focused behavioral tests.

Exit criteria: terminal operations cannot poison retries; transient operations resume without repurchase.

### Phase 3 — Version mutation foundation

- Add version revision.
- Add atomic source-version request enqueue with server-derived target version.
- Reuse ledger `job_id` ownership and generalize centralized job-type guards while preserving exact website and attempt fencing.
- Move existing in-place config edits onto the revision-aware atomic mutation seam before enabling Add video.

Exit criteria: concurrent edits cannot silently overwrite each other.

### Phase 4 — Add video job and finalizer

- Add job type, payload, dispatcher, progress, planner, generation, targeted rewrite, validation, and atomic finalizer.
- Add authorization, idempotency, cancellation, and observability.

Exit criteria: fixture and SQL assertions show one request produces at most one provider operation before any confirmed-terminal replacement, one attachment, one edit event, one revision increment, and one completed job result for the exact target version.

### Phase 5 — CTA and workspace integration

- Add CTA, eligibility, disabled reasons, live fork confirmation/copy, progress card, cancellation, success refresh, and exact-target selection behavior.
- Reject the old synchronous generated-video mutation path for every manifest-backed unified version, v2 and v3; retain it only for explicitly supported legacy/catalog formats and never let it patch `mediaGallery` for a manifest-backed version.

Exit criteria: end-to-end UX works without creating a new version except the required live-to-draft fork.

### Phase 6 — Hardening and rollout

- Run full unit/integration/E2E suite.
- Verify migration and generated type parity.
- Measure page performance and provider operation counts.
- Roll out behind a server-controlled capability until production RPC compatibility is verified.
- Remove the capability gate after successful production validation; do not retain parallel workflows.

Exit criteria: no poisoned retries, partial commits, duplicate provider purchases in determinate cases, attachment drift, or live-version mutation.

## 26. Acceptance criteria

The feature is complete only when all are true:

1. The still-only generation fixture records zero provider video-create calls and persists a valid v3 manifest with zero video slots.
2. Browser test finds Add video adjacent to Regenerate; its request payload contains the visible source version UUID and a stable request UUID across duplicate submission/reload, while target UUID is server-derived.
3. SQL test proves draft/selected success retains version ID/version number, increments revision exactly once, and inserts exactly one attachment/event.
4. SQL/browser test proves live fork plus enqueue is one transaction; canonical public routing keeps `websites.status`/`active_version_id` on the original live version, its pinned URL/config/attachments remain canonically equal, and the draft public route is unavailable until Publish.
5. Fixture validation accepts only one supplied unique section type, literal matching marker, attached generated/non-proof nonanimated source slot, and closed motion preset; evidence, GIF, video, missing, duplicate, dynamic, and ambiguous values fail.
6. Provider fake records one create call in the success fixture; compiled source contains exactly one literal inline video slot within the planned unique section marker and the attachment set adds exactly one row.
7. Manifest and attachment assertions require generated provenance and `proofEligible/proof_eligible = false`; proof/evidence section fixtures fail.
8. Fake-provider and executor tests prove terminal IDs receive zero subsequent polls, transient IDs resume without another create, fatal/conflict/indeterminate dispositions do not outer-retry, and durable `provider_create_count` never exceeds two.
9. Cancellation fixtures at planning, polling, upload, rewrite, and precommit leave canonical config/attachment snapshots unchanged and settle the owned unresolved slot abandoned.
10. Deterministic two-transaction tests make edit/publish and Add video race; revision is the sole stale-write token, one commits, and the loser returns the documented revision conflict without partial writes.
11. SQL failure-injection tests prove config, manifest, attachment, audit event, revision, ledger attachment, and job completion have all-or-none database visibility; storage-orphan cleanup is tracked separately.
12. Every enumerated provider disposition maps to a fixture-approved message under the configured maximum length with secret/provider-payload redaction assertions.
13. Stored v2 fixtures pass explicit v2 dispatch, render, fork, signed-media loading, and publish without mutation.
14. Stored v3 zero/one-video fixtures pass render, compile, fork, signed-media loading, finalization, and publish; two-video and unknown-version fixtures fail closed. Mobile/reduced-motion and playback-error fixtures render the poster without MP4 loops.
15. Old synchronous video mutation cannot bypass the new path for any manifest-backed unified version, v2 or v3.
16. `pnpm test:db:video-cta` applies the full chain to an empty local database; separately approved remote history inspection records parity before production migration.
17. Production compatibility probe verifies v3 readers/RPCs before the v3-write gate and Add video RPC grants/worker/schema before its gate. Canary and orphan-retention thresholds are met before promotion; rollback tests prove new enqueue stops while in-flight jobs follow Section 18.3.

## 27. Non-goals and deferred decisions

Do not expand this implementation to cover:

- multiple videos;
- choosing placement manually;
- video editing controls;
- cross-version video copying;
- user-supplied video;
- ThreeUI or other design-library integration;
- retention behavior beyond the bounded Add video orphan sweeper contract;
- exactly-once external purchase claims without a verified provider contract.

These require separate evidence and product decisions.

## 28. Delivery checklist

- [ ] Remote migration history inspected and duplicate ledger migration resolved safely.
- [ ] Explicit v2/v3 dispatch is implemented across every schema-gated consumer before v3 writes are enabled.
- [ ] Initial unified generation is still-only.
- [ ] Provider state lifecycle and cancellation corrected.
- [ ] Version revision and atomic edit seam implemented.
- [ ] Add-video enqueue and finalizer RPCs implemented and service-role-only.
- [ ] Add-video planner, worker, rewrite, and full validation implemented.
- [ ] CTA, disabled reasons, progress, cancellation, and refresh implemented.
- [ ] Synchronous video mutation rejected for all manifest-backed unified versions.
- [ ] Supabase types regenerated and parity verified.
- [ ] Unit, media lifecycle, SQL integration, and E2E tests pass.
- [ ] Production build and generated runtime verification pass.
- [ ] New migrations applied through Lovable/Supabase Cloud.
- [ ] Production capability enabled only after RPC/version compatibility check.
