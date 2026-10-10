import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselineCacheKey, checkAllowlist, parseTargetsConfig, type AllowedTarget } from '@v-copilot/poc-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FatalError } from 'workflow';
import { memoryStore } from './fakes';

const lhr = readFileSync(join(import.meta.dirname, '../../../packages/poc-core/test/fixtures/lhr-prospect-landing.json'));

// A fake Sandbox: commands are recorded, Lighthouse "writes" the fixture result.
const sbx = vi.hoisted(() => ({
  commands: [] as { cmd: string; args: string[]; env?: Record<string, string>; sudo?: boolean }[],
  created: [] as unknown[],
  stopped: 0,
  lighthouseExit: 0,
  chrome: '/root/.cache/ms-playwright/chromium-1/chrome-linux/chrome\n',
  result: undefined as Buffer | undefined,
}));
vi.mock('@vercel/sandbox', () => {
  const instance = (name: string) => ({
    name,
    runCommand: async (c: { cmd: string; args: string[]; env?: Record<string, string>; sudo?: boolean }) => {
      sbx.commands.push(c);
      const exitCode = c.cmd === 'lighthouse' ? sbx.lighthouseExit : 0;
      return { exitCode, stdout: async () => (c.cmd === 'bash' ? sbx.chrome : ''), stderr: async () => '' };
    },
    readFileToBuffer: async () => sbx.result ?? lhr,
    stop: async () => void sbx.stopped++,
  });
  return {
    Sandbox: {
      getOrCreate: async (params: { name: string }) => (sbx.created.push(params), instance(params.name)),
      get: async ({ name }: { name: string }) => instance(name),
    },
  };
});

const { buildBaseline, readCachedBaseline, readPsiField, runLighthouse, sandboxName, saveBaseline, startSandbox, stopSandbox, SANDBOX_SNAPSHOT_ID } = await import('@/lib/poc/baseline');

const allowed = checkAllowlist(parseTargetsConfig({ 'prospect-landing': { url: 'https://akim136.github.io/v-copilot/prospect-landing/', permission: 'owned', kind: 'fixture' } }), 'prospect-landing');
if (!allowed.ok) throw new Error('fixture target');
const target: AllowedTarget = allowed.target;
const RUN = 'wrun_01K7AAAAAAAAAAAAAAAAAAAAAA';
const measuredAt = '2026-10-10T00:01:00.000Z';

