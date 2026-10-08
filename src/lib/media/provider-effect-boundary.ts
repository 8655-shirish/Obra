export type MediaProviderEffectCertainty = "indeterminate" | "definite_success";

/**
 * An abort that crossed the media-provider create boundary. Plain AbortError means
 * cooperative cancellation before that boundary; this marker carries exact effect certainty.
 */
export class MediaProviderAttemptAbortError extends Error {
  override readonly name = "AbortError";
  readonly mediaProviderEffectCertainty: MediaProviderEffectCertainty;
  override readonly cause: unknown;

  constructor(certainty: MediaProviderEffectCertainty, cause?: unknown) {
    super(
      certainty === "indeterminate"
        ? "Media provider create was interrupted after dispatch"
        : "Media provider response was accepted before interruption",
    );
    this.mediaProviderEffectCertainty = certainty;
    this.cause = cause;
  }
}

export function mediaProviderAbortEffectCertainty(
  error: unknown,
): MediaProviderEffectCertainty | null {
  return error instanceof MediaProviderAttemptAbortError
    ? error.mediaProviderEffectCertainty
    : null;
}
