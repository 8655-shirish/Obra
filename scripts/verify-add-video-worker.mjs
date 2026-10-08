import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const temporary = await fs.mkdtemp(path.join(root, ".verify-add-video-"));
const out = path.join(temporary, "worker.mjs");
const parserOut = path.join(temporary, "parser.mjs");
const mediaOut = path.join(temporary, "media.mjs");
const commonBuild = {
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { "@": path.join(root, "src") },
};
await Promise.all([
  build({
    ...commonBuild,
    entryPoints: [path.join(root, "src/lib/jobs/add-video-worker.server.ts")],
    outfile: out,
  }),
  build({
    ...commonBuild,
    entryPoints: [path.join(root, "src/lib/jobs/mp4box-parser.server.ts")],
    outfile: parserOut,
  }),
  build({
    ...commonBuild,
    entryPoints: [path.join(root, "src/lib/media/lovable-media.server.ts")],
    outfile: mediaOut,
  }),
]);
const [worker, parser, media] = await Promise.all([
  import(pathToFileURL(out)),
  import(pathToFileURL(parserOut)),
  import(pathToFileURL(mediaOut)),
]);
const slots = [
  {
    slotId: "z-generated",
    assetId: "hash-z",
    origin: "generated",
    role: "hero",
    proofEligible: false,
    mimeType: "image/jpeg",
    alt: "z",
    storagePath: "sites/w/z.jpg",
    required: true,
  },
  {
    slotId: "a-generated",
    assetId: "hash-a",
    origin: "generated",
    role: "support",
    proofEligible: false,
    mimeType: "image/png",
    alt: "a",
    storagePath: "sites/w/a.png",
    required: true,
  },
];
const attachments = slots.map((slot) => ({
  version_id: "v",
  website_id: "w",
  slot_id: slot.slotId,
  asset_id: slot.assetId,
  mime_type: slot.mimeType,
  role: slot.role,
  provenance: slot.origin,
  required: true,
  source_slot_id: null,
  poster_slot_id: null,
  storage_path: slot.storagePath,
  proof_eligible: false,
}));
const source =
  'export default function Site(){return <main><section data-site-section="hero"><Media slotId="z-generated" /></section><section data-site-section="services"><Media slotId="a-generated" /></section><footer data-site-section="footer"></footer></main>}';
const topology = [{ section: "hero" }, { section: "services" }, { section: "footer" }];
const plan = worker.selectDeterministicAddVideoPlan({
  generatorSchemaVersion: 3,
  themeSource: source,
  sectionTopology: topology,
  manifest: { slots },
  attachments,
  contactHidden: false,
});
assert.equal(plan.targetSection, "hero");
assert.equal(plan.sourceSlotId, "a-generated");
assert.deepEqual(
  worker.selectDeterministicAddVideoPlan({
    generatorSchemaVersion: 3,
    themeSource: source,
    sectionTopology: topology,
    manifest: { slots: [...slots].reverse() },
    attachments: [...attachments].reverse(),
    contactHidden: false,
  }),
  plan,
);
const legacyBlockedSource =
  'export default function Site(){return <main><section data-site-section="hero"></section><section data-site-section="beforeAfter"></section><section data-site-section="reviews"></section><section data-site-section="contact"></section><footer data-site-section="footer"></footer></main>}';
const legacyBlockedPlan = worker.selectDeterministicAddVideoPlan({
  generatorSchemaVersion: 3,
  themeSource: legacyBlockedSource,
  sectionTopology: [
    { section: "hero" },
    { section: "beforeAfter" },
    { section: "reviews" },
    { section: "contact" },
    { section: "footer" },
  ],
  manifest: { slots },
  attachments,
  contactHidden: false,
});
assert.equal(legacyBlockedPlan.targetSection, "hero");
const operationalIntent = {
  mediaSlots: [
    {
      slotId: "a-generated",
      role: "support",
      required: true,
      sourcePreference: "generated",
      aspectRatio: "landscape",
      cropGuidance: "Keep the subject centered",
      textOverlayAllowed: false,
      proofEligibleRequired: false,
      generationPrompt: "Atmospheric landscape",
      anchorSlug: "project-stage",
    },
  ],
  operationalAnchors: [
    { slug: "contact", purposes: ["contact", "navigation"] },
    { slug: "project-stage", purposes: ["media"] },
    { slug: "video-destination", purposes: ["host-operation"] },
    { slug: "nav-only", purposes: ["navigation"] },
  ],
};
const schemaFourUnifiedPlan = {
  planSchemaVersion: 3,
  operationalIntent,
  creativeBrief: {
    rationale: "Use motion sparingly",
    mood: "Grounded",
    hierarchy: "Lead with project work",
    mediaOpportunities: "Atmospheric motion",
    responsiveBehavior: "Stack on narrow screens",
  },
};
const schemaFourSource =
  'export default function Site(){return <main><section data-site-section="nav-only"></section><section data-site-section="video-destination"><Media slotId="z-generated" /></section><section data-site-section="project-stage"><Media slotId="a-generated" /></section><section data-site-section="contact"><LeadSlot /></section><section data-site-section="writer-owned"></section></main>}';
