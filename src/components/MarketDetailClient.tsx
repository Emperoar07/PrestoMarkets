'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { MarketQualityPanel } from './MarketQualityPanel';
import { Countdown } from './Countdown';
import { AlertPrefsControl } from './AlertPrefsControl';

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
import { ShareMarketButton } from './EmbedSnippetButton';
import { readPayWith, writePayWith } from '@/lib/payWithStore';
import type { StableSymbol } from '@/lib/walletBalance';
import { formatUsd, useAppState } from '@/lib/appState';
import { useTransactions } from '@/lib/transactions';
import { agentResolutionGuardrails, buildAgentResolutionPrompt, buildAgentResolutionReport } from '@/lib/agentResolution';
import type { MarketStatus } from '@/lib/markets';
import { getOutcomeColor } from '@/lib/outcomeColors';
import { estimateParimutuelPayout } from '@/lib/marketUtils';
import { ChevronDown } from 'lucide-react';

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
  const [payWith, setPayWith] = useState<StableSymbol>('USDC');
  const isCircleWallet = connectedWallet?.mode === 'circle-user-controlled';
  const unit = '$';

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
        <main className="mx-auto max-w-[1100px] px-4 pb-16 pt-28 md:px-7 md:pt-28">
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-8 text-center">
            {stillLoading ? (
              <>
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-cyan" aria-hidden />
                <h1 className="text-3xl font-black text-white">Loading market…</h1>
                <p className="mt-3 text-muted">Fetching this market from Arc.</p>
              </>
            ) : (
              <>
                <h1 className="text-3xl font-black text-white">Market not found</h1>
                <p className="mt-3 text-muted">This market was not returned by the deployed Arc factory.</p>
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
  // Fixed-share parimutuel: 1 USDC = 1 share. Payout if this outcome wins is an
  // estimate derived from current implied odds, not a priced-share quote.
  const estimatedShares = amountValue > 0 ? amountValue : 0;
  const potentialReturn = isLimitOrder
    ? estimateParimutuelPayout(amountValue, Number(limitPrice))
    : estimateParimutuelPayout(amountValue, Number(activeOutcome.odds));
  const liquiditySideAmount = amountValue > 0 ? amountValue / market.outcomes.length : 0;
  const canTrade = market.status === 'Open' || market.status === 'Closing soon';
  // Real grounded-source state for agent markets (replaces the old "Source is private" copy
  // now that markets are Exa/news-grounded). Prefer the trend URL, fall back to a public
  // source-of-truth URL; show the host as a link, or "Source pending" when none is available.
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
  const isClosedForResolution = market.status === 'Closed' || market.closeLabel === 'Closed';
  const canAccessResolverActions = isResolver && !hasSettlementRecord;
  const canUseResolverActions = canAccessResolverActions && isClosedForResolution;
  const resolverChecksPassed = confirmSource && confirmRules && confirmHuman;
  const canSubmitResolution = canUseResolverActions && resolverChecksPassed && Boolean(resolutionURI.trim());
  const isAgentMarket = market.createdByType === 'agent';

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

          {/* ── Left column, top: header + chart ── */}
          <section className="min-w-0 order-1 lg:order-none lg:col-start-1 lg:row-start-1">

            {/* Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-cyan">
                {market.type}
              </span>
              <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${statusStyle[market.status]}`}>
                {market.status}
              </span>
              {(market.categories?.length ? market.categories : [market.category]).map((cat) => (
                <span
                  key={cat}
                  className="rounded-full border border-white/[0.06] bg-white/[0.04] px-3 py-1 text-[11px] font-black text-[#8fa0b4]"
                >
                  {cat}
                </span>
              ))}
              {isAgentMarket ? (
                <span className="rounded-full border border-cyan/35 bg-cyan/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-cyan">
                  Agent
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-2 shrink-0">
                {connectedWallet ? <AlertPrefsControl marketId={market.id} /> : null}
                <ShareMarketButton marketId={market.id} title={market.title} />
              </div>
            </div>

            {/* Title */}
            <h1 className="mt-4 text-[clamp(28px,4vw,46px)] font-black leading-tight tracking-tight text-white">
              {market.title}
            </h1>

            {/* Meta strip */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#8fa0b4]">
              <span>{market.volume} Vol.</span>
              <span className="text-white/20">·</span>
              <span>
                Closes in {market.closeDate ? <Countdown closeDate={market.closeDate} /> : market.closeLabel}
              </span>
            </div>

            {/* Odds bar */}
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

            {/* Description */}
            {market.description ? (
              <p className="mt-7 max-w-[900px] text-[16px] leading-8 text-[#94a3b8]">{market.description}</p>
            ) : null}

            {/* Market image */}
            {market.imageURI ? (
              <div className="mt-6 overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#0d1520]">
                <img src={market.imageURI} alt={market.title} width={800} height={280} loading="lazy" decoding="async" className="mx-auto max-h-[280px] w-full object-contain" onError={(e) => { e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22800%22 height=%22280%22%3E%3Crect fill=%22%23141e30%22 width=%22800%22 height=%22280%22/%3E%3C/svg%3E'; }} />
              </div>
            ) : null}

            {/* Signal chart */}
            <div className="mt-4">
              <MarketSignalChart market={market} live />
            </div>
          </section>

          {/* ── Left column, bottom: activity + details (below the trade panel on mobile) ── */}
          <section className="min-w-0 order-3 lg:order-none lg:col-start-1 lg:row-start-2">

            {/* Market activity */}
            <div>
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

            {/* Market quality + Resolution rules merged into one tabbed panel */}
            <MarketQualityPanel market={market} />

            {isAgentMarket ? (
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

            {/* Settlement record */}
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

            {/* Alerts + comments — in the left column so they match the chart's width */}
            <MarketComments marketId={marketId} />
          </section>

          {/* ── Right aside — trade panel ── */}
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
                  disabled={tradeMode === 'liquidity'}
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
                  disabled={tradeMode === 'liquidity'}
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
                        disabled={tradeMode === 'liquidity'}
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

              {/* Amount input */}
              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted">Amount</label>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted">{payWith}</span>
                </div>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-2 w-full bg-transparent text-4xl font-black text-white outline-none placeholder:text-white/20"
                  placeholder="0"
                  inputMode="decimal"
                />
                {/* Quick amounts */}
                <div className="mt-3 flex gap-2">
                  {quickAmounts.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setAmount(String(q))}
                      className={`flex-1 rounded-[8px] border py-1.5 text-xs font-black transition-colors ${
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
                        inputMode="decimal"
                        className="w-14 bg-transparent text-right text-sm font-black text-white outline-none"
                      />
                      <span className="text-xs font-black text-cyan">{'\u00a2'}</span>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted">
                    Limit orders are prepared for the order-book contract phase. V1 market buys still execute immediately through the live share contract.
                  </p>
                </div>
              ) : null}

              {/* Trade summary */}
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
                      : estimatedShares > 0 ? estimatedShares.toFixed(2) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">{tradeMode === 'liquidity' ? 'Position' : `Est. payout if ${activeOutcome.label} wins`}</span>
                  <span className={`min-w-0 break-words text-right font-black [overflow-wrap:anywhere] ${potentialReturn > amountValue ? 'text-mint' : 'text-white'}`}>
                    {tradeMode === 'liquidity'
                      ? 'Neutral depth'
                      : potentialReturn > 0 ? `${unit}${potentialReturn.toFixed(2)}` : '—'}
                  </span>
                </div>
                {tradeMode === 'liquidity' ? (
                  <p className="rounded-[10px] border border-cyan/15 bg-cyan/[0.05] px-3 py-2 text-xs leading-5 text-muted">
                    The app splits your amount evenly across every outcome to start with balanced depth.
                  </p>
                ) : null}
              </div>

              {/* Status message (shown above buy button so users see errors before retrying) */}
              {message ? (
                <p className={`mt-4 rounded-[10px] border px-3 py-2 text-xs leading-5 ${
                  message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') || message.toLowerCase().includes('insufficient') || message.toLowerCase().includes('expired')
                    ? 'border-red-400/25 bg-red-400/10 text-red-200'
                    : 'border-mint/25 bg-mint/10 text-mint'
                }`}>
                  {message}
                </p>
              ) : null}

              {/* Buy button */}
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



              {/* Claim / Refund — user-facing settlement */}
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
      <SiteFooter />
    </>
  );
}


