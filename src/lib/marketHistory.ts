/**
 * Probability history for a parimutuel market, reconstructed from on-chain `SharesBought`
 * events. There is no order-book mid-price here — implied probability for an outcome is its
 * share of the pool: outcomeShares / totalShares, recomputed after each trade.
 *
 * This is the real implementation behind the Phase 5 history seam: swap
 * `marketHistoryStub` → this module so `/api/v1/markets/[id]/history` returns live data.
 */

import { getAddress, isAddress, type AbiEvent, type Address } from 'viem';
import { createArcReadClient } from './arcClient';
import { prestoMarketAbi } from './contracts';
import { parseMarketMetadata } from './marketMetadata';

export type ProbabilityPoint = {
  /** Unix ms (block timestamp of the trade). */
  t: number;
  /** Per-outcome implied probability (0..1), index-aligned with the market's outcomes. */
  probabilities: number[];
};

const BLOCK_CHUNK = BigInt(7_200);
const MAX_CHUNKS = 12; // window scanned back from chain head
const MAX_POINTS = 120; // cap plotted points (keeps the most recent)

const sharesBoughtEvent = prestoMarketAbi.find(
  (entry) => entry.type === 'event' && entry.name === 'SharesBought',
) as AbiEvent;

function createClient() {
  return createArcReadClient();
}

type TradeLog = { outcome: number; amount: bigint; blockNumber: bigint; logIndex: number };

export async function getMarketProbabilityHistory(marketAddress: string): Promise<ProbabilityPoint[]> {
  if (!isAddress(marketAddress)) return [];
  const client = createClient();
  if (!client) return [];
  const address = getAddress(marketAddress) as Address;

  // Outcome count from metadata (binary YES/NO unless a poll defines more).
  const uri = await client
    .readContract({ address, abi: prestoMarketAbi, functionName: 'metadataURI' })
    .catch(() => '');
  const metadata = parseMarketMetadata(typeof uri === 'string' ? uri : '');
  const labelCount = metadata?.outcomeOptions && metadata.outcomeOptions.length >= 2 ? metadata.outcomeOptions.length : 2;
  const outcomeCount = Math.max(2, Math.min(labelCount, 12));

  const latest = await client.getBlockNumber().catch(() => null);
  if (latest === null) return [];

  // Bounded recent window, fetched in PARALLEL chunks. Long-range density comes from the
  // stored odds snapshots (market_snapshots) that the history endpoint merges in — scanning
  // back to the creation block here meant hundreds of sequential getLogs calls on Arc's
  // sub-second blocks and made the chart take many seconds to appear.
  const span = BLOCK_CHUNK * BigInt(MAX_CHUNKS);
  const fromBlock = latest > span ? latest - span : BigInt(0);

  const ranges: Array<{ start: bigint; end: bigint }> = [];
  for (let start = fromBlock; start <= latest; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - BigInt(1) > latest ? latest : start + BLOCK_CHUNK - BigInt(1);
    ranges.push({ start, end });
  }

  const chunks = await Promise.all(ranges.map((range) =>
    client
      .getLogs({ address, event: sharesBoughtEvent, fromBlock: range.start, toBlock: range.end })
      .catch(() => []),
  ));

  const logs: TradeLog[] = [];
  for (const chunk of chunks) {
    for (const log of chunk) {
      const args = (log as { args?: { outcome?: number | bigint; amount?: bigint } }).args ?? {};
      if (log.blockNumber === null || log.logIndex === null) continue;
      logs.push({
        outcome: Number(args.outcome ?? 0),
        amount: BigInt(args.amount ?? 0),
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    }
  }
  if (logs.length === 0) return [];

  logs.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );

  // Plot only the most recent MAX_POINTS, but accumulate across all trades so the ratio is correct.
  const plotStart = Math.max(0, logs.length - MAX_POINTS);
  const distinctBlocks = Array.from(new Set(logs.slice(plotStart).map((log) => log.blockNumber.toString())));
  const blockTimestamps = new Map<string, number>();
  await Promise.all(
    distinctBlocks.map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber: BigInt(blockNumber) }).catch(() => null);
      if (block) blockTimestamps.set(blockNumber, Number(block.timestamp) * 1000);
    }),
  );

  const cumulative = new Array<bigint>(outcomeCount).fill(BigInt(0));
  const points: ProbabilityPoint[] = [];
  for (let i = 0; i < logs.length; i += 1) {
    const log = logs[i];
    if (log.outcome >= 0 && log.outcome < outcomeCount) cumulative[log.outcome] += log.amount;
    if (i < plotStart) continue;
    const total = cumulative.reduce((sum, value) => sum + value, BigInt(0));
    if (total === BigInt(0)) continue;
    const probabilities = cumulative.map((value) => Number((value * BigInt(10_000)) / total) / 10_000);
    points.push({ t: blockTimestamps.get(log.blockNumber.toString()) ?? Date.now(), probabilities });
  }
  return points;
}
