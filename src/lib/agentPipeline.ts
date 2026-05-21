/**
 * Autonomous agent pipeline: trends → classify → draft → safety → onchain
 *
 * Stage 1  Serper: fetch trending topics (no X API needed)
 * Stage 2  Groq Llama: classify momentum + market-worthiness
 * Stage 3  Gemini Flash: draft title, rules, closeDate, category
 * Stage 4  Claude Haiku: safety gate (rejects vague / defamatory / unresolvable)
 * Stage 5  agentCreateMarket: submit onchain if confidence ≥ 0.8
 */

import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import { agentCreateMarket } from './agentWallet';
import { fetchOnchainMarkets } from './onchainMarkets';
import type { CreateLiveMarketInput } from './liveActions';
import type { AgentMarketMetadata } from './marketMetadata';
import type { AppMarket } from './appState';

// ── Types ──────────────────────────────────────────────────────────────────

export type TrendItem = {
  topic: string;
  query: string;
  source: string;
  url?: string;
};

export type MarketDraft = CreateLiveMarketInput & {
  agent: AgentMarketMetadata;
};

export type PipelineResult =
  | { ok: true; topic: string; txHash: string; draft: MarketDraft }
  | { ok: false; topic: string; stage: string; reason: string };

// ── Stage 1: Trend ingestion (Serper news + Grok X live search) ────────────

async function fetchSerperTrends(): Promise<TrendItem[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'trending crypto blockchain prediction markets 2025', gl: 'us', num: 10 }),
  });

  if (!res.ok) return [];
  const data = await res.json() as {
    organic?: Array<{ title: string; snippet: string; link: string }>;
    topStories?: Array<{ title: string; link: string }>;
  };

  const items: TrendItem[] = [];
  for (const story of data.topStories ?? []) {
    items.push({ topic: story.title, query: story.title, source: 'serper-news', url: story.link });
  }
  for (const result of data.organic ?? []) {
    if (items.length >= 6) break;
    items.push({ topic: result.title, query: result.snippet, source: 'serper-web', url: result.link });
  }
  return items.slice(0, 6);
}

async function fetchGrokXTrends(): Promise<TrendItem[]> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return [];

  const prompt = `List the top 6 stories trending on X right now about crypto, AI, politics, tech, or markets that could become binary YES/NO prediction markets resolvable within 7–90 days. Return JSON only:
{
  "items": [
    { "topic": "short question-style summary, max 90 chars", "context": "one sentence context", "url": "most-cited tweet URL" }
  ]
}`;

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'grok-3-latest',
      messages: [{ role: 'user', content: prompt }],
      search_parameters: {
        mode: 'on',
        sources: [{ type: 'x' }],
        return_citations: true,
      },
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });

  if (!res.ok) return [];
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  let parsed: { items?: Array<{ topic?: string; context?: string; url?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  return (parsed.items ?? [])
    .filter((item) => typeof item.topic === 'string' && item.topic.length > 0)
    .map((item) => ({
      topic: sanitizeFeedText(item.topic!),
      query: sanitizeFeedText(item.context ?? item.topic!),
      source: 'grok-x-live',
      url: item.url,
    }))
    .slice(0, 6);
}

// Strip prompt-injection sentinels from third-party feed content before it reaches an LLM.
// RSS sources (Google News aggregates third-party titles verbatim) are an open channel where
// an attacker can plant "ignore previous instructions" style payloads. We neutralize the most
// common patterns rather than trusting downstream LLMs to ignore them.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+(instructions|prompts|context)/gi,
  /disregard\s+(all\s+)?(prior|previous|earlier)\s+(instructions|prompts|context)/gi,
  /\bsystem\s*[:>]/gi,
  /\bassistant\s*[:>]/gi,
  /<\s*\/?\s*(system|assistant|user|instructions?)\s*>/gi,
  /###+\s*(system|instruction|prompt)/gi,
  /\[\s*(system|instruction|prompt)\s*\]/gi,
];

export function sanitizeFeedText(value: string): string {
  let out = value;
  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }
  return out;
}

async function fetchRssTrends(input: { url: string; source: string; limit?: number }): Promise<TrendItem[]> {
  const res = await fetch(input.url, { headers: { 'User-Agent': 'PrestoMarketsAgent/1.0' } });
  if (!res.ok) return [];
  const xml = await res.text();
  const items: TrendItem[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const titleRegex = /<title>(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?<\/title>/i;
  const linkRegex = /<link>([^<]+)<\/link>/i;
  const descRegex = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i;
  const limit = input.limit ?? 4;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) && items.length < limit) {
    const block = match[1];
    const rawTitle = titleRegex.exec(block)?.[1]?.trim();
    const link = linkRegex.exec(block)?.[1]?.trim();
    const rawDesc = descRegex.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim();
    if (!rawTitle) continue;
    const title = sanitizeFeedText(rawTitle);
    const desc = rawDesc ? sanitizeFeedText(rawDesc) : undefined;
    items.push({ topic: title, query: desc?.slice(0, 240) ?? title, source: input.source, url: link });
  }
  return items;
}