const schemaFourPlan = worker.selectDeterministicAddVideoPlan({
  generatorSchemaVersion: 4,
  themeSource: schemaFourSource,
  unifiedPlan: schemaFourUnifiedPlan,
  manifest: { slots },
  attachments,
  contactHidden: false,
});
assert.equal(schemaFourPlan.targetSection, "project-stage");
const gachaHostPlan = worker.selectDeterministicAddVideoPlan({
  generatorSchemaVersion: 4,
  themeSource: schemaFourSource,
  manifest: { slots },
  attachments,
  contactHidden: false,
});
assert.equal(gachaHostPlan.targetSection, "nav-only");
const schemaFourSnapshot = worker.buildAddVideoPlanningSnapshot({
  generatorSchemaVersion: 4,
  versionId: "version-4",
  revision: 1,
  themeSource: schemaFourSource,
  unifiedPlan: schemaFourUnifiedPlan,
  manifest: { slots },
  attachments,
  contactHidden: false,
  unifiedBrief: null,
  recipeId: null,
  recipeVersion: null,
  businessContext: {},
});
assert.deepEqual(
  schemaFourSnapshot.eligibleSections.map(({ section }) => section),
  ["project-stage", "video-destination"],
);
assert.equal(
  schemaFourSnapshot.eligibleSections.some(({ section }) => section === "contact"),
  false,
);
assert.equal(
  schemaFourSnapshot.eligibleSections.some(({ section }) => section === "nav-only"),
  false,
);
assert.equal(schemaFourSnapshot.unifiedBrief, null);
assert.deepEqual(schemaFourSnapshot.recipe, { id: null, version: null });
assert.equal(schemaFourSnapshot.businessContext, null);
assert.equal(schemaFourPlan.sourceSlotId, "a-generated");
const renamedWriterSectionPlan = worker.selectDeterministicAddVideoPlan({
  generatorSchemaVersion: 4,
  themeSource: schemaFourSource.replace(
    '<section data-site-section="writer-owned"></section>',
    '<section data-site-section="writer-renamed"></section>',
  ),
  unifiedPlan: schemaFourUnifiedPlan,
  manifest: { slots },
  attachments,
  contactHidden: false,
});
assert.deepEqual(renamedWriterSectionPlan, schemaFourPlan);
const schemaFourVideoSlot = worker.stableVideoSlotId("schema-four-job");
const schemaFourVideoRow = {
  version_id: "v",
  website_id: "w",
  slot_id: schemaFourVideoSlot,
  asset_id: "hash-video",
  mime_type: "video/mp4",
  role: "atmosphere",
  provenance: "generated",
  required: true,
  source_slot_id: schemaFourPlan.sourceSlotId,
  poster_slot_id: schemaFourPlan.sourceSlotId,
  storage_path: "sites/w/video.mp4",
  proof_eligible: false,
};
const schemaFourPreviousConfig = {
  generatorSchemaVersion: 4,
  contactHidden: false,
  themeSource: schemaFourSource,
  unifiedPlan: schemaFourUnifiedPlan,
  mediaManifest: { slots },
  bucket1ValidationInput: {
    generationContractEpoch: 2,
    contextHash: "e".repeat(64),
    candidateRevision: "1",
  },
  bucket1ValidationAttestation: { stale: true },
  validationAttestation: { stale: true },
};
const schemaFourNextConfig = {
  ...schemaFourPreviousConfig,
  themeSource: worker.insertVideoIntoSection(schemaFourSource, schemaFourPlan, schemaFourVideoSlot),
  mediaManifest: {
    slots: [
      ...slots,
      {
        slotId: schemaFourVideoSlot,
        assetId: "hash-video",
        origin: "generated",
        role: "atmosphere",
        proofEligible: false,
        mimeType: "video/mp4",
        alt: "",
        storagePath: "sites/w/video.mp4",
        required: true,
        sourceSlotId: schemaFourPlan.sourceSlotId,
        posterSlotId: schemaFourPlan.sourceSlotId,
        targetSection: schemaFourPlan.targetSection,
        placement: "inline",
        motionPreset: schemaFourPlan.motionPreset,
      },
    ],
  },
};
assert.match(
  worker.validateAddVideoCandidate({
    previousConfig: schemaFourPreviousConfig,
    nextConfig: schemaFourNextConfig,
    nextAttachments: [...attachments, schemaFourVideoRow],
    plan: schemaFourPlan,
    videoSlotId: schemaFourVideoSlot,
  }),
  /^[a-f0-9]{64}$/,
);

