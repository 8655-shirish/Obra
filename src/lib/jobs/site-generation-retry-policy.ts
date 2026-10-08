export type SiteGenerationRetryCause =
  | "worker_interrupted"
  | "lease_lost"
  | "deadline_expired"
  | "deployment_terminated"
  | "oom"
  | "process_crash"
  | "transport_aborted"
  | "provider_auth"
  | "provider_rate_limit"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_contract"
  | "provider_indeterminate_acceptance"
  | "parse"
  | "schema"
  | "instruction_conflict"
  | "media_reserve"
  | "media_create"
  | "media_validation"
  | "media_duplicate"
  | "media_storage"
  | "media_persistence"
  | "syntax"
  | "compile_policy"
  | "bindings"
  | "contact"
  | "groundable_truth"
  | "provenance_proof"
  | "manifest_schema"
  | "runtime"
  | "accessibility"
  | "overflow"
  | "clipping"
  | "overlap"
  | "media_containment"
  | "responsive"
  | "lead_action"
  | "checkpoint"
  | "event"
  | "version"
  | "result_replay"
  | "source_authorization_revocation"
  | "ownership_revision_conflict";

export type SiteGenerationRetryDisposition =
  "resume" | "retry" | "writer_repair" | "reconcile" | "manual" | "terminal";
export type SiteGenerationRetryBudget =
  "none" | "interruption" | "stage_attempt" | "writer_repair" | "provider_create" | "finalization";

export type SiteGenerationRetryPolicy = {
  version: 1;
  disposition: SiteGenerationRetryDisposition;
  budgetType: SiteGenerationRetryBudget;
  budget: number;
  baseDelayMs: number;
  capDelayMs: number;
  jitterRatio: number;
  honorsRetryAfter: boolean;
  resetRule: string;
  statusText: string;
  alert: "none" | "warning" | "critical";
};

const P = (overrides: Partial<SiteGenerationRetryPolicy> = {}): SiteGenerationRetryPolicy => ({
  version: 1,
  disposition: "retry",
  budgetType: "stage_attempt",
  budget: 3,
  baseDelayMs: 1_000,
  capDelayMs: 30_000,
  jitterRatio: 0.2,
  honorsRetryAfter: true,
  resetRule: "reset only after the stage commits its output checkpoint",
  statusText: "Retry scheduled",
  alert: "warning",
  ...overrides,
});

const causes = [
  "worker_interrupted",
  "lease_lost",
  "deadline_expired",
  "deployment_terminated",
  "oom",
  "process_crash",
  "transport_aborted",
  "provider_auth",
  "provider_rate_limit",
  "provider_timeout",
  "provider_unavailable",
  "provider_contract",
  "provider_indeterminate_acceptance",
  "parse",
  "schema",
  "instruction_conflict",
  "media_reserve",
  "media_create",
  "media_validation",
  "media_duplicate",
  "media_storage",
  "media_persistence",
  "syntax",
  "compile_policy",
  "bindings",
  "contact",
  "groundable_truth",
  "provenance_proof",
  "manifest_schema",
  "runtime",
  "accessibility",
  "overflow",
  "clipping",
  "overlap",
  "media_containment",
  "responsive",
  "lead_action",
  "checkpoint",
  "event",
  "version",
  "result_replay",
  "source_authorization_revocation",
  "ownership_revision_conflict",
] as const satisfies readonly SiteGenerationRetryCause[];

export const SITE_GENERATION_RETRY_POLICY_VERSION = 1 as const;
export const SITE_GENERATION_RETRY_POLICIES: Readonly<
  Record<SiteGenerationRetryCause, SiteGenerationRetryPolicy>
> = Object.freeze(
  Object.fromEntries(causes.map((cause) => [cause, P()])) as Record<
    SiteGenerationRetryCause,
    SiteGenerationRetryPolicy
  >,
);

Object.assign(
  SITE_GENERATION_RETRY_POLICIES.worker_interrupted,
  P({
    disposition: "resume",
    budgetType: "interruption",
    budget: 4,
    statusText: "Resuming interrupted work",
  }),
);
Object.assign(
  SITE_GENERATION_RETRY_POLICIES.lease_lost,
  P({
    disposition: "resume",
    budgetType: "none",
    budget: 0,
    baseDelayMs: 0,
    jitterRatio: 0,
    honorsRetryAfter: false,
    statusText: "Ownership changed; resuming checkpoint",
    alert: "none",
  }),
);
for (const cause of ["provider_indeterminate_acceptance", "media_persistence"] as const)
  Object.assign(
    SITE_GENERATION_RETRY_POLICIES[cause],
    P({
      disposition: "reconcile",
      budgetType: "provider_create",
      budget: 2,
      statusText: "Provider reconciliation required",
      alert: "critical",
    }),
  );
for (const cause of [
  "syntax",
  "compile_policy",
  "bindings",
  "contact",
  "groundable_truth",
  "provenance_proof",
  "manifest_schema",
  "overflow",
  "clipping",
  "overlap",
  "media_containment",
  "responsive",
  "lead_action",
] as const)
  Object.assign(
    SITE_GENERATION_RETRY_POLICIES[cause],
    P({
      disposition: "writer_repair",
      budgetType: "writer_repair",
      budget: 2,
      statusText: "Repairing measured candidate defects",
    }),
  );
for (const cause of [
  "provider_auth",
  "instruction_conflict",
  "source_authorization_revocation",
  "ownership_revision_conflict",
] as const)
  Object.assign(
    SITE_GENERATION_RETRY_POLICIES[cause],
    P({
      disposition: "terminal",
      budgetType: "none",
      budget: 0,
      baseDelayMs: 0,
      jitterRatio: 0,
      honorsRetryAfter: false,
      statusText: "Generation stopped",
      alert: "critical",
    }),
  );

export function retryPolicyFor(cause: SiteGenerationRetryCause): SiteGenerationRetryPolicy {
  return SITE_GENERATION_RETRY_POLICIES[cause];
}

export function retryDelayMs(options: {
  cause: SiteGenerationRetryCause;
  attempt: number;
  retryAfterMs?: number;
  jitterSample?: number;
}): number {
  const policy = retryPolicyFor(options.cause);
  if (policy.baseDelayMs === 0) return 0;
  if (
    policy.honorsRetryAfter &&
    Number.isFinite(options.retryAfterMs) &&
    options.retryAfterMs! >= 0
  )
    return Math.min(options.retryAfterMs!, policy.capDelayMs);
  const raw = Math.min(
    policy.baseDelayMs * 2 ** Math.max(0, options.attempt - 1),
    policy.capDelayMs,
  );
  const sample = Math.max(0, Math.min(1, options.jitterSample ?? 0.5));
  return Math.round(raw * (1 + policy.jitterRatio * (sample * 2 - 1)));
}
