import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('favicon', () => {
  it('ships a real ICO file for browsers that do not use the SVG icon', () => {
    const bytes = readFileSync('public/favicon.ico');

    expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
  });
});
