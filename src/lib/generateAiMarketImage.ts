import { logger } from './logger';

// sharp is a NATIVE Node addon that cannot load on Cloudflare workerd — a static top-level import
// throws at module-eval and 500s the whole route before it even runs (this crashed the
// market-factory cron). Load it lazily instead: Node (local dev, the off-Worker harvest) gets the
// real compressor; the Worker catches the load failure and serves the provider image un-resized.
type SharpFactory = typeof import('sharp');
let sharpModule: SharpFactory | null | undefined;
async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    // sharp is `export =` (CJS); under esModuleInterop the callable may arrive as `.default` or as
    // the namespace itself, so accept either.
    const mod = (await import('sharp')) as SharpFactory & { default?: SharpFactory };
    sharpModule = mod.default ?? mod;
  } catch {
    sharpModule = null; // native module unavailable (e.g. Cloudflare Workers) — caller falls back
  }
  return sharpModule;
}

// AI image generation for markets that have no real subject image (flag/coin/crest/article photo).
// Instead of falling back to a generic branded banner, the agent generates a relevant illustration
// from the market's own context, then compresses it to a compact JPEG data-URI. hasGoodImage()
// treats a real data-image as good, so it flows through the existing override storage + onchain
// merge unchanged. Returns null on any failure so callers fall back to the branded banner.
//
// Provider chain (first that returns an image wins) — all key-based or keyless, none paid-required:
//   1. Gemini image      (GEMINI_API_KEY)            — best quality; needs image quota/billing.
//   2. Cloudflare WorkersAI (CF_ACCOUNT_ID+CF_API_TOKEN) — generous free tier, fast FLUX-schnell.
//   3. Together FLUX     (TOGETHER_API_KEY)          — needs account credit.
//   4. Pollinations.ai   (no key at all)             — free community FLUX; the always-on fallback.

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-2.5-flash-image';
const TOGETHER_IMAGE_MODEL = process.env.TOGETHER_IMAGE_MODEL?.trim() || 'black-forest-labs/FLUX.1-schnell-Free';
const CF_IMAGE_MODEL = process.env.CF_IMAGE_MODEL?.trim() || '@cf/black-forest-labs/flux-1-schnell';

function buildPrompt(title: string, category?: string): string {
  // Image models render text as garbled glyphs, so explicitly forbid words/letters and ask for a
  // single clear subject — a clean editorial illustration that reads at thumbnail size on a card.
  const isCrypto = /crypto|bitcoin|btc|eth|token|coin|defi|blockchain/i.test(`${title} ${category ?? ''}`);
  return [
    `Editorial cover illustration for a prediction market titled "${title}".`,
    category ? `Topic area: ${category}.` : '',
    // Real coin marks come from CoinGecko upstream; the model must never IMITATE one — a wrong or
    // distorted logo looks worse than no logo. Ask for a narrative market scene instead.
    isCrypto
      ? 'Depict an abstract financial scene that fits the question (rising or falling glowing price chart, candlesticks, market energy) — do NOT draw or imitate any cryptocurrency coin logo or brand mark.'
      : '',
    'Modern, clean, professional flat/vector style with vivid but tasteful colors and a single clear',
    'centered subject relevant to the topic. No text, no words, no letters, no numbers, no logos,',
    'no watermark, no captions, no UI.',
  ].filter(Boolean).join(' ');
}

