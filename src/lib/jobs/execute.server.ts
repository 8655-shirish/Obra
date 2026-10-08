import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { normalizeLicenseNumber } from "@/lib/auth/profile.server";
import { normalizeDesignPreferences } from "@/lib/agent/design-preferences.server";

import { touchJobLock } from "./claim.server";
import { JOB_TYPE_ADD_VIDEO, JOB_TYPE_ENRICHMENT, JOB_TYPE_SITE_GENERATION } from "./platforms";
import { executeAddVideoJob, type AddVideoDisposition } from "./add-video-worker.server";
import { mergeEnrichmentPlatformResult } from "./enrichment-merge.server";
import {
  enrichmentSubjectFromJob,
  requireWebsiteId,
  type EnrichmentSubject,
} from "./enrichment-subject";
import { onboardingFromResearchCells } from "@/lib/admin/contractor-research-csv";
import {
  asPayloadRecord,
  computeRetryDelayMs,
  getNextRetryAtIso,
  withoutRetrySchedule,
} from "./retry.server";
import { retryDelayMs, type SiteGenerationRetryCause } from "./site-generation-retry-policy";
import type { BackgroundJobRow } from "./types";
import type { Json } from "@/integrations/supabase/types";
import { isAbortError } from "@/lib/agent/abort.server";
import { isNonretryableGenerationConfigurationError } from "@/lib/agent/generation-mode.server";
import { parseEnrichmentImages } from "@/lib/media/persist-scraped-media.server";
import { mediaProviderAbortEffectCertainty } from "@/lib/media/provider-effect-boundary";
import { STILL_TOTAL_DEADLINE_MS } from "@/lib/media/lovable-media.server";
import { overlayStoragePathByUrl, joinAttestedStills } from "@/lib/site-evidence";
import { jobFailureSettlement } from "./failure-settlement";
import { callSupabaseRpc } from "./supabase-rpc.server";
import {
  parseGachaFilter,
  recentGachaIdsFromPriorIdentities,
  type GachaLock,
} from "@/lib/agent/gacha";
import { watchJobCancellation } from "./cancel-check.server";
import {
  GenerationStageYield,
  invalidGenerationStageState,
  isGenerationStageYield,
  isInvalidGenerationCheckpointError,
  type SiteGenerationCheckpointStage,
} from "./generation-stage";
import {
  generationCheckpointJson,
  parseSiteGenerationCheckpoint,
  type FrozenSiteGenerationInput,
  type SiteGenerationCheckpoint,
} from "./site-generation-checkpoint";

type SupabaseAdmin = SupabaseClient<Database>;

type SiteGenerationStage =
  | "checking-photos"
  | "choosing"
  | "picking"
  | "waitingPhotos"
  | "creating-media"
  | "creating-motion"
  | "composing"
  | "validating"
  | "saving";

const SITE_GENERATION_PROGRESS: Record<SiteGenerationStage, { pct: number; label: string }> = {
  "checking-photos": { pct: 10, label: "Checking business photos…" },
  choosing: { pct: 22, label: "Choosing a design direction…" },
  picking: { pct: 22, label: "Picking a look…" },
  waitingPhotos: { pct: 18, label: "Waiting for business photos…" },
  "creating-media": { pct: 38, label: "Creating page media…" },
  "creating-motion": { pct: 55, label: "Creating motion…" },
  composing: { pct: 70, label: "Composing the page…" },
  validating: { pct: 94, label: "Saving the design…" },
  saving: { pct: 94, label: "Saving the design…" },
};

export function classifySiteGenerationAbort(input: {
  stage: SiteGenerationCheckpointStage;
  error: unknown;
  leaseLost: boolean;
  invocationDeadline: boolean;
}): {
  causeCode:
    | "provider_indeterminate_acceptance"
    | "lease_lost"
    | "invocation_deadline"
    | "cooperative_abort";
  effectCertainty: "not_started" | "indeterminate";
} {
  const providerIndeterminate =
    input.stage === "media" && mediaProviderAbortEffectCertainty(input.error) === "indeterminate";
  return {
    causeCode: providerIndeterminate
      ? "provider_indeterminate_acceptance"
      : input.leaseLost
        ? "lease_lost"
        : input.invocationDeadline
          ? "invocation_deadline"
          : "cooperative_abort",
    effectCertainty: providerIndeterminate ? "indeterminate" : "not_started",
  };
}

export function siteGenerationAbortEffectCertainty(input: {
  stage: SiteGenerationCheckpointStage;
  error: unknown;
}): "not_started" | "indeterminate" {
  return classifySiteGenerationAbort({
    ...input,
    leaseLost: false,
    invocationDeadline: false,
  }).effectCertainty;
}

export function classifyAddVideoAbort(input: { leaseLost: boolean; invocationDeadline: boolean }): {
  causeCode: "lease_lost" | "invocation_deadline" | "cooperative_abort";
  terminal: boolean;
} {
  return input.leaseLost
    ? { causeCode: "lease_lost", terminal: false }
    : input.invocationDeadline
      ? { causeCode: "invocation_deadline", terminal: true }
      : { causeCode: "cooperative_abort", terminal: false };
}

export async function runSiteGenerationFinalizerAndNotify<T>(input: {
  supabase: SupabaseAdmin;
  websiteId: string;
  finalize: () => Promise<T>;
}): Promise<T> {
  const result = await input.finalize();
  const { scheduleJobProgressNotify } = await import("./progress-notify.server");
  scheduleJobProgressNotify(input.supabase, input.websiteId);
  return result;
}

function siteGenerationStageForMessage(message: string): SiteGenerationStage {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("waiting for business photos") ||
    normalized.includes("checking business")
  )
    return "checking-photos";
  if (normalized.includes("picking a look") || normalized.includes("look…")) return "picking";
  if (normalized.includes("motion") || normalized.includes("clip")) return "creating-motion";
  if (normalized.includes("media") || normalized.includes("still")) return "creating-media";
  if (normalized.includes("sav")) return "saving";
  if (normalized.includes("writing") || normalized.includes("compos")) return "composing";
  return "choosing";
}

async function updateJobProgress(
  supabase: SupabaseAdmin,
  websiteId: string | null,
  jobId: string,
  attempts: number,
  progressPct: number,
  statusMessage: string,
  claimEpoch?: number,
): Promise<void> {
  await touchJobLock(supabase, jobId, attempts, { progressPct, statusMessage }, claimEpoch);

  if (!websiteId) return;
  const { scheduleJobProgressNotify } = await import("./progress-notify.server");
  scheduleJobProgressNotify(supabase, websiteId);
}

