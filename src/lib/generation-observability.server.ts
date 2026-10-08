import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  BUCKET1_SLO_THRESHOLDS,
  buildGenerationSlos,
  evaluateGenerationAlerts,
  type GenerationObservabilityReport,
  type GenerationProjection,
} from "@/lib/generation-observability";

type AdminClient = SupabaseClient<Database>;
type Job = Database["public"]["Tables"]["background_jobs"]["Row"];
type AttemptEvent = Database["public"]["Tables"]["site_generation_attempt_events"]["Row"];

type ActiveJob = Pick<
  Job,
  | "id"
  | "agent_trace_id"
  | "website_id"
  | "chain_id"
  | "sequence_index"
  | "status"
  | "created_at"
  | "started_at"
  | "completed_at"
  | "generation_stage"
  | "next_retry_at"
  | "lease_expires_at"
>;

function ageSeconds(nowMs: number, value: string | null | undefined): number {
  if (!value) return 0;
  return Math.max(0, Math.floor((nowMs - new Date(value).getTime()) / 1000));
}

function oldestAge(nowMs: number, rows: Array<{ created_at: string }>): number | null {
  return rows.length === 0
    ? null
    : Math.max(...rows.map((row) => ageSeconds(nowMs, row.created_at)));
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? null;
}

function projection(
  name: GenerationProjection["name"],
  rows: ActiveJob[],
  nowMs: number,
  ageFrom: (row: ActiveJob) => string | null = (row) => row.created_at,
): GenerationProjection {
  return {
    name,
    count: rows.length,
    oldestAgeSeconds:
      rows.length === 0 ? null : Math.max(...rows.map((row) => ageSeconds(nowMs, ageFrom(row)))),
    jobIds: rows.slice(0, 50).map((row) => row.id),
  };
}

function requireResult<T>(label: string, result: { data: T | null; error: unknown }): T {
  if (result.error) throw new Error(`Unable to load generation observability ${label}`);
  return result.data ?? ([] as T);
}

