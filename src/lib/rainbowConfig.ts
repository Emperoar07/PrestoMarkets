import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { fallback, http } from 'wagmi';
import { arcRpcUrls } from './arcClient';
import { arcTestnet } from './chains';

// All configured Arc RPCs (dedicated dRPC/QuikNode first, public last). The public RPC is heavily
// rate-limited (HTTP 429), so wagmi MUST fail over across endpoints — using a single public http
// transport meant the connected wallet's nonce/gas reads died on 429 with no fallback, blocking
// every buy/sell. This mirrors arcReadTransport so the wallet path is as resilient as app reads.
const rpcUrls = arcRpcUrls(process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim());

export const arcTestnetChain = {
  ...arcTestnet,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: {
      http: rpcUrls as unknown as readonly string[],
    },
  },
  iconBackground: '#090e1a',
} as const;

export const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || '';

export const rainbowConfig = getDefaultConfig({
  appName: 'Presto Markets',
  projectId: walletConnectProjectId || 'presto-markets',
  chains: [arcTestnetChain],
  ssr: true,
  transports: {
    // Batch JSON-RPC calls and fail over across providers so a throttled endpoint can't trap a trade.
    [arcTestnetChain.id]: fallback(rpcUrls.map((url) => http(url, { batch: true })), { rank: false }),
  },
});
