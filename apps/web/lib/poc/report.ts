import { buildPocReport, checkAllowlist, renderReportMarkdown, type ReportTarget, type TargetsConfig } from '@v-copilot/poc-core';
import { redactDeep, redactSecrets } from '@/lib/redact';
import type { Store } from '@/lib/store';
import type { ReportRequest } from './types';

// Where a run's objects live. A request that never matched the allowlist is filed under _unlisted.
export const runDir = (targetName: string | undefined, runId: string) => `pocs/${targetName ?? '_unlisted'}/${runId}`;

// Writes the run's two plan-mode objects, bundle.json and report.md (screenshots arrive in M2, for four
// at most). Every string is redacted before rendering, and both objects again whole, so no known secret
// can reach Blob, escaped or not.
export async function writeReport(store: Store, targets: TargetsConfig, raw: ReportRequest): Promise<void> {
  const req = redactDeep(raw);
  const allowed = checkAllowlist(targets, req.targetName ?? req.input.target);
  const target: ReportTarget = allowed.ok
    ? { name: allowed.target.name, url: allowed.target.url, kind: allowed.target.kind, permission: allowed.target.permission }
    : { requested: req.input.target };
  const targetName = allowed.ok ? allowed.target.name : undefined;
  const { error } = req;

  const report = buildPocReport({
    runId: req.runId, mode: req.input.mode, brief: req.input.brief, status: req.status,
    ...(req.rejectReason ? { rejectReason: req.rejectReason } : {}),
    target, ...(req.baseline ? { baseline: req.baseline } : {}), criteria: req.analysis?.criteria ?? [],
    spans: req.spans, timingsMs: req.timingsMs,
  });
  const bundle = {
    version: 1,
    report,
    baseline: req.baseline,
    analysis: req.analysis,
    gate: req.gate,
    trace: req.spans,
    ...(error ? { error } : {}),
  };
  const markdown = renderReportMarkdown(report, {
    ...(req.analysis ? { opportunities: req.analysis.opportunities, sections: req.analysis.sections, dropped: req.analysis.dropped } : {}),
    ...(req.baseline ? { measuredAt: req.baseline.measuredAt } : {}),
    ...(error ? { error } : {}),
  });

  const dir = runDir(targetName, req.runId);
  await store.write(`${dir}/bundle.json`, redactSecrets(`${JSON.stringify(bundle, null, 2)}\n`), { contentType: 'application/json', mode: 'overwrite' });
  await store.write(`${dir}/report.md`, redactSecrets(markdown), { contentType: 'text/markdown; charset=utf-8', mode: 'overwrite' });
}
