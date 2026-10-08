import { useCallback, useEffect, useRef, useState } from "react";

import { supabaseBrowser } from "@/lib/supabase-browser";
import { getJobProgress, type AddVideoJobResult } from "@/lib/jobs.functions";
import { jobProgressChannelName } from "@/lib/jobs/progress-channel";

export interface JobChainProgressView {
  chainId: string;
  state: "queued" | "running" | "finalizing" | "completed" | "cancelled" | "superseded" | "failed";
  jobType: string;
  aggregateProgressPct: number;
  statusMessage: string | null;
  isComplete: boolean;
  hasFailed: boolean;
  hasActiveWork: boolean;
  isCancelled: boolean;
  requestId: string | null;
  agentTraceId: string | null;
  sourceVersionId: string | null;
  targetVersionId: string | null;
  result: AddVideoJobResult | null;
  errorCode: string | null;
  completedAt: string | null;
  claimEpoch: number;
  contractEpoch: number;
}

export interface JobProgressView {
  websiteId: string;
  chains: JobChainProgressView[];
  activeChains: JobChainProgressView[];
  activeChain: JobChainProgressView | null;
}

const ACTIVE_POLL_INTERVAL_MS = 2_500;
const IDLE_POLL_INTERVAL_MS = 15_000;

function mapChainView(
  chain: NonNullable<Awaited<ReturnType<typeof getJobProgress>>["activeChain"]>,
): JobChainProgressView {
  const job = chain.jobs.at(-1);
  const rawResult = job?.result_json;
  const result =
    rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)
      ? (rawResult as AddVideoJobResult)
      : null;
  return {
    chainId: chain.chainId,
    state: chain.state,
    jobType: chain.jobType,
    aggregateProgressPct: chain.aggregateProgressPct,
    statusMessage: chain.statusMessage,
    isComplete: chain.isComplete,
    hasFailed: chain.hasFailed,
    hasActiveWork: chain.hasActiveWork,
    isCancelled: chain.isCancelled,
    requestId: job?.request_id ?? null,
    agentTraceId:
      (job as (typeof job & { agent_trace_id?: string | null }) | undefined)?.agent_trace_id ??
      null,
    sourceVersionId: job?.source_version_id ?? null,
    targetVersionId: job?.target_version_id ?? null,
    result,
    errorCode: typeof result?.errorCode === "string" ? result.errorCode : null,
    completedAt: job?.completed_at ?? null,
    claimEpoch: job?.claim_epoch ?? 0,
    contractEpoch: job?.generation_contract_epoch ?? 0,
  };
}

export function useJobProgress(
  websiteId: string,
  mode: "admin" | "contractor",
): {
  progress: JobProgressView | null;
  isPolling: boolean;
  statusUnavailable: boolean;
  refresh: () => Promise<JobProgressView | null>;
} {
  const [progress, setProgress] = useState<JobProgressView | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [statusUnavailable, setStatusUnavailable] = useState(true);
  const websiteIdRef = useRef(websiteId);
  const refreshSequenceRef = useRef(0);
  const inFlightRefreshRef = useRef<Promise<JobProgressView | null> | null>(null);
  const trailingRefreshRef = useRef(false);

  websiteIdRef.current = websiteId;

  const refresh = useCallback(async (): Promise<JobProgressView | null> => {
    if (!websiteIdRef.current) return null;
    if (inFlightRefreshRef.current) {
      // Coalesce duplicate triggers, but preserve one trailing refresh so a terminal
      // broadcast received during an old read cannot be dropped.
      trailingRefreshRef.current = true;
      return inFlightRefreshRef.current;
    }

    const run = async (): Promise<JobProgressView | null> => {
      let latest: JobProgressView | null = null;
      do {
        trailingRefreshRef.current = false;
        const requestedWebsiteId = websiteIdRef.current;
        const requestSequence = ++refreshSequenceRef.current;
        setIsPolling(true);

        try {
          const snapshot = await getJobProgress({ data: { websiteId: requestedWebsiteId } });
          const chains = snapshot.chains.map(mapChainView);
          const activeChains = snapshot.activeChains.map(mapChainView);
          const view: JobProgressView = {
            websiteId: snapshot.websiteId,
            chains,
            activeChains,
            activeChain: snapshot.activeChain ? mapChainView(snapshot.activeChain) : null,
          };

          if (
            requestSequence === refreshSequenceRef.current &&
            requestedWebsiteId === websiteIdRef.current
          ) {
            setProgress(view);
            setStatusUnavailable(false);
          }
          latest =
            requestSequence === refreshSequenceRef.current &&
            requestedWebsiteId === websiteIdRef.current
              ? view
              : null;
        } catch (error) {
          console.error("[useJobProgress]", error);
          if (
            requestSequence === refreshSequenceRef.current &&
            requestedWebsiteId === websiteIdRef.current
          ) {
            setStatusUnavailable(true);
          }
          latest = null;
        }
      } while (trailingRefreshRef.current);
      return latest;
    };

    const operation = run().finally(() => {
      if (inFlightRefreshRef.current === operation) inFlightRefreshRef.current = null;
      setIsPolling(false);
    });
    inFlightRefreshRef.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    refreshSequenceRef.current += 1;
    trailingRefreshRef.current = false;
    setIsPolling(false);
    setProgress(null);
    setStatusUnavailable(true);
    void refresh();
  }, [websiteId, refresh]);

  const hasActiveWork = (progress?.activeChains.length ?? 0) > 0;
  useEffect(() => {
    let interval: number | null = null;
    const updatePolling = () => {
      if (interval !== null) window.clearInterval(interval);
      interval = null;
      if (document.visibilityState !== "visible") return;
      interval = window.setInterval(
        () => void refresh(),
        hasActiveWork ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS,
      );
    };
    updatePolling();
    document.addEventListener("visibilitychange", updatePolling);
    return () => {
      document.removeEventListener("visibilitychange", updatePolling);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [hasActiveWork, refresh]);

  useEffect(() => {
    const channelName = jobProgressChannelName(websiteId);
    const broadcastChannel = supabaseBrowser
      .channel(channelName)
      .on("broadcast", { event: "progress" }, () => {
        if (document.visibilityState === "visible") void refresh();
      })
      .subscribe();

    return () => {
      void supabaseBrowser.removeChannel(broadcastChannel);
    };
  }, [websiteId, refresh]);

  useEffect(() => {
    if (mode !== "contractor") return;

    const postgresChannel = supabaseBrowser
      .channel(`background_jobs:${websiteId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "background_jobs",
          filter: `website_id=eq.${websiteId}`,
        },
        () => {
          if (document.visibilityState === "visible") void refresh();
        },
      )
      .subscribe();

    return () => {
      void supabaseBrowser.removeChannel(postgresChannel);
    };
  }, [websiteId, mode, refresh]);

  return { progress, isPolling, statusUnavailable, refresh };
}
