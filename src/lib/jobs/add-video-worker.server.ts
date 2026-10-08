import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { compileThemeSource } from "@/lib/site-theme/compile-theme-source";
import { bucket1CandidateConfigHash } from "@/lib/site-validation/bucket1-validation.server";
import {
  parseMediaManifest,
  type MediaManifestMotionPreset,
  type MediaManifestSlot,
  type ResolvedMediaManifest,
} from "@/lib/site-theme/media-manifest";
import { isCanonicalSectionType, type CanonicalSectionType } from "@/lib/agent/section-order";
import {
  parseCurrentUnifiedPlan,
  type CurrentUnifiedOperationalIntent,
} from "@/lib/agent/unified-design-brief";
import { assertNotAborted, isAbortError } from "@/lib/agent/abort.server";
import { streamChatCompletion } from "@/lib/agent/lovable-ai.server";
import {
  createClipOperation,
  downloadClipOperation,
  loadOurImageBytes,
  persistGeneratedBytes,
  pollClipOperation,
  type VideoProviderCreateResult,
  type VideoProviderPollResult,
} from "@/lib/media/lovable-media.server";
import {
  loadGenerationMediaSlot,
  type GenerationMediaEffectCertainty,
  type GenerationMediaLedgerRow,
} from "@/lib/media/generation-media-slots.server";
import { watchJobCancellation } from "./cancel-check.server";
import { mp4BoxParser } from "./mp4box-parser.server";
import { callSupabaseRpc } from "./supabase-rpc.server";
import { requireWebsiteId } from "./enrichment-subject";
import type { BackgroundJobRow } from "./types";

export type AddVideoPlan = {
  /** Historical field name; schema v4 stores an operational anchor slug here. */
  targetSection: string;
  sourceSlotId: string;
  placement: "inline";
  motionPreset: MediaManifestMotionPreset;
};
export type AddVideoResult = {
  targetVersionId: string;
  revision: number;
  targetSection: string;
  videoSlotId: string;
  candidateHash: string;
};
export type AddVideoDisposition =
  | { kind: "yield" }
  | { kind: "complete"; result: AddVideoResult }
  | { kind: "retry"; reasonCode: string; retryAt?: string }
  | { kind: "fail"; reasonCode: string }
  | { kind: "indeterminate"; reasonCode: string };
export type Mp4Attestation = {
  byteSize: number;
  durationMs: number;
  width: number;
  height: number;
  videoCodec: "h264";
  videoProfile: string;
  hasAudio: boolean;
  audioCodec: string | null;
  validatorVersion: string;
  contentHash: string;
};
export interface Mp4Parser {
  readonly version: string;
  inspect(
    bytes: Uint8Array,
  ): Promise<Omit<Mp4Attestation, "byteSize" | "contentHash" | "validatorVersion">>;
}

export const ADD_VIDEO_MP4_PARSER_UNAVAILABLE = "mp4_parser_unavailable";
const MAX_MP4_BYTES = 12 * 1024 * 1024;
export const ADD_VIDEO_TOTAL_DEADLINE_MS = 8 * 60 * 1000;

export function addVideoAbsoluteDeadlineExceeded(
  job: Pick<BackgroundJobRow, "created_at">,
  now = Date.now(),
): boolean {
  const createdAt = Date.parse(job.created_at);
  return !Number.isFinite(createdAt) || now >= createdAt + ADD_VIDEO_TOTAL_DEADLINE_MS;
}

const LEGACY_BLOCKED_SECTIONS = new Set(["beforeAfter", "reviews", "contact", "footer"]);
const PRESETS: readonly MediaManifestMotionPreset[] = [
  "slow-push",
  "subtle-parallax",
  "gentle-pan",
  "ambient-depth",
];
type RecordValue = Record<string, unknown>;
type Attachment = Database["public"]["Tables"]["website_version_media_slots"]["Row"];
type Admin = SupabaseClient<Database>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}
export function canonicalHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}
function literalMarkerRegex(section: string): RegExp {
  return new RegExp("\\bdata-site-section\\s*=\\s*([\"'])" + escapeRegex(section) + "\\1", "g");
}

