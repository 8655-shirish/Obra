export function createAbortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** The signal is the cancel flag; AbortError is only one way it surfaces. */
export function isTurnCancelled(signal: AbortSignal | undefined, error?: unknown): boolean {
  return signal?.aborted === true || isAbortError(error);
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}
