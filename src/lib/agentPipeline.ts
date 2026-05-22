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
import { agentCreateMarket } from './agentWallet';
import { callLlmJson, extractJsonObject } from './llmFallback';
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
  imageUrl?: string;
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
  const mediaRegex = /<(?:media:content|media:thumbnail)\b[^>]*url=["']([^"']+)["'][^>]*>/i;
  const enclosureRegex = /<enclosure\b[^>]*url=["']([^"']+)["'][^>]*type=["']image\/[^"']+["'][^>]*>/i;
  const limit = input.limit ?? 4;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) && items.length < limit) {
    const block = match[1];
    const rawTitle = titleRegex.exec(block)?.[1]?.trim();
    const link = linkRegex.exec(block)?.[1]?.trim();
    const rawDesc = descRegex.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim();
    const imageUrl = mediaRegex.exec(block)?.[1]?.trim() ?? enclosureRegex.exec(block)?.[1]?.trim();
    if (!rawTitle) continue;
    const title = sanitizeFeedText(rawTitle);
    const desc = rawDesc ? sanitizeFeedText(rawDesc) : undefined;
    items.push({ topic: title, query: desc?.slice(0, 240) ?? title, source: input.source, url: link, imageUrl });
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

const cryptoPriceAssets = [
  { id: 'bitcoin', cmcSymbol: 'BTC', symbol: 'BTC', category: 'BTC', threshold: 0.035 },
  { id: 'ethereum', cmcSymbol: 'ETH', symbol: 'ETH', category: 'ETH', threshold: 0.045 },
  { id: 'solana', cmcSymbol: 'SOL', symbol: 'SOL', category: 'SOL', threshold: 0.06 },
  { id: 'polygon-ecosystem-token', cmcSymbol: 'POL', symbol: 'POL', category: 'POL', threshold: 0.065 },
] as const;

function buildCryptoPriceSignal(input: {
  symbol: string;
  id: string;
  provider: string;
  source: string;
  price: number;
  change?: number;
  threshold: number;
  url: string;
}): TrendItem {
  const settleDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const settleLabel = settleDate.toISOString().slice(0, 10);
  const direction = (input.change ?? 0) >= 0 ? 'above' : 'below';
  const target = direction === 'above'
    ? Math.ceil(input.price * (1 + input.threshold))
    : Math.floor(input.price * (1 - input.threshold));
  const formattedPrice = `$${input.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const formattedTarget = `$${target.toLocaleString()}`;

  return {
    topic: `Will ${input.symbol} trade ${direction} ${formattedTarget} by ${settleLabel}?`,
    query: [
      `${input.symbol} current ${input.provider} price is ${formattedPrice}.`,
      Number.isFinite(input.change) ? `24h change is ${(input.change as number).toFixed(2)}%.` : '',
      `Create an objective price prediction market using ${input.provider} ${input.id} USD price as source of truth.`,
    ].filter(Boolean).join(' '),
    source: input.source,
    url: input.url,
  };
}

async function fetchCoinGeckoPriceSignals(): Promise<TrendItem[]> {
  const ids = cryptoPriceAssets.map((asset) => asset.id).join(',');
  const apiKey = process.env.COINGECKO_API_KEY || process.env.NEXT_PUBLIC_COINGECKO_API_KEY;
  const headers: HeadersInit = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
    {
      headers,
      next: { revalidate: 300 },
    },
  );

  if (!res.ok) return [];
  const data = await res.json() as Record<string, { usd?: number; usd_24h_change?: number; last_updated_at?: number }>;

  return cryptoPriceAssets.flatMap((asset) => {
    const price = data[asset.id]?.usd;
    if (!Number.isFinite(price)) return [];
    return [buildCryptoPriceSignal({
      symbol: asset.symbol,
      id: asset.id,
      provider: 'CoinGecko',
      source: 'coingecko-price',
      price: price as number,
      change: data[asset.id]?.usd_24h_change,
      threshold: asset.threshold,
      url: `https://www.coingecko.com/en/coins/${asset.id}`,
    })];
  });
}

