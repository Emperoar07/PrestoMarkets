import { describe, expect, it } from 'vitest';
import { runAgentGraph } from '../agentGraph';
import { stageExecute } from '../agentStages';

describe('agent pipeline safety fallbacks', () => {
  it('refuses an empty graph run without inventing a transaction hash', async () => {
    const state = await runAgentGraph({ graphId: `test-empty-${Date.now()}` });

    expect(state.decision).toBe('reject');
    expect(state.verified).toBe(false);
    expect(state.txHash).toBeUndefined();
    expect(state.decisionReason).toMatch(/No trends available/);
  });

  it('does not allow standalone staged execution to return a fake tx hash', async () => {
    await expect(stageExecute({
      trendSource: 'test',
      authorization: {
        passed: true,
        reason: 'test',
        safetyScore: 100,
        timestamp: new Date().toISOString(),
      },
      plan: {
        title: 'Will the test pass?',
        description: 'Test market',
        rules: 'YES if the test passes.',
        sourceOfTruth: 'https://example.com',
        closeDate: '2026-06-30',
        type: 'Prediction',
        timestamp: new Date().toISOString(),
      },
    })).rejects.toThrow(/Standalone staged execution is disabled/);
  });
});
