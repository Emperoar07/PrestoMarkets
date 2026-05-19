/**
 * Vercel Cron: autonomous market resolver — runs every hour.
 * Finds expired agent-created markets, calls Claude Sonnet resolution oracle,
 * then submits resolution onchain via the agent wallet.
 *
 * Only resolves markets where resolverAddress === AGENT_PRIVATE_KEY-derived address.
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { agentResolveMarket, getAgentAddress } from '@/lib/agentWallet';
import type { AppMarket } from '@/lib/appState';

export const runtime = 'nodejs';
export const maxDuration = 300;

type ResolutionResult =
  | { ok: true; marketId: string; title: string; outcome: string; txHash: string }
  | { ok: false; marketId: string; title: string; reason: string };

async function resolveMarket(market: AppMarket): Promise<ResolutionResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Research the outcome using Claude Sonnet
  const researchPrompt = `You are an autonomous resolution oracle for a prediction market platform.

Market: "${market.title}"
Rules: "${market.rules}"
Source of truth: "${market.sourceOfTruth}"
Close date: "${market.closeDate}"
Category: "${market.category}"

Today is ${new Date().toISOString()}.

Your task:
1. Based on the market rules and source of truth, determine the most likely outcome.
2. Return YES (outcome index 0) or NO (outcome index 1) or CANCEL (if truly unresolvable).
3. Be conservative — prefer CANCEL over a guess.
4. Your resolution is final and will be submitted onchain.

Return JSON only:
{
  "outcome": "YES" | "NO" | "CANCEL",
  "outcomeIndex": 0 | 1 | 2,
  "confidence": 0.0–1.0,
  "evidenceSummary": "one paragraph describing the evidence",
  "sources": ["url1", "url2"]
}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: researchPrompt }],
  });

  const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in oracle response');

  const parsed = JSON.parse(jsonMatch[0]) as {
    outcome: string;
    outcomeIndex: number;
    confidence: number;
    evidenceSummary: string;
    sources: string[];
  };

  if (parsed.outcome === 'CANCEL' || parsed.confidence < 0.75) {
    return {
      ok: false,
      marketId: market.id,
      title: market.title,
      reason: `Oracle confidence too low (${parsed.confidence}) or outcome CANCEL: ${parsed.evidenceSummary}`,
    };
  }

  const resolutionReport = {
    schema: 'presto.agent-resolution.v1',
    resolvedAt: new Date().toISOString(),
    marketId: market.id,
    outcome: parsed.outcome,
    confidence: parsed.confidence,
    evidenceSummary: parsed.evidenceSummary,
    sources: parsed.sources ?? [],
    oracle: 'claude-sonnet-4-6',
    autonomous: true,
  };

  const resolutionURI = `data:application/json,${encodeURIComponent(JSON.stringify(resolutionReport))}`;
  const result = await agentResolveMarket(market.id, parsed.outcomeIndex, resolutionURI);

  if (!result.ok) {
    return { ok: false, marketId: market.id, title: market.title, reason: result.error ?? 'Onchain resolve failed' };
  }

  return {
    ok: true,
    marketId: market.id,
    title: market.title,
    outcome: parsed.outcome,
    txHash: result.txHash as string,
  };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const agentAddress = getAgentAddress();
    if (!agentAddress) {
      return NextResponse.json({ ok: false, error: 'AGENT_PRIVATE_KEY not set' }, { status: 500 });
    }

    const allMarkets = await fetchOnchainMarkets();
    const now = Date.now();

    // Only resolve markets that:
    // 1. Are still open (not already resolved/canceled)
    // 2. Have passed their close date
    // 3. Have the agent as resolver
    const expired = allMarkets.filter((m) => {
      if (m.status === 'Resolved' || m.status === 'Canceled') return false;
      if (!m.closeDate) return false;
      if (new Date(m.closeDate).getTime() > now) return false;
      // Only auto-resolve markets where agent is the designated resolver
      const resolver = m.resolverAddress?.toLowerCase() ?? '';
      return resolver === agentAddress.toLowerCase();
    });

    if (expired.length === 0) {
      return NextResponse.json({ ok: true, ran: new Date().toISOString(), resolved: 0, results: [] });
    }

    const results: ResolutionResult[] = [];
    for (const market of expired) {
      try {
        const result = await resolveMarket(market);
        results.push(result);
      } catch (e) {
        results.push({
          ok: false,
          marketId: market.id,
          title: market.title,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const resolved = results.filter((r) => r.ok).length;

    return NextResponse.json({
      ok: true,
      ran: new Date().toISOString(),
      agentAddress,
      expired: expired.length,
      resolved,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Auto-resolve failed' },
      { status: 500 },
    );
  }
}
