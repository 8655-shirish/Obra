/**
 * Shared image/video executor for generate + chat.
 * generateStill / generateClip are the shared custom-provider wiring seam.
 */

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../integrations/supabase/types.ts";
import { assertNotAborted } from "../agent/abort.server.ts";
import { extensionForMime, validateMediaUpload } from "../media-validation.ts";
import type { EvidenceMediaItem } from "../site-evidence.ts";
import { generatedMediaStoragePath } from "./generated-media-path.ts";
import {
  MediaProviderAttemptAbortError,
  mediaProviderAbortEffectCertainty,
} from "./provider-effect-boundary.ts";
import { validateDecodedImageBytes } from "./image-metadata.ts";
import { readBodyLimited } from "./safe-remote-media.server.ts";
import { clampMediaShots, isOurStoragePath, type MediaShot } from "./media-shots.ts";

type SupabaseAdmin = SupabaseClient<Database>;

export type MediaFailureDisposition = "retryable" | "terminal" | "fatal" | "indeterminate";

export type MediaGenerationSkip = {
  ok: false;
  skipped: true;
  reason: string;
  retryable?: boolean;
  disposition?: MediaFailureDisposition;
  operationId?: string;
};
export type MediaGenerationOk = {
  ok: true;
  bytes: Uint8Array;
  mimeType: string;
  operationId?: string;
};
export type MediaGenerationResult = MediaGenerationSkip | MediaGenerationOk;

export const IMAGE_GENERATION_NONRETRYABLE_ERROR = "image_generation_nonretryable" as const;

export class ImageGenerationError extends Error {
  readonly code = IMAGE_GENERATION_NONRETRYABLE_ERROR;
  readonly retryable = false;
  readonly reason: string;

  constructor(reason: string) {
    super(`${IMAGE_GENERATION_NONRETRYABLE_ERROR}:${reason}`);
    this.name = "ImageGenerationError";
    this.reason = reason;
  }
}

export function isNonretryableImageGenerationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & { code?: unknown; retryable?: unknown };
  return (
    candidate.name === "ImageGenerationError" &&
    candidate.code === IMAGE_GENERATION_NONRETRYABLE_ERROR &&
    candidate.retryable === false
  );
}

export class MediaGenerationIndeterminateError extends Error {
  readonly disposition = "indeterminate" as const;
  readonly reason: string;
  readonly operationId?: string;

  constructor(result: MediaGenerationSkip) {
    super(
      `media_generation_indeterminate:${result.reason}${result.operationId ? `:${result.operationId}` : ""}`,
    );
    this.name = "MediaGenerationIndeterminateError";
    this.reason = result.reason;
    this.operationId = result.operationId;
  }
}

function isIndeterminateGenerationResult(result: MediaGenerationSkip): boolean {
  return result.disposition === "indeterminate" || result.disposition === "retryable";
}

export type GenerateStillInput = {
  prompt: string;
  aspectRatio?: "wide" | "landscape" | "portrait" | "square";
  cropGuidance?: string;
  signal?: AbortSignal;
  /** Absolute wall-clock deadline for the still POST. Same budget as Add Video. */
  deadlineAt?: number;
  /** Test seam for deterministic deadline checks. */
  now?: () => number;
  /** Durable reservation-derived key for provider create replay suppression. */
  idempotencyKey?: string;
};
export type GenerateClipInput = {
  prompt: string;
  sourceImageBytes?: Uint8Array;
  /** Previously hash-verified durable source URL; avoids a second external read in create claims. */
  sourceImageUrl?: string;
  signal?: AbortSignal;
  /** Absolute wall-clock deadline shared by create, polling, and content recovery. */
  deadlineAt?: number;
  /** Test seams for deterministic deadline/recovery checks. */
  now?: () => number;
  pollIntervalMs?: number;
  /** Veo 3.1 Lite is 4 seconds. Pass through after wiring. */
  durationSeconds?: 4;
  /** Durable reservation-derived key for provider create replay suppression. */
  idempotencyKey?: string;
  /** Call from a Veo poll loop after wiring so site_generation locks do not go stale. */
  onHeartbeat?: () => void | Promise<void>;
  resumeOperationId?: string;
  onOperationAccepted?: (operationId: string) => void | Promise<void>;
};

const DEFAULT_AI_BASE_URL = "https://consilium.workday.lovable.app/api/public/v1";
const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2";

function nonemptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/** Images share the chat provider host/key but retain an explicit base override seam. */
function imageGatewayBase(): string {
  return (
    nonemptyEnv("AI_MEDIA_BASE_URL") ??
    nonemptyEnv("AI_BASE_URL") ??
    DEFAULT_AI_BASE_URL
  ).replace(/\/+$/, "");
}

/** Video remains opt-in because the Consilium image contract does not define video routes. */
function videoGatewayConfig(): { baseUrl: string; model: string } | null {
  const baseUrl = nonemptyEnv("AI_VIDEO_BASE_URL");
  const model = nonemptyEnv("AI_VIDEO_MODEL");
  return baseUrl && model ? { baseUrl: baseUrl.replace(/\/+$/, ""), model } : null;
}

function imageModel(): string {
  return nonemptyEnv("AI_IMAGE_MODEL") ?? DEFAULT_IMAGE_MODEL;
}

const MAX_IMAGE_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_RESPONSE_JSON_BYTES = Math.ceil((MAX_IMAGE_RESPONSE_BYTES * 4) / 3) + 1024 * 1024;
const VIDEO_CALL_TIMEOUT_MS = 45_000;
/** Same total budget as Add Video. The still POST is the long unit; it is not 45s. */
export const STILL_TOTAL_DEADLINE_MS = 8 * 60 * 1000;

