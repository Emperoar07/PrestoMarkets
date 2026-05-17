import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { arcTestnet } from 'wagmi/chains';

export const arcTestnetChain = {
  ...arcTestnet,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.testnet.arc.network'],
    },
  },
  iconBackground: '#090e1a',
} as const;

export const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

export const rainbowConfig = getDefaultConfig({
  appName: 'Presto Markets',
  projectId: walletConnectProjectId || 'presto-markets',
  chains: [arcTestnetChain],
  ssr: true,
  transports: {
    [arcTestnetChain.id]: http(arcTestnetChain.rpcUrls.default.http[0]),
  },
});
