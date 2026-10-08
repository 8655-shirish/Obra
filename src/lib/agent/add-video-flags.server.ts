export function parseBooleanFeatureFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/** Readers remain enabled unconditionally; this gates only new v3 writes. */
export function unifiedSchemaV3WritesEnabled(): boolean {
  return parseBooleanFeatureFlag(process.env.UNIFIED_SCHEMA_V3_WRITE_ENABLED);
}

export const UNIFIED_SCHEMA_V3_WRITES_DISABLED_ERROR = "unified_schema_v3_writes_disabled";

export function assertGenerationModeWriteEnabled(generationMode: "unified" | "two-step"): void {
  if (generationMode === "unified" && !unifiedSchemaV3WritesEnabled()) {
    throw new Error(UNIFIED_SCHEMA_V3_WRITES_DISABLED_ERROR);
  }
}

/** Product entitlement is not yet defined, so Add video defaults fail-closed. */
export function addVideoEnabled(): boolean {
  return parseBooleanFeatureFlag(process.env.ADD_VIDEO_ENABLED);
}
