require('@nomicfoundation/hardhat-toolbox');
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
};
