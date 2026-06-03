import { describe, expect, it } from 'vitest';
import { computeAgentCalibration, parseConfidence } from '../marketCalibration';

const binary = (label: 'YES' | 'NO') => ({ outcomes: [{ label: 'YES' }, { label: 'NO' }], winningOutcomeLabel: label });

describe('parseConfidence', () => {
  it('parses percent, decimal, and bare-number forms to 0..1', () => {
    expect(parseConfidence('72%')).toBeCloseTo(0.72);
    expect(parseConfidence('0.72')).toBeCloseTo(0.72);
    expect(parseConfidence('72')).toBeCloseTo(0.72);
    expect(parseConfidence('1')).toBe(1);
    expect(parseConfidence(undefined)).toBeNull();
    expect(parseConfidence('n/a')).toBeNull();
  });
});

describe('computeAgentCalibration', () => {
  it('counts statuses and the winning-outcome split', () => {
    const cal = computeAgentCalibration([
      { status: 'Resolved', agentConfidence: '80%', ...binary('YES') },
      { status: 'Canceled' },
      { status: 'Open' },
    ]);
    expect(cal.totalMarkets).toBe(3);
    expect(cal.resolved).toBe(1);
    expect(cal.canceled).toBe(1);
    expect(cal.open).toBe(1);
    expect(cal.outcomeSplit).toEqual([{ label: 'YES', count: 1 }]);
    expect(cal.resolutionRate).toBeCloseTo(0.5); // 1 resolved of 2 terminal
  });

  it('scores Brier and accuracy on resolved binary markets only', () => {
    const cal = computeAgentCalibration([
      { status: 'Resolved', agentConfidence: '90%', ...binary('YES') }, // confident + correct
      { status: 'Resolved', agentConfidence: '20%', ...binary('NO') }, // low conf + NO happened (correct call)
      { status: 'Resolved', agentConfidence: '80%', ...binary('NO') }, // confident YES but NO won (wrong)
      { status: 'Open', agentConfidence: '50%', ...binary('YES') }, // excluded (not resolved)
    ]);
    expect(cal.scored).toBe(3);
    // accuracy: market1 (p>=.5,YES) ✓, market2 (p<.5,NO) ✓, market3 (p>=.5,NO) ✗ => 2/3
    expect(cal.accuracy).toBeCloseTo(2 / 3);
    // brier = ((.9-1)^2 + (.2-0)^2 + (.8-0)^2)/3
    expect(cal.brier).toBeCloseTo((0.01 + 0.04 + 0.64) / 3);
  });

  it('returns null metrics when nothing is scorable', () => {
    const cal = computeAgentCalibration([{ status: 'Open' }, { status: 'Canceled' }]);
    expect(cal.brier).toBeNull();
    expect(cal.accuracy).toBeNull();
    expect(cal.buckets).toEqual([]);
  });
});
