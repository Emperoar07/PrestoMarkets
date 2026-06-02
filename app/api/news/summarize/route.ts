/**
 * News summarizer endpoint.
 *
 * Takes a URL, fetches the HTML server-side, extracts the article's title + meta description
 * + first paragraph, then asks the LLM fallback chain for a 2-3 sentence neutral summary
 * tied to the market context.
 */

import { NextResponse } from 'next/server';
import { callLlmJson, extractJsonObject } from '@/lib/llmFallback';
import { sanitizeFeedText } from '@/lib/feedSanitizer';
import { assertPublicHttpUrl, fetchPublicHttpUrl, isSafeHttpUrl } from '@/lib/publicUrl';

export const runtime = 'nodejs';
export const revalidate = 86400;

const MAX_BODY_BYTES = 200_000;
const MAX_REDIRECTS = 3;

const rateLimitWindowMs = 60_000;
const rateLimitMax = 30;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
    if (rateLimitStore.size > 5_000) {
      for (const [k, v] of rateLimitStore) if (now > v.resetAt) rateLimitStore.delete(k);
    }
    return true;
  }
  if (entry.count >= rateLimitMax) return false;
  entry.count++;
  return true;
}

type ExtractedPage = {
  title: string;
  description: string;
  bodySnippet: string;
};

function firstMatch(re: RegExp, html: string): string | undefined {
  const m = re.exec(html);
  return m?.[1];
}

function extractFromHtml(html: string): ExtractedPage {
  const ogTitle = firstMatch(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, html);
  const twTitle = firstMatch(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i, html);
  const tagTitle = firstMatch(/<title>([^<]+)<\/title>/i, html);
  const title = sanitizeFeedText(ogTitle || twTitle || tagTitle || '').slice(0, 200);

  const ogDesc = firstMatch(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i, html);
  const metaDesc = firstMatch(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i, html);
  const twDesc = firstMatch(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i, html);
  const description = sanitizeFeedText(ogDesc || metaDesc || twDesc || '').slice(0, 500);

  const paras: string[] = [];
  const paraRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = paraRegex.exec(html)) && paras.length < 5) {
    const text = sanitizeFeedText(m[1]);
    if (text.length > 40) paras.push(text);
  }
  const bodySnippet = paras.join(' ').slice(0, 1500);

  return { title, description, bodySnippet };
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  if (!rateLimitOk(ip)) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }

  let body: { url?: string; marketTitle?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  let url = (body.url ?? '').trim();
  if (!url || !isSafeHttpUrl(url)) {
    return NextResponse.json({ error: 'url must be a valid http(s) URL.' }, { status: 400 });
  }

  try {
    await assertPublicHttpUrl(url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Source URL is not supported.' },
      { status: 400 },
    );
  }

  let html = '';
  try {
    let res: Response | null = null;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      res = await fetchPublicHttpUrl(url, {
        headers: { 'User-Agent': 'PrestoMarketsNewsBot/1.0 (+https://presto-markets.vercel.app)' },
        maxBytes: MAX_BODY_BYTES,
      });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const location = res.headers.get('location');
      if (!location) break;
      url = new URL(location, url).toString();
      await assertPublicHttpUrl(url);
    }
    if (!res) {
      return NextResponse.json({ error: 'Could not fetch source URL.' }, { status: 502 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Source returned ${res.status}` }, { status: 502 });
    }
    const buf = await res.arrayBuffer();
    const truncated = buf.byteLength > MAX_BODY_BYTES ? buf.slice(0, MAX_BODY_BYTES) : buf;
    html = new TextDecoder('utf-8', { fatal: false }).decode(truncated);
  } catch {
    return NextResponse.json({ error: 'Could not fetch source URL.' }, { status: 502 });
  }

  const extracted = extractFromHtml(html);
  if (!extracted.title && !extracted.description && !extracted.bodySnippet) {
    return NextResponse.json({ error: 'Source page had no extractable content.' }, { status: 502 });
  }

  if (extracted.description.length >= 80) {
    return NextResponse.json(
      { title: extracted.title, summary: extracted.description, source: url, provider: 'meta-description' },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=21600' } },
    );
  }

  const marketContext = body.marketTitle ? `The reader is looking at a prediction market titled: "${body.marketTitle}". ` : '';
  const prompt = `${marketContext}Summarize this news article in 2-3 neutral sentences (max 60 words). Output JSON only:
{ "summary": "..." }

Article title: ${extracted.title}
Article body: ${extracted.bodySnippet || extracted.description}`;

  try {
    const result = await callLlmJson({ task: 'reasoning', prompt, maxTokens: 200, temperature: 0.2 });
    const parsed = extractJsonObject(result.text) as { summary?: string };
    const summary = (parsed.summary ?? '').trim();
    if (!summary) throw new Error('LLM returned empty summary');
    return NextResponse.json(
      { title: extracted.title, summary, source: url, provider: result.provider },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=21600' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        title: extracted.title,
        summary: extracted.description || extracted.bodySnippet.slice(0, 300),
        source: url,
        provider: 'extracted-fallback',
        warning: error instanceof Error ? error.message : 'summary failed',
      },
      { headers: { 'Cache-Control': 'public, s-maxage=3600' } },
    );
  }
}
