import { costUsd, MODELS, parseRunIndex, parseTargetsConfig, RUN_INDEX_PATH, serializeRunIndex, type Baseline, type RunIndexRow, type Span } from '@v-copilot/poc-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordRun } from '@/lib/poc/run-index';
import { runDir, writeReport } from '@/lib/poc/report';
import type { ReportRequest } from '@/lib/poc/types';
import { memoryStore } from './fakes';

const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), list: vi.fn() }));
vi.mock('@vercel/blob', () => {
  class BlobPreconditionFailedError extends Error {}
  return { ...blob, BlobPreconditionFailedError };
});
const { blobStore, StoreConflictError } = await import('@/lib/store');
const { BlobPreconditionFailedError } = await import('@vercel/blob');

const BASE = 'https://akim136.github.io/v-copilot/prospect-landing/';
const targets = parseTargetsConfig({ 'prospect-landing': { url: BASE, permission: 'owned', kind: 'fixture' } });
const RUN = 'wrun_01K7AAAAAAAAAAAAAAAAAAAAAA';
const median = { performance: 61, lcp: 18329.984, cls: 0.1267, tbt: 229, fcp: 2245.984, ttfb: 47, jsBytes: 59676, accessibility: 85, seo: 82 };
const baseline: Baseline = { url: BASE, measuredAt: '2026-10-10T00:01:00.000Z', lighthouseVersion: '13.5.0', runs: [median, median, median], median, opportunities: [], scriptBytes: {} };
const usage = { inputTokens: 6000, cachedInputTokens: 1024, cacheWriteTokens: 0, outputTokens: 900 };
const span = (attempt: number): Span => ({
  runId: RUN, step: 'analyze', model: MODELS.terra, attempt, ...usage, costUsd: costUsd(MODELS.terra, usage), latencyMs: 1000, mode: 'live', startedAt: '2026-10-10T00:02:00.000Z',
});
const analysis = {
  sections: [{ kind: 'hero' as const, name: 'Hero', ids: ['h-0-aaaaaaaa'] }],
  opportunities: [{ title: 'Size the hero image', detail: 'd', metrics: ['lcp' as const] }],
  criteria: [{ id: 'c1', metric: 'lcp' as const, baseline: median.lcp, target: 2500, rationale: 'Hero image.' }], dropped: [],
};
const request = (o: Partial<ReportRequest> = {}): ReportRequest => ({
  runId: RUN, input: { target: 'prospect-landing', brief: 'Make it fast', mode: 'plan' }, targetName: 'prospect-landing', status: 'planned',
  baseline, analysis, gate: { decision: 'approve', via: 'telegram' }, spans: [span(1), span(2)], timingsMs: { intake: 900 }, ...o,
});
const row = (runId: string, o: Partial<RunIndexRow> = {}): RunIndexRow => ({
  runId, target: 'prospect-landing', mode: 'plan', status: 'planned', costUsd: 0.1, startedAt: '2026-10-10T00:00:00.000Z', endedAt: '2026-10-10T00:05:00.000Z', ...o,
});

describe('writeReport', () => {
  it('writes exactly bundle.json and report.md under the run, priced as the sum of its spans', async () => {
    const mem = memoryStore();
    await writeReport(mem.store, targets, request());
    expect(mem.writes().map((w) => w.path)).toEqual([`pocs/prospect-landing/${RUN}/bundle.json`, `pocs/prospect-landing/${RUN}/report.md`]);
    expect(mem.ops.filter((o) => o.op === 'read')).toEqual([]);
    const bundle = JSON.parse(mem.objects.get(`${runDir('prospect-landing', RUN)}/bundle.json`)!.body);
    expect(bundle.report.costUsd).toBe(2 * costUsd(MODELS.terra, usage));
    expect(bundle.report.tokens).toEqual({ input: 12000, cachedInput: 2048, output: 1800 });
    expect(bundle.report).toMatchObject({ status: 'planned', kind: 'fixture', permission: 'owned', baseline: { runs: 3 } });
    expect(bundle.trace).toHaveLength(2);
    expect(mem.objects.get(`${runDir('prospect-landing', RUN)}/report.md`)!.body).toMatch(/Median of 3 Lighthouse runs/);
  });

  it('files a not-allowlisted request under _unlisted with the request as given', async () => {
    const mem = memoryStore();
    await writeReport(mem.store, targets, request({ input: { target: 'https://evil.example/', brief: '', mode: 'plan' }, targetName: undefined, status: 'rejected', rejectReason: 'not_allowlisted', baseline: undefined, analysis: undefined, gate: undefined, spans: [] }));
    const bundle = JSON.parse(mem.objects.get(`pocs/_unlisted/${RUN}/bundle.json`)!.body);
    expect(bundle.report).toMatchObject({ target: 'https://evil.example/', status: 'rejected', rejectReason: 'not_allowlisted', costUsd: 0 });
  });

  describe('secrets', () => {
    const canary = { TELEGRAM_BOT_TOKEN: '7000000001:AAcanaryBotTokenValue0123456789abcdef', CRON_SECRET: 'canary-cron-secret-value', POC_TOKEN_SECRET: 'canary-poc-token-secret', ADMIN_API_TOKEN: 'canary-admin-api-token' };
    beforeEach(() => Object.assign(process.env, canary));
    afterEach(() => { for (const k of Object.keys(canary)) delete process.env[k]; });

    it('writes no known secret even when an error message carries one', async () => {
      const mem = memoryStore();
      const leak = Object.values(canary).join(' ');
      await writeReport(mem.store, targets, request({ status: 'failed', error: `analyze failed: ${leak}`, input: { target: 'prospect-landing', brief: `brief ${canary.ADMIN_API_TOKEN}`, mode: 'plan' } }));
      const written = [...mem.objects.values()].map((o) => o.body).join('\n');
      expect(written).toContain('[redacted]');
      for (const v of Object.values(canary)) expect(written).not.toContain(v);
    });
  });
});

