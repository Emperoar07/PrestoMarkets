# Agent Pipeline Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add timeout protection to 10+ external API calls in the agent pipeline, validate error handling for timeout scenarios, add request validation before Arc onchain writes, and ensure comprehensive logging on failure.

**Architecture:** Create a reusable timeout utility, apply it to each external API call (Serper, Grok, RSS feeds, price feeds, sports APIs, image fetch, Polymarket), add pre-write validation in agentWallet.ts, and enhance logging throughout. All external APIs will timeout after 10-15 seconds with graceful fallback to empty results or template defaults.

**Tech Stack:** TypeScript, Fetch API with AbortController, viem for Arc validation, logger utility for structured logging.

---

## File Structure

**Files to modify:**
- `src/lib/timeoutUtils.ts` — NEW: Reusable timeout helper with abort signal handling
- `src/lib/agentPipeline.ts` — Add timeouts to 10+ external API fetch calls
- `src/lib/agentWallet.ts` — Add request validation before Arc writes
- `src/lib/__tests__/agentPipeline.test.ts` — Update timeout tests

---

## Task 1: Create Reusable Timeout Utility

**Files:**
- Create: `src/lib/timeoutUtils.ts`
- Test: `src/lib/__tests__/timeoutUtils.test.ts`

### Step 1: Write timeout utility with tests

Create `src/lib/timeoutUtils.ts`:

```typescript
/**
 * Helper to add timeout protection to async operations.
 * Returns a function that wraps fetch/async operations with AbortController.
 */

export interface TimeoutOptions {
  timeoutMs: number;
  onTimeout?: () => void;
  label?: string;
}

/**
 * Wrap a fetch call with timeout protection using AbortController.
 * If timeout occurs, logs warning and returns null or default value.
 */
export async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit & { timeout?: number; label?: string }
): Promise<Response | null> {
  const timeoutMs = options.timeout ?? 10_000;
  const label = options.label ?? url;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const fetchOptions = { ...options };
    delete (fetchOptions as any).timeout;
    delete (fetchOptions as any).label;
    
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      return null;
    }
    throw err;
  }
}

/**
 * Create a promise that rejects after a timeout.
 * Useful for Promise.race() to add timeout to any async operation.
 */
export function createTimeoutPromise<T>(ms: number, label = 'operation'): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
  });
}

/**
 * Race an async operation against a timeout.
 * Returns the result or null on timeout.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation'
): Promise<T | null> {
  try {
    return await Promise.race([
      promise,
      createTimeoutPromise<T>(ms, label),
    ]);
  } catch (err) {
    if (err instanceof Error && err.message.includes('timeout')) {
      return null;
    }
    throw err;
  }
}
```

### Step 2: Run typecheck to verify syntax

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS with no errors

### Step 3: Commit timeout utility

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/timeoutUtils.ts && git commit -m "feat: add timeout utility helpers for external API calls"
```

---

## Task 2: Add Timeout to Serper API (fetchSerperTrends)

**Files:**
- Modify: `src/lib/agentPipeline.ts:46-85`

### Step 1: Verify current implementation has timeout

Read lines 46-85 to confirm Serper already has 8s timeout. It does. No change needed.

### Step 2: Commit verification

```bash
cd c:/Users/bolaj/presto-markets && git commit -m "docs: verify Serper API has 8s timeout protection" --allow-empty
```

---

## Task 3: Add Timeout to Grok X API (fetchGrokXTrends)

**Files:**
- Modify: `src/lib/agentPipeline.ts:87-135`

### Step 1: Add timeout to fetchGrokXTrends

Replace the function:

```typescript
async function fetchGrokXTrends(): Promise<TrendItem[]> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return [];

  const prompt = `List the top 6 stories trending on X right now about crypto, AI, politics, tech, or markets that could become binary YES/NO prediction markets resolvable within 7–90 days. Return JSON only:
{
  "items": [
    { "topic": "short question-style summary, max 90 chars", "context": "one sentence context", "url": "most-cited tweet URL" }
  ]
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
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
      signal: controller.signal,
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
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('agent-pipeline', 'Grok X API timeout after 12000ms');
      return [];
    }
    logger.error('agent-pipeline', 'Grok X API failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
```

