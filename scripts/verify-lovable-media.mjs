import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const abortMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/abort.server.ts")).href
);
const shotsMod = await import(
  pathToFileURL(path.join(here, "../src/lib/media/media-shots.ts")).href
);
const mediaMod = await import(
  pathToFileURL(path.join(here, "../src/lib/media/lovable-media.server.ts")).href
);
const promptMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/unified-site-agent.prompt.ts")).href
);
const designMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/design-brief.server.ts")).href
);

const { createAbortError, isAbortError } = abortMod;
const {
  clampMediaShots,
  isForeignMediaUrl,
  isOurStoragePath,
  MAX_STILL_SHOTS,
  MAX_UNIFIED_STILL_SHOTS,
  MAX_VIDEO_SHOTS,
  normalizeUnifiedMediaShots,
  unifiedStillTarget,
} = shotsMod;
const {
  fulfillMediaShots,
  generateAndPersistChatMedia,
  generateStill,
  generateClip,
  isNonretryableImageGenerationError,
  storagePathForGeneratedBytes,
} = mediaMod;

const jpegBytes = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const mp4Bytes = new Uint8Array(32).fill(1);
const { encode: encodePng } = await import("fast-png");

function fakeStillOk() {
  return { ok: true, bytes: jpegBytes, mimeType: "image/png" };
}

function fakeClipOk() {
  return { ok: true, bytes: mp4Bytes, mimeType: "video/mp4" };
}

function memoryStore() {
  const store = new Map();
  return {
    store,
    upload: async (path, body, mimeType) => {
      store.set(path, { body, mimeType });
      return { ok: true };
    },
    downloadStorage: async (_bucket, path) => {
      const hit = store.get(path);
      if (!hit) return null;
      return { bytes: hit.body, mimeType: hit.mimeType };
    },
  };
}

// Without a gateway key, generation fails open as a skip.
delete process.env.AI_API_KEY;

const unwiredStill = await generateStill({ prompt: "warm shop" });
assert.equal(unwiredStill.ok, false);
assert.equal(unwiredStill.skipped, true);
assert.equal(unwiredStill.reason, "no_api_key");

const unwiredClip = await generateClip({ prompt: "gentle camera" });
assert.equal(unwiredClip.ok, false);
assert.equal(unwiredClip.reason, "no_api_key");