function imageSize(aspectRatio: GenerateStillInput["aspectRatio"]): string {
  if (aspectRatio === "portrait") return "1024x1536";
  if (aspectRatio === "wide" || aspectRatio === "landscape") return "1536x1024";
  return "1024x1024";
}

function imagePrompt(input: GenerateStillInput): string {
  return input.cropGuidance
    ? `${input.prompt} Composition guidance: ${input.cropGuidance}`
    : input.prompt;
}
export const STORAGE_CALL_TIMEOUT_MS = 45_000;

function remainingTimeoutMs(deadlineAt: number | undefined, now = Date.now): number {
  return Math.max(1, Math.min(VIDEO_CALL_TIMEOUT_MS, (deadlineAt ?? Infinity) - now()));
}

function callSignal(signal?: AbortSignal, deadlineAt?: number, now = Date.now): AbortSignal {
  const timeout = AbortSignal.timeout(remainingTimeoutMs(deadlineAt, now));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Still create is the long wait. Bound it by the 8-minute total, not the 45s video HTTP cap. */
function stillCallSignal(
  signal?: AbortSignal,
  deadlineAt?: number,
  now = Date.now,
): AbortSignal | undefined {
  if (deadlineAt == null) return signal;
  const timeout = AbortSignal.timeout(Math.max(1, deadlineAt - now()));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function stillDeadlineResult(): MediaGenerationResult {
  return {
    ok: false,
    skipped: true,
    reason: "total_deadline_exceeded",
    retryable: false,
    disposition: "terminal",
  };
}

export async function boundedStorageCall<T>(
  operation: () => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  assertNotAborted(options.signal);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? STORAGE_CALL_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void operation().then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function gatewayKey(): string | null {
  return nonemptyEnv("AI_API_KEY") ?? null;
}

function gatewayHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

class ImageResponseContractError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "ImageResponseContractError";
    this.reason = reason;
  }
}

async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new ImageResponseContractError("response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel("response_too_large");
      throw new ImageResponseContractError("response_too_large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function decodeImageBase64(data: string): Uint8Array {
  const encoded = data.replace(/^data:[^,]+,/, "");
  if (encoded.length === 0 || encoded.length > 4 * Math.ceil(MAX_IMAGE_RESPONSE_BYTES / 3))
    throw new ImageResponseContractError("invalid_image_payload");
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new ImageResponseContractError("invalid_image_payload");
  }
  if (binary.length === 0 || binary.length > MAX_IMAGE_RESPONSE_BYTES)
    throw new ImageResponseContractError("invalid_image_payload");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function videoHttpDisposition(status: number): MediaFailureDisposition {
  if (status === 401 || status === 403 || status === 404) return "fatal";
  return status === 408 || status === 429 || status >= 500 ? "retryable" : "terminal";
}

function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return null;
}

function hasCompleteImageContainer(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return (
      bytes.length >= 33 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      String.fromCharCode(...bytes.subarray(bytes.length - 8, bytes.length - 4)) === "IEND"
    );
  }
  if (mimeType === "image/jpeg")
    return (
      bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
    );
  if (mimeType === "image/webp") {
    if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF") return false;
    const declared = bytes[4]! + bytes[5]! * 0x100 + bytes[6]! * 0x10000 + bytes[7]! * 0x1000000;
    return declared + 8 === bytes.length;
  }
  return false;
}

/**
 * Image generation through the Consilium OpenAI-compatible endpoint.
 * Authentication is shared with chat through AI_API_KEY.
 */
export async function generateStill(input: GenerateStillInput): Promise<MediaGenerationResult> {
  assertNotAborted(input.signal);
  const now = input.now ?? Date.now;
  if (input.deadlineAt != null && now() >= input.deadlineAt) return stillDeadlineResult();
  const key = gatewayKey();
  if (!key)
    return {
      ok: false,
      skipped: true,
      reason: "no_api_key",
      retryable: false,
      disposition: "fatal",
    };
  const baseUrl = imageGatewayBase();
  let providerCreateDispatched = false;
  let providerResponseReceived = false;
  const fetchSignal = stillCallSignal(input.signal, input.deadlineAt, now);

  try {
    providerCreateDispatched = true;
    const res = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        ...gatewayHeaders(key),
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        model: imageModel(),
        prompt: imagePrompt(input),
        quality: "medium",
        size: imageSize(input.aspectRatio),
      }),
      signal: fetchSignal,
    });
    providerResponseReceived = true;
    if (!res.ok) {
      const detail = await readResponseTextLimited(res, 64 * 1024).catch(() => "");
      console.error("[lovable-media] image gateway", res.status, detail.slice(0, 500));
      return {
        ok: false,
        skipped: true,
        reason: `gateway_${res.status}`,
        retryable: res.status === 408 || res.status === 429 || res.status >= 500,
        disposition:
          res.status === 401 || res.status === 403 || res.status === 404
            ? "fatal"
            : res.status === 408 || res.status === 429 || res.status >= 500
              ? "retryable"
              : "terminal",
      };
    }
    const responseText = await readResponseTextLimited(res, MAX_IMAGE_RESPONSE_JSON_BYTES);
    let json: unknown;
    try {
      json = JSON.parse(responseText);
    } catch {
      throw new ImageResponseContractError("invalid_json_response");
    }
    const first =
      json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)
        ? (json as { data: unknown[] }).data[0]
        : undefined;
    if (!first || typeof first !== "object") throw new ImageResponseContractError("empty_response");
    const record = first as { b64_json?: unknown; url?: unknown };
    if (typeof record.b64_json === "string") {
      const bytes = decodeImageBase64(record.b64_json);
      const mimeType = sniffImageMime(bytes);
      if (
        !mimeType ||
        !hasCompleteImageContainer(bytes, mimeType) ||
        !(await validateDecodedImageBytes(bytes))
      )
        throw new ImageResponseContractError("invalid_image_payload");
      return { ok: true, bytes, mimeType };
    }
    if (typeof record.url === "string")
      throw new ImageResponseContractError("provider_url_response_rejected");
    throw new ImageResponseContractError("empty_response");
  } catch (error) {
    if (input.deadlineAt != null && now() >= input.deadlineAt) return stillDeadlineResult();
    const interrupted =
      input.signal?.aborted === true ||
      (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
    if (interrupted && providerCreateDispatched) {
      throw new MediaProviderAttemptAbortError(
        providerResponseReceived ? "definite_success" : "indeterminate",
        input.signal?.reason ?? error,
      );
    }
    if (input.signal?.aborted) throw input.signal.reason ?? error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof ImageResponseContractError) {
      return {
        ok: false,
        skipped: true,
        reason: error.reason,
        retryable: false,
        disposition: "terminal",
      };
    }
    console.error("[lovable-media] image", error);
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      skipped: true,
      reason: timedOut ? "timeout" : "error",
      retryable: true,
      disposition: "indeterminate",
    };
  }
}