async function fetchGoogleNewsTrends(): Promise<TrendItem[]> {
  return fetchRssTrends({
    url: 'https://news.google.com/rss?gl=US&hl=en-US&ceid=US:en',
    source: 'google-news',
    limit: 4,
  });
}

async function fetchCryptoNewsTrends(): Promise<TrendItem[]> {
  return fetchRssTrends({
    url: 'https://cointelegraph.com/rss',
    source: 'cointelegraph',
    limit: 4,
  });
}

async function fetchSportsTrends(): Promise<TrendItem[]> {
  return fetchRssTrends({
    url: 'https://www.espn.com/espn/rss/news',
    source: 'espn',
    limit: 3,
  });
}

function interleave(...lists: TrendItem[][]): TrendItem[] {
  const out: TrendItem[] = [];
  const max = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (list[i]) out.push(list[i]);
    }
  }
  return out;
}

async function fetchTrends(): Promise<TrendItem[]> {
  const [grokX, googleNews, cryptoNews, sports, serper] = await Promise.all([
    fetchGrokXTrends().catch(() => [] as TrendItem[]),
    fetchGoogleNewsTrends().catch(() => [] as TrendItem[]),
    fetchCryptoNewsTrends().catch(() => [] as TrendItem[]),
    fetchSportsTrends().catch(() => [] as TrendItem[]),
    fetchSerperTrends().catch(() => [] as TrendItem[]),
  ]);
  const merged = interleave(grokX, googleNews, cryptoNews, sports, serper);
  if (merged.length === 0) {
    throw new Error('No trend sources returned items. Check XAI_API_KEY, SERPER_API_KEY, or network access to RSS feeds.');
  }
  return merged.slice(0, 14);
}

// ── Stage 2: Groq classification ──────────────────────────────────────────

type GroqClassification = {
  worthy: boolean;
  momentumScore: number;
  category: string;
  reason: string;
};

async function classifyWithGroq(trend: TrendItem): Promise<GroqClassification> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const groq = new Groq({ apiKey });

  const prompt = `You are a prediction market analyst. Evaluate this topic for market creation.

Topic: "${trend.topic}"
Context: "${trend.query}"

A good prediction market topic:
- Has a clear YES/NO binary outcome
- Is resolvable within 7–90 days using public sources
- Has measurable stakes (crypto price, regulatory decision, product launch, election, etc.)
- Is NOT defamatory, hate speech, or about personal harm

Return JSON only:
{
  "worthy": true/false,
  "momentumScore": 0.0–1.0,
  "category": "Crypto|DeFi|AI|Politics|Tech|Sports|Markets|Arc|Web3",
  "reason": "one sentence"
}`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 256,
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as Partial<GroqClassification>;

  return {
    worthy: parsed.worthy ?? false,
    momentumScore: Math.min(1, Math.max(0, parsed.momentumScore ?? 0)),
    category: parsed.category ?? 'Crypto',
    reason: parsed.reason ?? '',
  };
}

// ── Stage 3: Gemini Flash market drafting ─────────────────────────────────

type GeminiDraft = {
  title: string;
  description: string;
  rules: string;
  sourceOfTruth: string;
  closeDate: string;
  type: 'Prediction' | 'Opinion' | 'Opportunity';
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeUrl(value?: string) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function isDuplicateMarket(draft: GeminiDraft, trend: TrendItem, existingMarkets: AppMarket[]) {
  const draftTitle = normalizeText(draft.title);
  const trendUrl = normalizeUrl(trend.url);

  return existingMarkets.some((market) => {
    if (market.status === 'Resolved' || market.status === 'Canceled') return false;

    const existingTitle = normalizeText(market.title);
    if (existingTitle === draftTitle) return true;
    if (existingTitle.includes(draftTitle) || draftTitle.includes(existingTitle)) return true;

    const existingTrendUrl = normalizeUrl(market.trendUrl);
    if (trendUrl && existingTrendUrl && trendUrl === existingTrendUrl) return true;

    return false;
  });
}

async function draftWithGemini(trend: TrendItem, category: string): Promise<GeminiDraft> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const now = new Date();
  const closeDate30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const closeDate7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const prompt = `You are a prediction market designer. Create a binary YES/NO market from this trend.

Topic: "${trend.topic}"
Context: "${trend.query}"
Category: "${category}"

Rules for a good market:
- Title must be a clear YES/NO question under 90 characters
- Rules must define exactly when YES wins and when NO wins
- Source of truth must be a specific verifiable public source
- Close date should be ${closeDate7} for fast-moving news or ${closeDate30} for slower events
- Type: "Prediction" for binary events, "Opinion" for community preference, "Opportunity" for opportunity sizing

Return JSON only:
{
  "title": "...",
  "description": "one sentence description",
  "rules": "YES wins if... Otherwise NO wins.",
  "sourceOfTruth": "specific public source (e.g. CoinGecko, official announcement, SEC filing)",
  "closeDate": "YYYY-MM-DD",
  "type": "Prediction|Opinion|Opportunity"
}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 512 },
  });

  const raw = result.response.text();
  const parsed = JSON.parse(raw) as Partial<GeminiDraft>;

  if (!parsed.title || !parsed.rules || !parsed.sourceOfTruth || !parsed.closeDate) {
    throw new Error('Gemini returned incomplete draft');
  }

  return {
    title: parsed.title,
    description: parsed.description ?? parsed.title,
    rules: parsed.rules,
    sourceOfTruth: parsed.sourceOfTruth,
    closeDate: parsed.closeDate,
    type: (parsed.type as GeminiDraft['type']) ?? 'Prediction',
  };
}

// ── Stage 4: Claude Haiku safety gate ─────────────────────────────────────

type SafetyResult = {
  pass: boolean;
  confidence: number;
  reason: string;
};

async function safetyCheckWithHaiku(draft: GeminiDraft): Promise<SafetyResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are a safety reviewer for a prediction market platform. Evaluate this market draft.

Title: "${draft.title}"
Rules: "${draft.rules}"
Source of truth: "${draft.sourceOfTruth}"
Close date: "${draft.closeDate}"

Reject if ANY of:
- Outcome is unverifiable or depends on private information
- Title is ambiguous (multiple valid interpretations)
- Rules do not clearly define when YES vs NO wins
- Source of truth is vague ("social media", "general news")
- Close date is in the past or more than 180 days away
- Content is defamatory, harmful, or targets a private individual
- Market is about illegal activity

Return JSON only:
{
  "pass": true/false,
  "confidence": 0.0–1.0,
  "reason": "one sentence"
}`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0]?.type === 'text' ? message.content[0].text : '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? '{}') as Partial<SafetyResult>;

  return {
    pass: parsed.pass ?? false,
    confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0)),
    reason: parsed.reason ?? '',
  };
}