assert.throws(
  () =>
    worker.selectDeterministicAddVideoPlan({
      generatorSchemaVersion: 4,
      themeSource: schemaFourSource.replace(
        'data-site-section="project-stage"',
        'data-site-section="moved"',
      ),
      unifiedPlan: schemaFourUnifiedPlan,
      manifest: { slots },
      attachments,
      contactHidden: false,
    }),
  /operational_anchor_marker_invalid/,
);
assert.throws(
  () =>
    worker.selectDeterministicAddVideoPlan({
      generatorSchemaVersion: 4,
      themeSource: schemaFourSource.replace(
        '<section data-site-section="writer-owned"></section>',
        '<section data-site-section="project-stage"></section>',
      ),
      unifiedPlan: schemaFourUnifiedPlan,
      manifest: { slots },
      attachments,
      contactHidden: false,
    }),
  /operational_anchor_marker_invalid/,
);
assert.throws(
  () =>
    worker.selectDeterministicAddVideoPlan({
      generatorSchemaVersion: 4,
      themeSource: schemaFourSource,
      unifiedPlan: {
        ...schemaFourUnifiedPlan,
        planSchemaVersion: 2,
      },
      sectionTopology: topology,
      manifest: { slots },
      attachments,
      contactHidden: false,
    }),
  /operational_anchor_registry_invalid|no_eligible_section/,
  "schema v4 must not fall back to historical topology",
);
const snapshot = worker.buildAddVideoPlanningSnapshot({
  generatorSchemaVersion: 3,
  versionId: "version-1",
  revision: 4,
  themeSource: source,
  sectionTopology: topology,
  manifest: { slots },
  attachments,
  contactHidden: false,
  unifiedBrief: { recipeId: "editorial", recipeVersion: 1, sectionTopology: topology },
  recipeId: "editorial",
  recipeVersion: 1,
  businessContext: { industry: "landscaping" },
});
assert.deepEqual(snapshot.version, { id: "version-1", revision: 4 });
assert.equal(
  snapshot.eligibleSections.some(({ section }) => section === "footer"),
  false,
);
assert.equal(
  snapshot.eligibleStills.some((slot) => "storagePath" in slot),
  false,
);
assert.throws(
  () => worker.validateAddVideoPlan({ ...plan, arbitraryPrompt: "invent a testimonial" }, snapshot),
  /planner_output_not_closed/,
);
const plannerCalls = [];
const correctedPlan = {
  targetSection: "services",
  sourceSlotId: "z-generated",
  placement: "inline",
  motionPreset: "gentle-pan",
};
await assert.rejects(
  () =>
    worker.requestAcceptedAddVideoPlan(
      async (input) => {
        plannerCalls.push(input);
        return { ...correctedPlan, targetSection: "footer" };
      },
      snapshot,
      new AbortController().signal,
    ),
  /planner_output_rejected/,
);
assert.equal(plannerCalls.length, 1, "one claim may dispatch the planner at most once");
assert.equal(plannerCalls[0].correction, null);
let rejectedCalls = 0;
await assert.rejects(
  () =>
    worker.requestAcceptedAddVideoPlan(
      async () => {
        rejectedCalls += 1;
        return { ...correctedPlan, placement: "background" };
      },
      snapshot,
      new AbortController().signal,
    ),
  /planner_output_rejected/,
);
assert.equal(rejectedCalls, 1);
assert.throws(
  () =>
    worker.buildAddVideoPlanningSnapshot({
      versionId: "version-1",
      revision: 4,
      themeSource: "x".repeat(100_001),
      sectionTopology: topology,
      manifest: { slots },
      attachments,
      contactHidden: false,
      unifiedBrief: {},
      recipeId: null,
      recipeVersion: null,
      businessContext: {},
    }),
  /planner_snapshot_too_large/,
);
assert.throws(
  () =>
    worker.validateSectionTopology(
      source.replace('data-site-section="services"', "data-site-section={section}"),
      topology,
    ),
  /section_marker/,
);
const videoSlot = worker.stableVideoSlotId("job-1");
assert.equal(videoSlot, worker.stableVideoSlotId("job-1"));
const inserted = worker.insertVideoIntoSection(source, plan, videoSlot);
assert.equal((inserted.match(new RegExp(videoSlot, "g")) ?? []).length, 1);
await assert.rejects(
  () => worker.attestMp4(new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112, 0, 0, 0, 0])),
  /mp4_parser_unavailable/,
);
const attested = await worker.attestMp4(
  new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112, 0, 0, 0, 0]),
  {
    version: "fake-1",
    async inspect() {
      return {
        durationMs: 4000,
        width: 1280,
        height: 720,
        videoCodec: "h264",
        videoProfile: "high",
        hasAudio: true,
        audioCodec: "aac",
      };
    },
  },
);
assert.equal(attested.validatorVersion, "fake-1");