export type VideoProviderCreateResult =
  { ok: true; operationId: string; status: string } | MediaGenerationSkip;
export type VideoProviderPollResult =
  | {
      ok: true;
      operationId: string;
      status: "pending" | "completed";
      /** Absolute time, derived from provider Retry-After, before another status GET is due. */
      retryAt?: string;
    }
  | MediaGenerationSkip;

function providerRetryAt(response: Response, now: () => number): string | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  const time = Number.isFinite(seconds) ? now() + Math.max(0, seconds) * 1000 : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/** One provider create request. It never polls or downloads. */
export async function createClipOperation(
  input: Omit<GenerateClipInput, "resumeOperationId" | "onOperationAccepted" | "onHeartbeat">,
): Promise<VideoProviderCreateResult> {
  assertNotAborted(input.signal);
  const key = gatewayKey();
  const provider = videoGatewayConfig();
  if (!key) return { ok: false, skipped: true, reason: "no_api_key", disposition: "fatal" };
  if (!provider)
    return { ok: false, skipped: true, reason: "no_media_provider", disposition: "fatal" };
  const body: Record<string, unknown> = {
    model: provider.model,
    prompt: input.prompt,
    seconds: String(input.durationSeconds ?? 4),
    size: "1280x720",
  };
  if (input.sourceImageUrl) {
    body.input_reference = input.sourceImageUrl;
  } else if (input.sourceImageBytes?.length) {
    const mime = sniffImageMime(input.sourceImageBytes);
    if (!mime)
      return { ok: false, skipped: true, reason: "invalid_source_image", disposition: "terminal" };
    body.input_reference = `data:${mime};base64,${toBase64(input.sourceImageBytes)}`;
  }
  try {
    const response = await fetch(`${provider.baseUrl}/videos`, {
      method: "POST",
      headers: {
        ...gatewayHeaders(key),
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: callSignal(input.signal, input.deadlineAt, input.now ?? Date.now),
    });
    if (!response.ok)
      return {
        ok: false,
        skipped: true,
        reason: `gateway_${response.status}`,
        disposition: videoHttpDisposition(response.status),
      };
    const created = (await response.json()) as { id?: string; status?: string };
    if (!created.id)
      return { ok: false, skipped: true, reason: "empty_response", disposition: "indeterminate" };
    return { ok: true, operationId: created.id, status: created.status ?? "in_progress" };
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? error;
    return { ok: false, skipped: true, reason: "error", disposition: "indeterminate" };
  }
}

/** One provider status lookup. It never waits, loops, or downloads. */
export async function pollClipOperation(input: {
  operationId: string;
  signal?: AbortSignal;
  deadlineAt?: number;
  now?: () => number;
}): Promise<VideoProviderPollResult> {
  assertNotAborted(input.signal);
  const key = gatewayKey();
  const provider = videoGatewayConfig();
  if (!key)
    return {
      ok: false,
      skipped: true,
      reason: "no_api_key",
      disposition: "fatal",
      operationId: input.operationId,
    };
  if (!provider)
    return {
      ok: false,
      skipped: true,
      reason: "no_media_provider",
      disposition: "fatal",
      operationId: input.operationId,
    };
  try {
    const response = await fetch(`${provider.baseUrl}/videos/${input.operationId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: callSignal(input.signal, input.deadlineAt, input.now ?? Date.now),
    });
    if (!response.ok)
      return {
        ok: false,
        skipped: true,
        reason: `gateway_${response.status}`,
        retryable: response.status !== 404 && videoHttpDisposition(response.status) === "retryable",
        disposition: response.status === 404 ? "terminal" : videoHttpDisposition(response.status),
        operationId: input.operationId,
      };
    const value = (await response.json()) as { status?: string; error?: { code?: string } };
    const status = value.status ?? "in_progress";
    if (["failed", "cancelled", "canceled", "rejected", "expired"].includes(status))
      return {
        ok: false,
        skipped: true,
        reason: value.error?.code ?? status,
        disposition: "terminal",
        operationId: input.operationId,
      };
    return {
      ok: true,
      operationId: input.operationId,
      status: status === "completed" ? "completed" : "pending",
      ...(status === "completed"
        ? {}
        : { retryAt: providerRetryAt(response, input.now ?? Date.now) }),
    };
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? error;
    return {
      ok: false,
      skipped: true,
      reason: "error",
      retryable: true,
      disposition: "retryable",
      operationId: input.operationId,
    };
  }
}

/** One provider content download. It never polls. */
export async function downloadClipOperation(input: {
  operationId: string;
  signal?: AbortSignal;
  deadlineAt?: number;
  now?: () => number;
}): Promise<MediaGenerationResult> {
  assertNotAborted(input.signal);
  const key = gatewayKey();
  const provider = videoGatewayConfig();
  if (!key)
    return {
      ok: false,
      skipped: true,
      reason: "no_api_key",
      disposition: "fatal",
      operationId: input.operationId,
    };
  if (!provider)
    return {
      ok: false,
      skipped: true,
      reason: "no_media_provider",
      disposition: "fatal",
      operationId: input.operationId,
    };
  try {
    const response = await fetch(`${provider.baseUrl}/videos/${input.operationId}/content`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: callSignal(input.signal, input.deadlineAt, input.now ?? Date.now),
    });
    if (!response.ok)
      return {
        ok: false,
        skipped: true,
        reason: "download_failed",
        retryable: true,
        disposition: "retryable",
        operationId: input.operationId,
      };
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType && contentType !== "video/mp4")
      return {
        ok: false,
        skipped: true,
        reason: "invalid_video_content_type",
        disposition: "terminal",
        operationId: input.operationId,
      };
    const bytes = await readBodyLimited(response, 12 * 1024 * 1024);
    if (bytes.byteLength < 12 || String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp")
      return {
        ok: false,
        skipped: true,
        reason: "invalid_video_signature",
        disposition: "terminal",
        operationId: input.operationId,
      };
    return { ok: true, bytes, mimeType: "video/mp4", operationId: input.operationId };
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? error;
    return {
      ok: false,
      skipped: true,
      reason: "download_failed",
      retryable: true,
      disposition: "retryable",
      operationId: input.operationId,
    };
  }
}

/**
 * Video generation via an explicitly configured compatible media provider.
 * Creates a job, polls it, and downloads the MP4; provider errors fail open.
 * Staged Add Video never calls this compatibility helper.
 */
export async function generateClip(input: GenerateClipInput): Promise<MediaGenerationResult> {
  assertNotAborted(input.signal);
  const now = input.now ?? Date.now;
  const deadlineResult = (operationId?: string): MediaGenerationResult => ({
    ok: false,
    skipped: true,
    reason: "total_deadline_exceeded",
    retryable: false,
    disposition: "terminal",
    operationId,
  });
  if (input.deadlineAt != null && now() >= input.deadlineAt)
    return deadlineResult(input.resumeOperationId);
  const key = gatewayKey();
  if (!key) return { ok: false, skipped: true, reason: "no_api_key", disposition: "fatal" };
  const provider = videoGatewayConfig();
  if (!provider)
    return { ok: false, skipped: true, reason: "no_media_provider", disposition: "fatal" };
  const { baseUrl, model } = provider;

  try {
    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      seconds: String(input.durationSeconds ?? 4),
      size: "1280x720",
    };
    if (input.sourceImageBytes?.length) {
      const mime = sniffImageMime(input.sourceImageBytes);
      if (!mime)
        return {
          ok: false,
          skipped: true,
          reason: "invalid_source_image",
          retryable: false,
          disposition: "terminal",
        };
      body.input_reference = `data:${mime};base64,${toBase64(input.sourceImageBytes)}`;
    }

    let job: { id?: string; status?: string };
    if (input.resumeOperationId) {
      job = { id: input.resumeOperationId, status: "in_progress" };
    } else {
      const createRes = await fetch(`${baseUrl}/videos`, {
        method: "POST",
        headers: gatewayHeaders(key),
        body: JSON.stringify(body),
        signal: callSignal(input.signal, input.deadlineAt, now),
      });
      if (!createRes.ok) {
        const detail = await createRes.text().catch(() => "");
        console.error("[lovable-media] video create", createRes.status, detail.slice(0, 500));
        return {
          ok: false,
          skipped: true,
          reason: `gateway_${createRes.status}`,
          disposition: videoHttpDisposition(createRes.status),
        };
      }
      job = (await createRes.json()) as { id?: string; status?: string };
      if (!job.id)
        return { ok: false, skipped: true, reason: "empty_response", disposition: "indeterminate" };
      await input.onOperationAccepted?.(job.id);
    }

    let status = job.status ?? "in_progress";
    for (let attempt = 0; attempt < 90 && status !== "completed"; attempt += 1) {
      assertNotAborted(input.signal);
      if (input.deadlineAt != null && now() >= input.deadlineAt) return deadlineResult(job.id);
      await input.onHeartbeat?.();
      const delayMs = Math.min(
        input.pollIntervalMs ?? 8000,
        Math.max(0, (input.deadlineAt ?? Infinity) - now()),
      );
      if (input.deadlineAt != null && now() >= input.deadlineAt) return deadlineResult(job.id);
      if (delayMs > 0) await abortableDelay(delayMs, input.signal);
      const pollRes = await fetch(`${baseUrl}/videos/${job.id}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: callSignal(input.signal, input.deadlineAt, now),
      });
      if (!pollRes.ok) {
        console.error("[lovable-media] video poll", pollRes.status);
        return {
          ok: false,
          skipped: true,
          reason: `gateway_${pollRes.status}`,
          retryable: videoHttpDisposition(pollRes.status) === "retryable",
          disposition: pollRes.status === 404 ? "terminal" : videoHttpDisposition(pollRes.status),
          operationId: job.id,
        };
      }
      const polled = (await pollRes.json()) as {
        status?: string;
        error?: { code?: string; message?: string };
      };
      status = polled.status ?? "in_progress";
      if (["failed", "cancelled", "canceled", "rejected", "expired"].includes(status)) {
        console.error("[lovable-media] video terminal", status, polled.error?.message);
        return {
          ok: false,
          skipped: true,
          reason: polled.error?.code ?? status,
          disposition: "terminal",
          operationId: job.id,
        };
      }
    }
    if (status !== "completed")
      return {
        ok: false,
        skipped: true,
        reason: "timeout",
        retryable: true,
        disposition: "retryable",
        operationId: job.id,
      };

    if (input.deadlineAt != null && now() >= input.deadlineAt) return deadlineResult(job.id);
    const contentRes = await fetch(`${baseUrl}/videos/${job.id}/content`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: callSignal(input.signal, input.deadlineAt, now),
    });
    if (!contentRes.ok)
      return {
        ok: false,
        skipped: true,
        reason: "download_failed",
        retryable: true,
        disposition: "retryable",
        operationId: job.id,
      };
    const contentType = contentRes.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType && contentType !== "video/mp4")
      return {
        ok: false,
        skipped: true,
        reason: "invalid_content_type",
        disposition: "terminal",
        operationId: job.id,
      };
    const bytes = await readBodyLimited(contentRes, 12 * 1024 * 1024);
    if (bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp")
      return {
        ok: false,
        skipped: true,
        reason: "invalid_mp4_signature",
        disposition: "terminal",
        operationId: job.id,
      };
    return { ok: true, bytes, mimeType: "video/mp4", operationId: job.id };
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    console.error("[lovable-media] video", error);
    return {
      ok: false,
      skipped: true,
      reason: "error",
      retryable: true,
      disposition: input.resumeOperationId ? "retryable" : "indeterminate",
      operationId: input.resumeOperationId,
    };
  }
}