export function validateSectionTopology(
  themeSource: string,
  sectionTopology: unknown,
): CanonicalSectionType[] {
  if (!Array.isArray(sectionTopology) || sectionTopology.length === 0)
    throw new Error("section_topology_missing");
  const sections: CanonicalSectionType[] = sectionTopology.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.section !== "string" ||
      !isCanonicalSectionType(item.section)
    )
      throw new Error("section_topology_invalid");
    return item.section as CanonicalSectionType;
  });
  if (new Set(sections).size !== sections.length) throw new Error("section_topology_not_unique");
  for (const section of sections)
    if ([...themeSource.matchAll(literalMarkerRegex(section))].length !== 1)
      throw new Error("section_marker_invalid");
  if (/\bdata-site-section\s*=\s*\{/.test(themeSource)) throw new Error("section_marker_dynamic");
  const markers = [...themeSource.matchAll(/\bdata-site-section\s*=\s*(["'])([^"']+)\1/g)].map(
    (match) => match[2],
  );
  if (
    markers.length !== sections.length ||
    markers.some((section) => !isCanonicalSectionType(section) || !sections.includes(section))
  )
    throw new Error("section_marker_topology_mismatch");
  return sections;
}

function attachmentMatchesSlot(row: Attachment, slot: MediaManifestSlot): boolean {
  return (
    row.slot_id === slot.slotId &&
    row.asset_id === slot.assetId &&
    row.mime_type.toLowerCase() === slot.mimeType.toLowerCase() &&
    row.role === slot.role &&
    row.provenance === slot.origin &&
    row.storage_path === slot.storagePath &&
    row.required === (slot.required === true) &&
    row.proof_eligible === slot.proofEligible &&
    row.source_slot_id === (slot.sourceSlotId ?? null) &&
    row.poster_slot_id === (slot.posterSlotId ?? null)
  );
}
export function assertManifestAttachmentParity(
  manifest: ResolvedMediaManifest,
  attachments: Attachment[],
): void {
  if (manifest.slots.length !== attachments.length)
    throw new Error("manifest_attachment_count_mismatch");
  for (const slot of manifest.slots)
    if (attachments.filter((row) => attachmentMatchesSlot(row, slot)).length !== 1)
      throw new Error("manifest_attachment_mismatch");
}

export type AddVideoPlanningSnapshot = {
  version: { id: string; revision: number };
  unifiedBrief: unknown;
  recipe: { id: string | null; version: number | null };
  themeSource: string;
  eligibleSections: Array<{ section: string; markerStart: number }>;
  eligibleStills: Array<{
    slotId: string;
    role: string;
    aspectRatio: number | null;
    width: number | null;
    height: number | null;
    alt: string;
    section: string | null;
  }>;
  contactHidden: boolean;
  businessContext: unknown;
  existingVideoCount: number;
  allowedVideoMaximum: 1;
};

export type AddVideoPlanner = (input: {
  snapshot: AddVideoPlanningSnapshot;
  correction: string | null;
  signal: AbortSignal;
}) => Promise<unknown>;

type AddVideoEligibilityInput = {
  generatorSchemaVersion?: unknown;
  themeSource: string;
  sectionTopology?: unknown;
  unifiedPlan?: unknown;
  manifest: ResolvedMediaManifest;
  attachments: Attachment[];
  contactHidden: boolean;
};

function hostSectionMarkersFromTheme(themeSource: string): string[] {
  const markers = [...themeSource.matchAll(/\bdata-site-section\s*=\s*(["'])([^"']+)\1/g)].map(
    (match) => match[2],
  );
  if (markers.length === 0) throw new Error("no_eligible_section");
  if (new Set(markers).size !== markers.length) throw new Error("section_marker_invalid");
  if (/\bdata-site-section\s*=\s*\{/.test(themeSource)) throw new Error("section_marker_dynamic");
  const eligible = [...new Set(markers)].filter(
    (section) => !LEGACY_BLOCKED_SECTIONS.has(section) && section !== "trustmarkers",
  );
  if (eligible.length === 0) throw new Error("no_eligible_section");
  return eligible;
}

function validateOperationalAnchorRegistry(
  themeSource: string,
  unifiedPlan: unknown,
): CurrentUnifiedOperationalIntent {
  let intent: CurrentUnifiedOperationalIntent;
  try {
    intent = parseCurrentUnifiedPlan(unifiedPlan).operationalIntent;
  } catch {
    throw new Error("operational_anchor_registry_invalid");
  }
  for (const { slug } of intent.operationalAnchors) {
    if ([...themeSource.matchAll(literalMarkerRegex(slug))].length !== 1)
      throw new Error("operational_anchor_marker_invalid");
  }
  return intent;
}

function eligibleAddVideoChoices(input: AddVideoEligibilityInput): {
  sections: string[];
  stills: MediaManifestSlot[];
} {
  const sections =
    input.generatorSchemaVersion === 4
      ? input.unifiedPlan != null
        ? validateOperationalAnchorRegistry(input.themeSource, input.unifiedPlan)
            .operationalAnchors.filter(
              (anchor) =>
                anchor.purposes.includes("media") || anchor.purposes.includes("host-operation"),
            )
            .map((anchor) => anchor.slug)
        : hostSectionMarkersFromTheme(input.themeSource)
      : validateSectionTopology(input.themeSource, input.sectionTopology).filter(
          (section) => !LEGACY_BLOCKED_SECTIONS.has(section),
        );
  assertManifestAttachmentParity(input.manifest, input.attachments);
  if (input.manifest.slots.some((slot) => slot.mimeType.toLowerCase().startsWith("video/")))
    throw new Error("video_already_present");
  if (sections.length === 0) throw new Error("no_eligible_section");
  const stills = input.manifest.slots
    .filter(
      (slot) =>
        slot.origin === "generated" &&
        !slot.proofEligible &&
        slot.mimeType.toLowerCase().startsWith("image/") &&
        slot.mimeType.toLowerCase() !== "image/gif",
    )
    .filter((slot) => input.attachments.some((row) => attachmentMatchesSlot(row, slot)))
    .sort((a, b) => a.slotId.localeCompare(b.slotId));
  if (stills.length === 0) throw new Error("no_eligible_generated_still");
  return { sections, stills };
}

/** Eligibility probe only. Placement is chosen by the injected/model planner in the worker. */
export function selectDeterministicAddVideoPlan(input: AddVideoEligibilityInput): AddVideoPlan {
  const { sections, stills } = eligibleAddVideoChoices(input);
  return {
    targetSection: sections[0]!,
    sourceSlotId: stills[0]!.slotId,
    placement: "inline",
    motionPreset: PRESETS[0]!,
  };
}

function boundedJson(value: unknown, maximum = 20_000): unknown {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length > maximum) throw new Error("planner_snapshot_too_large");
  return JSON.parse(serialized) as unknown;
}

export function buildAddVideoPlanningSnapshot(
  input: AddVideoEligibilityInput & {
    versionId: string;
    revision: number;
    unifiedBrief: unknown;
    recipeId: unknown;
    recipeVersion: unknown;
    businessContext: unknown;
  },
): AddVideoPlanningSnapshot {
  if (input.themeSource.length > 100_000) throw new Error("planner_snapshot_too_large");
  const { sections, stills } = eligibleAddVideoChoices(input);
  const legacySchema = input.generatorSchemaVersion !== 4;
  return {
    version: { id: input.versionId, revision: input.revision },
    unifiedBrief: legacySchema ? boundedJson(input.unifiedBrief) : null,
    recipe: {
      id: legacySchema && typeof input.recipeId === "string" ? input.recipeId.slice(0, 160) : null,
      version:
        legacySchema && Number.isInteger(input.recipeVersion) ? Number(input.recipeVersion) : null,
    },
    themeSource: input.themeSource,
    eligibleSections: sections.map((section) => ({
      section,
      markerStart: input.themeSource.search(literalMarkerRegex(section)),
    })),
    eligibleStills: stills.map((slot) => ({
      slotId: slot.slotId,
      role: slot.role,
      aspectRatio: slot.width && slot.height ? slot.width / slot.height : null,
      width: slot.width ?? null,
      height: slot.height ?? null,
      alt: slot.alt.slice(0, 500),
      section: slot.targetSection ?? null,
    })),
    contactHidden: input.contactHidden,
    businessContext: legacySchema ? boundedJson(input.businessContext, 8_000) : null,
    existingVideoCount: 0,
    allowedVideoMaximum: 1,
  };
}

export function validateAddVideoPlan(
  output: unknown,
  snapshot: AddVideoPlanningSnapshot,
): AddVideoPlan {
  if (!isRecord(output)) throw new Error("planner_output_not_object");
  const keys = Object.keys(output).sort();
  if (keys.join(",") !== "motionPreset,placement,sourceSlotId,targetSection")
    throw new Error("planner_output_not_closed");
  if (typeof output.targetSection !== "string") throw new Error("planner_target_section_invalid");
  if (!snapshot.eligibleSections.some((item) => item.section === output.targetSection))
    throw new Error("planner_target_section_ineligible");
  if (
    typeof output.sourceSlotId !== "string" ||
    !snapshot.eligibleStills.some((item) => item.slotId === output.sourceSlotId)
  )
    throw new Error("planner_source_slot_ineligible");
  if (output.placement !== "inline") throw new Error("planner_placement_invalid");
  if (
    typeof output.motionPreset !== "string" ||
    !PRESETS.includes(output.motionPreset as MediaManifestMotionPreset)
  )
    throw new Error("planner_motion_preset_invalid");
  return {
    targetSection: output.targetSection,
    sourceSlotId: output.sourceSlotId,
    placement: "inline",
    motionPreset: output.motionPreset as MediaManifestMotionPreset,
  };
}

const PLAN_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_add_video_plan",
    description: "Submit one closed Add video placement plan.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["targetSection", "sourceSlotId", "placement", "motionPreset"],
      properties: {
        targetSection: { type: "string" },
        sourceSlotId: { type: "string" },
        placement: { type: "string", enum: ["inline"] },
        motionPreset: { type: "string", enum: PRESETS },
      },
    },
  },
};

export const lovableAddVideoPlanner: AddVideoPlanner = async ({ snapshot, correction, signal }) => {
  const result = await streamChatCompletion({
    signal,
    tools: [PLAN_TOOL],
    messages: [
      {
        role: "system",
        content:
          "Choose one eligible section and still for decorative atmospheric motion. Call submit_add_video_plan exactly once. Use only values in the snapshot; do not redesign the page or author a video-provider prompt.",
      },
      {
        role: "user",
        content: JSON.stringify({
          snapshot,
          ...(correction ? { validationFeedback: correction } : {}),
        }),
      },
    ],
    onToken: () => {},
  });
  if (result.toolCalls.length !== 1 || result.toolCalls[0]!.name !== PLAN_TOOL.function.name)
    throw new Error("planner_output_missing");
  if (result.toolCalls[0]!.arguments.length > 4_000) throw new Error("planner_output_too_large");
  try {
    return JSON.parse(result.toolCalls[0]!.arguments) as unknown;
  } catch {
    throw new Error("planner_output_invalid_json");
  }
};

export async function requestAcceptedAddVideoPlan(
  planner: AddVideoPlanner,
  snapshot: AddVideoPlanningSnapshot,
  signal: AbortSignal,
): Promise<AddVideoPlan> {
  try {
    const output = await planner({ snapshot, correction: null, signal });
    return validateAddVideoPlan(output, snapshot);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const invalidOutput =
      code.startsWith("planner_output_") ||
      code.startsWith("planner_target_") ||
      code.startsWith("planner_source_") ||
      code.startsWith("planner_placement_") ||
      code.startsWith("planner_motion_");
    if (!invalidOutput) throw error;
    throw new Error("planner_output_rejected");
  }
}
export function stableVideoSlotId(jobId: string): string {
  return "add-video-" + canonicalHash(jobId).slice(0, 20);
}

function openingTagEnd(source: string, markerIndex: number): number {
  const start = source.lastIndexOf("<", markerIndex);
  if (start < 0) throw new Error("section_marker_not_in_jsx_tag");
  let quote = "";
  let braces = 0;
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i]!;
    if (quote) {
      if (char === quote && source[i - 1] !== "\\") quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") braces += 1;
    else if (char === "}") braces -= 1;
    else if (char === ">" && braces === 0) {
      if (/\/\s*>$/.test(source.slice(start, i + 1))) throw new Error("section_root_self_closing");
      return i + 1;
    }
  }
  throw new Error("section_marker_unterminated_tag");
}
export function insertVideoIntoSection(
  themeSource: string,
  plan: AddVideoPlan,
  videoSlotId: string,
): string {
  const matches = [...themeSource.matchAll(literalMarkerRegex(plan.targetSection))];
  if (matches.length !== 1 || matches[0]!.index == null) throw new Error("section_marker_invalid");
  if (
    new RegExp("<Media\\b[^>]*\\bslotId\\s*=\\s*([\"'])" + escapeRegex(videoSlotId) + "\\1").test(
      themeSource,
    )
  )
    throw new Error("video_slot_already_referenced");
  const insertion = openingTagEnd(themeSource, matches[0]!.index);
  const media = '\n      <Media slotId="' + videoSlotId + '" motion="desktop" lazy />';
  return themeSource.slice(0, insertion) + media + themeSource.slice(insertion);
}

export function validateAddVideoCandidate(input: {
  previousConfig: RecordValue;
  nextConfig: RecordValue;
  nextAttachments: Attachment[];
  plan: AddVideoPlan;
  videoSlotId: string;
}): string {
  if (
    input.previousConfig.generatorSchemaVersion !== 4 ||
    input.nextConfig.generatorSchemaVersion !== 4
  )
    throw new Error("unsupported_manifest_version");
  const parsed = parseMediaManifest(4, input.nextConfig.mediaManifest);
  if (!parsed.ok) throw new Error("invalid_media_manifest");
  const video = parsed.manifest.slots.find((slot) => slot.slotId === input.videoSlotId);
  if (
    !video ||
    video.mimeType.toLowerCase() !== "video/mp4" ||
    video.sourceSlotId !== input.plan.sourceSlotId ||
    video.posterSlotId !== input.plan.sourceSlotId ||
    video.targetSection !== input.plan.targetSection ||
    !input.nextAttachments.some((row) => attachmentMatchesSlot(row, video))
  )
    throw new Error("candidate_video_binding_invalid");
  const source = String(input.nextConfig.themeSource ?? "");
  if (
    !new RegExp(
      "<Media\\b[^>]*\\bslotId\\s*=\\s*([\"'])" + escapeRegex(input.videoSlotId) + "\\1",
    ).test(source)
  )
    throw new Error("candidate_video_reference_missing");
  return canonicalHash(input.nextConfig);
}

export async function attestMp4(bytes: Uint8Array, parser?: Mp4Parser): Promise<Mp4Attestation> {
  if (!parser) throw new Error(ADD_VIDEO_MP4_PARSER_UNAVAILABLE);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MP4_BYTES)
    throw new Error("mp4_size_invalid");
  if (bytes.byteLength < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp")
    throw new Error("mp4_container_invalid");
  const parsed = await parser.inspect(bytes);
  if (parsed.videoCodec !== "h264" || !parsed.videoProfile.trim())
    throw new Error("mp4_codec_invalid");
  if (parsed.durationMs < 3000 || parsed.durationMs > 5000) throw new Error("mp4_duration_invalid");
  if (parsed.width <= 0 || parsed.height <= 0) throw new Error("mp4_dimensions_invalid");
  // Audio is never played; silent output is preferred, but an encoded track is accepted and remains muted.
  if (parsed.hasAudio && !parsed.audioCodec?.trim()) throw new Error("mp4_audio_invalid");
  return {
    ...parsed,
    byteSize: bytes.byteLength,
    validatorVersion: parser.version,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
function payloadRecord(value: Json): RecordValue {
  return isRecord(value) ? value : {};
}

export type AddVideoStage =
  | "planning/call"
  | "media/source-verify"
  | "media/create"
  | "media/poll"
  | "media/materialize"
  | "composition/build"
  | "validation/run"
  | "persistence/commit";

const ADD_VIDEO_STAGES: readonly AddVideoStage[] = [
  "planning/call",
  "media/source-verify",
  "media/create",
  "media/poll",
  "media/materialize",
  "composition/build",
  "validation/run",
  "persistence/commit",
];

function addVideoStage(payload: RecordValue): AddVideoStage {
  return typeof payload.addVideoStage === "string" &&
    ADD_VIDEO_STAGES.includes(payload.addVideoStage as AddVideoStage)
    ? (payload.addVideoStage as AddVideoStage)
    : "planning/call";
}

function assertSafeAddVideoCheckpoint(value: RecordValue): void {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 2 * 1024 * 1024)
    throw new Error("add_video_checkpoint_too_large");
  if (/data:[^;]+;base64,|"body"\s*:/.test(serialized))
    throw new Error("add_video_checkpoint_media_bytes_forbidden");
}

async function yieldAddVideoStage(input: {
  supabase: Admin;
  job: BackgroundJobRow;
  expectedStage: AddVideoStage;
  nextStage: AddVideoStage;
  checkpoint?: RecordValue;
  retryAt?: string;
  progressPct: number;
  statusMessage: string;
}): Promise<AddVideoDisposition> {
  if (addVideoAbsoluteDeadlineExceeded(input.job))
    return { kind: "fail", reasonCode: "total_deadline_exceeded" };
  if (!input.job.locked_by || input.job.claim_epoch <= 0)
    return { kind: "fail", reasonCode: "invalid_add_video_claim_fence" };
  assertSafeAddVideoCheckpoint(input.checkpoint ?? {});
  const { data, error } = await input.supabase.rpc("yield_add_video_stage", {
    p_job_id: input.job.id,
    p_website_id: requireWebsiteId(input.job),
    p_job_attempts: input.job.attempts,
    p_claim_epoch: input.job.claim_epoch,
    p_runner_id: input.job.locked_by,
    p_expected_stage: input.expectedStage,
    p_next_stage: input.nextStage,
    p_checkpoint_patch: (input.checkpoint ?? {}) as Json,
    p_retry_at: (input.retryAt ?? null) as unknown as string,
    p_progress_pct: input.progressPct,
    p_status_message: input.statusMessage,
  });
  if (error || data !== true) return { kind: "retry", reasonCode: "add_video_stage_yield_failed" };
  return { kind: "yield" };
}

function persistedPlan(payload: RecordValue, snapshot: AddVideoPlanningSnapshot): AddVideoPlan {
  const plan = validateAddVideoPlan(payload.plan, snapshot);
  if (typeof payload.planHash !== "string" || payload.planHash !== canonicalHash(plan))
    throw new Error("plan_hash_mismatch");
  if (typeof payload.videoSlotId !== "string" || payload.videoSlotId.length === 0)
    throw new Error("checkpointed_video_slot_missing");
  return plan;
}

function reason(error: unknown): string {
  const value = error instanceof Error ? error.message : "add_video_failed";
  return /^[a-z0-9_]{1,80}$/.test(value) ? value : "add_video_failed";
}

class AddVideoFinalizerRetryError extends Error {
  override name = "AddVideoFinalizerRetryError";
}

function isTransientDatabaseError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  return /^(08|53|57P|58)/.test(code) || ["40001", "40P01", "55P03"].includes(code);
}

export async function commitAddVideoToVersionIfAvailable(
  supabase: Admin,
  args: {
    jobId: string;
    jobAttempts: number;
    claimEpoch?: number;
    runnerId?: string;
    websiteId: string;
    targetVersionId: string;
    expectedRevision: number;
    candidateHash: string;
    config: RecordValue;
    readySlotId: string;
    editEvent: RecordValue;
  },
): Promise<{ revision: number } | null> {
  if (args.claimEpoch == null || !args.runnerId)
    throw new Error("add_video_finalizer_claim_fence_missing");
  const rpcName = "commit_add_video_to_version_epoch";
  const { data, error } = await callSupabaseRpc(supabase, rpcName, {
    p_job_id: args.jobId,
    p_job_attempts: args.jobAttempts,
    p_claim_epoch: args.claimEpoch,
    p_runner_id: args.runnerId,
    p_website_id: args.websiteId,
    p_target_version_id: args.targetVersionId,
    p_expected_revision: args.expectedRevision,
    p_candidate_hash: args.candidateHash,
    p_config_json: args.config,
    p_media_slot_id: args.readySlotId,
    p_edit_event_payload: args.editEvent,
  });
  if (error?.code === "42883" || error?.message?.includes("commit_add_video_to_version"))
    return null;
  if (error?.message?.includes("Website version revision conflict")) {
    throw new Error("revision_conflict");
  }
  if (error && isTransientDatabaseError(error))
    throw new AddVideoFinalizerRetryError("add_video_finalizer_transient");
  if (error) throw new Error("add_video_finalizer_failed");
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row) || !Number.isInteger(Number(row.revision)))
    throw new Error("add_video_finalizer_invalid_result");
  return { revision: Number(row.revision) };
}

