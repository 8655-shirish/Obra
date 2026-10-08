import type { JobChainProgressView } from "@/hooks/useJobProgress";

const SAFE_ADD_VIDEO_FAILURE_CAUSES: Record<string, string> = {
  revision_conflict: "The design changed before the edit could finish.",
  attachment_read_failed: "Design media could not be read.",
  video_provider_temporarily_unavailable: "The video service is temporarily unavailable.",
  source_still_unavailable: "The source image is no longer available.",
};

export function safeFailureCause(code: string | null): string {
  return (code && SAFE_ADD_VIDEO_FAILURE_CAUSES[code]) || "The edit could not be completed safely.";
}

export function chainLabel(jobType: string): string {
  if (jobType === "enrichment_platform") return "Enrichment";
  if (jobType === "add_video") return "Add video";
  if (jobType === "site_generation") return "Site generation";
  return "Background job";
}

export function safeFailureMessage(chain: JobChainProgressView): string {
  return chain.jobType === "add_video"
    ? safeFailureCause(chain.errorCode)
    : chain.jobType === "site_generation"
      ? "Site generation failed. Please try again."
      : "The background job failed.";
}

export const GENERATION_HANDOFF_PLACEHOLDER = "Building your website…";

export function isGenerationHandoffPlaceholder(content: string): boolean {
  return content.trim() === GENERATION_HANDOFF_PLACEHOLDER;
}

export function terminalGenerationFallback(state: JobChainProgressView["state"]): string {
  if (state === "completed") return "Website generation finished. Your refreshed preview is ready.";
  if (state === "cancelled" || state === "superseded") return "Website generation was cancelled.";
  if (state === "failed") return "Site generation failed. Please try again.";
  return "Website generation finished.";
}

export function progressActivityLabel(
  chain: JobChainProgressView,
  isPolling: boolean,
  statusUnavailable: boolean,
): string {
  if (!chain.hasActiveWork) return "Finished";
  return `${chain.aggregateProgressPct}%${isPolling && !statusUnavailable ? " · checking" : ""}`;
}

export function persistentChainsForDisplay(chains: JobChainProgressView[]): JobChainProgressView[] {
  const recentAddVideo = chains.find(
    (chain) => chain.jobType === "add_video" && !chain.hasActiveWork,
  );
  // Active generation is already rendered from activeChains. Keep only a terminal
  // failure or cancellation visible; a newer successful completion clears older failures.
  const latestGeneration = chains.find((chain) => chain.jobType === "site_generation");
  const visibleGeneration =
    latestGeneration &&
    !latestGeneration.hasActiveWork &&
    (latestGeneration.state === "failed" ||
      latestGeneration.state === "cancelled" ||
      latestGeneration.state === "superseded")
      ? latestGeneration
      : undefined;
  return [recentAddVideo, visibleGeneration].filter(
    (chain): chain is JobChainProgressView => chain !== undefined,
  );
}
