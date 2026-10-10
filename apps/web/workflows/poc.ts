// M1 plan-mode run: intake → baseline → analyze → criteria gate → report.
import { createHook, FatalError, getWorkflowMetadata } from 'workflow';
import { criteriaToken, isGateDecision, type GateDecision } from '@/lib/gates';
import type { CriteriaCard, PlanOutcome, PocInput } from '@/lib/poc/types';
import { planRun } from './plan-run';
import {
  alertStep, analyzeStep, armCriteriaCardStep, closeCriteriaCardStep, intakeStep, lighthouseStep, postCriteriaCardStep,
  psiFieldStep, readCachedBaselineStep, readDailySpendStep, recordRunStep, resolveTargetStep, saveBaselineStep,
  startSandboxStep, stopSandboxStep, writeReportStep,
} from './poc-steps';

// The criteria gate. The hook is registered before the buttons exist, awaited exactly once, then released,
// so a second press (or a press after the run moved on) finds no hook and is answered "already handled".
async function awaitCriteria(card: CriteriaCard): Promise<GateDecision> {
  const hook = createHook<GateDecision>({ token: criteriaToken(card.runId) });
  let payload: unknown;
  let messageId: string;
  try {
    if (await hook.getConflict()) throw new FatalError('criteria hook token already owned by another run');
    messageId = await postCriteriaCardStep(card);
    await armCriteriaCardStep(card, messageId);
    payload = await hook;
  } finally {
    hook.dispose();
  }
  if (!isGateDecision(payload)) throw new FatalError('criteria gate resumed with an invalid decision');
  await closeCriteriaCardStep(card, messageId, { decision: payload.decision, via: payload.via });
  return payload;
}

export async function pocWorkflow(input: PocInput): Promise<PlanOutcome> {
  'use workflow';
  const { workflowRunId: runId } = getWorkflowMetadata();
  return planRun(input, {
    runId,
    now: () => new Date().toISOString(),
    clock: () => Date.now(),
    resolveTarget: resolveTargetStep,
    intake: intakeStep,
    readCachedBaseline: readCachedBaselineStep,
    startSandbox: () => startSandboxStep(runId),
    lighthouse: lighthouseStep,
    stopSandbox: stopSandboxStep,
    psiField: psiFieldStep,
    saveBaseline: saveBaselineStep,
    readDailySpend: readDailySpendStep,
    analyze: analyzeStep,
    awaitCriteria,
    writeReport: writeReportStep,
    recordRun: recordRunStep,
    alert: alertStep,
  });
}