assert.deepEqual(
  worker.classifyAddVideoProviderFailure({
    disposition: "fatal",
    hasDurableOperation: false,
    deadlineExceeded: false,
  }),
  { ledgerAction: "settle_failed", effectCertainty: "not_started", disposition: "fail" },
);
assert.deepEqual(
  worker.classifyAddVideoProviderFailure({
    disposition: "indeterminate",
    hasDurableOperation: false,
    deadlineExceeded: false,
  }),
  { ledgerAction: "settle_failed", effectCertainty: "indeterminate", disposition: "indeterminate" },
);
assert.deepEqual(
  worker.classifyAddVideoProviderFailure({
    disposition: "retryable",
    hasDurableOperation: true,
    deadlineExceeded: false,
  }),
  { ledgerAction: "preserve_generating", effectCertainty: "indeterminate", disposition: "retry" },
);
assert.deepEqual(
  worker.classifyAddVideoProviderFailure({
    disposition: "terminal",
    hasDurableOperation: true,
    deadlineExceeded: true,
  }),
  { ledgerAction: "settle_failed", effectCertainty: "indeterminate", disposition: "fail" },
);
assert.deepEqual(
  worker.classifyAddVideoProviderFailure({
    disposition: "terminal",
    hasDurableOperation: false,
    deadlineExceeded: true,
  }),
  { ledgerAction: "settle_failed", effectCertainty: "not_started", disposition: "fail" },
);

