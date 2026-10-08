export type TemplateLookupChain = {
  chainId: string;
  hasActiveWork: boolean;
  isComplete: boolean;
};

export type TemplateLookupPollChain = TemplateLookupChain & {
  isCancelled: boolean;
  hasFailed: boolean;
  state: string;
};

export type TemplateLookupDisposition =
  { kind: "attach"; chainId: string } | { kind: "reuse"; chainId: string } | { kind: "enqueue" };

export type TemplateLookupPoll = "wait" | "complete" | "failed";

const USABLE_RESEARCH = new Set(["complete", "partial"]);

/**
 * Step 1 spend/attach decision from the enrichment *chain* and finalized
 * research product. In-flight work is followed; usable facts are reused;
 * empty/failed/missing research may spend again. No wall-clock window.
 */
export function resolveTemplateLookup(
  chains: readonly TemplateLookupChain[],
  researchStatus: string | null | undefined,
): TemplateLookupDisposition {
  const inFlight = chains.find((chain) => chain.hasActiveWork && chain.chainId);
  if (inFlight?.chainId) return { kind: "attach", chainId: inFlight.chainId };

  if (!USABLE_RESEARCH.has(researchStatus ?? "")) return { kind: "enqueue" };

  const completed = chains.find((chain) => chain.isComplete && chain.chainId);
  if (completed?.chainId) return { kind: "reuse", chainId: completed.chainId };
  return { kind: "enqueue" };
}

/**
 * Poll until the chain is terminal. A failed sibling does not finish the
 * lookup while other platforms are still pending, running, or finalizing.
 */
export function classifyTemplateLookupPoll(
  chain: TemplateLookupPollChain | null | undefined,
): TemplateLookupPoll {
  if (!chain) return "wait";
  if (chain.hasActiveWork) return "wait";
  if (chain.isCancelled || chain.state === "cancelled") return "failed";
  if (chain.hasFailed) return "failed";
  if (chain.isComplete) return "complete";
  return "failed";
}