### Step 2: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 3: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentPipeline.ts && git commit -m "security: add 12s timeout to Grok X API fetch"
```

---

## Task 4: Add Timeout to RSS Feeds (fetchRssTrends)

**Files:**
- Modify: `src/lib/agentPipeline.ts:137-163`

### Step 1: Add timeout to fetchRssTrends

Replace the function:

```typescript
async function fetchRssTrends(input: { url: string; source: string; limit?: number }): Promise<TrendItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(input.url, {
      headers: { 'User-Agent': 'PrestoMarketsAgent/1.0' },
      signal: controller.signal,
    });
    
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
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('agent-pipeline', `RSS feed timeout for ${input.source} after 10000ms`);
      return [];
    }
    logger.error('agent-pipeline', `RSS feed failed for ${input.source}`, { error: err instanceof Error ? err.message : String(err) });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
```

### Step 2: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 3: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentPipeline.ts && git commit -m "security: add 10s timeout to RSS feed fetches (Google News, Cointelegraph, ESPN, etc.)"
```

---

## Task 5: Add Timeout to CoinGecko Price API

**Files:**
- Modify: `src/lib/agentPipeline.ts:261-291`

### Step 1: Add timeout to fetchCoinGeckoPriceSignals

Replace the function:

```typescript
async function fetchCoinGeckoPriceSignals(): Promise<TrendItem[]> {
  const ids = cryptoPriceAssets.map((asset) => asset.id).join(',');
  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: HeadersInit = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
      {
        headers,
        next: { revalidate: 300 },
        signal: controller.signal,
      },
    );

    if (!res.ok) return [];
    const data = await res.json() as Record<string, { usd?: number; usd_24h_change?: number; last_updated_at?: number }>;

    return cryptoPriceAssets.flatMap((asset) => {
      const price = data[asset.id]?.usd;
      if (!Number.isFinite(price)) return [];
      return buildCryptoPriceSignals({
        name: asset.name,
        symbol: asset.symbol,
        id: asset.id,
        provider: 'CoinGecko',
        source: 'coingecko-price',
        price: price as number,
        change: data[asset.id]?.usd_24h_change,
        threshold: asset.threshold,
        url: `https://api.coingecko.com/api/v3/simple/price?ids=${asset.id}&vs_currencies=usd&include_last_updated_at=true`,
      });
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('agent-pipeline', 'CoinGecko API timeout after 10000ms');
      return [];
    }
    logger.error('agent-pipeline', 'CoinGecko API failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
```

### Step 2: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 3: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentPipeline.ts && git commit -m "security: add 10s timeout to CoinGecko price API"
```

---

## Task 6: Add Timeout to CoinMarketCap Price API

**Files:**
- Modify: `src/lib/agentPipeline.ts:293-335`

### Step 1: Add timeout to fetchCoinMarketCapPriceSignals

Replace the function:

```typescript
async function fetchCoinMarketCapPriceSignals(): Promise<TrendItem[]> {
  const apiKey = process.env.COINMARKETCAP_API_KEY || process.env.CMC_API_KEY;
  if (!apiKey) return [];

  const symbols = cryptoPriceAssets.map((asset) => asset.cmcSymbol).join(',');
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(
      `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${symbols}&convert=USD`,
      {
        headers: { 'X-CMC_PRO_API_KEY': apiKey },
        next: { revalidate: 300 },
        signal: controller.signal,
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

      return buildCryptoPriceSignals({
        name: asset.name,
        symbol: asset.symbol,
        id: item?.slug || asset.id,
        provider: 'CoinMarketCap',
        source: 'coinmarketcap-price',
        price: quote?.price as number,
        change: quote?.percent_change_24h,
        threshold: asset.threshold,
        url: `https://coinmarketcap.com/currencies/${item?.slug || asset.id}/`,
      });
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('agent-pipeline', 'CoinMarketCap API timeout after 10000ms');
      return [];
    }
    logger.error('agent-pipeline', 'CoinMarketCap API failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
```

### Step 2: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 3: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentPipeline.ts && git commit -m "security: add 10s timeout to CoinMarketCap price API"
```

---

## Task 7: Add Timeout to Sports Score APIs

**Files:**
- Modify: `src/lib/agentPipeline.ts:370-420`

### Step 1: Add timeout to fetchSportsScoreSignals

Replace the function to wrap individual fetch calls:

```typescript
async function fetchSportsScoreSignals(): Promise<TrendItem[]> {
  const apiKey = process.env.THESPORTSDB_API_KEY || '123';
  const dates = [new Date(), new Date(Date.now() + 24 * 60 * 60 * 1000)];
  const requests = sportsDbSports.flatMap((sport) => dates.map(async (date) => {
    const day = formatSportsDbDate(date);
    const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsday.php?d=${day}&s=${encodeURIComponent(sport.sport)}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    
    try {
      const res = await fetch(url, {
        next: { revalidate: 900 },
        signal: controller.signal,
      });
      
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
        const topic = `${home} vs ${away}: ${score}`;
        return [{
          topic,
          query: `${home} (${sport.category}) vs ${away}. Match ${event.strStatus || 'upcoming'}.`,
          source: sport.source,
          url: `https://www.thesportsdb.com/event/${event.idEvent}`,
        }];
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        logger.warn('agent-pipeline', `TheSportsDB timeout for ${sport.sport} on ${day}`);
        return [] as TrendItem[];
      }
      logger.error('agent-pipeline', `TheSportsDB fetch failed for ${sport.sport}`, { error: err instanceof Error ? err.message : String(err) });
      return [] as TrendItem[];
    } finally {
      clearTimeout(timeout);
    }
  }));

  const batches = await Promise.all(requests);
  return batches.flat();
}
```

### Step 2: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 3: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentPipeline.ts && git commit -m "security: add 10s timeout to TheSportsDB API calls"
```

