import { createPublicClient, formatUnits, type Address } from 'viem';
import { prestoMarketAbi } from './contracts';
import { getArcChainId } from './arcConfig';

type ClientLike = ReturnType<typeof createPublicClient>;

type Checkpoint = {
  yes: number;
  no: number;
  lastIndexedBlock: string;
};

const SCHEMA_VERSION = 'v1';
const LOG_PAGE_BLOCKS = BigInt(50_000);

const sharesBoughtEvent = prestoMarketAbi.find(
  (e) => e.type === 'event' && e.name === 'SharesBought',
)!;

function storageKey(account: Address, market: Address): string {
  return `presto:costBasis:${SCHEMA_VERSION}:${getArcChainId()}:${account.toLowerCase()}:${market.toLowerCase()}`;
}

function readCheckpoint(account: Address, market: Address): Checkpoint | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(account, market));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Checkpoint;
    if (typeof parsed.yes !== 'number' || typeof parsed.no !== 'number' || typeof parsed.lastIndexedBlock !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCheckpoint(account: Address, market: Address, checkpoint: Checkpoint): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(account, market), JSON.stringify(checkpoint));
  } catch {
    // Quota exceeded or storage disabled — degrade silently
  }
}

export async function fetchMarketCostBasisIndexed(
  client: ClientLike,
  market: Address,
  account: Address,
): Promise<{ yes: number; no: number }> {
  const checkpoint = readCheckpoint(account, market);
  const latestBlock = await client.getBlockNumber().catch(() => BigInt(0));
  if (latestBlock === BigInt(0)) {
    return checkpoint ? { yes: checkpoint.yes, no: checkpoint.no } : { yes: 0, no: 0 };
  }

  const fromBlock = checkpoint ? BigInt(checkpoint.lastIndexedBlock) + BigInt(1) : BigInt(0);
  if (fromBlock > latestBlock) {
    return { yes: checkpoint!.yes, no: checkpoint!.no };
  }

  let yes = checkpoint?.yes ?? 0;
  let no = checkpoint?.no ?? 0;

  // Page through block ranges so wide initial scans don't hit RPC limits.
  let cursor = fromBlock;
  while (cursor <= latestBlock) {
    const pageEnd = cursor + LOG_PAGE_BLOCKS - BigInt(1) > latestBlock
      ? latestBlock
      : cursor + LOG_PAGE_BLOCKS - BigInt(1);
    const logs = await client.getLogs({
      address: market,
      event: sharesBoughtEvent,
      args: { recipient: account },
      fromBlock: cursor,
      toBlock: pageEnd,
    }).catch(() => []);

    for (const log of logs) {
      const amount = Number(formatUnits(log.args.amount ?? BigInt(0), 6));
      if (log.args.outcome === 0) yes += amount;
      else no += amount;
    }
    cursor = pageEnd + BigInt(1);
  }

  writeCheckpoint(account, market, { yes, no, lastIndexedBlock: latestBlock.toString() });
  return { yes, no };
}
