import { describe, expect, it } from 'vitest';
import { CAPS, checkBeforeModelCall, checkDailyCap, spendLast24h } from '../src/caps';

const now = new Date('2026-10-09T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe('CAPS', () => {
  it('pins the spec values and cannot be changed', () => {
    expect(CAPS).toEqual({ perRunUsd: 1.5, dailyUsd: 8, dailyWindowMs: 86_400_000, fixAttempts: 3, liveEvalUsd: 5, fidelityGate: 0.9 });
    expect(() => { (CAPS as { dailyUsd: number }).dailyUsd = 100; }).toThrow();
  });
});

describe('spendLast24h', () => {
  it('fails closed on a negative or unreadable cost instead of lowering the total', () => {
    const rows = [{ costUsd: 7, startedAt: hoursAgo(1) }, { costUsd: -5, startedAt: hoursAgo(1) }];
    expect(checkDailyCap(spendLast24h(rows, now)).ok).toBe(false);
    expect(checkDailyCap(spendLast24h([{ costUsd: Number.NaN, startedAt: hoursAgo(1) }], now)).ok).toBe(false);
  });

  it('sums runs that ended inside the window and skips older ones', () => {
    const rows = [
      { costUsd: 1, startedAt: hoursAgo(30), endedAt: hoursAgo(23) },
      { costUsd: 2, startedAt: hoursAgo(26), endedAt: hoursAgo(25) },
      { costUsd: 0.5, startedAt: hoursAgo(1) },
    ];
    expect(spendLast24h(rows, now)).toBe(1.5);
  });

  it('excludes a run that ended exactly 24 hours ago', () => {
    expect(spendLast24h([{ costUsd: 3, startedAt: hoursAgo(25), endedAt: hoursAgo(24) }], now)).toBe(0);
  });

  it('counts a row with an unreadable timestamp', () => {
    expect(spendLast24h([{ costUsd: 4, startedAt: 'not a date' }], now)).toBe(4);
  });
});

describe('checkDailyCap', () => {
  it('allows a new run below $8', () => {
    expect(checkDailyCap(7.99)).toEqual({ ok: true });
  });

  it.each([8, 8.01, Number.NaN, Number.POSITIVE_INFINITY, -1])('refuses at %s', (spent) => {
    expect(checkDailyCap(spent)).toMatchObject({ ok: false, reason: 'daily_cap', limitUsd: 8 });
  });
});

describe('checkBeforeModelCall', () => {
  it('allows a call at exactly $1.50 of run spend', () => {
    expect(checkBeforeModelCall({ runCostUsd: 1.5, dailySpendUsd: 0 })).toEqual({ ok: true });
  });

  it.each([1.5000001, Number.NaN, -0.01])('stops the run once its spend is %s', (runCostUsd) => {
    expect(checkBeforeModelCall({ runCostUsd, dailySpendUsd: 0 })).toMatchObject({ ok: false, reason: 'run_cap', limitUsd: 1.5 });
  });

  it("adds the run's own spend to the 24-hour total", () => {
    expect(checkBeforeModelCall({ runCostUsd: 0.4, dailySpendUsd: 7.5 })).toEqual({ ok: true });
    expect(checkBeforeModelCall({ runCostUsd: 0.5, dailySpendUsd: 7.5 })).toMatchObject({ ok: false, reason: 'daily_cap', spentUsd: 8 });
  });

  it('fails closed on an unreadable daily total', () => {
    expect(checkBeforeModelCall({ runCostUsd: 0, dailySpendUsd: Number.NaN })).toMatchObject({ ok: false, reason: 'daily_cap' });
  });
});
