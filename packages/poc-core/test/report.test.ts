import { describe, expect, it } from 'vitest';
import { MODELS } from '../src/models';
import { costUsd } from '../src/pricing';
import { buildPocReport, comparableReport, renderReportMarkdown, sumSpans, type PocReportInput } from '../src/report';
import type { Baseline, Span } from '../src/schemas';
import { escapeMarkdown } from '../src/text';

const median = { performance: 61, lcp: 18329.984, cls: 0.1267, tbt: 229, fcp: 2245.984, ttfb: 47, jsBytes: 59676, accessibility: 85, seo: 82 };
const baseline: Baseline = {
  url: 'https://akim136.github.io/v-copilot/prospect-landing/',
  measuredAt: '2026-10-10T00:01:00.000Z',
  lighthouseVersion: '13.5.0',
  runs: [median, median, median],
  median,
  opportunities: [],
  scriptBytes: {},
  psiField: { LARGEST_CONTENTFUL_PAINT_MS: 4100 },
};
const usage = { inputTokens: 5000, cachedInputTokens: 1024, cacheWriteTokens: 0, outputTokens: 800 };
const span = (u = usage, attempt = 1): Span => ({
  runId: 'wrun_A', step: 'analyze', model: MODELS.terra, attempt, ...u, costUsd: costUsd(MODELS.terra, u), latencyMs: 1200, mode: 'live', startedAt: '2026-10-10T00:02:00.000Z',
});
const target = { name: 'prospect-landing', url: baseline.url, kind: 'fixture', permission: 'owned' } as const;
const criteria = [{ id: 'c1', metric: 'lcp', baseline: 18329.984, target: 2500, rationale: 'Hero image is the LCP element.' }] as const;
const input = (o: Partial<PocReportInput> = {}): PocReportInput => ({
  runId: 'wrun_A', mode: 'plan', brief: 'Make it fast', status: 'planned', target, baseline, criteria: [...criteria],
  spans: [span()], timingsMs: { intake: 900, baseline: 41000 }, ...o,
});

describe('buildPocReport', () => {
  it('prices the run as the sum of its model calls, each priced from its tokens', () => {
    const worst = { inputTokens: 9000, cachedInputTokens: 0, cacheWriteTokens: 9000, outputTokens: 16000 };
    const spans = [span(), span(worst, 2)];
    const report = buildPocReport(input({ spans }));
    const expected = costUsd(MODELS.terra, usage) + costUsd(MODELS.terra, worst);
    expect(report.costUsd).toBe(expected);
    expect(report.tokens).toEqual({ input: 14000, cachedInput: 1024, output: 16800 });
    expect(sumSpans(spans).costUsd).toBe(expected);
  });

  it('records three runs, the median of every metric and PSI field data', () => {
    const report = buildPocReport(input());
    expect(report.baseline).toEqual({ lighthouse: median, runs: 3, psiField: { LARGEST_CONTENTFUL_PAINT_MS: 4100 } });
    expect(report).toMatchObject({ target: 'prospect-landing', kind: 'fixture', permission: 'owned', status: 'planned' });
  });

  it('builds a not_allowlisted rejection without kind, permission or baseline', () => {
    const report = buildPocReport(input({ status: 'rejected', rejectReason: 'not_allowlisted', target: { requested: 'https://evil.example/' }, baseline: undefined, criteria: [], spans: [] }));
    expect(report).toMatchObject({ target: 'https://evil.example/', url: 'https://evil.example/', status: 'rejected', rejectReason: 'not_allowlisted', costUsd: 0 });
    expect(report.kind).toBeUndefined();
    expect(report.permission).toBeUndefined();
  });

  it('accepts a criteria rejection and refuses a planned report without a baseline', () => {
    expect(buildPocReport(input({ status: 'rejected', rejectReason: 'criteria_rejected' })).rejectReason).toBe('criteria_rejected');
    expect(() => buildPocReport(input({ baseline: undefined }))).toThrow(/baseline/);
  });

  it('compares replays without the run ID or timings', () => {
    const a = buildPocReport(input());
    const b = buildPocReport(input({ runId: 'wrun_B', timingsMs: { intake: 1 } }));
    expect(comparableReport(a)).toEqual(comparableReport(b));
    expect(comparableReport(a)).not.toHaveProperty('runId');
  });
});

describe('report markdown', () => {
  const hostile = '[click](https://evil.example) ![x](https://evil.example/p.png) <script>alert(1)</script> | www.evil.example';

  it('escapes model and page text so it cannot add links, images, HTML or table cells', () => {
    const md = renderReportMarkdown(buildPocReport(input({ brief: hostile, criteria: [{ ...criteria[0], rationale: hostile }] })), {
      opportunities: [{ title: hostile, detail: hostile, metrics: ['lcp'] }],
      sections: [{ kind: 'hero', name: hostile, ids: ['h-0-aaaaaaaa'] }],
    });
    expect(md).not.toMatch(/[^\\]\]\(/);
    expect(md).not.toMatch(/[^\\]</);
    expect(md).not.toMatch(/www\.evil/);
    expect(md).toContain('\\[click\\]');
  });

  it('shows the medians, the criteria, the cost and the status', () => {
    const md = renderReportMarkdown(buildPocReport(input()), {});
    expect(md).toContain('planned');
    expect(md).toMatch(/LCP \| 18,330 ms/);
    expect(md).toMatch(/c1 \| LCP \| 18,330 ms \| 2,500 ms/);
    expect(md).toMatch(/median of 3 lighthouse runs/i);
    expect(md).toMatch(/\$0\.\d{4}/);
  });

  it('escapes every ASCII punctuation character and flattens lines', () => {
    expect(escapeMarkdown('a*b\n\n_c_ `d` #e')).toBe('a\\*b \\_c\\_ \\`d\\` \\#e');
  });
});
