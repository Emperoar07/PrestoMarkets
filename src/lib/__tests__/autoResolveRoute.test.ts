/**
 * V3 (LMSR) markets settled through the LLM evidence path must be proposed with
 * agentProposeV3 — the V2 proposeResolution/resolve functions do not exist on the LMSR
 * contract, so routing a V3 market down that path reverts at gas estimation and the
 * market is skipped forever (the "closed but never resolved" backlog).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
  NextRequest: class {},
  // Side effects (notifications/webhooks/reputation) are irrelevant here — drop them.
  after: () => undefined,
}));

vi.mock('@/lib/onchainMarkets', () => ({
  readMarketListSnapshot: vi.fn(),
  fetchOnchainMarkets: vi.fn(),
}));

vi.mock('@/lib/agentWallet', () => ({
  agentResolveMarket: vi.fn().mockResolvedValue({ ok: true, txHash: '0xv2resolve' }),
  agentCancelMarket: vi.fn().mockResolvedValue({ ok: true, txHash: '0xcancel' }),
  agentProposeResolution: vi.fn().mockResolvedValue({ ok: true, txHash: '0xv2propose' }),
  agentSettleProposedResolution: vi.fn().mockResolvedValue({ ok: true, txHash: '0xv2settle' }),
  agentReadTotalShares: vi.fn().mockResolvedValue(BigInt(5_000_000)),
  getAgentAddress: vi.fn().mockReturnValue('0x3f95dFD691D6772fBfdfFcf08A82210AA0996ED2'),
  agentProposeV3: vi.fn().mockResolvedValue({ ok: true, txHash: '0xv3propose' }),
  agentSettleV3: vi.fn().mockResolvedValue({ ok: true, txHash: '0xv3settle' }),
  agentPayWinners: vi.fn().mockResolvedValue({ ok: true }),
  agentReadLmsrBuyers: vi.fn().mockResolvedValue([]),
  agentReadLmsrPaused: vi.fn().mockResolvedValue(false),
  agentUnpauseLmsrMarket: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/authCompare', () => ({ verifyBearer: vi.fn().mockReturnValue(true) }));
vi.mock('@/lib/llmFallback', () => ({
  callLlmJson: vi.fn().mockResolvedValue({
    text: JSON.stringify({
      outcome: 'Yes',
      confidence: 0.95,
      evidenceSummary: 'Confirmed by declared source.',
      sources: ['https://www.bbc.com/sport/result'],
    }),
    provider: 'test',
    model: 'test',
  }),
  extractJsonObject: (text: string) => JSON.parse(text),
}));
vi.mock('@/lib/agentIdentity', () => ({
  getAgentIdentityStatus: vi.fn().mockResolvedValue(null),
  recordResolutionReputation: vi.fn(),
}));
vi.mock('@/lib/priceResolution', () => ({ tryDeterministicPriceResolution: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/socialDb', () => ({ listMarketWatchers: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/marketIndexer', () => ({ listMarketTraders: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/notifications', () => ({ notifyMany: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined) }));

import { GET } from '../../../app/api/cron/auto-resolve/route';
import { readMarketListSnapshot } from '@/lib/onchainMarkets';
import { agentProposeV3, agentProposeResolution, agentResolveMarket } from '@/lib/agentWallet';

function v3Market(overrides: Record<string, unknown> = {}) {
  return {
    id: '0xb427c7d1e1914b5f5e381e85cddb284ba7f217cf',
    title: 'Who will win France vs Spain?',
    category: 'Sports',
    rules: 'Settles by the official full-time result.',
    sourceOfTruth: 'https://www.fifa.com/',
    closeDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    status: 'Closed',
    resolutionMode: 'Agent assisted',
    resolverAddress: '0x3f95dFD691D6772fBfdfFcf08A82210AA0996ED2',
    amm: true,
    proposal: null,
    outcomes: [{ label: 'Yes' }, { label: 'No' }],
    ...overrides,
  };
}

describe('auto-resolve route: V3 markets use the V3 propose path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    process.env.SERPER_API_KEY = 'test-serper';
    vi.mocked(readMarketListSnapshot).mockResolvedValue({
      markets: [v3Market()],
      ageMs: 1000,
      updatedAt: new Date().toISOString(),
    } as never);
    // Serper evidence fetch inside the route
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic: [
          { title: 'Result', snippet: 'France won.', link: 'https://www.fifa.com/match/123' },
        ],
      }),
    }));
  });

  it('proposes an LLM-path V3 settlement via agentProposeV3, never the V2 functions', async () => {
    const req = { headers: { get: () => 'Bearer test-secret' } };
    const res = await GET(req as never);
    const body = await res.json() as { results: Array<{ action: string; reason?: string }> };

    expect(vi.mocked(agentProposeV3)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(agentProposeResolution)).not.toHaveBeenCalled();
    expect(vi.mocked(agentResolveMarket)).not.toHaveBeenCalled();
    expect(body.results[0]?.action).toBe('proposed');
  });
});