export type AddVideoWorkerDeps = {
  planner?: AddVideoPlanner;
  createClip?: typeof createClipOperation;
  pollClip?: typeof pollClipOperation;
  downloadClip?: typeof downloadClipOperation;
  loadSourceBytes?: typeof loadOurImageBytes;
  persistBytes?: typeof persistGeneratedBytes;
  parser?: Mp4Parser;
  now?: () => Date;
};

const ADD_VIDEO_PROGRESS = {
  preparing: [10, "Preparing this design…"],
  choosing: [22, "Choosing where video will help…"],
  source: [38, "Preparing the source image…"],
  creating: [55, "Creating video…"],
  updating: [72, "Updating the selected section…"],
  saving: [95, "Saving the video…"],
} as const;

function persistableAddVideoCandidate(config: RecordValue, readyLedgerId: string) {
  const persistConfig = { ...config };
  delete persistConfig.bucket1ValidationInput;
  delete persistConfig.bucket1ValidationAttestation;
  delete persistConfig.validationAttestation;
  return {
    validatedCandidate: {
      config: persistConfig,
      candidateHash: bucket1CandidateConfigHash(persistConfig),
      readyLedgerId,
    },
  };
}

function videoPrompt(plan: AddVideoPlan): string {
  return [
    "Create a four-second silent decorative brand-atmosphere clip from the supplied still.",
    "Keep the subject, materials, lighting, and composition truthful; do not invent completed work or people.",
    `Use ${plan.motionPreset} motion suitable for the ${plan.targetSection} section.`,
  ].join(" ");
}

