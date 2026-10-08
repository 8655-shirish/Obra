export const BUCKET1_SLO_THRESHOLDS = {
  schedulerSilenceSeconds: 180,
  schedulerDeliveryRate: 0.99,
  runnableQueueAgeSeconds: 300,
  staleRecoveryAgeSeconds: 120,
  stageLatencyP95Seconds: 900,
  endToEndLatencyP95Seconds: 1800,
  reconciliationAgeSeconds: 900,
  reconciliationEndToEndSeconds: 3600,
  providerFailureRate: 0.1,
  exhaustionRate: 0.05,
  minimumRateSample: 5,
} as const;

export const BUCKET1_ALERT_OWNER = "Generation on-call";
export const BUCKET1_ALERT_CHANNEL = "#obra-generation-oncall";
export const BUCKET1_RUNBOOK_PATH = "docs/runbooks/bucket1-generation.md";

export type GenerationProjectionName =
  | "runnable-pending"
  | "dependency-blocked"
  | "backoff-waiting"
  | "stale-running"
  | "scheduler-silent"
  | "reconciliation-required";

export interface GenerationProjection {
  name: GenerationProjectionName;
  count: number;
  oldestAgeSeconds: number | null;
  jobIds: string[];
}

export interface GenerationSloMetric {
  id: string;
  label: string;
  value: number | null;
  unit: "seconds" | "ratio";
  threshold: number;
  comparator: "lte" | "gte";
  sampleSize: number;
  passing: boolean | null;
}

export interface GenerationAlertState {
  id: string;
  status: "firing" | "resolved";
  severity: "warning" | "critical";
  summary: string;
  value: number;
  threshold: number;
  unit: "seconds" | "ratio" | "count";
  owner: typeof BUCKET1_ALERT_OWNER;
  channel: typeof BUCKET1_ALERT_CHANNEL;
  dedupeKey: string;
  runbook: typeof BUCKET1_RUNBOOK_PATH;
  observedAt: string;
}

export interface GenerationObservabilityReport {
  observedAt: string;
  projections: GenerationProjection[];
  slos: GenerationSloMetric[];
  alerts: GenerationAlertState[];
  recentFailures: Array<{
    jobId: string;
    traceId: string | null;
    stage: string | null;
    cause: string | null;
    effectCertainty: string;
    disposition: string;
    occurredAt: string;
  }>;
}

function metric(
  id: string,
  label: string,
  value: number | null,
  unit: "seconds" | "ratio",
  threshold: number,
  comparator: "lte" | "gte",
  sampleSize: number,
): GenerationSloMetric {
  return {
    id,
    label,
    value,
    unit,
    threshold,
    comparator,
    sampleSize,
    passing: value == null ? null : comparator === "lte" ? value <= threshold : value >= threshold,
  };
}

