export type AccountStats = {
  address: string;
  realizedPnl: number;
  marketsTraded: number;
  resolvedCorrect: number;
  accuracy: number;
  brier: number;
  createdCount: number;
};

// Phase 0 will replace this seam with src/lib/marketIndexer.ts:
//   getAccountStats(address)
//   getAllAccountStats()
// Until that lands, the leaderboard cron can run safely and cache an empty board.
export async function getAllAccountStats(): Promise<AccountStats[]> {
  return [];
}
