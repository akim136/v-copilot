import {
  ANALYZE_SYSTEM, AnalyzeOutputSchema, buildAnalyzePrompt, callModel, CapExceededError, costUsd, extractOutline,
  ModelCallError, PromptTooLargeError, reconcileAnalysis, ReplayMissError, STEP_MODEL, worstCaseUsage,
  type AllowedTarget, type ModelMode, type Span,
} from '@v-copilot/poc-core';
import type { LanguageModel } from 'ai';
import { FatalError } from 'workflow';
import type { AnalyzeRequest, AnalyzeResult } from './types';

export interface AnalyzeDeps {
  target: AllowedTarget;
  mode: ModelMode;
  recordingsDir: string;
  // How many times this step has started; above 1, earlier attempts died without returning.
  stepAttempt: number;
  now: () => Date;
  // Tests pass an AI SDK mock; otherwise the Gateway model pinned for analyze is used.
  model?: LanguageModel;
}

// The outline from intake's HTML with the baseline's script sizes filled in, and the prompt built from it.
export function analyzeInput(req: AnalyzeRequest, target: AllowedTarget) {
  const outline = extractOutline(req.html, {
    baseUrl: target.url,
    imageSizes: new Map(req.imageSizes),
    scriptBytes: new Map(Object.entries(req.baseline.scriptBytes)),
  });
  if (outline.order.join() !== req.outlineOrder.join()) throw new FatalError('outline IDs changed between intake and analyze');
  const { median, runs, psiField } = req.baseline;
  const prompt = buildAnalyzePrompt({
    target, brief: req.brief, baseline: { median, runs: runs.length, ...(psiField ? { psiField } : {}) },
    opportunities: req.baseline.opportunities, outline,
  });
  return { outline, prompt };
}

export async function runAnalyze(req: AnalyzeRequest, deps: AnalyzeDeps): Promise<AnalyzeResult> {
  const { outline, prompt } = analyzeInput(req, deps.target);
  const model = STEP_MODEL.analyze;
  // An earlier attempt of this step may have paid for a call and died before returning it. Charge each
  // such attempt the most it could have cost, so the run's spend is never understated.
  const unrecorded: Span[] = deps.mode === 'replay' ? [] : Array.from({ length: Math.max(0, deps.stepAttempt - 1) }, () => {
    const usage = worstCaseUsage(ANALYZE_SYSTEM, prompt);
    return {
      runId: req.runId, step: 'analyze', model, attempt: req.attempt, ...usage, costUsd: costUsd(model, usage),
      latencyMs: 0, mode: deps.mode, startedAt: deps.now().toISOString(),
    };
  });
  const runCostUsd = req.runCostUsd + unrecorded.reduce((sum, s) => sum + s.costUsd, 0);

  let result;
  try {
    result = await callModel({
      runId: req.runId, step: 'analyze', attempt: req.attempt, system: ANALYZE_SYSTEM, prompt, schema: AnalyzeOutputSchema,
      mode: deps.mode, budget: { runCostUsd, dailySpendUsd: req.dailySpendUsd }, recordingsDir: deps.recordingsDir, now: deps.now,
      ...(deps.model ? { model: deps.model } : {}),
    });
  } catch (err) {
    if (err instanceof CapExceededError) {
      const { reason, spentUsd, limitUsd } = err.check;
      return { ok: false, reason: 'cap', cap: reason, spentUsd, limitUsd, spans: unrecorded };
    }
    if (err instanceof ModelCallError) {
      return { ok: false, reason: 'model', message: err.message, retryable: err.retryable, spans: [...unrecorded, err.span] };
    }
    if (err instanceof ReplayMissError || err instanceof PromptTooLargeError) {
      return { ok: false, reason: 'model', message: err.message, retryable: false, spans: unrecorded };
    }
    throw err;
  }
  const spans = [...unrecorded, result.span];
  try {
    return { ok: true, spans, analysis: reconcileAnalysis(result.output, outline, req.baseline.median) };
  } catch (err) {
    // The call is paid for; keep its span even though its output is unusable.
    return { ok: false, reason: 'model', message: `analysis failed validation: ${(err as Error)?.name ?? 'Error'}`, retryable: false, spans };
  }
}
