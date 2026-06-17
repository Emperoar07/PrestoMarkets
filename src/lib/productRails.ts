export type RailStatus = 'Current' | 'Planned' | 'Later';

export type ProductRail = {
  name: string;
  status: RailStatus;
  purpose: string;
  note: string;
};

export const productRails: ProductRail[] = [
  {
    name: 'USDC',
    status: 'Current',
    purpose: 'Market collateral',
    note: 'Markets settle in USDC so every position, payout, and fee stays dollar denominated.',
  },
  {
    name: 'EURC',
    status: 'Current',
    purpose: 'Euro market collateral',
    note: 'Euro markets settle in EURC through dedicated factories, so dollar and euro questions live side by side on the same engine.',
  },
  {
    name: 'Contracts',
    status: 'Current',
    purpose: 'Market engine',
    note: 'Presto Markets keeps its own contracts for market creation, settlement, claims, and refunds.',
  },
  {
    name: 'Circle Wallets',
    status: 'Current',
    purpose: 'App-native onboarding + signing',
    note: 'Email, Google, and PIN sign-in via Circle user-controlled wallets. Live Arc transactions go through Circle\'s contract-execution challenge flow — users PIN-confirm and Circle MPC signs and broadcasts.',
  },
  {
    name: 'RainbowKit',
    status: 'Current',
    purpose: 'External EVM wallets',
    note: 'External wallet connectors render directly inside the Presto sign-in modal, with WalletConnect project ID configured for QR support.',
  },
  {
    name: 'Paymaster',
    status: 'Current',
    purpose: 'Gasless signing',
    note: 'Passkey and app wallet trades are sponsored through the Circle bundler, so users transact on Arc without sourcing native gas.',
  },
  {
    name: 'Passkeys',
    status: 'Current',
    purpose: 'Device sign-in',
    note: 'Circle Modular Wallets let users sign in with a device passkey and confirm trades with biometrics, backed by a Circle smart account on Arc.',
  },
  {
    name: 'x402',
    status: 'Current',
    purpose: 'Paid agent API',
    note: 'The public /api/v1 data endpoints can require a small USDC payment per call, so other agents pay to read the Presto book.',
  },
  {
    name: 'Wallets',
    status: 'Current',
    purpose: 'Wallet abstraction',
    note: 'The app supports Circle embedded wallets plus RainbowKit external wallets without replacing the market contracts.',
  },
  {
    name: 'Bridge Kit',
    status: 'Planned',
    purpose: 'Cross-chain USDC funding',
    note: 'Bridge Kit and CCTP can help users fund Arc markets from supported chains without leaving the product.',
  },
  {
    name: 'CCTP',
    status: 'Planned',
    purpose: 'Native USDC movement',
    note: 'CCTP is the underlying cross chain USDC transfer rail for future funding and withdrawals.',
  },
  {
    name: 'Gateway',
    status: 'Current',
    purpose: 'Cross-chain USDC funding',
    note: 'Move to Arc uses Circle Gateway so users top up their Arc balance from Base, Ethereum, Arbitrum, or Avalanche right inside the wallet panel.',
  },
];

export const currentRails = productRails.filter((rail) => rail.status === 'Current');
export const plannedRails = productRails.filter((rail) => rail.status !== 'Current');