---

## Task 8: Add Timeout to Live Football Score API

**Files:**
- Modify: `src/lib/agentPipeline.ts:422-465`

### Step 1: Add timeout to fetchLiveScoreFootballSignals

Replace the function:

```typescript
async function fetchLiveScoreFootballSignals(): Promise<TrendItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(
      'https://www.api-football.com/api/v3/fixtures?status=LIVE&league=39,78,61,135,94,88,307,354&season=2024',
      {
        headers: { 'x-apisports-key': process.env.API_FOOTBALL_API_KEY || '' },
        signal: controller.signal,
      },
    );

    if (!res.ok) return [];
    const data = await res.json() as {
      response?: Array<{
        fixture?: { id?: string };
        league?: { name?: string };
        teams?: { home?: { name?: string }; away?: { name?: string } };
        goals?: { home?: number; away?: number };
      }>;
    };

    return (data.response ?? []).slice(0, 4).map((match) => ({
      topic: `${match.teams?.home?.name} vs ${match.teams?.away?.name}: ${match.goals?.home}-${match.goals?.away}`,
      query: `Live: ${match.teams?.home?.name} playing ${match.teams?.away?.name} in ${match.league?.name}`,
      source: 'api-football-live',
      url: `https://www.api-football.com/match/${match.fixture?.id}`,
    }));
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('agent-pipeline', 'api-football API timeout after 10000ms');
      return [];
    }
    logger.error('agent-pipeline', 'api-football API failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
```

### Step 2: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 3: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentPipeline.ts && git commit -m "security: add 10s timeout to api-football live score fetch"
```

---

## Task 9: Add Timeout to SportDB General Signals

**Files:**
- Modify: `src/lib/agentPipeline.ts:466-512`

### Step 1: Add timeout to fetchSportDbSignals

Update the function to add timeout per fetch:

```typescript
async function fetchSportDbSignals(): Promise<TrendItem[]> {
  const endpoints = [
    { url: 'https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=133602', source: 'thesportsdb-news', limit: 2 },
    { url: 'https://www.thesportsdb.com/api/v1/json/3/eventsyear.php?y=2024&s=Soccer', source: 'thesportsdb-upcoming', limit: 3 },
  ];

  const results: TrendItem[] = [];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(endpoint.url, {
        next: { revalidate: 1800 },
        signal: controller.signal,
      });

      if (!res.ok) continue;

      const data = await res.json() as {
        results?: Array<{
          idEvent?: string;
          strEvent?: string;
          strHomeTeam?: string;
          strAwayTeam?: string;
          intHomeScore?: string | null;
          intAwayScore?: string | null;
        }>;
      };

      for (const event of (data.results ?? []).slice(0, endpoint.limit)) {
        const home = sanitizeFeedText(event.strHomeTeam || '');
        const away = sanitizeFeedText(event.strAwayTeam || '');
        if (!home || !away) continue;

        results.push({
          topic: `${home} vs ${away}`,
          query: `${home} playing ${away}. Score: ${event.intHomeScore}-${event.intAwayScore}`,
          source: endpoint.source,
          url: `https://www.thesportsdb.com/event/${event.idEvent}`,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        logger.warn('agent-pipeline', `SportDB timeout for ${endpoint.source} after 10000ms`);
        continue;
      }
      logger.error('agent-pipeline', `SportDB fetch failed for ${endpoint.source}`, { error: err instanceof Error ? err.message : String(err) });
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return results;
}
```

### Step 2: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 3: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentPipeline.ts && git commit -m "security: add 10s timeout to SportDB signals fetch"
```