// Gemini image generation (gemini-2.5-flash-image et al.) via generateContent → inline image bytes.
async function generateWithGemini(prompt: string): Promise<Buffer | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(35_000),
      },
    );
    if (!res.ok) { logger.warn('ai-image', `Gemini image gen failed (${res.status})`); return null; }
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }> } }>;
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const b64 = parts.map((p) => p.inlineData?.data ?? p.inline_data?.data).find(Boolean);
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch (err) {
    logger.warn('ai-image', 'Gemini image gen error', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// Cloudflare Workers AI — free tier, FLUX-schnell returns base64 JPEG in result.image.
async function generateWithCloudflare(prompt: string): Promise<Buffer | null> {
  const account = process.env.CF_ACCOUNT_ID?.trim();
  const token = process.env.CF_API_TOKEN?.trim();
  if (!account || !token) return null;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${CF_IMAGE_MODEL}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt, steps: 4 }),
        signal: AbortSignal.timeout(35_000),
      },
    );
    if (!res.ok) { logger.warn('ai-image', `Cloudflare image gen failed (${res.status})`); return null; }
    // flux-1-schnell returns JSON { result: { image: "<base64>" } }; some models return raw bytes.
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const data = await res.json() as { result?: { image?: string } };
      const b64 = data.result?.image;
      return b64 ? Buffer.from(b64, 'base64') : null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch (err) {
    logger.warn('ai-image', 'Cloudflare image gen error', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// Together FLUX → base64 (or a short-lived URL we then fetch).
async function generateWithTogether(prompt: string): Promise<Buffer | null> {
  const key = process.env.TOGETHER_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: TOGETHER_IMAGE_MODEL, prompt, width: 1024, height: 768, steps: 4, n: 1, response_format: 'b64_json' }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!res.ok) { logger.warn('ai-image', `Together image gen failed (${res.status})`); return null; }
    const data = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = data.data?.[0];
    if (first?.b64_json) return Buffer.from(first.b64_json, 'base64');
    if (first?.url) {
      const img = await fetch(first.url, { signal: AbortSignal.timeout(15_000) });
      if (img.ok) return Buffer.from(await img.arrayBuffer());
    }
    return null;
  } catch (err) {
    logger.warn('ai-image', 'Together image gen error', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// Pollinations.ai — keyless free FLUX. GET the prompt URL; it returns image bytes directly. Set
// POLLINATIONS_DISABLED=1 to turn off (it's a community service). Always-on last resort.
async function generateWithPollinations(prompt: string): Promise<Buffer | null> {
  if (process.env.POLLINATIONS_DISABLED === '1') return null;
  try {
    const seed = Math.floor(Math.random() * 1_000_000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`
      + `?width=1024&height=768&nologo=true&model=flux&seed=${seed}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(40_000) });
    if (!res.ok) { logger.warn('ai-image', `Pollinations image gen failed (${res.status})`); return null; }
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 1024 ? buf : null;
  } catch (err) {
    logger.warn('ai-image', 'Pollinations image gen error', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Generate a relevant market image from its context. Returns a compact JPEG data-URI, or null. */
export async function generateAiMarketImage(input: { title: string; category?: string }): Promise<string | null> {
  if (!input.title?.trim()) return null;
  const prompt = buildPrompt(input.title, input.category);

  const raw = (await generateWithGemini(prompt))
    ?? (await generateWithCloudflare(prompt))
    ?? (await generateWithTogether(prompt))
    ?? (await generateWithPollinations(prompt));
  if (!raw || raw.length === 0) return null;

  const sharpFn = await loadSharp();
  if (sharpFn) {
    try {
      // Compress to a small 4:3 JPEG so the data-URI stays light (it lives in the DB override and in
      // the /api/markets payload). ~640x480 q72 keeps it well under ~60KB.
      const jpeg = await sharpFn(raw).resize(640, 480, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch (err) {
      logger.warn('ai-image', 'image compress failed', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  // No sharp (Cloudflare Workers): can't resize. Most providers already return a compact ~1024px
  // JPEG, so use it as-is when it's light enough for the override row + /api/markets payload;
  // otherwise skip and let the branded banner stand (the image-backfill cron fills a proper
  // compressed image off-Worker later). ~180KB keeps a single override well within the slim budget.
  const RAW_DATA_URI_MAX_BYTES = 180 * 1024;
  if (raw.length > RAW_DATA_URI_MAX_BYTES) return null;
  const mime = detectImageMime(raw);
  if (!mime) return null;
  return `data:${mime};base64,${raw.toString('base64')}`;
}

// Minimal magic-byte sniff so the un-resized fallback emits a correct data-URI mime.
function detectImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}