export type LovableMediaDeps = {
  generateStill?: (input: GenerateStillInput) => Promise<MediaGenerationResult>;
  generateClip?: (input: GenerateClipInput) => Promise<MediaGenerationResult>;
  upload?: (path: string, body: Uint8Array, mimeType: string) => Promise<{ ok: boolean }>;
  downloadStorage?: (
    bucket: "site-media" | "chat-attachments",
    path: string,
  ) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
};

function atmosphereAlt(prompt: string, role?: "hero" | "atmosphere"): string {
  const trimmed = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
  const prefix = role === "hero" ? "Brand hero" : "Brand atmosphere";
  return trimmed ? `${prefix}: ${trimmed}` : prefix;
}

export function storagePathForGeneratedBytes(
  websiteId: string,
  bytes: Uint8Array,
  ext: string,
): string {
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  return generatedMediaStoragePath(websiteId, contentHash, ext);
}

export function generatedPlaceholderUrl(storagePath: string): string {
  return `https://generated.obra.invalid/${storagePath}`;
}

async function defaultUpload(
  supabase: SupabaseAdmin,
  path: string,
  body: Uint8Array,
  mimeType: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabase.storage.from("site-media").upload(path, body, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) {
    const duplicate =
      error.message?.toLowerCase().includes("already exists") ||
      error.message?.toLowerCase().includes("duplicate") ||
      error.message?.toLowerCase().includes("resource already exists");
    if (duplicate) {
      const existing = await defaultDownload(supabase, "site-media", path);
      if (!existing || existing.mimeType.toLowerCase() !== mimeType.toLowerCase())
        return { ok: false };
      const expectedHash = createHash("sha256").update(body).digest("hex");
      const existingHash = createHash("sha256").update(existing.bytes).digest("hex");
      return { ok: expectedHash === existingHash };
    }
    console.error("[lovable-media] upload", path, error);
    return { ok: false };
  }
  return { ok: true };
}

