import sharp from 'sharp';
import { logger } from './logger';

// AI image generation for markets that have no real subject image (flag/coin/crest/article photo).
// Instead of falling back to a generic branded banner, the agent generates a relevant illustration
// from the market's own context, then compresses it to a compact JPEG data-URI. hasGoodImage()
// treats a real data-image as good, so it flows through the existing override storage + onchain
// merge unchanged. Tries Gemini image first (the project already pays for Gemini), then Together
// FLUX. Returns null on any failure so callers fall back to the branded banner — no regression.

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-2.5-flash-image';
const TOGETHER_IMAGE_MODEL = process.env.TOGETHER_IMAGE_MODEL?.trim() || 'black-forest-labs/FLUX.1-schnell-Free';

function buildPrompt(title: string, category?: string): string {
  // Image models render text as garbled glyphs, so explicitly forbid words/letters and ask for a
  // single clear subject — a clean editorial illustration that reads at thumbnail size on a card.
  return [
    `Editorial cover illustration for a prediction market titled "${title}".`,
    category ? `Topic area: ${category}.` : '',
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
    if (!res.ok) {
      logger.warn('ai-image', `Gemini image gen failed (${res.status})`);
      return null;
    }
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

// Together FLUX fallback → base64 (or a short-lived URL we then fetch).
async function generateWithTogether(prompt: string): Promise<Buffer | null> {
  const key = process.env.TOGETHER_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: TOGETHER_IMAGE_MODEL,
        prompt,
        width: 1024,
        height: 768,
        steps: 4, // FLUX-schnell is a 1–4 step model
        n: 1,
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!res.ok) {
      logger.warn('ai-image', `Together image gen failed (${res.status})`);
      return null;
    }
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

/** Generate a relevant market image from its context. Returns a compact JPEG data-URI, or null. */
export async function generateAiMarketImage(input: { title: string; category?: string }): Promise<string | null> {
  if (!input.title?.trim()) return null;
  const prompt = buildPrompt(input.title, input.category);

  const raw = (await generateWithGemini(prompt)) ?? (await generateWithTogether(prompt));
  if (!raw || raw.length === 0) return null;

  try {
    // Compress to a small 4:3 JPEG so the data-URI stays light (it lives in the DB override and in
    // the /api/markets payload). ~640x480 q72 keeps it well under ~60KB.
    const jpeg = await sharp(raw).resize(640, 480, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch (err) {
    logger.warn('ai-image', 'image compress failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
