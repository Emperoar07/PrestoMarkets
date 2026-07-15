import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  decodeEventLog,
  encodeEventTopics,
  formatUnits,
  isAddress,
  type Address,
  type AbiEvent,
  type Hex,
} from 'viem';
import { getArcConfig } from '@/lib/arcConfig';
import { ARC_USDC_DECIMALS, createArcReadClient } from '@/lib/arcClient';
import { prestoLmsrMarketAbi, prestoMarketAbi, prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from '@/lib/contracts';
import { parseMarketMetadata } from '@/lib/marketMetadata';
import { readMarketListSnapshot } from '@/lib/onchainMarkets';
import type { PortfolioActivity } from '@/lib/portfolio';
import { getClientIp } from '@/lib/requestGuards';
import { checkRateLimit } from '@/lib/rateLimitRedis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_MARKETS = 500;
// RPC-fallback scan only. thirdweb (one of the three public Arc RPCs) hard-caps getLogs at
// 1,000 blocks, so a bigger chunk guarantees a slice of failing queries whenever the ranked
// transport lands there.
const BLOCK_CHUNK = BigInt(1_000);
const MAX_CHUNKS = 8;
const BLOCKSCOUT_API = 'https://testnet.arcscan.app/api';
const activityCacheHeaders = { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' };

const sharesBoughtEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'SharesBought')!;
const claimedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Claimed')!;
const refundedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Refunded')!;
// V3 LMSR markets emit DIFFERENT event signatures (different topic hashes), so the V2 filters
// above never match them — without these, every LMSR buy/sell/auto-payout/refund is invisible.
const lmsrSharesBoughtEvent = prestoLmsrMarketAbi.find((e) => e.type === 'event' && e.name === 'SharesBought')!;
const lmsrSharesSoldEvent = prestoLmsrMarketAbi.find((e) => e.type === 'event' && e.name === 'SharesSold')!;
const lmsrWinnerPaidEvent = prestoLmsrMarketAbi.find((e) => e.type === 'event' && e.name === 'WinnerPaid')!;
const lmsrRefundedEvent = prestoLmsrMarketAbi.find((e) => e.type === 'event' && e.name === 'Refunded')!;
const marketCreatedEvent = prestoMarketFactoryAbi.find((e) => e.type === 'event' && e.name === 'MarketCreated')!;
const multiOutcomeMarketCreatedEvent = prestoMultiOutcomeMarketFactoryAbi.find((e) => e.type === 'event' && e.name === 'MarketCreated')!;

type Cursor = {
  blockNumber: bigint;
  logIndex: number;
};

type ActivityRow = PortfolioActivity & {
  blockNumber: bigint;
  logIndex: number;
  marketAddress?: Address;
  outcomeIndex?: number;
};

function formatUsdc(value: bigint) {
  return `$${Number(formatUnits(value, ARC_USDC_DECIMALS)).toFixed(2)}`;
}

function truncateAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function parseLimit(raw: string | null) {
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  const [block, index] = raw.split(':');
  if (!block || !index) return null;

  try {
    const blockNumber = BigInt(block);
    const logIndex = Number.parseInt(index, 10);
    if (blockNumber < BigInt(0) || !Number.isFinite(logIndex) || logIndex < 0) return null;
    return { blockNumber, logIndex };
  } catch {
    return null;
  }
}

function isBeforeCursor(row: ActivityRow, cursor: Cursor | null) {
  if (!cursor) return true;
  if (row.blockNumber < cursor.blockNumber) return true;
  if (row.blockNumber > cursor.blockNumber) return false;
  return row.logIndex < cursor.logIndex;
}

function sortRows(a: ActivityRow, b: ActivityRow) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
  return b.logIndex - a.logIndex;
}

function createArcClient() {
  return createArcReadClient();
}

async function fetchFactoryMarkets(client: ReturnType<typeof createPublicClient>, factoryAddress: Address, multiOutcome = false) {
  const abi = multiOutcome ? prestoMultiOutcomeMarketFactoryAbi : prestoMarketFactoryAbi;
  const count = await client.readContract({
    address: factoryAddress,
    abi,
    functionName: 'marketCount',
  }).catch(() => BigInt(0));

  const capped = Math.min(Number(count), MAX_MARKETS);
  if (!Number.isFinite(capped) || capped <= 0) return [] as Address[];

  const markets = await Promise.all(Array.from({ length: capped }, (_, index) => (
    client.readContract({
      address: factoryAddress,
      abi,
      functionName: 'markets',
      args: [BigInt(index)],
    }).catch(() => null)
  )));

  return markets.filter((market): market is Address => Boolean(market && isAddress(market)));
}