const originalFetch = globalThis.fetch;
const originalProviderEnv = {
  key: process.env.AI_API_KEY,
  baseUrl: process.env.AI_BASE_URL,
  mediaBaseUrl: process.env.AI_MEDIA_BASE_URL,
  imageModel: process.env.AI_IMAGE_MODEL,
  videoBaseUrl: process.env.AI_VIDEO_BASE_URL,
  videoModel: process.env.AI_VIDEO_MODEL,
};
try {
  process.env.AI_API_KEY = "csm_test";
  process.env.AI_BASE_URL = "https://consilium.workday.lovable.app/api/public/v1/";
  delete process.env.AI_MEDIA_BASE_URL;
  delete process.env.AI_IMAGE_MODEL;
  let requestedUrl = "";
  let requestedInit;
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from(jpegBytes).toString("base64") }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const generatedStill = await generateStill({
    prompt: "precise standing-seam roof",
    aspectRatio: "portrait",
    cropGuidance: "Keep the roofline centered.",
  });
  assert.equal(generatedStill.ok, true);
  assert.equal(
    requestedUrl,
    "https://consilium.workday.lovable.app/api/public/v1/images/generations",
  );
  assert.equal(requestedInit?.headers?.Authorization, "Bearer csm_test");
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    model: "openai/gpt-image-2",
    prompt: "precise standing-seam roof Composition guidance: Keep the roofline centered.",
    quality: "medium",
    size: "1024x1536",
  });

  requestedUrl = "";
  const expiredStill = await generateStill({
    prompt: "too late",
    deadlineAt: Date.now() - 1,
  });
  assert.equal(expiredStill.ok, false);
  assert.equal(expiredStill.reason, "total_deadline_exceeded");
  assert.equal(requestedUrl, "");

  process.env.AI_MEDIA_BASE_URL = "https://media.example.test/v1/";
  process.env.AI_IMAGE_MODEL = "custom/image-model";
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return new Response("unauthorized", { status: 401 });
  };
  const rejectedStill = await generateStill({ prompt: "override" });
  assert.equal(requestedUrl, "https://media.example.test/v1/images/generations");
  assert.equal(requestedInit?.headers?.Authorization, "Bearer csm_test");
  assert.equal(JSON.parse(String(requestedInit?.body)).model, "custom/image-model");
  assert.equal(JSON.parse(String(requestedInit?.body)).size, "1024x1024");
  assert.deepEqual(rejectedStill, {
    ok: false,
    skipped: true,
    reason: "gateway_401",
    retryable: false,
    disposition: "fatal",
  });

  process.env.AI_MEDIA_BASE_URL = "   ";
  process.env.AI_IMAGE_MODEL = "   ";
  let fetchCount = 0;
  globalThis.fetch = async (url, init) => {
    fetchCount += 1;
    requestedUrl = String(url);
    requestedInit = init;
    return new Response(JSON.stringify({ data: [{ url: "http://169.254.169.254/latest" }] }));
  };
  const urlStill = await generateStill({ prompt: "blank config" });
  assert.equal(
    requestedUrl,
    "https://consilium.workday.lovable.app/api/public/v1/images/generations",
  );
  assert.equal(JSON.parse(String(requestedInit?.body)).model, "openai/gpt-image-2");
  assert.equal(fetchCount, 1, "provider URL responses must not cause a second server-side fetch");
  assert.deepEqual(urlStill, {
    ok: false,
    skipped: true,
    reason: "provider_url_response_rejected",
    retryable: false,
    disposition: "terminal",
  });

  delete process.env.AI_VIDEO_BASE_URL;
  delete process.env.AI_VIDEO_MODEL;

  globalThis.fetch = async () => new Response("{bad", { status: 200 });
  const malformedJson = await generateStill({ prompt: "malformed" });
  assert.equal(malformedJson.reason, "invalid_json_response");
  assert.equal(malformedJson.retryable, false);
  assert.equal(malformedJson.disposition, "terminal");

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ b64_json: "!!!!" }] }), { status: 200 });
  const malformedBase64 = await generateStill({ prompt: "malformed" });
  assert.equal(malformedBase64.reason, "invalid_image_payload");
  assert.equal(malformedBase64.retryable, false);

  const truncatedPng = jpegBytes.subarray(0, 24);
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from(truncatedPng).toString("base64") }] }),
      { status: 200 },
    );
  const truncatedImage = await generateStill({ prompt: "truncated" });
  assert.equal(truncatedImage.reason, "invalid_image_payload");
  assert.equal(truncatedImage.retryable, false);

  globalThis.fetch = async () =>
    new Response("{}", {
      status: 200,
      headers: { "content-length": String(100 * 1024 * 1024) },
    });
  const oversizedResponse = await generateStill({ prompt: "oversized" });
  assert.equal(oversizedResponse.reason, "response_too_large");
  assert.equal(oversizedResponse.retryable, false);

  fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("video provider must remain disabled");
  };
  const disabledVideo = await generateClip({ prompt: "do not send" });
  assert.equal(fetchCount, 0);
  assert.equal(disabledVideo.ok, false);
  assert.equal(disabledVideo.reason, "no_media_provider");

  process.env.AI_VIDEO_BASE_URL = "https://video.example.test/v1";
  process.env.AI_VIDEO_MODEL = "video-model";
  fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("invalid source must fail before fetch");
  };
  const invalidVideoSource = await generateClip({
    prompt: "invalid source",
    sourceImageBytes: new Uint8Array([1, 2, 3]),
  });
  assert.equal(fetchCount, 0);
  assert.equal(invalidVideoSource.reason, "invalid_source_image");

  await assert.rejects(
    () =>
      fulfillMediaShots({
        websiteId: "web-1",
        shots: [{ id: "required", kind: "image", role: "hero", prompt: "required" }],
        requiredStillSlotIds: ["required"],
        deps: {
          generateStill: async () => ({
            ok: false,
            skipped: true,
            reason: "gateway_401",
            retryable: false,
            disposition: "fatal",
          }),
        },
      }),
    (error) => isNonretryableImageGenerationError(error),
  );
} finally {
  globalThis.fetch = originalFetch;
  const restore = (name, value) =>
    value == null ? delete process.env[name] : (process.env[name] = value);
  restore("AI_API_KEY", originalProviderEnv.key);
  restore("AI_BASE_URL", originalProviderEnv.baseUrl);
  restore("AI_MEDIA_BASE_URL", originalProviderEnv.mediaBaseUrl);
  restore("AI_IMAGE_MODEL", originalProviderEnv.imageModel);
  restore("AI_VIDEO_BASE_URL", originalProviderEnv.videoBaseUrl);
  restore("AI_VIDEO_MODEL", originalProviderEnv.videoModel);
}