function videoAttachment(
  job: BackgroundJobRow,
  slotId: string,
  sourceSlotId: string,
  ledger: GenerationMediaLedgerRow,
): Attachment {
  if (!ledger.asset_id || !ledger.mime_type || !ledger.storage_path)
    throw new Error("ready_video_metadata_missing");
  return {
    version_id: job.target_version_id!,
    website_id: requireWebsiteId(job),
    slot_id: slotId,
    asset_id: ledger.asset_id,
    mime_type: ledger.mime_type,
    role: ledger.role,
    provenance: ledger.provenance,
    required: ledger.required,
    proof_eligible: ledger.proof_eligible,
    storage_path: ledger.storage_path,
    source_slot_id: sourceSlotId,
    poster_slot_id: sourceSlotId,
  };
}

export type AddVideoProviderFailureDecision = {
  ledgerAction: "settle_failed" | "preserve_generating";
  effectCertainty: GenerationMediaEffectCertainty;
  disposition: "retry" | "fail" | "indeterminate";
};

/** Classify the provider effect before any worker exit can strand the claimed slot. */
export function classifyAddVideoProviderFailure(input: {
  disposition: "retryable" | "terminal" | "fatal" | "indeterminate" | undefined;
  hasDurableOperation: boolean;
  deadlineExceeded: boolean;
}): AddVideoProviderFailureDecision {
  if (input.deadlineExceeded) {
    return {
      ledgerAction: "settle_failed",
      effectCertainty:
        input.hasDurableOperation || input.disposition === "indeterminate"
          ? "indeterminate"
          : "not_started",
      disposition: "fail",
    };
  }
  if (input.disposition === "retryable" && input.hasDurableOperation) {
    return {
      ledgerAction: "preserve_generating",
      effectCertainty: "indeterminate",
      disposition: "retry",
    };
  }
  if (input.disposition === "indeterminate") {
    return {
      ledgerAction: "settle_failed",
      effectCertainty: "indeterminate",
      disposition: "indeterminate",
    };
  }
  if (input.disposition === "fatal") {
    return {
      ledgerAction: "settle_failed",
      effectCertainty: input.hasDurableOperation ? "indeterminate" : "not_started",
      disposition: "fail",
    };
  }
  return {
    ledgerAction: "settle_failed",
    effectCertainty: "definite_failure",
    disposition: "retry",
  };
}

