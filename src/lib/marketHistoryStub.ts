export type ProbabilityPoint = {
  t: number;
  probabilities: number[];
};

// Phase 2 owns src/lib/marketHistory.ts. This stub keeps the public v1 endpoint stable
// until that implementation lands; swap this import to marketHistory when Phase 2 merges.
export async function getMarketProbabilityHistory(_marketAddress: string): Promise<ProbabilityPoint[]> {
  return [];
}