const baseVideoTrack = {
  codec: "avc1.64001f",
  duration: 4000,
  timescale: 1000,
  track_width: 1280,
  track_height: 720,
  video: { width: 1280, height: 720 },
};
const baseMovie = {
  hasMoov: true,
  videoTracks: [baseVideoTrack],
  audioTracks: [{ codec: "mp4a.40.2" }],
};
function mockMp4Box(movie, failure) {
  let calls = 0;
  return () => {
    calls += 1;
    return {
      appendBuffer(buffer) {
        assert.equal(buffer.fileStart, 0);
        if (failure === "throw") throw new Error("broken parser");
        if (failure === "callback") this.onError?.("parse", "broken parser");
        else this.onReady?.(movie);
      },
      flush() {},
      get calls() {
        return calls;
      },
    };
  };
}
const validParser = parser.createMp4BoxParser(mockMp4Box(baseMovie));
const parsedMetadata = await validParser.inspect(
  new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112, 0, 0, 0, 0]),
);
assert.deepEqual(parsedMetadata, {
  durationMs: 4000,
  width: 1280,
  height: 720,
  videoCodec: "h264",
  videoProfile: "high",
  hasAudio: true,
  audioCodec: "mp4a.40.2",
});
assert.equal(validParser.version, "mp4box-2.4.1");
await assert.rejects(
  () => parser.mp4BoxParser.inspect(new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112, 0, 0, 0, 0])),
  /mp4_parse_failed/,
);
await assert.rejects(
  () =>
    parser
      .createMp4BoxParser(mockMp4Box({ ...baseMovie, videoTracks: [] }))
      .inspect(new Uint8Array(12)),
  /mp4_video_track_count_invalid/,
);
await assert.rejects(
  () =>
    parser
      .createMp4BoxParser(
        mockMp4Box({
          ...baseMovie,
          videoTracks: [baseVideoTrack, { ...baseVideoTrack, codec: "avc1.4d001f" }],
        }),
      )
      .inspect(new Uint8Array(12)),
  /mp4_video_track_count_invalid/,
);
await assert.rejects(
  () =>
    parser
      .createMp4BoxParser(
        mockMp4Box({
          ...baseMovie,
          videoTracks: [{ ...baseVideoTrack, codec: "vp09.00.10.08" }],
        }),
      )
      .inspect(new Uint8Array(12)),
  /mp4_codec_invalid/,
);
await assert.rejects(
  () => parser.createMp4BoxParser(mockMp4Box(baseMovie, "callback")).inspect(new Uint8Array(12)),
  /mp4_parse_failed/,
);
await assert.rejects(
  () => parser.createMp4BoxParser(mockMp4Box(baseMovie, "throw")).inspect(new Uint8Array(12)),
  /mp4_parse_failed/,
);
assert.throws(() => parser.createMp4BoxParser(() => ({})), /mp4_parser_unavailable/);
await assert.rejects(
  () =>
    worker.attestMp4(
      new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112, 0, 0, 0, 0]),
      parser.createMp4BoxParser(
        mockMp4Box({ ...baseMovie, videoTracks: [{ ...baseVideoTrack, duration: 2999 }] }),
      ),
    ),
  /mp4_duration_invalid/,
);

const previousKey = process.env.AI_API_KEY;
const previousVideoBaseUrl = process.env.AI_VIDEO_BASE_URL;
const previousVideoModel = process.env.AI_VIDEO_MODEL;
process.env.AI_API_KEY = "deterministic-test-key";
process.env.AI_VIDEO_BASE_URL = "https://video.test/v1";
process.env.AI_VIDEO_MODEL = "deterministic-video-model";
const expired = await media.generateClip({
  prompt: "expired",
  deadlineAt: 999,
  now: () => 1000,
  resumeOperationId: "operation-1",
});
assert.deepEqual(expired, {
  ok: false,
  skipped: true,
  reason: "total_deadline_exceeded",
  retryable: false,
  disposition: "terminal",
  operationId: "operation-1",
});
const originalFetch = globalThis.fetch;
let recoveryCreates = 0;
let recoveryPolls = 0;
let recoveryDownloads = 0;
globalThis.fetch = async (url, init) => {
  assert.equal(init?.method, undefined, "resume recovery must not create a provider operation");
  if (String(url).endsWith("/content")) {
    recoveryDownloads += 1;
    return new Response(new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]), {
      status: 200,
      headers: { "Content-Type": "video/mp4" },
    });
  }
  recoveryPolls += 1;
  return Response.json({ status: "completed" });
};
const recovered = await media.generateClip({
  prompt: "recover completed operation",
  resumeOperationId: "operation-completed",
  deadlineAt: Date.now() + 30_000,
  pollIntervalMs: 0,
});
globalThis.fetch = originalFetch;
assert.equal(recovered.ok, true);
assert.equal(recoveryCreates, 0);
assert.equal(recoveryPolls, 1);
assert.equal(recoveryDownloads, 1);
if (previousKey == null) delete process.env.AI_API_KEY;
else process.env.AI_API_KEY = previousKey;
if (previousVideoBaseUrl == null) delete process.env.AI_VIDEO_BASE_URL;
else process.env.AI_VIDEO_BASE_URL = previousVideoBaseUrl;
if (previousVideoModel == null) delete process.env.AI_VIDEO_MODEL;
else process.env.AI_VIDEO_MODEL = previousVideoModel;

