export class BookingStripeConfigurationError extends Error {}

/** Classify provider dependency failures, never infer payment truth from an error. */
export function bookingStripeFailure(error: unknown) {
  const candidate = error as { statusCode?: unknown; type?: unknown } | null;
  const status = typeof candidate?.statusCode === "number" ? candidate.statusCode : null;
  const type = String(candidate?.type ?? "");
  if (
    status === 401 ||
    status === 403 ||
    ["StripeAuthenticationError", "StripePermissionError"].includes(type)
  )
    return { retryable: true, retryDelaySeconds: 1800 };
  const terminal =
    error instanceof BookingStripeConfigurationError ||
    (status !== null
      ? status >= 400 && status < 500 && ![408, 409, 429].includes(status)
      : ["StripeInvalidRequestError", "StripeIdempotencyError"].includes(type));
  return { retryable: !terminal, retryDelaySeconds: 0 };
}