describe('baseline', () => {
  beforeEach(() => {
    sbx.commands = [];
    sbx.created = [];
    sbx.stopped = 0;
    sbx.lighthouseExit = 0;
    sbx.chrome = '/root/.cache/ms-playwright/chromium-1/chrome-linux/chrome\n';
    sbx.result = undefined;
  });

  it('starts one named Sandbox from the snapshot and finds Chromium', async () => {
    const handle = await startSandbox(RUN);
    expect(handle).toEqual({ name: sandboxName(RUN), chromePath: '/root/.cache/ms-playwright/chromium-1/chrome-linux/chrome' });
    expect(sandboxName(RUN)).toMatch(/^poc-wrun-[0-9a-z]{26}$/);
    expect(sbx.created).toEqual([expect.objectContaining({ name: sandboxName(RUN), source: { type: 'snapshot', snapshotId: SANDBOX_SNAPSHOT_ID } })]);
  });

  it('runs Lighthouse with the URL as an argument and parses all nine metrics', async () => {
    const run = await runLighthouse({ name: 'poc-x', chromePath: '/chrome' }, target, 1);
    const lh = sbx.commands.find((c) => c.cmd === 'lighthouse')!;
    expect(lh.args[0]).toBe(target.url);
    expect(lh.args).toContain('--output-path=/tmp/lh-1.json');
    expect(lh.env).toEqual({ CHROME_PATH: '/chrome' });
    expect(Object.keys(run.metrics).sort()).toEqual(['accessibility', 'cls', 'fcp', 'jsBytes', 'lcp', 'performance', 'seo', 'tbt', 'ttfb']);
    sbx.lighthouseExit = 1;
    await expect(runLighthouse({ name: 'poc-x', chromePath: '/chrome' }, target, 2)).rejects.toThrow(/exited with 1/);
  });

  it('records three runs, the median of every metric and PSI field data, and caches it for the day', async () => {
    const run = await runLighthouse({ name: 'poc-x', chromePath: '/chrome' }, target, 0);
    const slower = { ...run, metrics: { ...run.metrics, lcp: run.metrics.lcp + 1000, seo: 50 } };
    const faster = { ...run, metrics: { ...run.metrics, lcp: run.metrics.lcp - 1000, seo: 100 } };
    const mem = memoryStore();
    const saved = await saveBaseline(mem.store, target, { targetName: target.name, runs: [slower, run, faster], psiField: { LARGEST_CONTENTFUL_PAINT_MS: 4100 }, measuredAt });
    expect(saved.runs).toHaveLength(3);
    // Each metric's median is taken on its own: the middle LCP and the middle SEO score (82, between 50 and 100).
    expect(saved.median).toEqual(run.metrics);
    expect(saved.runs.map((r) => r.seo)).toEqual([50, 82, 100]);
    expect(saved.psiField).toEqual({ LARGEST_CONTENTFUL_PAINT_MS: 4100 });
    expect([...mem.objects.keys()]).toEqual([baselineCacheKey(target.url, new Date(measuredAt))]);

    // Same UTC day: read back. Next day: a miss.
    expect(await readCachedBaseline(mem.store, target, new Date('2026-10-10T23:59:00.000Z'))).toEqual(saved);
    expect(await readCachedBaseline(mem.store, target, new Date('2026-10-11T00:00:01.000Z'))).toBeNull();
  });

  it('refuses any run count other than three', async () => {
    const run = await runLighthouse({ name: 'poc-x', chromePath: '/chrome' }, target, 0);
    expect(() => buildBaseline(target, { targetName: target.name, runs: [run, run], measuredAt })).toThrow(/expected 3/);
  });

  it('treats an unreadable or mismatched cache entry as a miss', async () => {
    const key = baselineCacheKey(target.url, new Date(measuredAt));
    const run = await runLighthouse({ name: 'poc-x', chromePath: '/chrome' }, target, 0);
    const good = buildBaseline(target, { targetName: target.name, runs: [run, run, run], measuredAt });
    const at = new Date(measuredAt);
    expect(await readCachedBaseline(memoryStore({ [key]: 'not json' }).store, target, at)).toBeNull();
    expect(await readCachedBaseline(memoryStore({ [key]: JSON.stringify({ ...good, runs: [run.metrics] }) }).store, target, at)).toBeNull();
    expect(await readCachedBaseline(memoryStore({ [key]: JSON.stringify({ ...good, url: 'https://evil.example/' }) }).store, target, at)).toBeNull();
  });

  it('still returns the baseline when the cache write fails', async () => {
    const run = await runLighthouse({ name: 'poc-x', chromePath: '/chrome' }, target, 0);
    const store = { read: async () => null, write: async () => { throw new Error('blob down'); } };
    await expect(saveBaseline(store, target, { targetName: target.name, runs: [run, run, run], measuredAt })).resolves.toMatchObject({ runs: [run.metrics, run.metrics, run.metrics] });
  });

  it('stops the Sandbox and gives up when the snapshot has no Chromium', async () => {
    sbx.chrome = '';
    const err = await startSandbox(RUN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FatalError);
    expect(sbx.stopped).toBe(1);
  });

  it('refuses a measurement whose main document was not the target', async () => {
    const withUrls = (o: object) => Buffer.from(JSON.stringify({ ...JSON.parse(lhr.toString('utf8')), ...o }));
    sbx.result = withUrls({ mainDocumentUrl: 'https://evil.example/' });
    const err = await runLighthouse({ name: 'poc-x', chromePath: '/chrome' }, target, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FatalError);
    expect(String(err)).toMatch(/evil\.example/);
    // A page that rewrites its own URL after loading was still measured at the target.
    sbx.result = withUrls({ mainDocumentUrl: target.url, finalDisplayedUrl: `${target.url}#/home` });
    await expect(runLighthouse({ name: 'poc-x', chromePath: '/chrome' }, target, 0)).resolves.toMatchObject({ lighthouseVersion: '13.5.0' });
  });

  it('stops the Sandbox by name', async () => {
    await stopSandbox({ name: 'poc-x', chromePath: '/chrome' });
    expect(sbx.stopped).toBe(1);
  });

  it('leaves PSI field data out when PSI fails', async () => {
    const f = vi.fn(async () => new Response('quota', { status: 429 }));
    await expect(readPsiField(target, f)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