const storageAbort = new AbortController();
const boundedStorage = media.boundedStorageCall(() => new Promise(() => {}), {
  signal: storageAbort.signal,
  timeoutMs: 60_000,
});
storageAbort.abort();
await assert.rejects(() => boundedStorage, /Abort/);

const execute = await fs.readFile(path.join(root, "src/lib/jobs/execute.server.ts"), "utf8");
assert.ok(execute.includes("running.job_type === JOB_TYPE_ADD_VIDEO"));
assert.ok(execute.includes("settleAddVideoDisposition"));
assert.ok(execute.includes("payload.addVideoDisposition = disposition.kind"));
const workerSource = await fs.readFile(
  path.join(root, "src/lib/jobs/add-video-worker.server.ts"),
  "utf8",
);
assert.ok(workerSource.includes("commit_add_video_to_version_epoch"));
assert.ok(workerSource.includes("claimEpoch: job.claim_epoch"));
assert.ok(workerSource.includes("runnerId: job.locked_by!"));
assert.ok(workerSource.includes('rpc("yield_add_video_stage"'));
for (const stage of [
  "planning/call",
  "media/create",
  "media/poll",
  "media/materialize",
  "composition/build",
  "validation/run",
  "persistence/commit",
])
  assert.ok(workerSource.includes(`"${stage}"`), "missing exact cursor unit " + stage);
assert.ok(workerSource.includes('? "media/materialize" : "media/poll"'));
assert.ok(workerSource.includes("createClipOperation"));
assert.ok(workerSource.includes("pollClipOperation"));
assert.ok(workerSource.includes("downloadClipOperation"));
assert.ok(
  !workerSource.includes("generateClip"),
  "staged Add Video must never call compatibility generateClip",
);
for (const forbidden of [
  "sourceBytes",
  "downloadedVideo",
  "bytesToCheckpoint",
  "bytesFromCheckpoint",
  "body: bytes",
])
  assert.ok(
    !workerSource.includes(forbidden),
    "media bytes must not enter checkpoints: " + forbidden,
  );
assert.ok(execute.includes('if (disposition.kind === "yield") return'));
assert.ok(execute.includes("job.failure_attempts + 1"));
assert.ok(execute.includes("running.claim_epoch : undefined"));
assert.ok(execute.includes("jobExecutionSignal(leaseController.signal, options)"));
assert.ok(workerSource.includes('import { mp4BoxParser } from "./mp4box-parser.server"'));
assert.ok(workerSource.includes("parseMediaManifest(4, config.mediaManifest)"));
assert.ok(
  workerSource.includes("generatorSchemaVersion !== 4"),
  "historical v3 output must remain read-only",
);
assert.ok(workerSource.includes("unifiedPlan: config.unifiedPlan"));
assert.ok(
  execute.includes("executeAddVideoJob(supabase, running, {}, executionSignal)"),
  "the canonical runner and lease-loss signals must propagate into Add Video",
);
assert.ok(
  workerSource.includes("AbortSignal.any([invocationSignal, cancellation.signal, timeout])"),
  "Add Video planner/provider/storage work must observe the runner invocation signal",
);
for (const cancellationFence of [
  '.eq("status", "running")',
  '.eq("attempts", job.attempts)',
  '.eq("claim_epoch", job.claim_epoch)',
  '.eq("locked_by", job.locked_by ?? "")',
])
  assert.ok(
    workerSource.includes(cancellationFence),
    "missing cancellation claim fence " + cancellationFence,
  );
assert.ok(workerSource.includes("claimEpoch: job.claim_epoch"));
assert.ok(workerSource.includes("runnerId: job.locked_by!"));
for (const rpcArg of ["p_claim_epoch: input.job.claim_epoch", "p_runner_id: input.job.locked_by"])
  assert.ok(workerSource.includes(rpcArg), "missing media RPC claim fence " + rpcArg);
for (const callbackRpc of [
  "record_add_video_media_operation_epoch",
  "settle_add_video_media_slot_epoch",
  "record_ready_add_video_media_epoch",
]) {
  assert.ok(
    workerSource.includes(`"${callbackRpc}"`),
    "late provider callbacks need epoch RPC " + callbackRpc,
  );
}
assert.ok(
  workerSource.includes("if (config.generatorSchemaVersion !== 4)"),
  "the worker must reject historical Add Video writes",
);
assert.ok(
  !workerSource.includes('return { kind: "fail", reasonCode: ADD_VIDEO_MP4_PARSER_UNAVAILABLE }'),
);
for (const stage of [
  "Preparing this design…",
  "Choosing where video will help…",
  "Preparing the source image…",
  "Creating video…",
  "Updating the selected section…",
  "Saving the video…",
])
  assert.ok(workerSource.includes(stage));
