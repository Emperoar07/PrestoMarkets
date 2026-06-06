import { describe, expect, it } from 'vitest';
import {
  detectCryptoLogoUrl,
  detectSportsTeamSearchName,
  detectCountryFlagUrl,
  extractSubject,
} from '../marketSubjectImage';

describe('marketSubjectImage', () => {
  it('uses simple coin logos for crypto subjects', () => {
    expect(detectCryptoLogoUrl('Will XRP close above $1 by Friday?')).toContain('/coins/images/44/');
    expect(detectCryptoLogoUrl('Bitcoin price on Jun 5, 2026?')).toContain('/coins/images/1/');
    expect(detectCryptoLogoUrl('Will Solana ETF volume beat Ethereum?')).toContain('/coins/images/4128/');
  });

  it('detects sports club and team names from market wording', () => {
    expect(detectSportsTeamSearchName('Will Arsenal beat Chelsea?')).toBe('Arsenal');
    expect(detectSportsTeamSearchName('Los Angeles Lakers vs Boston Celtics')).toBe('Los Angeles Lakers');
    expect(detectSportsTeamSearchName('Will Lamine Yamal play in Spain World Cup opener?')).toBeUndefined();
  });

  it('keeps country flags and person/org subject extraction as fallbacks', () => {
    expect(detectCountryFlagUrl('Iran presidential election')).toBe('https://flagcdn.com/w320/ir.png');
    expect(extractSubject('Will SoftBank begin construction in France?')).toBe('SoftBank');
  });
});