async function readMarketSummary(client: ReturnType<typeof createPublicClient>, marketAddress: Address) {
  const fallback = `Market ${truncateAddress(marketAddress)}`;
  const uri = await client.readContract({
    address: marketAddress,
    abi: prestoMarketAbi,
    functionName: 'metadataURI',
  }).catch(() => '');

  if (!uri) return { title: fallback, outcomes: ['YES', 'NO'] };
  const metadata = parseMarketMetadata(uri);
  return {
    title: metadata?.name?.trim() || fallback,
    outcomes: metadata?.outcomeOptions && metadata.outcomeOptions.length >= 2 ? metadata.outcomeOptions : ['YES', 'NO'],
  };
}

async function hydrateTitles(
  client: ReturnType<typeof createPublicClient>,
  rows: ActivityRow[],
  knownSummaries: Map<string, { title: string; outcomes: string[] }>,
) {
  const addresses = Array.from(new Set(rows.map((row) => row.marketAddress).filter(Boolean))) as Address[];
  if (addresses.length === 0) return rows;

  // Titles/outcomes come from the market-list snapshot when possible; only markets the snapshot
  // doesn't know yet (freshly created) cost a chain read.
  const marketEntries = await Promise.all(addresses.map(async (address) => [
    address.toLowerCase(),
    knownSummaries.get(address.toLowerCase()) ?? await readMarketSummary(client, address),
  ] as const));
  const summaries = new Map(marketEntries);

  return rows.map((row) => {
    const summary = row.marketAddress ? summaries.get(row.marketAddress.toLowerCase()) : undefined;
    return {
      ...row,
      label: row.outcomeIndex === undefined
        ? row.label
        : `Bought ${summary?.outcomes[row.outcomeIndex] ?? `Outcome ${row.outcomeIndex + 1}`}`,
      market: summary?.title ?? row.market,
    };
  });
}

async function fetchRowsInRange(input: {
  client: ReturnType<typeof createPublicClient>;
  account: Address;
  factoryAddresses: Array<{ address: Address; multiOutcome: boolean }>;
  marketAddresses: Address[];
  fromBlock: bigint;
  toBlock: bigint;
  onError: () => void;
}) {
  const { client, account, factoryAddresses, marketAddresses, fromBlock, toBlock, onError } = input;
  // Record (don't swallow silently) RPC failures so the caller can tell a throttled/failed fetch
  // apart from a genuinely empty range — otherwise a 429 looks like "no activity" and the page is
  // blank with no error.
  const guarded = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => { onError(); return [] as T[]; });

  // Do NOT pass the market list as an address filter: with 200+ markets the public Arc RPCs
  // reject the oversized filter outright (413), which surfaced as a permanent 503 on this page.
  // Every event here has the account as an indexed topic, so a signature+topic query already
  // returns a tiny result set; we intersect with the known market addresses afterwards instead.
  const knownMarkets = new Set(marketAddresses.map((address) => address.toLowerCase()));
  const fromKnownMarkets = <T extends { address: string }>(logs: T[]): T[] =>
    logs.filter((log) => knownMarkets.has(log.address.toLowerCase()));

  const [buys, claims, refunds, lmsrBuys, lmsrSells, lmsrWins, lmsrRefunds, createdGroups] = await Promise.all([
    marketAddresses.length
      ? guarded(client.getLogs({ event: sharesBoughtEvent, args: { recipient: account }, fromBlock, toBlock })).then(fromKnownMarkets)
      : Promise.resolve([]),
    marketAddresses.length
      ? guarded(client.getLogs({ event: claimedEvent, args: { user: account }, fromBlock, toBlock })).then(fromKnownMarkets)
      : Promise.resolve([]),
    marketAddresses.length
      ? guarded(client.getLogs({ event: refundedEvent, args: { user: account }, fromBlock, toBlock })).then(fromKnownMarkets)
      : Promise.resolve([]),
    marketAddresses.length
      ? guarded(client.getLogs({ event: lmsrSharesBoughtEvent, args: { buyer: account }, fromBlock, toBlock })).then(fromKnownMarkets)
      : Promise.resolve([]),
    marketAddresses.length
      ? guarded(client.getLogs({ event: lmsrSharesSoldEvent, args: { seller: account }, fromBlock, toBlock })).then(fromKnownMarkets)
      : Promise.resolve([]),
    marketAddresses.length
      ? guarded(client.getLogs({ event: lmsrWinnerPaidEvent, args: { winner: account }, fromBlock, toBlock })).then(fromKnownMarkets)
      : Promise.resolve([]),
    marketAddresses.length
      ? guarded(client.getLogs({ event: lmsrRefundedEvent, args: { holder: account }, fromBlock, toBlock })).then(fromKnownMarkets)
      : Promise.resolve([]),
    Promise.all(factoryAddresses.map((factory) => (
      factory.multiOutcome
        ? guarded(client.getLogs({ address: factory.address, event: multiOutcomeMarketCreatedEvent, args: { creator: account }, fromBlock, toBlock }))
        : guarded(client.getLogs({ address: factory.address, event: marketCreatedEvent, args: { creator: account }, fromBlock, toBlock }))
    ))),
  ]);

  return buildActivityRows({
    buys, claims, refunds, lmsrBuys, lmsrSells, lmsrWins, lmsrRefunds, created: createdGroups.flat(),
  });
}

