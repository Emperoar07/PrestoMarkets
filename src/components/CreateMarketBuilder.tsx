'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAddress } from 'viem';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import type { MarketType, ResolutionMode } from '@/lib/markets';
import { useAppState } from '@/lib/appState';
import { createMarketCategories } from '@/lib/categories';
import { CloseDatePicker } from './CloseDatePicker';
import { getResolveFeeUsdc } from '@/lib/resolveFee';

const marketTypes: MarketType[] = ['Prediction', 'Opinion'];
const resolutionModes: ResolutionMode[] = ['Human resolver', 'Community resolver', 'Agent assisted'];
const maxInlineImageBytes = 300_000;

const typeCopy: Record<MarketType, string> = {
  Prediction: 'A future outcome with a clear source of truth.',
  Opinion: 'Community conviction, poll choices, and public sentiment.',
};

export function CreateMarketBuilder() {
  const router = useRouter();
  const { connectedWallet, createMarket, addLiquidity } = useAppState();
  const [selectedType, setSelectedType] = useState<MarketType>('Prediction');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const category = categories[0] ?? '';
  function toggleCategory(value: string) {
    setCategories((prev) => {
      if (prev.includes(value)) return prev.filter((c) => c !== value);
      if (prev.length >= 4) return prev;
      return [...prev, value];
    });
  }
  const [rules, setRules] = useState('');
  const [sourceOfTruth, setSourceOfTruth] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [resolver, setResolver] = useState('');
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>('Human resolver');
  const [imageURI, setImageURI] = useState('');
  const [outcomeStyle, setOutcomeStyle] = useState<'binary' | 'poll'>('binary');
  const [outcomeOptions, setOutcomeOptions] = useState(['YES', 'NO']);
  const [fundingAsset, setFundingAsset] = useState<'USDC' | 'EURC'>('USDC');
  const [initialLiquidity, setInitialLiquidity] = useState('');
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string; txHash?: string; marketAddress?: string } | null>(null);
  const isCircleWallet = connectedWallet?.mode === 'circle-user-controlled';
  const isAgentAssisted = resolutionMode === 'Agent assisted';

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agents/identity')
      .then((res) => res.json())
      .then((data: { ok?: boolean; agent?: { address?: string } }) => {
        if (!cancelled && data?.ok && data.agent?.address) setAgentAddress(data.agent.address);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isAgentAssisted || !agentAddress) return;
    if (resolver.trim().toLowerCase() !== agentAddress.toLowerCase()) {
      setResolver(agentAddress);
      setFieldErrors((prev) => ({ ...prev, resolver: '' }));
    }
  }, [isAgentAssisted, agentAddress, resolver]);

  useEffect(() => {
    if (isCircleWallet && fundingAsset === 'EURC') setFundingAsset('USDC');
  }, [fundingAsset, isCircleWallet]);

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

  function updateOutcomeOption(index: number, value: string) {
    setOutcomeOptions((current) => current.map((option, i) => (i === index ? value : option)));
  }

  function addOutcomeOption() {
    setOutcomeOptions((current) => [...current, `Option ${current.length + 1}`].slice(0, 12));
  }

  function removeOutcomeOption(index: number) {
    setOutcomeOptions((current) => current.filter((_, i) => i !== index));
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
    if (isAgentAssisted && !agentAddress) {
      setStatusMessage('Agent assisted resolution is unavailable until the Presto agent wallet is configured.');
      return;
    }

    const cleanOutcomeOptions = outcomeOptions.map((option) => option.trim()).filter(Boolean);
    if (outcomeStyle === 'poll' && cleanOutcomeOptions.length < 3) {
      setStatusMessage('Add at least three poll options to launch through the V2 factory.');
      return;
    }
    const seedAmount = Number(initialLiquidity) || 0;
    const seededOutcomeCount = outcomeStyle === 'poll' ? cleanOutcomeOptions.length : 2;
    const minimumSeedAmount = seededOutcomeCount * 0.01;
    if (initialLiquidity.trim() && seedAmount < minimumSeedAmount) {
      setStatusMessage(`Initial depth needs at least ${minimumSeedAmount.toFixed(2)} USDC so every outcome receives a seed.`);
      return;
    }

    const parsedCloseDate = new Date(closeDate);

    setIsSubmitting(true);
    setStatusMessage('Submitting market creation to Arc...');

    let result = await createMarket({
      type: selectedType,
      title,
      description,
      category,
      categories,
      closeDate: parsedCloseDate.toISOString(),
      rules,
      sourceOfTruth,
      resolver,
      agentResolverAddress: isAgentAssisted ? agentAddress ?? undefined : undefined,
      resolutionMode,
      imageURI: imageURI.trim() || undefined,
      outcomeOptions: outcomeStyle === 'poll' ? cleanOutcomeOptions : ['YES', 'NO'],
      collateral: 'USDC',
    });

    if (result.ok && seedAmount > 0) {
      if (!result.marketAddress) {
        result = {
          ...result,
          message: `${result.message} Open the new market to add the initial depth.`,
        };
      } else {
        setStatusMessage('Market created. Seeding balanced outcome depth...');
        const seedResult = await addLiquidity({
          marketId: result.marketAddress,
          amount: seedAmount,
          payWith: fundingAsset,
        });
        result = {
          ok: true,
          message: seedResult.ok
            ? `${result.message} Initial depth added: ${seedResult.message}`
            : `${result.message} Initial depth can be added from the market page: ${seedResult.message}`,
          txHash: seedResult.txHash ?? result.txHash,
          marketAddress: result.marketAddress,
        };
      }
    }

    setIsSubmitting(false);
    setStatusMessage(result.ok ? '' : result.message);
    setShowReview(false);
    setResult({ ok: result.ok, message: result.message, txHash: result.txHash });
  }

  function dismissResult() {
    const wasOk = result?.ok;
    setResult(null);
    if (wasOk) {
      window.dispatchEvent(new Event('presto:navigate-start'));
      router.push('/markets');
    }
  }

  const inputBase = 'w-full bg-transparent text-white placeholder:text-[#3d4a63] outline-none transition-colors text-[15px] py-3 border-b';
  const inputClass = (err?: string) => `${inputBase} ${err ? 'border-red-400/50' : 'border-white/[0.08] focus:border-cyan/60'}`;
  const textareaClass = (err?: string) => `${inputBase} resize-none leading-7 ${err ? 'border-red-400/50' : 'border-white/[0.08] focus:border-cyan/60'}`;

  function handleReview() {
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
    if (isAgentAssisted && !agentAddress) {
      setStatusMessage('Agent assisted resolution is unavailable until the Presto agent wallet is configured.');
      return;
    }
    setShowReview(true);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-5 pb-36 pt-36 md:px-6 md:pt-44">
        <h1 className="text-[clamp(28px,3.5vw,40px)] font-black tracking-tight text-white">
          New market.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-muted">
          Write a question the world can answer. Pick how it resolves. Launch it onchain in one transaction.
        </p>

        {/* Market family — inline radio row with generous spacing */}
        <div className="mt-14">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan/70">Market family</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 sm:gap-5">
            {marketTypes.map((type) => {
              const isActive = selectedType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => chooseType(type)}
                  className={`group relative rounded-[10px] border px-4 py-3.5 text-left transition-all ${
                    isActive
                      ? 'border-cyan/40 bg-cyan/[0.06] text-white'
                      : 'border-white/[0.06] text-muted hover:border-white/15 hover:text-white/85'
                  }`}
                >
                  <span className={`block text-[14px] font-black ${isActive ? 'text-white' : ''}`}>{type}</span>
                  <span className="mt-1.5 block text-[11px] leading-4 text-muted/70">{typeCopy[type]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section: The question */}
        <section className="mt-16">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan/70">01 — Question</p>
          <div className="mt-5 space-y-7">
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">What's the question?</label>
              <input
                value={title}
                onChange={(e) => setField('title', e.target.value, setTitle)}
                onBlur={(e) => blurField('title', e.target.value)}
                className={`mt-1 ${inputClass(fieldErrors.title)}`}
                placeholder="Will ETH break $5k before end of 2026?"
              />
              {fieldErrors.title ? <p className="mt-1.5 text-[11px] font-bold text-red-400">{fieldErrors.title}</p> : null}
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">Add context</label>
              <textarea
                value={description}
                onChange={(e) => setField('description', e.target.value, setDescription)}
                onBlur={(e) => blurField('description', e.target.value)}
                rows={3}
                className={`mt-1 ${textareaClass(fieldErrors.description)}`}
                placeholder="What background should traders know?"
              />
              {fieldErrors.description ? <p className="mt-1.5 text-[11px] font-bold text-red-400">{fieldErrors.description}</p> : null}
            </div>
          </div>
        </section>

        {/* Section: How it resolves */}
        <section className="mt-16">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan/70">02 — Resolution</p>
          <div className="mt-5 space-y-7">
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">Outcome style</label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {([
                  ['binary', 'Binary', 'Tradable YES / NO market on the current Arc factory.'],
                  ['poll', 'Poll', 'Create multiple outcome options when the V2 factory is configured.'],
                ] as const).map(([value, label, copy]) => {
                  const isActive = outcomeStyle === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setOutcomeStyle(value)}
                      className={`rounded-[12px] border p-4 text-left transition-colors ${
                        isActive ? 'border-cyan/40 bg-cyan/[0.06] text-white' : 'border-white/[0.06] text-muted hover:border-white/15'
                      }`}
                    >
                      <span className="block text-sm font-black">{label}</span>
                      <span className="mt-1.5 block text-xs leading-5 text-muted/80">{copy}</span>
                    </button>
                  );
                })}
              </div>

              {outcomeStyle === 'poll' ? (
                <div className="mt-4 rounded-[14px] border border-white/[0.06] bg-[#0d1520] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-black uppercase tracking-widest text-muted">Poll options</p>
                    <button
                      type="button"
                      onClick={addOutcomeOption}
                      className="rounded-full border border-cyan/25 px-3 py-1 text-[11px] font-black text-cyan transition-colors hover:bg-cyan/10"
                    >
                      Add option
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {outcomeOptions.map((option, index) => (
                      <div key={`${index}-${option}`} className="flex items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-[11px] font-black text-muted">
                          {index + 1}
                        </span>
                        <input
                          value={option}
                          onChange={(event) => updateOutcomeOption(index, event.target.value)}
                          className="flex-1 rounded-[10px] border border-white/[0.06] bg-[#0a1120] px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-[#3d4a63] focus:border-cyan/40"
                          placeholder={`Option ${index + 1}`}
                        />
                        {outcomeOptions.length > 2 ? (
                          <button
                            type="button"
                            onClick={() => removeOutcomeOption(index)}
                            className="rounded-[10px] border border-white/[0.06] px-3 py-2 text-xs font-black text-muted hover:border-red-400/30 hover:text-red-300"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted">
                    Poll markets route to the multi-outcome factory when `NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS` is configured.
                  </p>
                </div>
              ) : null}
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">How will this resolve?</label>
              <textarea
                value={rules}
                onChange={(e) => setField('rules', e.target.value, setRules)}
                onBlur={(e) => blurField('rules', e.target.value)}
                rows={3}
                className={`mt-1 ${textareaClass(fieldErrors.rules)}`}
                placeholder="YES wins if… Otherwise NO wins."
              />
              {fieldErrors.rules ? <p className="mt-1.5 text-[11px] font-bold text-red-400">{fieldErrors.rules}</p> : null}
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">Where will you verify?</label>
              <textarea
                value={sourceOfTruth}
                onChange={(e) => setField('sourceOfTruth', e.target.value, setSourceOfTruth)}
                onBlur={(e) => blurField('sourceOfTruth', e.target.value)}
                rows={2}
                className={`mt-1 ${textareaClass(fieldErrors.sourceOfTruth)}`}
                placeholder="A specific public source. CoinGecko price, SEC filing, official announcement…"
              />
              {fieldErrors.sourceOfTruth ? <p className="mt-1.5 text-[11px] font-bold text-red-400">{fieldErrors.sourceOfTruth}</p> : null}
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">Mode</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {resolutionModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setResolutionMode(mode);
                      if (mode === 'Agent assisted' && agentAddress) {
                        setResolver(agentAddress);
                        setFieldErrors((prev) => ({ ...prev, resolver: '' }));
                      }
                    }}
                    className={`rounded-full border px-3.5 py-1.5 text-[12px] font-black transition-colors ${
                      resolutionMode === mode
                        ? 'border-cyan/50 bg-cyan/10 text-cyan'
                        : 'border-white/[0.08] text-muted hover:border-white/20 hover:text-white/80'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">Who resolves it?</label>
              <input
                value={resolver}
                onChange={(e) => setField('resolver', e.target.value, setResolver)}
                onBlur={(e) => blurField('resolver', e.target.value)}
                readOnly={isAgentAssisted}
                placeholder="0x… (wallet that will sign the resolution)"
                className={`mt-1 font-mono text-[13px] ${inputClass(fieldErrors.resolver)} ${isAgentAssisted ? 'cursor-not-allowed opacity-75' : ''}`}
              />
              {fieldErrors.resolver ? <p className="mt-1.5 text-[11px] font-bold text-red-400">{fieldErrors.resolver}</p> : null}
              {isAgentAssisted && agentAddress ? (
                <p className="mt-1.5 text-[11px] text-cyan/80">
                  Locked to the Presto agent wallet. After creation, a <span className="font-black">${getResolveFeeUsdc()} USDC</span> funding step enables automatic evidence-based settlement after close.
                </p>
              ) : isAgentAssisted ? (
                <p className="mt-1.5 text-[11px] text-red-300">The Presto agent wallet is unavailable, so this mode cannot be launched yet.</p>
              ) : null}
            </div>
          </div>
        </section>

        {/* Section: Settings */}
        <section className="mt-16">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan/70">03 — Settings</p>
          <div className="mt-5 space-y-7">
            <div>
              <div className="flex items-baseline justify-between">
                <label className="text-[12px] font-bold uppercase tracking-wider text-muted">
                  Categories <span className="text-muted/60">(pick up to 4)</span>
                </label>
                <span className="text-[11px] font-bold text-muted/70">{categories.length}/4</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {createMarketCategories.map((item) => {
                  const isActive = categories.includes(item);
                  const atCap = !isActive && categories.length >= 4;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => toggleCategory(item)}
                      disabled={atCap}
                      className={`rounded-full border px-3 py-1.5 text-[12px] font-black transition-colors ${
                        isActive
                          ? 'border-cyan/50 bg-cyan/10 text-cyan'
                          : atCap
                            ? 'cursor-not-allowed border-white/[0.05] text-muted/40'
                            : 'border-white/[0.08] text-muted hover:border-white/20 hover:text-white/80'
                      }`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
              {categories.length > 0 ? (
                <p className="mt-2 text-[11px] text-muted/70">
                  Primary tag: <span className="font-black text-white">{categories[0]}</span>
                </p>
              ) : null}
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">Initial depth payment</label>
              <div className="mt-2 flex gap-2">
                {(['USDC', 'EURC'] as const).map((c) => {
                  const unavailable = c === 'EURC' && isCircleWallet;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { if (!unavailable) setFundingAsset(c); }}
                      disabled={unavailable}
                      title={unavailable ? 'EURC funding requires an external EVM wallet.' : ''}
                      className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[13px] font-black transition-colors ${
                        fundingAsset === c
                          ? c === 'EURC'
                            ? 'border-blue-400/50 bg-blue-400/10 text-blue-300'
                            : 'border-cyan/50 bg-cyan/10 text-cyan'
                          : 'border-white/[0.08] text-muted hover:border-white/20'
                      } ${unavailable ? 'cursor-not-allowed opacity-40' : ''}`}
                    >
                      <span>{c}</span>
                      <span className="text-[10px] opacity-60">{c === 'EURC' ? '€' : '$'}</span>
                    </button>
                  );
                })}
                <span className="self-center pl-2 text-[11px] text-muted/80">
                  {fundingAsset === 'EURC' ? 'Swapped into USDC before seeding' : 'Settles directly in USDC'}
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted/80">
                All Presto market contracts settle in USDC on Arc.
              </p>
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">When does it close?</label>
              <CloseDatePicker
                value={closeDate}
                onChange={(v) => setField('closeDate', v, setCloseDate)}
                onBlur={() => blurField('closeDate', closeDate)}
                placeholder="Pick a date and time"
                className="mt-1"
                errored={Boolean(fieldErrors.closeDate)}
              />
              {fieldErrors.closeDate ? <p className="mt-1.5 text-[11px] font-bold text-red-400">{fieldErrors.closeDate}</p> : null}
            </div>
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-muted">Creator funded depth</label>
              <input
                value={initialLiquidity}
                onChange={(event) => setInitialLiquidity(event.target.value)}
                placeholder="Optional amount to seed both sides"
                inputMode="decimal"
                className={`mt-1 ${inputClass()}`}
              />
              <p className="mt-2 text-[11px] leading-5 text-muted/80">
                If set, Presto creates the market then splits this amount evenly across every outcome.
              </p>
            </div>
          </div>
        </section>

        {/* Section: Picture */}
        <section className="mt-16">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan/70">04 — Picture <span className="font-medium normal-case tracking-normal text-muted/60">(optional)</span></p>
          <div className="mt-5">
            <div className="flex items-end gap-3">
              <input
                value={imageURI}
                onChange={(event) => setImageURI(event.target.value)}
                placeholder="Paste an image URL"
                className={`flex-1 ${inputClass()}`}
              />
              <label className="shrink-0 cursor-pointer pb-3 text-[12px] font-bold text-cyan/80 transition-colors hover:text-cyan">
                or upload
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => handleImageFile(event.target.files?.[0])}
                />
              </label>
            </div>
            {imageURI ? (
              <div className="mt-4 overflow-hidden rounded-[10px] border border-white/[0.06]">
                <img src={imageURI} alt="Market preview" loading="lazy" decoding="async" className="h-40 w-full object-cover" />
              </div>
            ) : null}
          </div>
        </section>

        {/* Sticky launch bar */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-[#0a1120]/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-5 py-4 md:px-6">
            <p className="text-[12px] text-muted">
              {category ? <><span className="font-black text-white">{selectedType}</span> · {category}</> : <span className="text-muted/60">Pick a category to continue</span>}
            </p>
            <button
              type="button"
              onClick={handleReview}
              className="rounded-full bg-cyan px-6 py-2.5 text-[13px] font-black text-ink transition-opacity hover:opacity-90"
            >
              Review →
            </button>
          </div>
        </div>
      </main>
      {showReview ? (
        <div className="fixed inset-0 z-[9999] grid place-items-center overflow-y-auto bg-[#050b14]/88 px-4 py-8 backdrop-blur-md">
          <section className="relative w-full max-w-[520px] rounded-[16px] border border-white/[0.08] bg-[#141e30] p-6 shadow-2xl shadow-black/45">
            <button
              type="button"
              onClick={() => setShowReview(false)}
              className="absolute right-3 top-3 rounded-full p-1.5 text-muted transition-colors hover:bg-white/[0.06] hover:text-white"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-cyan">Review</p>
            <h2 className="mt-2 text-xl font-black text-white">{title || 'Untitled market'}</h2>
            <p className="mt-2 text-[14px] leading-6 text-muted">{description || 'Add a description before launching.'}</p>

            {imageURI ? (
              <img src={imageURI} alt={title || 'Market picture'} loading="lazy" decoding="async" className="mt-4 h-40 w-full rounded-[10px] object-cover" />
            ) : null}

            {outcomeStyle === 'poll' ? (
              <div className="mt-5 rounded-[12px] border border-white/[0.06] bg-[#0d1520] p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Poll options</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {outcomeOptions.map((option, index) => (
                    <div key={`${index}-${option}`} className="rounded-[10px] border border-white/[0.06] px-3 py-2 text-sm font-bold text-white">
                      {option || `Option ${index + 1}`}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-muted">Routes through the V2 factory supporting up to 12 dynamically resolvable outcomes.</p>
              </div>
            ) : null}

            <dl className="mt-5 space-y-2.5 border-t border-white/[0.06] pt-5 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Close</dt>
                <dd className="text-right font-bold text-white">{getCloseDateLabel()}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Collateral</dt>
                <dd className="text-right font-bold text-cyan">USDC</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Depth payment</dt>
                <dd className={`text-right font-bold ${fundingAsset === 'EURC' ? 'text-blue-300' : 'text-cyan'}`}>{fundingAsset}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Resolver</dt>
                <dd className="text-right font-mono text-[12px] text-white">{resolver ? `${resolver.slice(0, 6)}…${resolver.slice(-4)}` : '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Mode</dt>
                <dd className="text-right font-bold text-white">{resolutionMode}</dd>
              </div>
              {resolutionMode === 'Agent assisted' ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Agent resolve fee</dt>
                  <dd className="text-right font-bold text-cyan">${getResolveFeeUsdc()} USDC</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Initial depth</dt>
                <dd className="text-right font-bold text-white">
                  {Number(initialLiquidity) > 0 ? `${initialLiquidity} ${fundingAsset}` : 'Add later'}
                </dd>
              </div>
            </dl>

            <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-5 text-[13px]">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Rules</p>
                <p className="mt-1.5 leading-6 text-white/90">{rules || '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Source of truth</p>
                <p className="mt-1.5 leading-6 text-white/90">{sourceOfTruth || '—'}</p>
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => void launchMarket()}
                disabled={isSubmitting}
                className="flex-1 rounded-[10px] bg-cyan px-4 py-3 text-[14px] font-black text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Launching…' : 'Launch market'}
              </button>
              <button
                type="button"
                onClick={() => setShowReview(false)}
                className="rounded-[10px] border border-white/[0.08] px-4 py-3 text-[14px] font-black text-white transition-colors hover:border-white/20"
              >
                Edit
              </button>
            </div>
            {statusMessage ? (
              <p className={`mt-3 rounded-[8px] px-3 py-2 text-[12px] font-bold ${statusMessage.includes('failed') || statusMessage.includes('valid') || statusMessage.includes('required') || statusMessage.includes('Insufficient') ? 'bg-red-400/10 text-red-200' : 'bg-cyan/10 text-cyan'}`}>
                {statusMessage}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {result ? (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-[#050b14]/88 px-4 py-8 backdrop-blur-md">
          <section className="relative w-full max-w-[460px] overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/50">
            <div className={`px-6 pb-5 pt-7 text-center ${result.ok ? 'bg-mint/[0.04]' : 'bg-red-400/[0.04]'}`}>
              <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full text-[22px] font-black ${result.ok ? 'bg-mint/15 text-mint' : 'bg-red-400/15 text-red-300'}`}>
                {result.ok ? '✓' : '!'}
              </div>
              <h2 className="mt-4 text-[20px] font-black text-white">
                {result.ok ? 'Market is live.' : 'Could not launch.'}
              </h2>
              <p className="mx-auto mt-2 max-w-[340px] text-[13px] leading-6 text-muted">
                {result.ok
                  ? `"${title}" is now on Arc. Trades open immediately and stay open until ${getCloseDateLabel()}.`
                  : result.message}
              </p>
            </div>

            {result.ok && result.txHash ? (
              <div className="border-t border-white/[0.06] px-6 py-4 text-center">
                <a
                  href={`https://testnet.arcscan.app/tx/${result.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[12px] text-cyan/80 transition-colors hover:text-cyan"
                >
                  {result.txHash.slice(0, 10)}…{result.txHash.slice(-8)} ↗
                </a>
              </div>
            ) : null}

            <div className="flex border-t border-white/[0.06]">
              {result.ok ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setResult(null); }}
                    className="flex-1 py-4 text-[13px] font-black text-muted transition-colors hover:bg-white/[0.03] hover:text-white"
                  >
                    Stay here
                  </button>
                  <button
                    type="button"
                    onClick={dismissResult}
                    className="flex-1 border-l border-white/[0.06] bg-cyan py-4 text-[13px] font-black text-ink transition-opacity hover:opacity-90"
                  >
                    View markets →
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setResult(null)}
                    className="flex-1 py-4 text-[13px] font-black text-muted transition-colors hover:bg-white/[0.03] hover:text-white"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => { setResult(null); setShowReview(true); }}
                    className="flex-1 border-l border-white/[0.06] bg-cyan py-4 text-[13px] font-black text-ink transition-opacity hover:opacity-90"
                  >
                    Try again
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
      <SiteFooter />
    </>
  );
}
