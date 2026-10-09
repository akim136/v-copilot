import { z } from 'zod';
import { METRICS, type Metric, type MetricValues, type Opportunity } from './schemas';

export const LIGHTHOUSE_RUNS = 3;
const MAX_OPPORTUNITIES = 20;

// Mobile is Lighthouse's default form factor; simulated throttling keeps run-to-run spread small.
export function lighthouseArgs(url: string, outputPath: string): string[] {
  if (new URL(url).protocol !== 'https:') throw new Error('Lighthouse only measures https URLs');
  if (!/^\/tmp\/[\w.-]+\.json$/.test(outputPath)) throw new Error('Lighthouse output must be a JSON file in /tmp');
  return [
    url,
    '--quiet',
    '--output=json',
    `--output-path=${outputPath}`,
    '--only-categories=performance,accessibility,seo',
    '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
  ];
}

const score = z.number().min(0).max(1);
const category = z.object({ score, auditRefs: z.array(z.object({ id: z.string(), weight: z.number(), group: z.string().optional() })) });
const numeric = z.object({ numericValue: z.number().finite().nonnegative() });
const audit = z.object({
  title: z.string(),
  score: z.number().nullable(),
  scoreDisplayMode: z.string(),
  displayValue: z.string().optional(),
  metricSavings: z.record(z.string(), z.number()).optional(),
});

// The subset of a Lighthouse result this project reads. A category whose score is null (it errored)
// fails here rather than becoming a zero.
const LhrSchema = z.object({
  lighthouseVersion: z.string(),
  runtimeError: z.unknown().optional(),
  configSettings: z.object({ formFactor: z.literal('mobile') }),
  categories: z.object({ performance: category, accessibility: category, seo: category }),
  audits: z.looseObject({
    'largest-contentful-paint': numeric,
    'cumulative-layout-shift': numeric,
    'total-blocking-time': numeric,
    'first-contentful-paint': numeric,
    'server-response-time': numeric,
    'network-requests': z.object({
      details: z.object({ items: z.array(z.object({ resourceType: z.string().optional(), transferSize: z.number().nonnegative().optional() })) }),
    }),
  }),
});

export interface LighthouseRun {
  lighthouseVersion: string;
  metrics: MetricValues;
  opportunities: Opportunity[];
}

function opportunities(lhr: z.infer<typeof LhrSchema>): Opportunity[] {
  const found: Opportunity[] = [];
  for (const name of ['performance', 'accessibility', 'seo'] as const) {
    for (const ref of lhr.categories[name].auditRefs) {
      // Performance: failing insights and diagnostics. Accessibility and SEO: failing weighted audits.
      if (name === 'performance' ? !['insights', 'diagnostics'].includes(ref.group ?? '') : ref.weight <= 0) continue;
      const parsed = audit.safeParse(lhr.audits[ref.id]);
      if (!parsed.success) continue;
      const a = parsed.data;
      const failing = a.score !== null && a.score < (name === 'performance' ? 0.9 : 1)
        && ['metricSavings', 'numeric', 'binary'].includes(a.scoreDisplayMode);
      if (!failing) continue;
      found.push({
        id: ref.id,
        category: name,
        title: a.title.slice(0, 160),
        ...(a.displayValue ? { displayValue: a.displayValue.slice(0, 80) } : {}),
        savings: Object.fromEntries(Object.entries(a.metricSavings ?? {}).filter(([, v]) => Number.isFinite(v) && v > 0)),
      });
    }
  }
  return found.slice(0, MAX_OPPORTUNITIES);
}

// Reads one Lighthouse JSON result into the nine tracked metrics. Scores become 0–100.
export function parseLighthouseResult(input: unknown): LighthouseRun {
  const lhr = LhrSchema.parse(input);
  if (lhr.runtimeError) throw new Error('Lighthouse reported a runtime error');
  const a = lhr.audits;
  const jsBytes = a['network-requests'].details.items
    .filter((i) => i.resourceType === 'Script')
    .reduce((sum, i) => sum + (i.transferSize ?? 0), 0);
  return {
    lighthouseVersion: lhr.lighthouseVersion,
    metrics: {
      performance: Math.round(lhr.categories.performance.score * 100),
      lcp: a['largest-contentful-paint'].numericValue,
      cls: a['cumulative-layout-shift'].numericValue,
      tbt: a['total-blocking-time'].numericValue,
      fcp: a['first-contentful-paint'].numericValue,
      ttfb: a['server-response-time'].numericValue,
      jsBytes,
      accessibility: Math.round(lhr.categories.accessibility.score * 100),
      seo: Math.round(lhr.categories.seo.score * 100),
    },
    opportunities: opportunities(lhr),
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of no values');
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// Each metric's median is taken independently across runs.
export function medianMetrics(runs: readonly MetricValues[]): MetricValues {
  return Object.fromEntries(METRICS.map((m: Metric) => [m, median(runs.map((r) => r[m]))])) as MetricValues;
}

// The run whose performance score is the median one supplies the opportunities shown to analyze.
export function medianRun(runs: readonly LighthouseRun[]): LighthouseRun {
  if (runs.length === 0) throw new Error('no Lighthouse runs');
  const sorted = [...runs].sort((x, y) => x.metrics.performance - y.metrics.performance);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}
