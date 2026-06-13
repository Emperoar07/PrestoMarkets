import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  formatUnits,
  getAddress,
  isAddress,
  type AbiEvent,
  type Address,
} from 'viem';
import { ARC_USDC_DECIMALS, createArcReadClient } from '@/lib/arcClient';
import { prestoMarketAbi } from '@/lib/contracts';
import { getPublicMarket } from '@/lib/publicMarketSource';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import type { Market } from '@/lib/markets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TimelineEventType = 'created' | 'trade' | 'trade_summary' | 'proposed' | 'disputed' | 'settled' | 'canceled';

export type MarketTimelineEvent = {
  type: TimelineEventType;
  t: number;
  label: string;
  txHash?: string;
};

type ChainTimelineEvent = MarketTimelineEvent & {
  blockNumber: bigint;
  logIndex: number;
};

type TimelineMarket = Market & {
  closeDate?: string;
  createdAt?: string;
  winningOutcomeLabel?: string;
  proposal?: {
    outcomeLabel: string;
    proposedAtMs: number;
    disputed: boolean;
  };
};

const BLOCK_CHUNK = BigInt(7_200);
const MAX_CHUNKS = 12;
const MAX_TRADE_EVENTS = 25;
const timelineRateLimitStore = new Map<string, { count: number; resetAt: number }>();
const cacheHeaders = { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' };

const sharesBoughtEvent = prestoMarketAbi.find((entry) => entry.type === 'event' && entry.name === 'SharesBought') as AbiEvent;
const resolutionProposedEvent = prestoMarketAbi.find((entry) => entry.type === 'event' && entry.name === 'ResolutionProposed') as AbiEvent;
const resolutionDisputedEvent = prestoMarketAbi.find((entry) => entry.type === 'event' && entry.name === 'ResolutionDisputed') as AbiEvent;
const marketResolvedEvent = prestoMarketAbi.find((entry) => entry.type === 'event' && entry.name === 'MarketResolved') as AbiEvent;
const marketCanceledEvent = prestoMarketAbi.find((entry) => entry.type === 'event' && entry.name === 'MarketCanceled') as AbiEvent;

function createClient() {
  return createArcReadClient();
}

function formatUsdc(amount: bigint) {
  const value = Number(formatUnits(amount, ARC_USDC_DECIMALS));
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

function shortAddress(address?: string) {
  if (!address) return 'wallet';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function sortNewestFirst(a: MarketTimelineEvent, b: MarketTimelineEvent) {
  return b.t - a.t;
}

function sortChainOldestFirst(a: ChainTimelineEvent, b: ChainTimelineEvent) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

function outcomeLabel(labels: string[], outcome: unknown) {
  const index = Number(outcome ?? 0);
  return labels[index] ?? `Outcome ${Number.isFinite(index) ? index + 1 : 1}`;
}

async function fetchBlockTimes(
  client: ReturnType<typeof createPublicClient>,
  events: ChainTimelineEvent[],
): Promise<Map<string, number>> {
  const blockNumbers = Array.from(new Set(events.map((event) => event.blockNumber.toString())));
  const entries = await Promise.all(blockNumbers.map(async (blockNumber) => {
    const block = await client.getBlock({ blockNumber: BigInt(blockNumber) }).catch(() => null);
    return [blockNumber, block ? Number(block.timestamp) * 1000 : Date.now()] as const;
  }));
  return new Map(entries);
}

async function fetchChainTimelineEvents(input: {
  client: ReturnType<typeof createPublicClient>;
  address: Address;
  labels: string[];
}) {
  const { client, address, labels } = input;
  const latest = await client.getBlockNumber().catch(() => null);
  if (latest === null) return [] as MarketTimelineEvent[];

  const span = BLOCK_CHUNK * BigInt(MAX_CHUNKS);
  const fromBlock = latest > span ? latest - span : BigInt(0);
  const ranges: Array<{ start: bigint; end: bigint }> = [];
  for (let start = fromBlock; start <= latest; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - BigInt(1) > latest ? latest : start + BLOCK_CHUNK - BigInt(1);
    ranges.push({ start, end });
  }

  const chunks = await Promise.all(ranges.map(async (range) => {
    const [trades, proposals, disputes, resolutions, cancellations] = await Promise.all([
      client.getLogs({ address, event: sharesBoughtEvent, fromBlock: range.start, toBlock: range.end }).catch(() => []),
      client.getLogs({ address, event: resolutionProposedEvent, fromBlock: range.start, toBlock: range.end }).catch(() => []),
      client.getLogs({ address, event: resolutionDisputedEvent, fromBlock: range.start, toBlock: range.end }).catch(() => []),
      client.getLogs({ address, event: marketResolvedEvent, fromBlock: range.start, toBlock: range.end }).catch(() => []),
      client.getLogs({ address, event: marketCanceledEvent, fromBlock: range.start, toBlock: range.end }).catch(() => []),
    ]);
    return { trades, proposals, disputes, resolutions, cancellations };
  }));

  const chainEvents: ChainTimelineEvent[] = [];
  for (const chunk of chunks) {
    for (const log of chunk.trades) {
      if (log.blockNumber === null || log.logIndex === null) continue;
      const args = (log as { args?: { buyer?: string; recipient?: string; outcome?: number | bigint; amount?: bigint } }).args ?? {};
      chainEvents.push({
        type: 'trade',
        t: 0,
        label: `${shortAddress(args.recipient ?? args.buyer)} bought ${formatUsdc(args.amount ?? BigInt(0))} ${outcomeLabel(labels, args.outcome)}`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    }

    for (const log of chunk.proposals) {
      if (log.blockNumber === null || log.logIndex === null) continue;
      const args = (log as { args?: { proposer?: string; outcome?: number | bigint } }).args ?? {};
      chainEvents.push({
        type: 'proposed',
        t: 0,
        label: `${outcomeLabel(labels, args.outcome)} outcome proposed by ${shortAddress(args.proposer)}`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    }

    for (const log of chunk.disputes) {
      if (log.blockNumber === null || log.logIndex === null) continue;
      const args = (log as { args?: { disputer?: string } }).args ?? {};
      chainEvents.push({
        type: 'disputed',
        t: 0,
        label: `Resolution disputed by ${shortAddress(args.disputer)}`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    }

    for (const log of chunk.resolutions) {
      if (log.blockNumber === null || log.logIndex === null) continue;
      const args = (log as { args?: { winningOutcome?: number | bigint } }).args ?? {};
      chainEvents.push({
        type: 'settled',
        t: 0,
        label: `Settled as ${outcomeLabel(labels, args.winningOutcome)}`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    }

    for (const log of chunk.cancellations) {
      if (log.blockNumber === null || log.logIndex === null) continue;
      chainEvents.push({
        type: 'canceled',
        t: 0,
        label: 'Market canceled',
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    }
  }

  if (chainEvents.length === 0) return [] as MarketTimelineEvent[];
  const blockTimes = await fetchBlockTimes(client, chainEvents);
  return chainEvents
    .map((event) => ({ ...event, t: blockTimes.get(event.blockNumber.toString()) ?? Date.now() }))
    .sort(sortChainOldestFirst);
}

function aggregateTrades(events: MarketTimelineEvent[]) {
  const trades = events.filter((event) => event.type === 'trade').sort(sortNewestFirst);
  const nonTrades = events.filter((event) => event.type !== 'trade');
  if (trades.length <= MAX_TRADE_EVENTS) return events;

  const visibleTrades = trades.slice(0, MAX_TRADE_EVENTS);
  const hiddenTrades = trades.slice(MAX_TRADE_EVENTS);
  const oldestVisible = visibleTrades[visibleTrades.length - 1];
  const summary: MarketTimelineEvent = {
    type: 'trade_summary',
    t: Math.max(0, oldestVisible.t - 1),
    label: `+${hiddenTrades.length} earlier trade${hiddenTrades.length === 1 ? '' : 's'}`,
  };
  return [...nonTrades, ...visibleTrades, summary];
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(timelineRateLimitStore, ip, { max: 60, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: cacheHeaders });
  }

  const { id } = await params;
  if (!isAddress(id)) {
    return NextResponse.json({ error: 'Valid market id is required.' }, { status: 400, headers: cacheHeaders });
  }

  const market = await getPublicMarket(id) as TimelineMarket | null;
  if (!market) {
    return NextResponse.json({ error: 'Market not found.' }, { status: 404, headers: cacheHeaders });
  }

  const client = createClient();
  const labels = market.outcomes.map((outcome) => outcome.label);
  const chainEvents = client
    ? await fetchChainTimelineEvents({ client, address: getAddress(id) as Address, labels }).catch(() => [])
    : [];

  const fallbackEvents: MarketTimelineEvent[] = [];
  const createdAtMs = typeof market.createdAt === 'string'
    ? new Date(market.createdAt).getTime()
    : NaN;
  if (Number.isFinite(createdAtMs)) {
    fallbackEvents.push({ type: 'created', t: createdAtMs, label: 'Market created' });
  }

  const proposal = market.proposal;
  if (proposal && !chainEvents.some((event) => event.type === 'proposed')) {
    fallbackEvents.push({
      type: 'proposed',
      t: proposal.proposedAtMs,
      label: `${proposal.outcomeLabel} outcome proposed`,
    });
  }
  if (proposal?.disputed && !chainEvents.some((event) => event.type === 'disputed')) {
    fallbackEvents.push({
      type: 'disputed',
      t: proposal.proposedAtMs + 1,
      label: `${proposal.outcomeLabel} proposal disputed`,
    });
  }

  if ((market.status === 'Resolved' || market.status === 'Canceled') && !chainEvents.some((event) => event.type === 'settled' || event.type === 'canceled')) {
    const closeDateMs = typeof market.closeDate === 'string' ? new Date(market.closeDate).getTime() : NaN;
    fallbackEvents.push({
      type: market.status === 'Resolved' ? 'settled' : 'canceled',
      t: Number.isFinite(closeDateMs) ? closeDateMs : Date.now(),
      label: market.status === 'Resolved'
        ? `Settled as ${market.winningOutcomeLabel ?? 'winning outcome'}`
        : 'Market canceled',
    });
  }

  const events = aggregateTrades([...fallbackEvents, ...chainEvents])
    .sort(sortNewestFirst)
    .slice(0, 40);

  return NextResponse.json({ events }, { headers: cacheHeaders });
}
