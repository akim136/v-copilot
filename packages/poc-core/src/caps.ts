import type { RunIndexRow } from './schemas';

// Pinned by the spec. Nothing reads these from env or options, so no caller (or test) can raise them.
export const CAPS = Object.freeze({
  perRunUsd: 1.5,
  dailyUsd: 8,
  dailyWindowMs: 24 * 60 * 60 * 1000,
  fixAttempts: 3,
  liveEvalUsd: 5,
  fidelityGate: 0.9,
});

export type CapCheck =
  | { ok: true }
  | { ok: false; reason: 'run_cap' | 'daily_cap'; spentUsd: number; limitUsd: number };

const valid = (usd: number) => Number.isFinite(usd) && usd >= 0;

// Model spend of indexed runs that ended in the last 24 hours. Each run writes its row when it ends; a row
// without endedAt is dated by startedAt.
export function spendLast24h(rows: readonly Pick<RunIndexRow, 'costUsd' | 'startedAt' | 'endedAt'>[], now: Date): number {
  const since = now.getTime() - CAPS.dailyWindowMs;
  let total = 0;
  for (const row of rows) {
    // An unreadable cost or timestamp fails closed: NaN is refused, and an undated row counts as recent.
    if (!valid(row.costUsd)) return Number.NaN;
    const at = Date.parse(row.endedAt ?? row.startedAt);
    if (Number.isNaN(at) || at > since) total += row.costUsd;
  }
  return total;
}

export function checkDailyCap(spentLast24hUsd: number): CapCheck {
  if (valid(spentLast24hUsd) && spentLast24hUsd < CAPS.dailyUsd) return { ok: true };
  return { ok: false, reason: 'daily_cap', spentUsd: spentLast24hUsd, limitUsd: CAPS.dailyUsd };
}

// Checked before every model call: the run stops once it has passed $1.50, and the run's own spend
// counts toward the 24-hour ceiling because it is not in the index until the run ends. Other runs still in
// flight are not in the index either; each is bounded by its own per-run cap.
export function checkBeforeModelCall(budget: { runCostUsd: number; dailySpendUsd: number }): CapCheck {
  const { runCostUsd, dailySpendUsd } = budget;
  if (!valid(runCostUsd) || runCostUsd > CAPS.perRunUsd) {
    return { ok: false, reason: 'run_cap', spentUsd: runCostUsd, limitUsd: CAPS.perRunUsd };
  }
  if (!valid(dailySpendUsd)) return checkDailyCap(dailySpendUsd);
  return checkDailyCap(dailySpendUsd + runCostUsd);
}