async function fetchCoinMarketCapPriceSignals(): Promise<TrendItem[]> {
  const apiKey = process.env.COINMARKETCAP_API_KEY || process.env.CMC_API_KEY;
  if (!apiKey) return [];

  const symbols = cryptoPriceAssets.map((asset) => asset.cmcSymbol).join(',');
  const res = await fetch(
    `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${symbols}&convert=USD`,
    {
      headers: { 'X-CMC_PRO_API_KEY': apiKey },
      next: { revalidate: 300 },
    },
  );
  if (!res.ok) return [];

  const data = await res.json() as {
    data?: Record<string, Array<{
      slug?: string;
      quote?: { USD?: { price?: number; percent_change_24h?: number } };
    }> | {
      slug?: string;
      quote?: { USD?: { price?: number; percent_change_24h?: number } };
    }>;
  };

  return cryptoPriceAssets.flatMap((asset) => {
    const raw = data.data?.[asset.cmcSymbol];
    const item = Array.isArray(raw) ? raw[0] : raw;
    const quote = item?.quote?.USD;
    if (!Number.isFinite(quote?.price)) return [];

    return [buildCryptoPriceSignal({
      symbol: asset.symbol,
      id: item?.slug || asset.id,
      provider: 'CoinMarketCap',
      source: 'coinmarketcap-price',
      price: quote?.price as number,
      change: quote?.percent_change_24h,
      threshold: asset.threshold,
      url: `https://coinmarketcap.com/currencies/${item?.slug || asset.id}/`,
    })];
  });
}

async function fetchCryptoPriceSignals(): Promise<TrendItem[]> {
  const [coinGecko, coinMarketCap] = await Promise.all([
    fetchCoinGeckoPriceSignals().catch(() => [] as TrendItem[]),
    fetchCoinMarketCapPriceSignals().catch(() => [] as TrendItem[]),
  ]);

  // Prefer no-key CoinGecko when available, then fill gaps from CoinMarketCap.
  const seen = new Set<string>();
  return [...coinGecko, ...coinMarketCap].filter((item) => {
    const symbol = cryptoPriceAssets.find((asset) => item.topic.includes(asset.symbol))?.symbol ?? item.topic;
    if (seen.has(symbol)) return false;
    seen.add(symbol);
    return true;
  });
}

async function fetchSportsTrends(): Promise<TrendItem[]> {
  return fetchRssTrends({
    url: 'https://www.espn.com/espn/rss/news',
    source: 'espn',
    limit: 3,
  });
}

const sportsDbSports = [
  { sport: 'Soccer', category: 'Football', source: 'thesportsdb-football' },
  { sport: 'Basketball', category: 'Basketball', source: 'thesportsdb-basketball' },
  { sport: 'Tennis', category: 'Tennis', source: 'thesportsdb-tennis' },
] as const;

function formatSportsDbDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function fetchSportsScoreSignals(): Promise<TrendItem[]> {
  const apiKey = process.env.THESPORTSDB_API_KEY || '123';
  const dates = [new Date(), new Date(Date.now() + 24 * 60 * 60 * 1000)];
  const requests = sportsDbSports.flatMap((sport) => dates.map(async (date) => {
    const day = formatSportsDbDate(date);
    const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsday.php?d=${day}&s=${encodeURIComponent(sport.sport)}`;
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return [] as TrendItem[];
    const data = await res.json() as {
      events?: Array<{
        idEvent?: string;
        strEvent?: string;
        strHomeTeam?: string;
        strAwayTeam?: string;
        intHomeScore?: string | null;
        intAwayScore?: string | null;
        strStatus?: string | null;
        dateEvent?: string;
        strTimestamp?: string;
        strThumb?: string | null;
      }>;
    };

    return (data.events ?? []).slice(0, 3).flatMap((event): TrendItem[] => {
      const home = sanitizeFeedText(event.strHomeTeam || '');
      const away = sanitizeFeedText(event.strAwayTeam || '');
      if (!home || !away) return [];
      const score = event.intHomeScore && event.intAwayScore
        ? `${event.intHomeScore}-${event.intAwayScore}`
        : 'not started';
      const status = event.strStatus || 'scheduled';
      const eventDate = event.dateEvent || day;

      return [{
        topic: `Will ${home} beat ${away} on ${eventDate}?`,
        query: [
          `${sport.category} fixture from TheSportsDB.`,
          `Match: ${home} vs ${away}.`,
          `Current score/status: ${score}, ${status}.`,
          'Create a market that resolves from the final official match result.',
        ].join(' '),
        source: sport.source,
        url: event.idEvent ? `https://www.thesportsdb.com/event/${event.idEvent}` : undefined,
        imageUrl: event.strThumb || undefined,
      }];
    });
  }));

  const batches = await Promise.all(requests);
  return batches.flat().slice(0, 9);
}