type AddVideoMediaReservation = {
  reservationId: string;
  createOrdinal: number;
  idempotencyKey: string;
};
type AddVideoLedgerRpc = (
  name: string,
  values: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

function addVideoLedgerRpc(supabase: Admin): AddVideoLedgerRpc {
  return (name, values) => callSupabaseRpc(supabase, name, values);
}

async function adoptAddVideoMediaSlot(input: {
  supabase: Admin;
  job: BackgroundJobRow;
  slotId: string;
  sourceSlotId: string;
}): Promise<string> {
  const { data, error } = await addVideoLedgerRpc(input.supabase)(
    "claim_add_video_media_slot_epoch",
    {
      p_job_id: input.job.id,
      p_website_id: requireWebsiteId(input.job),
      p_job_attempts: input.job.attempts,
      p_claim_epoch: input.job.claim_epoch,
      p_runner_id: input.job.locked_by,
      p_slot_id: input.slotId,
      p_kind: "video",
      p_role: "atmosphere",
      p_provenance: "generated",
      p_required: true,
      p_proof_eligible: false,
      p_source_slot_id: input.sourceSlotId,
      p_poster_slot_id: input.sourceSlotId,
    },
  );
  if (error || typeof data !== "string") {
    const failure = new Error(error?.message ?? "Unable to adopt Add Video media slot");
    failure.name = "MediaClaimError";
    throw failure;
  }
  return data;
}

async function reserveAddVideoMediaCreate(input: {
  supabase: Admin;
  job: BackgroundJobRow;
  slotId: string;
  requestHash: string;
}): Promise<AddVideoMediaReservation> {
  const { data, error } = await addVideoLedgerRpc(input.supabase)(
    "reserve_add_video_media_create_epoch",
    {
      p_job_id: input.job.id,
      p_website_id: requireWebsiteId(input.job),
      p_job_attempts: input.job.attempts,
      p_claim_epoch: input.job.claim_epoch,
      p_runner_id: input.job.locked_by,
      p_slot_id: input.slotId,
      p_provider: "lovable-video",
      p_request_hash: input.requestHash,
    },
  );
  if (error || !isRecord(data) || typeof data.reservationId !== "string") {
    const failure = new Error(error?.message ?? "Provider create reservation is unavailable");
    failure.name =
      error?.code === "42883"
        ? "AddVideoLedgerCompatibilityError"
        : error?.code === "53000" || error?.message?.includes("concurrency cap")
          ? "MediaProviderCapacityError"
          : error?.message?.includes("create budget")
            ? "MediaCreateBudgetError"
            : "MediaClaimError";
    throw failure;
  }
  const createOrdinal = Number(data.createOrdinal);
  if (
    !Number.isInteger(createOrdinal) ||
    createOrdinal < 1 ||
    createOrdinal > 2 ||
    typeof data.idempotencyKey !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.idempotencyKey)
  )
    throw new Error("add_video_media_reservation_invalid");
  return { reservationId: data.reservationId, createOrdinal, idempotencyKey: data.idempotencyKey };
}

async function recordAddVideoMediaOperation(input: {
  supabase: Admin;
  job: BackgroundJobRow;
  slotId: string;
  reservationId: string;
  operationId: string;
}): Promise<void> {
  const { data, error } = await addVideoLedgerRpc(input.supabase)(
    "record_add_video_media_operation_epoch",
    {
      p_job_id: input.job.id,
      p_website_id: requireWebsiteId(input.job),
      p_job_attempts: input.job.attempts,
      p_claim_epoch: input.job.claim_epoch,
      p_runner_id: input.job.locked_by,
      p_slot_id: input.slotId,
      p_reservation_id: input.reservationId,
      p_provider_operation_id: input.operationId,
    },
  );
  if (error || data !== true) {
    const failure = new Error("Unable to persist Add Video provider operation");
    failure.name = "MediaClaimError";
    throw failure;
  }
}

async function settleAddVideoMediaSlot(input: {
  supabase: Admin;
  job: BackgroundJobRow;
  slotId: string;
  status: "failed" | "abandoned";
  reservationId?: string;
  operationId?: string;
  errorMessage: string;
  effectCertainty: GenerationMediaEffectCertainty;
}): Promise<void> {
  const { data, error } = await addVideoLedgerRpc(input.supabase)(
    "settle_add_video_media_slot_epoch",
    {
      p_job_id: input.job.id,
      p_website_id: requireWebsiteId(input.job),
      p_job_attempts: input.job.attempts,
      p_claim_epoch: input.job.claim_epoch,
      p_runner_id: input.job.locked_by,
      p_slot_id: input.slotId,
      p_reservation_id: input.reservationId ?? null,
      p_provider_operation_id: input.operationId ?? null,
      p_status: input.status,
      p_error_message: input.errorMessage,
      p_effect_certainty: input.effectCertainty,
    },
  );
  if (error || data !== true) {
    const failure = new Error("Unable to settle Add Video media slot");
    failure.name = error?.code === "42883" ? "AddVideoLedgerCompatibilityError" : "MediaClaimError";
    throw failure;
  }
}

