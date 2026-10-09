import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lighthouseArgs, median, medianMetrics, medianRun, parseLighthouseResult, type LighthouseRun } from '../src/lighthouse';
import type { MetricValues } from '../src/schemas';

// Trimmed from a real Lighthouse 13.5.0 mobile run on prospect-landing (2026-10-09).
type Lhr = { categories: Record<string, { score: number | null }>; audits: Record<string, unknown>; [key: string]: unknown };
const lhr = () => JSON.parse(readFileSync(new URL('./fixtures/lhr-prospect-landing.json', import.meta.url), 'utf8')) as Lhr;

describe('parseLighthouseResult', () => {
  it('reads all nine metrics from a real result', () => {
    const run = parseLighthouseResult(lhr());
    expect(run.lighthouseVersion).toBe('13.5.0');
    expect(run.metrics).toEqual({
      performance: 61, lcp: 18329.984, cls: 0.126708687727825, tbt: 229, fcp: 2245.984, ttfb: 47,
      jsBytes: 59226 + 450, accessibility: 85, seo: 82,
    });
  });

  it('lists failing opportunities from every category and nothing that passed', () => {
    const ids = parseLighthouseResult(lhr()).opportunities.map((o) => `${o.category}:${o.id}`);
    expect(ids).toEqual(expect.arrayContaining([
      'performance:render-blocking-insight', 'performance:image-delivery-insight', 'performance:cache-insight',
      'performance:unsized-images', 'accessibility:color-contrast', 'accessibility:image-alt', 'seo:meta-description',
    ]));
    expect(ids).not.toContain('performance:layout-shifts'); // hidden group
    expect(ids).not.toContain('performance:document-latency-insight'); // passed
    const blocking = parseLighthouseResult(lhr()).opportunities.find((o) => o.id === 'render-blocking-insight');
    expect(blocking).toMatchObject({ title: 'Render-blocking requests', savings: { FCP: 1400 } });
  });

  it('rejects a run with a runtime error', () => {
    expect(() => parseLighthouseResult({ ...lhr(), runtimeError: { code: 'NO_FCP' } })).toThrow(/runtime error/);
  });

  it('rejects a category that errored instead of reporting zero', () => {
    const bad = lhr();
    bad.categories.seo!.score = null;
    expect(() => parseLighthouseResult(bad)).toThrow();
  });

  it('rejects a desktop run and a result missing network requests', () => {
    expect(() => parseLighthouseResult({ ...lhr(), configSettings: { formFactor: 'desktop' } })).toThrow();
    const bad = lhr();
    delete bad.audits['network-requests'];
    expect(() => parseLighthouseResult(bad)).toThrow();
  });
});

describe('medians', () => {
  it('takes the middle value, or the mean of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it('computes each metric independently across runs', () => {
    const base = parseLighthouseResult(lhr()).metrics;
    const runs: MetricValues[] = [
      { ...base, lcp: 18000, performance: 60 },
      { ...base, lcp: 19000, performance: 62 },
      { ...base, lcp: 18500, performance: 58 },
    ];
    expect(medianMetrics(runs)).toEqual({ ...base, lcp: 18500, performance: 60 });
  });

  it('picks the run with the median performance score', () => {
    const run = (performance: number): LighthouseRun => ({ lighthouseVersion: '13.5.0', metrics: { ...parseLighthouseResult(lhr()).metrics, performance }, opportunities: [] });
    expect(medianRun([run(70), run(50), run(60)]).metrics.performance).toBe(60);
  });
});

describe('lighthouseArgs', () => {
  it('puts the URL first and writes JSON for the three categories on the mobile default', () => {
    const args = lighthouseArgs('https://akim136.github.io/v-copilot/prospect-landing/', '/tmp/lh-1.json');
    expect(args[0]).toBe('https://akim136.github.io/v-copilot/prospect-landing/');
    expect(args).toContain('--output-path=/tmp/lh-1.json');
    expect(args).toContain('--only-categories=performance,accessibility,seo');
    expect(args.some((a) => a.includes('preset') || a.includes('form-factor'))).toBe(false);
  });

  it.each([
    ['http URL', 'http://example.com/', '/tmp/a.json'],
    ['flag-like URL', '--chrome-flags=x', '/tmp/a.json'],
    ['path outside /tmp', 'https://example.com/', '/etc/passwd'],
    ['path traversal', 'https://example.com/', '/tmp/../etc/x.json'],
  ])('rejects %s', (_label, url, out) => {
    expect(() => lighthouseArgs(url, out)).toThrow();
  });
});
