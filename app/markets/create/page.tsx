'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { currentRails, plannedRails } from '@/lib/productRails';
import { marketTemplates } from '@/lib/marketTemplates';
import type { MarketTemplate } from '@/lib/marketTemplates';
import type { MarketType } from '@/lib/markets';

const marketTypes: MarketType[] = ['Prediction', 'Opinion', 'Opportunity'];

const typeCopy: Record<MarketType, string> = {
  Prediction: 'Objective future outcomes with clear sources of truth.',
  Opinion: 'Community conviction and product or governance sentiment.',
  Opportunity: 'Public signals for where builders and capital should focus.',
};

export default function CreateMarketPage() {
  const [selectedType, setSelectedType] = useState<MarketType>('Prediction');
  const [selectedTemplateId, setSelectedTemplateId] = useState('macro-release');

  const visibleTemplates = marketTemplates.filter((template) => template.type === selectedType);
  const activeTemplate: MarketTemplate = visibleTemplates.find((template) => template.id === selectedTemplateId) ?? visibleTemplates[0];

  function chooseType(type: MarketType) {
    setSelectedType(type);
    setSelectedTemplateId(marketTemplates.find((template) => template.type === type)?.id ?? selectedTemplateId);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-12">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-cyan">Create</p>
        <h1 className="mt-3 text-4xl font-black text-white">Launch a public market</h1>
        <p className="mt-3 max-w-3xl text-muted">
          Phase 2 adds structured templates for prediction, opinion, and opportunity markets. The form remains mock-safe until the factory is deployed and wallet writes are connected.
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
                    onClick={() => setSelectedTemplateId(template.id)}
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
          </aside>

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
                <label className="text-sm font-bold text-muted">Question</label>
                <input
                  className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                  defaultValue={activeTemplate.question}
                  key={`${activeTemplate.id}-question`}
                />
              </div>
              <div>
                <label className="text-sm font-bold text-muted">Resolution rules</label>
                <textarea
                  className="mt-2 min-h-32 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                  defaultValue={activeTemplate.rules}
                  key={`${activeTemplate.id}-rules`}
                />
              </div>
              <div>
                <label className="text-sm font-bold text-muted">Source of truth</label>
                <textarea
                  className="mt-2 min-h-24 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                  defaultValue={activeTemplate.sourceOfTruth}
                  key={`${activeTemplate.id}-source`}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-bold text-muted">Close date</label>
                  <input type="datetime-local" className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50" />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Seed liquidity USDC</label>
                  <input
                    className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                    defaultValue={activeTemplate.seedLiquidity}
                    key={`${activeTemplate.id}-seed`}
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Resolver</label>
                  <input
                    className="mt-2 w-full rounded-2xl border border-line bg-ink px-4 py-4 text-white outline-none focus:border-cyan/50"
                    defaultValue={activeTemplate.resolver}
                    key={`${activeTemplate.id}-resolver`}
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

              <button type="button" className="w-full rounded-2xl bg-cyan px-6 py-4 font-black text-ink">
                Review Market
              </button>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}
