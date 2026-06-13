/**
 * Account-level aggregates for public profiles and leaderboards.
 *
 * Two halves, merged per address:
 *  - creator stats from market metadata: createdCount + calibration (accuracy/brier/resolvedCorrect).
 *  - trader stats from an on-chain event ledger: realizedPnl + marketsTraded, built from
 *    SharesBought (spend), Claimed and Refunded (receipts) across all markets.
 *
 * The ledger queries each event once per block-chunk with an address array covering every
 * market, so cost is ~chunks×3 calls, not per-market.
 */

import { createPublicClient, formatUnits, type AbiEvent, type Address } from 'viem';
import { getArcConfig } from './arcConfig';
import { ARC_USDC_DECIMALS, createArcReadClient } from './arcClient';
import { prestoMarketAbi } from './contracts';
import { fetchOnchainMarkets } from './onchainMarkets';
import { computeAgentCalibration, type CalibrationMarket } from './marketCalibration';

export type AccountStats = {
  address: string;
  /** Net settled USDC P&L from trading (claims + refunds − amount spent). */
  realizedPnl: number;
  /** Distinct markets this address bought into. */
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

const BLOCK_CHUNK = BigInt(7_200);
const MAX_CHUNKS = 24; // recent-history window scanned for the ledger
const sharesBoughtEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'SharesBought') as AbiEvent;
const claimedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Claimed') as AbiEvent;
const refundedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Refunded') as AbiEvent;

function createClient() {
  const config = getArcConfig();
  if (!config.rpcUrl) return null;
  return createArcReadClient();
}

type LedgerEntry = { spent: bigint; received: bigint; markets: Set<string> };

/** Per-account spend/receipts/markets from on-chain events across all markets. */
async function buildAccountLedger(marketAddresses: Address[]): Promise<Map<string, LedgerEntry>> {
  const ledger = new Map<string, LedgerEntry>();
  const client = createClient();
  if (!client || marketAddresses.length === 0) return ledger;

  const entry = (address: string): LedgerEntry => {
    const key = address.toLowerCase();
    let value = ledger.get(key);
    if (!value) {
      value = { spent: BigInt(0), received: BigInt(0), markets: new Set<string>() };
      ledger.set(key, value);
    }
    return value;
  };

  const latest = await client.getBlockNumber().catch(() => null);
  if (latest === null) return ledger;
  const span = BLOCK_CHUNK * BigInt(MAX_CHUNKS);
  const fromBlock = latest > span ? latest - span : BigInt(0);

  for (let start = fromBlock; start <= latest; start += BLOCK_CHUNK) {
    const toBlock = start + BLOCK_CHUNK - BigInt(1) > latest ? latest : start + BLOCK_CHUNK - BigInt(1);
    const [bought, claimed, refunded] = await Promise.all([
      client.getLogs({ address: marketAddresses, event: sharesBoughtEvent, fromBlock: start, toBlock }).catch(() => []),
      client.getLogs({ address: marketAddresses, event: claimedEvent, fromBlock: start, toBlock }).catch(() => []),
      client.getLogs({ address: marketAddresses, event: refundedEvent, fromBlock: start, toBlock }).catch(() => []),
    ]);

    for (const log of bought) {
      const args = (log as { args?: { buyer?: string; amount?: bigint } }).args ?? {};
      if (!args.buyer) continue;
      const e = entry(args.buyer);
      e.spent += BigInt(args.amount ?? 0);
      if (log.address) e.markets.add(log.address.toLowerCase());
    }
    for (const log of claimed) {
      const args = (log as { args?: { user?: string; amount?: bigint } }).args ?? {};
      if (args.user) entry(args.user).received += BigInt(args.amount ?? 0);
    }
    for (const log of refunded) {
      const args = (log as { args?: { user?: string; amount?: bigint } }).args ?? {};
      if (args.user) entry(args.user).received += BigInt(args.amount ?? 0);
    }
  }

  return ledger;
}

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

function usd(value: bigint): number {
  return Number(formatUnits(value, ARC_USDC_DECIMALS));
}

/** Creator + trader stats for every address that created or traded a market. */
export async function getAllAccountStats(): Promise<AccountStats[]> {
  const markets = await fetchOnchainMarkets().catch(() => []);
  const marketAddresses = markets
    .map((market) => market.id)
    .filter((id): id is Address => typeof id === 'string' && id.startsWith('0x'));

  const byCreator = new Map<string, typeof markets>();
  for (const market of markets) {
    const creator = (market.creatorAddress ?? '').toLowerCase();
    if (!creator) continue;
    const list = byCreator.get(creator) ?? [];
    list.push(market);
    byCreator.set(creator, list);
  }

  const ledger = await buildAccountLedger(marketAddresses).catch(() => new Map<string, LedgerEntry>());

  const addresses = new Set<string>([...byCreator.keys(), ...ledger.keys()]);
  return Array.from(addresses).map((address) => {
    const created = byCreator.get(address) ?? [];
    const calibration = computeAgentCalibration(created.map(toCalibrationMarket));
    const trade = ledger.get(address);
    return {
      address,
      realizedPnl: trade ? Number((usd(trade.received) - usd(trade.spent)).toFixed(6)) : 0,
      marketsTraded: trade ? trade.markets.size : 0,
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

/** Fetch all unique on-chain traders/buyers of a given market address. */
export async function listMarketTraders(marketAddress: Address): Promise<string[]> {
  const client = createClient();
  if (!client) return [];

  const latest = await client.getBlockNumber().catch(() => null);
  if (latest === null) return [];
  const span = BLOCK_CHUNK * BigInt(MAX_CHUNKS);
  const fromBlock = latest > span ? latest - span : BigInt(0);

  const traders = new Set<string>();

  for (let start = fromBlock; start <= latest; start += BLOCK_CHUNK) {
    const toBlock = start + BLOCK_CHUNK - BigInt(1) > latest ? latest : start + BLOCK_CHUNK - BigInt(1);
    const bought = await client.getLogs({
      address: marketAddress,
      event: sharesBoughtEvent,
      fromBlock: start,
      toBlock,
    }).catch(() => []);

    for (const log of bought) {
      const args = (log as { args?: { buyer?: string } }).args ?? {};
      if (args.buyer) {
        traders.add(args.buyer.toLowerCase());
      }
    }
  }

  return Array.from(traders);
}