for (const name of [
  "reserveAddVideoMediaCreate",
  "recordAddVideoMediaOperation",
  "recordReadyAddVideoMedia",
  "source_still_hash_mismatch",
  "provider_create_indeterminate",
  "ADD_VIDEO_TOTAL_DEADLINE_MS = 8 * 60 * 1000",
  "deadlineAt,",
  "reserve_add_video_media_create_epoch",
  "record_add_video_media_operation_epoch",
  "settle_add_video_media_slot_epoch",
  "record_ready_add_video_media_epoch",
  "provider_video_mime_invalid",
  "video_persistence_failed",
])
  assert.ok(workerSource.includes(name), "missing staged worker contract " + name);
const materializeStart = workerSource.indexOf('if (stage === "media/materialize")');
for (const token of [
  "downloadClipOperation",
  "attestMp4",
  "persistGeneratedBytes",
  "recordReadyAddVideoMedia",
  'nextStage: "composition/build"',
])
  assert.ok(
    workerSource.indexOf(token, materializeStart) >= materializeStart,
    "materialize unit missing " + token,
  );
const compositionStart = workerSource.indexOf(
  'if (stage === "composition/build" || stage === "validation/run")',
);
for (const token of ["persistableAddVideoCandidate", 'nextStage: "persistence/commit"'])
  assert.ok(
    workerSource.indexOf(token, compositionStart) >= compositionStart,
    "composition unit missing " + token,
  );
assert.ok(!workerSource.includes("createBucket1HeadlessRuntime"));
assert.ok(!workerSource.includes("validateAndAttestAddVideoCandidate"));
assert.match(workerSource, /const committed = await commitAddVideoToVersionIfAvailable/);
const stagedMigration = await fs.readFile(
  path.join(root, "supabase/migrations/20260828173000_bucket1_staged_add_video.sql"),
  "utf8",
);
assert.ok(
  stagedMigration.includes(
    "job.status<>'running' or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch",
  ),
  "epoch callback RPCs must reject callbacks after cancellation or claim loss",
);
for (const contract of [
  "pg_column_size(next_payload)>2097152",
  "settle_add_video_job_epoch",
  "recover_stale_add_video_jobs",
  "commit_add_video_to_version_epoch",
  "reserve_add_video_media_create_epoch",
  "record_add_video_media_operation_epoch",
  "settle_add_video_media_slot_epoch",
  "record_ready_add_video_media_epoch",
  "claim_add_video_media_slot_epoch",
  "provider_operation_id is not null",
  "reconciliation_required",
  "failure_attempts",
])
  assert.ok(stagedMigration.includes(contract), "missing staged SQL contract " + contract);
assert.match(stagedMigration, /Staged Add Video requires epoch settlement/);
assert.match(stagedMigration, /settle_background_job_historical_body/);
assert.match(stagedMigration, /reconcile_due_add_video_media/);
assert.match(
  stagedMigration,
  /revoke all on function public\.settle_background_job\(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz\) from public,anon,authenticated/,
);
assert.match(stagedMigration, /candidate\.generation_contract_epoch=2/);
assert.match(workerSource, /media\/source-verify/);
assert.match(workerSource, /provider_idempotency_key/);
assert.match(workerSource, /getPublicUrl\(sourceSlot\.storagePath\)/);
assert.match(workerSource, /sourceImageUrl,/);
assert.match(
  await fs.readFile(path.join(root, "src/lib/media/lovable-media.server.ts"), "utf8"),
  /body\.input_reference = input\.sourceImageUrl/,
);
assert.match(workerSource, /Video materialization already recorded/);
assert.ok(!stagedMigration.includes("72000000"));
assert.ok(!workerSource.includes("video_provider_generation_unavailable"));
await fs.rm(temporary, { recursive: true, force: true });
console.log(
  "verify-add-video-worker: ok (one-claim staged provider/validation/finalizer pipeline wired)",
);
