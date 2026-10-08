import { isNonretryableGenerationConfigurationError } from "../agent/generation-mode.server.ts";
import { isInvalidUnifiedGenerationCheckpointError } from "../agent/unified-design-brief.ts";
import { isNonretryableEvidenceInventoryError } from "../agent/evidence-inventory-error.ts";
import { isNonretryableImageGenerationError } from "../media/lovable-media.server.ts";
import {
  isInvalidGenerationCheckpointError,
  isInvalidGenerationStageState,
} from "./generation-stage.ts";
import { isDesignPreferencesInstructionError } from "../agent/design-preferences.server.ts";
import { JOB_TYPE_SITE_GENERATION } from "./platforms.ts";
import { asPayloadRecord, getNextRetryAtIso } from "./retry.server.ts";

export function jobFailureSettlement(options: {
  jobType: string;
  attempts: number;
  maxAttempts: number;
  payload: unknown;
  error: unknown;
}): { retryable: boolean; canRetry: boolean; payload: Record<string, unknown> } {
  const retryable =
    options.jobType !== JOB_TYPE_SITE_GENERATION ||
    (!isNonretryableGenerationConfigurationError(options.error) &&
      !isNonretryableImageGenerationError(options.error) &&
      !isNonretryableEvidenceInventoryError(options.error) &&
      !isInvalidUnifiedGenerationCheckpointError(options.error) &&
      !isDesignPreferencesInstructionError(options.error) &&
      !isInvalidGenerationStageState(options.error) &&
      !isInvalidGenerationCheckpointError(options.error));
  const canRetry = retryable && options.attempts < options.maxAttempts;
  const payload = asPayloadRecord(options.payload);
  if (canRetry) payload.next_retry_at = getNextRetryAtIso(options.attempts);
  else delete payload.next_retry_at;
  return { retryable, canRetry, payload };
}