async function recordReadyAddVideoMedia(input: {
  supabase: Admin;
  job: BackgroundJobRow;
  slotId: string;
  reservationId?: string;
  operationId?: string;
  storagePath: string;
  sourceSlotId: string;
  attestation: Mp4Attestation;
}): Promise<string> {
  const { data, error } = await addVideoLedgerRpc(input.supabase)(
    "record_ready_add_video_media_epoch",
    {
      p_job_id: input.job.id,
      p_website_id: requireWebsiteId(input.job),
      p_job_attempts: input.job.attempts,
      p_claim_epoch: input.job.claim_epoch,
      p_runner_id: input.job.locked_by,
      p_slot_id: input.slotId,
      p_reservation_id: input.reservationId ?? null,
      p_provider_operation_id: input.operationId ?? null,
      p_storage_path: input.storagePath,
      p_source_slot_id: input.sourceSlotId,
      p_content_hash: input.attestation.contentHash,
      p_byte_size: input.attestation.byteSize,
      p_duration_ms: input.attestation.durationMs,
      p_width: input.attestation.width,
      p_height: input.attestation.height,
      p_video_codec: input.attestation.videoCodec,
      p_video_profile: input.attestation.videoProfile,
      p_has_audio: input.attestation.hasAudio,
      p_audio_codec: input.attestation.audioCodec,
      p_validator_version: input.attestation.validatorVersion,
    },
  );
  if (error || typeof data !== "string") {
    const failure = new Error("Unable to record ready Add Video media");
    failure.name = error?.code === "42883" ? "AddVideoLedgerCompatibilityError" : "MediaClaimError";
    throw failure;
  }
  return data;
}

