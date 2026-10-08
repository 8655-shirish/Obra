import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { parseMediaManifest, type ResolvedMediaManifest } from "@/lib/site-theme/media-manifest";
import type { EvidenceMediaItem } from "@/lib/site-evidence";
import { isOwnedSiteMediaPath } from "@/lib/media/persist-scraped-media.server";
import type { MediaManifestSlot } from "@/lib/site-theme/media-manifest";

type SupabaseAdmin = SupabaseClient<Database>;
export type GenerationJobClaim =
  | { id: string; attempts: number; claimEpoch?: undefined; runnerId?: undefined }
  | { id: string; attempts: number; claimEpoch: number; runnerId: string };
export type GenerationMediaCreateReservation = {
  reservationId: string;
  createOrdinal: number;
  idempotencyKey: string;
  slotClaimEpoch: number;
};

function epochRunner(jobClaim: GenerationJobClaim): string | undefined {
  if (jobClaim.claimEpoch === undefined) return undefined;
  if (!jobClaim.runnerId) throw new Error("Epoch media mutation requires the exact current runner");
  return jobClaim.runnerId;
}
export type GenerationMediaEffectCertainty =
  "none" | "not_started" | "definite_failure" | "definite_success" | "indeterminate";
export type GenerationMediaLedgerRow =
  Database["public"]["Tables"]["site_generation_media_slots"]["Row"];

export async function loadGenerationMediaSlot(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
  slotId: string;
}): Promise<GenerationMediaLedgerRow | null> {
  const { data, error } = await options.supabase
    .from("site_generation_media_slots")
    .select("*")
    .eq("job_id", options.jobClaim.id)
    .eq("website_id", options.websiteId)
    .eq("slot_id", options.slotId)
    .maybeSingle();
  if (error) throw new Error("Unable to load generated media slot");
  return data;
}

/** Atomically consumes one of at most two billable provider creates. */
export async function reserveGenerationMediaCreate(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
  slotId: string;
  provider?: string;
  requestHash?: string;
}): Promise<GenerationMediaCreateReservation | number> {
  const claimEpoch = options.jobClaim.claimEpoch;
  const runnerId = epochRunner(options.jobClaim);
  const { data, error } =
    claimEpoch !== undefined
      ? await options.supabase.rpc("reserve_generation_media_create_epoch", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_claim_epoch: claimEpoch,
          p_slot_id: options.slotId,
          p_provider:
            options.provider ??
            (() => {
              throw new Error("Epoch media reservation requires provider");
            })(),
          p_request_hash:
            options.requestHash ??
            (() => {
              throw new Error("Epoch media reservation requires request hash");
            })(),
          p_runner_id: runnerId!,
        })
      : await options.supabase.rpc("reserve_generation_media_create", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_job_attempts: options.jobClaim.attempts,
          p_slot_id: options.slotId,
        });
  const validEpochReservation =
    claimEpoch !== undefined &&
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof (data as Record<string, unknown>).reservationId === "string" &&
    Number.isInteger((data as Record<string, unknown>).createOrdinal) &&
    typeof (data as Record<string, unknown>).idempotencyKey === "string" &&
    Number.isInteger((data as Record<string, unknown>).slotClaimEpoch);
  const validLegacyOrdinal =
    claimEpoch === undefined &&
    typeof data === "number" &&
    Number.isInteger(data) &&
    data >= 1 &&
    data <= 2;
  if (error || (!validEpochReservation && !validLegacyOrdinal)) {
    const failure = new Error("Provider create budget is unavailable");
    failure.name = "MediaCreateBudgetError";
    throw failure;
  }
  return validEpochReservation
    ? {
        reservationId: (data as Record<string, unknown>).reservationId as string,
        createOrdinal: (data as Record<string, unknown>).createOrdinal as number,
        idempotencyKey: (data as Record<string, unknown>).idempotencyKey as string,
        slotClaimEpoch: (data as Record<string, unknown>).slotClaimEpoch as number,
      }
    : (data as number);
}

