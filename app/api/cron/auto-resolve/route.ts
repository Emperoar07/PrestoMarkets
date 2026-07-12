import { NextRequest, NextResponse, after } from 'next/server';
import type { Hex, Address } from 'viem';
import { fetchOnchainMarkets, readMarketListSnapshot } from '@/lib/onchainMarkets';
import { agentResolveMarket, agentCancelMarket, agentProposeResolution, agentSettleProposedResolution, agentReadTotalShares, getAgentAddress, agentProposeV3, agentSettleV3, agentPayWinners, agentReadLmsrBuyers, agentReadLmsrPaused, agentUnpauseLmsrMarket } from '@/lib/agentWallet';
import { verifyBearer } from '@/lib/authCompare';
import { callLlmJson, extractJsonObject } from '@/lib/llmFallback';
import { getAgentIdentityStatus, recordResolutionReputation } from '@/lib/agentIdentity';
import { assertNonEmptyString } from '@/lib/typeGuards';
import { createAbortSignalWithTimeout } from '@/lib/timeoutUtils';
import { tryDeterministicPriceResolution } from '@/lib/priceResolution';
import { listMarketWatchers } from '@/lib/socialDb';
import { listMarketTraders } from '@/lib/marketIndexer';
import { notifyMany } from '@/lib/notifications';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import type { AppMarket } from '@/lib/appState';

export const runtime = 'nodejs';
export const maxDuration = 300;

type ResolutionResult =
  | { ok: true; action: 'resolved'; marketId: string; title: string; outcome: string; txHash: string | Hex; confidence: number }
  | { ok: true; action: 'proposed'; marketId: string; title: string; outcome: string; txHash: string | Hex; confidence: number }
  | { ok: true; action: 'canceled'; marketId: string; title: string; outcome: string; txHash: string | Hex; confidence: number; reason: string }
  | { ok: false; action: 'skipped'; marketId: string; title: string; reason: string };

const DISPUTE_WINDOW_MS = 30 * 60 * 1000;

// V2 markets get the optimistic path: publish a proposal anyone can dispute for 2 hours, then
// settle on a later tick. V1 markets lack proposeResolution and revert, so we fall back to the
// direct resolve() — and a DISPUTED V2 proposal also lands here, where resolve() is the
// contract-sanctioned escalation path.
async function proposeOrResolve(
  marketId: string,
  outcomeIndex: number,
  resolutionURI: string,
  isAmm = false,
): Promise<{ ok: true; mode: 'proposed' | 'resolved'; txHash: string } | { ok: false; error?: string }> {
  // V3 LMSR markets use the bonded optimistic flow: propose(), then settle() on a later tick once
  // the 30-minute window closes. They have no direct resolve(), so there is no fallback here.
  if (isAmm) {
    // If this market was frozen by the early-decided pause, re-open it first — propose() is
    // whenNotPaused. Only when actually paused, so we don't waste a tx on unpaused markets.
    if (await agentReadLmsrPaused(marketId) === true) {
      await agentUnpauseLmsrMarket(marketId).catch(() => undefined);
    }
    const proposedV3 = await agentProposeV3(marketId, outcomeIndex, resolutionURI);
    if (proposedV3.ok) return { ok: true, mode: 'proposed', txHash: assertNonEmptyString(proposedV3.txHash, 'txHash') };
    return { ok: false, error: proposedV3.error };
  }
  const proposed = await agentProposeResolution(marketId, outcomeIndex, resolutionURI);
  if (proposed.ok) return { ok: true, mode: 'proposed', txHash: assertNonEmptyString(proposed.txHash, 'txHash') };
  const resolved = await agentResolveMarket(marketId, outcomeIndex, resolutionURI);
  if (resolved.ok) return { ok: true, mode: 'resolved', txHash: assertNonEmptyString(resolved.txHash, 'txHash') };
  return { ok: false, error: resolved.error ?? proposed.error };
}

