// The plan-mode run, written against injected steps so it can be tested without the Workflow runtime. It
// runs inside the workflow body, so it imports types only: no Node modules, no poc-core at runtime.
import type { Baseline, LighthouseRun, ReconciledAnalysis, RunIndexRow, RunStatus, Span } from '@v-copilot/poc-core';
import type { GateDecision } from '@/lib/gates';
import type {
  AnalyzeRequest, AnalyzeResult, CriteriaCard, IntakeResult, PlanOutcome, PocInput, ReportRequest, SandboxHandle,
  SaveBaselineRequest,
} from '@/lib/poc/types';

// Must equal poc-core's LIGHTHOUSE_RUNS (a test checks); saveBaseline refuses any other count.
export const LIGHTHOUSE_RUNS = 3;
// A retryable model failure (rate limit, timeout) gets one more call, cap-checked like the first.
export const ANALYZE_ATTEMPTS = 2;

export interface PlanDeps {
  runId: string;
  // The workflow's clock: ISO time and milliseconds.
  now: () => string;
  clock: () => number;
  // The allowlisted name for a requested target, or null; read from the config, no I/O.
  resolveTarget: (target: string) => Promise<string | null>;
  intake: (input: PocInput) => Promise<IntakeResult>;
  readCachedBaseline: (targetName: string) => Promise<Baseline | null>;
  startSandbox: () => Promise<SandboxHandle>;
  lighthouse: (handle: SandboxHandle, targetName: string, index: number) => Promise<LighthouseRun>;
  stopSandbox: (handle: SandboxHandle) => Promise<void>;
  psiField: (targetName: string) => Promise<Record<string, number> | undefined>;
  saveBaseline: (req: SaveBaselineRequest) => Promise<Baseline>;
  // Read in its own step, so a failed read never looks like an analyze attempt that may have paid for a call.
  readDailySpend: () => Promise<number>;
  analyze: (req: AnalyzeRequest) => Promise<AnalyzeResult>;
  awaitCriteria: (card: CriteriaCard) => Promise<GateDecision>;
  writeReport: (req: ReportRequest) => Promise<void>;
  recordRun: (row: RunIndexRow) => Promise<void>;
  alert: (text: string) => Promise<void>;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const sum = (spans: readonly Span[]) => spans.reduce((total, s) => total + s.costUsd, 0);
const messageOf = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

async function measureBaseline(d: PlanDeps, targetName: string): Promise<Baseline> {
  const cached = await d.readCachedBaseline(targetName);
  if (cached) return cached;
  const handle = await d.startSandbox();
  const runs: LighthouseRun[] = [];
  try {
    for (let i = 0; i < LIGHTHOUSE_RUNS; i++) runs.push(await d.lighthouse(handle, targetName, i));
  } finally {
    // The Sandbox times out on its own; a failed stop must not hide the measurement or its error.
    await d.stopSandbox(handle).catch(() => {});
  }
  const psiField = await d.psiField(targetName);
  return d.saveBaseline({ targetName, runs, ...(psiField ? { psiField } : {}), measuredAt: d.now() });
}

export async function planRun(input: PocInput, d: PlanDeps): Promise<PlanOutcome> {
  const startedAt = d.now();
  const spans: Span[] = [];
  const timingsMs: Record<string, number> = {};
  let status: RunStatus = 'intake';
  let rejectReason: ReportRequest['rejectReason'];
  let capHit: RunIndexRow['capHit'];
  let targetName: string | undefined;
  let baseline: Baseline | undefined;
  let analysis: ReconciledAnalysis | undefined;
  let gate: GateDecision | undefined;
  let error: string | undefined;
  let thrown: { err: unknown } | undefined;
  // The step in progress, named in the error if one throws.
  let phase = 'intake';

  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    phase = name;
    const t0 = d.clock();
    try {
      return await fn();
    } finally {
      timingsMs[name] = Math.max(0, d.clock() - t0);
    }
  };
  const report = (): ReportRequest => ({
    runId: d.runId, input, status, spans, timingsMs,
    ...(targetName ? { targetName } : {}), ...(rejectReason ? { rejectReason } : {}), ...(baseline ? { baseline } : {}),
    ...(analysis ? { analysis } : {}), ...(gate ? { gate: { decision: gate.decision, via: gate.via } } : {}),
    ...(error ? { error } : {}),
  });

