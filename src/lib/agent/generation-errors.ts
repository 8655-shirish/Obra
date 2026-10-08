export const GENERATION_EXHAUSTED_ERROR = "site_generation_exhausted" as const;

export type GenerationExhaustionPhase =
  "unified-design" | "unified-code" | "two-step-design" | "two-step-code";

/** Stable, retryable failure raised when bounded model attempts produce no valid result. */
export class GenerationExhaustedError extends Error {
  readonly code = GENERATION_EXHAUSTED_ERROR;
  readonly retryable = true;
  readonly phase: GenerationExhaustionPhase;
  readonly lastFailure: string;

  constructor(phase: GenerationExhaustionPhase, lastFailure: string) {
    super(`${GENERATION_EXHAUSTED_ERROR}:${phase}:${lastFailure}`);
    this.name = "GenerationExhaustedError";
    this.phase = phase;
    this.lastFailure = lastFailure;
  }
}

export function generationExhausted(
  phase: GenerationExhaustionPhase,
  lastFailure: string,
): GenerationExhaustedError {
  return new GenerationExhaustedError(phase, lastFailure);
}

export function isGenerationExhaustedError(error: unknown): error is GenerationExhaustedError {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & { code?: unknown; retryable?: unknown; phase?: unknown };
  return (
    candidate.name === "GenerationExhaustedError" &&
    candidate.code === GENERATION_EXHAUSTED_ERROR &&
    candidate.retryable === true &&
    ["unified-design", "unified-code", "two-step-design", "two-step-code"].includes(
      String(candidate.phase),
    )
  );
}
