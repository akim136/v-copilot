import { reconcileCriteria } from './criteria';
import type { AnalyzeOutput } from './prompts/analyze';
import type { Criterion, Metric, MetricValues, Outline } from './schemas';
import { oneLine } from './text';

export const MAX_SECTIONS = 30;
export const MAX_OPPORTUNITIES_SHOWN = 6;

export interface ReconciledAnalysis {
  sections: AnalyzeOutput['sections'];
  opportunities: { title: string; detail: string; metrics: Metric[] }[];
  criteria: Criterion[];
  dropped: { metric: string; reason: string }[];
}

// What a human sees and approves is checked in code first: sections may only name outline IDs (each ID in
// one section), opportunities are few and short, and criteria go through reconcileCriteria.
export function reconcileAnalysis(output: AnalyzeOutput, outline: Outline, median: MetricValues): ReconciledAnalysis {
  const known = new Set(outline.order);
  const claimed = new Set<string>();
  const sections: ReconciledAnalysis['sections'] = [];
  for (const s of output.sections) {
    if (sections.length === MAX_SECTIONS) break;
    const ids: string[] = [];
    for (const id of s.ids) {
      if (!known.has(id) || claimed.has(id)) continue;
      claimed.add(id);
      ids.push(id);
    }
    if (ids.length) sections.push({ kind: s.kind, name: oneLine(s.name, 80) || s.kind, ids });
  }

  const opportunities: ReconciledAnalysis['opportunities'] = [];
  for (const o of output.opportunities) {
    if (opportunities.length === MAX_OPPORTUNITIES_SHOWN) break;
    const title = oneLine(o.title, 120);
    if (title) opportunities.push({ title, detail: oneLine(o.detail, 300), metrics: [...new Set(o.metrics)] });
  }

  return { sections, opportunities, ...reconcileCriteria(output.criteria, median) };
}
