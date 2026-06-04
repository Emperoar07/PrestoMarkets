/**
 * Resolve a real, subject-appropriate image for a market when the source feed/article has no
 * og:image — so the card shows the thing the market is about (a person's photo, a country
 * flag for an election, a club crest, a company logo) instead of decoration.
 *
 * Sources are public + read-only and the caller still runs every returned URL through the
 * SSRF-safe, image-type-checked validateImageUrl before use.
 */

import { fetchPublicHttpUrl } from './publicUrl';

// Common countries → ISO 3166-1 alpha-2 (longest names first when matching).
const COUNTRY_ISO: Record<string, string> = {
  'united states': 'us', usa: 'us', america: 'us',
  'united kingdom': 'gb', britain: 'gb', uk: 'gb', england: 'gb',
  'south korea': 'kr', 'north korea': 'kp', 'south africa': 'za', 'saudi arabia': 'sa',
  peru: 'pe', france: 'fr', colombia: 'co', korea: 'kr', iran: 'ir', china: 'cn',
  japan: 'jp', india: 'in', brazil: 'br', germany: 'de', spain: 'es', italy: 'it',
  russia: 'ru', ukraine: 'ua', israel: 'il', mexico: 'mx', canada: 'ca', argentina: 'ar',
  nigeria: 'ng', venezuela: 've', turkey: 'tr', egypt: 'eg', poland: 'pl', netherlands: 'nl',
  australia: 'au', taiwan: 'tw', pakistan: 'pk', indonesia: 'id', philippines: 'ph',
  vietnam: 'vn', thailand: 'th', greece: 'gr', portugal: 'pt', sweden: 'se', norway: 'no',
};

const STOP = new Set([
  'will', 'the', 'a', 'an', 'by', 'in', 'on', 'of', 'to', 'vs', 'and', 'or', 'for', 'is', 'are',
  'be', 'new', 'market', 'price', 'election', 'winner', 'president', 'presidential', 'governor',
  'mayor', 'match', 'game', 'cup', 'league', 'what', 'who', 'when', 'which', 'reach', 'hit',
  'above', 'below', 'end', 'next', 'this',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december',
]);

/** First run of meaningful capitalized words (a proper noun) from the topic. */
export function extractSubject(topic: string): string {
  const words = topic.replace(/[?".,:;!]/g, ' ').split(/\s+/).filter(Boolean);
  const phrase: string[] = [];
  for (const word of words) {
    const isCapitalized = /^[A-Z][A-Za-z.&'-]+$/.test(word);
    if (isCapitalized && !STOP.has(word.toLowerCase())) {
      phrase.push(word);
      if (phrase.length >= 4) break;
    } else if (phrase.length > 0) {
      break;
    }
  }
  return phrase.join(' ');
}

export function detectCountryFlagUrl(text: string): string | undefined {
  const lower = text.toLowerCase();
  const entries = Object.entries(COUNTRY_ISO).sort((a, b) => b[0].length - a[0].length);
  for (const [name, iso] of entries) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return `https://flagcdn.com/w320/${iso}.png`;
  }
  return undefined;
}

async function fetchWikipediaThumbnail(subject: string): Promise<string | undefined> {
  if (!subject) return undefined;
  try {
    const res = await fetchPublicHttpUrl(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(subject)}`,
      { headers: { 'User-Agent': 'PrestoMarketsAgent/1.0', Accept: 'application/json' }, maxBytes: 200_000, timeoutMs: 8_000 },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { thumbnail?: { source?: string }; originalimage?: { source?: string } };
    return data.originalimage?.source || data.thumbnail?.source || undefined;
  } catch {
    return undefined;
  }
}

export async function resolveSubjectImageUrl(trend: { topic: string; query?: string }): Promise<string | undefined> {
  const text = `${trend.topic} ${trend.query ?? ''}`;
  // Elections/votes → the country flag (matches how the leading venues show these).
  if (/\b(election|presidential|governor|mayor|parliament|referendum|vote)\b/i.test(text)) {
    const flag = detectCountryFlagUrl(text);
    if (flag) return flag;
  }
  // Otherwise the main subject's Wikipedia image (person photo, org/company logo, club crest, place).
  return fetchWikipediaThumbnail(extractSubject(trend.topic));
}
