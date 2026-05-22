import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  formatUnits,
  http,
  isAddress,
  type Address,
} from 'viem';
import { getArcChainId, getArcConfig } from '@/lib/arcConfig';
import { prestoMarketAbi, prestoMarketFactoryAbi } from '@/lib/contracts';
import { parseMarketMetadata } from '@/lib/marketMetadata';
import type { PortfolioActivity } from '@/lib/portfolio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_MARKETS = 500;
const BLOCK_CHUNK = BigInt(7_200);
const MAX_CHUNKS = 8;

const sharesBoughtEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'SharesBought')!;
const claimedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Claimed')!;
const refundedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Refunded')!;
const marketCreatedEvent = prestoMarketFactoryAbi.find((e) => e.type === 'event' && e.name === 'MarketCreated')!;

type Cursor = {
  blockNumber: bigint;
  logIndex: number;
};

type ActivityRow = PortfolioActivity & {
  blockNumber: bigint;
  logIndex: number;
  marketAddress?: Address;
};

function formatUsdc(value: bigint) {
  return `$${Number(formatUnits(value, 6)).toFixed(2)}`;
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
  const config = getArcConfig();
  if (!config.rpcUrl) return null;

  return createPublicClient({
    chain: {
      id: getArcChainId(),
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: {
        default: { http: [config.rpcUrl] },
      },
    },
    transport: http(config.rpcUrl),
  });
}

async function fetchFactoryMarkets(client: ReturnType<typeof createPublicClient>, factoryAddress: Address) {
  const count = await client.readContract({
    address: factoryAddress,
    abi: prestoMarketFactoryAbi,
    functionName: 'marketCount',
  }).catch(() => BigInt(0));

  const capped = Math.min(Number(count), MAX_MARKETS);
  if (!Number.isFinite(capped) || capped <= 0) return [] as Address[];

  const markets = await Promise.all(Array.from({ length: capped }, (_, index) => (
    client.readContract({
      address: factoryAddress,
      abi: prestoMarketFactoryAbi,
      functionName: 'markets',
      args: [BigInt(index)],
    }).catch(() => null)
  )));

  return markets.filter((market): market is Address => Boolean(market && isAddress(market)));
}

async function readMarketTitle(client: ReturnType<typeof createPublicClient>, marketAddress: Address) {
  const fallback = `Market ${truncateAddress(marketAddress)}`;
  const uri = await client.readContract({
    address: marketAddress,
    abi: prestoMarketAbi,
    functionName: 'metadataURI',
  }).catch(() => '');

  if (!uri) return fallback;
  const metadata = parseMarketMetadata(uri);
  return metadata?.name?.trim() || fallback;
}

async function hydrateTitles(client: ReturnType<typeof createPublicClient>, rows: ActivityRow[]) {
  const addresses = Array.from(new Set(rows.map((row) => row.marketAddress).filter(Boolean))) as Address[];
  if (addresses.length === 0) return rows;

  const titleEntries = await Promise.all(addresses.map(async (address) => [
    address.toLowerCase(),
    await readMarketTitle(client, address),
  ] as const));
  const titles = new Map(titleEntries);

  return rows.map((row) => ({
    ...row,
    market: row.marketAddress ? titles.get(row.marketAddress.toLowerCase()) ?? row.market : row.market,
  }));
}

