import { describe, expect, it } from 'vitest';
import { deriveDisplayType, looksLikeDateOption } from '../marketDisplay';

const base = { type: 'Prediction' as const, category: 'Crypto', title: '', pollOptions: undefined };

describe('looksLikeDateOption', () => {
  it('recognizes month/day, ISO, and year forms', () => {
    expect(looksLikeDateOption('June 30')).toBe(true);
    expect(looksLikeDateOption('July 31')).toBe(true);
    expect(looksLikeDateOption('2026-12-31')).toBe(true);
    expect(looksLikeDateOption('Keiko Fujimori')).toBe(false);
  });
});

describe('deriveDisplayType', () => {
  it('defaults a plain binary market to binary (no gauge)', () => {
    expect(deriveDisplayType({ ...base, title: 'Will Bitcoin close above $100k by Dec 31, 2026?' })).toBe('binary');
  });

  it('flags directional/short-window markets as pulse_gauge', () => {
    expect(deriveDisplayType({ ...base, title: 'Bitcoin Up or Down 5m' })).toBe('pulse_gauge');
    expect(deriveDisplayType({ ...base, title: 'Will ETH be higher or lower next hour?' })).toBe('pulse_gauge');
    expect(deriveDisplayType({ ...base, title: 'Resolve within 15 minutes?' })).toBe('pulse_gauge');
  });

  it('does not read dollar millions or deadlines as pulse', () => {
    expect(deriveDisplayType({ ...base, title: 'Will the DOJ confirm the $3.8M freeze by end of June?' })).toBe('binary');
    expect(deriveDisplayType({ ...base, title: 'Will the company raise $100M this year?' })).toBe('binary');
  });

  it('classifies a candidate list as multi_outcome', () => {
    expect(deriveDisplayType({ ...base, category: 'Politics', title: 'Peru election winner', pollOptions: ['Keiko Fujimori', 'Roberto Sanchez', 'Other'] })).toBe('multi_outcome');
  });

  it('classifies a date list as date_ladder', () => {
    expect(deriveDisplayType({ ...base, title: 'Trump declassifies UFO files by…?', pollOptions: ['June 15', 'June 30', 'July 31'] })).toBe('date_ladder');
  });

  it('respects an explicit agent-set displayType', () => {
    expect(deriveDisplayType({ ...base, displayType: 'sports_live', title: 'Knicks vs Spurs' })).toBe('sports_live');
  });
});
