import type { MarketType, ResolutionMode } from './markets';

export type MarketCreatedByType = 'user' | 'admin' | 'agent';

export type AgentMarketMetadata = {
  createdByType?: MarketCreatedByType;
  agentName?: string;
  agentSource?: string;
  agentModel?: string;
  agentReason?: string;
  agentConfidence?: string;
  trendSource?: string;
  trendUrl?: string;
  momentumScore?: number;
  safetyScore?: number;
};

export type MarketMetadata = AgentMarketMetadata & {
  name: string;
  description: string;
  /** Primary category (kept for backward compat with markets created before multi-category). */
  category: string;
  /** Up to MAX_CATEGORIES tags. Empty = derive from category alone. */
  categories?: string[];
  imageURI?: string;
  image?: string;
  outcomeOptions?: string[];
  rules: string;
  sourceOfTruth: string;
  resolutionMode: ResolutionMode;
  collateral?: 'USDC' | 'EURC';
};

export type BuildMarketMetadataInput = {
  type: MarketType;
  title: string;
  description: string;
  category: string;
  categories?: string[];
  rules: string;
  sourceOfTruth: string;
  resolutionMode: ResolutionMode | string;
  imageURI?: string;
  outcomeOptions?: string[];
  collateral?: 'USDC' | 'EURC';
  agent?: AgentMarketMetadata;
};

export const MAX_CATEGORIES = 4;

/** Normalize a categories list: dedupe, trim, max length, max count. Always returns at least [primary]. */
export function normalizeCategories(input: { category: string; categories?: string[] }): string[] {
  const list = [input.category, ...(input.categories ?? [])]
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of list) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c.slice(0, 40));
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

const DATA_PREFIX = 'data:application/json,';

const MAX = { title: 200, description: 1000, rules: 2000, sourceOfTruth: 500, agentReason: 500, trendUrl: 300, imageURI: 500_000, outcomeOption: 80 };
const MIN = { title: 8, description: 12, rules: 20, sourceOfTruth: 10 };

const SAFE_URL_SCHEMES = new Set(['http:', 'https:']);
const SAFE_IMAGE_DATA_PREFIXES = ['data:image/png', 'data:image/jpeg', 'data:image/jpg', 'data:image/gif', 'data:image/webp'];

function trunc(s: string | undefined, max: number): string | undefined {
  return s && s.length > max ? s.slice(0, max) : s;
}

export function isSafeUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return SAFE_URL_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Resolution URIs may be http/https OR a data:application/json blob (the
 * auto-resolver writes the latter). Any other scheme is rejected, since the
 * resolver is chosen per-market and the factory is permissionless, so an
 * attacker can plant a malicious URI by being their own market's resolver.
 */
export function isSafeResolutionUri(value: string | undefined): value is string {
  if (!value) return false;
  const v = value.trim();
  if (v.startsWith('data:application/json,') || v.startsWith('data:application/json;')) return true;
  return isSafeUrl(v);
}

function isSafeImage(value: string | undefined): value is string {
  if (!value) return false;
  const v = value.trim();
  if (SAFE_IMAGE_DATA_PREFIXES.some((p) => v.startsWith(`${p};`) || v.startsWith(`${p},`))) {
    return v.length <= MAX.imageURI;
  }
  return isSafeUrl(v);
}

function assertSafeUrl(value: string | undefined, label: string): void {
  if (!value) return;
  if (!isSafeUrl(value)) {
    throw new Error(`${label} must be a valid http or https URL.`);
  }
}

function assertSafeImage(value: string | undefined): void {
  if (!value) return;
  if (!isSafeImage(value)) {
    throw new Error('imageURI must be an http/https URL or a data:image/{png,jpeg,gif,webp} payload under the size budget.');
  }
}

function assertMinLength(value: string, min: number, label: string): void {
  if (value.trim().length < min) {
    throw new Error(`${label} must be at least ${min} characters.`);
  }
}