const unwiredFulfill = await fulfillMediaShots({
  websiteId: "web-1",
  shots: [
    { id: "s1", kind: "image", role: "hero", prompt: "warm shop interior" },
    { id: "v1", kind: "video", prompt: "slow pan across the shop" },
  ],
});
assert.equal(unwiredFulfill.length, 0);

assert.equal(isForeignMediaUrl("https://evil.example/x.jpg"), true);
assert.equal(isForeignMediaUrl("web-1/generated/abc.jpg"), false);
assert.equal(isOurStoragePath("web-1/generated/abc.jpg"), true);
assert.equal(isOurStoragePath("https://evil.example/x.jpg"), false);
assert.equal(isOurStoragePath("../etc/passwd"), false);

const tooMany = clampMediaShots([
  { id: "a", kind: "image", role: "hero", prompt: "one" },
  { id: "b", kind: "image", role: "atmosphere", prompt: "two" },
  { id: "c", kind: "image", role: "atmosphere", prompt: "three" },
  { id: "d", kind: "image", role: "atmosphere", prompt: "four" },
  { id: "v1", kind: "video", prompt: "clip one" },
  { id: "v2", kind: "video", prompt: "clip two" },
  { id: "fake", kind: "image", role: "hero", prompt: "crew on the job installing a roof" },
]);
assert.equal(tooMany.filter((shot) => shot.kind === "image").length, MAX_STILL_SHOTS);
assert.equal(tooMany.filter((shot) => shot.kind === "video").length, MAX_VIDEO_SHOTS);
assert.equal(tooMany.map((shot) => shot.kind).join(","), "image,image,image,video");
assert.equal(
  tooMany.some((shot) => /crew on the job/i.test(shot.prompt)),
  false,
);

assert.equal(unifiedStillTarget(0), 5);
assert.equal(unifiedStillTarget(1), 4);
assert.equal(unifiedStillTarget(3), 2);
assert.equal(unifiedStillTarget(20), 1);
const unifiedPlan = normalizeUnifiedMediaShots(
  [{ id: "hero", kind: "image", role: "hero", prompt: "brand hero" }],
  { evidenceStillCount: 1, fallbackPrompt: "plumbing brand" },
);
assert.equal(unifiedPlan.filter((shot) => shot.kind === "image").length, 4);
assert.equal(unifiedPlan.filter((shot) => shot.kind === "video").length, 1);
assert.equal(clampMediaShots(unifiedPlan).filter((shot) => shot.kind === "image").length, 3);
assert.equal(
  clampMediaShots(unifiedPlan, { maxStills: MAX_UNIFIED_STILL_SHOTS }).filter(
    (shot) => shot.kind === "image",
  ).length,
  4,
);

const mem = memoryStore();
const order = [];
const generated = await fulfillMediaShots({
  websiteId: "web-1",
  shots: [
    { id: "v1", kind: "video", prompt: "bring the still to life", sourceShotId: "s1" },
    { id: "s1", kind: "image", role: "hero", prompt: "warm workshop still" },
  ],
  deps: {
    generateStill: async () => {
      order.push("still");
      return fakeStillOk();
    },
    generateClip: async ({ sourceImageBytes }) => {
      order.push("clip");
      assert.equal(sourceImageBytes?.byteLength, jpegBytes.byteLength);
      return fakeClipOk();
    },
    upload: mem.upload,
    downloadStorage: mem.downloadStorage,
  },
});
assert.deepEqual(order, ["still", "clip"]);
assert.equal(generated.length, 2);
assert.equal(generated[0].origin, "generated");
assert.equal(generated[1].origin, "generated");
assert.match(generated[0].storagePath, /^web-1\/generated\/.+\.png$/);
assert.match(generated[1].storagePath, /^web-1\/generated\/.+\.mp4$/);
assert.equal(generated[0].storagePath, storagePathForGeneratedBytes("web-1", jpegBytes, "png"));
assert.match(generated[0].storagePath, /^web-1\/generated\/[a-f0-9]{64}\.png$/);
assert.equal(generated[0].width, 1);
assert.equal(generated[0].height, 1);
assert.equal(generated[0].orientation, "square");
assert.match(generated[0].contentHash, /^[a-f0-9]{64}$/);
assert.deepEqual(generated[0].provenance, { kind: "generated", storageBucket: "site-media" });
assert.equal(generated[0].proofEligible, false);
assert.match(generated[0].alt ?? "", /^Brand hero:/);
const persistedReady = [];
let resumedProviderCalls = 0;
const resumed = await fulfillMediaShots({
  websiteId: "web-1",
  shots: [
    { id: "s1", kind: "image", role: "hero", prompt: "existing still" },
    { id: "s2", kind: "image", role: "atmosphere", prompt: "new still" },
  ],
  resumeItems: [{ ...generated[0], generationSlotId: "s1" }],
  onItemReady: async (item, shot) => persistedReady.push([item.generationSlotId, shot.id]),
  deps: {
    generateStill: async () => {
      resumedProviderCalls += 1;
      return fakeStillOk();
    },
    upload: mem.upload,
  },
});
assert.equal(resumedProviderCalls, 1, "ready still slots are not repurchased");
assert.deepEqual(
  resumed.map((item) => item.generationSlotId),
  ["s1", "s2"],
);
assert.deepEqual(persistedReady, [["s2", "s2"]]);

