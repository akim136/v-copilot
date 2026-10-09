import { describe, expect, it } from 'vitest';
import { reconcileCriteria, type DraftCriterion } from '../src/criteria';
import type { MetricValues } from '../src/schemas';

const median: MetricValues = { performance: 61, lcp: 18329.984, cls: 0.1267, tbt: 229, fcp: 2245.984, ttfb: 47, jsBytes: 59676, accessibility: 85, seo: 82 };
const d = (metric: DraftCriterion['metric'], target: number, baseline = 0, rationale = 'Oversized hero image is the LCP element.'): DraftCriterion => ({ metric, baseline, target, rationale });

describe('reconcileCriteria', () => {
  it('sets each baseline to the measured median and numbers the criteria', () => {
    const { criteria, dropped } = reconcileCriteria([d('lcp', 2500, 12345), d('performance', 90)], median);
    expect(dropped).toEqual([]);
    expect(criteria).toEqual([
      { id: 'c1', metric: 'lcp', baseline: 18329.984, target: 2500, rationale: 'Oversized hero image is the LCP element.' },
      { id: 'c2', metric: 'performance', baseline: 61, target: 90, rationale: 'Oversized hero image is the LCP element.' },
    ]);
  });

  it('drops targets that are not strictly better than the baseline, in either direction', () => {
    const { criteria, dropped } = reconcileCriteria([d('lcp', 20000), d('cls', 0.1267), d('seo', 80), d('accessibility', 85)], median);
    expect(criteria).toEqual([]);
    expect(dropped.map((x) => x.reason)).toEqual(Array(4).fill('no improvement on baseline'));
  });

  it('drops invalid targets, duplicate metrics and empty rationales', () => {
    const { criteria, dropped } = reconcileCriteria([
      d('performance', 101), d('tbt', -5), d('fcp', Number.NaN), d('lcp', 2500), d('lcp', 2000), d('cls', 0.05, 0, '  \n '),
    ], median);
    expect(criteria.map((c) => c.metric)).toEqual(['lcp']);
    expect(dropped).toEqual([
      { metric: 'performance', reason: 'invalid target' },
      { metric: 'tbt', reason: 'invalid target' },
      { metric: 'fcp', reason: 'invalid target' },
      { metric: 'lcp', reason: 'duplicate metric' },
      { metric: 'cls', reason: 'no rationale' },
    ]);
  });

  it('flattens a rationale to one line of at most 200 characters', () => {
    const { criteria } = reconcileCriteria([d('lcp', 2500, 0, `Line one\nline two ${'x'.repeat(300)}`)], median);
    expect(criteria[0]!.rationale).toMatch(/^Line one line two x+$/);
    expect(criteria[0]!.rationale.length).toBe(200);
  });

  it('keeps at most five criteria', () => {
    const { criteria, dropped } = reconcileCriteria([
      d('lcp', 2500), d('cls', 0.05), d('tbt', 100), d('fcp', 1500), d('performance', 90), d('seo', 95),
    ], median);
    expect(criteria).toHaveLength(5);
    expect(dropped).toEqual([{ metric: 'seo', reason: 'too many criteria' }]);
  });
});