// ── Stage 5: Onchain creation ──────────────────────────────────────────────

async function createOnchain(
  draft: GeminiDraft,
  trend: TrendItem,
  classification: GroqClassification,
  safety: SafetyResult,
): Promise<PipelineResult> {
  const agentConfidence = String(Math.round(safety.confidence * 100)) + '%';
  const input: MarketDraft = {
    type: draft.type,
    title: draft.title,
    description: draft.description,
    category: classification.category,
    closeDate: draft.closeDate,
    rules: draft.rules,
    sourceOfTruth: draft.sourceOfTruth,
    resolver: 'Presto Agent',
    resolutionMode: 'Agent assisted',
    agent: {
      createdByType: 'agent',
      agentName: 'Presto Agent',
      agentSource: trend.source,
      agentModel: trend.source === 'grok-x-live'
        ? 'grok-x-live+groq-llama3+gemini-flash+claude-haiku'
        : 'groq-llama3+gemini-flash+claude-haiku',
      agentConfidence,
      agentReason: `${classification.reason} | Safety: ${safety.reason}`,
      trendSource: trend.source,
      trendUrl: trend.url,
      momentumScore: Math.round(classification.momentumScore * 100), // stored as 0-100 to match trends route
      safetyScore: Math.round(safety.confidence * 100),              // stored as 0-100 to match trends route
    },
  };

  const result = await agentCreateMarket(input);

  if (!result.ok) {
    return { ok: false, topic: trend.topic, stage: 'onchain', reason: result.error ?? 'Unknown' };
  }

  return { ok: true, topic: trend.topic, txHash: result.txHash as string, draft: input };
}

// ── Main pipeline ──────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.8;

export async function runAgentPipeline(): Promise<PipelineResult[]> {
  const trends = await fetchTrends();
  const existingMarkets = await fetchOnchainMarkets().catch(() => []);
  const results: PipelineResult[] = [];

  for (const trend of trends) {
    try {
      // Stage 2: classify
      const classification = await classifyWithGroq(trend);
      if (!classification.worthy || classification.momentumScore < 0.5) {
        results.push({ ok: false, topic: trend.topic, stage: 'classify', reason: classification.reason });
        continue;
      }

      // Stage 3: draft
      let draft: GeminiDraft;
      try {
        draft = await draftWithGemini(trend, classification.category);
      } catch (e) {
        results.push({ ok: false, topic: trend.topic, stage: 'draft', reason: String(e) });
        continue;
      }

      if (isDuplicateMarket(draft, trend, existingMarkets)) {
        results.push({ ok: false, topic: trend.topic, stage: 'duplicate', reason: 'Similar active market or trend source already exists.' });
        continue;
      }

      // Stage 4: safety
      const safety = await safetyCheckWithHaiku(draft);
      if (!safety.pass || safety.confidence < CONFIDENCE_THRESHOLD) {
        results.push({ ok: false, topic: trend.topic, stage: 'safety', reason: safety.reason });
        continue;
      }

      // Stage 5: onchain
      const result = await createOnchain(draft, trend, classification, safety);
      results.push(result);
    } catch (e) {
      results.push({ ok: false, topic: trend.topic, stage: 'pipeline', reason: String(e) });
    }
  }

  return results;
}
