'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { SiteHeader } from './SiteHeader';
import { ArcReadinessPanel } from './ArcReadinessPanel';
import { currentRails, plannedRails } from '@/lib/productRails';
import { marketTemplates } from '@/lib/marketTemplates';
import type { MarketTemplate } from '@/lib/marketTemplates';
import type { MarketType } from '@/lib/markets';
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
  const [resolver, setResolver] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const visibleTemplates = marketTemplates.filter((template) => template.type === selectedType);
  const activeTemplate: MarketTemplate = visibleTemplates.find((template) => template.id === selectedTemplateId) ?? visibleTemplates[0];

  function applyTemplate(template: MarketTemplate) {
    setSelectedTemplateId(template.id);
    setTitle(template.question);
    setDescription(`${template.title} market for ${template.category.toLowerCase()} signals on Arc.`);
    setRules(template.rules);
    setSourceOfTruth(template.sourceOfTruth);
    setShowReview(false);
    setStatusMessage('');
  }

  function chooseType(type: MarketType) {
    setSelectedType(type);
    const nextTemplate = marketTemplates.find((template) => template.type === type) ?? marketTemplates[0];
    applyTemplate(nextTemplate);
  }

  async function launchMarket() {
    setIsSubmitting(true);
    setStatusMessage('Submitting market creation to Arc...');

    const result = await createMarket({
      type: selectedType,
      title,
      description,
      category: activeTemplate.category,
      closeDate: new Date(closeDate).toISOString(),
      rules,
      sourceOfTruth,
      resolver,
      resolutionMode: activeTemplate.resolutionMode,
    });

    setIsSubmitting(false);
    setStatusMessage(result.message);

    if (result.ok) {
      router.push('/markets');
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1140px] px-4 pb-16 pt-28 md:px-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Create</p>
        <h1 className="mt-3 text-[clamp(34px,5vw,54px)] font-black tracking-tight text-white">Launch a public market</h1>
        <p className="mt-3 max-w-3xl text-[14px] leading-[1.7] text-muted">
          Create a live market through the deployed Presto factory on Arc. Your wallet signs the transaction, and the market appears after the factory read refreshes.
        </p>

        <div className="mt-9 grid gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-5">
            <section className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Market family</p>
              <div className="mt-4 grid gap-3">
                {marketTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => chooseType(type)}
                    className={`rounded-[14px] border px-4 py-4 text-left transition-colors ${
                      selectedType === type ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-white/[0.06] bg-[#0f172a] text-white hover:border-cyan/30'
                    }`}
                  >
                    <span className="block font-black">{type}</span>
                    <span className="mt-1 block text-sm leading-6 text-muted">{typeCopy[type]}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Templates</p>
              <div className="mt-4 grid gap-3">
                {visibleTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    className={`flex items-center justify-between rounded-[14px] border px-4 py-3 text-left transition-colors ${
                      activeTemplate.id === template.id ? 'border-cyan/50 bg-cyan/10' : 'border-white/[0.06] bg-[#0f172a] hover:border-cyan/30'
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
            <form className="rounded-[16px] border border-white/[0.06] bg-[#141e30]">
              <div className="border-b border-line p-6">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan">{activeTemplate.category}</p>
                    <h2 className="mt-2 text-2xl font-black text-white">{activeTemplate.title}</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{activeTemplate.closeHint}</p>
                  </div>
                  <span className="w-fit rounded-full border border-white/[0.06] bg-[#0f172a] px-3 py-1 text-xs font-black text-muted">
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
                    className="mt-2 w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Description</label>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="mt-2 min-h-28 w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Resolution rules</label>
                  <textarea
                    value={rules}
                    onChange={(event) => setRules(event.target.value)}
                    className="mt-2 min-h-32 w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Source of truth</label>
                  <textarea
                    value={sourceOfTruth}
                    onChange={(event) => setSourceOfTruth(event.target.value)}
                    className="mt-2 min-h-24 w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-bold text-muted">Close date</label>
                    <input
                      type="datetime-local"
                      value={closeDate}
                      onChange={(event) => setCloseDate(event.target.value)}
                      className="mt-2 w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted">Resolver address</label>
                    <input
                      value={resolver}
                      onChange={(event) => setResolver(event.target.value)}
                      className="mt-2 w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
                      placeholder="0x..."
                    />
                  </div>
                </div>

                <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                  <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Funding rails</p>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    V1 creation uses the deployed Presto factory and USDC market contracts on Arc. Paymaster, Bridge Kit, CCTP, and Gateway stay planned until each flow is live-tested.
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

                <button type="button" onClick={() => setShowReview(true)} className="w-full rounded-[10px] bg-cyan px-6 py-4 font-black text-ink transition-opacity hover:opacity-90">
                  Review Live Market
                </button>
              </div>
            </form>

            {showReview ? (
              <section className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Review</p>
                    <h2 className="mt-2 text-2xl font-black text-white">{title}</h2>
                    <p className="mt-3 max-w-3xl leading-7 text-muted">{description}</p>
                  </div>
                  <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-black text-cyan">
                    Live Arc transaction
                  </span>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Resolver</p>
                    <p className="mt-2 break-all text-lg font-black text-white">{resolver || 'Set a resolver address before launching'}</p>
                  </div>
                  <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Close date</p>
                    <p className="mt-2 text-lg font-black text-white">{new Date(closeDate).toLocaleString()}</p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Resolution rules</p>
                    <p className="mt-3 text-sm leading-6 text-white">{rules}</p>
                  </div>
                  <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Source of truth</p>
                    <p className="mt-3 text-sm leading-6 text-white">{sourceOfTruth}</p>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void launchMarket()}
                    disabled={isSubmitting}
                    className="rounded-[10px] bg-cyan px-6 py-4 font-black text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? 'Submitting...' : 'Launch Live Market'}
                  </button>
                  <button type="button" onClick={() => setShowReview(false)} className="rounded-[10px] border border-white/10 bg-[#0f172a] px-6 py-4 font-black text-white">
                    Keep Editing
                  </button>
                </div>
                {statusMessage ? (
                  <p className={`mt-4 rounded-[14px] border px-4 py-3 text-sm font-bold ${statusMessage.includes('failed') || statusMessage.includes('valid') || statusMessage.includes('required') ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-cyan/25 bg-cyan/10 text-cyan'}`}>
                    {statusMessage}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
