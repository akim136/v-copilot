import { describe, expect, it } from 'vitest';
import { CriterionSchema, PocReportSchema, RunIndexRowSchema } from '../src/schemas';

const metrics = { performance: 61, lcp: 18329.984, cls: 0.1267, tbt: 229, fcp: 2245.984, ttfb: 47, jsBytes: 59676, accessibility: 85, seo: 82 };

describe('schemas', () => {
  it('accepts a planned run report and a not_allowlisted rejection', () => {
    expect(() => PocReportSchema.parse({
      runId: 'wrun_X', target: 'prospect-landing', kind: 'fixture', url: 'https://akim136.github.io/v-copilot/prospect-landing/',
      permission: 'owned', mode: 'plan', status: 'planned', brief: 'b',
      criteria: [{ id: 'c1', metric: 'lcp', baseline: 18329.984, target: 2500, rationale: 'r' }],
      baseline: { lighthouse: metrics, runs: 3 }, hardFails: [], architecture: [], costUsd: 0.04,
      tokens: { input: 4200, cachedInput: 1400, output: 900 }, timingsMs: { baseline: 60000 },
    })).not.toThrow();
    expect(() => PocReportSchema.parse({
      runId: 'wrun_Y', target: 'shop', url: 'shop', mode: 'plan', status: 'rejected', rejectReason: 'not_allowlisted',
      brief: 'b', criteria: [], hardFails: [], architecture: [], costUsd: 0, tokens: { input: 0, cachedInput: 0, output: 0 }, timingsMs: {},
    })).not.toThrow();
  });

  const planned = {
    runId: 'wrun_X', target: 'prospect-landing', kind: 'fixture', url: 'https://akim136.github.io/v-copilot/prospect-landing/',
    permission: 'owned', mode: 'plan', status: 'planned', brief: 'b', criteria: [],
    baseline: { lighthouse: metrics, runs: 3 }, hardFails: [], architecture: [], costUsd: 0.04,
    tokens: { input: 4200, cachedInput: 1400, output: 900 }, timingsMs: {},
  };

  it.each([
    ['a planned report without a baseline', { baseline: undefined }],
    ['a planned report without kind or permission', { kind: undefined, permission: undefined }],
    ['an allowlisted report whose url is not a URL', { url: 'prospect-landing' }],
    ['a reject reason on a run that was not rejected', { rejectReason: 'daily_cap' }],
    ['a rejected run without a reason', { status: 'rejected', baseline: undefined }],
    ['a not_allowlisted rejection that claims a kind and permission', { status: 'rejected', rejectReason: 'not_allowlisted', baseline: undefined }],
  ])('rejects %s', (_label, change) => {
    expect(() => PocReportSchema.parse({ ...planned, ...change })).toThrow();
  });

  it('accepts a daily_cap rejection of an allowlisted target', () => {
    expect(() => PocReportSchema.parse({ ...planned, status: 'rejected', rejectReason: 'daily_cap', baseline: undefined, costUsd: 0 })).not.toThrow();
  });

  it('rejects a multi-line rationale, a negative metric and an unknown status', () => {
    expect(() => CriterionSchema.parse({ id: 'c1', metric: 'lcp', baseline: 1, target: 0.5, rationale: 'a\nb' })).toThrow();
    expect(() => CriterionSchema.parse({ id: 'c1', metric: 'lcp', baseline: -1, target: 0.5, rationale: 'a' })).toThrow();
    expect(() => RunIndexRowSchema.parse({ runId: 'r', target: 't', mode: 'plan', status: 'done', costUsd: 0, startedAt: '2026-10-09T00:00:00Z' })).toThrow();
  });
});