let uniquenessCalls = 0;
const uniqueBytes = encodePng({
  width: 1,
  height: 1,
  data: new Uint8Array([3, 255, 255, 255]),
  depth: 8,
  channels: 4,
});
const uniqueReplacement = await fulfillMediaShots({
  websiteId: "web-1",
  shots: [{ id: "s2", kind: "image", role: "atmosphere", prompt: "replacement" }],
  resumeItems: [{ ...generated[0], generationSlotId: "s1" }],
  requireUniqueStills: true,
  maxStillAttempts: 3,
  deps: {
    generateStill: async () => {
      uniquenessCalls += 1;
      return uniquenessCalls === 1
        ? fakeStillOk()
        : { ok: true, bytes: uniqueBytes, mimeType: "image/png" };
    },
    upload: mem.upload,
  },
});
assert.equal(
  uniquenessCalls,
  1,
  "one claim makes at most one provider attempt even when generated bytes duplicate a ready slot",
);
assert.equal(uniqueReplacement.length, 1);
assert.equal(uniqueReplacement[0].generationSlotId, "s1");

let persistenceProviderCalls = 0;
let persistenceUploadCalls = 0;
const persistedAfterRetry = await fulfillMediaShots({
  websiteId: "web-1",
  shots: [{ id: "persist-retry", kind: "image", role: "hero", prompt: "retry storage" }],
  deps: {
    generateStill: async () => {
      persistenceProviderCalls += 1;
      return fakeStillOk();
    },
    upload: async () => ({ ok: ++persistenceUploadCalls >= 2 }),
  },
});
assert.equal(persistenceProviderCalls, 1, "one claim performs one provider attempt");
assert.equal(persistenceUploadCalls, 1, "storage failure is settled for a later durable claim");
assert.equal(persistedAfterRetry.length, 0);

let permanentCalls = 0;
await fulfillMediaShots({
  websiteId: "web-1",
  shots: [{ id: "permanent", kind: "image", role: "hero", prompt: "permanent" }],
  maxStillAttempts: 3,
  deps: {
    generateStill: async () => {
      permanentCalls += 1;
      return { ok: false, skipped: true, reason: "gateway_400", retryable: false };
    },
  },
});
assert.equal(permanentCalls, 1, "permanent provider failures are not retried");

