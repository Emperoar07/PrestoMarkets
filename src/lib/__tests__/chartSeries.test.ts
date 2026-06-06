import { describe, expect, it } from 'vitest';
import { buildChartOutcomeSeries } from '../chartSeries';

describe('buildChartOutcomeSeries', () => {
  it('uses live odds as the final chart value without rounding them into clamp bounds', () => {
    const result = buildChartOutcomeSeries({
      outcomes: [
        { label: 'YES', odds: 4 },
        { label: 'NO', odds: 95 },
      ],
      history: null,
    });

    expect(result.hasCredibleHistory).toBe(false);
    expect(result.series.map((item) => item.odds)).toEqual([4, 95]);
    expect(result.series.map((item) => item.points)).toEqual([
      [4, 4],
      [95, 95],
    ]);
  });

  it('drops binary history that implies impossible 100/0 jumps from missing starting liquidity', () => {
    const result = buildChartOutcomeSeries({
      outcomes: [
        { label: 'YES', odds: 4 },
        { label: 'NO', odds: 95 },
      ],
      history: [
        { t: 1, probabilities: [1, 0] },
        { t: 2, probabilities: [0.5, 0.5] },
        { t: 3, probabilities: [0.04, 0.96] },
      ],
    });

    expect(result.hasCredibleHistory).toBe(false);
    expect(result.series.map((item) => item.points)).toEqual([
      [4, 4],
      [95, 95],
    ]);
  });

  it('keeps credible multi-point history and appends live odds as now', () => {
    const result = buildChartOutcomeSeries({
      outcomes: [
        { label: 'YES', odds: 62 },
        { label: 'NO', odds: 38 },
      ],
      history: [
        { t: 1, probabilities: [0.55, 0.45] },
        { t: 2, probabilities: [0.58, 0.42] },
      ],
    });

    expect(result.hasCredibleHistory).toBe(true);
    expect(result.series.map((item) => item.points)).toEqual([
      [55, 58, 62],
      [45, 42, 38],
    ]);
  });
});
