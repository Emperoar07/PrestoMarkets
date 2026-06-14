'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { MarketQualityPanel } from './MarketQualityPanel';
import { Countdown } from './Countdown';
import { AlertPrefsControl } from './AlertPrefsControl';
import { AddUsdcDrawer } from './AddUsdcDrawer';

// Heavy, below-the-fold pieces — lazy-load so the market page shell (title, odds, trade panel)
// paints immediately instead of waiting on the chart's history fetch and the comments list.
const MarketSignalChart = dynamic(
  () => import('./MarketSignalChart').then((m) => ({ default: m.MarketSignalChart })),
  { ssr: false, loading: () => <div className="h-[336px] rounded-[14px] bg-white/[0.02]" /> },
);
const MarketComments = dynamic(
  () => import('./MarketComments').then((m) => ({ default: m.MarketComments })),
  { ssr: false, loading: () => <div className="mt-8 h-40 rounded-[14px] bg-white/[0.02]" /> },
);
const MarketActivityTimeline = dynamic(
  () => import('./MarketActivityTimeline').then((m) => ({ default: m.MarketActivityTimeline })),
  { ssr: false, loading: () => <div className="mt-8 h-48 rounded-[14px] bg-white/[0.02]" /> },
);
import { ShareMarketButton } from './EmbedSnippetButton';
import { WatchlistButton } from './WatchlistButton';
import { readPayWith, writePayWith } from '@/lib/payWithStore';
import type { StableSymbol } from '@/lib/walletBalance';
import { formatUsd, useAppState } from '@/lib/appState';
import { useTransactions } from '@/lib/transactions';
import { agentResolutionGuardrails, buildAgentResolutionPrompt, buildAgentResolutionReport } from '@/lib/agentResolution';
import type { MarketStatus } from '@/lib/markets';
import { getOutcomeColor } from '@/lib/outcomeColors';
import { buildFixedShareQuote } from '@/lib/marketUtils';
import { buildResolutionTrustState } from '@/lib/resolutionTrust';
import { disputeLiveResolution } from '@/lib/liveActions';
import { collateralUnit } from '@/lib/arcConfig';
import { identifyAsset } from '@/lib/priceResolution';
import Link from 'next/link';
import { ChevronDown, Loader2, AlertCircle } from 'lucide-react';

const statusStyle: Record<MarketStatus, string> = {
  Open: 'border-mint/25 bg-mint/10 text-mint',
  'Closing soon': 'border-yellow-400/25 bg-yellow-400/10 text-yellow-200',
  Closed: 'border-orange-300/25 bg-orange-300/10 text-orange-200',
  Resolved: 'border-cyan/25 bg-cyan/10 text-cyan',
  Canceled: 'border-red-400/25 bg-red-400/10 text-red-200',
  Draft: 'border-line bg-ink text-muted',
};

const quickAmounts = [10, 25, 100, 500];