---

## Task 10: Add Timeout to Trend Image URI Fetch

**Files:**
- Modify: `src/lib/agentPipeline.ts:729-750`

### Step 1: Add timeout to fetchTrendImageURI

Replace the function:

```typescript
async function fetchTrendImageURI(trend: TrendItem): Promise<string | undefined> {
  if (!trend.imageUrl) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(trend.imageUrl, {
      headers: { 'User-Agent': 'PrestoMarketsAgent/1.0' },
      signal: controller.signal,
    });

    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return undefined;
    
    return trend.imageUrl;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('agent-pipeline', `Image fetch timeout for ${trend.topic} after 8000ms`);
      return undefined;
    }
    logger.error('agent-pipeline', `Image fetch failed for ${trend.topic}`, { error: err instanceof Error ? err.message : String(err) });
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
```

### Step 2: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 3: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentPipeline.ts && git commit -m "security: add 8s timeout to trend image URI fetch"
```

---

## Task 11: Add Timeout to Polymarket Precedents Fetch

**Files:**
- Modify: `src/lib/agentPipeline.ts:955-1000`

### Step 1: Add timeout to fetchPolymarketPrecedents

Replace the function:

```typescript
async function fetchPolymarketPrecedents(trend: TrendItem): Promise<MarketPrecedent[]> {
  const query = encodeURIComponent(trend.topic.slice(0, 100));
  const url = `https://polymarket.com/api/search?query=${query}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PrestoMarketsAgent/1.0' },
      signal: controller.signal,
    });

    if (!response.ok) return [];

    const data = await response.json() as {
      data?: Array<{ 
        id?: string; 
        name?: string; 
        slug?: string; 
        liquidity?: number;
      }>;
    };

    return (data.data ?? [])
      .slice(0, 5)
      .map((market) => ({
        id: market.id || '',
        name: market.name || '',
        url: market.slug ? `https://polymarket.com/market/${market.slug}` : '',
        liquidity: market.liquidity || 0,
      }))
      .filter((m) => m.id && m.name && m.url);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('agent-pipeline', `Polymarket precedents timeout for ${trend.topic} after 10000ms`);
      return [];
    }
    logger.error('agent-pipeline', `Polymarket precedents fetch failed for ${trend.topic}`, { error: err instanceof Error ? err.message : String(err) });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
```

### Step 2: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 3: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentPipeline.ts && git commit -m "security: add 10s timeout to Polymarket precedents fetch"
```

---

## Task 12: Add Request Validation Before Arc Writes in agentWallet.ts

**Files:**
- Modify: `src/lib/agentWallet.ts:70-250`

### Step 1: Add validation helper at top of agentWallet.ts

Add after imports:

```typescript
// Request validation helpers
function validateMarketCreationRequest(input: CreateLiveMarketInput): { ok: boolean; error?: string } {
  if (!input.title || input.title.length === 0) return { ok: false, error: 'Market title is required' };
  if (input.title.length > 200) return { ok: false, error: 'Title exceeds 200 characters' };
  
  if (!input.outcomes || input.outcomes.length < 2) return { ok: false, error: 'Market must have at least 2 outcomes' };
  if (input.outcomes.length > 12) return { ok: false, error: 'Market cannot have more than 12 outcomes' };
  
  if (!input.closeDate) return { ok: false, error: 'Close date is required' };
  const closeTime = new Date(input.closeDate).getTime();
  const nowTime = Date.now();
  if (closeTime <= nowTime) return { ok: false, error: 'Close date must be in the future' };
  if (closeTime - nowTime < 3600000) return { ok: false, error: 'Market must close at least 1 hour from now' };
  
  if (!input.collateralAddress || !/^0x[a-fA-F0-9]{40}$/.test(input.collateralAddress)) {
    return { ok: false, error: 'Invalid collateral address' };
  }
  
  if (!input.resolverAddress || !/^0x[a-fA-F0-9]{40}$/.test(input.resolverAddress)) {
    return { ok: false, error: 'Invalid resolver address' };
  }
  
  return { ok: true };
}
```

### Step 2: Add validation to agentCreateMarket function

Find the agentCreateMarket function and add validation before the first writeContract call:

