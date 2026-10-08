export function publicAgentError(error: unknown): string {
  const message = collectErrorText(error);
  if (
    message.includes("selected preview changed") ||
    message.includes("original source version/revision") ||
    message.includes("source snapshot does not match")
  )
    return "The selected preview changed. Refresh the preview before regenerating.";
  if (message.includes("Agent is busy") || message.includes("still running"))
    return "The agent is still working. Try again when the current request finishes.";
  if (message.includes("Complete onboarding first"))
    return "Finish onboarding (business name, license, trade, services, theme, look & feel, and city) before generating a site.";
  if (message.includes("A site generation job is already active"))
    return "A site build is already in progress. Wait for it to finish before starting another.";
  if (
    message.includes("did not match the current generation contract") ||
    message.includes("background_jobs_generation_identity_check")
  )
    return "This site rebuild could not be queued. Try again.";
  if (
    message.includes("no fresh job-runner heartbeat") ||
    message.includes("job runner is not online")
  )
    return "Site generation is unavailable because the job runner is not online. Try again after the background job loop is scheduled.";
  if (error instanceof DOMException && error.name === "AbortError") return "Request cancelled.";
  return "The agent could not complete this request. Please try again.";
}

function collectErrorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "object" && current !== null && "message" in current) {
      const record = current as {
        message: unknown;
        details?: unknown;
        hint?: unknown;
        code?: unknown;
        cause?: unknown;
      };
      parts.push(String(record.message));
      for (const extra of [record.details, record.hint, record.code]) {
        if (typeof extra === "string" && extra.trim()) parts.push(extra);
      }
      current = "cause" in record ? record.cause : undefined;
      continue;
    }
    break;
  }
  return parts.join(" ");
}
