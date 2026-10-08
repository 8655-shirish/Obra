import type { BackgroundJobRow, JobChainProgress, JobProgressSnapshot } from "./types";

function buildChainProgress(jobs: BackgroundJobRow[]): JobChainProgress {
  const sorted = [...jobs].sort((a, b) => a.sequence_index - b.sequence_index);
  const chainId = sorted[0]?.chain_id ?? "";
  const jobType = sorted[0]?.job_type ?? "";

  const totalSteps = sorted.length;
  const completedSteps = sorted.filter((j) => j.status === "completed").length;
  const runningJob = sorted.find((j) => j.status === "running" || j.status === "finalizing");
  const failedJobs = sorted.filter((j) => j.status === "failed");

  let aggregateProgressPct = 0;
  if (totalSteps > 0) {
    const stepContribution = sorted.reduce((sum, job) => sum + job.progress_pct, 0) / totalSteps;
    aggregateProgressPct = Math.round(stepContribution);
  }

  const allCompleted = totalSteps > 0 && sorted.every((j) => j.status === "completed");
  const hasCancelled = sorted.some((j) => j.status === "cancelled");
  const hasSuperseded = sorted.some((j) => j.status === "superseded");
  const hasFailed = failedJobs.length > 0;
  const hasFinalizing = sorted.some((job) => job.status === "finalizing");
  const hasRunning = sorted.some((job) => job.status === "running");
  const hasPending = sorted.some((job) => job.status === "pending");
  const state = hasFinalizing
    ? "finalizing"
    : hasRunning
      ? "running"
      : hasPending
        ? "queued"
        : hasFailed
          ? "failed"
          : hasSuperseded
            ? "superseded"
            : hasCancelled
              ? "cancelled"
              : allCompleted
                ? "completed"
                : "failed";
  const hasActiveWork = sorted.some(
    (j) => j.status === "pending" || j.status === "running" || j.status === "finalizing",
  );
  const statusMessage =
    runningJob?.status_message ??
    sorted.find((j) => j.status === "pending")?.status_message ??
    (hasFailed ? failedJobs.at(-1)?.error_message : null) ??
    sorted.at(-1)?.status_message ??
    null;

  return {
    chainId,
    state,
    jobType,
    jobs: sorted,
    aggregateProgressPct,
    statusMessage,
    isComplete: allCompleted,
    isCancelled: state === "cancelled",
    hasFailed,
    hasActiveWork,
  };
}

function isVisibleChain(chain: JobChainProgress): boolean {
  if (chain.isCancelled || chain.isComplete) return false;
  return chain.hasActiveWork;
}

export function buildJobProgressSnapshot(
  websiteId: string,
  jobs: BackgroundJobRow[],
): JobProgressSnapshot {
  const byChain = new Map<string, BackgroundJobRow[]>();

  for (const job of jobs) {
    const list = byChain.get(job.chain_id) ?? [];
    list.push(job);
    byChain.set(job.chain_id, list);
  }

  const chains = [...byChain.values()].map(buildChainProgress);
  chains.sort((a, b) => {
    const aCreated = a.jobs[0]?.created_at ?? "";
    const bCreated = b.jobs[0]?.created_at ?? "";
    const aFirstJobId = a.jobs[0]?.id ?? "";
    const bFirstJobId = b.jobs[0]?.id ?? "";
    return bCreated.localeCompare(aCreated) || bFirstJobId.localeCompare(aFirstJobId);
  });

  const activeChains = chains.filter(isVisibleChain);
  const activeChain =
    activeChains[0] ?? chains.find((chain) => chain.hasFailed && !chain.hasActiveWork) ?? null;

  return {
    websiteId,
    chains,
    activeChains,
    activeChain,
  };
}
