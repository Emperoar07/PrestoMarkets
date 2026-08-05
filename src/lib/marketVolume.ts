/**
 * Per-market traded VOLUME from on-chain trade logs.
 *
 * The card's "Volume" used to be the market's collateral balance (V3) or totalCollateral (V2) —
 * that is the size of the POOL, not how much has been traded. A market seeded with $500 and never
 * traded showed "$500 volume"; a market traded heavily in both directions showed a number that
 * moved with net flow rather than turnover. Both are the liquidity figure wearing a volume label.
 *
 * Real volume is the USDC that actually changed hands: `cost6` on every SharesBought plus
 * `refund6` on every SharesSold (a sell is a trade too — it turns over the same book). Fees are
 * excluded because `cost6`/`refund6` are the pre-fee LMSR legs, which is the convention every
 * exchange uses for volume.
 *
 * Cost: the logs are queried with an ADDRESS ARRAY covering every market at once, chunked by
 * block, so it is ~chunks×2 RPC calls for the whole grid — not per-market. Best-effort: any chunk
 * that fails is skipped rather than failing the grid, and callers keep the previous figure.
 */

import { type AbiEvent, type Address } from 'viem';
import { createArcReadClient } from './arcClient';
import { getArcConfig } from './arcConfig';
import { prestoLmsrMarketAbi } from './contracts';

const BLOCK_CHUNK = BigInt(7_200);
/** Recent-history window. Matches marketIndexer's ledger span so both cover the same period. */
const MAX_CHUNKS = 24;

const lmsrSharesBoughtEvent = prestoLmsrMarketAbi.find(
  (e) => e.type === 'event' && e.name === 'SharesBought',
) as AbiEvent;
const lmsrSharesSoldEvent = prestoLmsrMarketAbi.find(
  (e) => e.type === 'event' && e.name === 'SharesSold',
) as AbiEvent;

/**
 * Sum traded USDC (6dp) per market address over the recent block window.
 * Returns a lowercased-address → total6 map. Markets with no trades are absent from the map
 * (callers should render $0, not the pool balance).
 */
export async function buildMarketVolumes(marketAddresses: Address[]): Promise<Map<string, bigint>> {
  const volumes = new Map<string, bigint>();
  if (typeof window !== 'undefined') return volumes;
  const config = getArcConfig();
  if (!config.rpcUrl || marketAddresses.length === 0) return volumes;

  const client = createArcReadClient();
  if (!client) return volumes;

  const latest = await client.getBlockNumber().catch(() => null);
  if (latest === null) return volumes;

  const span = BLOCK_CHUNK * BigInt(MAX_CHUNKS);
  const fromBlock = latest > span ? latest - span : BigInt(0);

  const add = (address: string | undefined, amount: bigint | undefined) => {
    if (!address || !amount) return;
    const key = address.toLowerCase();
    volumes.set(key, (volumes.get(key) ?? BigInt(0)) + amount);
  };

  for (let start = fromBlock; start <= latest; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - BigInt(1);
    const toBlock = end > latest ? latest : end;
    const [bought, sold] = await Promise.all([
      client.getLogs({ address: marketAddresses, event: lmsrSharesBoughtEvent, fromBlock: start, toBlock }).catch(() => []),
      client.getLogs({ address: marketAddresses, event: lmsrSharesSoldEvent, fromBlock: start, toBlock }).catch(() => []),
    ]);

    for (const log of bought) {
      const args = (log as { args?: { cost6?: bigint } }).args ?? {};
      add(log.address, args.cost6);
    }
    for (const log of sold) {
      const args = (log as { args?: { refund6?: bigint } }).args ?? {};
      add(log.address, args.refund6);
    }
  }

  return volumes;
}
