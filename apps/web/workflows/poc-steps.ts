// The plan run's steps. Each runs with full Node and is retried by the runtime (3 retries by default).
// Dependencies are imported inside each step, so the workflow bundle never loads them.
import type { Baseline, LighthouseRun, RunIndexRow } from '@v-copilot/poc-core';
import type { GateDecision } from '@/lib/gates';
import type {
  AnalyzeRequest, AnalyzeResult, CriteriaCard, IntakeResult, PocInput, ReportRequest, SandboxHandle, SaveBaselineRequest,
} from '@/lib/poc/types';

async function deps() {
  const [{ blobStore }, { allowedTarget, loadTargets }] = await Promise.all([import('@/lib/store'), import('@/lib/targets')]);
  return { store: blobStore(), allowedTarget, loadTargets };
}

export async function resolveTargetStep(target: string): Promise<string | null> {
  'use step';
  const { checkAllowlist } = await import('@v-copilot/poc-core');
  const { loadTargets } = await import('@/lib/targets');
  const allowed = checkAllowlist(loadTargets(), target);
  return allowed.ok ? allowed.target.name : null;
}

export async function intakeStep(input: PocInput): Promise<IntakeResult> {
  'use step';
  const { runIntake } = await import('@/lib/poc/intake');
  const { readDailySpend } = await import('@/lib/poc/run-index');
  const { store, loadTargets } = await deps();
  return runIntake(input, { targets: loadTargets(), readDailySpend: () => readDailySpend(store, new Date()), fetch });
}

export async function readCachedBaselineStep(targetName: string): Promise<Baseline | null> {
  'use step';
  const { readCachedBaseline } = await import('@/lib/poc/baseline');
  const { store, allowedTarget } = await deps();
  return readCachedBaseline(store, allowedTarget(targetName), new Date());
}

export async function startSandboxStep(runId: string): Promise<SandboxHandle> {
  'use step';
  const { startSandbox } = await import('@/lib/poc/baseline');
  return startSandbox(runId);
}

export async function lighthouseStep(handle: SandboxHandle, targetName: string, index: number): Promise<LighthouseRun> {
  'use step';
  const { runLighthouse } = await import('@/lib/poc/baseline');
  const { allowedTarget } = await import('@/lib/targets');
  return runLighthouse(handle, allowedTarget(targetName), index);
}

export async function stopSandboxStep(handle: SandboxHandle): Promise<void> {
  'use step';
  const { stopSandbox } = await import('@/lib/poc/baseline');
  await stopSandbox(handle);
}

export async function psiFieldStep(targetName: string): Promise<Record<string, number> | undefined> {
  'use step';
  const { readPsiField } = await import('@/lib/poc/baseline');
  const { allowedTarget } = await import('@/lib/targets');
  return readPsiField(allowedTarget(targetName));
}

export async function saveBaselineStep(req: SaveBaselineRequest): Promise<Baseline> {
  'use step';
  const { saveBaseline } = await import('@/lib/poc/baseline');
  const { store, allowedTarget } = await deps();
  return saveBaseline(store, allowedTarget(req.targetName), req);
}

export async function readDailySpendStep(): Promise<number> {
  'use step';
  const { readDailySpend } = await import('@/lib/poc/run-index');
  const { store } = await deps();
  return readDailySpend(store, new Date());
}

export async function analyzeStep(req: AnalyzeRequest): Promise<AnalyzeResult> {
  'use step';
  const { getStepMetadata } = await import('workflow');
  const { modelModeFromEnv } = await import('@v-copilot/poc-core');
  const { runAnalyze } = await import('@/lib/poc/analyze');
  const { recordingsDir } = await import('@/lib/paths');
  const { allowedTarget } = await deps();
  return runAnalyze(req, {
    target: allowedTarget(req.targetName),
    mode: modelModeFromEnv(),
    recordingsDir: recordingsDir(),
    stepAttempt: getStepMetadata().attempt,
    now: () => new Date(),
  });
}

export async function postCriteriaCardStep(card: CriteriaCard): Promise<string> {
  'use step';
  const { postCriteriaCard } = await import('@/lib/poc/card');
  return postCriteriaCard(card);
}

export async function armCriteriaCardStep(card: CriteriaCard, messageId: string): Promise<void> {
  'use step';
  const { armCriteriaCard } = await import('@/lib/poc/card');
  await armCriteriaCard(card, messageId);
}

// Best effort: the decision is already consumed, so a failed edit must not fail the run.
export async function closeCriteriaCardStep(card: CriteriaCard, messageId: string, decision: Pick<GateDecision, 'decision' | 'via'>): Promise<void> {
  'use step';
  try {
    const { closeCriteriaCard } = await import('@/lib/poc/card');
    await closeCriteriaCard(card, messageId, decision);
  } catch (err) {
    console.error('poc: closing the criteria card failed', (err as Error)?.name);
  }
}

export async function writeReportStep(req: ReportRequest): Promise<void> {
  'use step';
  const { writeReport } = await import('@/lib/poc/report');
  const { store, loadTargets } = await deps();
  await writeReport(store, loadTargets(), req);
}

export async function recordRunStep(row: RunIndexRow): Promise<void> {
  'use step';
  const { recordRun } = await import('@/lib/poc/run-index');
  const { store } = await deps();
  await recordRun(store, row);
}

export async function alertStep(text: string): Promise<void> {
  'use step';
  const { sendAlert } = await import('@/lib/poc/card');
  await sendAlert(text);
}
