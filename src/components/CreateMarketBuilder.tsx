'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import type { MarketType, ResolutionMode } from '@/lib/markets';
import { useAppState } from '@/lib/appState';

const marketTypes: MarketType[] = ['Prediction', 'Opinion', 'Opportunity'];
const resolutionModes: ResolutionMode[] = ['Human resolver', 'Community resolver', 'Agent assisted'];
const maxInlineImageBytes = 300_000;

const typeCopy: Record<MarketType, string> = {
  Prediction: 'Objective future outcomes with clear sources of truth.',
  Opinion: 'Community conviction and product or governance sentiment.',
  Opportunity: 'Public signals for where builders and capital should focus.',
};

export function CreateMarketBuilder() {
  const router = useRouter();
  const { createMarket } = useAppState();
  const [selectedType, setSelectedType] = useState<MarketType>('Prediction');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [rules, setRules] = useState('');
  const [sourceOfTruth, setSourceOfTruth] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [resolver, setResolver] = useState('');
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>('Human resolver');
  const [imageURI, setImageURI] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  function chooseType(type: MarketType) {
    setSelectedType(type);
    setShowReview(false);
    setStatusMessage('');
  }

  function handleImageFile(file: File | undefined) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setStatusMessage('Choose an image file for the market picture.');
      return;
    }

    if (file.size > maxInlineImageBytes) {
      setStatusMessage('Choose an image under 300 KB or use a hosted image URL.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImageURI(String(reader.result ?? ''));
      setStatusMessage('');
    };
    reader.onerror = () => setStatusMessage('Unable to read that image file.');
    reader.readAsDataURL(file);
  }

  function getCloseDateLabel() {
    if (!closeDate) return 'Set a close date before launching';

    const parsedDate = new Date(closeDate);
    if (Number.isNaN(parsedDate.getTime())) return 'Choose a valid close date';

    return parsedDate.toLocaleString();
  }

  async function launchMarket() {
    if (!title || !description || !category || !rules || !sourceOfTruth || !closeDate || !resolver) {
      setStatusMessage('Complete all required fields before launching.');
      return;
    }

    const parsedCloseDate = new Date(closeDate);
    if (Number.isNaN(parsedCloseDate.getTime()) || parsedCloseDate.getTime() <= Date.now()) {
      setStatusMessage('Choose a future close date.');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Submitting market creation to Arc...');

    const result = await createMarket({
      type: selectedType,
      title,
      description,
      category,
      closeDate: parsedCloseDate.toISOString(),
      rules,
      sourceOfTruth,
      resolver,
      resolutionMode,
      imageURI: imageURI.trim() || undefined,
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

        <div className="mt-9 grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside>
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
          </aside>

          <div className="space-y-6">
            <form className="rounded-[16px] border border-white/[0.06] bg-[#141e30]">
              <div className="border-b border-line p-6">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan">{category || selectedType}</p>
                    <h2 className="mt-2 text-2xl font-black text-white">Market details</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                      Fill the metadata that will be written into the live Arc market metadata URI.
                    </p>
                  </div>
                  <span className="w-fit rounded-full border border-white/[0.06] bg-[#0f172a] px-3 py-1 text-xs font-black text-muted">
                    {resolutionMode}
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
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-bold text-muted">Category</label>
                    <input
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="mt-2 w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted">Resolution mode</label>
                    <select
                      value={resolutionMode}
                      onChange={(event) => setResolutionMode(event.target.value as ResolutionMode)}
                      className="mt-2 w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
                    >
                      {resolutionModes.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </div>
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
                    />
                  </div>
                </div>

                <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                  <label className="text-sm font-bold text-muted">Market picture</label>
                  <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                    <input
                      value={imageURI}
                      onChange={(event) => setImageURI(event.target.value)}
                      className="w-full rounded-[14px] border border-white/[0.06] bg-[#141e30] px-4 py-4 text-white outline-none focus:border-cyan/50"
                    />
                    <label className="cursor-pointer rounded-[10px] border border-cyan/30 bg-cyan/10 px-5 py-4 text-center text-sm font-black text-cyan transition-colors hover:bg-cyan/15">
                      Upload image
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => handleImageFile(event.target.files?.[0])}
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Use a hosted image URL, or upload a small image that can travel inside the market metadata.
                  </p>
                  {imageURI ? (
                    <div className="mt-4 overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#141e30]">
                      <img src={imageURI} alt="Market preview" className="h-48 w-full object-cover" />
                    </div>
                  ) : null}
                </div>

                <button type="button" onClick={() => setShowReview(true)} className="w-full rounded-[10px] bg-cyan px-6 py-4 font-black text-ink transition-opacity hover:opacity-90">
                  Review Live Market
                </button>
              </div>
            </form>

          </div>
        </div>
      </main>
      {showReview ? (
        <div className="fixed inset-0 z-[9999] grid place-items-center overflow-y-auto bg-[#050b14]/88 px-4 py-8 backdrop-blur-md">
          <section className="relative w-full max-w-[920px] rounded-[20px] border border-cyan/15 bg-[#141e30] p-6 shadow-2xl shadow-black/45">
            <button
              type="button"
              onClick={() => setShowReview(false)}
              className="absolute right-4 top-4 rounded-full border border-white/10 bg-[#0f172a] px-3 py-1.5 text-sm font-black text-white transition-colors hover:border-cyan/40"
              aria-label="Close review modal"
            >
              X
            </button>
            <div className="flex flex-col justify-between gap-4 pr-12 md:flex-row md:items-start">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Review</p>
                <h2 className="mt-2 text-2xl font-black text-white">{title || 'Untitled market'}</h2>
                <p className="mt-3 max-w-3xl leading-7 text-muted">{description || 'Add a market description before launching.'}</p>
              </div>
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-black text-cyan">
                Live Arc transaction
              </span>
            </div>

            {imageURI ? (
              <div className="mt-6 overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#0f172a]">
                <img src={imageURI} alt={title || 'Market picture'} className="h-64 w-full object-cover" />
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Resolver</p>
                <p className="mt-2 break-all text-lg font-black text-white">{resolver || 'Set a resolver address before launching'}</p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Close date</p>
                <p className="mt-2 text-lg font-black text-white">{getCloseDateLabel()}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Resolution rules</p>
                <p className="mt-3 text-sm leading-6 text-white">{rules || 'Add objective resolution rules before launching.'}</p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Source of truth</p>
                <p className="mt-3 text-sm leading-6 text-white">{sourceOfTruth || 'Add a source of truth before launching.'}</p>
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
        </div>
      ) : null}
      <SiteFooter />
    </>
  );
}
