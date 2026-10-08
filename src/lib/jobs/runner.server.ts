import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import { claimNextJob } from "./claim.server";
import { executeJob } from "./execute.server";

type SupabaseAdmin = SupabaseClient<Database>;

const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_INVOCATION_BUDGET_MS = 50_000;
const DEFAULT_SETTLEMENT_RESERVE_MS = 5_000;

/**
 * Process eligible background jobs sequentially (claim → execute → repeat).
 * Each invocation claims at most one bounded unit by default and preserves settlement headroom.
 *
 * Investigated (RCA on "are firecrawl results actually used"): this loop already
 * re-queries eligibility fresh on every iteration, so a single call already drains any
 * job that becomes eligible mid-batch (e.g. site_generation right after its website's last
 * enrichment_platform job completes) — no change needed here for that case. The only
 * remaining batch limit is deliberate: the authenticated POST /api/internal/run-jobs endpoint
 * must be invoked by the deployment scheduler, and later invocations continue draining. Jobs
 * carrying next_retry_at remain durable and are skipped until due. Process-local timers are not
 * used as a reliability mechanism.
 */
export type BackgroundJobBatchResult = {
  processed: number;
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
};

export async function runBackgroundJobBatch(
  supabase: SupabaseAdmin,
  maxJobs = DEFAULT_BATCH_SIZE,
  options?: { invocationBudgetMs?: number; settlementReserveMs?: number },
): Promise<BackgroundJobBatchResult> {
  const startedAt = Date.now();
  const invocationBudgetMs = options?.invocationBudgetMs ?? DEFAULT_INVOCATION_BUDGET_MS;
  const settlementReserveMs = options?.settlementReserveMs ?? DEFAULT_SETTLEMENT_RESERVE_MS;
  const operationDeadlineAt = startedAt + invocationBudgetMs - settlementReserveMs;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(
    () =>
      deadlineController.abort(
        new DOMException("Background job invocation deadline exceeded", "AbortError"),
      ),
    Math.max(0, operationDeadlineAt - Date.now()),
  );
  const result: BackgroundJobBatchResult = {
    processed: 0,
    claimed: 0,
    completed: 0,
    retried: 0,
    failed: 0,
  };

  const schedulerRunId = crypto.randomUUID();
  try {
    const { error: capabilityError } = await supabase.rpc(
      "heartbeat_background_job_runner_capability" as never,
      {
        p_runner_id: `obra-runner-${process.env.NODE_ENV ?? "dev"}`,
        p_capability: 2,
        p_browser_ready: false,
      } as never,
    );
    if (capabilityError)
      console.error("[runBackgroundJobBatch] capability heartbeat", capabilityError);

    // Maintenance is deliberately outside claim_next_background_job: one malformed or locked
    // recovery row must never roll back or block an unrelated claim transaction.
    const { error: maintenanceError } = await supabase.rpc(
      "maintain_background_job_lifecycle" as never,
      {
        p_stale_before: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        p_scheduler_run_id: schedulerRunId,
        p_limit: 25,
      } as never,
    );
    if (maintenanceError)
      console.error("[runBackgroundJobBatch] lifecycle maintenance", maintenanceError);

    for (let i = 0; i < maxJobs && Date.now() < operationDeadlineAt; i++) {
      const claimed = await claimNextJob(supabase, schedulerRunId);
      if (!claimed) break;
      result.claimed += 1;

      await executeJob(supabase, claimed, { deadlineSignal: deadlineController.signal });
      result.processed += 1;

      const { data, error } = await supabase
        .from("background_jobs")
        .select("status")
        .eq("id", claimed.id)
        .maybeSingle();
      if (error || !data) {
        throw new Error("Unable to inspect background job settlement");
      }
      const status = data.status;
      if (status === "completed") result.completed += 1;
      else if (status === "failed" || status === "cancelled") result.failed += 1;
      else if (status === "pending") result.retried += 1;
    }

    return result;
  } finally {
    clearTimeout(deadlineTimer);
  }
}
