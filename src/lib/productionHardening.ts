export type HardeningStatus = 'Current' | 'Required' | 'Later';

export type HardeningItem = {
  title: string;
  status: HardeningStatus;
  summary: string;
};

export type AuditFinding = {
  area: string;
  severity: 'High' | 'Medium' | 'Low';
  finding: string;
  requiredAction: string;
};

export const contractAuditFindings: AuditFinding[] = [
  {
    area: 'Settlement finality',
    severity: 'High',
    finding: 'Resolution becomes final when the configured resolver signs the result.',
    requiredAction: 'Document dispute windows, resolver escalation, and cancellation fallback rules for higher-value markets.',
  },
  {
    area: 'Resolver key risk',
    severity: 'High',
    finding: 'Resolver authority needs clear custody, monitoring, and escalation practices.',
    requiredAction: 'Define resolver custody, rotation, monitoring, and emergency operating procedures.',
  },
  {
    area: 'Fixed-share economics',
    severity: 'Medium',
    finding: 'Shares are fixed 1:1 against deposited USDC. UI odds are signal ratios for the current market state.',
    requiredAction: 'Keep portfolio copy clear about signal marks, share counts, and settlement previews.',
  },
  {
    area: 'Metadata integrity',
    severity: 'Medium',
    finding: 'Market rules, source of truth, image, and evidence are URI/string based. Ambiguous or broken metadata can undermine settlement trust.',
    requiredAction: 'Require creation-time validation, durable metadata storage, and evidence standards before higher-trust markets.',
  },
  {
    area: 'Indexing dependence',
    severity: 'Low',
    finding: 'Cost basis is now incrementally indexed in browser storage with a per-account, per-market checkpoint. Contract balances remain authoritative.',
    requiredAction: 'Add server-side persistent indexing of activity events for a richer cross-device history.',
  },
];

export const auditReadiness: HardeningItem[] = [
  {
    title: 'Fixed-share accounting review',
    status: 'Required',
    summary: 'Confirm buy, claim, refund, rounding, fee, and resolved-collateral math for higher-value markets.',
  },
  {
    title: 'Resolver authority review',
    status: 'Required',
    summary: 'Verify resolver-only settlement, cancellation timing, evidence URI handling, and operational key controls.',
  },
  {
    title: 'Factory owner review',
    status: 'Required',
    summary: 'Review fee recipient updates, fee caps, ownership transfer, and deployment custody.',
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
    summary: 'Design a dispute window, challenger flow, and final override rule for higher-trust markets.',
  },
  {
    title: 'Bad market metadata',
    status: 'Required',
    summary: 'Set rules for invalid questions, ambiguous sources of truth, broken metadata URIs, and duplicate markets.',
  },
  {
    title: 'Indexing gaps',
    status: 'Current',
    summary: 'Cost basis is incrementally cached per browser while server-side indexing is prepared for richer history.',
  },
];

export const laterHardening: HardeningItem[] = [
  {
    title: 'Bonded disputes',
    status: 'Later',
    summary: 'Add resolver and challenger bonds after griefing, refund, timeout, and appeal economics are designed.',
  },
  {
    title: 'Agent-assisted resolution',
    status: 'Current',
    summary: 'Use agent output to prepare evidence reports while the configured resolver wallet signs final settlement.',
  },
  {
    title: 'AMM or dynamic pricing',
    status: 'Later',
    summary: 'Add liquidity curves after fixed-share settlement, claims, refunds, and accounting are reviewed.',
  },
];