async function defaultDownload(
  supabase: SupabaseAdmin,
  bucket: "site-media" | "chat-attachments",
  path: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  const bytes = await readBodyLimited(
    new Response(data.stream(), { headers: { "content-length": String(data.size) } }),
    50 * 1024 * 1024,
  );
  const mimeType = data.type || "application/octet-stream";
  return { bytes, mimeType };
}

export async function persistGeneratedBytes(
  websiteId: string,
  bytes: Uint8Array,
  mimeType: string,
  alt: string,
  supabase: SupabaseAdmin | undefined,
  upload: LovableMediaDeps["upload"],
  signal?: AbortSignal,
  assertOwned?: () => Promise<void>,
): Promise<EvidenceMediaItem | null> {
  const check = validateMediaUpload({ type: mimeType, size: bytes.byteLength }, "site");
  if (!check.ok) return null;
  const ext = extensionForMime(mimeType);
  const metadata = mimeType.startsWith("image/") ? await validateDecodedImageBytes(bytes) : null;
  if (mimeType.startsWith("image/") && !metadata) return null;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const storagePath = storagePathForGeneratedBytes(websiteId, bytes, ext);
  const uploadOnce = () =>
    upload
      ? upload(storagePath, bytes, mimeType)
      : supabase
        ? defaultUpload(supabase, storagePath, bytes, mimeType)
        : Promise.resolve({ ok: true });
  assertNotAborted(signal);
  await assertOwned?.();
  let uploaded = { ok: false };
  try {
    // The durable media claim is the retry boundary: never hide several external
    // storage attempts inside the same claimed provider unit.
    uploaded = await boundedStorageCall(uploadOnce, { signal });
  } catch (error) {
    assertNotAborted(signal);
    console.error("[lovable-media] bounded upload", storagePath, error);
  }
  if (!uploaded.ok) return null;
  assertNotAborted(signal);
  await assertOwned?.();
  return {
    url: generatedPlaceholderUrl(storagePath),
    storagePath,
    mimeType,
    alt,
    origin: "generated",
    ...(metadata ?? {}),
    contentHash,
    provenance: { kind: "generated", storageBucket: "site-media" },
    proofEligible: false,
  };
}