export function validateMetadataInputs(input: BuildMarketMetadataInput): void {
  assertMinLength(input.title, MIN.title, 'Title');
  assertMinLength(input.description, MIN.description, 'Description');
  assertMinLength(input.rules, MIN.rules, 'Rules');
  assertMinLength(input.sourceOfTruth, MIN.sourceOfTruth, 'Source of truth');
  assertSafeImage(input.imageURI);
  assertSafeUrl(input.agent?.trendUrl, 'Agent trend URL');
  if (input.outcomeOptions) {
    const cleanOptions = input.outcomeOptions.map((option) => option.trim()).filter(Boolean);
    if (cleanOptions.length < 2) throw new Error('Add at least two poll options.');
    if (cleanOptions.length > 12) throw new Error('Poll options are capped at 12.');
    if (new Set(cleanOptions.map((option) => option.toLowerCase())).size !== cleanOptions.length) {
      throw new Error('Poll options must be unique.');
    }
  }
}

export function buildMarketMetadata(input: BuildMarketMetadataInput): MarketMetadata {
  validateMetadataInputs(input);
  const outcomeOptions = input.outcomeOptions
    ?.map((option) => option.trim())
    .filter(Boolean)
    .map((option) => trunc(option, MAX.outcomeOption) ?? option);
  const categories = normalizeCategories(input);

  return {
    name: trunc(input.title, MAX.title) ?? input.title,
    description: trunc(input.description, MAX.description) ?? input.description,
    category: categories[0] ?? input.category,
    categories,
    imageURI: input.imageURI,
    outcomeOptions,
    rules: trunc(input.rules, MAX.rules) ?? input.rules,
    sourceOfTruth: trunc(input.sourceOfTruth, MAX.sourceOfTruth) ?? input.sourceOfTruth,
    resolutionMode: input.resolutionMode as ResolutionMode,
    collateral: input.collateral ?? 'USDC',
    createdByType: input.agent?.createdByType ?? 'user',
    agentName: input.agent?.agentName,
    agentSource: input.agent?.agentSource,
    agentModel: input.agent?.agentModel,
    agentReason: trunc(input.agent?.agentReason, MAX.agentReason),
    agentConfidence: input.agent?.agentConfidence,
    trendSource: input.agent?.trendSource,
    trendUrl: trunc(input.agent?.trendUrl, MAX.trendUrl),
    momentumScore: input.agent?.momentumScore,
    safetyScore: input.agent?.safetyScore,
  };
}

export function buildMarketMetadataURI(input: BuildMarketMetadataInput) {
  return `${DATA_PREFIX}${encodeURIComponent(JSON.stringify(buildMarketMetadata(input)))}`;
}

export function parseMarketMetadata(metadataURI: string): Partial<MarketMetadata> | null {
  if (!metadataURI.startsWith(DATA_PREFIX)) return null;

  let parsed: Partial<MarketMetadata>;
  try {
    parsed = JSON.parse(decodeURIComponent(metadataURI.slice(DATA_PREFIX.length))) as Partial<MarketMetadata>;
  } catch {
    return null;
  }

  // Defence in depth: the factory is permissionless, so anyone can write attacker-controlled
  // strings into onchain metadata. Drop any field that fails the same validation we apply on
  // creation rather than rendering javascript:/data:text/html into the UI.
  if (!isSafeImage(parsed.imageURI)) parsed.imageURI = undefined;
  if (!isSafeUrl(parsed.trendUrl)) parsed.trendUrl = undefined;
  if (parsed.categories) {
    parsed.categories = parsed.categories
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, MAX_CATEGORIES);
    if (parsed.categories.length === 0) parsed.categories = undefined;
  }
  if (parsed.outcomeOptions) {
    parsed.outcomeOptions = parsed.outcomeOptions
      .filter((option): option is string => typeof option === 'string')
      .map((option) => option.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return parsed;
}