export async function recordReadyGenerationMediaSlots(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
  generatorSchemaVersion: number;
  manifest: ResolvedMediaManifest;
}): Promise<string[]> {
  const parsed = parseMediaManifest(options.generatorSchemaVersion, options.manifest);
  if (!parsed.ok) throw new Error(parsed.error);
  const { data: readyRows, error: readyError } = await options.supabase
    .from("site_generation_media_slots")
    .select("id, slot_id, storage_path")
    .eq("job_id", options.jobClaim.id)
    .eq("website_id", options.websiteId)
    .eq("status", "ready");
  if (readyError) throw new Error("Unable to load generated media slots for finalization");
  const readyBySlot = new Map((readyRows ?? []).map((row) => [row.slot_id, row]));
  const ids: string[] = [];
  for (const slot of parsed.manifest.slots) {
    if (!slot.storagePath) throw new Error(`Media slot ${slot.slotId} is not durably persisted`);
    if (!isOwnedSiteMediaPath(options.websiteId, slot.storagePath)) {
      throw new Error(`Media slot ${slot.slotId} has an invalid storage path`);
    }
    const existing = readyBySlot.get(slot.slotId);
    if (existing) {
      if (existing.storage_path !== slot.storagePath) {
        throw new Error(`Ready media slot ${slot.slotId} does not match the resolved manifest`);
      }
      ids.push(existing.id);
      continue;
    }
    if (options.jobClaim.claimEpoch !== undefined) {
      throw new Error(`Epoch media slot ${slot.slotId} must already be ready before finalization`);
    }
    await claimGenerationMediaItem({
      supabase: options.supabase,
      websiteId: options.websiteId,
      jobClaim: options.jobClaim,
      slotId: slot.slotId,
      kind: slot.mimeType.startsWith("video/") ? "video" : "image",
      role: slot.role,
      provenance: slot.origin,
      proofEligible: slot.proofEligible,
      required: slot.required === true,
      sourceSlotId: slot.sourceSlotId,
    });
    const { data, error } = await options.supabase.rpc("record_generation_media_slot", {
      p_job_id: options.jobClaim.id,
      p_website_id: options.websiteId,
      p_job_attempts: options.jobClaim.attempts,
      p_slot_id: slot.slotId,
      p_kind: slot.mimeType.startsWith("video/") ? "video" : "image",
      p_role: slot.role,
      p_provenance: slot.origin,
      p_required: slot.required === true,
      p_proof_eligible: slot.proofEligible,
      p_storage_path: slot.storagePath,
      p_mime_type: slot.mimeType,
      p_width: slot.width ?? undefined,
      p_height: slot.height ?? undefined,
      p_content_hash: slot.assetId,
      p_source_slot_id: slot.sourceSlotId ?? undefined,
      p_poster_slot_id: slot.posterSlotId ?? undefined,
    });
    if (error || typeof data !== "string") {
      console.error("[recordReadyGenerationMediaSlots]", slot.slotId, error);
      throw new Error(`Unable to record generated media slot ${slot.slotId}`);
    }
    ids.push(data);
  }
  return ids;
}
export async function planGenerationMediaSlots(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
  slots: Array<{
    slotId: string;
    kind: "image" | "video";
    role: MediaManifestSlot["role"];
    provenance: "generated" | "evidence";
    required: boolean;
    proofEligible: boolean;
    sourceSlotId?: string;
    posterSlotId?: string;
  }>;
}): Promise<void> {
  const claimEpoch = options.jobClaim.claimEpoch;
  if (claimEpoch !== undefined) {
    const runnerId = epochRunner(options.jobClaim);
    const { data, error } = await options.supabase.rpc("plan_generation_media_slots_epoch", {
      p_job_id: options.jobClaim.id,
      p_website_id: options.websiteId,
      p_claim_epoch: claimEpoch,
      p_runner_id: runnerId!,
      p_slots: options.slots.map((slot) => ({
        slot_id: slot.slotId,
        kind: slot.kind,
        role: slot.role,
        provenance: slot.provenance,
        required: slot.required,
        proof_eligible: slot.proofEligible,
        source_slot_id: slot.sourceSlotId,
        poster_slot_id: slot.posterSlotId,
      })),
    });
    if (error || !Array.isArray(data) || data.some((id) => typeof id !== "string"))
      throw new DOMException("Generation cancelled or superseded", "AbortError");
    return;
  }

  for (const slot of options.slots) {
    const { data, error } = await options.supabase.rpc("plan_generation_media_slot", {
      p_job_id: options.jobClaim.id,
      p_website_id: options.websiteId,
      p_job_attempts: options.jobClaim.attempts,
      p_slot_id: slot.slotId,
      p_kind: slot.kind,
      p_role: slot.role,
      p_provenance: slot.provenance,
      p_required: slot.required,
      p_proof_eligible: slot.proofEligible,
      p_source_slot_id: slot.sourceSlotId,
      p_poster_slot_id: slot.posterSlotId,
    });
    if (error || typeof data !== "string")
      throw new DOMException("Generation cancelled or superseded", "AbortError");
  }
}

