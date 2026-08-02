/**
 * Phase 1 of the Available-USDC rails (docs/UBK_SPIKE.md): read-only multichain USDC balances.
 * "Available USDC" = what the connected wallet could spend on Presto once moved to Arc — its
 * Arc balance plus wallet USDC on the other Gateway-supported testnets we can read directly.
 *
 * Phase 2 wires @circle-fin/unified-balance-kit for the actual deposit → Gateway → Arc moves
 * (and Gateway deposit balances, which are 0 for everyone until that flow exists); plain
 * balance reads don't need the SDK.
 */

import { createPublicClient, erc20Abi, formatUnits, http, isAddress, type Address } from 'viem';
import { arbitrumSepolia, avalancheFuji, baseSepolia, sepolia } from './chains';
import { getArcConfig } from './arcConfig';
import { ARC_USDC_DECIMALS, createArcReadClient } from './arcClient';

export type ChainUsdcBalance = {
  key: string;
  label: string;
  isArc: boolean;
  /** USDC amount, or null when the chain read failed. */
  amount: number | null;
};

export type AvailableUsdc = {
  /** Sum of all readable chains (failed chains excluded). */
  total: number;
  /** Arc-only portion — what is spendable on Presto right now. */
  arc: number | null;
  chains: ChainUsdcBalance[];
  fetchedAt: number;
};

// Gateway-supported testnets we read (verified in docs/UBK_SPIKE.md). Arc comes from app config.
const EXTERNAL_CHAINS = [
  { key: 'baseSepolia', label: 'Base Sepolia', chain: baseSepolia, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address },
  { key: 'sepolia', label: 'Ethereum Sepolia', chain: sepolia, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address },
  { key: 'avalancheFuji', label: 'Avalanche Fuji', chain: avalancheFuji, usdc: '0x5425890298aed601595a70ab815c96711a31bc65' as Address },
  { key: 'arbitrumSepolia', label: 'Arbitrum Sepolia', chain: arbitrumSepolia, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' as Address },
] as const;

const READ_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 60_000;
const CACHE_PREFIX = 'presto:available-usdc:';

let memoryCache: { address: string; value: AvailableUsdc } | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { setTimeout(() => reject(new Error('balance read timeout')), ms); }),
  ]);
}

async function readUsdcBalance(rpcChain: Parameters<typeof createPublicClient>[0]['chain'], rpcUrl: string | undefined, usdc: Address, owner: Address): Promise<number | null> {
  try {
    const client = createPublicClient({ chain: rpcChain, transport: http(rpcUrl) });
    const raw = await withTimeout(
      client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      READ_TIMEOUT_MS,
    );
    return Number(formatUnits(raw as bigint, ARC_USDC_DECIMALS));
  } catch {
    return null;
  }
}

async function readArcUsdcBalance(usdc: Address, owner: Address): Promise<number | null> {
  try {
    const client = createArcReadClient();
    if (!client) return null;
    const raw = await withTimeout(
      client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      READ_TIMEOUT_MS,
    );
    return Number(formatUnits(raw as bigint, ARC_USDC_DECIMALS));
  } catch {
    return null;
  }
}

export function formatAvailableUsdc(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

/** Last known total for instant header paint (stale-while-revalidate). */
export function readCachedAvailableUsdc(address: string): string | null {
  if (typeof window === 'undefined' || !address) return null;
  try {
    return window.localStorage.getItem(CACHE_PREFIX + address.toLowerCase());
  } catch {
    return null;
  }
}

export async function fetchAvailableUsdc(address: string): Promise<AvailableUsdc | null> {
  if (!address || !isAddress(address)) return null;
  const owner = address as Address;

  if (memoryCache && memoryCache.address === owner.toLowerCase() && Date.now() - memoryCache.value.fetchedAt < CACHE_TTL_MS) {
    return memoryCache.value;
  }

  const config = getArcConfig();
  const arcRead: Promise<number | null> = config.rpcUrl && config.usdcAddress && isAddress(config.usdcAddress)
    ? readArcUsdcBalance(config.usdcAddress as Address, owner)
    : Promise.resolve(null);

  const [arc, ...others] = await Promise.all([
    arcRead,
    ...EXTERNAL_CHAINS.map((entry) => readUsdcBalance(entry.chain, undefined, entry.usdc, owner)),
  ]);

  const chains: ChainUsdcBalance[] = [
    { key: 'arc', label: 'Arc Testnet', isArc: true, amount: arc },
    ...EXTERNAL_CHAINS.map((entry, index) => ({ key: entry.key, label: entry.label, isArc: false, amount: others[index] })),
  ];

  const total = chains.reduce((sum, chain) => sum + (chain.amount ?? 0), 0);
  const value: AvailableUsdc = { total, arc, chains, fetchedAt: Date.now() };
  memoryCache = { address: owner.toLowerCase(), value };
  try {
    window.localStorage.setItem(CACHE_PREFIX + owner.toLowerCase(), formatAvailableUsdc(total));
  } catch { /* storage unavailable */ }
  return value;
}