export async function loadOurImageBytes(options: {
  storagePath: string;
  bucket?: "site-media" | "chat-attachments";
  websiteId?: string;
  supabase?: SupabaseAdmin;
  downloadStorage?: LovableMediaDeps["downloadStorage"];
  signal?: AbortSignal;
}): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  assertNotAborted(options.signal);
  if (!isOurStoragePath(options.storagePath)) return null;
  const download = options.downloadStorage;
  const buckets: Array<"site-media" | "chat-attachments"> = options.bucket
    ? [options.bucket]
    : ["site-media", "chat-attachments"];
  for (const bucket of buckets) {
    if (
      bucket === "site-media" &&
      options.websiteId &&
      !options.storagePath.startsWith(`${options.websiteId}/`)
    ) {
      continue;
    }
    try {
      const loaded = await boundedStorageCall(
        () =>
          download
            ? download(bucket, options.storagePath)
            : options.supabase
              ? defaultDownload(options.supabase, bucket, options.storagePath)
              : Promise.resolve(null),
        { signal: options.signal },
      );
      if (loaded) return loaded;
    } catch (error) {
      assertNotAborted(options.signal);
      console.error("[lovable-media] bounded download", bucket, options.storagePath, error);
    }
  }
  return null;
}

async function sourceBytesForClip(
  shot: Extract<MediaShot, { kind: "video" }>,
  stillsById: Map<string, EvidenceMediaItem>,
  stillBytesById: Map<string, Uint8Array>,
  evidenceImages: EvidenceMediaItem[],
  websiteId: string,
  supabase: SupabaseAdmin | undefined,
  deps: LovableMediaDeps,
  signal?: AbortSignal,
): Promise<Uint8Array | undefined> {
  if (shot.sourceShotId) {
    const memory = stillBytesById.get(shot.sourceShotId);
    if (memory) return memory;
    const still = stillsById.get(shot.sourceShotId);
    const path = still?.storagePath;
    if (!path) return undefined;
    const loaded = await loadOurImageBytes({
      storagePath: path,
      bucket: "site-media",
      websiteId,
      supabase,
      downloadStorage: deps.downloadStorage,
      signal,
    });
    return loaded?.bytes;
  }
  if (shot.sourceEvidenceIndex != null) {
    const item = evidenceImages[shot.sourceEvidenceIndex];
    const path = item?.storagePath;
    if (!path || !isOurStoragePath(path)) return undefined;
    const loaded = await loadOurImageBytes({
      storagePath: path,
      bucket: "site-media",
      websiteId,
      supabase,
      downloadStorage: deps.downloadStorage,
      signal,
    });
    return loaded?.bytes;
  }
  return undefined;
}