export async function settleGenerationMediaSlot(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
  slotId: string;
  status: "failed" | "abandoned";
  reservationId?: string;
  errorMessage?: string;
  effectCertainty?: GenerationMediaEffectCertainty;
}): Promise<boolean> {
  const claimEpoch = options.jobClaim.claimEpoch;
  const runnerId = epochRunner(options.jobClaim);
  const { data, error } =
    claimEpoch !== undefined
      ? await options.supabase.rpc("settle_generation_media_slot_epoch", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_claim_epoch: claimEpoch,
          p_slot_id: options.slotId,
          p_reservation_id: (options.reservationId ?? null) as unknown as string,
          p_status: options.status,
          p_error_message: options.errorMessage ?? "media generation failed",
          p_effect_certainty: options.effectCertainty ?? "not_started",
          p_runner_id: runnerId!,
        })
      : await options.supabase.rpc("settle_generation_media_slot", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_job_attempts: options.jobClaim.attempts,
          p_slot_id: options.slotId,
          p_status: options.status,
          p_error_message: options.errorMessage ?? undefined,
        });
  if (error) throw new Error(`Unable to settle generated media slot ${options.slotId}`);
  return data === true;
}

export async function loadResumableGenerationOperations(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
}): Promise<Map<string, string>> {
  const { data, error } = await options.supabase
    .from("site_generation_media_slots")
    .select("slot_id, provider_operation_id")
    .eq("job_id", options.jobClaim.id)
    .eq("website_id", options.websiteId)
    .eq("kind", "video")
    .eq("status", "generating")
    .not("provider_operation_id", "is", null);
  if (error) throw new Error("Unable to load resumable provider operations");
  return new Map(
    (data ?? []).flatMap((row) =>
      row.provider_operation_id ? [[row.slot_id, row.provider_operation_id] as const] : [],
    ),
  );
}

export async function loadGenerationMediaDispositions(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
}): Promise<
  Map<
    string,
    { status: string; required: boolean; effectCertainty: string; providerCreateCount: number }
  >
> {
  const { data, error } = await options.supabase
    .from("site_generation_media_slots")
    .select("slot_id, status, required, effect_certainty, provider_create_count")
    .eq("job_id", options.jobClaim.id)
    .eq("website_id", options.websiteId);
  if (error) throw new Error("Unable to load generated media dispositions");
  return new Map(
    (data ?? []).map((row) => [
      row.slot_id,
      {
        status: row.status,
        required: row.required,
        effectCertainty: row.effect_certainty ?? "none",
        providerCreateCount: row.provider_create_count,
      },
    ]),
  );
}

export async function recordGenerationMediaOperation(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
  slotId: string;
  operationId: string;
  reservationId?: string;
}): Promise<void> {
  const claimEpoch = options.jobClaim.claimEpoch;
  const runnerId = epochRunner(options.jobClaim);
  const { data, error } =
    claimEpoch !== undefined
      ? await options.supabase.rpc("record_generation_media_operation_epoch", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_claim_epoch: claimEpoch,
          p_slot_id: options.slotId,
          p_reservation_id:
            options.reservationId ??
            (() => {
              throw new Error("Epoch media operation requires reservation identity");
            })(),
          p_provider_operation_id: options.operationId,
          p_effect_certainty: "not_started",
          p_runner_id: runnerId!,
        })
      : await options.supabase.rpc("record_generation_media_operation", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_job_attempts: options.jobClaim.attempts,
          p_slot_id: options.slotId,
          p_provider_operation_id: options.operationId,
        });
  if (error || data !== true) {
    const failure = new Error(`Unable to persist provider operation for ${options.slotId}`);
    failure.name = "MediaClaimError";
    throw failure;
  }
}

