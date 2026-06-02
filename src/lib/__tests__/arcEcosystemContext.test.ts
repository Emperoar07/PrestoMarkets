import { describe, expect, it } from 'vitest';
import {
  getArcEcosystemPriorityBoost,
  isArcCommunityContextUrl,
  isArcInstitutionalMarketTheme,
} from '../arcEcosystemContext';

describe('arc ecosystem context policy', () => {
  it('treats Arc House URLs as context-only sources', () => {
    expect(isArcCommunityContextUrl('https://community.arc.io/public/externals/build-institutional-grade-prediction-markets-on-arc')).toBe(true);
    expect(isArcCommunityContextUrl('https://docs.arc.network/arc/concepts/stablecoin-native-model')).toBe(false);
  });

  it('boosts Arc-aligned institutional themes without boosting community posts', () => {
    expect(isArcInstitutionalMarketTheme({
      topic: 'Will the Fed cut interest rates after the next CPI print?',
      query: 'Macro policy decision with public data release',
      source: 'google-news',
    })).toBe(true);

    expect(getArcEcosystemPriorityBoost({
      topic: 'Will the Fed cut interest rates after the next CPI print?',
      query: 'Macro policy decision with public data release',
      source: 'google-news',
      url: 'https://www.reuters.com/markets/',
    })).toBe(6);

    expect(getArcEcosystemPriorityBoost({
      topic: 'Build institutional prediction markets on Arc',
      query: 'Arc ecosystem context',
      source: 'arc-house',
      url: 'https://community.arc.io/public/externals/build-institutional-grade-prediction-markets-on-arc',
    })).toBe(0);
  });
});
