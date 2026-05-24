export type DisputePolicyItem = {
  title: string;
  summary: string;
};

export const disputePolicy: DisputePolicyItem[] = [
  {
    title: 'Closed markets lock trading',
    summary: 'Once the close time passes, buys and liquidity actions stop. The next step is evidence review and settlement.',
  },
  {
    title: 'Evidence is attached to settlement',
    summary: 'Agent markets keep their trend source, model reason, scores, and resolution evidence visible on the market page.',
  },
  {
    title: 'Resolver fallback',
    summary: 'If the resolver cannot settle cleanly, the market can be canceled so participants can use the refund flow.',
  },
  {
    title: 'Bad metadata fallback',
    summary: 'If a question or source becomes unusable before settlement, the safest path is cancellation rather than forced resolution.',
  },
  {
    title: 'Human review remains available',
    summary: 'The agent can prepare and submit actions, while the app keeps receipts readable enough for a human operator to inspect.',
  },
];

export const grantDemoStory = [
  'Presto shows how an autonomous market agent can operate on Arc with USDC as the native economic rail.',
  'Every agent market carries a visible receipt with the trend source, model reason, safety score, and machine-readable rules.',
  'Circle wallets let users join with app-native onboarding, while external wallets remain available for power users.',
  'Arc gives the agent predictable USDC-denominated execution so market creation and resolution can be audited end to end.',
];