async function fetchLiveScoreFootballSignals(): Promise<TrendItem[]> {
  const key = process.env.LIVESCORE_API_KEY;
  const secret = process.env.LIVESCORE_API_SECRET;
  if (!key || !secret) return [];

  const res = await fetch(
    `https://livescore-api.com/api-client/matches/live.json?key=${encodeURIComponent(key)}&secret=${encodeURIComponent(secret)}`,
    { next: { revalidate: 120 } },
  );
  if (!res.ok) return [];

  const data = await res.json() as {
    data?: {
      match?: Array<{
        id?: number;
        status?: string;
        scheduled?: string;
        home?: { name?: string; logo?: string };
        away?: { name?: string; logo?: string };
        scores?: { score?: string };
      }>;
    };
  };

  return (data.data?.match ?? []).slice(0, 6).flatMap((match): TrendItem[] => {
    const home = sanitizeFeedText(match.home?.name || '');
    const away = sanitizeFeedText(match.away?.name || '');
    if (!home || !away) return [];

    return [{
      topic: `Will ${home} beat ${away} in their live match?`,
      query: [
        'Football live score from LiveScore API.',
        `Match: ${home} vs ${away}.`,
        `Current score/status: ${match.scores?.score || 'unknown'}, ${match.status || 'live'}.`,
        'Create a market that resolves from the final official match result.',
      ].join(' '),
      source: 'livescore-api-football',
      url: match.id ? `https://livescore-api.com/api-client/scores/events.json?id=${match.id}` : undefined,
      imageUrl: match.home?.logo || match.away?.logo,
    }];
  });
}

async function fetchSportDbSignals(): Promise<TrendItem[]> {
  const apiKey = process.env.SPORTDB_API_KEY;
  if (!apiKey) return [];

  const endpoints = [
    { url: 'https://api.sportdb.dev/api/football/live', category: 'Football', source: 'sportdb-football' },
    { url: 'https://api.sportdb.dev/api/basketball/live', category: 'Basketball', source: 'sportdb-basketball' },
  ] as const;

  const batches = await Promise.all(endpoints.map(async (endpoint) => {
    const res = await fetch(endpoint.url, {
      headers: { 'X-API-Key': apiKey },
      next: { revalidate: 120 },
    });
    if (!res.ok) return [] as TrendItem[];

    const data = await res.json() as {
      data?: unknown[];
      matches?: unknown[];
      events?: unknown[];
    };
    const rows = (data.data ?? data.matches ?? data.events ?? []) as Array<Record<string, unknown>>;

    return rows.slice(0, 5).flatMap((row): TrendItem[] => {
      const home = sanitizeFeedText(String(row.home_team ?? row.homeTeam ?? row.home ?? row.team_home ?? ''));
      const away = sanitizeFeedText(String(row.away_team ?? row.awayTeam ?? row.away ?? row.team_away ?? ''));
      if (!home || !away || home === 'undefined' || away === 'undefined') return [];
      const status = String(row.status ?? row.match_status ?? 'live');
      const score = String(row.score ?? row.current_score ?? `${row.home_score ?? '?'}-${row.away_score ?? '?'}`);
      const eventId = String(row.id ?? row.event_id ?? '');

      return [{
        topic: `Will ${home} beat ${away} in their live ${endpoint.category.toLowerCase()} match?`,
        query: [
          `${endpoint.category} live score from SportDB.`,
          `Match: ${home} vs ${away}.`,
          `Current score/status: ${score}, ${status}.`,
          'Create a market that resolves from the final official match result.',
        ].join(' '),
        source: endpoint.source,
        url: eventId ? `${endpoint.url}/${eventId}` : endpoint.url,
      }];
    });
  }));

  return batches.flat().slice(0, 8);
}

async function fetchDecryptTrends(): Promise<TrendItem[]> {
  return fetchRssTrends({
    url: 'https://decrypt.co/feed',
    source: 'decrypt',
    limit: 3,
  });
}

