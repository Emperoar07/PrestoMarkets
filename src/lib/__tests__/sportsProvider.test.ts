import { afterEach, describe, expect, it } from 'vitest';
import { getSportsDbApiKey } from '../sportsProvider';

describe('getSportsDbApiKey', () => {
  const previous = process.env.THESPORTSDB_API_KEY;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.THESPORTSDB_API_KEY;
    } else {
      process.env.THESPORTSDB_API_KEY = previous;
    }
  });

  it('does not fall back to the public demo key', () => {
    delete process.env.THESPORTSDB_API_KEY;

    expect(getSportsDbApiKey()).toBeNull();
  });

  it('returns a configured key after trimming whitespace', () => {
    process.env.THESPORTSDB_API_KEY = '  real-key  ';

    expect(getSportsDbApiKey()).toBe('real-key');
  });
});