export async function executeAddVideoJob(
  supabase: Admin,
  job: BackgroundJobRow,
  deps: AddVideoWorkerDeps = {},
  invocationSignal?: AbortSignal,
): Promise<AddVideoDisposition> {
  if (addVideoAbsoluteDeadlineExceeded(job))
    return { kind: "fail", reasonCode: "total_deadline_exceeded" };
  const cancellation = watchJobCancellation(async () => {
    const { data } = await supabase
      .from("background_jobs")
      .select("id")
      .eq("id", job.id)
      .eq("status", "running")
      .eq("attempts", job.attempts)
      .eq("claim_epoch", job.claim_epoch)
      .eq("locked_by", job.locked_by ?? "")
      .maybeSingle();
    return Boolean(data);
  });
  const deadlineAt = Date.parse(job.created_at) + ADD_VIDEO_TOTAL_DEADLINE_MS;
  const timeout = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
  const signal = invocationSignal
    ? AbortSignal.any([invocationSignal, cancellation.signal, timeout])
    : AbortSignal.any([cancellation.signal, timeout]);
  try {
    if (!job.target_version_id || !job.source_version_id || !job.request_id)
      return { kind: "fail", reasonCode: "invalid_job_identity" };
    const payload = payloadRecord(job.payload_json),
      stage = addVideoStage(payload),
      expectedRevision = Number(payload.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0)
      return { kind: "fail", reasonCode: "invalid_expected_revision" };
    if (stage === "persistence/commit" && isRecord(job.result_json)) {
      const result = job.result_json;
      if (
        result.status === "completed" &&
        result.targetVersionId === job.target_version_id &&
        Number.isInteger(Number(result.revision)) &&
        typeof (result.targetSection ?? result.selectedSectionType) === "string" &&
        typeof (result.videoSlotId ?? result.slotId) === "string" &&
        typeof result.candidateHash === "string"
      ) {
        return {
          kind: "complete",
          result: {
            targetVersionId: result.targetVersionId,
            revision: Number(result.revision),
            targetSection: (result.targetSection ?? result.selectedSectionType) as string,
            videoSlotId: (result.videoSlotId ?? result.slotId) as string,
            candidateHash: result.candidateHash,
          },
        };
      }
    }
    const { data: version, error: versionError } = await supabase
      .from("website_versions")
      .select("config_json, revision, status")
      .eq("id", job.target_version_id)
      .eq("website_id", requireWebsiteId(job))
      .single();
    if (versionError || !version) return { kind: "fail", reasonCode: "target_version_unavailable" };
    if (
      stage !== "persistence/commit" &&
      (!["draft", "selected"].includes(version.status) || version.revision !== expectedRevision)
    )
      return { kind: "fail", reasonCode: "revision_conflict" };
    if (!isRecord(version.config_json))
      return { kind: "fail", reasonCode: "invalid_version_config" };
    const config = version.config_json;
    if (config.generatorSchemaVersion !== 4)
      return { kind: "fail", reasonCode: "unsupported_manifest_version" };
    const parsed = parseMediaManifest(4, config.mediaManifest);
    if (!parsed.ok) return { kind: "fail", reasonCode: "invalid_media_manifest" };
    const { data: attachments, error: attachmentError } = await supabase
      .from("website_version_media_slots")
      .select("*")
      .eq("website_id", requireWebsiteId(job))
      .eq("version_id", job.target_version_id);
    if (attachmentError || !attachments)
      return { kind: "retry", reasonCode: "attachment_read_failed" };
    const snapshot = buildAddVideoPlanningSnapshot({
      versionId: job.target_version_id,
      revision: expectedRevision,
      generatorSchemaVersion: 4,
      themeSource: typeof config.themeSource === "string" ? config.themeSource : "",
      unifiedPlan: config.unifiedPlan,
      manifest: parsed.manifest,
      attachments,
      contactHidden: config.contactHidden === true,
      unifiedBrief: null,
      recipeId: null,
      recipeVersion: null,
      businessContext: null,
    });
    if (stage === "planning/call") {
      try {
        const output = await (deps.planner ?? lovableAddVideoPlanner)({
          snapshot,
          correction:
            typeof payload.plannerCorrection === "string" ? payload.plannerCorrection : null,
          signal,
        });
        const plan = validateAddVideoPlan(output, snapshot);
        return yieldAddVideoStage({
          supabase,
          job,
          expectedStage: stage,
          nextStage: "media/source-verify",
          checkpoint: {
            plan,
            planHash: canonicalHash(plan),
            videoSlotId: stableVideoSlotId(job.id),
            plannerAttempt: Number(payload.plannerAttempt ?? 0) + 1,
            plannerCorrection: null,
          },
          progressPct: 22,
          statusMessage: "Video plan accepted",
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        const code = reason(error);
        return {
          kind: "fail",
          reasonCode: code.startsWith("planner_") ? "planner_output_rejected" : code,
        };
      }
    }
    const plan = persistedPlan(payload, snapshot),
      videoSlotId = payload.videoSlotId as string;
    const sourceSlot = parsed.manifest.slots.find((slot) => slot.slotId === plan.sourceSlotId),
      sourceAttachment = attachments.find((row) => row.slot_id === plan.sourceSlotId);
    if (!sourceSlot?.storagePath || !sourceAttachment)
      return { kind: "fail", reasonCode: "source_still_unavailable" };
    if (stage === "media/source-verify") {
      const loadedSource = await (deps.loadSourceBytes ?? loadOurImageBytes)({
        storagePath: sourceSlot.storagePath,
        bucket: "site-media",
        websiteId: requireWebsiteId(job),
        supabase,
        signal,
      });
      if (!loadedSource) return { kind: "retry", reasonCode: "source_still_download_failed" };
      const sourceHash = createHash("sha256").update(loadedSource.bytes).digest("hex");
      if (
        loadedSource.mimeType.toLowerCase() !== sourceSlot.mimeType.toLowerCase() ||
        loadedSource.mimeType.toLowerCase() !== sourceAttachment.mime_type.toLowerCase()
      )
        return { kind: "fail", reasonCode: "source_still_mime_mismatch" };
      if (sourceHash !== sourceSlot.assetId || sourceHash !== sourceAttachment.asset_id)
        return { kind: "fail", reasonCode: "source_still_hash_mismatch" };
      return yieldAddVideoStage({
        supabase,
        job,
        expectedStage: stage,
        nextStage: "media/create",
        checkpoint: {
          sourceVerification: {
            assetId: sourceHash,
            storagePath: sourceSlot.storagePath,
            mimeType: loadedSource.mimeType,
            byteSize: loadedSource.bytes.byteLength,
          },
        },
        progressPct: 36,
        statusMessage: "Source image verified",
      });
    }
    if (["media/create", "media/poll", "media/materialize"].includes(stage)) {
      await adoptAddVideoMediaSlot({
        supabase,
        job,
        slotId: videoSlotId,
        sourceSlotId: plan.sourceSlotId,
      });
    }
    let ledger = await loadGenerationMediaSlot({
      supabase,
      websiteId: requireWebsiteId(job),
      jobClaim: {
        id: job.id,
        attempts: job.attempts,
        claimEpoch: job.claim_epoch,
        runnerId: job.locked_by!,
      },
      slotId: videoSlotId,
    });
    if (!ledger) return { kind: "retry", reasonCode: "media_ledger_read_failed" };
    if (stage === "media/create") {
      const sourceVerification = isRecord(payload.sourceVerification)
        ? payload.sourceVerification
        : null;
      if (
        sourceVerification?.assetId !== sourceSlot.assetId ||
        sourceVerification.storagePath !== sourceSlot.storagePath ||
        String(sourceVerification.mimeType).toLowerCase() !== sourceSlot.mimeType.toLowerCase() ||
        !Number.isInteger(Number(sourceVerification.byteSize)) ||
        Number(sourceVerification.byteSize) < 1
      )
        return { kind: "fail", reasonCode: "source_verification_checkpoint_invalid" };
      if (ledger.status === "ready")
        return yieldAddVideoStage({
          supabase,
          job,
          expectedStage: stage,
          nextStage: "composition/build",
          checkpoint: { readyLedgerId: ledger.id },
          progressPct: 72,
          statusMessage: "Video ready",
        });
      if (ledger.status !== "generating" || ledger.claim_attempt !== job.attempts)
        return { kind: "fail", reasonCode: "media_slot_not_resumable" };
      if (ledger.provider_operation_id)
        return yieldAddVideoStage({
          supabase,
          job,
          expectedStage: stage,
          nextStage: "media/poll",
          checkpoint: { providerOperationId: ledger.provider_operation_id },
          progressPct: 55,
          statusMessage: "Video provider operation recovered",
        });
      const sourceImageUrl = supabase.storage
        .from("site-media")
        .getPublicUrl(sourceSlot.storagePath).data.publicUrl;
      if (!sourceImageUrl) return { kind: "fail", reasonCode: "source_public_url_unavailable" };
      let reservation: AddVideoMediaReservation;
      if (ledger.provider_reservation_id && ledger.provider_idempotency_key) {
        reservation = {
          reservationId: ledger.provider_reservation_id,
          createOrdinal: ledger.provider_create_count,
          idempotencyKey: ledger.provider_idempotency_key,
        };
      } else {
        try {
          reservation = await reserveAddVideoMediaCreate({
            supabase,
            job,
            slotId: videoSlotId,
            requestHash: canonicalHash({
              prompt: videoPrompt(plan),
              sourceHash: sourceSlot.assetId,
              durationSeconds: 4,
            }),
          });
        } catch (error) {
          return error instanceof Error && error.name === "MediaCreateBudgetError"
            ? { kind: "fail", reasonCode: "provider_create_budget_exhausted" }
            : { kind: "retry", reasonCode: "provider_capacity_saturated" };
        }
      }
      const created: VideoProviderCreateResult = await (deps.createClip ?? createClipOperation)({
        prompt: videoPrompt(plan),
        sourceImageUrl,
        durationSeconds: 4,
        idempotencyKey: reservation.idempotencyKey,
        signal,
        deadlineAt,
      });
      if (!created.ok) {
        const decision = classifyAddVideoProviderFailure({
          disposition: created.disposition,
          hasDurableOperation: false,
          deadlineExceeded: Date.now() >= deadlineAt,
        });
        await settleAddVideoMediaSlot({
          supabase,
          job,
          slotId: videoSlotId,
          reservationId: reservation.reservationId,
          status: "failed",
          errorMessage: created.reason,
          effectCertainty: decision.effectCertainty,
        });
        return decision.disposition === "indeterminate"
          ? { kind: "indeterminate", reasonCode: "provider_create_indeterminate" }
          : created.disposition === "fatal"
            ? { kind: "fail", reasonCode: reason(new Error(created.reason)) }
            : { kind: "retry", reasonCode: reason(new Error(created.reason)) };
      }
      try {
        await recordAddVideoMediaOperation({
          supabase,
          job,
          slotId: videoSlotId,
          reservationId: reservation.reservationId,
          operationId: created.operationId,
        });
      } catch {
        await settleAddVideoMediaSlot({
          supabase,
          job,
          slotId: videoSlotId,
          reservationId: reservation.reservationId,
          operationId: created.operationId,
          status: "failed",
          errorMessage: "provider_operation_persistence_failed",
          effectCertainty: "indeterminate",
        }).catch(() => undefined);
        return { kind: "indeterminate", reasonCode: "provider_operation_persistence_failed" };
      }
      return yieldAddVideoStage({
        supabase,
        job,
        expectedStage: stage,
        nextStage: "media/poll",
        checkpoint: { providerOperationId: created.operationId },
        progressPct: 55,
        statusMessage: "Video creation started",
      });
    }
    const operationId =
      typeof payload.providerOperationId === "string"
        ? payload.providerOperationId
        : ledger.provider_operation_id;
    if (!operationId) return { kind: "fail", reasonCode: "provider_operation_missing" };
    if (stage === "media/poll") {
      const polled = await (deps.pollClip ?? pollClipOperation)({
        operationId,
        signal,
        deadlineAt,
      });
      if (!polled.ok) {
        if (polled.disposition === "terminal") {
          await settleAddVideoMediaSlot({
            supabase,
            job,
            slotId: videoSlotId,
            reservationId: ledger.provider_reservation_id ?? void 0,
            operationId,
            status: "failed",
            errorMessage: polled.reason,
            effectCertainty: "definite_failure",
          });
          return ledger.provider_create_count < 2
            ? yieldAddVideoStage({
                supabase,
                job,
                expectedStage: stage,
                nextStage: "media/create",
                progressPct: 55,
                statusMessage: "Retrying video creation",
              })
            : {
                kind: "fail",
                reasonCode: "provider_create_budget_exhausted",
              };
        }
        return {
          kind: "retry",
          reasonCode: reason(new Error(polled.reason)),
        };
      }
      return yieldAddVideoStage({
        supabase,
        job,
        expectedStage: stage,
        nextStage: polled.status === "completed" ? "media/materialize" : "media/poll",
        retryAt: polled.status === "pending" ? polled.retryAt : void 0,
        progressPct: 55,
        statusMessage:
          polled.status === "completed"
            ? "Video creation complete"
            : "Video is still being created",
      });
    }
    if (stage === "media/materialize") {
      if (ledger.status === "ready")
        return yieldAddVideoStage({
          supabase,
          job,
          expectedStage: stage,
          nextStage: "composition/build",
          checkpoint: { readyLedgerId: ledger.id },
          progressPct: 72,
          statusMessage: "Video materialization already recorded",
        });
      const downloaded = await (deps.downloadClip ?? downloadClipOperation)({
        operationId,
        signal,
        deadlineAt,
      });
      if (!downloaded.ok)
        return downloaded.disposition === "fatal" || downloaded.disposition === "terminal"
          ? {
              kind: "fail",
              reasonCode: downloaded.reason,
            }
          : {
              kind: "retry",
              reasonCode: downloaded.reason,
            };
      if (downloaded.mimeType.toLowerCase() !== "video/mp4")
        return {
          kind: "fail",
          reasonCode: "provider_video_mime_invalid",
        };
      const attestation = await attestMp4(downloaded.bytes, deps.parser ?? mp4BoxParser);
      const persisted = await (deps.persistBytes ?? persistGeneratedBytes)(
        requireWebsiteId(job),
        downloaded.bytes,
        "video/mp4",
        "Decorative brand atmosphere",
        supabase,
        void 0,
        signal,
      );
      if (!persisted?.storagePath || persisted.contentHash !== attestation.contentHash) {
        await settleAddVideoMediaSlot({
          supabase,
          job,
          slotId: videoSlotId,
          reservationId: ledger.provider_reservation_id ?? void 0,
          operationId,
          status: "failed",
          errorMessage: "video_persistence_failed",
          effectCertainty: "definite_success",
        });
        return {
          kind: "indeterminate",
          reasonCode: "video_persistence_failed",
        };
      }
      return yieldAddVideoStage({
        supabase,
        job,
        expectedStage: stage,
        nextStage: "composition/build",
        checkpoint: {
          readyLedgerId: await recordReadyAddVideoMedia({
            supabase,
            job,
            slotId: videoSlotId,
            reservationId: ledger.provider_reservation_id ?? void 0,
            operationId,
            storagePath: persisted.storagePath,
            sourceSlotId: plan.sourceSlotId,
            attestation,
          }),
        },
        progressPct: 72,
        statusMessage: "Video materialized",
      });
    }
    ledger = await loadGenerationMediaSlot({
      supabase,
      websiteId: requireWebsiteId(job),
      jobClaim: {
        id: job.id,
        attempts: job.attempts,
      },
      slotId: videoSlotId,
    });
    if (!ledger || ledger.status !== "ready" || ledger.id !== payload.readyLedgerId)
      return {
        kind: "retry",
        reasonCode: "ready_video_read_failed",
      };
    const videoRow = videoAttachment(job, videoSlotId, plan.sourceSlotId, ledger),
      videoManifestSlot = {
        slotId: videoSlotId,
        assetId: videoRow.asset_id,
        origin: "generated",
        role: "atmosphere",
        proofEligible: false,
        mimeType: "video/mp4",
        alt: "",
        storagePath: videoRow.storage_path,
        width: ledger.width ?? void 0,
        height: ledger.height ?? void 0,
        required: true,
        sourceSlotId: plan.sourceSlotId,
        posterSlotId: plan.sourceSlotId,
        targetSection: plan.targetSection,
        placement: "inline",
        motionPreset: plan.motionPreset,
      };
    const nextConfig = {
      ...config,
      themeSource: insertVideoIntoSection(String(config.themeSource ?? ""), plan, videoSlotId),
      mediaManifest: { slots: [...parsed.manifest.slots, videoManifestSlot] },
    };
    const nextAttachments = [...attachments, videoRow];
    validateAddVideoCandidate({
      previousConfig: config,
      nextConfig,
      nextAttachments,
      plan,
      videoSlotId,
    });
    if (stage === "composition/build" || stage === "validation/run")
      return yieldAddVideoStage({
        supabase,
        job,
        expectedStage: stage,
        nextStage: "persistence/commit",
        checkpoint: persistableAddVideoCandidate(nextConfig, ledger.id),
        progressPct: 95,
        statusMessage: "Saving the video…",
      });
    const candidate = isRecord(payload.validatedCandidate) ? payload.validatedCandidate : null;
    if (
      !candidate ||
      !isRecord(candidate.config) ||
      typeof candidate.candidateHash !== "string" ||
      candidate.readyLedgerId !== ledger.id ||
      bucket1CandidateConfigHash(candidate.config) !== candidate.candidateHash
    )
      return {
        kind: "fail",
        reasonCode: "validated_candidate_checkpoint_invalid",
      };
    const persistable = persistableAddVideoCandidate(
      candidate.config,
      ledger.id,
    ).validatedCandidate;
    const committed = await commitAddVideoToVersionIfAvailable(supabase, {
      jobId: job.id,
      jobAttempts: job.attempts,
      claimEpoch: job.claim_epoch,
      runnerId: job.locked_by ?? void 0,
      websiteId: requireWebsiteId(job),
      targetVersionId: job.target_version_id,
      expectedRevision,
      candidateHash: persistable.candidateHash,
      config: persistable.config,
      readySlotId: ledger.id,
      editEvent: {
        requestId: job.request_id,
        targetSection: plan.targetSection,
        videoSlotId,
      },
    });
    if (!committed)
      return {
        kind: "fail",
        reasonCode: "add_video_database_incompatible",
      };
    return {
      kind: "complete",
      result: {
        targetVersionId: job.target_version_id,
        revision: committed.revision,
        targetSection: plan.targetSection,
        videoSlotId,
        candidateHash: candidate.candidateHash,
      },
    };
  } catch (error) {
    if (isAbortError(error)) {
      if (addVideoAbsoluteDeadlineExceeded(job))
        return { kind: "fail", reasonCode: "total_deadline_exceeded" };
      throw error;
    }
    return { kind: "fail", reasonCode: reason(error) };
  } finally {
    cancellation.stop();
  }
}
