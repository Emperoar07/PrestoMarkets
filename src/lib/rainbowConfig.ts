import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { arcTestnet } from 'wagmi/chains';

const arcRpcUrl = process.env.NEXT_PUBLIC_ARC_RPC_URL?.trim() || 'https://rpc.testnet.arc.network';

export const arcTestnetChain = {
  ...arcTestnet,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: {
      http: [arcRpcUrl],
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
    [arcTestnetChain.id]: http(arcTestnetChain.rpcUrls.default.http[0]),
  },
});
