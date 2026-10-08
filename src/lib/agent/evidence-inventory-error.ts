export const EVIDENCE_INVENTORY_NONRETRYABLE_ERROR = "evidence_inventory_nonretryable" as const;

export class EvidenceInventoryError extends Error {
  readonly code = EVIDENCE_INVENTORY_NONRETRYABLE_ERROR;
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "EvidenceInventoryError";
  }
}

export function isNonretryableEvidenceInventoryError(error: unknown): boolean {
  return (
    error instanceof EvidenceInventoryError ||
    (error instanceof Error && error.message.startsWith(EVIDENCE_INVENTORY_NONRETRYABLE_ERROR))
  );
}
