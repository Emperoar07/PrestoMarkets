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
import { 
  MessageSquare, 
  Scale, 
  Sliders, 
  Image as ImageIcon, 
  Info, 
  AlertTriangle, 
  CheckCircle2, 
  X, 
  Plus, 
  Trash2,
  Calendar,
  HelpCircle,
  ExternalLink
} from 'lucide-react';

const resolutionModes: ResolutionMode[] = ['Human resolver', 'Community resolver', 'Agent assisted'];
const maxInlineImageBytes = 300_000;

export function CreateMarketBuilder() {
  const router = useRouter();
  const { connectedWallet, createMarket } = useAppState();
  
  // Markets are created as Prediction by default.
  const selectedType: MarketType = 'Prediction';
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
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string; txHash?: string; marketAddress?: string } | null>(null);
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
    const parsedCloseDate = new Date(closeDate);

    setIsSubmitting(true);
    setStatusMessage('Submitting market creation to Arc...');

    const result = await createMarket({
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

  const inputBase = 'w-full rounded-xl border bg-[#0d1626]/20 px-4 py-3 text-white placeholder:text-[#475569] outline-none transition-all text-[14.5px]';
  const inputClass = (err?: string) => `${inputBase} ${err ? 'border-red-400/35 bg-red-400/[0.02] focus:border-red-400/50 focus:ring-1 focus:ring-red-400/50' : 'border-white/[0.06] hover:border-white/[0.1] hover:bg-white/[0.01] focus:border-cyan/40 focus:bg-[#0d1626]/35 focus:ring-1 focus:ring-cyan/40'}`;
  const textareaClass = (err?: string) => `${inputClass(err)} resize-none leading-relaxed min-h-[105px]`;

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
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-36 md:px-6 md:pt-44">
        {/* Header Title */}
        <div className="flex flex-col gap-2">
          <h1 className="text-[clamp(28px,3.5vw,40px)] font-black tracking-tight text-white">Create Market</h1>
          <p className="text-[15px] leading-relaxed text-[#94a3b8]">
            Write a question the world can answer. Pick how it resolves and launch it onchain instantly.
          </p>
        </div>

        <div className="mt-10 space-y-6">
          {/* Section: Question and Context */}
          <section className="rounded-2xl border border-white/[0.04] bg-[#0d1626]/20 p-6 md:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                <MessageSquare className="h-4.5 w-4.5" />
              </span>
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Question & Context</h2>
            </div>
            
            <div className="space-y-5">
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">What is the market question?</label>
                <input
                  value={title}
                  onChange={(e) => setField('title', e.target.value, setTitle)}
                  onBlur={(e) => blurField('title', e.target.value)}
                  className={`mt-2 ${inputClass(fieldErrors.title)}`}
                  placeholder="e.g., Will ETH break $5k before the end of 2026?"
                />
                {fieldErrors.title ? <p className="mt-2 text-[11px] font-bold text-red-400">{fieldErrors.title}</p> : null}
              </div>
              
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">Add background context</label>
                <textarea
                  value={description}
                  onChange={(e) => setField('description', e.target.value, setDescription)}
                  onBlur={(e) => blurField('description', e.target.value)}
                  className={`mt-2 ${textareaClass(fieldErrors.description)}`}
                  placeholder="Provide any background context, links, or facts traders should know before participating..."
                />
                {fieldErrors.description ? <p className="mt-2 text-[11px] font-bold text-red-400">{fieldErrors.description}</p> : null}
              </div>
            </div>
          </section>

          {/* Section: How it resolves */}
          <section className="rounded-2xl border border-white/[0.04] bg-[#0d1626]/20 p-6 md:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                <Scale className="h-4.5 w-4.5" />
              </span>
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Resolution Rules</h2>
            </div>
            
            <div className="space-y-5">
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">Outcome style</label>
                <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
                  {([
                    ['binary', 'Binary Market', 'Tradable YES / NO outcomes deployed on the prediction contract.'],
                    ['poll', 'Multi-Outcome Poll', 'Create custom options. Deploys using the V2 multi-outcome factory.'],
                  ] as const).map(([value, label, copy]) => {
                    const isActive = outcomeStyle === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setOutcomeStyle(value)}
                        className={`rounded-xl border p-5 text-left transition-all duration-200 outline-none ${
                          isActive 
                            ? 'border-cyan/35 bg-cyan/[0.05] text-white ring-1 ring-cyan/30' 
                            : 'border-white/[0.06] bg-white/[0.01] text-[#94a3b8] hover:border-white/15 hover:bg-white/[0.02]'
                        }`}
                      >
                        <span className="block text-[13.5px] font-black text-white">{label}</span>
                        <span className="mt-2 block text-xs leading-relaxed text-[#94a3b8]">{copy}</span>
                      </button>
                    );
                  })}
                </div>

                {outcomeStyle === 'poll' ? (
                  <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#0d1520] p-5">
                    <div className="flex items-center justify-between gap-3 border-b border-white/[0.04] pb-3 mb-3">
                      <p className="text-[11px] font-black uppercase tracking-wider text-[#64748b]">Outcome Options</p>
                      <button
                        type="button"
                        onClick={addOutcomeOption}
                        className="rounded-lg border border-cyan/25 px-3 py-1 text-[11px] font-black text-cyan transition-colors hover:bg-cyan/10"
                      >
                        Add Option
                      </button>
                    </div>
                    <div className="space-y-2">
                      {outcomeOptions.map((option, index) => (
                        <div key={`${index}-${option}`} className="flex items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[11px] font-black text-[#64748b]">
                            {index + 1}
                          </span>
                          <input
                            value={option}
                            onChange={(event) => updateOutcomeOption(index, event.target.value)}
                            className="flex-1 rounded-lg border border-white/[0.06] bg-[#0a1120] px-3.5 py-2 text-sm text-white outline-none transition-colors placeholder:text-[#3d4a63] focus:border-cyan/40"
                            placeholder={`Option ${index + 1}`}
                          />
                          {outcomeOptions.length > 2 ? (
                            <button
                              type="button"
                              onClick={() => removeOutcomeOption(index)}
                              className="rounded-lg border border-white/[0.06] p-2 text-muted hover:border-rose-500/30 hover:text-rose-400 transition"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">How will this resolve?</label>
                <textarea
                  value={rules}
                  onChange={(e) => setField('rules', e.target.value, setRules)}
                  onBlur={(e) => blurField('rules', e.target.value)}
                  className={`mt-2 ${textareaClass(fieldErrors.rules)}`}
                  placeholder="Define clear resolution parameters. e.g., YES wins if ETH records a trade at or above $5,000 on Coinbase before December 31, 2026 UTC. Otherwise, NO wins."
                />
                {fieldErrors.rules ? <p className="mt-2 text-[11px] font-bold text-red-400">{fieldErrors.rules}</p> : null}
              </div>

              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">Where will you verify? (Source of Truth)</label>
                <textarea
                  value={sourceOfTruth}
                  onChange={(e) => setField('sourceOfTruth', e.target.value, setSourceOfTruth)}
                  onBlur={(e) => blurField('sourceOfTruth', e.target.value)}
                  className={`mt-2 ${textareaClass(fieldErrors.sourceOfTruth)}`}
                  placeholder="Specify the exact verification link or dashboard (e.g., Coinbase trade history link, SEC official site filings...)"
                />
                {fieldErrors.sourceOfTruth ? <p className="mt-2 text-[11px] font-bold text-red-400">{fieldErrors.sourceOfTruth}</p> : null}
              </div>

              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">Resolution Mode</label>
                <div className="mt-2.5 flex flex-wrap gap-1 border border-white/[0.06] bg-[#0c1322] p-1 rounded-xl w-fit">
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
                      className={`rounded-lg px-4 py-2 text-[12.5px] font-bold transition-all duration-200 ${
                        resolutionMode === mode
                          ? 'bg-cyan text-[#07111f] shadow-lg shadow-cyan/10'
                          : 'text-[#94a3b8] hover:bg-white/[0.04] hover:text-[#f1f5f9]'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">Who resolves this market?</label>
                <input
                  value={resolver}
                  onChange={(e) => setField('resolver', e.target.value, setResolver)}
                  onBlur={(e) => blurField('resolver', e.target.value)}
                  readOnly={isAgentAssisted}
                  placeholder="0x… (EVM wallet address authorized to settle this market)"
                  className={`mt-2 font-mono text-[13px] ${inputClass(fieldErrors.resolver)} ${isAgentAssisted ? 'cursor-not-allowed opacity-75' : ''}`}
                />
                {fieldErrors.resolver ? <p className="mt-2 text-[11px] font-bold text-red-400">{fieldErrors.resolver}</p> : null}
                
                {isAgentAssisted && (
                  <div className={`mt-3 flex items-start gap-2.5 rounded-xl border p-4 text-xs leading-relaxed ${
                    agentAddress 
                      ? 'border-cyan/20 bg-cyan/5 text-cyan' 
                      : 'border-red-500/20 bg-red-500/5 text-red-400'
                  }`}>
                    {agentAddress ? (
                      <>
                        <Info className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                        <p>
                          Locked to the Presto agent wallet. After creation, a <span className="font-extrabold text-white">${getResolveFeeUsdc()} USDC</span> funding step enables automatic evidence-based settlement after close.
                        </p>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                        <p>
                          The Presto agent wallet is unavailable, so this mode cannot be launched yet. Please choose another resolution mode.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section: Settings */}
          <section className="rounded-2xl border border-white/[0.04] bg-[#0d1626]/20 p-6 md:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                <Sliders className="h-4.5 w-4.5" />
              </span>
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Market Settings</h2>
            </div>
            
            <div className="space-y-5">
              <div>
                <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-2">
                  <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">
                    Categories <span className="text-[#64748b] normal-case">(select up to 4 tags)</span>
                  </label>
                  <span className="text-xs font-bold text-cyan">{categories.length}/4</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {createMarketCategories.map((item) => {
                    const isActive = categories.includes(item);
                    const atCap = !isActive && categories.length >= 4;
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleCategory(item)}
                        disabled={atCap}
                        className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition-all ${
                          isActive
                            ? 'border-cyan/40 bg-cyan/10 text-cyan shadow-md shadow-cyan/5'
                            : atCap
                              ? 'cursor-not-allowed border-white/[0.04] text-muted/30'
                              : 'border-white/[0.06] bg-white/[0.01] text-[#cbd5e1] hover:border-white/20 hover:text-white'
                        }`}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>
                {categories.length > 0 ? (
                  <p className="mt-3 text-xs text-[#64748b]">
                    Primary Category Tag: <span className="font-extrabold text-white">{categories[0]}</span>
                  </p>
                ) : null}
              </div>

              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">When does the market close?</label>
                <CloseDatePicker
                  value={closeDate}
                  onChange={(v) => setField('closeDate', v, setCloseDate)}
                  onBlur={() => blurField('closeDate', closeDate)}
                  placeholder="Select market end date & time"
                  className="mt-2"
                  errored={Boolean(fieldErrors.closeDate)}
                />
                {fieldErrors.closeDate ? <p className="mt-2 text-[11px] font-bold text-red-400">{fieldErrors.closeDate}</p> : null}
              </div>
            </div>
          </section>

          {/* Section: Picture */}
          <section className="rounded-2xl border border-white/[0.04] bg-[#0d1626]/20 p-6 md:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                <ImageIcon className="h-4.5 w-4.5" />
              </span>
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Visual Identity</h2>
            </div>
            
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-[#94a3b8]">Market Image Link <span className="text-[#64748b] normal-case">(optional)</span></label>
              <div className="mt-2.5 flex items-center gap-3">
                <input
                  value={imageURI}
                  onChange={(event) => setImageURI(event.target.value)}
                  placeholder="Paste cover image hosted URL (HTTPS)"
                  className={`flex-1 ${inputClass()}`}
                />
                <label className="shrink-0 cursor-pointer rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs font-black text-cyan hover:bg-white/[0.04] hover:border-white/[0.1] transition-all">
                  Upload file
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => handleImageFile(event.target.files?.[0])}
                  />
                </label>
              </div>
              
              {imageURI ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.06]">
                  <img src={imageURI} alt="Market preview" loading="lazy" decoding="async" className="h-44 w-full object-cover" />
                </div>
              ) : null}
            </div>
          </section>
        </div>

        {/* Action Bottom Row */}
        <div className="mt-10 flex flex-col gap-4 border-t border-white/[0.06] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[#64748b]">
            {category ? (
              <>
                Selected Type: <span className="font-extrabold text-white">{selectedType}</span> · Primary Tag: <span className="font-extrabold text-cyan">{category}</span>
              </>
            ) : (
              <span className="text-rose-400 font-bold">Please select at least one category tag above.</span>
            )}
          </p>
          <button
            type="button"
            onClick={handleReview}
            className="rounded-xl bg-cyan px-10 py-3 text-sm font-black text-[#07111f] transition-opacity hover:opacity-90 shadow-lg shadow-cyan/10"
          >
            Review & Launch
          </button>
        </div>
      </main>

      {/* Review Modal */}
      {showReview ? (
        <div className="fixed inset-0 z-[9999] grid place-items-center overflow-y-auto bg-[#050b14]/80 px-4 py-8 backdrop-blur-md">
          <section className="relative w-full max-w-[560px] rounded-2xl border border-white/[0.08] bg-[#0b1322] p-6 md:p-8 shadow-2xl shadow-black/60">
            <button
              type="button"
              onClick={() => setShowReview(false)}
              className="absolute right-4 top-4 rounded-full p-2 text-[#64748b] transition hover:bg-white/[0.04] hover:text-white"
              aria-label="Close"
            >
              <X className="h-4.5 w-4.5" />
            </button>

            <div className="border-b border-white/[0.06] pb-5">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan">Launch Review</p>
              <h2 className="mt-2.5 text-lg font-black text-white leading-snug">{title || 'Untitled market'}</h2>
              <p className="mt-2 text-sm text-[#94a3b8] leading-relaxed whitespace-pre-wrap">{description || 'No description provided.'}</p>
            </div>

            {imageURI ? (
              <img src={imageURI} alt={title || 'Market picture'} loading="lazy" decoding="async" className="mt-4 h-40 w-full rounded-xl object-cover border border-white/[0.04]" />
            ) : null}

            {outcomeStyle === 'poll' ? (
              <div className="mt-5 rounded-xl border border-white/[0.06] bg-[#0d1520] p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#64748b] mb-3">Poll Options</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {outcomeOptions.map((option, index) => (
                    <div key={`${index}-${option}`} className="rounded-lg border border-white/[0.06] px-3.5 py-2 text-sm font-bold text-white bg-white/[0.01]">
                      {option || `Option ${index + 1}`}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 space-y-3">
              <div className="flex justify-between items-center gap-4 text-xs">
                <span className="text-[#64748b] font-bold uppercase tracking-wider">Close Time</span>
                <span className="text-white font-extrabold text-right">{getCloseDateLabel()}</span>
              </div>
              <div className="h-px bg-white/[0.04]" />
              <div className="flex justify-between items-center gap-4 text-xs">
                <span className="text-[#64748b] font-bold uppercase tracking-wider">Collateral</span>
                <span className="text-cyan font-black">USDC</span>
              </div>
              <div className="h-px bg-white/[0.04]" />
              <div className="flex justify-between items-center gap-4 text-xs">
                <span className="text-[#64748b] font-bold uppercase tracking-wider">Resolver Address</span>
                <span className="font-mono text-white text-[11px] text-right">{resolver ? `${resolver.slice(0, 8)}…${resolver.slice(-6)}` : '—'}</span>
              </div>
              <div className="h-px bg-white/[0.04]" />
              <div className="flex justify-between items-center gap-4 text-xs">
                <span className="text-[#64748b] font-bold uppercase tracking-wider">Resolution Mode</span>
                <span className="text-white font-extrabold text-right">{resolutionMode}</span>
              </div>
              {resolutionMode === 'Agent assisted' && (
                <>
                  <div className="h-px bg-white/[0.04]" />
                  <div className="flex justify-between items-center gap-4 text-xs">
                    <span className="text-[#64748b] font-bold uppercase tracking-wider">Agent Resolve Fee</span>
                    <span className="text-cyan font-black text-right">${getResolveFeeUsdc()} USDC</span>
                  </div>
                </>
              )}
            </div>

            <div className="mt-5 space-y-4 border-t border-white/[0.06] pt-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">Resolution Rules</p>
                <p className="mt-1.5 text-xs text-white/90 leading-relaxed whitespace-pre-wrap">{rules || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">Verification Source</p>
                <p className="mt-1.5 text-xs text-white/90 leading-relaxed whitespace-pre-wrap">{sourceOfTruth || '—'}</p>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => void launchMarket()}
                disabled={isSubmitting}
                className="flex-1 rounded-xl bg-cyan py-3 text-sm font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 shadow-lg shadow-cyan/10"
              >
                {isSubmitting ? 'Launching…' : 'Launch Market'}
              </button>
              <button
                type="button"
                onClick={() => setShowReview(false)}
                className="rounded-xl border border-white/[0.08] px-5 py-3 text-sm font-black text-white transition-colors hover:border-white/20 hover:bg-white/[0.02]"
              >
                Cancel
              </button>
            </div>
            
            {statusMessage ? (
              <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold ${statusMessage.toLowerCase().includes('failed') || statusMessage.toLowerCase().includes('error') || statusMessage.toLowerCase().includes('unavailable') ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-cyan/10 text-cyan border border-cyan/20'}`}>
                {statusMessage}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {/* Launch Success/Failure Overlay Modal */}
      {result ? (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-[#050b14]/80 px-4 py-8 backdrop-blur-md">
          <section className="relative w-full max-w-[460px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/60">
            <div className={`px-6 pb-6 pt-8 text-center ${result.ok ? 'bg-emerald-500/[0.02]' : 'bg-rose-500/[0.02]'}`}>
              <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full text-lg font-black border ${
                result.ok 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}>
                {result.ok ? '✓' : '!'}
              </div>
              <h2 className="mt-4 text-lg font-black text-white">
                {result.ok ? 'Market is live.' : 'Could not launch.'}
              </h2>
              <p className="mx-auto mt-2 max-w-[340px] text-xs leading-relaxed text-[#94a3b8]">
                {result.ok
                  ? `"${title}" is now deployed to Arc. Trading starts immediately and stays open until ${getCloseDateLabel()}.`
                  : result.message}
              </p>
            </div>

            {result.ok && result.txHash ? (
              <div className="border-t border-white/[0.06] px-6 py-4 text-center bg-white/[0.01]">
                <a
                  href={`https://testnet.arcscan.app/tx/${result.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-[12px] text-cyan transition-colors hover:opacity-80"
                >
                  <span>Tx: {result.txHash.slice(0, 12)}…{result.txHash.slice(-10)}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : null}

            <div className="flex border-t border-white/[0.06]">
              {result.ok ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setResult(null); }}
                    className="flex-1 py-4 text-xs font-black text-[#cbd5e1] transition-colors hover:bg-white/[0.03] hover:text-white"
                  >
                    Stay here
                  </button>
                  <button
                    type="button"
                    onClick={dismissResult}
                    className="flex-1 border-l border-white/[0.06] bg-cyan py-4 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90"
                  >
                    View Markets →
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setResult(null)}
                    className="flex-1 py-4 text-xs font-black text-[#cbd5e1] transition-colors hover:bg-white/[0.03] hover:text-white"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => { setResult(null); setShowReview(true); }}
                    className="flex-1 border-l border-white/[0.06] bg-cyan py-4 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90"
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