// Minimal log shape both sources produce: viem getLogs results and normalized Blockscout rows.
type RawLog = {
  address: string;
  args: Record<string, unknown>;
  blockNumber?: bigint | null;
  logIndex?: number | null;
  transactionHash?: Hex | null;
};

function buildActivityRows(groups: {
  buys: RawLog[]; claims: RawLog[]; refunds: RawLog[];
  lmsrBuys: RawLog[]; lmsrSells: RawLog[]; lmsrWins: RawLog[]; lmsrRefunds: RawLog[];
  created: RawLog[];
}): ActivityRow[] {
  const { buys, claims, refunds, lmsrBuys, lmsrSells, lmsrWins, lmsrRefunds, created } = groups;
  return [
    ...buys.map((log) => ({
      label: 'Bought outcome',
      market: `Market ${truncateAddress(log.address)}`,
      detail: formatUsdc((log.args.amount as bigint | undefined) ?? BigInt(0)),
      status: 'Confirmed' as const,
      time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      kind: 'out' as const,
      txHash: log.transactionHash ?? undefined,
      blockNumber: log.blockNumber ?? BigInt(0),
      logIndex: log.logIndex ?? 0,
      marketAddress: log.address as Address,
      outcomeIndex: Number((log.args.outcome as number | bigint | undefined) ?? 0),
    })),
    ...claims.map((log) => ({
      label: 'Won payout',
      market: `Market ${truncateAddress(log.address)}`,
      detail: `${formatUsdc((log.args.amount as bigint | undefined) ?? BigInt(0))} payout`,
      status: 'Confirmed' as const,
      time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      kind: 'win' as const,
      txHash: log.transactionHash ?? undefined,
      blockNumber: log.blockNumber ?? BigInt(0),
      logIndex: log.logIndex ?? 0,
      marketAddress: log.address as Address,
    })),
    ...refunds.map((log) => ({
      label: 'Refunded collateral',
      market: `Market ${truncateAddress(log.address)}`,
      detail: formatUsdc((log.args.amount as bigint | undefined) ?? BigInt(0)),
      status: 'Confirmed' as const,
      time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      kind: 'refund' as const,
      txHash: log.transactionHash ?? undefined,
      blockNumber: log.blockNumber ?? BigInt(0),
      logIndex: log.logIndex ?? 0,
      marketAddress: log.address as Address,
    })),
    ...lmsrBuys.map((log) => ({
      label: 'Bought outcome',
      market: `Market ${truncateAddress(log.address)}`,
      detail: formatUsdc((log.args.cost6 as bigint | undefined) ?? BigInt(0)),
      status: 'Confirmed' as const,
      time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      kind: 'out' as const,
      txHash: log.transactionHash ?? undefined,
      blockNumber: log.blockNumber ?? BigInt(0),
      logIndex: log.logIndex ?? 0,
      marketAddress: log.address as Address,
      outcomeIndex: Number((log.args.outcome as number | bigint | undefined) ?? 0),
    })),
    ...lmsrSells.map((log) => ({
      label: 'Sold shares',
      market: `Market ${truncateAddress(log.address)}`,
      detail: `${formatUsdc((log.args.refund6 as bigint | undefined) ?? BigInt(0))} received`,
      status: 'Confirmed' as const,
      time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      kind: 'in' as const,
      txHash: log.transactionHash ?? undefined,
      blockNumber: log.blockNumber ?? BigInt(0),
      logIndex: log.logIndex ?? 0,
      marketAddress: log.address as Address,
    })),
    // The auto-payout "airdrop": settled V3 markets push winnings via payWinners, no claim needed —
    // these rows are how those wins show up for every wallet type.
    ...lmsrWins.map((log) => ({
      label: 'Won payout',
      market: `Market ${truncateAddress(log.address)}`,
      detail: `${formatUsdc((log.args.amount6 as bigint | undefined) ?? BigInt(0))} payout`,
      status: 'Confirmed' as const,
      time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      kind: 'win' as const,
      txHash: log.transactionHash ?? undefined,
      blockNumber: log.blockNumber ?? BigInt(0),
      logIndex: log.logIndex ?? 0,
      marketAddress: log.address as Address,
    })),
    ...lmsrRefunds.map((log) => ({
      label: 'Refunded collateral',
      market: `Market ${truncateAddress(log.address)}`,
      detail: formatUsdc((log.args.amount6 as bigint | undefined) ?? BigInt(0)),
      status: 'Confirmed' as const,
      time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      kind: 'refund' as const,
      txHash: log.transactionHash ?? undefined,
      blockNumber: log.blockNumber ?? BigInt(0),
      logIndex: log.logIndex ?? 0,
      marketAddress: log.address as Address,
    })),
    ...created.map((log) => {
      const marketAddress = (log.args.market ?? '') as Address;
      return {
        label: 'Created market',
        market: isAddress(marketAddress) ? `Market ${truncateAddress(marketAddress)}` : 'Market',
        detail: isAddress(marketAddress) ? truncateAddress(marketAddress) : 'Created',
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
        kind: 'create' as const,
        txHash: log.transactionHash ?? undefined,
        blockNumber: log.blockNumber ?? BigInt(0),
        logIndex: log.logIndex ?? 0,
        marketAddress: isAddress(marketAddress) ? marketAddress : undefined,
      };
    }),
  ] satisfies ActivityRow[];
}