export async function fulfillMediaShots(options: {
  websiteId: string;
  shots: unknown;
  evidenceImages?: EvidenceMediaItem[];
  signal?: AbortSignal;
  onProgress?: (message: string) => void | Promise<void>;
  supabase?: SupabaseAdmin;
  deps?: LovableMediaDeps;
  maxStills?: number;
  parallelStills?: boolean;
  stillConcurrency?: number;
  requiredStillCount?: number;
  requiredStillSlotIds?: string[];
  requireVideoSource?: boolean;
  resumeItems?: EvidenceMediaItem[];
  onItemReady?: (item: EvidenceMediaItem, shot: MediaShot) => void | Promise<void>;
  onBeforeGenerate?: (shot: MediaShot) => string | void | Promise<string | void>;
  onItemFailed?: (
    shot: MediaShot,
    reason: string,
    disposition?: MediaFailureDisposition,
    operationId?: string,
    effectCertainty?: "not_started" | "definite_failure" | "definite_success" | "indeterminate",
  ) => void | Promise<void>;
  onItemAbandoned?: (shot: MediaShot, reason: string) => void | Promise<void>;
  resumeOperationIds?: ReadonlyMap<string, string>;
  onOperationAccepted?: (shot: MediaShot, operationId: string) => void | Promise<void>;
  maxStillAttempts?: number;
  requireUniqueStills?: boolean;
  /** Absolute still POST deadline. Pulse leftover must not start a still. */
  deadlineAt?: number;
}): Promise<EvidenceMediaItem[]> {
  const shots = clampMediaShots(options.shots, { maxStills: options.maxStills });
  if (shots.length === 0) return [];

  const stillFn = options.deps?.generateStill ?? generateStill;
  const clipFn = options.deps?.generateClip ?? generateClip;
  const siblingController = new AbortController();
  const runSignal = options.signal
    ? AbortSignal.any([options.signal, siblingController.signal])
    : siblingController.signal;
  const resumed = options.resumeItems ?? [];
  const out: EvidenceMediaItem[] = [...resumed];
  const stillsById = new Map<string, EvidenceMediaItem>(
    resumed
      .filter((item) => item.generationSlotId && !(item.mimeType ?? "").startsWith("video/"))
      .map((item) => [item.generationSlotId!, item]),
  );
  const stillBytesById = new Map<string, Uint8Array>();
  const evidenceImages = options.evidenceImages ?? [];
  const claimedShots = new Map<string, MediaShot>();
  const providerSucceededShots = new Set<string>();
  const usedStillAssets = new Set(
    resumed
      .filter((item) => !(item.mimeType ?? "").startsWith("video/"))
      .map((item) => item.contentHash ?? item.storagePath ?? item.url),
  );

  try {
    const resumedSlotIds = new Set(resumed.map((item) => item.generationSlotId).filter(Boolean));
    const imageShots = shots.filter(
      (shot): shot is Extract<MediaShot, { kind: "image" }> =>
        shot.kind === "image" && !resumedSlotIds.has(shot.id),
    );
    const fulfillStill = async (shot: Extract<MediaShot, { kind: "image" }>) => {
      assertNotAborted(runSignal);
      await options.onProgress?.("Generating brand stills…");
      const idempotencyKey = await options.onBeforeGenerate?.(shot);
      claimedShots.set(shot.id, shot);
      let failureReason = "image generation unavailable";
      let failureDisposition: MediaFailureDisposition = "retryable";
      let failureOperationId: string | undefined;
      // One invocation owns exactly one provider attempt. Durable callers schedule
      // a later claim after settlement instead of retrying in this process.
      for (let attempt = 0; attempt < 1; attempt += 1) {
        assertNotAborted(runSignal);
        const generated = await stillFn({
          prompt: shot.prompt,
          aspectRatio: shot.aspectRatio,
          cropGuidance: shot.cropGuidance,
          signal: runSignal,
          deadlineAt: options.deadlineAt,
          idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : undefined,
        });
        if (!generated.ok) {
          failureReason = generated.reason;
          failureDisposition = generated.disposition ?? "retryable";
          failureOperationId = generated.operationId;
          const requiredSlotIds = options.requiredStillSlotIds ?? [];
          const required =
            requiredSlotIds.includes(shot.id) ||
            (requiredSlotIds.length === 0 &&
              (options.requiredStillCount ?? 0) >= imageShots.length);
          if (required && (failureDisposition === "fatal" || failureDisposition === "terminal")) {
            await options.onItemFailed?.(
              shot,
              failureReason,
              failureDisposition,
              failureOperationId,
            );
            claimedShots.delete(shot.id);
            throw new ImageGenerationError(failureReason);
          }
          break;
        }
        providerSucceededShots.add(shot.id);
        failureOperationId = generated.operationId;
        if (failureOperationId) {
          await options.onOperationAccepted?.(shot, failureOperationId);
        }
        const item = await persistGeneratedBytes(
          options.websiteId,
          generated.bytes,
          generated.mimeType,
          atmosphereAlt(shot.prompt, shot.role),
          options.supabase,
          options.deps?.upload,
          runSignal,
        );
        if (!item) {
          failureReason = "generated image could not be persisted";
          failureDisposition = "terminal";
          break;
        }
        const assetId = item.contentHash ?? item.storagePath ?? item.url;
        if (options.requireUniqueStills && usedStillAssets.has(assetId)) {
          failureReason = "generated image duplicated another final still";
          continue;
        }
        usedStillAssets.add(assetId);
        const ready = { ...item, generationSlotId: shot.id };
        await options.onItemReady?.(ready, shot);
        claimedShots.delete(shot.id);
        return { shot, item: ready, bytes: generated.bytes };
      }
      await options.onItemFailed?.(shot, failureReason, failureDisposition, failureOperationId);
      claimedShots.delete(shot.id);
      return null;
    };
    const stillResults: Array<Awaited<ReturnType<typeof fulfillStill>>> = Array.from(
      {
        length: imageShots.length,
      },
      () => null,
    );
    for (const [index, shot] of imageShots.entries()) {
      stillResults[index] = await fulfillStill(shot);
    }
    for (const result of stillResults) {
      if (!result) continue;
      stillsById.set(result.shot.id, result.item);
      stillBytesById.set(result.shot.id, result.bytes);
      out.push(result.item);
    }

    const readyStillCount = out.filter(
      (item) => !(item.mimeType ?? "").startsWith("video/"),
    ).length;
    const missingRequiredStill = (options.requiredStillSlotIds ?? []).some(
      (slotId) => !stillsById.has(slotId),
    );
    if (
      missingRequiredStill ||
      (options.requiredStillCount != null && readyStillCount < options.requiredStillCount)
    )
      return out;

    for (const shot of shots) {
      assertNotAborted(runSignal);
      if (shot.kind !== "video" || resumedSlotIds.has(shot.id)) continue;
      await options.onProgress?.("Generating a short clip…");
      const idempotencyKey = await options.onBeforeGenerate?.(shot);
      claimedShots.set(shot.id, shot);
      const sourceImageBytes = await sourceBytesForClip(
        shot,
        stillsById,
        stillBytesById,
        evidenceImages,
        options.websiteId,
        options.supabase,
        options.deps ?? {},
        runSignal,
      );
      if (options.requireVideoSource && !sourceImageBytes) {
        throw new Error(`Video shot ${shot.id} requires source image bytes`);
      }
      const generated = await clipFn({
        prompt: shot.prompt,
        sourceImageBytes,
        durationSeconds: 4,
        signal: runSignal,
        onHeartbeat: async () => {
          await options.onProgress?.("Generating a short clip…");
        },
        idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : undefined,
        resumeOperationId: options.resumeOperationIds?.get(shot.id),
        onOperationAccepted: async (operationId) => {
          await options.onOperationAccepted?.(shot, operationId);
        },
      });
      if (!generated.ok) {
        await options.onItemFailed?.(
          shot,
          generated.reason,
          generated.disposition,
          generated.operationId,
        );
        claimedShots.delete(shot.id);
        continue;
      }
      providerSucceededShots.add(shot.id);
      if (generated.operationId) {
        await options.onOperationAccepted?.(shot, generated.operationId);
      }
      const item = await persistGeneratedBytes(
        options.websiteId,
        generated.bytes,
        generated.mimeType,
        atmosphereAlt(shot.prompt),
        options.supabase,
        options.deps?.upload,
        runSignal,
      );
      if (!item) {
        await options.onItemFailed?.(
          shot,
          "generated video could not be persisted",
          "terminal",
          generated.operationId,
        );
        claimedShots.delete(shot.id);
        continue;
      }
      if (item) {
        const sourceSlotId =
          shot.sourceShotId ??
          (shot.sourceEvidenceIndex != null ? `evidence-${shot.sourceEvidenceIndex}` : undefined);
        if (options.requireVideoSource && (!sourceSlotId || !sourceImageBytes)) {
          throw new Error(`Video shot ${shot.id} requires a resolved source still`);
        }
        const ready = { ...item, generationSlotId: shot.id, videoSourceSlotId: sourceSlotId };
        await options.onItemReady?.(ready, shot);
        claimedShots.delete(shot.id);
        out.push(ready);
      }
    }
  } catch (error) {
    const errorName =
      typeof error === "object" && error ? (error as { name?: string }).name : undefined;
    if (errorName === "AbortError" || errorName === "TimeoutError") {
      const providerCertainty = mediaProviderAbortEffectCertainty(error);
      // A reservation is not a provider attempt. Clear pre-dispatch reservations immediately;
      // only an actually dispatched create may remain provider-indeterminate.
      if (providerCertainty !== "indeterminate") {
        await Promise.all(
          [...claimedShots.values()].map((shot) => {
            const providerSucceeded =
              providerCertainty === "definite_success" || providerSucceededShots.has(shot.id);
            return options.onItemFailed?.(
              shot,
              providerSucceeded
                ? "generation interrupted after provider success"
                : "generation interrupted before provider dispatch",
              providerSucceeded ? "terminal" : "retryable",
              undefined,
              providerSucceeded ? "definite_success" : "not_started",
            );
          }),
        );
      }
      throw error;
    }
    if (errorName === "ImageGenerationError") {
      await Promise.all(
        [...claimedShots.values()].map((shot) =>
          options.onItemAbandoned?.(shot, "generation stopped after nonretryable provider failure"),
        ),
      );
      claimedShots.clear();
      throw error;
    }
    if (errorName === "MediaClaimError") throw error;
    const reason = error instanceof Error ? error.message : "media generation failed";
    const indeterminate = error instanceof MediaGenerationIndeterminateError;
    await Promise.all(
      [...claimedShots.values()].map((shot) =>
        options.onItemFailed?.(
          shot,
          reason,
          indeterminate ? "indeterminate" : "retryable",
          indeterminate ? error.operationId : undefined,
        ),
      ),
    );
    claimedShots.clear();
    if (indeterminate || errorName === "MediaCreateBudgetError") throw error;
    console.error("[lovable-media] fulfill", error);
  }

  return out;
}