export function buildGenerationSlos(input: {
  schedulerDeliveryRate: number | null;
  schedulerSamples: number;
  runnableQueueAgeSeconds: number | null;
  runnableSamples: number;
  staleRecoveryAgeSeconds: number | null;
  staleSamples: number;
  stageLatencyP95Seconds: number | null;
  stageSamples: number;
  endToEndLatencyP95Seconds: number | null;
  terminalSamples: number;
  reconciliationAgeSeconds: number | null;
  reconciliationSamples: number;
  providerFailureRate: number | null;
  providerSamples: number;
  exhaustionRate: number | null;
  exhaustionSamples: number;
}): GenerationSloMetric[] {
  return [
    metric(
      "scheduler-delivery",
      "Scheduler delivery",
      input.schedulerDeliveryRate,
      "ratio",
      BUCKET1_SLO_THRESHOLDS.schedulerDeliveryRate,
      "gte",
      input.schedulerSamples,
    ),
    metric(
      "runnable-queue-age",
      "Runnable queue age",
      input.runnableQueueAgeSeconds,
      "seconds",
      BUCKET1_SLO_THRESHOLDS.runnableQueueAgeSeconds,
      "lte",
      input.runnableSamples,
    ),
    metric(
      "stale-recovery-age",
      "Stale-running recovery age",
      input.staleRecoveryAgeSeconds,
      "seconds",
      BUCKET1_SLO_THRESHOLDS.staleRecoveryAgeSeconds,
      "lte",
      input.staleSamples,
    ),
    metric(
      "stage-latency-p95",
      "Stage latency p95",
      input.stageLatencyP95Seconds,
      "seconds",
      BUCKET1_SLO_THRESHOLDS.stageLatencyP95Seconds,
      "lte",
      input.stageSamples,
    ),
    metric(
      "end-to-end-latency-p95",
      "End-to-end latency p95",
      input.endToEndLatencyP95Seconds,
      "seconds",
      BUCKET1_SLO_THRESHOLDS.endToEndLatencyP95Seconds,
      "lte",
      input.terminalSamples,
    ),
    metric(
      "reconciliation-age",
      "Reconciliation-required age",
      input.reconciliationAgeSeconds,
      "seconds",
      BUCKET1_SLO_THRESHOLDS.reconciliationAgeSeconds,
      "lte",
      input.reconciliationSamples,
    ),
    metric(
      "provider-failure-rate",
      "Provider failure / indeterminate rate",
      input.providerFailureRate,
      "ratio",
      BUCKET1_SLO_THRESHOLDS.providerFailureRate,
      "lte",
      input.providerSamples,
    ),
    metric(
      "exhaustion-rate",
      "Exhaustion rate",
      input.exhaustionRate,
      "ratio",
      BUCKET1_SLO_THRESHOLDS.exhaustionRate,
      "lte",
      input.exhaustionSamples,
    ),
  ];
}

const ALERT_SEVERITY: Record<string, "warning" | "critical"> = {
  "scheduler-silence": "critical",
  "scheduler-delivery": "warning",
  "runnable-queue-age": "critical",
  "stale-recovery-age": "critical",
  "stage-latency-p95": "warning",
  "end-to-end-latency-p95": "warning",
  "reconciliation-age": "critical",
  "reconciliation-end-to-end": "critical",
  "provider-failure-rate": "warning",
  "exhaustion-rate": "critical",
};

function alertState(input: {
  id: string;
  summary: string;
  firing: boolean;
  value: number;
  threshold: number;
  unit: "seconds" | "ratio" | "count";
  observedAt: string;
}): GenerationAlertState {
  return {
    id: input.id,
    status: input.firing ? "firing" : "resolved",
    severity: ALERT_SEVERITY[input.id] ?? "warning",
    summary: input.summary,
    value: input.value,
    threshold: input.threshold,
    unit: input.unit,
    owner: BUCKET1_ALERT_OWNER,
    channel: BUCKET1_ALERT_CHANNEL,
    dedupeKey: `bucket1-generation:${input.id}`,
    runbook: BUCKET1_RUNBOOK_PATH,
    observedAt: input.observedAt,
  };
}

