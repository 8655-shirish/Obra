import assert from "node:assert/strict";

import {
  generateStill,
  fulfillMediaShots,
  type GenerateStillInput,
} from "../src/lib/media/lovable-media.server.ts";
import { MediaProviderAttemptAbortError } from "../src/lib/media/provider-effect-boundary.ts";
import {
  addVideoAbsoluteDeadlineExceeded,
  executeAddVideoJob,
} from "../src/lib/jobs/add-video-worker.server.ts";
import {
  classifyAddVideoAbort,
  classifySiteGenerationAbort,
  runSiteGenerationFinalizerAndNotify,
  settleAddVideoDisposition,
  siteGenerationAbortEffectCertainty,
} from "../src/lib/jobs/execute.server.ts";

const originalFetch = globalThis.fetch;
const originalKey = process.env.AI_API_KEY;
const originalBase = process.env.AI_MEDIA_BASE_URL;
process.env.AI_API_KEY = "lifecycle-verifier-key";
process.env.AI_MEDIA_BASE_URL = "https://images.test/v1";

try {
  const key = "a".repeat(64);
  let captured:
    { headers: Headers; body: Record<string, unknown>; signal?: AbortSignal } | undefined;
  globalThis.fetch = async (_url, init) => {
    captured = {
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      signal: init?.signal ?? undefined,
    };
    return Response.json({ data: [] });
  };
  await generateStill({ prompt: "reserved still", idempotencyKey: key });
  assert.equal(captured?.headers.get("Idempotency-Key"), key);
  assert.deepEqual(captured?.body, {
    model: "openai/gpt-image-2",
    prompt: "reserved still",
    quality: "medium",
    size: "1024x1024",
  });

  for (const providerError of [
    new MediaProviderAttemptAbortError("indeterminate"),
    new MediaProviderAttemptAbortError("definite_success"),
  ]) {
    let replayInput: GenerateStillInput | undefined;
    let settled: { disposition?: string; certainty?: string } | undefined;
    await assert.rejects(
      () =>
        fulfillMediaShots({
          websiteId: "website-1",
          shots: [{ id: "still-1", kind: "image", role: "atmosphere", prompt: "timeout replay" }],
          onBeforeGenerate: async () => key,
          onItemFailed: async (_shot, _reason, disposition, _operationId, certainty) => {
            settled = { disposition, certainty };
          },
          deps: {
            generateStill: async (input) => {
              replayInput = input;
              throw providerError;
            },
          },
        }),
      (error) => error === providerError,
    );
    assert.equal(replayInput?.idempotencyKey, key, "timeout/replay keeps durable reservation key");
    if (providerError.mediaProviderEffectCertainty === "indeterminate") {
      assert.equal(
        settled,
        undefined,
        "ambiguous dispatched create remains reserved for reconciliation",
      );
    } else {
      assert.deepEqual(settled, { disposition: "terminal", certainty: "definite_success" });
    }
  }

  let preDispatchSettlement: { disposition?: string; certainty?: string } | undefined;
  const cooperative = new DOMException("cancelled before provider", "AbortError");
  await assert.rejects(
    () =>
      fulfillMediaShots({
        websiteId: "website-1",
        shots: [
          { id: "still-2", kind: "image", role: "atmosphere", prompt: "cancel before provider" },
        ],
        onBeforeGenerate: async () => key,
        onItemFailed: async (_shot, _reason, disposition, _operationId, certainty) => {
          preDispatchSettlement = { disposition, certainty };
        },
        deps: {
          generateStill: async () => {
            throw cooperative;
          },
        },
      }),
    (error) => error === cooperative,
  );
  assert.deepEqual(preDispatchSettlement, { disposition: "retryable", certainty: "not_started" });

  for (const stage of [
    "context",
    "planning",
    "composition",
    "validation",
    "persistence",
  ] as const) {
    assert.equal(
      siteGenerationAbortEffectCertainty({
        stage,
        error: new DOMException("deadline", "AbortError"),
      }),
      "not_started",
    );
  }
  const providerAbort = classifySiteGenerationAbort({
    stage: "media",
    error: new MediaProviderAttemptAbortError("indeterminate"),
    leaseLost: false,
    invocationDeadline: true,
  });
  assert.deepEqual(providerAbort, {
    causeCode: "provider_indeterminate_acceptance",
    effectCertainty: "indeterminate",
  });
  assert.equal(
    siteGenerationAbortEffectCertainty({
      stage: "media",
      error: new MediaProviderAttemptAbortError("indeterminate"),
    }),
    "indeterminate",
  );
  assert.equal(
    siteGenerationAbortEffectCertainty({
      stage: "media",
      error: new MediaProviderAttemptAbortError("definite_success"),
    }),
    "not_started",
  );

  const expiredJob = {
    created_at: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  };
  assert.deepEqual(classifyAddVideoAbort({ leaseLost: false, invocationDeadline: true }), {
    causeCode: "invocation_deadline",
    terminal: true,
  });
  assert.deepEqual(classifyAddVideoAbort({ leaseLost: false, invocationDeadline: false }), {
    causeCode: "cooperative_abort",
    terminal: false,
  });
  assert.equal(addVideoAbsoluteDeadlineExceeded(expiredJob as never), true);
  let touched = false;
  const expiredDisposition = await executeAddVideoJob(
    new Proxy(
      {},
      {
        get() {
          touched = true;
          throw new Error("expired job touched database");
        },
      },
    ) as never,
    expiredJob as never,
  );
  assert.deepEqual(expiredDisposition, { kind: "fail", reasonCode: "total_deadline_exceeded" });
  assert.equal(touched, false, "absolute deadline terminalizes before DB/provider work");

  const broadcastEvents: string[] = [];
  const channel = {
    subscribe(callback: (status: string) => void) {
      queueMicrotask(() => callback("SUBSCRIBED"));
      return channel;
    },
    async send(message: { event: string; payload: { websiteId: string } }) {
      broadcastEvents.push(`${message.event}:${message.payload.websiteId}`);
    },
  };
  const notifierSupabase = {
    channel: () => channel,
    removeChannel: async () => undefined,
  } as never;
  let finishFinalizer!: () => void;
  const finalizerGate = new Promise<void>((resolve) => {
    finishFinalizer = resolve;
  });
  const finalizer = runSiteGenerationFinalizerAndNotify({
    supabase: notifierSupabase,
    websiteId: "website-finalized",
    finalize: () => finalizerGate,
  });
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.deepEqual(broadcastEvents, [], "no progress broadcast before atomic finalizer completion");
  finishFinalizer();
  await finalizer;
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.deepEqual(broadcastEvents, ["progress:website-finalized"]);

  const rejectedEvents: string[] = [];
  const rejectingChannel = {
    ...channel,
    async send(message: { event: string }) {
      rejectedEvents.push(message.event);
    },
  };
  await assert.rejects(() =>
    runSiteGenerationFinalizerAndNotify({
      supabase: { channel: () => rejectingChannel, removeChannel: async () => undefined } as never,
      websiteId: "website-rejected",
      finalize: async () => {
        throw new Error("finalizer failed");
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.deepEqual(rejectedEvents, [], "failed finalizer must not schedule progress broadcast");

  const addVideoEvents: string[] = [];
  const addVideoChannel = {
    ...channel,
    async send(message: { event: string; payload: { websiteId: string } }) {
      addVideoEvents.push(`${message.event}:${message.payload.websiteId}`);
    },
  };
  await settleAddVideoDisposition(
    { channel: () => addVideoChannel, removeChannel: async () => undefined } as never,
    { website_id: "website-add-video-finalized" } as never,
    {
      kind: "complete",
      result: {
        targetVersionId: "version-1",
        revision: 1,
        targetSection: "hero",
        videoSlotId: "video-1",
        candidateHash: "b".repeat(64),
      },
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.deepEqual(addVideoEvents, ["progress:website-add-video-finalized"]);
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey == null) delete process.env.AI_API_KEY;
  else process.env.AI_API_KEY = originalKey;
  if (originalBase == null) delete process.env.AI_MEDIA_BASE_URL;
  else process.env.AI_MEDIA_BASE_URL = originalBase;
}

console.log("verify-worker-media-lifecycle: ok");
