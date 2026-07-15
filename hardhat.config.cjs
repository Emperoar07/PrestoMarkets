require('@nomicfoundation/hardhat-toolbox');
// Load .env.local first (Next.js precedence: .env.local overrides .env). dotenv does not override
// already-set vars, so secrets like PRIVATE_KEY in .env.local are picked up for hardhat deploys.
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ quiet: true });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // LMSR market's wide constructor + LMSR math need the IR pipeline to avoid "stack too deep".
      viaIR: true,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    arc: {
      // Prefers the dedicated dRPC/QuikNode endpoint from ARC_RPC_URL; public RPC as fallback.
      url: process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network',
      chainId: 5042002,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    arcPublic: {
      url: 'https://rpc.testnet.arc.network',
      chainId: 5042002,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  // Source verification on Arc's Blockscout explorer (testnet.arcscan.app):
  //   npx hardhat verify --network arc <address> <constructorArgs...>
  // Blockscout doesn't require an API key, but hardhat-verify insists on a non-empty string.
  etherscan: {
    apiKey: { arc: 'blockscout', arcPublic: 'blockscout' },
    customChains: [
      {
        network: 'arc',
        chainId: 5042002,
        urls: { apiURL: 'https://testnet.arcscan.app/api', browserURL: 'https://testnet.arcscan.app' },
      },
      {
        network: 'arcPublic',
        chainId: 5042002,
        urls: { apiURL: 'https://testnet.arcscan.app/api', browserURL: 'https://testnet.arcscan.app' },
      },
    ],
  },
  sourcify: { enabled: false },
};
