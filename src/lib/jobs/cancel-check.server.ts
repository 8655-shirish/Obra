/** Only running jobs should execute work; cancelled/pending/etc. are no-ops at claim time. */
export function shouldExecuteJob(status: string): boolean {
  return status === "running";
}

/** Derive an AbortSignal from the job-row cancel flag so in-flight HTTP/LLM can stop. */
export function watchJobCancellation(
  isStillRunning: () => Promise<boolean>,
  intervalMs = 500,
): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const timer = setInterval(() => {
    void (async () => {
      if (controller.signal.aborted) return;
      try {
        const running = await isStillRunning();
        if (!running && !controller.signal.aborted) controller.abort();
      } catch {
        if (!controller.signal.aborted) controller.abort();
      }
    })();
  }, intervalMs);
  return {
    signal: controller.signal,
    stop: () => {
      clearInterval(timer);
    },
  };
}
