/**
 * Breaking news feed for the markets explorer.
 *
 * Pulls the latest crypto / macro stories from a handful of free RSS feeds, dedupes,
 * scores by (source weight x recency decay), and returns the top items. The Cache-Control
 * header pins the response to a 24h CDN cache so we rank once a day, not per-request.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const revalidate = 86400;

type NewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  excerpt?: string;
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

function rank(items: { item: NewsItem; weight: number }[]): NewsItem[] {
  const now = Date.now();
  const scored = items.map(({ item, weight }) => {
    const ageHours = Math.max(0, (now - Date.parse(item.publishedAt)) / 3_600_000);
    const recency = Math.exp(-ageHours / 24);
    return { item, score: weight * recency };
  });
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const { item } of scored) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
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
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=21600',
      },
    },
  );
}