export function evaluateGenerationAlerts(input: {
  observedAt: string;
  schedulerSilenceSeconds: number;
  schedulerDeliveryRate: number;
  schedulerSamples: number;
  runnableQueueAgeSeconds: number;
  staleRecoveryAgeSeconds: number;
  stageLatencyP95Seconds: number;
  endToEndLatencyP95Seconds: number;
  reconciliationAgeSeconds: number;
  reconciliationEndToEndSeconds: number;
  providerFailureRate: number;
  providerSamples: number;
  exhaustionRate: number;
  exhaustionSamples: number;
}): GenerationAlertState[] {
  const t = BUCKET1_SLO_THRESHOLDS;
  return [
    alertState({
      id: "scheduler-silence",
      summary: "Independent monitor has not observed the background-job scheduler",
      firing: input.schedulerSilenceSeconds > t.schedulerSilenceSeconds,
      value: input.schedulerSilenceSeconds,
      threshold: t.schedulerSilenceSeconds,
      unit: "seconds",
      observedAt: input.observedAt,
    }),
    alertState({
      id: "scheduler-delivery",
      summary: "Background-job scheduler delivery rate is below its SLO",
      firing:
        input.schedulerSamples >= t.minimumRateSample &&
        input.schedulerDeliveryRate < t.schedulerDeliveryRate,
      value: input.schedulerDeliveryRate,
      threshold: t.schedulerDeliveryRate,
      unit: "ratio",
      observedAt: input.observedAt,
    }),
    alertState({
      id: "runnable-queue-age",
      summary: "Runnable generation work is waiting beyond its SLO",
      firing: input.runnableQueueAgeSeconds > t.runnableQueueAgeSeconds,
      value: input.runnableQueueAgeSeconds,
      threshold: t.runnableQueueAgeSeconds,
      unit: "seconds",
      observedAt: input.observedAt,
    }),
    alertState({
      id: "stale-recovery-age",
      summary: "Expired generation leases have not recovered",
      firing: input.staleRecoveryAgeSeconds > t.staleRecoveryAgeSeconds,
      value: input.staleRecoveryAgeSeconds,
      threshold: t.staleRecoveryAgeSeconds,
      unit: "seconds",
      observedAt: input.observedAt,
    }),
    alertState({
      id: "stage-latency-p95",
      summary: "Generation stage latency p95 exceeds its SLO",
      firing: input.stageLatencyP95Seconds > t.stageLatencyP95Seconds,
      value: input.stageLatencyP95Seconds,
      threshold: t.stageLatencyP95Seconds,
      unit: "seconds",
      observedAt: input.observedAt,
    }),
    alertState({
      id: "end-to-end-latency-p95",
      summary: "Generation end-to-end latency p95 exceeds its SLO",
      firing: input.endToEndLatencyP95Seconds > t.endToEndLatencyP95Seconds,
      value: input.endToEndLatencyP95Seconds,
      threshold: t.endToEndLatencyP95Seconds,
      unit: "seconds",
      observedAt: input.observedAt,
    }),
    alertState({
      id: "reconciliation-age",
      summary: "Generation reconciliation has exceeded its owner-response SLO",
      firing: input.reconciliationAgeSeconds > t.reconciliationAgeSeconds,
      value: input.reconciliationAgeSeconds,
      threshold: t.reconciliationAgeSeconds,
      unit: "seconds",
      observedAt: input.observedAt,
    }),
    alertState({
      id: "reconciliation-end-to-end",
      summary: "A reconciliation-required job has exceeded time-to-terminal",
      firing: input.reconciliationEndToEndSeconds > t.reconciliationEndToEndSeconds,
      value: input.reconciliationEndToEndSeconds,
      threshold: t.reconciliationEndToEndSeconds,
      unit: "seconds",
      observedAt: input.observedAt,
    }),
    alertState({
      id: "provider-failure-rate",
      summary: "Provider failure / indeterminate rate exceeds its SLO",
      firing:
        input.providerSamples >= t.minimumRateSample &&
        input.providerFailureRate > t.providerFailureRate,
      value: input.providerFailureRate,
      threshold: t.providerFailureRate,
      unit: "ratio",
      observedAt: input.observedAt,
    }),
    alertState({
      id: "exhaustion-rate",
      summary: "Generation exhaustion rate exceeds its SLO",
      firing:
        input.exhaustionSamples >= t.minimumRateSample && input.exhaustionRate > t.exhaustionRate,
      value: input.exhaustionRate,
      threshold: t.exhaustionRate,
      unit: "ratio",
      observedAt: input.observedAt,
    }),
  ];
}

export async function deliverGenerationAlertStates(input: {
  webhookUrl: string;
  webhookToken?: string;
  alerts: GenerationAlertState[];
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.webhookToken ? { authorization: `Bearer ${input.webhookToken}` } : {}),
    },
    body: JSON.stringify({
      source: "obra.bucket1.generation",
      owner: BUCKET1_ALERT_OWNER,
      channel: BUCKET1_ALERT_CHANNEL,
      alerts: input.alerts,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Generation alert delivery failed with ${response.status}`);
  return { delivered: input.alerts.length, destination: BUCKET1_ALERT_CHANNEL };
}
