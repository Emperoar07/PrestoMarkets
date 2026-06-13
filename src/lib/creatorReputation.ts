import type { AppMarket } from './appState';

export type CreatorTier = 'Newcomer' | 'Bronze' | 'Silver' | 'Gold';

export type CreatorReputation = {
  address: string;
  created: number;
  open: number;
  resolved: number;
  canceled: number;
  /** Share of concluded markets (resolved+canceled) that resolved cleanly (0..1), null if none concluded. */
  resolvedRate: number | null;
  /** Approx total volume across the creator's markets (parsed from display strings). */
  volumeUsd: number;
  tier: CreatorTier;
  topCategories: string[];
};

// Parse a compact display volume like "$1.2K" / "$3.4M" / "$820" back to a number.
function parseVolume(display: string): number {
  const match = /\$?\s*([\d.]+)\s*([KkMm]?)/.exec(display ?? '');
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = match[2].toUpperCase();
  return unit === 'M' ? value * 1_000_000 : unit === 'K' ? value * 1_000 : value;
}

function tierFor(created: number): CreatorTier {
  if (created >= 15) return 'Gold';
  if (created >= 5) return 'Silver';
  if (created >= 1) return 'Bronze';
  return 'Newcomer';
}

/**
 * Per-creator reputation derived from on-chain markets. Only CONCLUDED markets count toward the
 * resolved rate, so pending/open markets never inflate (or deflate) it.
 */
export function computeCreatorReputation(markets: AppMarket[], address: string): CreatorReputation {
  const target = address.toLowerCase();
  const mine = markets.filter((m) => m.creatorAddress?.toLowerCase() === target);

  let open = 0, resolved = 0, canceled = 0, volumeUsd = 0;
  const categoryCounts = new Map<string, number>();
  for (const market of mine) {
    volumeUsd += parseVolume(market.volume);
    if (market.status === 'Resolved') resolved += 1;
    else if (market.status === 'Canceled') canceled += 1;
    else open += 1;
    for (const category of market.categories ?? (market.category ? [market.category] : [])) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  const concluded = resolved + canceled;
  const topCategories = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => category);

  return {
    address: target,
    created: mine.length,
    open,
    resolved,
    canceled,
    resolvedRate: concluded > 0 ? resolved / concluded : null,
    volumeUsd,
    tier: tierFor(mine.length),
    topCategories,
  };
}
