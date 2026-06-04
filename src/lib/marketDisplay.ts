import type { Market } from './markets';

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
export type DisplayType = 'binary' | 'multi_outcome' | 'date_ladder' | 'sports_live' | 'pulse_gauge';

const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)';
const DATE_LIKE = new RegExp(
  `(?:${MONTHS}[a-z]*\\.?\\s*\\d{1,2}|\\d{1,2}\\s*${MONTHS}|\\d{4}-\\d{2}-\\d{2}|q[1-4]\\s*20\\d{2}|\\b20\\d{2}\\b)`,
  'i',
);

// Directional / short-horizon "pulse" signals — the only place a chance gauge belongs.
const PULSE_RE = /\b(up or down|higher or lower|\d+\s*(?:m|min|mins|h|hr|hrs)\b|next hour|this hour|hourly|by end of (?:the )?day|by today|intraday)\b/i;

type DisplayInput = Pick<Market, 'pollOptions' | 'type' | 'category' | 'title'> & {
  displayType?: DisplayType;
};

export function looksLikeDateOption(option: string): boolean {
  return DATE_LIKE.test(option.trim());
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
