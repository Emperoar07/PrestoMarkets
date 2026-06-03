/**
 * Account-level aggregates for public profiles and leaderboards.
 *
 * Phase 0 scope: this populates the *creator-side* stats that are correct and cheaply
 * derivable from on-chain market metadata — `createdCount`, plus calibration (`accuracy`,
 * `brier`, `resolvedCorrect`) over the markets each address created. Forecaster trade stats
 * (`realizedPnl`, `marketsTraded`) require a per-account ledger built from SharesBought /
 * Claimed events; that is the next Phase 0 slice and these fields stay 0 until then.
 *
 * This is the contract Phase 3 (leaderboards / profiles) integrates against — build the
 * leaderboard cron + UI against `getAllAccountStats`, swapping a stub for it now if needed.
 */

import { fetchOnchainMarkets } from './onchainMarkets';
import { computeAgentCalibration, type CalibrationMarket } from './marketCalibration';

export type AccountStats = {
  address: string;
  /** Net settled USDC P&L from trading. 0 until the event ledger lands (Phase 0 slice 2). */
  realizedPnl: number;
  /** Distinct markets this address traded in. 0 until the event ledger lands. */
  marketsTraded: number;
  /** Resolved binary markets this address created where the >50% confidence side won. */
  resolvedCorrect: number;
  /** Calibration accuracy over the markets this address created (0..1). 0 when unscored. */
  accuracy: number;
  /** Brier score over the markets this address created (lower better). 0 when unscored. */
  brier: number;
  /** Markets this address created. */
  createdCount: number;
};

function toCalibrationMarket(market: {
  status: string;
  type?: string;
  createdByType?: string;
  agentConfidence?: string;
  winningOutcomeLabel?: string;
  outcomes?: Array<{ label: string }>;
  pollOptions?: string[];
}): CalibrationMarket {
  return {
    status: market.status,
    type: market.type,
    createdByType: market.createdByType,
    agentConfidence: market.agentConfidence,
    winningOutcomeLabel: market.winningOutcomeLabel,
    outcomes: market.outcomes,
    pollOptions: market.pollOptions,
  };
}

/** Build creator-side stats for every address that has created at least one market. */
export async function getAllAccountStats(): Promise<AccountStats[]> {
  const markets = await fetchOnchainMarkets().catch(() => []);
  const byCreator = new Map<string, typeof markets>();

  for (const market of markets) {
    const creator = (market.creatorAddress ?? '').toLowerCase();
    if (!creator) continue;
    const list = byCreator.get(creator) ?? [];
    list.push(market);
    byCreator.set(creator, list);
  }

  return Array.from(byCreator.entries()).map(([address, created]) => {
    const calibration = computeAgentCalibration(created.map(toCalibrationMarket));
    return {
      address,
      realizedPnl: 0,
      marketsTraded: 0,
      resolvedCorrect: calibration.accuracy !== null ? Math.round(calibration.accuracy * calibration.scored) : 0,
      accuracy: calibration.accuracy ?? 0,
      brier: calibration.brier ?? 0,
      createdCount: created.length,
    };
  });
}

/** Stats for a single address. */
export async function getAccountStats(address: string): Promise<AccountStats> {
  const target = address.toLowerCase();
  const all = await getAllAccountStats();
  return (
    all.find((stats) => stats.address === target) ?? {
      address: target,
      realizedPnl: 0,
      marketsTraded: 0,
      resolvedCorrect: 0,
      accuracy: 0,
      brier: 0,
      createdCount: 0,
    }
  );
}
