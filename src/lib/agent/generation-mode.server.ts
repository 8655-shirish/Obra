import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  assertGenerationModeWriteEnabled,
  UNIFIED_SCHEMA_V3_WRITES_DISABLED_ERROR,
} from "./add-video-flags.server.ts";
import { isUnifiedSiteAgentEnabled } from "./unified-site-agent.ts";

type SupabaseAdmin = SupabaseClient<Database>;

export type GenerationMode = "unified";

export const INVALID_GENERATION_MODE_ERROR = "site_generation_mode_invalid";

export async function resolveGenerationMode(supabase: SupabaseAdmin): Promise<GenerationMode> {
  if (!(await isUnifiedSiteAgentEnabled(supabase)))
    throw new Error(UNIFIED_SCHEMA_V3_WRITES_DISABLED_ERROR);
  assertGenerationModeWriteEnabled("unified");
  return "unified";
}

export function requireGenerationMode(value: unknown): GenerationMode {
  if (value !== "unified") {
    throw new Error(INVALID_GENERATION_MODE_ERROR);
  }
  return value;
}

export function isNonretryableGenerationConfigurationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === INVALID_GENERATION_MODE_ERROR ||
    error.message === UNIFIED_SCHEMA_V3_WRITES_DISABLED_ERROR ||
    error.message === "Legacy generation modes are read-only" ||
    error.message === "Unsupported site generation contract version"
  );
}
