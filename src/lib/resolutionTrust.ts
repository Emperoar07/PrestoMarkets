import type { MarketStatus } from './markets';

export const DEFAULT_DISPUTE_WINDOW_MS = 2 * 60 * 60 * 1000;

export type ResolutionProposal = {
  outcome: string;
  proposedAtMs: number;
  evidenceURI?: string;
  disputeWindowMs?: number;
  disputedAtMs?: number;
  proposer?: string;
  disputer?: string;
};

export type ResolutionTrustStatus =
  | 'open'
  | 'awaiting_proposal'
  | 'disputable'
  | 'ready_to_settle'
  | 'disputed'
  | 'settled'
  | 'canceled';

export type ResolutionTrustState = {
  status: ResolutionTrustStatus;
  userLabel: string;
  canPropose: boolean;
  canDispute: boolean;
  canSettle: boolean;
  proposedOutcome?: string;
  evidenceURI?: string;
  challengeEndsAtMs?: number;
};

export function buildResolutionTrustState(input: {
  marketStatus: MarketStatus;
  closeTimeMs?: number;
  nowMs?: number;
  proposal?: ResolutionProposal | null;
}): ResolutionTrustState {
  const nowMs = input.nowMs ?? Date.now();

  if (input.marketStatus === 'Resolved') {
    return terminalState('settled', 'Resolved');
  }

  if (input.marketStatus === 'Canceled') {
    return terminalState('canceled', 'Canceled');
  }

  const closeTimeMs = input.closeTimeMs ?? Number.POSITIVE_INFINITY;
  const isClosed = input.marketStatus === 'Closed' || closeTimeMs <= nowMs;

  if (!isClosed) {
    return {
      status: 'open',
      userLabel: 'Open',
      canPropose: false,
      canDispute: false,
      canSettle: false,
    };
  }

  const proposal = input.proposal;
  if (!proposal) {
    return {
      status: 'awaiting_proposal',
      userLabel: 'Awaiting resolution proposal',
      canPropose: true,
      canDispute: false,
      canSettle: false,
    };
  }

  const disputeWindowMs = proposal.disputeWindowMs ?? DEFAULT_DISPUTE_WINDOW_MS;
  const challengeEndsAtMs = proposal.proposedAtMs + disputeWindowMs;

  if (proposal.disputedAtMs) {
    return {
      status: 'disputed',
      userLabel: 'Disputed',
      canPropose: false,
      canDispute: false,
      canSettle: false,
      proposedOutcome: proposal.outcome,
      evidenceURI: proposal.evidenceURI,
      challengeEndsAtMs,
    };
  }

  const canSettle = nowMs >= challengeEndsAtMs;
  return {
    status: canSettle ? 'ready_to_settle' : 'disputable',
    userLabel: canSettle ? 'Ready to settle' : 'Proposal in challenge window',
    canPropose: false,
    canDispute: !canSettle,
    canSettle,
    proposedOutcome: proposal.outcome,
    evidenceURI: proposal.evidenceURI,
    challengeEndsAtMs,
  };
}

export function canSettleOptimisticResolution(state: ResolutionTrustState): boolean {
  return state.status === 'ready_to_settle' && state.canSettle;
}

function terminalState(status: 'settled' | 'canceled', userLabel: string): ResolutionTrustState {
  return {
    status,
    userLabel,
    canPropose: false,
    canDispute: false,
    canSettle: false,
  };
}