```typescript
export async function agentCreateMarket(input: CreateLiveMarketInput): Promise<{ ok: boolean; hash?: string; error?: string }> {
  try {
    // Validate request before writing onchain
    const validation = validateMarketCreationRequest(input);
    if (!validation.ok) {
      logger.error('agent-wallet', 'Market creation validation failed', { error: validation.error, title: input.title });
      return { ok: false, error: validation.error };
    }

    const { account, publicClient, walletClient, factoryAddress } = getClients();
    // ... rest of function
```

### Step 3: Run typecheck

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS

### Step 4: Commit

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/agentWallet.ts && git commit -m "security: add request validation before Arc market creation writes"
```

---

## Task 13: Add Comprehensive Logging for Timeouts and Failures

**Files:**
- Modify: `src/lib/agentPipeline.ts` (already done in previous tasks with logger.warn/error calls)

### Step 1: Verify logging is in place

All timeout handlers in previous tasks already include:
- `logger.warn('agent-pipeline', 'API timeout...')` for timeouts
- `logger.error('agent-pipeline', 'API failed...', { error: ... })` for errors

Verify by running:

```bash
cd c:/Users/bolaj/presto-markets && grep -n "logger.warn\|logger.error" src/lib/agentPipeline.ts | wc -l
```

Expected: 15+ entries

### Step 2: Verify structured logging format

Check that logger is imported:

```bash
cd c:/Users/bolaj/presto-markets && head -20 src/lib/agentPipeline.ts | grep "import.*logger"
```

Expected: Found logger import

### Step 3: Commit logging verification

```bash
cd c:/Users/bolaj/presto-markets && git commit -m "docs: verify comprehensive timeout/failure logging throughout agent pipeline" --allow-empty
```

---

## Task 14: Update Agent Pipeline Tests

**Files:**
- Modify: `src/lib/__tests__/agentPipeline.test.ts`

### Step 1: Add timeout test cases

Add to test file:

```typescript
describe('agentPipeline timeout handling', () => {
  test('fetchSerperTrends returns empty array on timeout', async () => {
    // Mock fetch to timeout
    const originalFetch = global.fetch;
    global.fetch = jest.fn(() => 
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AbortError')), 100)
      )
    ) as any;

    const result = await fetchSerperTrends();
    expect(result).toEqual([]);

    global.fetch = originalFetch;
  });

  test('fetchGrokXTrends returns empty array on timeout', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(() => 
      new Promise((_, reject) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 50);
        reject(Object.assign(new Error(), { name: 'AbortError' }));
      })
    ) as any;

    const result = await fetchGrokXTrends();
    expect(result).toEqual([]);

    global.fetch = originalFetch;
  });

  test('fetchRssTrends returns empty array on timeout', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(() =>
      new Promise((_, reject) => 
        reject(Object.assign(new Error(), { name: 'AbortError' }))
      )
    ) as any;

    const result = await fetchRssTrends({ url: 'https://example.com/rss', source: 'test' });
    expect(result).toEqual([]);

    global.fetch = originalFetch;
  });
});
```

### Step 2: Run tests to verify they pass

```bash
cd c:/Users/bolaj/presto-markets && npm test -- src/lib/__tests__/agentPipeline.test.ts
```

Expected: All tests pass

### Step 3: Commit updated tests

```bash
cd c:/Users/bolaj/presto-markets && git add src/lib/__tests__/agentPipeline.test.ts && git commit -m "test: add timeout handling tests for agent pipeline APIs"
```

---

## Task 15: Run Full Build and Type Check

**Files:**
- No files modified (verification only)

### Step 1: Run full type check

```bash
cd c:/Users/bolaj/presto-markets && npm run typecheck
```

Expected: PASS with zero errors

### Step 2: Run all tests

```bash
cd c:/Users/bolaj/presto-markets && npm test 2>&1 | tail -20
```

Expected: All tests passing (or acceptable failures unrelated to these changes)

### Step 3: Run build

```bash
cd c:/Users/bolaj/presto-markets && npm run build 2>&1 | tail -20
```

Expected: Build succeeds

### Step 4: Final commit summary

```bash
cd c:/Users/bolaj/presto-markets && git log --oneline -15
```

Expected: 11+ commits related to timeout/validation additions

---

## Success Criteria

✅ All external API calls in agentPipeline.ts have timeout protection (8-12s per API)
✅ All timeouts use AbortController for clean cancellation
✅ All timeouts log warnings with clear labels
✅ All errors log with structured error information
✅ Market creation requests validated before Arc writes
✅ Validation includes: title, outcomes, closeDate, addresses
✅ TypeScript compilation passes zero errors
✅ All tests passing
✅ Production build succeeds
✅ 11+ security-focused commits with clear messages