export async function loadReadyGenerationMedia(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
}): Promise<EvidenceMediaItem[]> {
  const { data, error } = await options.supabase
    .from("site_generation_media_slots")
    .select(
      "slot_id, kind, role, provenance, proof_eligible, storage_path, mime_type, width, height, content_hash, source_slot_id",
    )
    .eq("job_id", options.jobClaim.id)
    .eq("website_id", options.websiteId)
    .eq("status", "ready");
  if (error) throw new Error("Unable to load resumable generation media");
  return (data ?? []).map((row) => ({
    url: `https://generated.obra.invalid/${row.storage_path}`,
    storagePath: row.storage_path ?? undefined,
    mimeType: row.mime_type ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    contentHash: row.content_hash ?? undefined,
    origin: row.provenance === "generated" ? "generated" : "evidence",
    proofEligible: row.proof_eligible,
    generationSlotId: row.slot_id,
    videoSourceSlotId: row.source_slot_id ?? undefined,
    provenance: {
      kind: row.provenance === "generated" ? "generated" : "evidence",
      storageBucket: "site-media",
    },
  }));
}

export async function claimGenerationMediaItem(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
  slotId: string;
  kind: "image" | "video";
  role: MediaManifestSlot["role"];
  sourceSlotId?: string;
  provenance?: "generated" | "evidence";
  proofEligible?: boolean;
  required?: boolean;
}): Promise<string> {
  const claimEpoch = options.jobClaim.claimEpoch;
  const runnerId = epochRunner(options.jobClaim);
  const { data, error } =
    claimEpoch !== undefined
      ? await options.supabase.rpc("claim_generation_media_slot_epoch", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_claim_epoch: claimEpoch,
          p_slot_id: options.slotId,
          p_kind: options.kind,
          p_role: options.role,
          p_provenance: options.provenance ?? "generated",
          p_required: options.required !== false,
          p_proof_eligible: options.proofEligible === true,
          p_source_slot_id: options.sourceSlotId ?? undefined,
          p_poster_slot_id: options.sourceSlotId ?? undefined,
          p_runner_id: runnerId!,
        })
      : await options.supabase.rpc("claim_generation_media_slot", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_job_attempts: options.jobClaim.attempts,
          p_slot_id: options.slotId,
          p_kind: options.kind,
          p_role: options.role,
          p_provenance: options.provenance ?? "generated",
          p_required: options.required !== false,
          p_proof_eligible: options.proofEligible === true,
          p_source_slot_id: options.sourceSlotId ?? undefined,
          p_poster_slot_id: options.sourceSlotId ?? undefined,
        });
  if (error || typeof data !== "string") {
    const failure = new Error(`Unable to claim generated media slot ${options.slotId}`);
    failure.name = "MediaClaimError";
    throw failure;
  }
  return data;
}

