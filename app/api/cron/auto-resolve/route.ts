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
import { getAgentIdentityStatus, recordResolutionReputation } from '@/lib/agentIdentity';
import type { AppMarket } from '@/lib/appState';

export const runtime = 'nodejs';
export const maxDuration = 300;

type ResolutionResult =
  | { ok: true; marketId: string; title: string; outcome: string; txHash: string; confidence: number }
  | { ok: false; marketId: string; title: string; reason: string };

// Fetch real evidence from Serper before asking Claude — prevents hallucination
async function fetchLiveEvidence(market: AppMarket): Promise<{ snippets: string; sources: string[] }> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return { snippets: '', sources: [] };

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${market.title} result outcome`, gl: 'us', num: 6 }),
    });
    if (!res.ok) return { snippets: '', sources: [] };

    const data = await res.json() as {
      organic?: Array<{ title: string; snippet: string; link: string }>;
      topStories?: Array<{ title: string; link: string }>;
    };

    const sources: string[] = [];
    const lines: string[] = [];

    for (const s of data.topStories ?? []) {
      lines.push(`[NEWS] ${s.title} — ${s.link}`);
      sources.push(s.link);
    }
    for (const s of (data.organic ?? []).slice(0, 4)) {
      lines.push(`[WEB] ${s.title}: ${s.snippet} — ${s.link}`);
      sources.push(s.link);
    }

    return { snippets: lines.join('\n'), sources };
  } catch {
    return { snippets: '', sources: [] };
  }
}

// Minimum confidence required to submit a resolution onchain autonomously
const MIN_AUTO_RESOLVE_CONFIDENCE = 0.85;

async function resolveMarket(market: AppMarket): Promise<ResolutionResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Step 1: Fetch live evidence before asking Claude — grounds the oracle in real data
  const { snippets: liveEvidence, sources: searchSources } = await fetchLiveEvidence(market);
  const hasLiveEvidence = liveEvidence.length > 0;

  const evidenceBlock = hasLiveEvidence
    ? `Live search results (fetched now — use these as your primary evidence):\n${liveEvidence}`
    : `WARNING: No live search results available. You have NO external evidence. You MUST return CANCEL unless the outcome is logically certain from the rules alone.`;

  const researchPrompt = `You are an autonomous resolution oracle for a prediction market platform.

Market: "${market.title}"
Rules: "${market.rules}"
Source of truth: "${market.sourceOfTruth}"
Close date: "${market.closeDate}"
Category: "${market.category}"
Today: ${new Date().toISOString()}

${evidenceBlock}

Instructions:
- Base your answer ONLY on the evidence above, not on your training data.
- Return CANCEL if the evidence is insufficient, ambiguous, or contradicts itself.
- Confidence must reflect actual evidence quality — do not inflate it.
- This resolution will be submitted onchain and is irreversible.

Return JSON only:
{
  "outcome": "YES" | "NO" | "CANCEL",
  "outcomeIndex": 0 | 1 | 2,
  "confidence": 0.0–1.0,
  "evidenceSummary": "one paragraph citing specific sources",
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

  // Merge search sources into claude's reported sources
  const allSources = Array.from(new Set([...(parsed.sources ?? []), ...searchSources])).slice(0, 8);

  if (parsed.outcome === 'CANCEL' || parsed.confidence < MIN_AUTO_RESOLVE_CONFIDENCE) {
    return {
      ok: false,
      marketId: market.id,
      title: market.title,
      reason: `Oracle skipped (confidence=${parsed.confidence.toFixed(2)}, outcome=${parsed.outcome}, liveEvidence=${hasLiveEvidence}): ${parsed.evidenceSummary}`,
    };
  }

  const resolutionReport = {
    schema: 'presto.agent-resolution.v1',
    resolvedAt: new Date().toISOString(),
    marketId: market.id,
    outcome: parsed.outcome,
    confidence: parsed.confidence,
    evidenceSummary: parsed.evidenceSummary,
    sources: allSources,
    liveEvidenceUsed: hasLiveEvidence,
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
    confidence: parsed.confidence,
  };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured — cron endpoints are disabled until this env var is set.' }, { status: 500 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Fetch agent ERC-8004 ID for reputation recording (non-blocking)
    const identityStatus = await getAgentIdentityStatus().catch(() => null);
    const agentErc8004Id = identityStatus?.agentId ? BigInt(identityStatus.agentId) : null;

    const results: ResolutionResult[] = [];
    for (const market of expired) {
      try {
        const result = await resolveMarket(market);
        results.push(result);

        // Record reputation onchain if agent is registered and VALIDATOR_PRIVATE_KEY is set
        if (agentErc8004Id && result.ok) {
          const score = result.confidence >= 0.95 ? 95 : result.confidence >= 0.85 ? 85 : 75;
          await recordResolutionReputation(
            agentErc8004Id,
            score,
            'successful_resolution',
            result.txHash,
          ).catch(() => null); // never block the cron on reputation
        }
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
