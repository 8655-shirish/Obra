import type { Database } from "@/integrations/supabase/types";

export type BackgroundJobRow = Database["public"]["Tables"]["background_jobs"]["Row"];

export type JobChainState =
  "queued" | "running" | "finalizing" | "completed" | "cancelled" | "superseded" | "failed";

export interface JobChainProgress {
  chainId: string;
  state: JobChainState;
  jobType: string;
  jobs: BackgroundJobRow[];
  aggregateProgressPct: number;
  statusMessage: string | null;
  isComplete: boolean;
  isCancelled: boolean;
  hasFailed: boolean;
  hasActiveWork: boolean;
}

export interface JobProgressSnapshot {
  websiteId: string;
  chains: JobChainProgress[];
  activeChains: JobChainProgress[];
  activeChain: JobChainProgress | null;
}
