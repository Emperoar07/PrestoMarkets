/**
 * Breaking news feed for the markets explorer.
 *
 * Pulls the latest crypto / macro stories from a handful of free RSS feeds, dedupes,
 * scores by (source weight x recency decay), and returns the top items. The Cache-Control
 * header pins the response to a 24h CDN cache so we rank once a day, not per-request.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
// 8h fetch-cache for upstream RSS calls. Combined with the Cache-Control header below,
// the ranking refreshes ~3x per day instead of once.
export const revalidate = 28800;

type NewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  excerpt?: string;
  /** How many outlets currently covering this story. Higher = trending. */
  coverageCount?: number;
};

type Feed = {
  url: string;
  source: string;
  weight: number;
};

const FEEDS: Feed[] = [
  { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph', weight: 1.0 },
  { url: 'https://decrypt.co/feed', source: 'Decrypt', weight: 1.0 },
  { url: 'https://www.theblock.co/rss.xml', source: 'The Block', weight: 1.0 },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk', weight: 1.0 },
  { url: 'https://techcrunch.com/category/cryptocurrency/feed/', source: 'TechCrunch Crypto', weight: 0.7 },
];

function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const titleRegex = /<title>(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?<\/title>/i;
  const linkRegex = /<link>([^<]+)<\/link>/i;
  const descRegex = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i;
  const dateRegex = /<pubDate>([^<]+)<\/pubDate>/i;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml))) {
    const block = match[1];
    const title = titleRegex.exec(block)?.[1]?.trim();
    const link = linkRegex.exec(block)?.[1]?.trim();
    const desc = descRegex.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim();
    const date = dateRegex.exec(block)?.[1]?.trim();
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      source,
      publishedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
      excerpt: desc?.slice(0, 200),
    });
  }
  return items;
}

async function fetchFeed(feed: Feed): Promise<{ items: NewsItem[]; weight: number }> {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'PrestoMarketsNews/1.0' },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return { items: [], weight: feed.weight };
    const xml = await res.text();
    return { items: parseRss(xml, feed.source), weight: feed.weight };
  } catch {
    return { items: [], weight: feed.weight };
  }
}

// Loose title fingerprint for cross-outlet clustering. We don't want exact-title matches
// (each outlet rewords) — we want "is this the same story?". Tokenize, drop stopwords,
// keep the 4 strongest noun-like tokens (length >= 4), sort, hash. Two articles about the
// same event from two outlets will share most of these tokens and produce the same key.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'has', 'have', 'was', 'were',
  'are', 'will', 'would', 'could', 'should', 'into', 'over', 'after', 'before', 'about',
  'amid', 'amidst', 'against', 'between', 'their', 'they', 'them', 'these', 'those',
  'said', 'says', 'amid', 'while', 'when', 'where', 'what', 'which', 'how', 'why',
]);

function clusterKey(title: string): string {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  const top = Array.from(new Set(tokens)).slice(0, 4).sort();
  return top.join(' ');
}

type ClusterEntry = { item: NewsItem; weight: number };

function rank(items: { item: NewsItem; weight: number }[]): NewsItem[] {
  const now = Date.now();

  // Cluster items that look like the same story across outlets.
  const clusters = new Map<string, ClusterEntry[]>();
  for (const entry of items) {
    const key = clusterKey(entry.item.title);
    if (!key) continue;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(entry);
  }

  // Score each cluster by:
  //   recency: exp(-ageHours / 24) on the freshest member
  //   momentum: sqrt(coverage count across outlets) — multiple outlets = trending
  //   source weight: best source weight in the cluster
  // Then pick the freshest member as the cluster's representative.
  const scored = Array.from(clusters.values()).map((cluster) => {
    let bestRepresentative = cluster[0];
    let freshestAt = Date.parse(cluster[0].item.publishedAt);
    let bestWeight = cluster[0].weight;
    for (const entry of cluster) {
      const t = Date.parse(entry.item.publishedAt);
      if (t > freshestAt) {
        freshestAt = t;
        bestRepresentative = entry;
      }
      if (entry.weight > bestWeight) bestWeight = entry.weight;
    }
    const ageHours = Math.max(0, (now - freshestAt) / 3_600_000);
    const recency = Math.exp(-ageHours / 24);
    const momentum = Math.sqrt(cluster.length);
    return {
      item: bestRepresentative.item,
      score: bestWeight * recency * momentum,
      coverageCount: cluster.length,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const out: NewsItem[] = [];
  for (const { item, coverageCount } of scored) {
    out.push({ ...item, coverageCount });
    if (out.length >= 15) break;
  }
  return out;
}

export async function GET() {
  const feeds = await Promise.all(FEEDS.map(fetchFeed));
  const combined = feeds.flatMap(({ items, weight }) => items.map((item) => ({ item, weight })));
  const ranked = rank(combined);

  return NextResponse.json(
    { items: ranked, generatedAt: new Date().toISOString() },
    {
      headers: {
        // Cap refreshes at ~3 per day: 24h / 8h = 3. SWR keeps the previous ranking
        // visible while a new one rebuilds, so users never see "loading".
        'Cache-Control': 'public, s-maxage=28800, stale-while-revalidate=86400',
      },
    },
  );
}
