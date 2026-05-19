'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAddress } from 'viem';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import type { MarketType, ResolutionMode } from '@/lib/markets';
import { useAppState } from '@/lib/appState';
import { createMarketCategories } from '@/lib/categories';

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
  const { createMarket, connectedWallet } = useAppState();
  const isCircleWallet = connectedWallet?.mode === 'circle-user-controlled';
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
  const [collateral, setCollateral] = useState<'USDC' | 'EURC'>('USDC');
  const [showReview, setShowReview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});

  function validateField(name: string, value: string): string {
    if (name === 'title') {
      if (!value.trim()) return 'Title is required.';
      if (value.trim().length < 10) return 'Title must be at least 10 characters.';
      if (value.trim().length > 200) return 'Title must be 200 characters or fewer.';
    }
    if (name === 'description') {
      if (!value.trim()) return 'Description is required.';
      if (value.trim().length < 20) return 'Description must be at least 20 characters.';
      if (value.trim().length > 1000) return 'Description must be 1000 characters or fewer.';
    }
    if (name === 'rules') {
      if (!value.trim()) return 'Resolution rules are required.';
      if (value.trim().length < 20) return 'Rules must be at least 20 characters.';
    }
    if (name === 'sourceOfTruth') {
      if (!value.trim()) return 'Source of truth is required.';
    }
    if (name === 'closeDate') {
      if (!value) return 'Close date is required.';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return 'Enter a valid date.';
      if (parsed.getTime() <= Date.now()) return 'Close date must be in the future.';
    }
    if (name === 'resolver') {
      if (!value.trim()) return 'Resolver address is required.';
      if (!isAddress(value.trim())) return 'Enter a valid EVM wallet address (0x…).';
    }
    return '';
  }

  function setField(name: string, value: string, setter: (v: string) => void) {
    setter(value);
    const error = validateField(name, value);
    setFieldErrors((prev) => ({ ...prev, [name]: error }));
  }

  function blurField(name: string, value: string) {
    const error = validateField(name, value);
    setFieldErrors((prev) => ({ ...prev, [name]: error }));
  }

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
    const checks: [string, string][] = [
      ['title', title],
      ['description', description],
      ['rules', rules],
      ['sourceOfTruth', sourceOfTruth],
      ['closeDate', closeDate],
      ['resolver', resolver],
    ];
    const errors: Record<string, string> = {};
    for (const [name, value] of checks) {
      const error = validateField(name, value);
      if (error) errors[name] = error;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setStatusMessage('Fix the errors above before launching.');
      return;
    }

    if (!category) {
      setStatusMessage('Choose a category before launching.');
      return;
    }

    const parsedCloseDate = new Date(closeDate);

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
      collateral,
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
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-28 md:px-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Create</p>
        <h1 className="mt-3 text-[clamp(34px,5vw,54px)] font-black tracking-tight text-white">Launch a public market</h1>
        <p className="mt-3 max-w-3xl text-[14px] leading-[1.7] text-muted">
          Create a live market through the deployed Presto factory on Arc. Your wallet signs the transaction, and the market appears after the factory read refreshes.
        </p>

        {isCircleWallet && (
          <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-yellow-400/30 bg-yellow-400/10 px-4 py-4">
            <span className="mt-0.5 shrink-0 text-yellow-300">⚠</span>
            <div>
              <p className="text-sm font-black text-yellow-200">External wallet required to create markets</p>
              <p className="mt-1 text-xs leading-5 text-yellow-200/70">
                You&apos;re signed in with a Circle app wallet, which supports sign-in and balance reads only. Arc Testnet market transactions require an external EVM wallet — connect MetaMask or another browser wallet to launch markets.
              </p>
            </div>
          </div>
        )}

        <div className="mt-9 grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Market family</p>
            <div className="mt-4 grid gap-3">
              {marketTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => chooseType(type)}
                  className={`rounded-[14px] border px-4 py-4 text-left transition-colors ${
                    selectedType === type ? 'border-cyan/50 bg-cyan/10 text-cyan' : 'border-white/[0.06] bg-[#141e30] text-white hover:border-cyan/30'
                  }`}
                >
                  <span className="block font-black">{type}</span>
                  <span className="mt-1 block text-sm leading-6 text-muted">{typeCopy[type]}</span>
                </button>
              ))}
            </div>
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
                    onChange={(e) => setField('title', e.target.value, setTitle)}
                    onBlur={(e) => blurField('title', e.target.value)}
                    className={`mt-2 w-full rounded-[14px] border bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50 ${fieldErrors.title ? 'border-red-400/50' : 'border-white/[0.06]'}`}
                    placeholder="e.g. Will ETH break $5k before end of 2025?"
                  />
                  {fieldErrors.title ? <p className="mt-1.5 text-xs font-bold text-red-400">{fieldErrors.title}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="text-sm font-bold text-muted">Category</label>
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="mt-2 w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
                    >
                      <option value="">Choose category</option>
                      {createMarketCategories.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted">Collateral</label>
                    <div className="mt-2 flex gap-2">
                      {(['USDC', 'EURC'] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCollateral(c)}
                          className={`flex-1 rounded-[14px] border py-4 text-sm font-black transition-colors ${
                            collateral === c
                              ? c === 'EURC'
                                ? 'border-blue-400/50 bg-blue-400/10 text-blue-300'
                                : 'border-cyan/50 bg-cyan/10 text-cyan'
                              : 'border-white/[0.06] bg-[#0f172a] text-muted hover:border-white/20'
                          }`}
                        >
                          {c}
                          {c === 'EURC' && <span className="ml-1 text-[10px] opacity-60">€</span>}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted">
                      {collateral === 'EURC' ? 'Euro-backed · Circle EURC on Arc' : 'Dollar-backed · Circle USDC on Arc'}
                    </p>
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
                    onChange={(e) => setField('description', e.target.value, setDescription)}
                    onBlur={(e) => blurField('description', e.target.value)}
                    className={`mt-2 min-h-28 w-full rounded-[14px] border bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50 ${fieldErrors.description ? 'border-red-400/50' : 'border-white/[0.06]'}`}
                  />
                  {fieldErrors.description ? <p className="mt-1.5 text-xs font-bold text-red-400">{fieldErrors.description}</p> : null}
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Resolution rules</label>
                  <textarea
                    value={rules}
                    onChange={(e) => setField('rules', e.target.value, setRules)}
                    onBlur={(e) => blurField('rules', e.target.value)}
                    className={`mt-2 min-h-32 w-full rounded-[14px] border bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50 ${fieldErrors.rules ? 'border-red-400/50' : 'border-white/[0.06]'}`}
                  />
                  {fieldErrors.rules ? <p className="mt-1.5 text-xs font-bold text-red-400">{fieldErrors.rules}</p> : null}
                </div>
                <div>
                  <label className="text-sm font-bold text-muted">Source of truth</label>
                  <textarea
                    value={sourceOfTruth}
                    onChange={(e) => setField('sourceOfTruth', e.target.value, setSourceOfTruth)}
                    onBlur={(e) => blurField('sourceOfTruth', e.target.value)}
                    className={`mt-2 min-h-24 w-full rounded-[14px] border bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50 ${fieldErrors.sourceOfTruth ? 'border-red-400/50' : 'border-white/[0.06]'}`}
                  />
                  {fieldErrors.sourceOfTruth ? <p className="mt-1.5 text-xs font-bold text-red-400">{fieldErrors.sourceOfTruth}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-bold text-muted">Close date</label>
                    <input
                      type="datetime-local"
                      value={closeDate}
                      onChange={(e) => setField('closeDate', e.target.value, setCloseDate)}
                      onBlur={(e) => blurField('closeDate', e.target.value)}
                      className={`mt-2 w-full rounded-[14px] border bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50 ${fieldErrors.closeDate ? 'border-red-400/50' : 'border-white/[0.06]'}`}
                    />
                    {fieldErrors.closeDate ? <p className="mt-1.5 text-xs font-bold text-red-400">{fieldErrors.closeDate}</p> : null}
                  </div>
                  <div>
                    <label className="text-sm font-bold text-muted">Resolver address</label>
                    <input
                      value={resolver}
                      onChange={(e) => setField('resolver', e.target.value, setResolver)}
                      onBlur={(e) => blurField('resolver', e.target.value)}
                      placeholder="0x…"
                      className={`mt-2 w-full rounded-[14px] border bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50 ${fieldErrors.resolver ? 'border-red-400/50' : 'border-white/[0.06]'}`}
                    />
                    {fieldErrors.resolver ? <p className="mt-1.5 text-xs font-bold text-red-400">{fieldErrors.resolver}</p> : null}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-bold text-muted">Market picture</label>
                  <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                    <input
                      value={imageURI}
                      onChange={(event) => setImageURI(event.target.value)}
                      className="w-full rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-4 text-white outline-none focus:border-cyan/50"
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
                    <div className="mt-4 overflow-hidden rounded-[14px] border border-white/[0.06]">
                      <img src={imageURI} alt="Market preview" className="h-48 w-full object-cover" />
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const checks: [string, string][] = [
                      ['title', title], ['description', description], ['rules', rules],
                      ['sourceOfTruth', sourceOfTruth], ['closeDate', closeDate], ['resolver', resolver],
                    ];
                    const errors: Record<string, string> = {};
                    for (const [name, value] of checks) {
                      const error = validateField(name, value);
                      if (error) errors[name] = error;
                    }
                    if (Object.keys(errors).length > 0) {
                      setFieldErrors(errors);
                      return;
                    }
                    setShowReview(true);
                  }}
                  className="w-full rounded-[10px] bg-cyan px-6 py-4 font-black text-ink transition-opacity hover:opacity-90"
                >
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

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Resolver</p>
                <p className="mt-2 break-all text-lg font-black text-white">{resolver || 'Set a resolver address before launching'}</p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Close date</p>
                <p className="mt-2 text-lg font-black text-white">{getCloseDateLabel()}</p>
              </div>
              <div className={`rounded-[14px] border p-5 ${collateral === 'EURC' ? 'border-blue-400/20 bg-blue-400/5' : 'border-white/[0.06] bg-[#0f172a]'}`}>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Collateral</p>
                <p className={`mt-2 text-lg font-black ${collateral === 'EURC' ? 'text-blue-300' : 'text-cyan'}`}>{collateral}</p>
                <p className="mt-0.5 text-[11px] text-muted">{collateral === 'EURC' ? 'Circle EURC · euro-backed' : 'Circle USDC · dollar-backed'}</p>
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