// ── Blockscout-indexed history (primary source) ────────────────────────────
// The RPC path scans block windows and dies by a thousand cuts on the throttled public
// endpoints (thirdweb caps getLogs at 1,000 blocks; empty recent windows read as "broken").
// The explorer's indexed log search answers one signature+account query over the ENTIRE
// chain history in ~1-2s, so it serves the page; the RPC scan remains the fallback.
async function blockscoutLogs(event: AbiEvent, args: Record<string, unknown>, address?: Address): Promise<RawLog[]> {
  const topics = encodeEventTopics({ abi: [event], eventName: event.name, args } as Parameters<typeof encodeEventTopics>[0]);
  const params = new URLSearchParams({ module: 'logs', action: 'getLogs', fromBlock: '0', toBlock: 'latest' });
  if (address) params.set('address', address);
  const present: number[] = [];
  topics.forEach((topic, index) => {
    if (topic) { params.set(`topic${index}`, topic as string); present.push(index); }
  });
  for (let a = 0; a < present.length; a += 1) {
    for (let b = a + 1; b < present.length; b += 1) {
      params.set(`topic${present[a]}_${present[b]}_opr`, 'and');
    }
  }
  const res = await fetch(`${BLOCKSCOUT_API}?${params.toString()}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`blockscout ${res.status}`);
  const json = await res.json() as { status?: string; message?: string; result?: unknown };
  if (!Array.isArray(json.result)) {
    if (json.status === '0' && /no records/i.test(String(json.message ?? json.result ?? ''))) return [];
    throw new Error(String(json.message ?? 'blockscout error'));
  }
  const rows: RawLog[] = [];
  for (const raw of json.result as Array<{ address?: string; data?: Hex; topics?: Hex[]; blockNumber?: string; logIndex?: string; transactionHash?: Hex }>) {
    try {
      const decoded = decodeEventLog({ abi: [event], data: raw.data ?? '0x', topics: (raw.topics ?? []) as [Hex, ...Hex[]] });
      rows.push({
        address: String(raw.address ?? ''),
        args: (decoded.args ?? {}) as Record<string, unknown>,
        blockNumber: raw.blockNumber ? BigInt(raw.blockNumber) : BigInt(0),
        // Etherscan-compat responses encode index 0 as "0x" (empty), which parses to NaN.
        logIndex: Number.parseInt(raw.logIndex && raw.logIndex !== '0x' ? raw.logIndex : '0x0', 16),
        transactionHash: raw.transactionHash,
      });
    } catch { /* skip undecodable rows */ }
  }
  return rows;
}

async function fetchRowsFromBlockscout(input: {
  account: Address;
  factoryAddresses: Array<{ address: Address; multiOutcome: boolean }>;
  marketAddresses: Address[];
}): Promise<ActivityRow[]> {
  const { account, factoryAddresses, marketAddresses } = input;
  const knownMarkets = new Set(marketAddresses.map((address) => address.toLowerCase()));
  const fromKnownMarkets = (logs: RawLog[]) => logs.filter((log) => knownMarkets.has(log.address.toLowerCase()));

  const [buys, claims, refunds, lmsrBuys, lmsrSells, lmsrWins, lmsrRefunds, createdGroups] = await Promise.all([
    blockscoutLogs(sharesBoughtEvent as AbiEvent, { recipient: account }).then(fromKnownMarkets),
    blockscoutLogs(claimedEvent as AbiEvent, { user: account }).then(fromKnownMarkets),
    blockscoutLogs(refundedEvent as AbiEvent, { user: account }).then(fromKnownMarkets),
    blockscoutLogs(lmsrSharesBoughtEvent as AbiEvent, { buyer: account }).then(fromKnownMarkets),
    blockscoutLogs(lmsrSharesSoldEvent as AbiEvent, { seller: account }).then(fromKnownMarkets),
    blockscoutLogs(lmsrWinnerPaidEvent as AbiEvent, { winner: account }).then(fromKnownMarkets),
    blockscoutLogs(lmsrRefundedEvent as AbiEvent, { holder: account }).then(fromKnownMarkets),
    Promise.all(factoryAddresses.map((factory) => (
      blockscoutLogs(
        (factory.multiOutcome ? multiOutcomeMarketCreatedEvent : marketCreatedEvent) as AbiEvent,
        { creator: account },
        factory.address,
      )
    ))),
  ]);

  return buildActivityRows({
    buys, claims, refunds, lmsrBuys, lmsrSells, lmsrWins, lmsrRefunds, created: createdGroups.flat(),
  });
}

function serializeRow(row: ActivityRow): PortfolioActivity {
  return {
    label: row.label,
    market: row.market,
    detail: row.detail,
    status: row.status,
    time: row.time,
    kind: row.kind,
    txHash: row.txHash,
  };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!(await checkRateLimit('activity', ip, { limit: 90, windowSec: 60, failOpen: true }))) {
    return NextResponse.json({ ok: false, error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const config = getArcConfig();
  const accountParam = request.nextUrl.searchParams.get('account');
  const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
  const cursor = parseCursor(request.nextUrl.searchParams.get('cursor'));

  if (!accountParam || !isAddress(accountParam)) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid account address.' }, { status: 400 });
  }

  if ((!config.factoryAddress || !isAddress(config.factoryAddress))
    && (!config.multiOutcomeFactoryAddress || !isAddress(config.multiOutcomeFactoryAddress))) {
    return NextResponse.json({ ok: false, error: 'Market factory is not configured.' }, { status: 500 });
  }

  const client = createArcClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Arc RPC is not configured.' }, { status: 500 });
  }

  const account = accountParam as Address;
  const factoryAddresses = [
    isAddress(config.factoryAddress) ? { address: config.factoryAddress as Address, multiOutcome: false } : null,
    isAddress(config.multiOutcomeFactoryAddress) ? { address: config.multiOutcomeFactoryAddress as Address, multiOutcome: true } : null,
    ...config.legacyFactoryAddresses.filter((address) => isAddress(address)).map((address) => ({ address: address as Address, multiOutcome: false })),
    ...config.legacyMultiOutcomeFactoryAddresses.filter((address) => isAddress(address)).map((address) => ({ address: address as Address, multiOutcome: true })),
  ].filter((factory): factory is { address: Address; multiOutcome: boolean } => factory !== null);
  const latestBlock = await client.getBlockNumber().catch(() => BigInt(0));
  // Market addresses come from the DB snapshot (already maintained for the grid) instead of
  // re-enumerating every factory on-chain — that enumeration was ~1,500 individual eth_calls
  // per request, which alone saturated the public RPC pool and made this page slow or 503.
  // Chain enumeration remains only as the cold-start fallback when no snapshot exists yet.
  const snapshotMarkets = (await readMarketListSnapshot().catch(() => null))?.markets ?? [];
  const marketAddresses = snapshotMarkets.length > 0
    ? snapshotMarkets.map((m) => m.id as Address).filter((address) => isAddress(address))
    : (await Promise.all(factoryAddresses.map((factory) => (
        fetchFactoryMarkets(client, factory.address, factory.multiOutcome)
      )))).flat();
  const knownSummaries = new Map(snapshotMarkets.map((m) => [
    m.id.toLowerCase(),
    {
      title: m.title,
      outcomes: m.outcomes && m.outcomes.length >= 2 ? m.outcomes.map((o) => o.label) : ['YES', 'NO'],
    },
  ]));
  // Primary source: the explorer's indexed log search — full history in a handful of ~1s
  // queries, immune to the public-RPC block caps and throttling that plagued the scan below.
  try {
    const allRows = (await fetchRowsFromBlockscout({ account, factoryAddresses, marketAddresses }))
      .filter((row) => isBeforeCursor(row, cursor))
      .sort(sortRows);
    const pageRows = (await hydrateTitles(client, allRows.slice(0, limit), knownSummaries)).sort(sortRows);
    const oldest = pageRows[pageRows.length - 1];
    const nextCursor = allRows.length > limit && oldest
      ? `${oldest.blockNumber.toString()}:${oldest.logIndex}`
      : null;
    return NextResponse.json({
      ok: true,
      items: pageRows.map(serializeRow),
      nextCursor,
      scannedFromBlock: '0',
      scannedToBlock: latestBlock.toString(),
      hasMore: nextCursor !== null,
    }, { headers: activityCacheHeaders });
  } catch {
    // Explorer down/unreachable — fall through to the RPC block scan.
  }

  const collected: ActivityRow[] = [];
  let rpcFailures = 0;

  let toBlock = cursor ? cursor.blockNumber : latestBlock;
  let chunksScanned = 0;
  let lowestScannedBlock = toBlock;

  while (toBlock >= BigInt(0) && chunksScanned < MAX_CHUNKS && collected.length <= limit) {
    const fromBlock = toBlock >= BLOCK_CHUNK ? toBlock - BLOCK_CHUNK + BigInt(1) : BigInt(0);
    lowestScannedBlock = fromBlock;
    const rows = await fetchRowsInRange({
      client,
      account,
      factoryAddresses,
      marketAddresses,
      fromBlock,
      toBlock,
      onError: () => { rpcFailures += 1; },
    });

    collected.push(...rows.filter((row) => isBeforeCursor(row, cursor)));
    collected.sort(sortRows);

    if (collected.length > limit || fromBlock === BigInt(0)) break;
    toBlock = fromBlock - BigInt(1);
    chunksScanned += 1;
  }

  // Distinguish a throttled/failed RPC from a genuinely empty history: if we collected nothing but
  // log queries were failing, surface a retryable error instead of a misleading empty page.
  if (collected.length === 0 && rpcFailures > 0) {
    return NextResponse.json(
      { ok: false, error: 'Arc RPC is busy right now — activity could not load. Try again shortly.' },
      { status: 503 },
    );
  }

  const pageRows = (await hydrateTitles(client, collected.slice(0, limit), knownSummaries)).sort(sortRows);
  const oldest = pageRows[pageRows.length - 1];
  // Two distinct "more" cases. (1) More rows inside the range we already scanned — continue from
  // the oldest row on this page. (2) The per-request chunk budget ran out ABOVE block 0 — continue
  // from just below the scan floor, even when this page carried ZERO rows. Case 2 used to return
  // nextCursor:null, which hid "See more" exactly when the user's history sat below the scanned
  // window and made older activity unreachable.
  const moreInScannedRange = collected.length > limit && Boolean(oldest);
  const moreBelowScan = lowestScannedBlock > BigInt(0);
  const nextCursor = moreInScannedRange && oldest
    ? `${oldest.blockNumber.toString()}:${oldest.logIndex}`
    : moreBelowScan
      ? `${(lowestScannedBlock - BigInt(1)).toString()}:${Number.MAX_SAFE_INTEGER}`
      : null;

  return NextResponse.json({
    ok: true,
    items: pageRows.map(serializeRow),
    nextCursor,
    scannedFromBlock: lowestScannedBlock.toString(),
    scannedToBlock: (cursor ? cursor.blockNumber : latestBlock).toString(),
    hasMore: nextCursor !== null,
  }, { headers: activityCacheHeaders });
}
