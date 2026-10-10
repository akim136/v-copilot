// What passes between the plan-mode workflow and its steps. Types only: the workflow body imports this file
// and runs where Node modules are unavailable.
import type {
  Baseline, LighthouseRun, MetricValues, Outline, ReconciledAnalysis, RunStatus, Span,
} from '@v-copilot/poc-core';
import type { GateDecision } from '@/lib/gates';

export interface PocInput {
  target: string;
  brief: string;
  mode: 'plan';
}

export type IntakeResult =
  | { ok: false; reason: 'not_allowlisted' }
  | { ok: false; reason: 'daily_cap'; targetName: string; spentUsd: number }
  | {
    ok: true;
    targetName: string;
    html: string;
    // Intrinsic sizes read from image headers, keyed by absolute URL.
    imageSizes: [string, { width: number; height: number }][];
    outline: Outline;
  };

export interface SandboxHandle {
  name: string;
  chromePath: string;
}

export interface SaveBaselineRequest {
  targetName: string;
  runs: LighthouseRun[];
  psiField?: Record<string, number>;
  measuredAt: string;
}

export interface AnalyzeRequest {
  runId: string;
  targetName: string;
  brief: string;
  html: string;
  imageSizes: [string, { width: number; height: number }][];
  // Intake's outline order; analyze re-extracts with script sizes and must get the same IDs.
  outlineOrder: string[];
  baseline: Baseline;
  // Model spend already recorded for this run.
  runCostUsd: number;
  // Spend in the last 24 hours, read just before this call.
  dailySpendUsd: number;
  // Which analyze call this is within the run (1-based).
  attempt: number;
}

export type AnalyzeResult =
  | { ok: true; spans: Span[]; analysis: ReconciledAnalysis }
  | { ok: false; reason: 'cap'; cap: 'run_cap' | 'daily_cap'; spentUsd: number; limitUsd: number; spans: Span[] }
  | { ok: false; reason: 'model'; message: string; retryable: boolean; spans: Span[] };

// Everything the criteria card shows. Model text in it is escaped when the card is rendered.
export interface CriteriaCard {
  runId: string;
  targetName: string;
  brief: string;
  median: MetricValues;
  runs: number;
  criteria: ReconciledAnalysis['criteria'];
  dropped: ReconciledAnalysis['dropped'];
  opportunities: string[];
  costUsd: number;
}

export interface ReportRequest {
  runId: string;
  input: PocInput;
  targetName?: string;
  status: RunStatus;
  rejectReason?: 'not_allowlisted' | 'daily_cap' | 'criteria_rejected';
  baseline?: Baseline;
  analysis?: ReconciledAnalysis;
  gate?: Pick<GateDecision, 'decision' | 'via'>;
  spans: Span[];
  timingsMs: Record<string, number>;
  error?: string;
}

export interface PlanOutcome {
  runId: string;
  status: RunStatus;
  rejectReason?: ReportRequest['rejectReason'];
  costUsd: number;
}