// NOTE (mainnet gate): `confidence` below is self-reported by the same LLM that
// chooses the outcome, so this threshold only filters how confident the model
// *claims* to be, not how correct it is. Evidence URIs are constrained to
// declared-source domains, but the confidence scalar itself is unverified. This
// is an accepted testnet tradeoff. Before mainnet, gate settlement on an
// independent signal (multi-model agreement, oracle quorum, or a dispute window)
// rather than a single model's self-attested confidence. See DEVNOTE.md.
const MIN_AUTO_RESOLVE_CONFIDENCE = 0.75;
// A market closed longer than this that still can't be confidently resolved is canceled
// (refunded) instead of parked in "pending manual review" forever, so the agent's active-market
// cap is never permanently held by unsettleable markets. Permanently-unresolvable cases (no
// source URL, no outcomes, oracle says CANCEL) are canceled immediately without waiting.
const FORCE_CANCEL_GRACE_MS = 2 * 60 * 60 * 1000;

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

// Reputable, low-manipulation sources the agent may use to corroborate an outcome found
// anywhere on the web — not just the market's declared source-of-truth domain.
const HIGH_TRUST_DOMAINS = [
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'bloomberg.com', 'wsj.com', 'ft.com',
  'nytimes.com', 'theguardian.com', 'cnbc.com', 'axios.com', 'politico.com', 'aljazeera.com',
  'espn.com', 'theathletic.com', 'skysports.com', 'premierleague.com', 'nba.com', 'fifa.com',
  'coingecko.com', 'coinmarketcap.com', 'sec.gov', 'federalreserve.gov',
];

function isHighTrustUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (hostname.endsWith('.gov') || hostname.endsWith('.gov.uk') || hostname.endsWith('.edu')) return true;
    return HIGH_TRUST_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/** A URL the resolver will record on-chain as evidence: the declared source, or a reputable one. */
function isCredibleEvidenceUrl(url: string, declaredDomains: string[]): boolean {
  return isDeclaredSourceUrl(url, declaredDomains) || isHighTrustUrl(url);
}

function buildEvidenceQuery(market: AppMarket) {
  const cleanTitle = market.title.replace(/[?]/g, '').trim();
  // Broad web search: the agent corroborates the outcome from reputable sources anywhere,
  // not only the declared source-of-truth domain.
  return `${cleanTitle} result outcome ${market.category}`.trim();
}

