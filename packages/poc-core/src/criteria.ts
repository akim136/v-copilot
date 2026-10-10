import { CriterionSchema, type Criterion, type Metric, type MetricValues } from './schemas';
import { oneLine } from './text';

export const METRIC_DIRECTION: Readonly<Record<Metric, 'higher' | 'lower'>> = Object.freeze({
  performance: 'higher', accessibility: 'higher', seo: 'higher',
  lcp: 'lower', cls: 'lower', tbt: 'lower', fcp: 'lower', ttfb: 'lower', jsBytes: 'lower',
});
export const MAX_CRITERIA = 5;
const SCORES = new Set<Metric>(['performance', 'accessibility', 'seo']);

export interface DraftCriterion { metric: Metric; baseline: number; target: number; rationale: string }

// Turns the model's draft criteria into approved-ready ones. Code owns the baseline (the measured
// median, whatever the model wrote) and the IDs; a target must be a real improvement on that baseline.
export function reconcileCriteria(draft: readonly DraftCriterion[], median: MetricValues) {
  const criteria: Criterion[] = [];
  const dropped: { metric: string; reason: string }[] = [];
  for (const d of draft) {
    const baseline = median[d.metric];
    const rationale = oneLine(d.rationale, 200);
    const better = METRIC_DIRECTION[d.metric] === 'higher' ? d.target > baseline : d.target < baseline;
    let reason: string | undefined;
    if (criteria.some((c) => c.metric === d.metric)) reason = 'duplicate metric';
    else if (!Number.isFinite(d.target) || d.target < 0 || (SCORES.has(d.metric) && d.target > 100)) reason = 'invalid target';
    else if (!better) reason = 'no improvement on baseline';
    else if (!rationale) reason = 'no rationale';
    else if (criteria.length >= MAX_CRITERIA) reason = 'too many criteria';
    if (reason) {
      dropped.push({ metric: d.metric, reason });
      continue;
    }
    criteria.push(CriterionSchema.parse({ id: `c${criteria.length + 1}`, metric: d.metric, baseline, target: d.target, rationale }));
  }
  return { criteria, dropped };
}