  try {
    // Known before intake, so a run that fails there is still reported and indexed under its target.
    targetName = (await d.resolveTarget(input.target)) ?? undefined;
    const intake = await timed('intake', () => d.intake(input));
    if (!intake.ok) {
      status = 'rejected';
      rejectReason = intake.reason;
      if (intake.reason === 'not_allowlisted') targetName = undefined;
      if (intake.reason === 'daily_cap') {
        targetName = intake.targetName;
        capHit = 'daily_cap';
        error = `intake refused: ${usd(intake.spentUsd)} of model spend in the last 24 hours`;
      }
    } else {
      targetName = intake.targetName;
      const name = targetName;
      status = 'baselining';
      baseline = await timed('baseline', () => measureBaseline(d, name));

      status = 'analyzing';
      const base = baseline;
      const outcome = await timed('analyze', async () => {
        for (let attempt = 1; ; attempt++) {
          const dailySpendUsd = await d.readDailySpend();
          const res = await d.analyze({
            runId: d.runId, targetName: name, brief: input.brief, html: intake.html, imageSizes: intake.imageSizes,
            outlineOrder: intake.outline.order, baseline: base, runCostUsd: sum(spans), dailySpendUsd, attempt,
          });
          spans.push(...res.spans);
          if (res.ok || res.reason === 'cap' || !res.retryable || attempt === ANALYZE_ATTEMPTS) return res;
        }
      });

      if (outcome.ok) {
        analysis = outcome.analysis;
        status = 'awaiting_criteria';
        const card: CriteriaCard = {
          runId: d.runId, targetName: name, brief: input.brief, median: base.median, runs: base.runs.length,
          criteria: analysis.criteria, dropped: analysis.dropped, opportunities: analysis.opportunities.map((o) => o.title),
          costUsd: sum(spans),
        };
        gate = await timed('await_criteria', () => d.awaitCriteria(card));
        if (gate.decision === 'approve') {
          status = 'planned';
        } else {
          status = 'rejected';
          rejectReason = 'criteria_rejected';
        }
      } else {
        status = 'failed';
        if (outcome.reason === 'cap') {
          capHit = outcome.cap;
          const what = outcome.cap === 'run_cap' ? 'per-run cap' : '24-hour cap';
          error = `analyze stopped at the ${what}: ${usd(outcome.spentUsd)} against ${usd(outcome.limitUsd)}`;
        } else {
          error = `analyze failed: ${outcome.message}`;
        }
      }
    }
    phase = 'report';
    await d.writeReport(report());
  } catch (err) {
    error = `${phase} failed: ${messageOf(err)}`;
    // A not-allowlisted request stays a rejection: a report for an unlisted target can be nothing else.
    if (rejectReason !== 'not_allowlisted') {
      status = 'failed';
      rejectReason = undefined;
    }
    thrown = { err };
    await d.writeReport(report()).catch(() => {});
  }

  // Every run, however it ended: one alert if it failed or hit a cap, then its row in the index.
  const costUsd = sum(spans);
  if (status === 'failed' || capHit || thrown) {
    await d.alert(`v-copilot run ${d.runId} (${targetName ?? 'not allowlisted'}): ${status}. ${error ?? ''} Spend ${usd(costUsd)}.`).catch(() => {});
  }
  const row: RunIndexRow = {
    runId: d.runId, target: targetName ?? '_unlisted', mode: 'plan', status, costUsd, startedAt, endedAt: d.now(),
    ...(capHit ? { capHit } : {}),
  };
  try {
    await d.recordRun(row);
  } catch (err) {
    await d.alert(`v-copilot run ${d.runId}: could not write runs/index.json. ${messageOf(err)}`).catch(() => {});
    throw err;
  }
  if (thrown) throw thrown.err;
  return { runId: d.runId, status, ...(rejectReason ? { rejectReason } : {}), costUsd };
}
