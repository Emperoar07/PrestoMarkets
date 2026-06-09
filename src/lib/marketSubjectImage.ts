/**
 * Resolve a real, subject-appropriate image for a market when the source feed/article has no
 * og:image — so the card shows the thing the market is about (a person's photo, a country
 * flag for an election, a club crest, a company logo) instead of decoration.
 *
 * Sources are public + read-only and the caller still runs every returned URL through the
 * SSRF-safe, image-type-checked validateImageUrl before use.
 */

// Wikipedia / TheSportsDB are fixed, trusted public APIs (the only user input is the URL-encoded
// subject in the path), so a plain fetch is safe here and avoids the SSRF-hardened fetcher that
// was failing to resolve these in the serverless runtime.
async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': 'PrestoMarketsAgent/1.0', Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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

const CRYPTO_LOGOS: Array<{ aliases: string[]; url: string }> = [
  { aliases: ['bitcoin', 'btc'], url: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png' },
  { aliases: ['ethereum', 'ether', 'eth'], url: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png' },
  { aliases: ['solana', 'sol'], url: 'https://assets.coingecko.com/coins/images/4128/large/solana.png' },
  { aliases: ['xrp', 'ripple'], url: 'https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png' },
  { aliases: ['dogecoin', 'doge'], url: 'https://assets.coingecko.com/coins/images/5/large/dogecoin.png' },
  { aliases: ['cardano', 'ada'], url: 'https://assets.coingecko.com/coins/images/975/large/cardano.png' },
  { aliases: ['binance coin', 'bnb'], url: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png' },
  { aliases: ['usd coin', 'usdc'], url: 'https://assets.coingecko.com/coins/images/6319/large/usdc.png' },
  { aliases: ['tether', 'usdt'], url: 'https://assets.coingecko.com/coins/images/325/large/Tether.png' },
  { aliases: ['avalanche', 'avax'], url: 'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png' },
  { aliases: ['chainlink', 'link'], url: 'https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png' },
  { aliases: ['toncoin', 'ton'], url: 'https://assets.coingecko.com/coins/images/17980/large/ton_symbol.png' },
];

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

function hasWord(text: string, value: string) {
  return new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

export function detectCryptoLogoUrl(text: string): string | undefined {
  let best: { index: number; url: string } | null = null;
  for (const asset of CRYPTO_LOGOS) {
    for (const alias of asset.aliases) {
      if (!hasWord(text, alias)) continue;
      const match = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').exec(text);
      const index = match?.index ?? Number.POSITIVE_INFINITY;
      if (!best || index < best.index) best = { index, url: asset.url };
    }
  }
  return best?.url;
}

export function detectCountryFlagUrl(text: string): string | undefined {
  const lower = text.toLowerCase();
  const entries = Object.entries(COUNTRY_ISO).sort((a, b) => b[0].length - a[0].length);
  for (const [name, iso] of entries) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return `https://flagcdn.com/w320/${iso}.png`;
  }
  return undefined;
}

export function detectSportsTeamSearchName(text: string): string | undefined {
  const cleaned = text
    .replace(/[?".,:;!]/g, ' ')
    .replace(/^Will\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const vsMatch = /\b([A-Z][A-Za-z.&'-]*(?:\s+[A-Z][A-Za-z.&'-]*){0,3})\s+(?:vs|v|versus)\s+([A-Z][A-Za-z.&'-]*(?:\s+[A-Z][A-Za-z.&'-]*){0,3})\b/.exec(cleaned);
  if (vsMatch?.[1]) return vsMatch[1].trim();

  const actionMatch = /\b([A-Z][A-Za-z.&'-]*(?:\s+[A-Z][A-Za-z.&'-]*){0,3})\s+(?:beat|defeat|play|face|host|visit)\s+([A-Z][A-Za-z.&'-]*(?:\s+[A-Z][A-Za-z.&'-]*){0,3})\b/.exec(cleaned);
  if (!actionMatch?.[1]) return undefined;

  const candidate = actionMatch[1].trim();
  const looksLikeKnownTeam =
    /\b(?:FC|United|City|Arsenal|Chelsea|Lakers|Celtics|Knicks|Spurs|Thunder|Warriors|Heat|Bulls)\b/.test(candidate);
  const looksLikePerson = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(candidate) && !looksLikeKnownTeam;
  return looksLikePerson ? undefined : candidate;
}

async function fetchSportsTeamBadge(teamName: string): Promise<string | undefined> {
  if (!teamName) return undefined;
  try {
    const res = await fetchJsonWithTimeout(
      `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(teamName)}`,
      8_000,
    );
    if (!res || !res.ok) return undefined;
    const data = (await res.json()) as { teams?: Array<{ strBadge?: string; strLogo?: string }> | null };
    return data.teams?.[0]?.strBadge || data.teams?.[0]?.strLogo || undefined;
  } catch {
    return undefined;
  }
}

// Wikipedia thumb URLs end in `/<width>px-<file>`; rewrite the width so we serve a sensibly
// sized image (sharp on cards + the detail banner) instead of the multi-MB full-res original.
function sizedWikiThumb(url: string | undefined, width = 800): string | undefined {
  if (!url) return undefined;
  return /\/\d+px-/.test(url) ? url.replace(/\/\d+px-/, `/${width}px-`) : url;
}

async function fetchWikipediaThumbnail(subject: string): Promise<string | undefined> {
  if (!subject) return undefined;
  try {
    const res = await fetchJsonWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(subject)}`,
      8_000,
    );
    if (!res || !res.ok) return undefined;
    const data = (await res.json()) as { thumbnail?: { source?: string }; originalimage?: { source?: string } };
    // Prefer the (resizable) thumbnail upscaled to a reasonable width over the raw original.
    return sizedWikiThumb(data.thumbnail?.source) || data.thumbnail?.source || data.originalimage?.source || undefined;
  } catch {
    return undefined;
  }
}

export async function resolveSubjectImageUrl(trend: { topic: string; query?: string }): Promise<string | undefined> {
  const text = `${trend.topic} ${trend.query ?? ''}`;
  const cryptoLogo = detectCryptoLogoUrl(text);
  if (cryptoLogo) return cryptoLogo;

  const sportsTeam = detectSportsTeamSearchName(text);
  if (sportsTeam) {
    const badge = await fetchSportsTeamBadge(sportsTeam);
    if (badge) return badge;
  }

  // Elections/votes → the country flag (matches how the leading venues show these).
  if (/\b(election|presidential|governor|mayor|parliament|referendum|vote)\b/i.test(text)) {
    const flag = detectCountryFlagUrl(text);
    if (flag) return flag;
  }

  // Main subject's Wikipedia image (person photo, org/company logo, club crest, place).
  // Strip a trailing possessive ("Iran's" -> "Iran") so the lookup resolves.
  const subject = extractSubject(trend.topic).replace(/['’]s\b/i, '').trim();
  const wiki = await fetchWikipediaThumbnail(subject);
  if (wiki) return wiki;

  // Last resort: any country named in the market (e.g. "Iran's football team") → its flag.
  return detectCountryFlagUrl(text);
}