async function fetchLiveEvidence(market: AppMarket): Promise<EvidenceResult> {
  const apiKey = process.env.SERPER_API_KEY;
  const query = buildEvidenceQuery(market);
  const declaredDomains = extractSourceDomains(market.sourceOfTruth);
  if (!apiKey) return { snippets: '', sources: [], unavailableReason: 'Evidence search is not configured.' };

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', num: 10 }),
      signal: createAbortSignalWithTimeout(8000), // 8 second timeout for Serper
    });
    if (!res.ok) return { snippets: '', sources: [], unavailableReason: `Evidence search returned HTTP ${res.status}.` };

    const data = await res.json() as {
      organic?: Array<{ title: string; snippet: string; link: string }>;
      topStories?: Array<{ title: string; link: string }>;
      answerBox?: { answer?: string; snippet?: string };
    };

    // Tier every result so the oracle can weigh it: PRIMARY = declared source,
    // TRUSTED = major news / official / league / exchange, WEB = everything else.
    const tierOf = (link: string) =>
      isDeclaredSourceUrl(link, declaredDomains) ? 'PRIMARY' : isHighTrustUrl(link) ? 'TRUSTED' : 'WEB';
    const sources: string[] = [];
    const lines: string[] = [];

    if (data.answerBox?.answer || data.answerBox?.snippet) {
      lines.push(`[ANSWER] ${data.answerBox.answer ?? data.answerBox.snippet}`);
    }
    for (const item of data.topStories ?? []) {
      const tier = tierOf(item.link);
      lines.push(`[${tier}] ${item.title} - ${item.link}`);
      if (tier !== 'WEB') sources.push(item.link);
    }
    for (const item of (data.organic ?? []).slice(0, 6)) {
      const tier = tierOf(item.link);
      lines.push(`[${tier}] ${item.title}: ${item.snippet} - ${item.link}`);
      if (tier !== 'WEB') sources.push(item.link);
    }

    return { snippets: lines.join('\n'), sources: Array.from(new Set(sources)) };
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

  // Cancel-and-refund a market that cannot be confidently resolved, so it always reaches a
  // terminal state and frees the agent's active-market cap.
  async function cancelUnresolvable(reason: string): Promise<ResolutionResult> {
    const cancelResult = await agentCancelMarket(market.id);
    if (!cancelResult.ok) {
      return skipResolution(`${reason} Auto-cancel failed: ${cancelResult.error ?? 'unknown error'}.`);
    }
    return {
      ok: true,
      action: 'canceled',
      marketId: market.id,
      title: market.title,
      outcome: 'CANCEL',
      txHash: assertNonEmptyString(cancelResult.txHash, 'txHash'),
      confidence: 1,
      reason: `${reason} Canceled to refund all participants.`,
    };
  }

  const closedMsAgo = market.closeDate ? Date.now() - new Date(market.closeDate).getTime() : Infinity;
  const pastCancelGrace = closedMsAgo > FORCE_CANCEL_GRACE_MS;

  // Deterministic fast-path: settle crypto price-range / conviction (price-target)
  // markets straight from the CoinGecko price — no Serper, no LLM. Falls through to
  // the evidence pipeline when the market isn't a confidently-parseable price market.
  const priceSettlement = await tryDeterministicPriceResolution(market);
  if (priceSettlement) {
    const allowedOutcomes = market.outcomes.map((outcome) => outcome.label).filter(Boolean);
    const derivedIndex = allowedOutcomes.findIndex((label) => label === priceSettlement.label);
    if (derivedIndex >= 0) {
      const winningShares = await agentReadTotalShares(market.id, derivedIndex);
      if (winningShares !== null && winningShares === BigInt(0)) {
        const cancelResult = await agentCancelMarket(market.id);
        if (!cancelResult.ok) {
          return skipResolution(`Determined outcome "${priceSettlement.label}" has no winning shares and auto-cancel failed: ${cancelResult.error ?? 'unknown error'}.`);
        }
        return {
          ok: true,
          action: 'canceled',
          marketId: market.id,
          title: market.title,
          outcome: priceSettlement.label,
          txHash: assertNonEmptyString(cancelResult.txHash, 'txHash'),
          confidence: 1,
          reason: `Determined outcome "${priceSettlement.label}" had no winning shares; canceled to refund all participants.`,
        };
      }
      const report = {
        schema: 'presto.agent-resolution.v1',
        resolvedAt: new Date().toISOString(),
        marketId: market.id,
        outcome: priceSettlement.label,
        confidence: 1,
        evidenceSummary: priceSettlement.summary,
        sources: [priceSettlement.sourceUrl],
        liveEvidenceUsed: true,
        sourceBound: true,
        oracle: 'coingecko-deterministic',
        autonomous: true,
      };
      const resolutionURI = `data:application/json,${encodeURIComponent(JSON.stringify(report))}`;
      const result = await proposeOrResolve(market.id, derivedIndex, resolutionURI, Boolean(market.amm));
      if (result.ok) {
        return {
          ok: true,
          action: result.mode,
          marketId: market.id,
          title: market.title,
          outcome: priceSettlement.label,
          txHash: result.txHash,
          confidence: 1,
        };
      }
      return skipResolution(`Deterministic resolve failed: ${result.error ?? 'Onchain resolve failed'}`);
    }
  }

  const declaredSourceUrls = extractSourceUrls(market.sourceOfTruth);
  const declaredSourceDomains = extractSourceDomains(market.sourceOfTruth);

  // The agent surfs the broader web for settlement evidence: the declared source is preferred,
  // but reputable corroborating sources (major news, official data, league/exchange) are allowed.
  // A missing/weak declared URL no longer auto-cancels — search decides.
  const { snippets: liveEvidence, sources: searchSources, unavailableReason } = await fetchLiveEvidence(market);
  const hasLiveEvidence = liveEvidence.trim().length > 0;
  if (!hasLiveEvidence) {
    const reason = unavailableReason ?? 'No live evidence found for this market yet.';
    return pastCancelGrace ? cancelUnresolvable(reason) : skipResolution(`Pending: ${reason}`);
  }

  const allowedOutcomes = market.outcomes.map((outcome) => outcome.label).filter(Boolean);
  if (allowedOutcomes.length < 2) {
    return cancelUnresolvable('Market outcomes are unavailable for resolution.');
  }
  const outcomeInstructions = JSON.stringify([...allowedOutcomes, 'CANCEL']);

  const researchPrompt = `You are an autonomous resolution oracle for a prediction market platform.

Market: "${market.title}"
Rules: "${market.rules}"
Source of truth: "${market.sourceOfTruth}"
Close date: "${market.closeDate}"
Category: "${market.category}"
Today: ${new Date().toISOString()}

Declared source of truth (preferred):
${declaredSourceUrls.join('\n') || '(none provided — rely on the most reputable sources in the results)'}

Live web search results (tags: PRIMARY = the declared source, TRUSTED = major news/official/league/exchange, WEB = other):
${liveEvidence}

Instructions:
- Base your answer ONLY on the evidence above, not on your training data.
- Prefer PRIMARY; you MAY rely on TRUSTED sources that clearly corroborate the outcome. Treat WEB-only claims with caution and never settle on them alone.
- Return CANCEL if the evidence is insufficient, ambiguous, contradictory, or only low-quality WEB sources support it.
- Confidence must reflect actual evidence quality; do not inflate it.
- If the allowed outcomes are a "By <date>" ladder, pick the EARLIEST "By <date>" option whose date is on or after when the event actually occurred (per the evidence); if it has not occurred by the latest date, choose the final "After <date>" option.
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
  const combinedSources = Array.from(new Set([...oracleSources, ...searchSources])).filter(isSafeHttpUrl);
  // Record credible evidence (declared or reputable). If the oracle only cited other safe URLs,
  // still record those rather than dropping all provenance.
  const credibleSources = combinedSources.filter((url) => isCredibleEvidenceUrl(url, declaredSourceDomains));
  const allSources = (credibleSources.length > 0 ? credibleSources : combinedSources).slice(0, 8);
  const confidence = Number(parsed.confidence);
  if (parsed.outcome === 'CANCEL' || !Number.isFinite(confidence) || confidence < MIN_AUTO_RESOLVE_CONFIDENCE) {
    const formattedConfidence = Number.isFinite(confidence) ? confidence.toFixed(2) : 'invalid';
    const reason = `Oracle did not reach a resolvable confidence threshold (confidence=${formattedConfidence}, outcome=${parsed.outcome}). ${parsed.evidenceSummary}`;
    // An explicit CANCEL verdict gets the SAME grace window as low confidence: the verdict comes
    // from an LLM reading live search results, so a poisoned/wrong snapshot must not be able to
    // void a valid market on the first tick. Only after the post-close grace period does a
    // persistent CANCEL/low-confidence verdict actually cancel (refund) the market.
    return pastCancelGrace ? cancelUnresolvable(reason) : skipResolution(`Pending: ${reason}`);
  }

  const derivedIndex = allowedOutcomes.findIndex((outcome) => outcome === parsed.outcome);
  if (derivedIndex < 0) {
    const reason = `Oracle returned an unrecognised outcome "${parsed.outcome}". Allowed: ${allowedOutcomes.join(', ')}.`;
    return pastCancelGrace ? cancelUnresolvable(reason) : skipResolution(reason);
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

  // The contract reverts (NoWinningShares) if the determined outcome has zero
  // shares, which would otherwise leave the market Active forever and lock all
  // collateral. When we are confident in an outcome that nobody backed, the fair
  // settlement is to cancel and refund every participant instead of locking funds.
  const winningShares = await agentReadTotalShares(market.id, derivedIndex);
  if (winningShares !== null && winningShares === BigInt(0)) {
    const cancelResult = await agentCancelMarket(market.id);
    if (!cancelResult.ok) {
      return skipResolution(
        `Determined outcome "${parsed.outcome}" has no winning shares and auto-cancel failed: ${cancelResult.error ?? 'unknown error'}. Pending manual review.`,
      );
    }
    return {
      ok: true,
      action: 'canceled',
      marketId: market.id,
      title: market.title,
      outcome: parsed.outcome,
      txHash: assertNonEmptyString(cancelResult.txHash, 'txHash'),
      confidence,
      reason: `Determined outcome "${parsed.outcome}" had no winning shares; canceled to refund all participants.`,
    };
  }

  const resolutionURI = `data:application/json,${encodeURIComponent(JSON.stringify(resolutionReport))}`;
  const result = await proposeOrResolve(market.id, derivedIndex, resolutionURI);
  if (!result.ok) {
    return { ok: false, action: 'skipped', marketId: market.id, title: market.title, reason: result.error ?? 'Onchain resolve failed' };
  }

  return {
    ok: true,
    action: result.mode,
    marketId: market.id,
    title: market.title,
    outcome: parsed.outcome,
    txHash: result.txHash,
    confidence,
  };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured; cron endpoints are disabled until this env var is set.' }, { status: 500 });
  }

  const auth = req.headers.get('authorization');
  if (!verifyBearer(auth, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const agentAddress = getAgentAddress();
    if (!agentAddress) {
      return NextResponse.json({ ok: false, error: 'AGENT_PRIVATE_KEY not set' }, { status: 500 });
    }

    // Snapshot-first, stale-tolerant market list. The resolver only needs the CANDIDATE set from
    // the list (closed agent markets); every actual propose/settle re-reads that one market's
    // on-chain state with small targeted calls that fit through throttled public RPCs. The old
    // unconditional full chain read 500'd the entire cron under RPC saturation — which is why V3
    // markets sat Closed with no proposal and payWinners never produced a receipt.
    let allMarkets;
    const snapshot = await readMarketListSnapshot();
    if (snapshot && snapshot.markets.length > 0 && snapshot.ageMs < 30 * 60 * 1000) {
      allMarkets = snapshot.markets;
    } else {
      try {
        allMarkets = await fetchOnchainMarkets();
      } catch (chainError) {
        if (snapshot && snapshot.markets.length > 0) {
          allMarkets = snapshot.markets;
        } else {
          throw chainError;
        }
      }
    }
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

    // Time-boxed: the ERC-8004 identity read hangs for minutes under RPC saturation, and it is
    // only used to attach reputation attestations — a null skips those, never the settlements.
    const identityStatus = await Promise.race([
      getAgentIdentityStatus().catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    const agentErc8004Id = identityStatus?.agentId ? BigInt(identityStatus.agentId) : null;
    const results: ResolutionResult[] = [];

    // Wall-clock budget: each market costs evidence search + LLM + on-chain writes (slow under RPC
    // throttling). Runs used to blow past Vercel's kill with the report lost — stop early, return
    // partial progress, and let the 15-minute cadence walk the backlog. 150s leaves room for one
    // long final iteration (~2 min worst case) inside the workflow's 290s curl ceiling.
    const resolveStart = Date.now();
    const RESOLVE_BUDGET_MS = 150_000;

    for (const market of expired) {
      if (Date.now() - resolveStart > RESOLVE_BUDGET_MS) break;
      try {
        // Pending optimistic proposal: wait out the dispute window, then settle. A DISPUTED
        // proposal falls through to resolveMarket, where direct resolve() is the escalation.
        let result: ResolutionResult;
        const proposal = market.proposal;
        if (proposal && !proposal.disputed) {
          const windowEndsAt = proposal.proposedAtMs + DISPUTE_WINDOW_MS;
          if (Date.now() < windowEndsAt) {
            result = {
              ok: false,
              action: 'skipped',
              marketId: market.id,
              title: market.title,
              reason: `Proposal "${proposal.outcomeLabel}" pending — dispute window ends ${new Date(windowEndsAt).toISOString()}.`,
            };
          } else if (market.amm) {
            // V3 LMSR: settle the unchallenged proposal, then push winner payouts (best-effort;
            // claim() remains the fallback for anyone a batch misses).
            const settled = await agentSettleV3(market.id);
            if (settled.ok) {
              const buyers = await agentReadLmsrBuyers(market.id);
              const paid = await agentPayWinners(market.id, buyers);
              if (!paid.ok) console.warn('[auto-resolve] V3 payWinners failed (winners can still claim):', paid.error);
              result = { ok: true, action: 'resolved', marketId: market.id, title: market.title, outcome: proposal.outcomeLabel, txHash: assertNonEmptyString(settled.txHash, 'txHash'), confidence: 1 };
            } else {
              result = { ok: false, action: 'skipped', marketId: market.id, title: market.title, reason: `V3 settle failed: ${settled.error ?? 'unknown error'}` };
            }
          } else {
            const settled = await agentSettleProposedResolution(market.id);
            result = settled.ok
              ? { ok: true, action: 'resolved', marketId: market.id, title: market.title, outcome: proposal.outcomeLabel, txHash: assertNonEmptyString(settled.txHash, 'txHash'), confidence: 1 }
              : { ok: false, action: 'skipped', marketId: market.id, title: market.title, reason: `Proposal settlement failed: ${settled.error ?? 'unknown error'}` };
          }
        } else {
          result = await resolveMarket(market);
        }
        results.push(result);

        // Side effects run AFTER the response: trader lookups are on-chain log scans and the
        // reputation attestation is an on-chain write — awaited in-loop they pushed runs past the
        // workflow's curl timeout (the red auto-resolve emails). None of them affect settlement.
        if (result.ok && (result.action === 'resolved' || result.action === 'canceled' || result.action === 'proposed')) {
          const action = result.action;
          const sideEffectResult = result;
          after(async () => {
            try {
              const watchers = await listMarketWatchers(market.id);
              const traders = await listMarketTraders(market.id as Address);
              const recipients = Array.from(new Set([...watchers, ...traders]));

              if (recipients.length > 0) {
                await notifyMany(recipients, () => ({
                  type: action === 'resolved' ? 'market_resolved' : action === 'canceled' ? 'market_canceled' : 'system',
                  title: action === 'resolved' ? `Market resolved: ${market.title}`
                    : action === 'canceled' ? `Market canceled & refunded: ${market.title}`
                    : `Outcome proposed: ${market.title}`,
                  body: action === 'resolved' ? `Outcome: ${sideEffectResult.outcome}. Claim your winnings if you held the winning side.`
                    : action === 'canceled' ? 'All participants can claim a refund.'
                    : `Proposed outcome: ${sideEffectResult.outcome}. Anyone can dispute on the market page for about 2 hours before it settles.`,
                  marketId: market.id,
                }));
              }
            } catch (err) {
              console.error('Failed to notify auto-resolve action:', err);
            }

            // Fan out to partner webhooks (best-effort, fully isolated from resolution).
            await dispatchWebhookEvent({
              type: action === 'resolved' ? 'market_resolved' : action === 'canceled' ? 'market_canceled' : 'resolution_proposed',
              marketId: market.id,
              title: market.title,
              outcome: sideEffectResult.outcome,
              txHash: typeof sideEffectResult.txHash === 'string' ? sideEffectResult.txHash : undefined,
              at: new Date().toISOString(),
            }).catch(() => undefined);

            if (agentErc8004Id && sideEffectResult.action === 'resolved') {
              const score = sideEffectResult.confidence >= 0.95 ? 95 : sideEffectResult.confidence >= 0.85 ? 85 : 75;
              await recordResolutionReputation(
                agentErc8004Id,
                score,
                'successful_resolution',
                sideEffectResult.txHash,
              ).catch(() => null);
            }
          });
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
      proposed: results.filter((result) => result.ok && result.action === 'proposed').length,
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
