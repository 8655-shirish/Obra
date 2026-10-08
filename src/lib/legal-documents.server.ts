import { createHash } from "node:crypto";

import dpaMarkdown from "@/content/legal/dpa.md?raw";
import msaMarkdown from "@/content/legal/msa.md?raw";

/**
 * Server-owned acceptance manifest for the exact markdown bytes displayed by
 * LegalDocumentsDialog. Changing any byte requires an explicit manifest update.
 */
export const CHECKOUT_LEGAL_DOCUMENTS = {
  schema: 1,
  msa: {
    documentId: "msa",
    version: "1.1",
    algorithm: "sha256",
    sha256: "a1a1c6ebd029f5457668e22b56dd57a8528f4f862d78dd280ee39679a8cd58a7",
    bytes: 28_566,
  },
  dpa: {
    documentId: "dpa",
    version: "1.1",
    algorithm: "sha256",
    sha256: "c9805c8ffc65aa81a865cbcf5de56a9a097baec2d324c85986ab7f4d0d624604",
    bytes: 15_665,
  },
} as const;

function assertExactDocumentBytes(
  name: "msa" | "dpa",
  markdown: string,
  expected: (typeof CHECKOUT_LEGAL_DOCUMENTS)["msa" | "dpa"],
): void {
  const bytes = Buffer.byteLength(markdown, "utf8");
  const digest = createHash("sha256").update(markdown, "utf8").digest("hex");
  if (bytes !== expected.bytes || digest !== expected.sha256) {
    throw new Error(
      `${name.toUpperCase()} legal document bytes do not match Version ${expected.version}`,
    );
  }
}

export function checkoutLegalEvidence(): typeof CHECKOUT_LEGAL_DOCUMENTS {
  assertExactDocumentBytes("msa", msaMarkdown, CHECKOUT_LEGAL_DOCUMENTS.msa);
  assertExactDocumentBytes("dpa", dpaMarkdown, CHECKOUT_LEGAL_DOCUMENTS.dpa);
  return CHECKOUT_LEGAL_DOCUMENTS;
}