async function settleBackgroundJob(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  input: {
    status: "pending" | "completed" | "failed";
    progressPct: number;
    resultJson?: Record<string, unknown>;
    payloadJson: Record<string, unknown>;
    errorMessage?: string;
    statusMessage: string;
    completedAt?: string;
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("settle_background_job", {
    p_job_id: job.id,
    p_attempts: job.attempts,
    p_status: input.status,
    p_progress_pct: input.progressPct,
    p_result_json: (input.resultJson ?? null) as Json,
    p_payload_json: input.payloadJson as Json,
    p_error_message: (input.errorMessage ?? null) as unknown as string,
    p_status_message: input.statusMessage,
    p_completed_at: (input.completedAt ?? null) as unknown as string,
  });
  if (error || typeof data !== "boolean") {
    console.error("[settleBackgroundJob]", error);
    throw new Error("Unable to settle job");
  }
  if (data && job.website_id) {
    const { scheduleJobProgressNotify } = await import("./progress-notify.server");
    scheduleJobProgressNotify(supabase, job.website_id);
  }
  return data;
}

async function markJobCompleted(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  resultJson: Record<string, unknown>,
): Promise<boolean> {
  return settleBackgroundJob(supabase, job, {
    status: "completed",
    progressPct: 100,
    resultJson,
    payloadJson: withoutRetrySchedule(job.payload_json),
    statusMessage: "Completed",
    completedAt: new Date().toISOString(),
  });
}

async function markJobFailed(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  errorMessage: string,
  options?: { retryable?: boolean },
): Promise<boolean> {
  const generationJob = job.job_type === JOB_TYPE_SITE_GENERATION;
  const consumedFailures = generationJob ? job.failure_attempts + 1 : job.attempts;
  const canRetry = options?.retryable !== false && consumedFailures < job.max_attempts;
  const payloadJson = asPayloadRecord(job.payload_json);
  if (canRetry) payloadJson.next_retry_at = getNextRetryAtIso(consumedFailures);
  else delete payloadJson.next_retry_at;
  return settleBackgroundJob(supabase, job, {
    status: canRetry ? "pending" : "failed",
    progressPct: job.progress_pct,
    payloadJson,
    errorMessage,
    statusMessage: canRetry
      ? `Retrying in ${computeRetryLabel(consumedFailures)} (${consumedFailures}/${job.max_attempts})`
      : "Failed",
    completedAt: canRetry ? undefined : new Date().toISOString(),
  });
}

async function settleAddVideoJobEpoch(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  input: {
    status: "pending" | "completed" | "failed";
    progressPct: number;
    resultJson?: Record<string, unknown>;
    payloadJson: Record<string, unknown>;
    errorMessage?: string;
    statusMessage: string;
    completedAt?: string;
  },
): Promise<boolean> {
  if (!job.locked_by || job.claim_epoch <= 0) throw new Error("Invalid Add Video claim fence");
  const { data, error } = await callSupabaseRpc(supabase, "settle_add_video_job_epoch", {
    p_job_id: job.id,
    p_website_id: requireWebsiteId(job),
    p_job_attempts: job.attempts,
    p_claim_epoch: job.claim_epoch,
    p_runner_id: job.locked_by,
    p_status: input.status,
    p_progress_pct: input.progressPct,
    p_result_json: input.resultJson ?? null,
    p_payload_json: input.payloadJson,
    p_error_message: input.errorMessage ?? null,
    p_status_message: input.statusMessage,
    p_completed_at: input.completedAt ?? null,
  });
  if (error || typeof data !== "boolean")
    throw new Error(error?.message ?? "Unable to settle Add Video job");
  if (data) {
    const { scheduleJobProgressNotify } = await import("./progress-notify.server");
    scheduleJobProgressNotify(supabase, requireWebsiteId(job));
  }
  return data;
}

export async function settleAddVideoDisposition(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  disposition: AddVideoDisposition,
): Promise<void> {
  if (disposition.kind === "yield") return;
  if (disposition.kind === "complete") {
    // The transactional finalizer already completed the row. Never expose an alternate completion
    // API, but broadcast its completed state just like every other settlement.
    const { scheduleJobProgressNotify } = await import("./progress-notify.server");
    scheduleJobProgressNotify(supabase, requireWebsiteId(job));
    return;
  }
  const payload = asPayloadRecord(job.payload_json);
  const stage = typeof payload.addVideoStage === "string" ? payload.addVideoStage : "planning/call";
  const stageFailures = asPayloadRecord(payload.stageFailures);
  const consumedStageFailures = Number(stageFailures[stage] ?? 0) + 1;
  const retry = disposition.kind === "retry" && consumedStageFailures < 3;
  if (retry)
    payload.next_retry_at = disposition.retryAt ?? getNextRetryAtIso(consumedStageFailures);
  else delete payload.next_retry_at;
  payload.errorCode = disposition.reasonCode;
  payload.addVideoDisposition = disposition.kind;
  await settleAddVideoJobEpoch(supabase, job, {
    status: retry ? "pending" : "failed",
    progressPct: job.progress_pct,
    resultJson: retry
      ? undefined
      : { errorCode: disposition.reasonCode, disposition: disposition.kind },
    payloadJson: payload,
    errorMessage: disposition.reasonCode,
    statusMessage: retry
      ? "Retry scheduled"
      : disposition.kind === "indeterminate"
        ? "Needs review"
        : "Failed",
    completedAt: retry ? undefined : new Date().toISOString(),
  });
}

async function ensureContractorProfile(supabase: SupabaseAdmin, websiteId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("contractor_profiles")
    .select("id")
    .eq("website_id", websiteId)
    .maybeSingle();

  if (existing) return;

  const { data: website, error: websiteError } = await supabase
    .from("websites")
    .select("user_id")
    .eq("id", websiteId)
    .single();

  if (websiteError || !website) {
    throw new Error("Website not found for contractor profile");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("license_number, full_name, city")
    .eq("id", website.user_id)
    .single();

  if (profileError || !profile) {
    throw new Error("Profile not found for contractor profile");
  }

  const { error: insertError } = await supabase.from("contractor_profiles").insert({
    website_id: websiteId,
    license_number: normalizeLicenseNumber(profile.license_number),
    business_name: profile.full_name,
    city: profile.city,
    state: "CA",
    enrichment_json: {},
  });

  if (insertError) {
    console.error("[ensureContractorProfile]", insertError);
    throw new Error("Unable to create contractor profile");
  }
}

async function mirrorResearchStatus(
  supabase: SupabaseAdmin,
  websiteId: string,
  researchStatus: "complete" | "partial" | "failed" | "no_results_found",
): Promise<void> {
  await ensureContractorProfile(supabase, websiteId);

  const { error: contractorError } = await supabase
    .from("contractor_profiles")
    .update({ research_status: researchStatus })
    .eq("website_id", websiteId);

  if (contractorError) {
    console.error("[mirrorResearchStatus] contractor_profiles", contractorError);
    throw new Error("Unable to update research status");
  }

  const { error: websiteError } = await supabase
    .from("websites")
    .update({ research_status: researchStatus })
    .eq("id", websiteId);

  if (websiteError) {
    console.error("[mirrorResearchStatus] websites", websiteError);
    throw new Error("Unable to mirror research status on website");
  }
}

async function settleEnrichmentJob(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  input: {
    status: "pending" | "completed" | "failed";
    resultJson?: Record<string, unknown>;
    payloadJson: Record<string, unknown>;
    errorMessage?: string;
    statusMessage: string;
    completedAt?: string;
  },
): Promise<{ settled: boolean; finalizeChain: boolean }> {
  const { data, error } = await supabase.rpc("settle_enrichment_job", {
    p_job_id: job.id,
    p_job_attempts: job.attempts,
    p_status: input.status,
    p_result_json: (input.resultJson ?? null) as Json,
    p_payload_json: input.payloadJson as Json,
    p_error_message: (input.errorMessage ?? null) as unknown as string,
    p_status_message: input.statusMessage,
    p_completed_at: (input.completedAt ?? null) as unknown as string,
  });
  const row = Array.isArray(data) ? data[0] : undefined;
  if (error || !row) {
    console.error("[settleEnrichmentJob]", error);
    throw new Error("Unable to settle enrichment job");
  }
  return { settled: row.settled, finalizeChain: row.finalize_chain };
}

async function retryEnrichmentFinalization(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  errorMessage: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("retry_enrichment_finalization", {
    p_job_id: job.id,
    p_job_attempts: job.attempts,
    p_error_message: errorMessage,
  });
  if (error || !["pending", "failed", "superseded"].includes(String(data))) {
    console.error("[retryEnrichmentFinalization]", error);
    throw new Error("Unable to persist enrichment finalization retry");
  }
}

async function loadEnrichmentOnboarding(
  supabase: SupabaseAdmin,
  subject: EnrichmentSubject,
): Promise<Record<string, unknown>> {
  if (subject.kind === "website") {
    const { data: website } = await supabase
      .from("websites")
      .select("onboarding_state")
      .eq("id", subject.websiteId)
      .single();
    return (website?.onboarding_state as Record<string, unknown>) ?? {};
  }
  const { data: row } = await supabase
    .from("contractor_research_rows")
    .select("cells")
    .eq("id", subject.researchRowId)
    .single();
  return onboardingFromResearchCells(row?.cells);
}

async function loadSubjectEnrichment(
  supabase: SupabaseAdmin,
  subject: EnrichmentSubject,
): Promise<Record<string, unknown>> {
  if (subject.kind === "website") {
    const { data } = await supabase
      .from("contractor_profiles")
      .select("enrichment_json")
      .eq("website_id", subject.websiteId)
      .single();
    return (data?.enrichment_json as Record<string, unknown>) ?? {};
  }
  const { data } = await supabase
    .from("contractor_research_rows")
    .select("enrichment_json")
    .eq("id", subject.researchRowId)
    .single();
  return (data?.enrichment_json as Record<string, unknown>) ?? {};
}

async function mirrorResearchStatusForSubject(
  supabase: SupabaseAdmin,
  subject: EnrichmentSubject,
  researchStatus: "complete" | "partial" | "failed" | "no_results_found",
): Promise<void> {
  if (subject.kind === "website") {
    await mirrorResearchStatus(supabase, subject.websiteId, researchStatus);
    return;
  }
  const { error } = await supabase
    .from("contractor_research_rows")
    .update({ research_status: researchStatus })
    .eq("id", subject.researchRowId);
  if (error) {
    console.error("[mirrorResearchStatusForSubject]", error);
    throw new Error("Unable to update research status");
  }
}

async function finalizeEnrichmentChain(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  onboarding: Record<string, unknown>,
  invocationSignal?: AbortSignal,
): Promise<void> {
  const subject = enrichmentSubjectFromJob(job);
  const enrichment = await loadSubjectEnrichment(supabase, subject);
  if (!(await loadRunningJob(supabase, job.id, job.attempts))) return;
  const platforms =
    enrichment.platforms && typeof enrichment.platforms === "object"
      ? (enrichment.platforms as Record<string, unknown>)
      : {};
  if (subject.kind === "website") {
    const persistWatch = watchJobCancellation(async () =>
      Boolean(await loadRunningJob(supabase, job.id, job.attempts)),
    );
    try {
      const { persistScrapedSiteMedia } = await import("@/lib/media/persist-scraped-media.server");
      await persistScrapedSiteMedia(supabase, subject.websiteId, enrichment, {
        onboarding,
        signal: invocationSignal
          ? AbortSignal.any([invocationSignal, persistWatch.signal])
          : persistWatch.signal,
      });
    } finally {
      persistWatch.stop();
    }
    if (!(await loadRunningJob(supabase, job.id, job.attempts))) return;
  }
  const { computeResearchStatusFromPlatforms } =
    await import("@/lib/integrations/firecrawl.server");
  await mirrorResearchStatusForSubject(
    supabase,
    subject,
    computeResearchStatusFromPlatforms(platforms),
  );
}

function computeRetryLabel(attempts: number): string {
  const delayMs = computeRetryDelayMs(attempts);
  if (delayMs < 1000) return `${delayMs}ms`;
  return `${Math.round(delayMs / 1000)}s`;
}

async function isEnrichmentChainComplete(
  supabase: SupabaseAdmin,
  chainId: string,
  excludeJobId?: string,
): Promise<boolean> {
  let query = supabase
    .from("background_jobs")
    .select("*", { count: "exact", head: true })
    .eq("chain_id", chainId)
    .in("status", ["pending", "running"]);
  if (excludeJobId) query = query.neq("id", excludeJobId);
  const { count, error } = await query;

  if (error) {
    console.error("[isEnrichmentChainComplete]", error);
    return false;
  }

  return count === 0;
}

async function loadRunningJob(
  supabase: SupabaseAdmin,
  jobId: string,
  attempts?: number,
  claimEpoch?: number,
  runnerId?: string | null,
): Promise<BackgroundJobRow | null> {
  const { data, error } = await supabase
    .from("background_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (attempts !== undefined && data?.attempts !== attempts) return null;
  if (claimEpoch !== undefined && data?.claim_epoch !== claimEpoch) return null;
  if (runnerId !== undefined && data?.locked_by !== runnerId) return null;

  if (error || !data || (data.status !== "running" && data.status !== "finalizing")) {
    return null;
  }

  return data as BackgroundJobRow;
}

async function executeEnrichmentPlatformJob(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  invocationSignal?: AbortSignal,
): Promise<void> {
  const running = await loadRunningJob(supabase, job.id, job.attempts);
  if (!running) return;

  const platform = running.platform ?? "platform";
  const subject = enrichmentSubjectFromJob(running);
  const progressWebsiteId = subject.kind === "website" ? subject.websiteId : null;

  await updateJobProgress(
    supabase,
    progressWebsiteId,
    running.id,
    running.attempts,
    10,
    `Searching ${platform}…`,
  );

  const onboarding = await loadEnrichmentOnboarding(supabase, subject);
  const runningPayload = asPayloadRecord(running.payload_json);
  if (runningPayload.resume_enrichment_finalization === true) {
    await finalizeEnrichmentChain(supabase, running, onboarding, invocationSignal);
    const failed = Boolean(running.error_message);
    delete runningPayload.resume_enrichment_finalization;
    await settleEnrichmentJob(supabase, running, {
      status: failed ? "failed" : "completed",
      resultJson:
        running.result_json && typeof running.result_json === "object"
          ? (running.result_json as Record<string, unknown>)
          : undefined,
      payloadJson: withoutRetrySchedule(runningPayload),
      errorMessage: running.error_message ?? undefined,
      statusMessage: failed ? "Failed" : "Completed",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  if (!(await loadRunningJob(supabase, running.id, running.attempts))) return;

  await updateJobProgress(
    supabase,
    progressWebsiteId,
    running.id,
    running.attempts,
    40,
    `Extracting ${platform} data…`,
  );

  const scrapeWatch = watchJobCancellation(async () =>
    Boolean(await loadRunningJob(supabase, running.id, running.attempts)),
  );
  const { scrapePlatformContext } = await import("@/lib/integrations/firecrawl.server");
  let scrapeResult;
  try {
    scrapeResult = await scrapePlatformContext(
      platform,
      {
        businessName: String(onboarding.businessName ?? ""),
        licenseNumber: String(onboarding.licenseNumber ?? ""),
        trade: String(onboarding.trade ?? ""),
        city: String(onboarding.city ?? "California"),
        services: onboarding.services ?? [],
      },
      {
        signal: invocationSignal
          ? AbortSignal.any([invocationSignal, scrapeWatch.signal])
          : scrapeWatch.signal,
      },
    );
  } finally {
    scrapeWatch.stop();
  }

  if (!(await loadRunningJob(supabase, running.id, running.attempts))) return;

  await updateJobProgress(
    supabase,
    progressWebsiteId,
    running.id,
    running.attempts,
    75,
    `Merging ${platform} results…`,
  );

  if (subject.kind === "website") {
    await ensureContractorProfile(supabase, subject.websiteId);
  }

  if (!scrapeResult.success && scrapeResult.retryable) {
    throw new Error(scrapeResult.error ?? `Transient ${platform} enrichment failure`);
  }
  const platformPartial: Record<string, unknown> = scrapeResult.success
    ? scrapeResult.data
    : { error: scrapeResult.error, platform };

  await mergeEnrichmentPlatformResult(supabase, subject, platform, platformPartial, onboarding);

  if (!(await loadRunningJob(supabase, running.id, running.attempts))) return;

  const resultJson = {
    platform,
    scraped_at: new Date().toISOString(),
    success: scrapeResult.success,
  };
  const platformFailed = !scrapeResult.success;
  const settlement = await settleEnrichmentJob(supabase, running, {
    status: platformFailed ? "failed" : "completed",
    resultJson,
    payloadJson: withoutRetrySchedule(running.payload_json),
    errorMessage: platformFailed
      ? (scrapeResult.error ?? `${platform} enrichment failed`)
      : undefined,
    statusMessage: platformFailed ? "Failed" : "Completed",
    completedAt: new Date().toISOString(),
  });
  if (!settlement.settled) return;
  if (settlement.finalizeChain) {
    await finalizeEnrichmentChain(supabase, running, onboarding, invocationSignal);
    await settleEnrichmentJob(supabase, running, {
      status: platformFailed ? "failed" : "completed",
      resultJson,
      payloadJson: withoutRetrySchedule(running.payload_json),
      errorMessage: platformFailed
        ? (scrapeResult.error ?? `${platform} enrichment failed`)
        : undefined,
      statusMessage: platformFailed ? "Failed" : "Completed",
      completedAt: new Date().toISOString(),
    });
  }
}

type EpochTwoGenerationJob = BackgroundJobRow & {
  website_id: string;
  generation_stage: SiteGenerationCheckpointStage;
  generation_input_hash: string;
  generation_input_snapshot: Json;
  generation_accepted_at: string;
  generation_request_hash: string;
  locked_by: string;
};

type SiteGenerationBudgetType = "interruption" | "stage_attempt" | "writer_repair";

const SITE_GENERATION_PROGRESS_BY_CURSOR: Record<
  SiteGenerationCheckpointStage,
  { pct: number; label: string }
> = {
  context: SITE_GENERATION_PROGRESS["checking-photos"],
  planning: SITE_GENERATION_PROGRESS.choosing,
  media: SITE_GENERATION_PROGRESS["creating-media"],
  composition: SITE_GENERATION_PROGRESS.composing,
  validation: SITE_GENERATION_PROGRESS.validating,
  persistence: SITE_GENERATION_PROGRESS.saving,
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function frozenPriorSummary(input: FrozenSiteGenerationInput): string | undefined {
  const parts = input.priorIdentities.flatMap((identity) => {
    const priorSummary = identity.priorSummary;
    if (typeof priorSummary === "string" && priorSummary.trim()) return [priorSummary.trim()];
    const summaryInputs = identity.summaryInputs;
    if (summaryInputs && typeof summaryInputs === "object" && !Array.isArray(summaryInputs))
      return [JSON.stringify(summaryInputs)];
    const layoutFingerprint = identity.layoutFingerprint;
    return typeof layoutFingerprint === "string" && layoutFingerprint.trim()
      ? [layoutFingerprint.trim()]
      : [];
  });
  return parts.length > 0 ? parts.join(" | ").slice(0, 16_000) : undefined;
}

function frozenEvidenceMedia(input: FrozenSiteGenerationInput) {
  return input.sourceMedia.map((item) => ({
    url: "https://frozen.obra.invalid/" + item.storagePath.replace(/^\/+/, ""),
    mimeType: item.mimeType,
    storagePath: item.storagePath,
    origin: item.origin,
    contentHash: item.assetId,
    proofEligible: item.proofEligible,
    width: item.width ?? undefined,
    height: item.height ?? undefined,
    generationSlotId: item.slotId,
    ...(item.sourceSlotId ? { videoSourceSlotId: item.sourceSlotId } : {}),
    provenance: {
      kind: item.origin,
      sourceUrl: item.storagePath,
      storageBucket: "site-media" as const,
    },
  }));
}

function generationFrozenContext(
  job: EpochTwoGenerationJob,
  checkpoint: SiteGenerationCheckpoint,
  enrichment: Record<string, unknown> = checkpoint.input.enrichment,
) {
  if (!checkpoint.designPreferences) throw invalidGenerationStageState();
  const payload = asPayloadRecord(job.payload_json);
  return {
    onboarding: checkpoint.input.onboarding,
    enrichment,
    evidenceMedia: frozenEvidenceMedia(checkpoint.input),
    contactHidden: checkpoint.input.contactPolicy.contactHidden,
    priorVariantSummary: frozenPriorSummary(checkpoint.input),
    creativeDirection:
      checkpoint.input.generationKind === "regeneration"
        ? checkpoint.input.instruction.trim() || undefined
        : undefined,
    designPreferences: checkpoint.designPreferences,
    generationKind: checkpoint.input.generationKind,
    ...(typeof payload.gachaId === "string" ? { gachaId: payload.gachaId } : {}),
    ...(Array.isArray(payload.gachaFilter)
      ? { gachaFilter: parseGachaFilter(payload.gachaFilter) }
      : {}),
    recentGachaIds: recentGachaIdsFromPriorIdentities(checkpoint.input.priorIdentities),
  };
}

/** Thread live site-media paths onto the frozen URL set. Gacha jobs may also join new attested hashes. */
async function overlayStoredEvidenceOnFrozenEnrichment(
  supabase: SupabaseAdmin,
  websiteId: string,
  frozen: Record<string, unknown>,
  options?: { joinAttested?: boolean },
): Promise<Record<string, unknown>> {
  try {
    const images = parseEnrichmentImages(frozen.images);
    const { data, error } = await supabase
      .from("contractor_profiles")
      .select("enrichment_json")
      .eq("website_id", websiteId)
      .maybeSingle();
    if (error || !data) return frozen;
    const live =
      data.enrichment_json &&
      typeof data.enrichment_json === "object" &&
      !Array.isArray(data.enrichment_json)
        ? (data.enrichment_json as Record<string, unknown>)
        : {};
    const liveImages = parseEnrichmentImages(live.images);
    if (images.length === 0 && !(options?.joinAttested && liveImages.length > 0)) return frozen;
    const nextImages = options?.joinAttested
      ? joinAttestedStills(images, liveImages)
      : overlayStoragePathByUrl(images, liveImages);
    return {
      ...frozen,
      images: nextImages,
    };
  } catch (error) {
    console.error("[overlayStoredEvidenceOnFrozenEnrichment]", error);
    return frozen;
  }
}

function siteGenerationStageFromJob(job: BackgroundJobRow): SiteGenerationCheckpointStage {
  const stage = job.generation_stage;
  if (
    stage === "context" ||
    stage === "planning" ||
    stage === "media" ||
    stage === "composition" ||
    stage === "validation" ||
    stage === "persistence"
  )
    return stage;
  return "context";
}

function assertSiteGenerationAuthority(
  job: BackgroundJobRow,
  checkpoint: SiteGenerationCheckpoint,
): asserts job is EpochTwoGenerationJob {
  if (
    job.generation_contract_epoch !== 2 ||
    (job.generation_contract_version !== 2 && job.generation_contract_version !== 3) ||
    job.generation_input_version !== 1 ||
    !job.generation_stage ||
    checkpoint.stage !== job.generation_stage ||
    !job.locked_by ||
    !job.generation_input_hash ||
    checkpoint.inputHash !== job.generation_input_hash ||
    !job.generation_input_snapshot ||
    !job.generation_accepted_at ||
    checkpoint.acceptedAt !== job.generation_accepted_at ||
    !job.generation_request_hash ||
    checkpoint.input.requestPayloadHash !== job.generation_request_hash ||
    checkpoint.input.generationKind !== job.generation_kind ||
    checkpoint.input.sourceVersionId !== job.source_version_id ||
    checkpoint.input.sourceRevision !== job.source_revision ||
    !job.website_id
  )
    throw invalidGenerationStageState();
}

function nextCheckpoint(
  checkpoint: SiteGenerationCheckpoint,
  stage: SiteGenerationCheckpointStage,
  patch: Partial<SiteGenerationCheckpoint> = {},
): SiteGenerationCheckpoint {
  return { ...checkpoint, ...patch, schemaVersion: 2, stage };
}

function siteGenerationEventKey(
  job: BackgroundJobRow,
  action: "yield" | "settle",
  detail: string,
): string {
  return [job.id, job.claim_epoch, action, detail].join(":");
}

async function yieldSiteGenerationStage(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  checkpoint: SiteGenerationCheckpoint,
  progressPct: number,
  statusMessage: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("yield_site_generation_stage_epoch", {
    p_job_id: job.id,
    p_claim_epoch: job.claim_epoch,
    p_contract_epoch: 2,
    p_stage: checkpoint.stage,
    p_checkpoint: generationCheckpointJson(checkpoint),
    p_progress_pct: progressPct,
    p_status_message: statusMessage,
    p_event_key: siteGenerationEventKey(job, "yield", checkpoint.stage),
    p_runner_id: job.locked_by,
  });
  if (error || data !== true) {
    console.error("[yieldSiteGenerationStage]", error);
    throw new DOMException("Generation cancelled or superseded", "AbortError");
  }
}

async function settleSiteGeneration(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  input: {
    status: "pending" | "failed";
    checkpoint: SiteGenerationCheckpoint;
    errorMessage: string;
    statusMessage: string;
    causeCode: string;
    budgetType: SiteGenerationBudgetType;
    effectCertainty?: "none" | "not_started" | "definite_failure" | "indeterminate";
    retryAt?: string;
    retryCause?: SiteGenerationRetryCause;
  },
): Promise<void> {
  const args = {
    p_job_id: job.id,
    p_claim_epoch: job.claim_epoch,
    p_contract_epoch: 2,
    p_status: input.status,
    p_progress_pct: job.progress_pct,
    p_result_json: null,
    p_checkpoint: generationCheckpointJson(input.checkpoint),
    p_error_message: input.errorMessage,
    p_status_message: input.statusMessage,
    p_next_retry_at:
      input.status === "pending"
        ? (input.retryAt ??
          (input.retryCause
            ? new Date(
                Date.now() +
                  retryDelayMs({ cause: input.retryCause, attempt: job.stage_attempts + 1 }),
              ).toISOString()
            : getNextRetryAtIso(job.stage_attempts + 1)))
        : null,
    p_effect_certainty: input.effectCertainty ?? "definite_failure",
    p_cause_code: input.causeCode,
    p_event_key: siteGenerationEventKey(
      job,
      "settle",
      [input.status, input.budgetType, input.checkpoint.stage].join(":"),
    ),
    p_budget_type: input.budgetType,
    p_runner_id: job.locked_by,
  };
  const { data, error } = await callSupabaseRpc<boolean>(
    supabase,
    "settle_site_generation_epoch",
    args,
  );
  if (error || data !== true) {
    console.error("[settleSiteGeneration]", error);
    throw new DOMException("Generation cancelled or superseded", "AbortError");
  }
}

async function settleInvalidGenerationCheckpoint(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  errorMessage: string,
): Promise<void> {
  if (
    job.generation_contract_epoch !== 2 ||
    !job.locked_by ||
    job.generation_checkpoint == null ||
    typeof job.generation_checkpoint !== "object" ||
    Array.isArray(job.generation_checkpoint)
  ) {
    throw new Error("Unable to settle invalid generation checkpoint");
  }
  const args = {
    p_job_id: job.id,
    p_claim_epoch: job.claim_epoch,
    p_contract_epoch: 2,
    p_status: "failed" as const,
    p_progress_pct: job.progress_pct,
    p_result_json: null,
    p_checkpoint: job.generation_checkpoint,
    p_error_message: errorMessage,
    p_status_message: "Generation failed",
    p_next_retry_at: null,
    p_effect_certainty: "not_started" as const,
    p_cause_code: "invalid_generation_checkpoint",
    p_event_key: siteGenerationEventKey(
      job,
      "settle",
      ["failed", "stage_attempt", siteGenerationStageFromJob(job)].join(":"),
    ),
    p_budget_type: "stage_attempt" as const,
    p_runner_id: job.locked_by,
  };
  const { data, error } = await callSupabaseRpc<boolean>(
    supabase,
    "settle_site_generation_epoch",
    args,
  );
  if (error || data !== true) {
    console.error("[settleInvalidGenerationCheckpoint]", error);
    throw new DOMException("Generation cancelled or superseded", "AbortError");
  }
}

function isGachaGeneration(job: BackgroundJobRow): boolean {
  return job.generation_contract_version === 3;
}

function resumeGachaFromCheckpoint(checkpoint: SiteGenerationCheckpoint): GachaLock | undefined {
  if (checkpoint.gachaLock) {
    return {
      ...checkpoint.gachaLock,
      scrapeEnqueued: checkpoint.scrapeEnqueued === true || checkpoint.gachaLock.scrapeEnqueued,
    };
  }
  if (checkpoint.scrapeEnqueued) return { evidenceAssetIdBySlot: {}, scrapeEnqueued: true };
  return undefined;
}

async function enrichmentJobsActive(supabase: SupabaseAdmin, websiteId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("background_jobs")
    .select("*", { count: "exact", head: true })
    .eq("website_id", websiteId)
    .eq("job_type", JOB_TYPE_ENRICHMENT)
    .in("status", ["pending", "running", "finalizing"]);
  if (error) throw new Error("Unable to inspect enrichment jobs");
  if (error) throw new Error("Unable to inspect enrichment jobs");
  return (count ?? 0) > 0;
}

async function overlayGenerationEnrichment(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  checkpoint: SiteGenerationCheckpoint,
): Promise<Record<string, unknown>> {
  return overlayStoredEvidenceOnFrozenEnrichment(
    supabase,
    job.website_id,
    checkpoint.input.enrichment,
    { joinAttested: isGachaGeneration(job) },
  );
}

function watchSiteGenerationExecution(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  invocationSignal?: AbortSignal,
): { signal: AbortSignal; stop: () => void } {
  const cancellation = watchJobCancellation(async () =>
    Boolean(await loadRunningJob(supabase, job.id, job.attempts, job.claim_epoch, job.locked_by)),
  );
  return {
    signal: invocationSignal
      ? AbortSignal.any([invocationSignal, cancellation.signal])
      : cancellation.signal,
    stop: cancellation.stop,
  };
}

async function executeGenerationContext(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  checkpoint: SiteGenerationCheckpoint,
): Promise<void> {
  const designPreferences = normalizeDesignPreferences({
    instruction: "",
    frozenEvidence: checkpoint.input.sourceMedia,
  });
  const planning = nextCheckpoint(checkpoint, "planning", {
    variantKey: checkpoint.variantKey ?? "generation-" + job.id,
    designPreferences,
  });
  await yieldSiteGenerationStage(
    supabase,
    job,
    planning,
    SITE_GENERATION_PROGRESS.choosing.pct,
    "Frozen generation context normalized; planning website",
  );
}

async function executeGenerationPlanning(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  checkpoint: SiteGenerationCheckpoint,
  invocationSignal?: AbortSignal,
): Promise<void> {
  if (
    isGachaGeneration(job) &&
    checkpoint.scrapeEnqueued &&
    (await enrichmentJobsActive(supabase, job.website_id))
  ) {
    await yieldSiteGenerationStage(
      supabase,
      job,
      nextCheckpoint(checkpoint, "planning", {
        scrapeEnqueued: true,
        ...(checkpoint.gachaLock ? { gachaLock: checkpoint.gachaLock } : {}),
      }),
      SITE_GENERATION_PROGRESS.waitingPhotos.pct,
      SITE_GENERATION_PROGRESS.waitingPhotos.label,
    );
    throw new GenerationStageYield("planning");
  }
  const watch = watchSiteGenerationExecution(supabase, job, invocationSignal);
  const { composeSiteConfigForWebsite } = await import("@/lib/agent/site-config.server");
  let gachaLock: GachaLock | undefined = resumeGachaFromCheckpoint(checkpoint);
  let scrapeEnqueued = checkpoint.scrapeEnqueued === true;
  try {
    await composeSiteConfigForWebsite(
      supabase,
      job.website_id,
      checkpoint.variantKey ?? "generation-" + job.id,
      {
        sourceEvidenceOnly: false,
        generationMode: "unified",
        executionUnit: "planning",
        signal: watch.signal,
        jobClaim: {
          id: job.id,
          attempts: job.attempts,
          claimEpoch: job.claim_epoch,
          runnerId: job.locked_by,
        },
        frozenContext: generationFrozenContext(
          job,
          checkpoint,
          await overlayGenerationEnrichment(supabase, job, checkpoint),
        ),
        resumeGachaLock: gachaLock,
        onGachaLockAccepted: async (accepted) => {
          gachaLock = accepted;
          scrapeEnqueued = accepted.scrapeEnqueued === true || scrapeEnqueued;
        },
        onStageCheckpoint: async (nextStage) => {
          const lookPatch = {
            ...(gachaLock?.gachaId
              ? {
                  gachaLock: {
                    gachaId: gachaLock.gachaId,
                    gachaVersion: gachaLock.gachaVersion,
                    evidenceAssetIdBySlot: gachaLock.evidenceAssetIdBySlot,
                    ...(gachaLock.scrapeEnqueued ? { scrapeEnqueued: true as const } : {}),
                  },
                }
              : gachaLock
                ? { gachaLock }
                : {}),
            ...(scrapeEnqueued ? { scrapeEnqueued: true as const } : {}),
          };
          if (nextStage === "planning") {
            await yieldSiteGenerationStage(
              supabase,
              job,
              nextCheckpoint(checkpoint, "planning", lookPatch),
              SITE_GENERATION_PROGRESS.waitingPhotos.pct,
              SITE_GENERATION_PROGRESS.waitingPhotos.label,
            );
            throw new GenerationStageYield("planning");
          }
          if (nextStage !== "media" || !gachaLock?.gachaId) throw invalidGenerationStageState();
          await yieldSiteGenerationStage(
            supabase,
            job,
            nextCheckpoint(checkpoint, "media", lookPatch),
            SITE_GENERATION_PROGRESS["creating-media"].pct,
            "Look locked; continuing with media",
          );
          throw new GenerationStageYield("media");
        },
      },
    );
  } finally {
    watch.stop();
  }
  throw invalidGenerationStageState();
}

async function executeGenerationMedia(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  checkpoint: SiteGenerationCheckpoint,
  invocationSignal?: AbortSignal,
  deferStillWait = false,
): Promise<void> {
  const gachaLock = resumeGachaFromCheckpoint(checkpoint);
  if (!gachaLock?.gachaId) throw invalidGenerationStageState();
  const watch = watchSiteGenerationExecution(supabase, job, invocationSignal);
  const { composeSiteConfigForWebsite } = await import("@/lib/agent/site-config.server");
  try {
    await composeSiteConfigForWebsite(
      supabase,
      job.website_id,
      checkpoint.variantKey ?? "generation-" + job.id,
      {
        sourceEvidenceOnly: false,
        generationMode: "unified",
        executionUnit: "media",
        signal: watch.signal,
        jobClaim: {
          id: job.id,
          attempts: job.attempts,
          claimEpoch: job.claim_epoch,
          runnerId: job.locked_by,
        },
        frozenContext: generationFrozenContext(
          job,
          checkpoint,
          await overlayGenerationEnrichment(supabase, job, checkpoint),
        ),
        resumeGachaLock: gachaLock,
        deferStillWait,
        stillDeadlineAt: Date.now() + STILL_TOTAL_DEADLINE_MS,
        onGachaLockAccepted: async (accepted) => {
          if (accepted.gachaId !== gachaLock.gachaId) throw invalidGenerationStageState();
        },
        onStageCheckpoint: async (nextStage) => {
          if (nextStage !== "media" && nextStage !== "composition")
            throw invalidGenerationStageState();
          await yieldSiteGenerationStage(
            supabase,
            job,
            nextCheckpoint(checkpoint, nextStage, {
              gachaLock,
              ...(checkpoint.scrapeEnqueued ? { scrapeEnqueued: true as const } : {}),
            }),
            nextStage === "media"
              ? SITE_GENERATION_PROGRESS["creating-media"].pct
              : SITE_GENERATION_PROGRESS.composing.pct,
            nextStage === "media"
              ? "Media unit ready; continuing media generation"
              : "Media ready; composing website",
          );
          throw new GenerationStageYield(nextStage);
        },
      },
    );
  } finally {
    watch.stop();
  }
  throw invalidGenerationStageState();
}

async function executeGenerationComposition(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  checkpoint: SiteGenerationCheckpoint,
  invocationSignal?: AbortSignal,
): Promise<void> {
  const watch = watchSiteGenerationExecution(supabase, job, invocationSignal);
  const { composeSiteConfigForWebsite, normalizeWebsiteGenerationCandidate } =
    await import("@/lib/agent/site-config.server");
  let candidateConfig: Record<string, unknown>;
  try {
    candidateConfig = await composeSiteConfigForWebsite(
      supabase,
      job.website_id,
      checkpoint.variantKey ?? "generation-" + job.id,
      {
        generationMode: "unified",
        executionUnit: "composition",
        signal: watch.signal,
        jobClaim: {
          id: job.id,
          attempts: job.attempts,
          claimEpoch: job.claim_epoch,
          runnerId: job.locked_by,
        },
        resumeGachaLock: resumeGachaFromCheckpoint(checkpoint),
        frozenContext: generationFrozenContext(
          job,
          checkpoint,
          await overlayGenerationEnrichment(supabase, job, checkpoint),
        ),
        sourceEvidenceOnly: false,
        writerRepairDefects: checkpoint.defects,
        onProgress: async (message) => {
          const progress = SITE_GENERATION_PROGRESS[siteGenerationStageForMessage(message)];
          await updateJobProgress(
            supabase,
            job.website_id,
            job.id,
            job.attempts,
            progress.pct,
            progress.label,
            job.claim_epoch,
          );
        },
      },
    );
  } finally {
    watch.stop();
  }
  candidateConfig = normalizeWebsiteGenerationCandidate(candidateConfig);
  const candidateSource = candidateConfig.themeSource;
  if (typeof candidateSource !== "string" || !candidateSource.trim())
    throw invalidGenerationStageState();
  const manifest = candidateConfig.mediaManifest as SiteGenerationCheckpoint["mediaManifest"];
  delete candidateConfig.bucket1ValidationInput;
  delete candidateConfig.bucket1ValidationAttestation;
  delete candidateConfig.validationAttestation;
  await yieldSiteGenerationStage(
    supabase,
    job,
    nextCheckpoint(checkpoint, "persistence", {
      candidateConfig,
      mediaManifest: manifest,
      candidateSourceHash: sha256(candidateSource),
      candidateRevision: (checkpoint.candidateRevision ?? 0) + 1,
      defects: undefined,
    }),
    SITE_GENERATION_PROGRESS.saving.pct,
    "Website composed; saving the design",
  );
}

async function executeGenerationValidation(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  checkpoint: SiteGenerationCheckpoint,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const config = checkpoint.candidateConfig;
  const source = config?.themeSource;
  if (!config || typeof source !== "string" || checkpoint.candidateRevision === undefined)
    throw invalidGenerationStageState();
  const candidateConfig = { ...config };
  delete candidateConfig.bucket1ValidationInput;
  delete candidateConfig.bucket1ValidationAttestation;
  delete candidateConfig.validationAttestation;
  await yieldSiteGenerationStage(
    supabase,
    job,
    nextCheckpoint(checkpoint, "persistence", {
      candidateConfig,
      mediaManifest: checkpoint.mediaManifest,
      candidateSourceHash: checkpoint.candidateSourceHash ?? sha256(source),
      candidateRevision: checkpoint.candidateRevision,
      defects: undefined,
    }),
    SITE_GENERATION_PROGRESS.saving.pct,
    "Saving the design",
  );
}

async function executeGenerationPersistence(
  supabase: SupabaseAdmin,
  job: EpochTwoGenerationJob,
  checkpoint: SiteGenerationCheckpoint,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!checkpoint.candidateConfig || !checkpoint.candidateSourceHash)
    throw invalidGenerationStageState();
  const candidateConfig = { ...checkpoint.candidateConfig };
  delete candidateConfig.bucket1ValidationInput;
  delete candidateConfig.bucket1ValidationAttestation;
  delete candidateConfig.validationAttestation;
  const candidateSource = candidateConfig.themeSource;
  if (
    typeof candidateSource !== "string" ||
    sha256(candidateSource) !== checkpoint.candidateSourceHash ||
    checkpoint.candidateRevision === undefined
  )
    throw invalidGenerationStageState();
  signal?.throwIfAborted();
  const { data: renewed, error: renewError } = await supabase.rpc("renew_site_generation_lease", {
    p_job_id: job.id,
    p_claim_epoch: job.claim_epoch,
    p_runner_id: job.locked_by,
    p_lease_seconds: 600,
  });
  if (renewError || renewed !== true)
    throw new DOMException("Generation cancelled or superseded", "AbortError");
  signal?.throwIfAborted();
  const { persistWebsiteGenerationCandidate } = await import("@/lib/agent/site-config.server");
  await runSiteGenerationFinalizerAndNotify({
    supabase,
    websiteId: job.website_id,
    finalize: () =>
      persistWebsiteGenerationCandidate(supabase, job.website_id, candidateConfig, {
        jobClaim: {
          id: job.id,
          attempts: job.attempts,
          claimEpoch: job.claim_epoch,
          runnerId: job.locked_by,
        },
      }),
  });
  // The finalizer atomically inserts the version, attaches media, completes the job, and only
  // then schedules progress broadcast. Never perform a second generic completion settlement.
}

async function executeSiteGenerationJob(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  signal?: AbortSignal,
  options?: { deferStillWait?: boolean },
): Promise<void> {
  const running = await loadRunningJob(
    supabase,
    job.id,
    job.attempts,
    job.claim_epoch,
    job.locked_by,
  );
  if (!running) return;
  const checkpoint = parseSiteGenerationCheckpoint(running.generation_checkpoint, {
    expectedGenerationInputSnapshot: running.generation_input_snapshot,
    expectedGenerationInputHash: running.generation_input_hash ?? undefined,
  });
  assertSiteGenerationAuthority(running, checkpoint);
  const cursorProgress =
    checkpoint.stage === "planning"
      ? SITE_GENERATION_PROGRESS.picking
      : SITE_GENERATION_PROGRESS_BY_CURSOR[checkpoint.stage];
  await updateJobProgress(
    supabase,
    running.website_id,
    running.id,
    running.attempts,
    Math.max(running.progress_pct, cursorProgress.pct),
    cursorProgress.label,
    running.claim_epoch,
  );

  switch (running.generation_stage) {
    case "context":
      await executeGenerationContext(supabase, running, checkpoint);
      return;
    case "planning":
      await executeGenerationPlanning(supabase, running, checkpoint, signal);
      return;
    case "media":
      await executeGenerationMedia(supabase, running, checkpoint, signal, options?.deferStillWait);
      return;
    case "composition":
      await executeGenerationComposition(supabase, running, checkpoint, signal);
      return;
    case "validation": {
      const watch = watchSiteGenerationExecution(supabase, running, signal);
      try {
        await executeGenerationValidation(supabase, running, checkpoint, watch.signal);
      } finally {
        watch.stop();
      }
      return;
    }
    case "persistence":
      await executeGenerationPersistence(supabase, running, checkpoint, signal);
      return;
  }
}

function jobExecutionSignal(
  lease: AbortSignal,
  options: { signal?: AbortSignal; deadlineSignal?: AbortSignal },
): AbortSignal {
  const parts = [lease];
  if (options.signal) parts.push(options.signal);
  if (options.deadlineSignal) parts.push(options.deadlineSignal);
  return parts.length === 1 ? parts[0]! : AbortSignal.any(parts);
}

export async function executeJob(
  supabase: SupabaseAdmin,
  job: BackgroundJobRow,
  options: { signal?: AbortSignal; deadlineSignal?: AbortSignal } = {},
): Promise<void> {
  const running = await loadRunningJob(
    supabase,
    job.id,
    job.attempts,
    job.job_type === JOB_TYPE_ADD_VIDEO || job.job_type === JOB_TYPE_SITE_GENERATION
      ? job.claim_epoch
      : undefined,
    job.job_type === JOB_TYPE_ADD_VIDEO || job.job_type === JOB_TYPE_SITE_GENERATION
      ? job.locked_by
      : undefined,
  );
  if (!running) return;

  let leaseLost = false;
  const leaseController = new AbortController();
  const loseLease = () => {
    leaseLost = true;
    leaseController.abort(new DOMException("Generation lease was lost", "AbortError"));
  };
  const heartbeat = setInterval(() => {
    if (running.job_type === JOB_TYPE_SITE_GENERATION && running.generation_contract_epoch === 2) {
      if (!running.locked_by) {
        loseLease();
        return;
      }
      void Promise.resolve(
        supabase.rpc("renew_site_generation_lease", {
          p_job_id: running.id,
          p_claim_epoch: running.claim_epoch,
          p_runner_id: running.locked_by,
          p_lease_seconds: 600,
        }),
      )
        .then(({ data, error }) => {
          if (error || data !== true) loseLease();
        })
        .catch(() => {
          loseLease();
        });
      return;
    }
    void touchJobLock(
      supabase,
      running.id,
      running.attempts,
      undefined,
      running.job_type === JOB_TYPE_ADD_VIDEO ? running.claim_epoch : undefined,
    ).catch(() => {
      if (running.job_type === JOB_TYPE_ADD_VIDEO) loseLease();
    });
  }, 15_000);
  try {
    if (running.job_type === JOB_TYPE_ENRICHMENT) {
      options.signal?.throwIfAborted();
      options.deadlineSignal?.throwIfAborted();
      await executeEnrichmentPlatformJob(
        supabase,
        running,
        jobExecutionSignal(leaseController.signal, options),
      );
      options.signal?.throwIfAborted();
      options.deadlineSignal?.throwIfAborted();
      return;
    }

    if (running.job_type === JOB_TYPE_SITE_GENERATION) {
      if (leaseLost) throw new DOMException("Generation lease was lost", "AbortError");
      options.signal?.throwIfAborted();
      options.deadlineSignal?.throwIfAborted();
      const executionSignal = jobExecutionSignal(leaseController.signal, options);
      await executeSiteGenerationJob(supabase, running, executionSignal, {
        deferStillWait: Boolean(options.deadlineSignal),
      });
      return;
    }

    if (running.job_type === JOB_TYPE_ADD_VIDEO) {
      if (leaseLost) throw new DOMException("Add Video lease was lost", "AbortError");
      options.signal?.throwIfAborted();
      options.deadlineSignal?.throwIfAborted();
      const executionSignal = jobExecutionSignal(leaseController.signal, options);
      const disposition = await executeAddVideoJob(supabase, running, {}, executionSignal);
      // A completed atomic finalizer wins any concurrent invocation abort. Other dispositions
      // remain cooperative and must not settle after cancellation or lease loss.
      if (disposition.kind !== "complete") executionSignal.throwIfAborted();
      await settleAddVideoDisposition(supabase, running, disposition);
      return;
    }

    throw new Error(`Unknown job type: ${running.job_type}`);
  } catch (error) {
    if (isGenerationStageYield(error)) return;
    if (isAbortError(error)) {
      if (running.job_type === JOB_TYPE_ADD_VIDEO && running.locked_by) {
        const abortClassification = classifyAddVideoAbort({
          leaseLost,
          invocationDeadline: options.deadlineSignal?.aborted === true,
        });
        const { data: interrupted, error: interruptError } = await callSupabaseRpc(
          supabase,
          "interrupt_add_video_job_epoch",
          {
            p_job_id: running.id,
            p_job_attempts: running.attempts,
            p_claim_epoch: running.claim_epoch,
            p_runner_id: running.locked_by,
            p_cause_code: abortClassification.causeCode,
            // SQL treats invocation_deadline as terminal; retry time is ignored for that disposition.
            p_retry_at: abortClassification.terminal
              ? new Date().toISOString()
              : getNextRetryAtIso(running.interruption_count + 1),
          },
        );
        if (interruptError || interrupted !== true) {
          throw new Error("Unable to persist Add Video interruption");
        }
      } else if (
        running.job_type === JOB_TYPE_SITE_GENERATION &&
        running.generation_contract_epoch === 2
      ) {
        const abortClassification = classifySiteGenerationAbort({
          stage: siteGenerationStageFromJob(running),
          error,
          leaseLost,
          invocationDeadline: options.deadlineSignal?.aborted === true,
        });
        const { data: interrupted, error: interruptError } = await supabase.rpc(
          "interrupt_site_generation_epoch",
          {
            p_job_id: running.id,
            p_claim_epoch: running.claim_epoch,
            p_contract_epoch: 2,
            p_cause_code: abortClassification.causeCode,
            p_effect_certainty: abortClassification.effectCertainty,
            p_retry_at: getNextRetryAtIso(running.interruption_count + 1),
            p_status_message: "Generation interrupted; retry scheduled",
            p_event_key: [running.id, running.claim_epoch, "interrupted"].join(":"),
            p_runner_id: running.locked_by ?? undefined,
            p_details: { leaseLost, invocationDeadline: options.deadlineSignal?.aborted === true },
          },
        );
        if (interruptError) throw new Error("Unable to persist site generation interruption");
        // A media callback may have already atomically settled the parent while unwinding.
        if (interrupted !== true) return;
      }
      return;
    }

    const message = error instanceof Error ? error.message : "Job execution failed";
    const latest = await loadRunningJob(
      supabase,
      running.id,
      running.attempts,
      running.job_type === JOB_TYPE_ADD_VIDEO || running.job_type === JOB_TYPE_SITE_GENERATION
        ? running.claim_epoch
        : undefined,
      running.job_type === JOB_TYPE_ADD_VIDEO || running.job_type === JOB_TYPE_SITE_GENERATION
        ? running.locked_by
        : undefined,
    );
    if (!latest) return;

    if (latest.job_type === JOB_TYPE_ADD_VIDEO) {
      await settleAddVideoDisposition(supabase, latest, {
        kind: "retry",
        reasonCode: message || "add_video_execution_failed",
      });
      return;
    }

    if (
      latest.job_type === JOB_TYPE_ENRICHMENT &&
      asPayloadRecord(latest.payload_json).resume_enrichment_finalization === true
    ) {
      await retryEnrichmentFinalization(supabase, latest, message);
      return;
    }

    const settlement = jobFailureSettlement({
      jobType: latest.job_type,
      attempts:
        latest.job_type === JOB_TYPE_SITE_GENERATION
          ? latest.failure_attempts + 1
          : latest.attempts,
      maxAttempts: latest.max_attempts,
      payload: latest.payload_json,
      error,
    });
    const canRetry = settlement.canRetry;
    if (latest.job_type === JOB_TYPE_SITE_GENERATION && latest.generation_contract_epoch === 2) {
      if (isInvalidGenerationCheckpointError(error)) {
        await settleInvalidGenerationCheckpoint(supabase, latest, message);
        return;
      }
      const checkpoint = parseSiteGenerationCheckpoint(latest.generation_checkpoint, {
        expectedGenerationInputSnapshot: latest.generation_input_snapshot ?? undefined,
        expectedGenerationInputHash: latest.generation_input_hash ?? undefined,
      });
      assertSiteGenerationAuthority(latest, checkpoint);
      const generationCanRetry =
        settlement.retryable && latest.stage_attempts + 1 < latest.max_attempts;
      await settleSiteGeneration(supabase, latest, {
        status: generationCanRetry ? "pending" : "failed",
        checkpoint,
        errorMessage: message,
        statusMessage: generationCanRetry
          ? "Generation stage failed; retry scheduled"
          : "Generation failed",
        causeCode: settlement.retryable ? "retryable_application_failure" : "application_failure",
        budgetType: "stage_attempt",
        effectCertainty: "definite_failure",
      });
      return;
    }
    if (latest.job_type === JOB_TYPE_ENRICHMENT) {
      const payload = settlement.payload;
      const enrichmentSettlement = await settleEnrichmentJob(supabase, latest, {
        status: canRetry ? "pending" : "failed",
        payloadJson: payload,
        errorMessage: message,
        statusMessage: canRetry
          ? `Retrying in ${computeRetryLabel(latest.attempts)} (${latest.attempts}/${latest.max_attempts})`
          : "Failed",
        completedAt: canRetry ? undefined : new Date().toISOString(),
      });
      if (!enrichmentSettlement.settled || !enrichmentSettlement.finalizeChain) return;
      const onboarding = await loadEnrichmentOnboarding(supabase, enrichmentSubjectFromJob(latest));
      try {
        await finalizeEnrichmentChain(supabase, latest, onboarding, options.signal);
      } catch (finalizeError) {
        const finalizeMessage =
          finalizeError instanceof Error ? finalizeError.message : "Enrichment finalization failed";
        await retryEnrichmentFinalization(supabase, latest, finalizeMessage);
        return;
      }
      await settleEnrichmentJob(supabase, latest, {
        status: "failed",
        payloadJson: payload,
        errorMessage: message,
        statusMessage: "Failed",
        completedAt: new Date().toISOString(),
      });
      return;
    }
    await markJobFailed(supabase, latest, message, { retryable: settlement.retryable });
  } finally {
    clearInterval(heartbeat);
  }
}
