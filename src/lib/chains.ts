import { defineChain } from 'viem';

const multicall3 = {
  address: '0xca11bde05977b3631167028862be2a173976ca11',
  blockCreated: 0,
} as const;

export const arcTestnet = defineChain({
  id: 5_042_002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
  contracts: { multicall3 },
  testnet: true,
});

export const baseSepolia = defineChain({
  id: 84_532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
  blockExplorers: { default: { name: 'Basescan', url: 'https://sepolia.basescan.org' } },
  contracts: { multicall3: { ...multicall3, blockCreated: 1_059_647 } },
  testnet: true,
});

export const sepolia = defineChain({
  id: 11_155_111,
  name: 'Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://11155111.rpc.thirdweb.com'] } },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' } },
  contracts: { multicall3: { ...multicall3, blockCreated: 751_532 } },
  testnet: true,
});

export const avalancheFuji = defineChain({
  id: 43_113,
  name: 'Avalanche Fuji',
  nativeCurrency: { name: 'Avalanche Fuji', symbol: 'AVAX', decimals: 18 },
  rpcUrls: { default: { http: ['https://api.avax-test.network/ext/bc/C/rpc'] } },
  blockExplorers: { default: { name: 'SnowTrace', url: 'https://testnet.snowtrace.io' } },
  contracts: { multicall3: { ...multicall3, blockCreated: 7_096_959 } },
  testnet: true,
});

export const arbitrumSepolia = defineChain({
  id: 421_614,
  name: 'Arbitrum Sepolia',
  nativeCurrency: { name: 'Arbitrum Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] } },
  blockExplorers: { default: { name: 'Arbiscan', url: 'https://sepolia.arbiscan.io' } },
  contracts: { multicall3: { ...multicall3, blockCreated: 81_930 } },
  testnet: true,
});
