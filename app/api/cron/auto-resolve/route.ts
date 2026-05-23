import { NextRequest, NextResponse } from 'next/server';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { agentCancelMarket, agentResolveMarket, getAgentAddress } from '@/lib/agentWallet';
import { callLlmJson, extractJsonObject } from '@/lib/llmFallback';
import { getAgentIdentityStatus, recordResolutionReputation } from '@/lib/agentIdentity';
import type { AppMarket } from '@/lib/appState';

export const runtime = 'nodejs';
export const maxDuration = 300;

type ResolutionResult =
  | { ok: true; action: 'resolved'; marketId: string; title: string; outcome: string; txHash: string; confidence: number }
  | { ok: true; action: 'canceled'; marketId: string; title: string; txHash: string; reason: string }
  | { ok: false; action: 'skipped'; marketId: string; title: string; reason: string };

const MIN_AUTO_RESOLVE_CONFIDENCE = 0.85;

function extractSourceUrls(sourceOfTruth: string): string[] {
  return Array.from(sourceOfTruth.matchAll(/https?:\/\/[^\s,)]+/gi))
    .map((match) => match[0].replace(/[.,;]+$/, ''))
    .filter((url, index, list) => list.indexOf(url) === index)
    .slice(0, 4);
}

function extractSourceDomains(sourceOfTruth: string): string[] {
  const domains = extractSourceUrls(sourceOfTruth).flatMap((url) => {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return hostname ? [hostname] : [];
    } catch {
      return [];
    }
  });

  return Array.from(new Set(domains));
}

function buildEvidenceQuery(market: AppMarket) {
  const domains = extractSourceDomains(market.sourceOfTruth);
  if (domains.length === 0) return null;

  return [
    market.title,
    'result outcome',
    domains.map((domain) => `site:${domain}`).join(' OR '),
  ].join(' ');
}

async function fetchLiveEvidence(market: AppMarket): Promise<{ snippets: string; sources: string[] }> {
  const apiKey = process.env.SERPER_API_KEY;
  const query = buildEvidenceQuery(market);
  if (!apiKey || !query) return { snippets: '', sources: [] };

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', num: 6 }),
    });
    if (!res.ok) return { snippets: '', sources: [] };

    const data = await res.json() as {
      organic?: Array<{ title: string; snippet: string; link: string }>;
      topStories?: Array<{ title: string; link: string }>;
    };

    const sources: string[] = [];
    const lines: string[] = [];

    for (const item of data.topStories ?? []) {
      lines.push(`[NEWS] ${item.title} - ${item.link}`);
      sources.push(item.link);
    }

    for (const item of (data.organic ?? []).slice(0, 4)) {
      lines.push(`[WEB] ${item.title}: ${item.snippet} - ${item.link}`);
      sources.push(item.link);
    }

    return { snippets: lines.join('\n'), sources };
  } catch {
    return { snippets: '', sources: [] };
  }
}