export async function collectGenerationObservability(
  supabase: AdminClient,
  observedAt = new Date(),
): Promise<GenerationObservabilityReport> {
  const nowMs = observedAt.getTime();
  const windowStart = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const activeStatuses = ["pending", "running", "finalizing"];

  const [activeResult, terminalResult, eventsResult, cronResult, mediaResult] = await Promise.all([
    supabase
      .from("background_jobs")
      .select(
        "id,agent_trace_id,website_id,chain_id,sequence_index,status,created_at,started_at,completed_at,generation_stage,next_retry_at,lease_expires_at,job_type",
      )
      .in("status", activeStatuses)
      .limit(2000),
    supabase
      .from("background_jobs")
      .select(
        "id,agent_trace_id,website_id,chain_id,sequence_index,status,created_at,started_at,completed_at,generation_stage,next_retry_at,lease_expires_at,error_message,job_type",
      )
      .eq("job_type", "site_generation")
      .gte("completed_at", windowStart)
      .limit(2000),
    supabase
      .from("site_generation_attempt_events")
      .select("*")
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("background_job_cron_health")
      .select("schedule_name,requested_at,responded_at,status_code,timed_out,outcome")
      .eq("schedule_name", "obra-run-background-jobs")
      .gte("requested_at", windowStart)
      .order("requested_at", { ascending: false })
      .limit(2000),
    supabase
      .from("site_generation_media_slots")
      .select(
        "job_id,status,provider_create_count,updated_at,reconciliation_required_at,reconciliation_deadline,provider_name,provider_reservation_id,effect_certainty",
      )
      .gt("provider_create_count", 0)
      .limit(5000),
  ]);

  const allActive = requireResult("active jobs", activeResult) as Array<
    ActiveJob & { job_type: string }
  >;
  const activeGeneration = allActive.filter((job) => job.job_type === "site_generation");
  const terminal = requireResult("terminal jobs", terminalResult);
  const events = requireResult("attempt events", eventsResult) as AttemptEvent[];
  const cron = requireResult("scheduler health", cronResult);
  const media = requireResult("media operations", mediaResult);

  const activeByChain = new Map<string, Array<ActiveJob & { job_type: string }>>();
  const activeEnrichmentWebsites = new Set<string>();
  for (const job of allActive) {
    const chain = activeByChain.get(job.chain_id) ?? [];
    chain.push(job);
    activeByChain.set(job.chain_id, chain);
    if (job.job_type === "enrichment_platform" && job.website_id) {
      activeEnrichmentWebsites.add(job.website_id);
    }
  }

  const backoffWaiting: ActiveJob[] = [];
  const dependencyBlocked: ActiveJob[] = [];
  const runnablePending: ActiveJob[] = [];
  const staleRunning = activeGeneration.filter(
    (job) =>
      job.status === "running" &&
      Boolean(job.lease_expires_at) &&
      new Date(job.lease_expires_at!).getTime() <= nowMs,
  );

  for (const job of activeGeneration.filter((candidate) => candidate.status === "pending")) {
    if (job.next_retry_at && new Date(job.next_retry_at).getTime() > nowMs) {
      backoffWaiting.push(job);
      continue;
    }
    const blockedByPredecessor = (activeByChain.get(job.chain_id) ?? []).some(
      (candidate) => candidate.sequence_index < job.sequence_index,
    );
    if (
      blockedByPredecessor ||
      (job.website_id != null && activeEnrichmentWebsites.has(job.website_id))
    ) {
      dependencyBlocked.push(job);
    } else {
      runnablePending.push(job);
    }
  }

  const latestEventByJob = new Map<string, AttemptEvent>();
  for (const event of events) {
    if (!latestEventByJob.has(event.job_id)) latestEventByJob.set(event.job_id, event);
  }
  const reconciliationSlots = media.filter(
    (slot) =>
      slot.status === "reconciliation_required" && slot.effect_certainty === "indeterminate",
  );
  const activeById = new Map(activeGeneration.map((job) => [job.id, job]));
  const reconciliationRequired: ActiveJob[] = reconciliationSlots.map(
    (slot) =>
      activeById.get(slot.job_id) ??
      ({
        id: slot.job_id,
        agent_trace_id: null,
        website_id: "",
        chain_id: "",
        sequence_index: 0,
        status: "pending",
        created_at: slot.reconciliation_required_at ?? slot.updated_at,
        started_at: null,
        completed_at: null,
        generation_stage: "media",
        next_retry_at: null,
        lease_expires_at: null,
      } as ActiveJob),
  );

  const latestCron = cron[0];
  const schedulerSilenceSeconds = latestCron?.requested_at
    ? ageSeconds(nowMs, latestCron.requested_at)
    : BUCKET1_SLO_THRESHOLDS.schedulerSilenceSeconds + 1;
  const schedulerSilent = schedulerSilenceSeconds > BUCKET1_SLO_THRESHOLDS.schedulerSilenceSeconds;

  const stageDurations = events.flatMap((event) =>
    event.started_at && event.completed_at
      ? [
          Math.max(
            0,
            (new Date(event.completed_at).getTime() - new Date(event.started_at).getTime()) / 1000,
          ),
        ]
      : [],
  );
  const terminalDurations = terminal.flatMap((job) =>
    job.completed_at
      ? [
          Math.max(
            0,
            (new Date(job.completed_at).getTime() - new Date(job.created_at).getTime()) / 1000,
          ),
        ]
      : [],
  );
  const reconciliationAges = reconciliationSlots.map((slot) =>
    ageSeconds(nowMs, slot.reconciliation_required_at ?? slot.updated_at),
  );
  const reconciliationEndToEndAges = reconciliationRequired.map((job) =>
    ageSeconds(nowMs, job.created_at),
  );

  const schedulerSucceeded = cron.filter((row) => row.outcome === "succeeded").length;
  const schedulerDeliveryRate = cron.length === 0 ? null : schedulerSucceeded / cron.length;
  const providerCreates = media.reduce((sum, row) => sum + row.provider_create_count, 0);
  const providerFailures = media
    .filter((row) => row.status === "failed" || row.status === "abandoned")
    .reduce((sum, row) => sum + row.provider_create_count, 0);
  const providerIndeterminate = events.filter(
    (event) =>
      event.effect_certainty === "indeterminate" && (event.cause_code ?? "").includes("provider"),
  ).length;
  const providerFailureRate =
    providerCreates === 0
      ? null
      : Math.min(1, (providerFailures + providerIndeterminate) / providerCreates);
  const exhausted = terminal.filter(
    (job) => job.status === "failed" && /exhaust/i.test(job.error_message ?? ""),
  ).length;
  const exhaustionRate = terminal.length === 0 ? null : exhausted / terminal.length;

  const runnableQueueAgeSeconds = oldestAge(nowMs, runnablePending);
  const staleRecoveryAgeSeconds =
    staleRunning.length === 0
      ? null
      : Math.max(...staleRunning.map((job) => ageSeconds(nowMs, job.lease_expires_at)));
  const stageLatencyP95Seconds = percentile(stageDurations, 0.95);
  const endToEndLatencyP95Seconds = percentile(terminalDurations, 0.95);
  const reconciliationAgeSeconds = reconciliationAges.length
    ? Math.max(...reconciliationAges)
    : null;
  const reconciliationEndToEndSeconds = reconciliationEndToEndAges.length
    ? Math.max(...reconciliationEndToEndAges)
    : null;

  const projections: GenerationProjection[] = [
    projection("runnable-pending", runnablePending, nowMs),
    projection("dependency-blocked", dependencyBlocked, nowMs),
    projection("backoff-waiting", backoffWaiting, nowMs, (job) => job.next_retry_at),
    projection("stale-running", staleRunning, nowMs, (job) => job.lease_expires_at),
    {
      name: "scheduler-silent",
      count: schedulerSilent ? 1 : 0,
      oldestAgeSeconds: schedulerSilenceSeconds,
      jobIds: [],
    },
    projection(
      "reconciliation-required",
      reconciliationRequired,
      nowMs,
      (job) =>
        reconciliationSlots.find((slot) => slot.job_id === job.id)?.reconciliation_required_at ??
        job.created_at,
    ),
  ];

  const slos = buildGenerationSlos({
    schedulerDeliveryRate,
    schedulerSamples: cron.length,
    runnableQueueAgeSeconds,
    runnableSamples: runnablePending.length,
    staleRecoveryAgeSeconds,
    staleSamples: staleRunning.length,
    stageLatencyP95Seconds,
    stageSamples: stageDurations.length,
    endToEndLatencyP95Seconds,
    terminalSamples: terminalDurations.length,
    reconciliationAgeSeconds,
    reconciliationSamples: reconciliationAges.length,
    providerFailureRate,
    providerSamples: providerCreates,
    exhaustionRate,
    exhaustionSamples: terminal.length,
  });

  const alerts = evaluateGenerationAlerts({
    observedAt: observedAt.toISOString(),
    schedulerSilenceSeconds,
    schedulerDeliveryRate: schedulerDeliveryRate ?? 0,
    schedulerSamples: cron.length,
    runnableQueueAgeSeconds: runnableQueueAgeSeconds ?? 0,
    staleRecoveryAgeSeconds: staleRecoveryAgeSeconds ?? 0,
    stageLatencyP95Seconds: stageLatencyP95Seconds ?? 0,
    endToEndLatencyP95Seconds: endToEndLatencyP95Seconds ?? 0,
    reconciliationAgeSeconds: reconciliationAgeSeconds ?? 0,
    reconciliationEndToEndSeconds: reconciliationEndToEndSeconds ?? 0,
    providerFailureRate: providerFailureRate ?? 0,
    providerSamples: providerCreates,
    exhaustionRate: exhaustionRate ?? 0,
    exhaustionSamples: terminal.length,
  });

  const traceByJob = new Map(
    [...activeGeneration, ...terminal].map((job) => [job.id, job.agent_trace_id] as const),
  );
  const recentFailures = events
    .filter((event) => event.severity === "error" || event.effect_certainty === "indeterminate")
    .slice(0, 100)
    .map((event) => ({
      jobId: event.job_id,
      traceId: traceByJob.get(event.job_id) ?? null,
      stage: event.stage,
      cause: event.cause_code,
      effectCertainty: event.effect_certainty,
      disposition: event.disposition,
      occurredAt: event.created_at,
    }));

  return { observedAt: observedAt.toISOString(), projections, slos, alerts, recentFailures };
}