export async function generateAndPersistChatMedia(options: {
  websiteId: string;
  kind: "image" | "video";
  prompt: string;
  role?: "hero" | "atmosphere";
  sourceStoragePath?: string;
  sourceBucket?: "site-media" | "chat-attachments";
  signal?: AbortSignal;
  assertOwned?: () => Promise<void>;
  supabase: SupabaseAdmin;
  deps?: LovableMediaDeps;
}): Promise<EvidenceMediaItem | null> {
  assertNotAborted(options.signal);
  if (isForeignHttp(options.sourceStoragePath)) return null;

  let sourceImageBytes: Uint8Array | undefined;
  if (options.kind === "video" && options.sourceStoragePath) {
    if (!isOurStoragePath(options.sourceStoragePath)) return null;
    const loaded = await loadOurImageBytes({
      storagePath: options.sourceStoragePath,
      bucket: options.sourceBucket,
      websiteId: options.websiteId,
      supabase: options.supabase,
      downloadStorage: options.deps?.downloadStorage,
      signal: options.signal,
    });
    if (!loaded) return null;
    sourceImageBytes = loaded.bytes;
  }

  const stillFn = options.deps?.generateStill ?? generateStill;
  const clipFn = options.deps?.generateClip ?? generateClip;
  const generated =
    options.kind === "image"
      ? await stillFn({ prompt: options.prompt, signal: options.signal })
      : await clipFn({
          prompt: options.prompt,
          sourceImageBytes,
          durationSeconds: 4,
          signal: options.signal,
        });
  if (!generated.ok) {
    if (isIndeterminateGenerationResult(generated)) {
      throw new MediaGenerationIndeterminateError(generated);
    }
    return null;
  }
  await options.assertOwned?.();
  return persistGeneratedBytes(
    options.websiteId,
    generated.bytes,
    generated.mimeType,
    atmosphereAlt(options.prompt, options.role),
    options.supabase,
    options.deps?.upload,
    options.signal,
    options.assertOwned,
  );
}

function isForeignHttp(value: string | undefined): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}
