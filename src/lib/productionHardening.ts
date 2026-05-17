export type HardeningStatus = 'Current' | 'Required' | 'Later';

export type HardeningItem = {
  title: string;
  status: HardeningStatus;
  summary: string;
};

export const auditReadiness: HardeningItem[] = [
  {
    title: 'Fixed-share accounting review',
    status: 'Required',
    summary: 'Confirm buy, claim, refund, rounding, fee, and resolved-collateral math before any real-value market.',
  },
  {
    title: 'Resolver authority review',
    status: 'Required',
    summary: 'Verify resolver-only settlement, cancellation timing, evidence URI handling, and operational key controls.',
  },
  {
    title: 'Factory owner review',
    status: 'Required',
    summary: 'Review fee recipient updates, fee caps, ownership transfer, and deployment custody before production use.',
  },
  {
    title: 'Token behavior review',
    status: 'Required',
    summary: 'Validate assumptions against the selected USDC contract, including decimals, transfer behavior, and allowance UX.',
  },
];

export const failurePathDesign: HardeningItem[] = [
  {
    title: 'Resolver unavailable',
    status: 'Required',
    summary: 'Define how markets are canceled, extended, reassigned, or escalated if the resolver cannot settle on time.',
  },
  {
    title: 'Evidence disputed',
    status: 'Required',
    summary: 'Design a dispute window, challenger flow, and final override rule before any higher-trust market goes live.',
  },
  {
    title: 'Bad market metadata',
    status: 'Required',
    summary: 'Set rules for invalid questions, ambiguous sources of truth, broken metadata URIs, and duplicate markets.',
  },
  {
    title: 'Indexing gaps',
    status: 'Current',
    summary: 'Keep portfolio and activity UI honest while account history still depends on recent Arc log windows.',
  },
];

export const laterHardening: HardeningItem[] = [
  {
    title: 'Bonded disputes',
    status: 'Later',
    summary: 'Add resolver and challenger bonds only after griefing, refund, timeout, and appeal economics are designed.',
  },
  {
    title: 'Agent-assisted resolution',
    status: 'Later',
    summary: 'Keep AI resolution out of scope until human override, failure modes, disputes, and evidence standards exist.',
  },
  {
    title: 'AMM or dynamic pricing',
    status: 'Later',
    summary: 'Do not add liquidity curves until fixed-share settlement, claims, refunds, and accounting are fully reviewed.',
  },
];