function splitAgentReason(reason?: string): string[] {
  if (!reason?.trim()) {
    return ['This market was created automatically by the Presto co-admin agent from public trend signals.'];
  }

  return reason
    .split(/\s+\|\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const renderEvidenceBlock = (uri?: string) => {
  if (!uri) {
    return <p className="mt-1.5 text-sm leading-6 text-muted">No evidence URI recorded.</p>;
  }

  let parsed: any = null;
  try {
    if (uri.startsWith('data:application/json,')) {
      const rawJson = decodeURIComponent(uri.replace('data:application/json,', ''));
      parsed = JSON.parse(rawJson);
    }
  } catch (e) {
    // Ignore parse errors
  }

  if (parsed) {
    return (
      <div className="mt-2 space-y-2.5 text-sm">
        {parsed.outcome && (
          <div>
            <span className="text-[10px] font-black uppercase text-muted">Resolved Outcome: </span>
            <span className="font-extrabold text-white">{parsed.outcome}</span>
          </div>
        )}
        {parsed.evidenceSummary && (
          <div>
            <span className="text-[10px] font-black uppercase text-muted block mb-1">Evidence Summary:</span>
            <p className="leading-relaxed text-[#94a3b8] text-xs bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
              {parsed.evidenceSummary}
            </p>
          </div>
        )}
        {parsed.confidence !== undefined && (
          <div>
            <span className="text-[10px] font-black uppercase text-muted">Confidence: </span>
            <span className="font-extrabold text-cyan">{Math.round(parsed.confidence * 100)}%</span>
          </div>
        )}
        <details className="group mt-2">
          <summary className="flex cursor-pointer items-center justify-between text-[10px] font-bold text-cyan select-none hover:opacity-85">
            <span>View raw data URI</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 max-h-[120px] overflow-y-auto rounded-lg bg-[#070e17] border border-white/[0.04] p-3 text-[11px] font-mono break-all text-muted leading-relaxed">
            {uri}
          </div>
        </details>
      </div>
    );
  }

  return (
    <a
      href={uri}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 block break-all text-sm font-bold leading-6 text-cyan hover:opacity-80"
    >
      {uri.startsWith('http') ? 'View Evidence Source →' : uri}
    </a>
  );
};

function formatKickoffCountdown(kickoffMs: number, nowMs: number): string {
  const diff = kickoffMs - nowMs;
  if (diff <= 0) return '0s';
  const seconds = Math.floor((diff / 1000) % 60);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
}

export function MarketDetailClient({ marketId }: { marketId: string }) {
  const { accountPreviews, connectedWallet, getMarket, isLoadingMarkets, placeTrade, addLiquidity, resolveMarket, cancelMarket, claimMarket, refundMarket } = useAppState();
  const { track } = useTransactions();
  const market = getMarket(marketId);
  const [selectedOutcome, setSelectedOutcome] = useState('YES');
  const [tradeMode, setTradeMode] = useState<'buy' | 'liquidity'>('buy');
  const [orderMode, setOrderMode] = useState<'market' | 'limit'>('market');
  const [amount, setAmount] = useState('1');
  const [limitPrice, setLimitPrice] = useState('50');
  const [resolutionURI, setResolutionURI] = useState('');
  const [agentOutcome, setAgentOutcome] = useState<string>('YES');
  const [agentConfidence, setAgentConfidence] = useState('Medium');
  const [agentSources, setAgentSources] = useState('');
  const [agentNotes, setAgentNotes] = useState('');
  const [agentOperator, setAgentOperator] = useState('');
  const [agentReport, setAgentReport] = useState('');
  const [confirmSource, setConfirmSource] = useState(false);
  const [confirmRules, setConfirmRules] = useState(false);
  const [confirmHuman, setConfirmHuman] = useState(false);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRulesSchema, setShowRulesSchema] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [payWith, setPayWith] = useState<StableSymbol>('USDC');
  // Currency unit follows the market's collateral (€ for EURC markets, $ for USDC).
  const collateralSymbol = market?.collateralSymbol ?? 'USDC';
  const unit = collateralUnit(collateralSymbol);

  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);

  // Identify if this is a crypto asset market
  const cryptoAsset = market ? identifyAsset(market) : null;

  useEffect(() => {
    if (!cryptoAsset) return;

    let active = true;
    let timer: NodeJS.Timeout | null = null;

    async function fetchPrice() {
      if (!cryptoAsset || !active) return;
      setIsFetchingPrice(true);
      try {
        const res = await fetch(`/api/crypto/price?assetId=${cryptoAsset.id}`);
        if (!res.ok) throw new Error('Failed to fetch price');
        const data = await res.json();
        if (active && typeof data.price === 'number') {
          setLivePrice(data.price);
        }
      } catch (err) {
        console.error('Failed to fetch live crypto price:', err);
      } finally {
        if (active) {
          setIsFetchingPrice(false);
        }
      }
    }

    // Initial fetch
    fetchPrice();

    // Setup polling every 15 seconds when active
    const setupInterval = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(fetchPrice, 15000);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchPrice();
        setupInterval();
      } else {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }
    };

    if (document.visibilityState === 'visible') {
      setupInterval();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timer) clearInterval(timer);
    };
  }, [cryptoAsset?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const buyParam = params.get('buy');
    if (buyParam) {
      const buyUpper = buyParam.toUpperCase();
      if (buyUpper === 'YES' || buyUpper === 'NO') {
        setSelectedOutcome(buyUpper);
      } else if (market?.outcomes) {
        const matched = market.outcomes.find(
          (o) => o.label.toUpperCase() === buyUpper
        );
        if (matched) {
          setSelectedOutcome(matched.label);
        }
      }
    }
  }, [market]);

  useEffect(() => {
    if (!connectedWallet?.address) return;
    const stored = readPayWith(connectedWallet.address, marketId);
    if (stored) setPayWith(stored);
  }, [connectedWallet?.address, marketId]);

  useEffect(() => {
    if (!market?.outcomes.length) return;
    if (!market.outcomes.some((outcome) => outcome.label === selectedOutcome)) {
      setSelectedOutcome(market.outcomes[0].label);
    }
  }, [market?.id, market?.outcomes, selectedOutcome]);

  function choosePayWith(symbol: StableSymbol) {
    setPayWith(symbol);
    writePayWith(connectedWallet?.address, marketId, symbol);
  }

  if (!market) {
    // On a cold load/refresh the onchain markets are still being fetched, so `market` is
    // momentarily undefined. Show a loading state until the fetch settles, and only then
    // fall back to "not found" — otherwise a hard refresh of a real market flashes an error.
    const stillLoading = isLoadingMarkets;
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-28 md:px-7 md:pt-28 flex flex-col justify-center items-center min-h-[65vh]">
          <div className="border border-white/[0.06] bg-[#0d1626]/20 backdrop-blur-md rounded-2xl max-w-md w-full p-8 text-center flex flex-col items-center justify-center shadow-2xl shadow-black/40">
            {stillLoading ? (
              <>
                <div className="relative flex items-center justify-center w-16 h-16 mb-4">
                  <div className="absolute inset-0 rounded-full bg-cyan/10 blur-xl animate-pulse" />
                  <Loader2 className="h-9 w-9 animate-spin text-cyan relative z-10" />
                </div>
                <h1 className="text-2xl font-black text-white tracking-tight">Loading market…</h1>
                <p className="mt-2 text-sm text-[#8fa0b4]">Fetching this market from Arc.</p>
              </>
            ) : (
              <>
                <div className="relative flex items-center justify-center w-16 h-16 mb-4">
                  <div className="absolute inset-0 rounded-full bg-amber-500/10 blur-xl" />
                  <AlertCircle className="h-9 w-9 text-amber-400 relative z-10" />
                </div>
                <h1 className="text-2xl font-black text-white tracking-tight">Market not found</h1>
                <p className="mt-2 text-sm text-[#8fa0b4]">This market was not returned by the deployed Arc factory.</p>
                <Link
                  href="/markets"
                  className="mt-6 inline-flex items-center justify-center rounded-lg bg-cyan px-4 py-2 text-xs font-black uppercase tracking-wider text-[#07111f] transition-all duration-150 hover:bg-cyan-300 active:scale-95 shadow-md shadow-cyan/5"
                >
                  Back to Explorer
                </Link>
              </>
            )}
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const yesOutcome = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const noOutcome = market.outcomes.find((o) => o.label === 'NO') ?? market.outcomes[1] ?? yesOutcome;
  const activeOutcomeIndex = Math.max(0, market.outcomes.findIndex((outcome) => outcome.label === selectedOutcome));
  const activeOutcome = market.outcomes[activeOutcomeIndex] ?? yesOutcome;
  const activeOutcomeColor = getOutcomeColor(activeOutcomeIndex);
  const isBinaryMarket = market.outcomes.length <= 2;
  const amountValue = Number(amount) || 0;
  const isLimitOrder = tradeMode === 'buy' && orderMode === 'limit';
  // Fixed-share parimutuel: 1 USDC = 1 share. Payout if this outcome wins is an estimate derived from current implied odds, not a priced-share quote.
  const fixedShareQuote = buildFixedShareQuote({
    amountUsdc: amountValue,
    oddsPercent: isLimitOrder ? Number(limitPrice) : Number(activeOutcome.odds),
  });
  const liquiditySideAmount = amountValue > 0 ? amountValue / market.outcomes.length : 0;

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const kickoffMs = market?.kickoffTime ? new Date(market.kickoffTime).getTime() : null;
  const isTradingLocked = kickoffMs !== null && now >= kickoffMs - 60_000;

  const eventIdMatch = market?.trendUrl?.match(/event\/(\d+)/);
  const idEvent = eventIdMatch ? eventIdMatch[1] : null;

  // Real team names + match date for the keyless ESPN live-score lookup (and so the scoreboard
  // shows the actual teams, not "Home Team"/"Away Team", even before a score loads). Prefer the
  // outcome labels (they're the team names for fixtures); fall back to parsing the "X vs Y" title.
  const GENERIC_OUTCOME = /^(yes|no|draw|home|away|over|under|tie)$/i;
  const teamLabels = (market?.outcomes ?? []).map((o) => o.label).filter((l) => l && !GENERIC_OUTCOME.test(l));
  let homeTeamName: string | undefined = teamLabels[0];
  let awayTeamName: string | undefined = teamLabels[teamLabels.length - 1];
  if (!homeTeamName || !awayTeamName || homeTeamName === awayTeamName) {
    const vs = market?.title?.match(/^(.+?)\s+vs\.?\s+(.+?)(?:\?|$)/i);
    if (vs) { homeTeamName = vs[1].trim(); awayTeamName = vs[2].trim(); }
  }
  const matchDateYmd = kickoffMs ? new Date(kickoffMs).toISOString().slice(0, 10).replace(/-/g, '') : null;

  const [liveData, setLiveData] = useState<{
    homeScore: string | null;
    awayScore: string | null;
    status: string | null;
    progress: string | null;
    time: string | null;
    homeTeam?: string;
    awayTeam?: string;
  } | null>(null);

  // TheSportsDB marks completed games as "Match Finished" / FT / AET / PEN — flip the live
  // badge off at full time instead of keeping it red until the market's closeTime.
  const matchFinished = /finished|full.?time|\bft\b|\baet\b|\bpen\b/i.test(`${liveData?.status ?? ''} ${liveData?.progress ?? ''}`);
  const isMatchLive = kickoffMs !== null && now >= kickoffMs && !matchFinished
    && market?.status !== 'Resolved' && market?.status !== 'Closed';

  useEffect(() => {
    const haveTeams = Boolean(homeTeamName && awayTeamName);
    if ((!idEvent && !haveTeams) || kickoffMs === null || now < kickoffMs || market?.status === 'Resolved' || market?.status === 'Closed') {
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    async function fetchLiveScore() {
      try {
        const params = new URLSearchParams();
        if (idEvent) params.set('id', idEvent);
        if (homeTeamName) params.set('home', homeTeamName);
        if (awayTeamName) params.set('away', awayTeamName);
        if (matchDateYmd) params.set('date', matchDateYmd);
        const res = await fetch(`/api/sports/live?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setLiveData(data);
            // Match over — stop polling; the final score stays on screen.
            if (/finished|full.?time|\bft\b|\baet\b|\bpen\b/i.test(`${data?.status ?? ''} ${data?.progress ?? ''}`) && interval) {
              clearInterval(interval);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch live score', e);
      }
    }

    void fetchLiveScore();
    interval = setInterval(fetchLiveScore, 30000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idEvent, homeTeamName, awayTeamName, matchDateYmd, kickoffMs, market?.status]);

  const canTrade = (market.status === 'Open' || market.status === 'Closing soon') && !isTradingLocked;
  
  const groundingUrl = [market.trendUrl, market.sourceOfTruth].find((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
  const groundingHost = (() => {
    if (!groundingUrl) return null;
    try { return new URL(groundingUrl).hostname.replace(/^www\./, ''); } catch { return null; }
  })();
  const accountPreview = new Map(Object.entries(accountPreviews)).get(market.id);

  const claimableAmount = Number(accountPreview?.claimable.replace(/[$,]/g, '') || 0);
  const refundableAmount = Number(accountPreview?.refundable.replace(/[$,]/g, '') || 0);
  const canClaim = claimableAmount > 0 && !accountPreview?.hasClaimed;
  const canRefund = refundableAmount > 0 && !accountPreview?.hasClaimed;
  const hasSettlementRecord = market.status === 'Resolved' || market.status === 'Canceled';
  const connectedAddress = connectedWallet?.address.toLowerCase();
  const resolverAddress = market.resolverAddress?.toLowerCase();
  const isResolver = Boolean(connectedAddress && resolverAddress && connectedAddress === resolverAddress);
  const resolutionTrustState = buildResolutionTrustState({
    marketStatus: market.status,
    closeTimeMs: market.closeDate ? new Date(market.closeDate).getTime() : undefined,
    proposal: market.proposal
      ? {
          outcome: market.proposal.outcomeLabel,
          proposedAtMs: market.proposal.proposedAtMs,
          evidenceURI: market.proposal.evidenceURI,
          disputedAtMs: market.proposal.disputed ? market.proposal.proposedAtMs : undefined,
          proposer: market.proposal.proposer,
        }
      : null,
  });
  // Disputes need skin in the game: a signed-in wallet holding shares in this market.
  const holdsPosition = Boolean(accountPreview?.outcomeShares?.some((share) => Number(share.shares) > 0));
  const disputeWindowEndsAt = market.proposal ? new Date(market.proposal.proposedAtMs + 2 * 60 * 60 * 1000).toISOString() : undefined;
  const isClosedForResolution = resolutionTrustState.canPropose || market.closeLabel === 'Closed';
  const canAccessResolverActions = isResolver && !hasSettlementRecord;
  const canUseResolverActions = canAccessResolverActions && isClosedForResolution;
  const resolverChecksPassed = confirmSource && confirmRules && confirmHuman;
  const canSubmitResolution = canUseResolverActions && resolverChecksPassed && Boolean(resolutionURI.trim());
  const isAgentMarket = market.createdByType === 'agent';
  const needsFundingHelp = message.toLowerCase().includes('insufficient') || message.toLowerCase().includes('add usdc');

  async function runAction(
    action: () => Promise<{ ok: boolean; message: string; txHash?: string; pending?: boolean }>,
    label: string,
  ) {
    setIsSubmitting(true);
    setMessage('Waiting for wallet confirmation...');
    try {
      const result = await track({ label }, action);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Transaction failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function prepareAgentReport() {
    if (!market) return;
    const activeMarket = market;

    if (!agentSources.trim() || !agentNotes.trim()) {
      setMessage('Add source links and agent findings before preparing a resolution report.');
      return;
    }

    const prepared = buildAgentResolutionReport({
      market: activeMarket,
      outcome: agentOutcome,
      confidence: agentConfidence,
      evidenceNotes: agentNotes,
      evidenceSources: agentSources,
      operator: agentOperator,
    });

    setAgentReport(prepared.pretty);
    setResolutionURI(prepared.dataUri);
    setMessage('Agent evidence report prepared. Review it, then confirm the resolver checks before settling.');
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-28 md:px-7 md:pt-28">
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[1fr_380px]">

          <section className="min-w-0 order-1 lg:order-none lg:col-start-1 lg:row-start-1">

            <div className="flex items-center justify-end gap-2">
              {connectedWallet ? <AlertPrefsControl marketId={market.id} /> : null}
              <WatchlistButton marketId={market.id} />
              <ShareMarketButton marketId={market.id} title={market.title} />
            </div>


            {/* Polymarket-style header: compact square market image beside the title. */}
            <div className="mt-4 flex items-start gap-4">
              {market.imageURI ? (
                <img
                  src={market.imageURI}
                  alt=""
                  width={64}
                  height={64}
                  decoding="async"
                  className="h-14 w-14 shrink-0 rounded-[12px] bg-[#0d1520] object-cover ring-1 ring-white/10 md:h-16 md:w-16"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : null}
              <h1 className="min-w-0 text-[clamp(28px,4vw,46px)] font-black leading-tight tracking-tight text-white">
                {market.title}
              </h1>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#8fa0b4]">
              <span>{market.volume} Vol.</span>
              <span className="text-white/20">·</span>
              <span>
                Closes in {market.closeDate ? <Countdown closeDate={market.closeDate} /> : market.closeLabel}
              </span>
            </div>

            {/* ── Optimistic resolution status (V2 markets) ── */}
            {resolutionTrustState.status === 'disputable' && market.proposal && disputeWindowEndsAt ? (
              <div className="mt-5 rounded-[14px] border border-amber-300/25 bg-amber-300/[0.06] p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
                  </span>
                  <span className="text-sm font-bold text-amber-100">
                    Outcome proposed: <span className="font-black text-white">{market.proposal.outcomeLabel}</span>
                  </span>
                  <span className="ml-auto text-xs font-black text-amber-200">
                    Dispute window ends in <Countdown closeDate={disputeWindowEndsAt} />
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#a8b6c9]">
                  If unchallenged, this settles automatically on the next agent pass. Anyone holding a position in this market can dispute.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={!connectedWallet || !holdsPosition || isSubmitting}
                    onClick={() => void runAction(
                      () => disputeLiveResolution(marketId, 'Community dispute via Presto market page'),
                      'Dispute resolution',
                    )}
                    className="rounded-[10px] border border-amber-300/40 bg-amber-300/15 px-4 py-2 text-xs font-black text-amber-100 transition-colors hover:bg-amber-300/25 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Dispute this outcome
                  </button>
                  <span className="text-[11px] font-bold text-[#64748b]">
                    {!connectedWallet ? 'Connect a wallet to dispute.' : !holdsPosition ? 'Only position holders in this market can dispute.' : 'You hold a position — you may dispute.'}
                  </span>
                </div>
              </div>
            ) : resolutionTrustState.status === 'ready_to_settle' && market.proposal ? (
              <div className="mt-5 flex flex-wrap items-center gap-2.5 rounded-[14px] border border-cyan/20 bg-cyan/[0.06] px-4 py-3">
                <span className="inline-block h-2 w-2 rounded-full bg-cyan" />
                <span className="text-sm font-bold text-[#cbd5e1]">
                  Proposal <span className="font-black text-white">{market.proposal.outcomeLabel}</span> survived its dispute window — settles on the next agent pass.
                </span>
              </div>
            ) : resolutionTrustState.status === 'disputed' && market.proposal ? (
              <div className="mt-5 flex flex-wrap items-center gap-2.5 rounded-[14px] border border-red-400/25 bg-red-400/[0.07] px-4 py-3">
                <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
                <span className="text-sm font-bold text-[#e2c2c2]">
                  This proposal was <span className="font-black text-red-300">disputed</span> — the resolver will settle directly with published evidence.
                </span>
              </div>
            ) : null}

            <div className="mt-6">
              <div className="flex overflow-hidden rounded-full" style={{ height: 8 }}>
                {market.outcomes.map((outcome, index) => {
                  const color = getOutcomeColor(index);
                  return (
                    <div
                      key={`bar-${outcome.label}`}
                      style={{
                        width: `${outcome.odds}%`,
                        backgroundColor: color,
                      }}
                      className="transition-all duration-500"
                    />
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                {market.outcomes.map((outcome, index) => {
                  const color = getOutcomeColor(index);
                  return (
                    <div key={`badge-${outcome.label}`} className="flex items-center gap-2">
                      <span
                        style={{
                          backgroundColor: `${color}1A`, // 10% opacity
                          color: color,
                        }}
                        className="rounded-md px-2.5 py-1 text-xs font-black"
                      >
                        {outcome.label}
                      </span>
                      <span className="text-lg font-black text-white">{outcome.odds}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {cryptoAsset && (
              <div className="mt-6 flex items-center gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-md px-5 py-4 max-w-[340px] shadow-lg shadow-black/10">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-mint"></span>
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-black uppercase tracking-wider text-[#8fa0b4]">
                    Current {cryptoAsset.symbol} Price
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black text-white leading-none">
                      {livePrice !== null
                        ? `$${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : 'Loading...'}
                    </span>
                    <span className="text-[10px] font-bold text-mint uppercase tracking-wider">USD (Live)</span>
                  </div>
                </div>
              </div>
            )}

            {(() => {
              const cleanedDescription = market.description
                ? market.description.replace(/current\s+price:\s*\$?[0-9a-z_$-]+[a-z0-9_$-]*[.,;:\s]*/gi, '').trim()
                : '';
              return cleanedDescription ? (
                <p className="mt-7 max-w-[900px] text-[16px] leading-8 text-[#94a3b8]">{cleanedDescription}</p>
              ) : null;
            })()}

            {kickoffMs !== null && (
              <div className="mt-6 border-t border-white/[0.06] pt-5">
                {isMatchLive ? (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                      </span>
                      <span className="text-xs font-black uppercase tracking-wider text-red-400">Match is Live</span>
                      {liveData?.time && (
                        <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-mono font-bold text-white/85">
                          {liveData.time}
                        </span>
                      )}
                    </div>
                    
                    <div className="mt-4 flex items-center justify-between gap-6">
                      <div className="flex flex-1 flex-col items-center text-center">
                        <span className="text-xs font-bold text-muted uppercase">Home</span>
                        <span className="mt-1.5 text-base md:text-lg font-black text-white">{liveData?.homeTeam || homeTeamName || 'Home'}</span>
                      </div>

                      <div className="flex items-center gap-4 px-4 py-1.5 bg-white/[0.04] rounded-xl border border-white/[0.05]">
                        <span className="text-3xl font-black text-white">{liveData?.homeScore ?? '0'}</span>
                        <span className="text-xl font-bold text-muted">:</span>
                        <span className="text-3xl font-black text-white">{liveData?.awayScore ?? '0'}</span>
                      </div>

                      <div className="flex flex-1 flex-col items-center text-center">
                        <span className="text-xs font-bold text-muted uppercase">Away</span>
                        <span className="mt-1.5 text-base md:text-lg font-black text-white">{liveData?.awayTeam || awayTeamName || 'Away'}</span>
                      </div>
                    </div>
                    
                    {(liveData?.status || liveData?.progress) && (
                      <div className="mt-4 text-center text-xs font-bold text-[#8fa0b4]">
                        Status: <span className="text-white">{liveData.status || liveData.progress}</span>
                      </div>
                    )}
                  </div>
                ) : matchFinished && liveData ? (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-mint"></span>
                      <span className="text-xs font-black uppercase tracking-wider text-mint">Full Time</span>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-6">
                      <div className="flex flex-1 flex-col items-center text-center">
                        <span className="text-xs font-bold text-muted uppercase">Home</span>
                        <span className="mt-1.5 text-base md:text-lg font-black text-white">{liveData.homeTeam || homeTeamName || 'Home'}</span>
                      </div>
                      <div className="flex items-center gap-4 px-4 py-1.5 bg-white/[0.04] rounded-xl border border-white/[0.05]">
                        <span className="text-3xl font-black text-white">{liveData.homeScore ?? '0'}</span>
                        <span className="text-xl font-bold text-muted">:</span>
                        <span className="text-3xl font-black text-white">{liveData.awayScore ?? '0'}</span>
                      </div>
                      <div className="flex flex-1 flex-col items-center text-center">
                        <span className="text-xs font-bold text-muted uppercase">Away</span>
                        <span className="mt-1.5 text-base md:text-lg font-black text-white">{liveData.awayTeam || awayTeamName || 'Away'}</span>
                      </div>
                    </div>
                    <p className="mt-4 text-center text-xs font-bold text-[#8fa0b4]">
                      Final result — settlement follows within about an hour.
                    </p>
                  </div>
                ) : now < kickoffMs ? (
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-cyan"></span>
                      <span className="text-xs font-black uppercase tracking-wider text-cyan">Upcoming Match</span>
                      <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                        Starts in {formatKickoffCountdown(kickoffMs, now)}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-muted">
                      Kickoff: <span className="text-white font-extrabold">{new Date(kickoffMs).toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-mint"></span>
                    <span className="text-xs font-bold text-muted">Match completed — awaiting settlement.</span>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4">
              <MarketSignalChart market={market} live />
            </div>
          </section>

          <section className="min-w-0 order-3 lg:order-none lg:col-start-1 lg:row-start-2">

            <MarketActivityTimeline marketId={marketId} />

            <div className="mt-8">
              <h2 className="text-base font-black text-white">Market activity</h2>
              <div className="mt-4 grid gap-x-10 gap-y-4 border-t border-white/[0.06] pt-4 md:grid-cols-3">
                {market.activity.map((item) => (
                  <div key={item.label}>
                    <p className="text-xs font-bold text-muted">{item.label}</p>
                    <p className="mt-1 text-xl font-black text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <MarketQualityPanel market={market} />

            {isAgentMarket && isResolver ? (
              <details className="group mt-6 rounded-[14px] border border-cyan/20 bg-cyan/[0.06]">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-cyan/[0.04] [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    {isResolver ? (
                      <p className="text-[10px] font-black uppercase tracking-widest text-cyan">Agent-created market</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="text-base font-black text-white">{market.agentName || 'Presto Market Agent'}</h2>
                    </div>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-muted transition-colors group-open:border-cyan/20 group-open:bg-cyan/10 group-open:text-cyan">
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="px-5 pb-5">
                  <div className="border-t border-white/[0.06] pt-4">
                    <div className="space-y-3 text-[15px] leading-7 text-muted">
                      {splitAgentReason(market.agentReason).map((part, index) => (
                        <p key={`${part}-${index}`}>{part}</p>
                      ))}
                    </div>
                  </div>
                  {isResolver ? (
                    <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 md:grid-cols-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted">Source</p>
                        {groundingHost ? (
                          <a href={groundingUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 block break-all text-sm text-cyan hover:opacity-80">{groundingHost} ↗</a>
                        ) : (
                          <p className="mt-1.5 text-sm text-white">Source pending</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted">Momentum</p>
                        <p className="mt-1.5 text-sm text-white">{market.momentumScore ?? 'Not scored'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted">Safety</p>
                        <p className="mt-1.5 text-sm text-white">{market.safetyScore ?? 'Not scored'}</p>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 md:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">Action receipt</p>
                    <p className="mt-1.5 break-all text-sm text-white">create-market:{market.id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">Resolver wallet</p>
                    <p className="mt-1.5 break-all text-sm text-white">{market.resolverAddress || market.resolver}</p>
                  </div>
                </div>
                  <div className="mt-4 flex flex-wrap gap-4">
                  <a href="/agent" className="inline-block text-sm font-bold text-cyan hover:opacity-80">
                    View agent profile
                  </a>
                  {isResolver ? (
                    <a href="/calibration" className="inline-block text-sm font-bold text-cyan hover:opacity-80">
                      Agent calibration →
                    </a>
                  ) : null}
                </div>
                </div>
              </details>
            ) : null}

            {hasSettlementRecord ? (
              <div className="mt-4 rounded-[14px] border border-white/[0.06] bg-[#141e30] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-cyan">Settlement record</p>
                    <h2 className="mt-1.5 text-base font-black text-white">
                      {market.status === 'Resolved'
                        ? `${market.winningOutcomeLabel ?? 'Winning outcome'} resolved`
                        : 'Market canceled'}
                    </h2>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusStyle[market.status]}`}>
                    {market.status}
                  </span>
                </div>
                <div className="mt-4 grid gap-x-10 gap-y-4 border-t border-white/[0.06] pt-4 md:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">Evidence URI</p>
                    {renderEvidenceBlock(market.resolutionURI)}
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">Your settlement</p>
                    <p className="mt-1.5 text-sm leading-6 text-white">
                      {connectedWallet
                        ? accountPreview?.hasClaimed ? 'Already claimed or refunded.'
                          : canClaim ? `${accountPreview?.claimable} claimable`
                          : canRefund ? `${accountPreview?.refundable} refundable`
                          : 'No settlement available.'
                        : 'Connect wallet to check.'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">Audit trail</p>
                    <p className="mt-1.5 text-sm leading-6 text-muted">
                      Outcome, evidence, claim and refund previews are read directly from the Arc market contract.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <MarketComments marketId={marketId} />
          </section>

          <aside id="trade-panel" className="min-w-0 h-fit scroll-mt-28 order-2 lg:order-none lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-24">
            <div className="min-w-0 overflow-hidden rounded-[18px] border border-white/[0.06] bg-[#141e30] p-4 sm:p-5">

              <div className="mb-4 grid grid-cols-2 rounded-[12px] border border-white/[0.06] bg-[#0d1520] p-1">
                  {([
                    ['market', 'Market'],
                    ['limit', 'Limit'],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setOrderMode(mode)}
                      disabled={isTradingLocked}
                      className={`rounded-[9px] py-2 text-sm font-black transition-all border ${
                        orderMode === mode
                          ? 'border-white/80 text-white bg-transparent shadow-sm'
                          : 'border-transparent text-muted hover:text-white bg-transparent'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

              {isBinaryMarket ? (
              <div className={`grid grid-cols-2 gap-2 ${tradeMode === 'liquidity' ? 'opacity-70' : ''}`}>
                <button
                  type="button"
                  onClick={() => setSelectedOutcome('YES')}
                  disabled={tradeMode === 'liquidity' || isTradingLocked}
                  className={`rounded-[12px] border py-4 text-center transition-all ${
                    selectedOutcome === 'YES'
                      ? 'border-cyan/40 bg-cyan/10 shadow-[0_0_16px_-4px_rgba(37,192,244,0.3)]'
                      : 'border-white/[0.06] bg-[#0f172a] hover:border-white/10'
                  }`}
                >
                  <p className="text-xs font-black text-muted">Buy YES</p>
                  <p className={`mt-1 text-2xl font-black ${selectedOutcome === 'YES' ? 'text-cyan' : 'text-white'}`}>
                    {yesOutcome.odds}{'\u00a2'}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedOutcome('NO')}
                  disabled={tradeMode === 'liquidity' || isTradingLocked}
                  className={`rounded-[12px] border py-4 text-center transition-all ${
                    selectedOutcome === 'NO'
                      ? 'border-red-400/40 bg-red-400/10 shadow-[0_0_16px_-4px_rgba(248,113,113,0.2)]'
                      : 'border-white/[0.06] bg-[#0f172a] hover:border-white/10'
                  }`}
                >
                  <p className="text-xs font-black text-muted">Buy NO</p>
                  <p className={`mt-1 text-2xl font-black ${selectedOutcome === 'NO' ? 'text-red-300' : 'text-white'}`}>
                    {noOutcome.odds}{'\u00a2'}
                  </p>
                </button>
              </div>

              ) : (
                <div className={`scrollbar-hide grid max-h-[244px] grid-cols-1 gap-2 overflow-y-auto pr-1 ${tradeMode === 'liquidity' ? 'opacity-70' : ''}`}>
                  {market.outcomes.map((outcome, index) => {
                    const active = selectedOutcome === outcome.label;
                    const color = getOutcomeColor(index);
                    return (
                      <button
                        key={`${outcome.label}-${index}`}
                        type="button"
                        onClick={() => setSelectedOutcome(outcome.label)}
                        disabled={tradeMode === 'liquidity' || isTradingLocked}
                        style={active ? {
                          borderColor: `${color}70`,
                          backgroundColor: `${color}18`,
                          boxShadow: `0 0 16px -4px ${color}4D`,
                        } : undefined}
                        className={`min-w-0 rounded-[12px] border px-3 py-3 text-left transition-all ${
                          active ? '' : 'border-white/[0.06] bg-[#0f172a] hover:border-white/10'
                        }`}
                      >
                        <p className="truncate text-xs font-black text-muted">Buy {outcome.label}</p>
                        <p className={`mt-1 text-2xl font-black ${active ? '' : 'text-white'}`} style={active ? { color } : undefined}>
                          {outcome.odds}{'\u00a2'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted">Amount</label>
                  <button
                    type="button"
                    onClick={() => setFundingOpen(true)}
                    disabled={isTradingLocked}
                    className="text-[10px] font-black uppercase tracking-widest text-cyan transition hover:text-cyan/80 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Available {payWith}
                  </button>
                </div>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isTradingLocked}
                  className="mt-2 w-full bg-transparent text-4xl font-black text-white outline-none placeholder:text-white/20 disabled:opacity-50"
                  placeholder="0"
                  inputMode="decimal"
                />
                <div className="mt-3 flex gap-2">
                  {quickAmounts.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setAmount(String(q))}
                      disabled={isTradingLocked}
                      className={`flex-1 rounded-[8px] border py-1.5 text-xs font-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        amount === String(q)
                          ? 'border-cyan/30 bg-cyan/10 text-cyan'
                          : 'border-white/[0.06] bg-[#0f172a] text-[#8fa0b4] hover:border-white/10 hover:text-white'
                      }`}
                    >
                      {unit}{q}
                    </button>
                  ))}
                </div>
              </div>

              {isLimitOrder ? (
                <div className="mt-4 rounded-[14px] border border-cyan/15 bg-cyan/[0.045] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted">Limit price</label>
                    <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#0d1520] px-3 py-1.5">
                      <input
                        value={limitPrice}
                        onChange={(event) => setLimitPrice(event.target.value)}
                        disabled={isTradingLocked}
                        inputMode="decimal"
                        className="w-14 bg-transparent text-right text-sm font-black text-white outline-none disabled:opacity-50"
                      />
                      <span className="text-xs font-black text-cyan">{'\u00a2'}</span>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted">
                    Limit orders are prepared for the order-book contract phase. V1 market buys still execute immediately through the live share contract.
                  </p>
                </div>
              ) : null}

              <div className="mt-5 space-y-2.5 border-t border-white/[0.06] pt-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">{tradeMode === 'liquidity' ? 'Liquidity method' : isLimitOrder ? 'Limit price' : 'Implied odds'}</span>
                  <span className="font-black text-white">
                    {tradeMode === 'liquidity'
                      ? isBinaryMarket ? 'Balanced YES + NO' : 'Balanced across all outcomes'
                      : isLimitOrder ? `${limitPrice || '0'}\u00a2 limit` : `${activeOutcome.odds}%`}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">Shares (1 USDC = 1 share)</span>
                  <span className="min-w-0 break-words text-right font-black text-white [overflow-wrap:anywhere]">
                    {tradeMode === 'liquidity'
                      ? liquiditySideAmount > 0 ? `${liquiditySideAmount.toFixed(2)} each x ${market.outcomes.length} outcomes` : '—'
                      : fixedShareQuote.shares > 0 ? fixedShareQuote.shares.toFixed(2) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">{tradeMode === 'liquidity' ? 'Position' : `Est. payout if ${activeOutcome.label} wins`}</span>
                  <span className={`min-w-0 break-words text-right font-black [overflow-wrap:anywhere] ${fixedShareQuote.estimatedPayoutUsdc > amountValue ? 'text-mint' : 'text-white'}`}>
                    {tradeMode === 'liquidity'
                      ? 'Neutral depth'
                      : fixedShareQuote.estimatedPayoutUsdc > 0 ? `${unit}${fixedShareQuote.estimatedPayoutUsdc.toFixed(2)}` : '—'}
                  </span>
                </div>
                {tradeMode === 'liquidity' ? (
                  <p className="rounded-[10px] border border-cyan/15 bg-cyan/[0.05] px-3 py-2 text-xs leading-5 text-muted">
                    The app splits your amount evenly across every outcome to start with balanced depth.
                  </p>
                ) : (
                  <p className="text-[11px] leading-4 text-[#64748b]">
                    Pool-share odds: {unit}1 = 1 share. The % is each outcome&apos;s share of the pool, not an order-book price — payout is your share of the total pool if it wins.
                  </p>
                )}
              </div>

              {/* Buy button / Lock Indicator */}
              {isTradingLocked ? (
                <div className="mt-5 rounded-[12px] border border-red-500/25 bg-red-500/10 p-4 text-center">
                  <p className="text-xs font-black uppercase tracking-wider text-red-400">
                    {now < (kickoffMs ?? 0)
                      ? `Trading closed (match begins in ${Math.max(0, Math.ceil(((kickoffMs ?? 0) - now) / 1000))}s)`
                      : 'Trading closed (match is live)'}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void runAction(() => (
                    tradeMode === 'liquidity'
                      ? addLiquidity({ marketId, amount: amountValue, payWith })
                      : placeTrade({ marketId, outcome: selectedOutcome, outcomeIndex: activeOutcomeIndex, amount: amountValue, payWith })
                  ), tradeMode === 'liquidity' ? `Add liquidity · ${unit}${amountValue}` : `Buy ${selectedOutcome} · ${unit}${amountValue}`)}
                  disabled={!canTrade || isSubmitting || amountValue <= 0 || isLimitOrder}
                  style={tradeMode === 'buy' ? { backgroundColor: activeOutcomeColor } : undefined}
                  className={`mt-5 w-full min-w-0 rounded-[12px] px-3 py-4 font-black tracking-wide text-ink transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
                    tradeMode === 'liquidity' ? 'bg-cyan' : ''
                  }`}
                >
                  {!canTrade ? 'Market not open'
                    : isSubmitting ? 'Confirming…'
                    : amountValue <= 0 ? 'Enter an amount'
                    : isLimitOrder ? 'Limit order book phase'
                    : tradeMode === 'liquidity' ? `Add liquidity · ${unit}${amountValue}`
                    : `Buy ${selectedOutcome} · ${unit}${amountValue}`}
                </button>
              )}

              {message ? (
                <div className={`mt-4 rounded-[10px] border px-3 py-2 text-xs leading-5 ${
                    message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') || message.toLowerCase().includes('insufficient') || message.toLowerCase().includes('expired')
                      ? 'border-red-400/25 bg-red-400/10 text-red-200'
                      : 'border-mint/25 bg-mint/10 text-mint'
                  }`}
                >
                  <p>{message}</p>
                  {needsFundingHelp ? (
                    <button
                      type="button"
                      onClick={() => setFundingOpen(true)}
                      className="mt-2 rounded-[8px] border border-cyan/25 bg-cyan/10 px-2.5 py-1 text-[11px] font-black text-cyan transition hover:bg-cyan/15"
                    >
                      Add USDC
                    </button>
                  ) : null}
                </div>
              ) : null}
              {(canClaim || canRefund) ? (
                <div className="mt-5 border-t border-white/[0.06] pt-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted">Settlement available</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {canClaim ? (
                      <button
                        type="button"
                        onClick={() => void runAction(() => claimMarket(marketId), 'Claim winnings')}
                        disabled={isSubmitting}
                        className="w-full rounded-[12px] bg-mint/10 py-3 text-sm font-black text-mint ring-1 ring-mint/30 transition-all hover:bg-mint/15 disabled:opacity-50"
                      >
                        Claim {accountPreview?.claimable}
                      </button>
                    ) : null}
                    {canRefund ? (
                      <button
                        type="button"
                        onClick={() => void runAction(() => refundMarket(marketId), 'Refund')}
                        disabled={isSubmitting}
                        className="w-full rounded-[12px] bg-cyan/10 py-3 text-sm font-black text-cyan ring-1 ring-cyan/30 transition-all hover:bg-cyan/15 disabled:opacity-50"
                      >
                        Refund {accountPreview?.refundable}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Resolver controls — only shown to the resolver. Non-resolvers already see
                  the resolver address in the left-column "Resolution rules" block. */}
              {canAccessResolverActions ? (
                <div className="mt-5 border-t border-white/[0.06] pt-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">Resolver</p>
                    <span className="rounded-full bg-cyan/10 px-2 py-0.5 text-[10px] font-black text-cyan ring-1 ring-cyan/20">
                      You are the resolver
                    </span>
                  </div>
                  <div className="mt-4 space-y-4">
                    <div className="rounded-[14px] border border-cyan/20 bg-cyan/[0.06] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-cyan">Evidence assisted resolution</p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            Gather evidence with a controlled agent workflow, then review and sign the final Arc transaction.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(buildAgentResolutionPrompt(market));
                              setMessage('Agent research prompt copied. Run it with your controlled Circle Agent workflow, then paste the findings here.');
                            }}
                            className="rounded-[10px] border border-cyan/25 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cyan transition-colors hover:bg-cyan/10"
                          >
                            Copy prompt
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 md:grid-cols-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-muted">
                          Proposed outcome
                           <select
                            value={agentOutcome}
                            onChange={(event) => setAgentOutcome(event.target.value)}
                            className="mt-1 w-full rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan/40"
                          >
                            {market.outcomes.map((outcome) => (
                              <option key={outcome.label} value={outcome.label}>
                                {outcome.label}
                              </option>
                            ))}
                            <option value="CANCEL">Cancel</option>
                          </select>
                        </label>
                        <label className="text-[10px] font-black uppercase tracking-widest text-muted">
                          Confidence
                          <select
                            value={agentConfidence}
                            onChange={(event) => setAgentConfidence(event.target.value)}
                            className="mt-1 w-full rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan/40"
                          >
                            <option>High</option>
                            <option>Medium</option>
                            <option>Low</option>
                          </select>
                        </label>
                        <label className="text-[10px] font-black uppercase tracking-widest text-muted">
                          Operator
                          <input
                            value={agentOperator}
                            onChange={(event) => setAgentOperator(event.target.value)}
                            placeholder="Resolver or agent name"
                            className="mt-1 w-full rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan/40 placeholder:text-[#334155]"
                          />
                        </label>
                      </div>

                      <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-muted">
                        Source links
                        <textarea
                          value={agentSources}
                          onChange={(event) => setAgentSources(event.target.value)}
                          placeholder="One primary source URL per line"
                          rows={3}
                          className="mt-1 w-full resize-none rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan/40 placeholder:text-[#334155]"
                        />
                      </label>

                      <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-muted">
                        Agent findings
                        <textarea
                          value={agentNotes}
                          onChange={(event) => setAgentNotes(event.target.value)}
                          placeholder="Paste the agent evidence summary, timestamps, and uncertainty notes."
                          rows={4}
                          className="mt-1 w-full resize-none rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2.5 text-sm text-white outline-none focus:border-cyan/40 placeholder:text-[#334155]"
                        />
                      </label>

                      <div className="mt-3 rounded-[12px] border border-white/[0.06] bg-[#0d1520] p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted">Strict instructions</p>
                        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted">
                          {agentResolutionGuardrails.map((guardrail) => (
                            <li key={guardrail}>- {guardrail}</li>
                          ))}
                        </ul>
                      </div>

                      <button
                        type="button"
                        onClick={prepareAgentReport}
                        className="mt-3 w-full rounded-[10px] bg-cyan py-2.5 text-xs font-black text-ink transition-opacity hover:opacity-90"
                      >
                        Prepare agent evidence report
                      </button>

                      {agentReport ? (
                        <details className="mt-3 rounded-[12px] border border-white/[0.06] bg-[#0d1520] p-3">
                          <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-cyan">
                            Review generated report
                          </summary>
                          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted">
                            {agentReport}
                          </pre>
                        </details>
                      ) : null}
                    </div>

                    <label className="block text-[10px] font-black uppercase tracking-widest text-muted">
                      Evidence URI
                      <input
                        value={resolutionURI}
                        onChange={(e) => setResolutionURI(e.target.value)}
                        placeholder="https://evidence.example/resolution or generated agent data URI"
                        className="mt-1 w-full rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-cyan/40 placeholder:text-[#334155]"
                      />
                    </label>

                    <div className="space-y-2 rounded-[14px] border border-white/[0.06] bg-[#0d1520] p-3">
                      {[
                        ['source', 'I verified the source of truth and primary evidence links.', confirmSource, setConfirmSource],
                        ['rules', 'The selected outcome follows the written market rules exactly.', confirmRules, setConfirmRules],
                        ['human', 'I understand the agent is advisory and the resolver is accountable for this final transaction.', confirmHuman, setConfirmHuman],
                      ].map(([key, label, checked, setter]) => (
                        <label key={key as string} className="flex items-start gap-2 text-xs leading-5 text-muted">
                          <input
                            type="checkbox"
                            checked={checked as boolean}
                            onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)}
                            className="mt-1 accent-cyan"
                          />
                          <span>{label as string}</span>
                        </label>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {market.outcomes.map((outcome, index) => {
                        const color = getOutcomeColor(index);
                        return (
                          <button
                            key={`resolve-${outcome.label}-${index}`}
                            type="button"
                            onClick={() => void runAction(() => resolveMarket({ marketId, outcome: outcome.label, outcomeIndex: index, resolutionURI }), 'Resolve market')}
                            disabled={isSubmitting || !canSubmitResolution}
                            style={{
                              backgroundColor: `${color}1A`, // 10% opacity
                              color: color,
                            }}
                            className="rounded-[10px] py-2.5 text-xs font-black ring-1 ring-white/10 transition-all hover:bg-opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Resolve {outcome.label}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => void runAction(() => cancelMarket(marketId), 'Cancel market')}
                      disabled={isSubmitting || !resolverChecksPassed || !isClosedForResolution}
                      className="w-full rounded-[10px] border border-white/[0.06] bg-[#0d1520] py-2.5 text-xs font-black text-muted transition-all hover:border-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Cancel market
                    </button>
                    {!isClosedForResolution ? (
                      <p className="text-xs leading-5 text-muted">
                        Settlement buttons stay locked until the market close time. You can prepare the agent evidence report now.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : isResolver && !isClosedForResolution ? (
                <p className="mt-5 border-t border-white/[0.06] pt-5 text-xs leading-5 text-muted">
                  Resolution unlocks after the market close time. You can prepare evidence now, but settlement must wait.
                </p>
              ) : null}
            </div>
          </aside>

        </div>
      </main>
      <AddUsdcDrawer open={fundingOpen} onClose={() => setFundingOpen(false)} wallet={connectedWallet} />
      <SiteFooter />
    </>
  );
}


