import type { ReconciledAnalysis } from './analysis';
import { PocReportSchema, type Baseline, type Criterion, type Metric, type PocReport, type RunStatus, type Span } from './schemas';
import { escapeMarkdown } from './text';

// The run's cost and tokens are the sum over its model calls, each already priced from its token usage.
export function sumSpans(spans: readonly Span[]) {
  let costUsd = 0;
  const tokens = { input: 0, cachedInput: 0, output: 0 };
  for (const s of spans) {
    costUsd += s.costUsd;
    tokens.input += s.inputTokens;
    tokens.cachedInput += s.cachedInputTokens;
    tokens.output += s.outputTokens;
  }
  return { costUsd, tokens };
}

// An allowlisted target, or the request as given when it was not on the allowlist.
export type ReportTarget =
  | { name: string; url: string; kind: 'fixture' | 'control'; permission: 'owned' | 'written' }
  | { requested: string };

export interface PocReportInput {
  runId: string;
  mode: 'plan';
  brief: string;
  status: RunStatus;
  rejectReason?: PocReport['rejectReason'];
  target: ReportTarget;
  baseline?: Baseline;
  criteria: Criterion[];
  spans: Span[];
  timingsMs: Record<string, number>;
}

export function buildPocReport(input: PocReportInput): PocReport {
  const { costUsd, tokens } = sumSpans(input.spans);
  const t = input.target;
  const b = input.baseline;
  return PocReportSchema.parse({
    runId: input.runId,
    ...('requested' in t ? { target: t.requested, url: t.requested } : { target: t.name, url: t.url, kind: t.kind, permission: t.permission }),
    mode: input.mode,
    status: input.status,
    ...(input.rejectReason ? { rejectReason: input.rejectReason } : {}),
    brief: input.brief,
    criteria: input.criteria,
    ...(b ? { baseline: { lighthouse: b.median, runs: b.runs.length, ...(b.psiField ? { psiField: b.psiField } : {}) } } : {}),
    hardFails: [],
    architecture: [],
    costUsd,
    tokens,
    timingsMs: input.timingsMs,
  });
}

// What must match between a recorded run and its replay: everything except the run ID and timings.
export function comparableReport(r: PocReport): Partial<PocReport> {
  const rest: Partial<PocReport> = { ...r };
  delete rest.runId;
  delete rest.timingsMs;
  return rest;
}

export const METRIC_LABEL: Readonly<Record<Metric, string>> = {
  performance: 'Performance', lcp: 'LCP', cls: 'CLS', tbt: 'TBT', fcp: 'FCP', ttfb: 'TTFB',
  jsBytes: 'JavaScript', accessibility: 'Accessibility', seo: 'SEO',
};
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatMetric(metric: Metric, v: number): string {
  if (metric === 'cls') return v.toFixed(3);
  if (metric === 'jsBytes') return `${int.format(v / 1024)} KiB`;
  if (metric === 'lcp' || metric === 'tbt' || metric === 'fcp' || metric === 'ttfb') return `${int.format(v)} ms`;
  return int.format(v);
}

export interface ReportExtras {
  opportunities?: ReconciledAnalysis['opportunities'];
  sections?: ReconciledAnalysis['sections'];
  dropped?: ReconciledAnalysis['dropped'];
  measuredAt?: string;
  error?: string;
}

const e = escapeMarkdown;
const row = (cells: string[]) => `| ${cells.join(' | ')} |`;

// report.md. Built in code from the validated report; every model-, page- or user-supplied string is escaped.
export function renderReportMarkdown(r: PocReport, x: ReportExtras): string {
  const out: string[] = [];
  const status = r.rejectReason ? `${r.status} (${r.rejectReason})` : r.status;
  out.push(`# v-copilot ${r.mode} report: ${e(r.target)}`, '');
  out.push(`- **Run:** \`${r.runId}\``, `- **Status:** ${status}`);
  if (r.kind && r.permission) out.push(`- **Target:** ${r.kind}, ${r.permission}`);
  out.push(`- **URL:** ${e(r.url)}`, `- **Brief:** ${e(r.brief) || '(none)'}`);
  out.push(`- **Model spend:** $${r.costUsd.toFixed(4)} (${int.format(r.tokens.input)} input tokens, ${int.format(r.tokens.cachedInput)} cached, ${int.format(r.tokens.output)} output)`);
  if (x.error) out.push(`- **Error:** ${e(x.error)}`);

  if (r.baseline) {
    const b = r.baseline;
    out.push('', '## Baseline', '', `Median of ${b.runs} Lighthouse runs, mobile profile${x.measuredAt ? `, measured ${e(x.measuredAt)}` : ''}.`, '');
    out.push(row(['Metric', 'Median']), row(['---', '---']));
    for (const m of Object.keys(METRIC_LABEL) as Metric[]) out.push(row([METRIC_LABEL[m], formatMetric(m, b.lighthouse[m])]));
    const field = Object.entries(b.psiField ?? {});
    out.push('', field.length
      ? `PageSpeed Insights field data (p75, context only): ${field.map(([k, v]) => `${e(k)} ${int.format(v)}`).join(', ')}.`
      : 'PageSpeed Insights has no field data for this URL.');
  }

  out.push('', '## Success criteria', '');
  if (r.criteria.length) {
    out.push(row(['ID', 'Metric', 'Baseline', 'Target', 'Rationale']), row(['---', '---', '---', '---', '---']));
    for (const c of r.criteria) out.push(row([c.id, METRIC_LABEL[c.metric], formatMetric(c.metric, c.baseline), formatMetric(c.metric, c.target), e(c.rationale)]));
  } else {
    out.push('No criteria.');
  }
  if (x.dropped?.length) out.push('', `Dropped in code: ${x.dropped.map((d) => `${e(d.metric)} (${e(d.reason)})`).join(', ')}.`);

  if (x.opportunities?.length) {
    out.push('', '## Opportunities', '');
    x.opportunities.forEach((o, i) => {
      const metrics = o.metrics.length ? ` (${o.metrics.map((m) => METRIC_LABEL[m]).join(', ')})` : '';
      out.push(`${i + 1}. **${e(o.title)}**: ${e(o.detail)}${metrics}`);
    });
  }
  if (x.sections?.length) {
    out.push('', '## Sections', '');
    for (const s of x.sections) out.push(`- ${e(s.name)} (${s.kind}): ${s.ids.length} elements`);
  }
  const timings = Object.entries(r.timingsMs);
  if (timings.length) out.push('', '## Timings', '', timings.map(([k, v]) => `${e(k)} ${(v / 1000).toFixed(1)} s`).join(', '));
  return `${out.join('\n')}\n`;
}
