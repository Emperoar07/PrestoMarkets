'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { SiteHeader } from './SiteHeader';
import { ArcReadinessPanel } from './ArcReadinessPanel';
import { currentRails, plannedRails } from '@/lib/productRails';
import { marketTemplates } from '@/lib/marketTemplates';
import type { MarketTemplate } from '@/lib/marketTemplates';
import type { MarketStatus, MarketType } from '@/lib/markets';
import { useAppState } from '@/lib/appState';

const marketTypes: MarketType[] = ['Prediction', 'Opinion', 'Opportunity'];

const typeCopy: Record<MarketType, string> = {
  Prediction: 'Objective future outcomes with clear sources of truth.',
  Opinion: 'Community conviction and product or governance sentiment.',
  Opportunity: 'Public signals for where builders and capital should focus.',
};

function toDatetimeLocalValue(daysAhead: number) {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CreateMarketBuilder() {
  const router = useRouter();
  const { createMarket } = useAppState();
  const [selectedType, setSelectedType] = useState<MarketType>('Prediction');
  const [selectedTemplateId, setSelectedTemplateId] = useState('macro-release');
  const [title, setTitle] = useState('Will the next US CPI print come in above consensus?');
  const [description, setDescription] = useState('A public forecast market for the next macro release with clear rules and a named source of truth.');
  const [rules, setRules] = useState(marketTemplates[0].rules);
  const [sourceOfTruth, setSourceOfTruth] = useState(marketTemplates[0].sourceOfTruth);
  const [closeDate, setCloseDate] = useState(toDatetimeLocalValue(10));
  const [seedLiquidity, setSeedLiquidity] = useState(marketTemplates[0].seedLiquidity);
  const [resolver, setResolver] = useState(marketTemplates[0].resolver);
  const [showReview, setShowReview] = useState(false);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>('Open');

  const visibleTemplates = marketTemplates.filter((template) => template.type === selectedType);
  const activeTemplate: MarketTemplate = visibleTemplates.find((template) => template.id === selectedTemplateId) ?? visibleTemplates[0];

  function applyTemplate(template: MarketTemplate) {
    setSelectedTemplateId(template.id);
    setTitle(template.question);
    setDescription(`${template.title} market for ${template.category.toLowerCase()} signals on Arc.`);
    setRules(template.rules);
    setSourceOfTruth(template.sourceOfTruth);
    setResolver(template.resolver);
    setSeedLiquidity(template.seedLiquidity);
    setShowReview(false);
  }

  function chooseType(type: MarketType) {
    setSelectedType(type);
    const nextTemplate = marketTemplates.find((template) => template.type === type) ?? marketTemplates[0];
    applyTemplate(nextTemplate);
  }

  function launchMarket(status: MarketStatus) {
    const marketId = createMarket({
      type: selectedType,
      title,
      description,
      category: activeTemplate.category,
      closeDate: new Date(closeDate).toISOString(),
      rules,
      sourceOfTruth,
      resolver,
      resolutionMode: activeTemplate.resolutionMode,
      seedLiquidity: Number(seedLiquidity) || 0,
      status,
    });

    router.push(`/markets/${marketId}`);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-12">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-cyan">Create</p>
        <h1 className="mt-3 text-4xl font-black text-white">Launch a public market</h1>
        <p className="mt-3 max-w-3xl text-muted">
          The app phase now supports a full local review flow. You can choose a template, customize the market, review the rules, and launch it back into the shared market explorer and portfolio.
        </p>

        <div className="mt-9 grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-5">
            <section className="rounded-3xl border border-line bg-panel p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Market family</p>
              <div className="mt-4 grid gap-3">
                {marketTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => chooseType(type)}
                    className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                      selectedType === type ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-line bg-ink text-white hover:border-cyan/30'
                    }`}
                  >
                    <span className="block font-black">{type}</span>
                    <span className="mt-1 block text-sm leading-6 text-muted">{typeCopy[type]}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-line bg-panel p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Templates</p>
              <div className="mt-4 grid gap-3">
                {visibleTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                      activeTemplate.id === template.id ? 'border-cyan/50 bg-cyan/10' : 'border-line bg-ink hover:border-cyan/30'
                    }`}
                  >
                    <span>
                      <span className="block font-black text-white">{template.title}</span>
                      <span className="text-sm text-muted">{template.category}</span>
                    </span>
                    {activeTemplate.id === template.id ? <CheckCircle2 className="h-5 w-5 text-cyan" /> : null}
                  </button>
                ))}
              </div>
            </section>

            <ArcReadinessPanel />
          </aside>

          <div className="space-y-6">
            <form className="rounded-3xl border border-line bg-panel">
              <div className="border-b border-line p-6">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan">{activeTemplate.category}</p>
                    <h2 className="mt-2 text-2xl font-black text-white">{activeTemplate.title}</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{activeTemplate.closeHint}</p>
                  </div>
                  <span className="w-fit rounded-full border border-line bg-ink px-3 py-1 text-xs font-black text-muted">
                    {activeTemplate.resolutionMode}
                  </span>
                </div>
              </div>

              <div className="space-y-6 p-6">
                <div>
                  <label className="text-sm font-bold text-muted">Market title</label>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Description</label>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="mt-2 min-h-28 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Resolution rules</label>
                  <textarea
                    value={rules}
                    onChange={(event) => setRules(event.target.value)}
                    className="mt-2 min-h-32 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Source of truth</label>
                  <textarea
                    value={sourceOfTruth}
                    onChange={(event) => setSourceOfTruth(event.target.value)}
                    className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="text-sm font-bold text-muted">Close date</label>
                    <input
                      type="datetime-local"
                      value={closeDate}
                      onChange={(event) => setCloseDate(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted">Seed liquidity USDC</label>
                    <input
                      value={seedLiquidity}
                      onChange={(event) => setSeedLiquidity(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted">Resolver</label>
                    <input
                      value={resolver}
                      onChange={(event) => setResolver(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-ink p-5">
                  <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Funding rails</p>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    V1 creation uses USDC and Presto market contracts. Paymaster, Wallets, Bridge Kit, CCTP, and Gateway stay planned until their flows are wired and tested.
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Current</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {currentRails.map((rail) => (
                          <span key={rail.name} className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-black text-mint">
                            {rail.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Planned</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {plannedRails.map((rail) => (
                          <span key={rail.name} className="rounded-full border border-line bg-panel2 px-3 py-1 text-xs font-black text-muted">
                            {rail.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-ink p-5">
                  <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Market status</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {(['Open', 'Draft'] as MarketStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setMarketStatus(status)}
                        className={`rounded-2xl border px-4 py-3 text-left text-sm font-black transition-colors ${
                          marketStatus === status ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-line bg-panel2 text-white hover:border-cyan/30'
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>

                <button type="button" onClick={() => setShowReview(true)} className="w-full rounded-2xl bg-cyan px-6 py-4 font-black text-ink">
                  Review Market
                </button>
              </div>
            </form>

            {showReview ? (
              <section className="rounded-3xl border border-line bg-panel p-6">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Review</p>
                    <h2 className="mt-2 text-2xl font-black text-white">{title}</h2>
                    <p className="mt-3 max-w-3xl leading-7 text-muted">{description}</p>
                  </div>
                  <span className="rounded-full border border-line bg-ink px-3 py-1 text-xs font-black text-muted">
                    {marketStatus}
                  </span>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-line bg-ink p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Seed liquidity</p>
                    <p className="mt-2 text-2xl font-black text-white">{seedLiquidity} USDC</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-ink p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Resolver</p>
                    <p className="mt-2 text-lg font-black text-white">{resolver}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-ink p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Close date</p>
                    <p className="mt-2 text-lg font-black text-white">{new Date(closeDate).toLocaleString()}</p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-line bg-ink p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Resolution rules</p>
                    <p className="mt-3 text-sm leading-6 text-white">{rules}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-ink p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Source of truth</p>
                    <p className="mt-3 text-sm leading-6 text-white">{sourceOfTruth}</p>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button type="button" onClick={() => launchMarket(marketStatus)} className="rounded-2xl bg-cyan px-6 py-4 font-black text-ink">
                    {marketStatus === 'Draft' ? 'Save Draft Market' : 'Launch Mock Market'}
                  </button>
                  {marketStatus !== 'Draft' ? (
                    <button type="button" onClick={() => launchMarket('Draft')} className="rounded-2xl border border-line bg-ink px-6 py-4 font-black text-white">
                      Save Draft
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setShowReview(false)} className="rounded-2xl border border-line bg-ink px-6 py-4 font-black text-white">
                    Keep Editing
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