async function fetchTheBlockTrends(): Promise<TrendItem[]> {
  return fetchRssTrends({
    url: 'https://www.theblock.co/rss.xml',
    source: 'theblock',
    limit: 3,
  });
}

async function fetchTechCrunchTrends(): Promise<TrendItem[]> {
  return fetchRssTrends({
    url: 'https://techcrunch.com/feed/',
    source: 'techcrunch',
    limit: 3,
  });
}

async function fetchHackerNewsTrends(): Promise<TrendItem[]> {
  return fetchRssTrends({
    url: 'https://hnrss.org/frontpage',
    source: 'hackernews',
    limit: 3,
  });
}

async function fetchBbcTrends(): Promise<TrendItem[]> {
  return fetchRssTrends({
    url: 'http://feeds.bbci.co.uk/news/rss.xml',
    source: 'bbc',
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

// Top 3 breaking-news items the homepage panel surfaces with the "Agent pick" badge. We
// fetch the same crypto-first RSS feeds the /api/news/breaking endpoint ranks, sort by
// recency, and prepend the freshest 3 so they're the first trends the per-run cap targets.
async function fetchBreakingNewsPriority(): Promise<TrendItem[]> {
  const sources = await Promise.all([
    fetchCryptoNewsTrends().catch(() => [] as TrendItem[]),
    fetchDecryptTrends().catch(() => [] as TrendItem[]),
    fetchTheBlockTrends().catch(() => [] as TrendItem[]),
  ]);
  const flat = sources.flat();
  // The RSS parser doesn't expose pubDate yet; the items come back already ordered by
  // recency per outlet, so interleaving across outlets approximates a recency mix.
  const seen = new Set<string>();
  const out: TrendItem[] = [];
  outer: for (let i = 0; i < 5; i++) {
    for (const list of sources) {
      const item = list[i];
      if (!item) continue;
      const key = item.topic.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, source: `breaking-${item.source}` });
      if (out.length >= 3) break outer;
    }
  }
  return out;
}

async function fetchTrends(): Promise<TrendItem[]> {
  const [breaking, grokX, cryptoPrices, sportsScores, liveScoreFootball, sportDb, googleNews, cryptoNews, decrypt, theBlock, techCrunch, hackerNews, bbc, sports, serper] = await Promise.all([
    fetchBreakingNewsPriority().catch(() => [] as TrendItem[]),
    fetchGrokXTrends().catch(() => [] as TrendItem[]),
    fetchCryptoPriceSignals().catch(() => [] as TrendItem[]),
    fetchSportsScoreSignals().catch(() => [] as TrendItem[]),
    fetchLiveScoreFootballSignals().catch(() => [] as TrendItem[]),
    fetchSportDbSignals().catch(() => [] as TrendItem[]),
    fetchGoogleNewsTrends().catch(() => [] as TrendItem[]),
    fetchCryptoNewsTrends().catch(() => [] as TrendItem[]),
    fetchDecryptTrends().catch(() => [] as TrendItem[]),
    fetchTheBlockTrends().catch(() => [] as TrendItem[]),
    fetchTechCrunchTrends().catch(() => [] as TrendItem[]),
    fetchHackerNewsTrends().catch(() => [] as TrendItem[]),
    fetchBbcTrends().catch(() => [] as TrendItem[]),
    fetchSportsTrends().catch(() => [] as TrendItem[]),
    fetchSerperTrends().catch(() => [] as TrendItem[]),
  ]);
  // Breaking news goes FIRST so under per-run cap=1 the agent's daily creation is always
  // tied to a story the homepage news panel is also surfacing. The rest interleaves across
  // X social signal, live price/sports signals, general news, tech, sports, search-derived.
  const interleaved = interleave(grokX, cryptoPrices, sportsScores, liveScoreFootball, sportDb, googleNews, cryptoNews, decrypt, theBlock, techCrunch, hackerNews, bbc, sports, serper);
  const merged = [...breaking, ...interleaved];
  if (merged.length === 0) {
    throw new Error('No trend sources returned items. Check XAI_API_KEY, SERPER_API_KEY, or network access to the RSS feeds.');
  }
  return merged.slice(0, 24);
}

// ── Stage 2: Groq classification ──────────────────────────────────────────

type GroqClassification = {
  worthy: boolean;
  momentumScore: number;
  category: string;
  categories?: string[];
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
  "category": "Crypto|BTC|ETH|SOL|POL|Sports|Football|Basketball|Tennis|DeFi|AI|Politics|Tech|Markets|Arc|Web3",
  "categories": ["primary", "secondary", "..."],
  "reason": "one sentence"
}

For "categories": return 1-4 tags from the same allowlist as "category". Use BTC, ETH, SOL,
or POL for token-specific price markets. Use Football, Basketball, or Tennis for sport result
markets. The first should
equal "category". Add secondary tags only if they're genuinely relevant (e.g. a Bitcoin ETF
ruling could be ["Crypto", "Markets", "Politics"]).`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 320,
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as Partial<GroqClassification> & { categories?: unknown };

  let categories: string[] | undefined;
  if (Array.isArray(parsed.categories)) {
    categories = parsed.categories
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 4);
  }

  return {
    worthy: parsed.worthy ?? false,
    momentumScore: Math.min(1, Math.max(0, parsed.momentumScore ?? 0)),
    category: parsed.category ?? categories?.[0] ?? 'Crypto',
    categories,
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
  /** When the question is non-binary (e.g. "which of these will happen first?"), the drafter
   * may return 2-6 outcome labels and the contract treats it as a poll. Empty / undefined
   * keeps the default binary YES/NO behavior. */
  outcomeOptions?: string[];
};

function isSafeHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function absolutizeUrl(value: string, base: string): string | undefined {
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

async function fetchTrendImageURI(trend: TrendItem): Promise<string | undefined> {
  if (isSafeHttpUrl(trend.imageUrl)) return trend.imageUrl;
  if (!isSafeHttpUrl(trend.url)) return undefined;

  try {
    const res = await fetch(trend.url, {
      headers: { 'User-Agent': 'PrestoMarketsAgent/1.0' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return undefined;

    const html = (await res.text()).slice(0, 500_000);
    const patterns = [
      /<meta\b[^>]*(?:property|name)=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/i,
      /<meta\b[^>]*(?:property|name)=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']twitter:image["'][^>]*>/i,
    ];

    for (const pattern of patterns) {
      const raw = pattern.exec(html)?.[1];
      if (!raw) continue;
      const image = absolutizeUrl(raw, trend.url);
      if (isSafeHttpUrl(image)) return image;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

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
  // Function name kept for git history; the model is whichever provider in the fallback
  // chain (Anthropic -> Groq -> OpenRouter -> Cerebras -> Together) responds first. Direct
  // Gemini was a single point of failure: free-tier quota on some Google Cloud projects
  // is allocated as 0, returning 429 'limit: 0' indefinitely.
  const now = new Date();
  const closeDate30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const closeDate7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const prompt = `You are a prediction market designer. Create a binary YES/NO market from this trend.