async function resolveMarket(market: AppMarket): Promise<ResolutionResult> {
  async function cancelWithReason(reason: string): Promise<ResolutionResult> {
    const result = await agentCancelMarket(market.id);
    if (!result.ok) {
      return {
        ok: false,
        action: 'skipped',
        marketId: market.id,
        title: market.title,
        reason: `${reason} Cancellation failed: ${result.error ?? 'unknown error'}`,
      };
    }

    return {
      ok: true,
      action: 'canceled',
      marketId: market.id,
      title: market.title,
      txHash: result.txHash as string,
      reason,
    };
  }

  const declaredSourceUrls = extractSourceUrls(market.sourceOfTruth);
  if (declaredSourceUrls.length === 0) {
    return cancelWithReason('Auto-canceled: sourceOfTruth has no concrete URL to verify.');
  }

  const { snippets: liveEvidence, sources: searchSources } = await fetchLiveEvidence(market);
  const hasLiveEvidence = liveEvidence.length > 0 && searchSources.length > 0;
  if (!hasLiveEvidence) {
    return cancelWithReason('Auto-canceled: no live evidence found on declared source-of-truth domains.');
  }

  const researchPrompt = `You are an autonomous resolution oracle for a prediction market platform.

Market: "${market.title}"
Rules: "${market.rules}"
Source of truth: "${market.sourceOfTruth}"
Close date: "${market.closeDate}"
Category: "${market.category}"
Today: ${new Date().toISOString()}

Declared source URLs:
${declaredSourceUrls.join('\n')}

Live search results from declared source domains:
${liveEvidence}

Instructions:
- Base your answer ONLY on the evidence above, not on your training data.
- Treat the declared source URLs and domains as the only allowed source of truth.
- Return CANCEL if the evidence is insufficient, ambiguous, or contradicts itself.
- Confidence must reflect actual evidence quality; do not inflate it.
- This resolution will be submitted onchain and is irreversible.

Return JSON only:
{
  "outcome": "YES" | "NO" | "CANCEL",
  "outcomeIndex": 0 | 1 | 2,
  "confidence": 0.0-1.0,
  "evidenceSummary": "one paragraph citing specific sources",
  "sources": ["url1", "url2"]
}`;

  const llmResult = await callLlmJson({ task: 'reasoning', prompt: researchPrompt, maxTokens: 512 });
  const parsed = extractJsonObject(llmResult.text) as {
    outcome: string;
    outcomeIndex: number;
    confidence: number;
    evidenceSummary: string;
    sources: string[];
  };

  // Only embed http/https URLs into the onchain resolution report. Serper results and the
  // oracle's `sources[]` array are attacker-influenceable (an attacker controlling a domain that
  // surfaces in Serper can plant javascript:/data:text/html URIs that future UIs might render).
  const isSafeHttpUrl = (url: string): boolean => {
    try {
      const { protocol } = new URL(url);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  };
  const allSources = Array.from(new Set([...(parsed.sources ?? []), ...searchSources]))
    .filter(isSafeHttpUrl)
    .slice(0, 8);
  if (parsed.outcome === 'CANCEL' || parsed.confidence < MIN_AUTO_RESOLVE_CONFIDENCE) {
    return cancelWithReason(`Auto-canceled by oracle (confidence=${parsed.confidence.toFixed(2)}, outcome=${parsed.outcome}): ${parsed.evidenceSummary}`);
  }

  // Derive outcomeIndex from the canonical outcome string instead of trusting the LLM's
  // numeric field. A sloppy JSON like { outcome: "YES", outcomeIndex: 1 } would otherwise
  // resolve the market to NO irreversibly.
  let derivedIndex: 0 | 1;
  if (parsed.outcome === 'YES') derivedIndex = 0;
  else if (parsed.outcome === 'NO') derivedIndex = 1;
  else {
    return {
      ok: false,
      action: 'skipped',
      marketId: market.id,
      title: market.title,
      reason: `Oracle returned an unrecognised outcome string "${parsed.outcome}".`,
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
    liveEvidenceUsed: true,
    sourceBound: true,
    oracle: 'claude-sonnet-4-6',
    autonomous: true,
  };

  const resolutionURI = `data:application/json,${encodeURIComponent(JSON.stringify(resolutionReport))}`;
  const result = await agentResolveMarket(market.id, derivedIndex, resolutionURI);
  if (!result.ok) {
    return { ok: false, action: 'skipped', marketId: market.id, title: market.title, reason: result.error ?? 'Onchain resolve failed' };
  }

  return {
    ok: true,
    action: 'resolved',
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
    return NextResponse.json({ error: 'CRON_SECRET is not configured; cron endpoints are disabled until this env var is set.' }, { status: 500 });
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
    const expired = allMarkets.filter((market) => {
      if (market.status === 'Resolved' || market.status === 'Canceled') return false;
      if (!market.closeDate) return false;
      if (new Date(market.closeDate).getTime() > now) return false;
      return market.resolverAddress?.toLowerCase() === agentAddress.toLowerCase();
    });

    if (expired.length === 0) {
      return NextResponse.json({ ok: true, ran: new Date().toISOString(), resolved: 0, canceled: 0, results: [] });
    }

    const identityStatus = await getAgentIdentityStatus().catch(() => null);
    const agentErc8004Id = identityStatus?.agentId ? BigInt(identityStatus.agentId) : null;
    const results: ResolutionResult[] = [];

    for (const market of expired) {
      try {
        const result = await resolveMarket(market);
        results.push(result);

        if (agentErc8004Id && result.ok && result.action === 'resolved') {
          const score = result.confidence >= 0.95 ? 95 : result.confidence >= 0.85 ? 85 : 75;
          await recordResolutionReputation(
            agentErc8004Id,
            score,
            'successful_resolution',
            result.txHash,
          ).catch(() => null);
        }
      } catch (error) {
        results.push({
          ok: false,
          action: 'skipped',
          marketId: market.id,
          title: market.title,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      ran: new Date().toISOString(),
      agentAddress,
      expired: expired.length,
      resolved: results.filter((result) => result.ok && result.action === 'resolved').length,
      canceled: results.filter((result) => result.ok && result.action === 'canceled').length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Auto-resolve failed' },
      { status: 500 },
    );
  }
}
