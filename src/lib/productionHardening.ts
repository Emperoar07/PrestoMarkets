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
    finding: 'Resolution is final once the configured resolver calls resolve, and there is no dispute, appeal, or correction path in the current contract.',
    requiredAction: 'Keep real-value markets disabled until dispute windows, resolver escalation, and cancellation fallback rules are approved.',
  },
  {
    area: 'Resolver key risk',
    severity: 'High',
    finding: 'A single resolver address controls resolution and cancellation after close. A compromised or unavailable resolver can finalize a bad outcome or leave markets stuck.',
    requiredAction: 'Define resolver custody, rotation, monitoring, and emergency operating procedures before production value.',
  },
  {
    area: 'Fixed-share economics',
    severity: 'Medium',
    finding: 'Shares are fixed 1:1 against deposited USDC and there is no sell path or AMM. UI odds are signal ratios, not executable exit prices.',
    requiredAction: 'Keep portfolio copy explicit about signal marks and settlement previews so users do not read odds as liquid mark-to-market value.',
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
    finding: 'Portfolio activity currently reads recent logs from Arc RPC and can miss older account history. Contract balances remain authoritative.',
    requiredAction: 'Add persistent indexing before relying on activity history as a complete statement view.',
  },
];

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