Topic: "${trend.topic}"
Context: "${trend.query}"
Category: "${category}"

Rules for a good market:
- Title must be a clear question under 90 characters (binary YES/NO, OR a multi-option poll)
- Rules must define exactly when each outcome wins
- Source of truth must be a specific verifiable public source
- Close date should be ${closeDate7} for fast-moving news or ${closeDate30} for slower events
- Type: "Prediction" for binary events, "Opinion" for community preference, "Opportunity" for opportunity sizing

For most questions, leave "outcomeOptions" empty and the market defaults to YES/NO. When the
question is naturally multi-choice (e.g. "Which of these will happen first?" or "Which candidate
will win?"), return 3 to 6 short labels (max 40 chars each) in "outcomeOptions". Do not include
YES/NO if you provide poll options.

Return JSON only:
{
  "title": "...",
  "description": "one sentence description",
  "rules": "Concise resolution rules for each outcome.",
  "sourceOfTruth": "specific public source (e.g. CoinGecko, official announcement, SEC filing)",
  "closeDate": "YYYY-MM-DD",
  "type": "Prediction|Opinion|Opportunity",
  "outcomeOptions": ["Option A", "Option B", "Option C"]
}`;

  const result = await callLlmJson({ task: 'reasoning', prompt, maxTokens: 512, temperature: 0.4 });
  const parsed = extractJsonObject(result.text) as Partial<GeminiDraft>;

  if (!parsed.title || !parsed.rules || !parsed.sourceOfTruth || !parsed.closeDate) {
    throw new Error(`Draft (${result.provider} ${result.model}) returned incomplete fields.`);
  }

  // Only carry poll options through when there are at least 3 — anything less is binary.
  let outcomeOptions: string[] | undefined;
  if (Array.isArray(parsed.outcomeOptions)) {
    const cleaned = parsed.outcomeOptions
      .filter((o): o is string => typeof o === 'string')
      .map((o) => o.trim().slice(0, 40))
      .filter(Boolean);
    if (cleaned.length >= 3 && cleaned.length <= 6) outcomeOptions = cleaned;
  }

  return {
    title: parsed.title,
    description: parsed.description ?? parsed.title,
    rules: parsed.rules,
    sourceOfTruth: parsed.sourceOfTruth,
    closeDate: parsed.closeDate,
    outcomeOptions,
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
  "confidence": 0.0-1.0,
  "reason": "one sentence"
}`;

  const result = await callLlmJson({ task: 'safety', prompt, maxTokens: 256 });
  const parsed = extractJsonObject(result.text) as Partial<SafetyResult>;

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
  const imageURI = await fetchTrendImageURI(trend);
  const input: MarketDraft = {
    type: draft.type,
    title: draft.title,
    description: draft.description,
    category: classification.category,
    categories: classification.categories,
    closeDate: draft.closeDate,
    rules: draft.rules,
    sourceOfTruth: draft.sourceOfTruth,
    resolver: 'Presto Agent',
    resolutionMode: 'Agent assisted',
    imageURI,
    outcomeOptions: draft.outcomeOptions,
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
// Per-run cap: even if there are open slots under the active-market cap, the agent should
// not burst-create multiple markets in a single cron invocation. With cron daily this means
// at most 1 new market per day; if you upgrade to sub-daily cron it caps the burst per tick.
const AGENT_PER_RUN_CAP = Math.max(1, Number(process.env.PRESTO_AGENT_PER_RUN_CAP ?? 1));
// Cap the number of *active* agent-created markets (Open or Closing soon). Once a market
// resolves or cancels, a slot frees up. Tunable via env so we can raise it once we trust the
// pipeline more. Default 2 for safety while we're early.
const AGENT_ACTIVE_MARKET_CAP = Math.max(0, Number(process.env.PRESTO_AGENT_ACTIVE_MARKET_CAP ?? 2));

function countActiveAgentMarkets(markets: AppMarket[]): number {
  return markets.filter((m) =>
    m.createdByType === 'agent' && (m.status === 'Open' || m.status === 'Closing soon')
  ).length;
}

export async function runAgentPipeline(): Promise<PipelineResult[]> {
  const trends = await fetchTrends();
  const existingMarkets = await fetchOnchainMarkets().catch(() => []);
  const results: PipelineResult[] = [];

  let activeAgentMarkets = countActiveAgentMarkets(existingMarkets);
  if (activeAgentMarkets >= AGENT_ACTIVE_MARKET_CAP) {
    return [{
      ok: false,
      topic: '(pipeline)',
      stage: 'cap',
      reason: `Agent active-market cap reached (${activeAgentMarkets}/${AGENT_ACTIVE_MARKET_CAP}). Waiting for an existing market to resolve before creating more.`,
    }];
  }

  let createdThisRun = 0;
  for (const trend of trends) {
    if (createdThisRun >= AGENT_PER_RUN_CAP) {
      results.push({
        ok: false,
        topic: trend.topic,
        stage: 'cap',
        reason: `Per-run cap (${AGENT_PER_RUN_CAP}) reached. The agent only creates ${AGENT_PER_RUN_CAP} market per cron tick to avoid bursts; remaining trends carry over to the next run.`,
      });
      break;
    }
    if (activeAgentMarkets >= AGENT_ACTIVE_MARKET_CAP) {
      results.push({
        ok: false,
        topic: trend.topic,
        stage: 'cap',
        reason: `Active-market cap (${AGENT_ACTIVE_MARKET_CAP}) reached during this run.`,
      });
      break;
    }
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
      if (result.ok) {
        activeAgentMarkets += 1;
        createdThisRun += 1;
      }
    } catch (e) {
      results.push({ ok: false, topic: trend.topic, stage: 'pipeline', reason: String(e) });
    }
  }

  return results;
}
