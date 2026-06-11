import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPUTE_WINDOW_MS,
  buildResolutionTrustState,
  canSettleOptimisticResolution,
} from '../resolutionTrust';

const now = new Date('2026-06-10T12:00:00.000Z').getTime();

describe('buildResolutionTrustState', () => {
  it('keeps open markets in normal trading state before close', () => {
    expect(buildResolutionTrustState({
      marketStatus: 'Open',
      closeTimeMs: now + 60_000,
      nowMs: now,
    })).toMatchObject({
      status: 'open',
      userLabel: 'Open',
      canPropose: false,
      canDispute: false,
      canSettle: false,
    });
  });

  it('asks for a proposal after close when no settlement exists', () => {
    expect(buildResolutionTrustState({
      marketStatus: 'Closed',
      closeTimeMs: now - 60_000,
      nowMs: now,
    })).toMatchObject({
      status: 'awaiting_proposal',
      userLabel: 'Awaiting resolution proposal',
      canPropose: true,
      canDispute: false,
      canSettle: false,
    });
  });

  it('marks a fresh optimistic proposal as disputable', () => {
    expect(buildResolutionTrustState({
      marketStatus: 'Closed',
      closeTimeMs: now - 60_000,
      nowMs: now,
      proposal: {
        outcome: 'YES',
        proposedAtMs: now - 30_000,
        disputeWindowMs: DEFAULT_DISPUTE_WINDOW_MS,
        evidenceURI: 'https://example.com/evidence',
      },
    })).toMatchObject({
      status: 'disputable',
      userLabel: 'Proposal in challenge window',
      canPropose: false,
      canDispute: true,
      canSettle: false,
    });
  });

  it('marks an undisputed expired proposal as ready to settle', () => {
    const state = buildResolutionTrustState({
      marketStatus: 'Closed',
      closeTimeMs: now - 60_000,
      nowMs: now,
      proposal: {
        outcome: 'NO',
        proposedAtMs: now - DEFAULT_DISPUTE_WINDOW_MS - 1,
        disputeWindowMs: DEFAULT_DISPUTE_WINDOW_MS,
        evidenceURI: 'https://example.com/evidence',
      },
    });

    expect(state.status).toBe('ready_to_settle');
    expect(state.canSettle).toBe(true);
    expect(canSettleOptimisticResolution(state)).toBe(true);
  });

  it('locks settlement when a proposal is disputed', () => {
    const state = buildResolutionTrustState({
      marketStatus: 'Closed',
      closeTimeMs: now - 60_000,
      nowMs: now,
      proposal: {
        outcome: 'NO',
        proposedAtMs: now - DEFAULT_DISPUTE_WINDOW_MS - 1,
        disputeWindowMs: DEFAULT_DISPUTE_WINDOW_MS,
        disputedAtMs: now - 10_000,
        evidenceURI: 'https://example.com/evidence',
      },
    });

    expect(state).toMatchObject({
      status: 'disputed',
      userLabel: 'Disputed',
      canPropose: false,
      canDispute: false,
      canSettle: false,
    });
    expect(canSettleOptimisticResolution(state)).toBe(false);
  });

  it('passes through terminal market states', () => {
    expect(buildResolutionTrustState({ marketStatus: 'Resolved', nowMs: now }).status).toBe('settled');
    expect(buildResolutionTrustState({ marketStatus: 'Canceled', nowMs: now }).status).toBe('canceled');
  });
});
