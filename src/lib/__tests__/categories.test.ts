import { describe, expect, it } from 'vitest';
import { extractMarketCategories, mergeTopicNavCategories, topicNavCategories } from '../categories';

describe('dynamic category helpers', () => {
  it('ranks present categories by frequency and excludes view/junk labels', () => {
    const markets = [
      { categories: ['Space', 'Tech'] },
      { categories: ['Space'] },
      { category: 'Trending' }, // view label — excluded
      { category: 'Gaming' },
      { categories: ['space'] }, // merges case-insensitively with Space
    ];
    const result = extractMarketCategories(markets);
    expect(result[0]).toBe('Space'); // 3 occurrences ranks first
    expect(result).toContain('Tech');
    expect(result).toContain('Gaming');
    expect(result).not.toContain('Trending');
  });

  it('merges discovered categories after the curated base, deduped, junk removed', () => {
    const merged = mergeTopicNavCategories(['Space', 'Crypto', 'all', 'Gaming']);
    expect(merged.slice(0, topicNavCategories.length)).toEqual([...topicNavCategories]);
    expect(merged).toContain('Space');
    expect(merged).toContain('Gaming');
    expect(merged.filter((category) => category.toLowerCase() === 'crypto')).toHaveLength(1);
    expect(merged).not.toContain('all');
  });

  it('falls back to exactly the base list when no markets are present', () => {
    expect(mergeTopicNavCategories(extractMarketCategories([]))).toEqual([...topicNavCategories]);
  });
});