/** Historical Add Video writer; current epoch generation uses recordReadyGenerationMediaItem. */
export async function recordAttestedGenerationVideo(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: Extract<GenerationJobClaim, { claimEpoch?: undefined }>;
  slotId: string;
  storagePath: string;
  contentHash: string;
  sourceSlotId: string;
  width: number;
  height: number;
  byteSize: number;
  durationMs: number;
  videoCodec: string;
  videoProfile: string;
  hasAudio: boolean;
  audioCodec: string | null;
  validatorVersion: string;
}): Promise<string> {
  const { data, error } = await options.supabase.rpc("record_generation_media_slot", {
    p_job_id: options.jobClaim.id,
    p_website_id: options.websiteId,
    p_job_attempts: options.jobClaim.attempts,
    p_slot_id: options.slotId,
    p_kind: "video",
    p_role: "atmosphere",
    p_provenance: "generated",
    p_required: true,
    p_proof_eligible: false,
    p_storage_path: options.storagePath,
    p_mime_type: "video/mp4",
    p_width: options.width,
    p_height: options.height,
    p_content_hash: options.contentHash,
    p_source_slot_id: options.sourceSlotId,
    p_poster_slot_id: options.sourceSlotId,
    p_byte_size: options.byteSize,
    p_duration_ms: options.durationMs,
    p_video_codec: options.videoCodec,
    p_video_profile: options.videoProfile,
    p_has_audio: options.hasAudio,
    p_audio_codec: options.audioCodec ?? undefined,
    p_validator_version: options.validatorVersion,
  });
  if (error || typeof data !== "string") {
    const failure = new Error("Unable to persist video attestation");
    failure.name = "MediaClaimError";
    throw failure;
  }
  return data;
}

export async function recordReadyGenerationMediaItem(options: {
  supabase: SupabaseAdmin;
  websiteId: string;
  jobClaim: GenerationJobClaim;
  item: EvidenceMediaItem;
  slotId: string;
  reservation?: GenerationMediaCreateReservation;
  role: MediaManifestSlot["role"];
  required: boolean;
}): Promise<string> {
  if (!options.item.storagePath || !options.item.mimeType)
    throw new Error(`Media slot ${options.slotId} is not durably persisted`);
  if (!isOwnedSiteMediaPath(options.websiteId, options.item.storagePath)) {
    throw new Error(`Media slot ${options.slotId} has an invalid storage path`);
  }
  const claimEpoch = options.jobClaim.claimEpoch;
  const { data, error } =
    claimEpoch !== undefined
      ? await options.supabase.rpc("record_generation_media_slot_epoch", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_claim_epoch: claimEpoch,
          p_slot_id: options.slotId,
          p_reservation_id:
            options.reservation?.reservationId ??
            (() => {
              throw new Error("Epoch ready media requires an exact reservation");
            })(),
          p_slot_claim_epoch:
            options.reservation?.slotClaimEpoch ??
            (() => {
              throw new Error("Epoch ready media requires an exact slot claim epoch");
            })(),
          p_kind: options.item.mimeType.startsWith("video/") ? "video" : "image",
          p_role: options.role,
          p_provenance: options.item.origin === "generated" ? "generated" : "evidence",
          p_required: options.required,
          p_proof_eligible: options.item.proofEligible === true,
          p_storage_path: options.item.storagePath,
          p_mime_type: options.item.mimeType,
          p_width: options.item.width ?? undefined,
          p_height: options.item.height ?? undefined,
          p_content_hash: options.item.contentHash ?? options.item.storagePath,
          p_source_slot_id: options.item.videoSourceSlotId ?? undefined,
          p_poster_slot_id: options.item.videoSourceSlotId ?? undefined,
          p_effect_certainty: "definite_success",
          p_runner_id: epochRunner(options.jobClaim)!,
        })
      : await options.supabase.rpc("record_generation_media_slot", {
          p_job_id: options.jobClaim.id,
          p_website_id: options.websiteId,
          p_job_attempts: options.jobClaim.attempts,
          p_slot_id: options.slotId,
          p_kind: options.item.mimeType.startsWith("video/") ? "video" : "image",
          p_role: options.role,
          p_provenance: options.item.origin === "generated" ? "generated" : "evidence",
          p_required: options.required,
          p_proof_eligible: options.item.proofEligible === true,
          p_storage_path: options.item.storagePath,
          p_mime_type: options.item.mimeType,
          p_width: options.item.width ?? undefined,
          p_height: options.item.height ?? undefined,
          p_content_hash: options.item.contentHash ?? options.item.storagePath,
          p_source_slot_id: options.item.videoSourceSlotId ?? undefined,
          p_poster_slot_id: options.item.videoSourceSlotId ?? undefined,
        });
  if (error || typeof data !== "string") {
    const failure = new Error(`Unable to record generated media slot ${options.slotId}`);
    failure.name = "MediaClaimError";
    throw failure;
  }
  return data;
}