let memoryClipHadSource = false;
await fulfillMediaShots({
  websiteId: "web-1",
  shots: [
    { id: "v1", kind: "video", prompt: "bring the still to life", sourceShotId: "s1" },
    { id: "s1", kind: "image", role: "hero", prompt: "warm workshop still" },
  ],
  deps: {
    generateStill: async () => fakeStillOk(),
    generateClip: async ({ sourceImageBytes }) => {
      memoryClipHadSource = sourceImageBytes?.byteLength === jpegBytes.byteLength;
      return fakeClipOk();
    },
    upload: async () => ({ ok: true }),
  },
});
assert.equal(memoryClipHadSource, true);
let parallelStarted = 0;
const parallelResolvers = [];
const parallelRun = fulfillMediaShots({
  websiteId: "web-1",
  shots: normalizeUnifiedMediaShots([], { evidenceStillCount: 3, fallbackPrompt: "brand" }),
  maxStills: MAX_UNIFIED_STILL_SHOTS,
  parallelStills: true,
  deps: {
    generateStill: async () => {
      parallelStarted += 1;
      return new Promise((resolve) => parallelResolvers.push(() => resolve(fakeStillOk())));
    },
    generateClip: async () => fakeClipOk(),
    upload: async () => ({ ok: true }),
  },
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(parallelStarted, 1, "provider attempts are dispatched sequentially");
parallelResolvers.shift()?.();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  parallelStarted,
  2,
  "the next provider attempt starts only after the prior attempt settles",
);
parallelResolvers.shift()?.();
const parallelMedia = await parallelRun;
assert.equal(parallelMedia.filter((item) => item.mimeType === "image/png").length, 2);
assert.equal(parallelMedia.filter((item) => item.mimeType === "video/mp4").length, 1);

let siblingSawAbort = false;
const claimLoss = new Error("claim lost");
claimLoss.name = "MediaClaimError";
await assert.rejects(
  () =>
    fulfillMediaShots({
      websiteId: "web-1",
      shots: [
        { id: "s1", kind: "image", role: "hero", prompt: "one" },
        { id: "s2", kind: "image", role: "atmosphere", prompt: "two" },
      ],
      parallelStills: true,
      onBeforeGenerate: async (shot) => {
        if (shot.id === "s1") throw claimLoss;
      },
      deps: {
        generateStill: async ({ signal }) =>
          new Promise((resolve) => {
            if (signal?.aborted) siblingSawAbort = true;
            signal?.addEventListener("abort", () => {
              siblingSawAbort = true;
              resolve({ ok: false, skipped: true, reason: "aborted" });
            });
          }),
      },
    }),
  (error) => error?.name === "MediaClaimError",
);
assert.equal(
  siblingSawAbort,
  false,
  "claim loss occurs before any sibling provider attempt is dispatched",
);

const skippedClip = await fulfillMediaShots({
  websiteId: "web-1",
  shots: [
    { id: "s1", kind: "image", role: "atmosphere", prompt: "soft daylight shop" },
    { id: "v1", kind: "video", prompt: "slow pan" },
  ],
  deps: {
    generateStill: async () => fakeStillOk(),
    generateClip: async () => ({ ok: false, skipped: true, reason: "402" }),
    upload: mem.upload,
  },
});
assert.equal(skippedClip.length, 1);
assert.equal(skippedClip[0].origin, "generated");

let clipCalled = false;
const rejectedForeign = await generateAndPersistChatMedia({
  websiteId: "web-1",
  kind: "video",
  prompt: "animate this",
  sourceStoragePath: "https://evil.example/x.jpg",
  supabase: {},
  deps: {
    generateClip: async () => {
      clipCalled = true;
      return fakeClipOk();
    },
  },
});
assert.equal(rejectedForeign, null);
assert.equal(clipCalled, false);

let crossSiteClip = false;
const rejectedCrossSite = await generateAndPersistChatMedia({
  websiteId: "web-1",
  kind: "video",
  prompt: "animate this",
  sourceStoragePath: "web-2/generated/abc.jpg",
  sourceBucket: "site-media",
  supabase: {},
  deps: {
    downloadStorage: async () => ({ bytes: jpegBytes, mimeType: "image/jpeg" }),
    generateClip: async () => {
      crossSiteClip = true;
      return fakeClipOk();
    },
  },
});
assert.equal(rejectedCrossSite, null);
assert.equal(crossSiteClip, false);

for (const result of [
  { ok: false, skipped: true, reason: "timeout", disposition: "indeterminate" },
  { ok: false, skipped: true, reason: "gateway_503", disposition: "retryable" },
  {
    ok: false,
    skipped: true,
    reason: "gateway_503",
    disposition: "retryable",
    operationId: "video-job-1",
  },
  {
    ok: false,
    skipped: true,
    reason: "download_failed",
    disposition: "retryable",
    operationId: "video-job-2",
  },
]) {
  await assert.rejects(
    () =>
      generateAndPersistChatMedia({
        websiteId: "web-1",
        kind: result.operationId ? "video" : "image",
        prompt: "ambiguous provider outcome",
        supabase: {},
        deps: result.operationId
          ? { generateClip: async () => result }
          : { generateStill: async () => result },
      }),
    (error) =>
      error?.name === "MediaGenerationIndeterminateError" &&
      error?.disposition === "indeterminate" &&
      error?.reason === result.reason &&
      error?.operationId === result.operationId,
  );
}

const definitiveFailure = await generateAndPersistChatMedia({
  websiteId: "web-1",
  kind: "image",
  prompt: "definitive rejection",
  supabase: {},
  deps: {
    generateStill: async () => ({
      ok: false,
      skipped: true,
      reason: "gateway_400",
      disposition: "terminal",
    }),
  },
});
assert.equal(definitiveFailure, null);

const persistenceEvents = [];
let chatUploadAttempts = 0;
const persistedChatMedia = await generateAndPersistChatMedia({
  websiteId: "web-1",
  kind: "image",
  prompt: "ownership checked retries",
  assertOwned: async () => persistenceEvents.push("owned"),
  supabase: {},
  deps: {
    generateStill: async () => fakeStillOk(),
    upload: async () => {
      persistenceEvents.push("upload");
      chatUploadAttempts += 1;
      return { ok: chatUploadAttempts >= 2 };
    },
  },
});
assert.equal(persistedChatMedia, null);
assert.deepEqual(
  persistenceEvents,
  ["owned", "owned", "upload"],
  "turn ownership is rechecked before the single persistence attempt",
);

const abortController = new AbortController();
const abortReason = createAbortError();
abortController.abort(abortReason);
await assert.rejects(
  () =>
    generateAndPersistChatMedia({
      websiteId: "web-1",
      kind: "image",
      prompt: "explicit abort",
      signal: abortController.signal,
      supabase: {},
      deps: { generateStill: async () => fakeStillOk() },
    }),
  (error) => isAbortError(error),
);

const controller = new AbortController();
const hanging = ({ signal }) =>
  new Promise((_, reject) => {
    const fail = () => reject(createAbortError());
    if (signal?.aborted) {
      fail();
      return;
    }
    signal?.addEventListener("abort", fail, { once: true });
  });
setTimeout(() => controller.abort(), 20);
await assert.rejects(
  () =>
    fulfillMediaShots({
      websiteId: "web-1",
      shots: [{ id: "v1", kind: "video", prompt: "slow pan" }],
      signal: controller.signal,
      deps: { generateClip: hanging },
    }),
  (error) => isAbortError(error),
);

assert.match(
  promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT,
  /operationalIntent contains only executable stable media and host-anchor constraints/,
);
assert.match(promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT, /Media is optional/);
assert.match(promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT, /Initial generation is still-only/);
assert.match(promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT, /Do not write themeSource/);
assert.match(promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT, /writer owns section order/);
assert.match(
  promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT,
  /generationPrompt is required when sourcePreference is generated or either/,
);
assert.doesNotMatch(promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT, /generationPrompt\?/);
assert.doesNotMatch(
  promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT,
  /proofEligibleRequired,generationPrompt/,
);
assert.match(promptMod.UNIFIED_SITE_AGENT_SYSTEM_PROMPT, /resolved literal Media slot IDs/);
assert.match(designMod.designSystemPrompt(), /mediaShots/);
assert.match(designMod.designSystemPrompt(), /Veo 3\.1 Lite/);

const settlementSource = readFileSync(
  path.join(here, "../src/lib/jobs/failure-settlement.ts"),
  "utf8",
);
assert.match(settlementSource, /isNonretryableImageGenerationError\(options\.error\)/);

const stillSource = readFileSync(
  path.join(here, "../src/lib/media/lovable-media.server.ts"),
  "utf8",
);
assert.doesNotMatch(stillSource, /IMAGE_CALL_TIMEOUT_MS/);
assert.match(stillSource, /export const STILL_TOTAL_DEADLINE_MS = 8 \* 60 \* 1000/);
assert.match(stillSource, /function stillCallSignal/);
assert.match(stillSource, /reason: "total_deadline_exceeded"/);
const generateStillSource = stillSource.slice(
  stillSource.indexOf("export async function generateStill"),
  stillSource.indexOf("export async function createClipOperation"),
);
assert.match(generateStillSource, /stillCallSignal\(input\.signal, input\.deadlineAt/);
assert.match(generateStillSource, /stillDeadlineResult/);
assert.doesNotMatch(generateStillSource, /VIDEO_CALL_TIMEOUT_MS/);
assert.doesNotMatch(generateStillSource, /45000/);

console.log("verify-lovable-media: ok");
