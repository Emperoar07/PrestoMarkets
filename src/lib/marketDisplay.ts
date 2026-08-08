import type { Market, MarketDisplayType } from './markets';

/**
 * How a market card should render. The agent can set this explicitly in metadata; otherwise
 * we derive it from the market's shape so existing markets render correctly without a re-tag.
 *
 * - binary        — plain YES/NO (no gauge).
 * - multi_outcome — election / winner: list outcomes as rows.
 * - date_ladder   — "by when?" markets: date options as rows.
 * - sports_live   — teams / scores / clock (agent-set; we don't derive it without a live feed).
 * - pulse_gauge   — short-window / directional / live pulse: THIS is the only one with a gauge.
 */
export type DisplayType = MarketDisplayType;

const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)';
const DATE_LIKE = new RegExp(
  `(?:${MONTHS}[a-z]*\\.?\\s*\\d{1,2}|\\d{1,2}\\s*${MONTHS}|\\d{4}-\\d{2}-\\d{2}|q[1-4]\\s*20\\d{2}|\\b20\\d{2}\\b)`,
  'i',
);

// Directional / short-horizon "pulse" signals — the only place a chance gauge belongs.
// Time units require an explicit min/hour word so dollar millions ("$3.8M") aren't read as
// minutes, and deadline phrasing ("by end of day") is intentionally NOT pulse.
const PULSE_RE = /\b(up or down|higher or lower|next hour|this hour|hourly|intraday|\d+\s*(?:min|mins|minute|minutes|hour|hours|hr|hrs)\b)\b/i;

type DisplayInput = Pick<Market, 'pollOptions' | 'type' | 'category' | 'title'> & {
  displayType?: DisplayType;
};

export function looksLikeDateOption(option: string): boolean {
  return DATE_LIKE.test(option.trim());
}

/** Which ESPN sport tree a fixture's live score lives on. */
export type LiveSport = 'soccer' | 'basketball';

const BASKETBALL_RE = /basketball|\bnba\b|\bwnba\b|\bncaab\b/i;

/**
 * Pick the sport for a fixture's live-score lookup. ESPN keeps soccer and basketball on separate
 * scoreboard trees, so querying the wrong one silently returns no match (no score, and decided
 * markets never detected as finished). Categories are tagged at creation ('Basketball'); the title
 * is the fallback for markets created before that tagging existed.
 */
export function liveSportForMarket(market: {
  category?: string;
  categories?: string[];
  title?: string;
}): LiveSport {
  const blob = [market.category, ...(market.categories ?? []), market.title].filter(Boolean).join(' ');
  return BASKETBALL_RE.test(blob) ? 'basketball' : 'soccer';
}

export function deriveDisplayType(market: DisplayInput): DisplayType {
  if (market.displayType) return market.displayType; // explicit agent classification wins

  const options = market.pollOptions ?? [];
  if (options.length > 2) {
    const dateish = options.filter(looksLikeDateOption).length;
    return dateish >= Math.ceil(options.length / 2) ? 'date_ladder' : 'multi_outcome';
  }

  const blob = `${market.title} ${market.category}`.toLowerCase();
  if (PULSE_RE.test(blob)) return 'pulse_gauge';

  return 'binary';
}

/**
 * The single metric a market card shows in its footer.
 *
 * Most on-chain markets are seeded LMSR fixtures that have never been traded, so their real VOLUME
 * (turnover) is a truthful $0 — a grid of "$0 Vol." reads as broken even though it is correct. This
 * picks the most meaningful non-zero number instead: genuine turnover when the market has traded,
 * otherwise its seeded LIQUIDITY (pool depth, populated for ~92% of markets), otherwise "New".
 *
 * Inputs are pre-formatted USD strings from formatOnchainUsd; "$0" is the exact zero sentinel (a
 * real $0.005 formats as "<$0.01", never "$0"), so a plain string compare is sufficient — no parse.
 */
export function cardMetric(market: { volume?: string; liquidity?: string }): { value: string; label: string } {
  const nonZero = (s: string | undefined): s is string => Boolean(s) && s !== '$0';
  if (nonZero(market.volume)) return { value: market.volume, label: 'Vol.' };
  if (nonZero(market.liquidity)) return { value: market.liquidity, label: 'Liq.' };
  return { value: 'New', label: '' };
}