async function fetchRowsInRange(input: {
  client: ReturnType<typeof createPublicClient>;
  account: Address;
  factoryAddress: Address;
  marketAddresses: Address[];
  fromBlock: bigint;
  toBlock: bigint;
}) {
  const { client, account, factoryAddress, marketAddresses, fromBlock, toBlock } = input;

  const [buys, claims, refunds, created] = await Promise.all([
    marketAddresses.length
      ? client.getLogs({ address: marketAddresses, event: sharesBoughtEvent, args: { recipient: account }, fromBlock, toBlock }).catch(() => [])
      : Promise.resolve([]),
    marketAddresses.length
      ? client.getLogs({ address: marketAddresses, event: claimedEvent, args: { user: account }, fromBlock, toBlock }).catch(() => [])
      : Promise.resolve([]),
    marketAddresses.length
      ? client.getLogs({ address: marketAddresses, event: refundedEvent, args: { user: account }, fromBlock, toBlock }).catch(() => [])
      : Promise.resolve([]),
    client.getLogs({ address: factoryAddress, event: marketCreatedEvent, args: { creator: account }, fromBlock, toBlock }).catch(() => []),
  ]);

  return [
    ...buys.map((log) => ({
      label: `Bought ${log.args.outcome === 0 ? 'YES' : 'NO'}`,
      market: `Market ${truncateAddress(log.address)}`,
      detail: formatUsdc(log.args.amount ?? BigInt(0)),
      status: 'Confirmed' as const,
      time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      kind: 'out' as const,
      txHash: log.transactionHash ?? undefined,
      blockNumber: log.blockNumber ?? BigInt(0),
      logIndex: log.logIndex ?? 0,
      marketAddress: log.address as Address,
    })),
    ...claims.map((log) => ({
      label: 'Won payout',
      market: `Market ${truncateAddress(log.address)}`,
      detail: `${formatUsdc(log.args.amount ?? BigInt(0))} payout`,
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
      detail: formatUsdc(log.args.amount ?? BigInt(0)),
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
  const config = getArcConfig();
  const accountParam = request.nextUrl.searchParams.get('account');
  const limit = parseLimit(request.nextUrl.searchParams.get('limit'));
  const cursor = parseCursor(request.nextUrl.searchParams.get('cursor'));

  if (!accountParam || !isAddress(accountParam)) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid account address.' }, { status: 400 });
  }

  if (!config.factoryAddress || !isAddress(config.factoryAddress)) {
    return NextResponse.json({ ok: false, error: 'Market factory is not configured.' }, { status: 500 });
  }

  const client = createArcClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Arc RPC is not configured.' }, { status: 500 });
  }

  const account = accountParam as Address;
  const factoryAddress = config.factoryAddress as Address;
  const latestBlock = await client.getBlockNumber().catch(() => BigInt(0));
  const marketAddresses = await fetchFactoryMarkets(client, factoryAddress);
  const collected: ActivityRow[] = [];

  let toBlock = cursor ? cursor.blockNumber : latestBlock;
  let chunksScanned = 0;
  let lowestScannedBlock = toBlock;

  while (toBlock >= BigInt(0) && chunksScanned < MAX_CHUNKS && collected.length <= limit) {
    const fromBlock = toBlock >= BLOCK_CHUNK ? toBlock - BLOCK_CHUNK + BigInt(1) : BigInt(0);
    lowestScannedBlock = fromBlock;
    const rows = await fetchRowsInRange({
      client,
      account,
      factoryAddress,
      marketAddresses,
      fromBlock,
      toBlock,
    });

    collected.push(...rows.filter((row) => isBeforeCursor(row, cursor)));
    collected.sort(sortRows);

    if (collected.length > limit || fromBlock === BigInt(0)) break;
    toBlock = fromBlock - BigInt(1);
    chunksScanned += 1;
  }

  const pageRows = (await hydrateTitles(client, collected.slice(0, limit))).sort(sortRows);
  const oldest = pageRows[pageRows.length - 1];
  const hasMore = collected.length > limit || lowestScannedBlock > BigInt(0);

  return NextResponse.json({
    ok: true,
    items: pageRows.map(serializeRow),
    nextCursor: oldest && hasMore ? `${oldest.blockNumber.toString()}:${oldest.logIndex}` : null,
    scannedFromBlock: lowestScannedBlock.toString(),
    scannedToBlock: (cursor ? cursor.blockNumber : latestBlock).toString(),
    hasMore: Boolean(oldest && hasMore),
  });
}
