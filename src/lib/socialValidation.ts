import { isAddress } from 'viem';
import { sanitizeFeedText } from './feedSanitizer';
import { normalizeSocialAddress } from './socialAuth';

export type AlertTypes = {
  closeSoon: boolean;
  priceMove: boolean;
  resolved: boolean;
  claim: boolean;
};

export type LeaderboardMetric = 'pnl' | 'accuracy' | 'created';
export type LeaderboardPeriod = 'all' | '30d';

const COMMENT_MAX_LENGTH = 1_000;

export function normalizeMarketId(value: string | undefined | null): string | null {
  if (!value || !isAddress(value)) return null;
  return value.toLowerCase();
}

export function sanitizeCommentBody(value: string | undefined | null): string {
  return sanitizeFeedText(value ?? '').slice(0, COMMENT_MAX_LENGTH).trim();
}

export function sanitizeProfileText(value: string | undefined | null, maxLength: number): string {
  return sanitizeFeedText(value ?? '').slice(0, maxLength).trim();
}

export function sanitizeHandle(value: string | undefined | null): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);
}

export function parseAlertTypes(value: unknown): AlertTypes {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return {
    closeSoon: raw.closeSoon === true,
    priceMove: raw.priceMove === true,
    resolved: raw.resolved === true,
    claim: raw.claim === true,
  };
}

export function parseLeaderboardQuery(url: URL): { metric: LeaderboardMetric; period: LeaderboardPeriod } {
  const metricParam = url.searchParams.get('metric');
  const periodParam = url.searchParams.get('period');
  const metric: LeaderboardMetric = metricParam === 'accuracy' || metricParam === 'created' ? metricParam : 'pnl';
  const period: LeaderboardPeriod = periodParam === '30d' ? '30d' : 'all';
  return { metric, period };
}

export function getSessionAddress(value: string | undefined | null): string | null {
  return normalizeSocialAddress(value);
}
