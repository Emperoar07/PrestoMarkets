import { describe, expect, it, vi } from 'vitest';

vi.mock('../onchainMarkets', () => ({
  fetchOnchainMarkets: vi.fn().mockRejectedValue(new Error('Arc RPC unavailable')),
}));

describe('agent pipeline chain-state safety', () => {
  it('fails closed when existing onchain markets cannot be read', async () => {
    const { runAgentPipeline } = await import('../agentPipeline');

    const results = await runAgentPipeline({
      trends: [{
        topic: 'Will the test market pass?',
        query: 'test market',
        source: 'test',
        url: 'https://example.com/test',
      }],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ok: false,
      topic: '(pipeline)',
      stage: 'chain-state',
    });
    expect(results[0].ok ? '' : results[0].reason).toMatch(/Arc RPC unavailable/);
  }, 20_000); // heavy module import + pipeline run; generous timeout so it doesn't flake under CI load
});