describe('recordRun', () => {
  it('creates the index when there is none, then updates it with the etag', async () => {
    const mem = memoryStore();
    await recordRun(mem.store, row('wrun_A'));
    await recordRun(mem.store, row('wrun_B'));
    await recordRun(mem.store, row('wrun_A', { status: 'failed', capHit: 'run_cap' }));
    expect(mem.writes().map((w) => w.mode)).toEqual(['create', { ifMatch: '"e1"' }, { ifMatch: '"e2"' }]);
    expect(parseRunIndex(mem.objects.get(RUN_INDEX_PATH)!.body).map((r) => [r.runId, r.status, r.capHit])).toEqual([['wrun_A', 'failed', 'run_cap'], ['wrun_B', 'planned', undefined]]);
  });

  it('keeps a concurrent run\'s row by retrying on an etag conflict', async () => {
    const mem = memoryStore({ [RUN_INDEX_PATH]: serializeRunIndex([row('wrun_A')]) });
    let raced = false;
    mem.onBeforeWrite(() => {
      if (raced) return;
      raced = true;
      // Another run's write lands between our read and our write.
      const body = serializeRunIndex([row('wrun_A'), row('wrun_OTHER')]);
      mem.objects.set(RUN_INDEX_PATH, { body, etag: '"other"', contentType: 'application/json' });
    });
    await recordRun(mem.store, row('wrun_B'));
    expect(parseRunIndex(mem.objects.get(RUN_INDEX_PATH)!.body).map((r) => r.runId)).toEqual(['wrun_A', 'wrun_OTHER', 'wrun_B']);
  });

  it('gives up after five conflicts, and refuses to overwrite an unreadable index', async () => {
    const mem = memoryStore({ [RUN_INDEX_PATH]: serializeRunIndex([]) });
    mem.onBeforeWrite(() => mem.objects.set(RUN_INDEX_PATH, { body: serializeRunIndex([]), etag: `"x${Math.random()}"`, contentType: 'application/json' }));
    await expect(recordRun(mem.store, row('wrun_B'))).rejects.toBeInstanceOf(StoreConflictError);
    expect(mem.writes()).toHaveLength(5);

    const bad = memoryStore({ [RUN_INDEX_PATH]: 'not json' });
    await expect(recordRun(bad.store, row('wrun_B'))).rejects.toThrow();
    expect(bad.writes()).toEqual([]);
  });
});

describe('blobStore', () => {
  beforeEach(() => {
    blob.put.mockReset().mockResolvedValue({});
    blob.get.mockReset();
    blob.list.mockReset();
  });

  it('reads private blobs uncached and returns null when missing', async () => {
    blob.get.mockResolvedValueOnce(null).mockResolvedValueOnce({ statusCode: 200, stream: new Response('{"a":1}').body, blob: { etag: '"e9"' } });
    expect(await blobStore().read('runs/index.json')).toBeNull();
    expect(await blobStore().read('runs/index.json')).toEqual({ body: '{"a":1}', etag: '"e9"' });
    expect(blob.get).toHaveBeenCalledWith('runs/index.json', { access: 'private', useCache: false });
  });

  it('refuses a read without an etag, which would make the next guarded write a blind overwrite', async () => {
    blob.get.mockResolvedValueOnce({ statusCode: 200, stream: new Response('{}').body, blob: { etag: '' } });
    await expect(blobStore().read('runs/index.json')).rejects.toThrow(/etag/);
  });

  it('writes private blobs at fixed paths, create-only or guarded by the etag, and never lists', async () => {
    const s = blobStore();
    await s.write('a.json', '{}', { contentType: 'application/json', mode: 'overwrite' });
    await s.write('b.json', '{}', { contentType: 'application/json', mode: 'create' });
    await s.write('c.json', '{}', { contentType: 'application/json', mode: { ifMatch: '"e1"' } });
    expect(blob.put.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['a.json', { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true }],
      ['b.json', { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false }],
      ['c.json', { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ifMatch: '"e1"' }],
    ]);
    expect(blob.list).not.toHaveBeenCalled();
  });

  it('reports an etag mismatch, or a create onto an existing path, as a conflict', async () => {
    blob.put.mockRejectedValueOnce(new BlobPreconditionFailedError());
    await expect(blobStore().write('c.json', '{}', { contentType: 'application/json', mode: { ifMatch: '"e1"' } })).rejects.toBeInstanceOf(StoreConflictError);
    blob.put.mockRejectedValueOnce(new Error('This blob already exists'));
    blob.get.mockResolvedValueOnce({ statusCode: 200, stream: new Response('{}').body, blob: { etag: '"e2"' } });
    await expect(blobStore().write('b.json', '{}', { contentType: 'application/json', mode: 'create' })).rejects.toBeInstanceOf(StoreConflictError);
    blob.put.mockRejectedValueOnce(new Error('network'));
    blob.get.mockResolvedValueOnce(null);
    await expect(blobStore().write('b.json', '{}', { contentType: 'application/json', mode: 'create' })).rejects.toThrow('network');
  });
});
