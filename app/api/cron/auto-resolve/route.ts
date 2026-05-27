import { NextRequest, NextResponse } from 'next/server';
import type { Hex } from 'viem';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { agentResolveMarket, getAgentAddress } from '@/lib/agentWallet';
import { callLlmJson, extractJsonObject } from '@/lib/llmFallback';
import { getAgentIdentityStatus, recordResolutionReputation } from '@/lib/agentIdentity';
import { assertNonEmptyString } from '@/lib/typeGuards';
import { createAbortSignalWithTimeout } from '@/lib/timeoutUtils';
import type { AppMarket } from '@/lib/appState';

export const runtime = 'nodejs';
export const maxDuration = 300;

type ResolutionResult =
  | { ok: true; action: 'resolved'; marketId: string; title: string; outcome: string; txHash: string | Hex; confidence: number }
  | { ok: false; action: 'skipped'; marketId: string; title: string; reason: string };

const MIN_AUTO_RESOLVE_CONFIDENCE = 0.85;

type EvidenceResult = {
  snippets: string;
  sources: string[];
  unavailableReason?: string;
};

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

function isDeclaredSourceUrl(url: string, domains: string[]): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return domains.includes(hostname);
  } catch {
    return false;
  }
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

async function fetchLiveEvidence(market: AppMarket): Promise<EvidenceResult> {
  const apiKey = process.env.SERPER_API_KEY;
  const query = buildEvidenceQuery(market);
  const declaredDomains = extractSourceDomains(market.sourceOfTruth);
  if (!apiKey) return { snippets: '', sources: [], unavailableReason: 'Evidence search is not configured.' };
  if (!query) return { snippets: '', sources: [], unavailableReason: 'No searchable source-of-truth domain was available.' };

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', num: 6 }),
      signal: createAbortSignalWithTimeout(8000), // 8 second timeout for Serper
    });
    if (!res.ok) return { snippets: '', sources: [], unavailableReason: `Evidence search returned HTTP ${res.status}.` };

    const data = await res.json() as {
      organic?: Array<{ title: string; snippet: string; link: string }>;
      topStories?: Array<{ title: string; link: string }>;
    };

    const sources: string[] = [];
    const lines: string[] = [];

    for (const item of data.topStories ?? []) {
      if (!isDeclaredSourceUrl(item.link, declaredDomains)) continue;
      lines.push(`[NEWS] ${item.title} - ${item.link}`);
      sources.push(item.link);
    }

    for (const item of (data.organic ?? []).slice(0, 4)) {
      if (!isDeclaredSourceUrl(item.link, declaredDomains)) continue;
      lines.push(`[WEB] ${item.title}: ${item.snippet} - ${item.link}`);
      sources.push(item.link);
    }

    return { snippets: lines.join('\n'), sources };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[auto-resolve] Serper search timed out after 8s');
    }
    return { snippets: '', sources: [], unavailableReason: 'Evidence search was unavailable or timed out.' };
  }
}

async function resolveMarket(market: AppMarket): Promise<ResolutionResult> {
  function skipResolution(reason: string): ResolutionResult {
    return {
      ok: false,
      action: 'skipped',
      marketId: market.id,
      title: market.title,
      reason,
    };
  }

  const declaredSourceUrls = extractSourceUrls(market.sourceOfTruth);
  if (declaredSourceUrls.length === 0) {
    return skipResolution('Pending manual review: sourceOfTruth has no concrete URL to verify.');
  }
  const declaredSourceDomains = extractSourceDomains(market.sourceOfTruth);

  const { snippets: liveEvidence, sources: searchSources, unavailableReason } = await fetchLiveEvidence(market);
  const hasLiveEvidence = liveEvidence.length > 0 && searchSources.length > 0;
  if (!hasLiveEvidence) {
    return skipResolution(`Pending manual review: ${unavailableReason ?? 'No live evidence found on declared source-of-truth domains.'}`);
  }

  const allowedOutcomes = market.outcomes.map((outcome) => outcome.label).filter(Boolean);
  if (allowedOutcomes.length < 2) {
    return skipResolution('Pending manual review: market outcomes are unavailable for resolution.');
  }
  const outcomeInstructions = JSON.stringify([...allowedOutcomes, 'CANCEL']);

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
- Return one outcome label exactly as written in the allowed outcome list below.
- This resolution will be submitted onchain and is irreversible.

Allowed outcomes: ${outcomeInstructions}

Return JSON only:
{
  "outcome": ${outcomeInstructions},
  "confidence": 0.0-1.0,
  "evidenceSummary": "one paragraph citing specific sources",
  "sources": ["url1", "url2"]
}`;

  const llmResult = await callLlmJson({ task: 'reasoning', prompt: researchPrompt, maxTokens: 512 });
  const parsed = extractJsonObject(llmResult.text) as {
    outcome: string;
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
  const oracleSources = Array.isArray(parsed.sources)
    ? parsed.sources.filter((source): source is string => typeof source === 'string')
    : [];
  const allSources = Array.from(new Set([...oracleSources, ...searchSources]))
    .filter((url) => isSafeHttpUrl(url) && isDeclaredSourceUrl(url, declaredSourceDomains))
    .slice(0, 8);
  const confidence = Number(parsed.confidence);
  if (parsed.outcome === 'CANCEL' || !Number.isFinite(confidence) || confidence < MIN_AUTO_RESOLVE_CONFIDENCE) {
    const formattedConfidence = Number.isFinite(confidence) ? confidence.toFixed(2) : 'invalid';
    return skipResolution(`Pending manual review: oracle did not reach a resolvable confidence threshold (confidence=${formattedConfidence}, outcome=${parsed.outcome}). ${parsed.evidenceSummary}`);
  }

  const derivedIndex = allowedOutcomes.findIndex((outcome) => outcome === parsed.outcome);
  if (derivedIndex < 0) {
    return {
      ok: false,
      action: 'skipped',
      marketId: market.id,
      title: market.title,
      reason: `Oracle returned an unrecognised outcome string "${parsed.outcome}". Allowed outcomes: ${allowedOutcomes.join(', ')}.`,
    };
  }

  const resolutionReport = {
    schema: 'presto.agent-resolution.v1',
    resolvedAt: new Date().toISOString(),
    marketId: market.id,
    outcome: parsed.outcome,
    confidence,
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

  const txHash = assertNonEmptyString(result.txHash, 'txHash');
  return {
    ok: true,
    action: 'resolved',
    marketId: market.id,
    title: market.title,
    outcome: parsed.outcome,
    txHash,
    confidence,
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
      return market.resolutionMode === 'Agent assisted'
        && market.resolverAddress?.toLowerCase() === agentAddress.toLowerCase();
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
      canceled: 0,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Auto-resolve failed' },
      { status: 500 },
    );
  }
}
