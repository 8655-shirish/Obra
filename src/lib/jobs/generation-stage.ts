export const GENERATION_STAGE_YIELD = "site_generation_stage_yield";
export const INVALID_GENERATION_STAGE_STATE = "invalid_site_generation_stage_state";

export type SiteGenerationCheckpointStage =
  "context" | "planning" | "media" | "composition" | "validation" | "persistence";

export class GenerationStageYield extends Error {
  readonly nextStage: SiteGenerationCheckpointStage;

  constructor(nextStage: SiteGenerationCheckpointStage) {
    super(GENERATION_STAGE_YIELD);
    this.name = "GenerationStageYield";
    this.nextStage = nextStage;
  }
}

export function isGenerationStageYield(error: unknown): error is GenerationStageYield {
  return error instanceof GenerationStageYield;
}

export function invalidGenerationStageState(): Error {
  return new Error(INVALID_GENERATION_STAGE_STATE);
}

export function isInvalidGenerationStageState(error: unknown): boolean {
  return error instanceof Error && error.message === INVALID_GENERATION_STAGE_STATE;
}

export const INVALID_GENERATION_CHECKPOINT_PREFIX = "Invalid generation checkpoint:";

export function isInvalidGenerationCheckpointError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(INVALID_GENERATION_CHECKPOINT_PREFIX);
}
