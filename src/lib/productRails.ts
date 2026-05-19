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
    note: 'V1 markets use USDC so every position, payout, and fee remains dollar-denominated.',
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
    status: 'Planned',
    purpose: 'Gas paid in USDC',
    note: 'Useful after smart-account support so users can interact without sourcing native gas.',
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
    status: 'Later',
    purpose: 'Unified USDC balance',
    note: 'Gateway is a strong fit once Presto Markets needs instant multi-chain balance access.',
  },
];

export const currentRails = productRails.filter((rail) => rail.status === 'Current');
export const plannedRails = productRails.filter((rail) => rail.status !== 'Current');
