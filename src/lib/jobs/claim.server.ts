import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import type { BackgroundJobRow } from "./types";

type SupabaseAdmin = SupabaseClient<Database>;

const RUNNER_ID = `obra-runner-${typeof process !== "undefined" ? (process.env.NODE_ENV ?? "dev") : "dev"}`;

export async function claimNextJob(
  supabase: SupabaseAdmin,
  schedulerRunId = crypto.randomUUID(),
): Promise<BackgroundJobRow | null> {
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("claim_next_background_job", {
    p_runner_id: RUNNER_ID,
    p_stale_before: staleBefore,
    p_generation_contract_epoch: 2,
    p_scheduler_run_id: schedulerRunId,
  });
  if (error) {
    console.error("[claimNextJob]", error);
    throw new Error("Unable to claim eligible background job");
  }
  return Array.isArray(data) && data.length > 0 ? (data[0] as BackgroundJobRow) : null;
}

export async function touchJobLock(
  supabase: SupabaseAdmin,
  jobId: string,
  attempts: number,
  extras?: { progressPct?: number; statusMessage?: string },
  claimEpoch?: number,
): Promise<void> {
  const patch: {
    locked_at: string;
    progress_pct?: number;
    status_message?: string;
  } = {
    locked_at: new Date().toISOString(),
  };
  if (typeof extras?.progressPct === "number") patch.progress_pct = extras.progressPct;
  if (extras?.statusMessage) patch.status_message = extras.statusMessage;

  let update = supabase
    .from("background_jobs")
    .update(patch)
    .eq("id", jobId)
    .in("status", ["running", "finalizing"])
    .eq("attempts", attempts);
  if (claimEpoch !== undefined) update = update.eq("claim_epoch", claimEpoch);
  const { data, error } = await update
    .lte("progress_pct", extras?.progressPct ?? 100)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[touchJobLock]", error);
    throw new DOMException("Generation cancelled or superseded", "AbortError");
  }
  if (!data && extras?.progressPct !== undefined) {
    let ownership = supabase
      .from("background_jobs")
      .select("id")
      .eq("id", jobId)
      .in("status", ["running", "finalizing"])
      .eq("attempts", attempts);
    if (claimEpoch !== undefined) ownership = ownership.eq("claim_epoch", claimEpoch);
    const { data: stillOwned } = await ownership.maybeSingle();
    if (stillOwned) return;
  }
  if (!data) throw new DOMException("Generation cancelled or superseded", "AbortError");
}
