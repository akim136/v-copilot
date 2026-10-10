import { describe, expect, it } from 'vitest';
import { parseRunIndex, serializeRunIndex, upsertRunIndexRow } from '../src/run-index';
import type { RunIndexRow } from '../src/schemas';

const row = (runId: string, costUsd = 0.1): RunIndexRow => ({
  runId, target: 'prospect-landing', mode: 'plan', status: 'planned', costUsd, startedAt: '2026-10-10T00:00:00.000Z', endedAt: '2026-10-10T00:05:00.000Z',
});

describe('run index', () => {
  it('reads a missing index as no rows', () => {
    expect(parseRunIndex(null)).toEqual([]);
  });

  it('round-trips rows', () => {
    const rows = [row('wrun_A'), row('wrun_B', 0.2)];
    expect(parseRunIndex(serializeRunIndex(rows))).toEqual(rows);
  });

  it('replaces a row with the same runId and appends a new one', () => {
    const rows = upsertRunIndexRow([row('wrun_A'), row('wrun_B')], { ...row('wrun_A', 0.5), status: 'failed' });
    expect(rows.map((r) => [r.runId, r.costUsd, r.status])).toEqual([['wrun_A', 0.5, 'failed'], ['wrun_B', 0.1, 'planned']]);
    expect(upsertRunIndexRow(rows, row('wrun_C')).map((r) => r.runId)).toEqual(['wrun_A', 'wrun_B', 'wrun_C']);
  });

  it('fails closed on an unreadable index rather than reading it as empty', () => {
    expect(() => parseRunIndex('not json')).toThrow();
    expect(() => parseRunIndex(JSON.stringify({ version: 1, rows: [{ ...row('wrun_A'), costUsd: -1 }] }))).toThrow();
    expect(() => parseRunIndex(JSON.stringify([row('wrun_A')]))).toThrow();
  });
});
