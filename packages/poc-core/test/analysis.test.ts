import { describe, expect, it } from 'vitest';
import { reconcileAnalysis } from '../src/analysis';
import type { AnalyzeOutput } from '../src/prompts/analyze';
import type { MetricValues, Outline } from '../src/schemas';

const median: MetricValues = { performance: 61, lcp: 18329.984, cls: 0.1267, tbt: 229, fcp: 2245.984, ttfb: 47, jsBytes: 59676, accessibility: 85, seo: 82 };
const outline: Outline = {
  headings: [{ id: 'h-0-aaaaaaaa', level: 1, text: 'Hello' }],
  textBlocks: [{ id: 't-0-bbbbbbbb', text: 'Body', preview: 'Body' }, { id: 't-1-cccccccc', text: 'More', preview: 'More' }],
  images: [{ id: 'i-0-dddddddd', src: 'https://x/a.png', alt: '', width: 10, height: 10, content: false }],
  landmarks: [],
  scripts: [],
  order: ['h-0-aaaaaaaa', 't-0-bbbbbbbb', 'i-0-dddddddd', 't-1-cccccccc'],
};
const output = (o: Partial<AnalyzeOutput>): AnalyzeOutput => ({ sections: [], opportunities: [], criteria: [], ...o });

describe('reconcileAnalysis', () => {
  it('keeps only outline IDs, gives each ID to one section and drops empty sections', () => {
    const { sections } = reconcileAnalysis(output({
      sections: [
        { kind: 'hero', name: 'Hero', ids: ['h-0-aaaaaaaa', 'x-9-made-up', 't-0-bbbbbbbb'] },
        { kind: 'content', name: 'Body', ids: ['t-0-bbbbbbbb', 'i-0-dddddddd'] },
        { kind: 'faq', name: 'Invented', ids: ['nope'] },
      ],
    }), outline, median);
    expect(sections).toEqual([
      { kind: 'hero', name: 'Hero', ids: ['h-0-aaaaaaaa', 't-0-bbbbbbbb'] },
      { kind: 'content', name: 'Body', ids: ['i-0-dddddddd'] },
    ]);
  });

  it('flattens and clips section names, falling back to the kind', () => {
    const { sections } = reconcileAnalysis(output({
      sections: [
        { kind: 'hero', name: `  Big\n\nhero ${'x'.repeat(200)}`, ids: ['h-0-aaaaaaaa'] },
        { kind: 'footer', name: '   ', ids: ['t-1-cccccccc'] },
      ],
    }), outline, median);
    expect(sections[0]!.name).toBe(`Big hero ${'x'.repeat(71)}`);
    expect(sections[0]!.name.length).toBe(80);
    expect(sections[1]!.name).toBe('footer');
  });

  it('keeps at most six opportunities with clipped one-line text and unique metrics', () => {
    const opp = (i: number) => ({ title: `Title ${i}\nsecond line`, detail: 'd'.repeat(400), metrics: ['lcp', 'lcp', 'tbt'] as AnalyzeOutput['opportunities'][number]['metrics'] });
    const { opportunities } = reconcileAnalysis(output({ opportunities: [{ title: ' ', detail: 'x', metrics: [] }, ...Array.from({ length: 8 }, (_, i) => opp(i))] }), outline, median);
    expect(opportunities).toHaveLength(6);
    expect(opportunities[0]).toEqual({ title: 'Title 0 second line', detail: 'd'.repeat(300), metrics: ['lcp', 'tbt'] });
  });

  it('reconciles criteria against the measured median', () => {
    const { criteria, dropped } = reconcileAnalysis(output({
      criteria: [
        { metric: 'lcp', baseline: 1, target: 2500, rationale: 'Hero image is the LCP element.' },
        { metric: 'seo', baseline: 82, target: 70, rationale: 'Worse.' },
      ],
    }), outline, median);
    expect(criteria).toEqual([{ id: 'c1', metric: 'lcp', baseline: 18329.984, target: 2500, rationale: 'Hero image is the LCP element.' }]);
    expect(dropped).toEqual([{ metric: 'seo', reason: 'no improvement on baseline' }]);
  });
});
