import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTargetsConfig, RUN_INDEX_PATH, serializeRunIndex, type RunIndexRow } from '@v-copilot/poc-core';
import { describe, expect, it, vi } from 'vitest';
import { FatalError } from 'workflow';
import { MAX_HTML_BYTES, MAX_IMAGE_PROBES, runIntake, type IntakeDeps } from '@/lib/poc/intake';
import { readDailySpend } from '@/lib/poc/run-index';
import { memoryStore } from './fakes';

const BASE = 'https://akim136.github.io/v-copilot/prospect-landing/';
const targets = parseTargetsConfig({ 'prospect-landing': { url: BASE, permission: 'owned', kind: 'fixture' } });
const html = readFileSync(join(import.meta.dirname, '../../../fixtures/prospects/landing/index.html'), 'utf8');
const input = { target: 'prospect-landing', brief: '', mode: 'plan' as const };

// The first bytes of a PNG: enough for its dimensions.
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

type Route = (init: RequestInit | undefined) => Response;
function fakeFetch(routes: Record<string, Route>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = routes[String(url)];
    if (!route) throw new Error(`unexpected fetch ${String(url)}`);
    return route(init);
  });
}
const page = (body: BodyInit = html, headers: HeadersInit = { 'content-type': 'text/html; charset=utf-8' }, status = 200): Route => () => new Response(body, { status, headers });
const image = (w: number, h: number): Route => () => new Response(png(w, h), { status: 206, headers: { 'content-type': 'image/png' } });

function deps(fetch: IntakeDeps['fetch'], spent = 0): IntakeDeps & { readDailySpend: ReturnType<typeof vi.fn> } {
  return { targets, fetch, readDailySpend: vi.fn(async () => spent) };
}

describe('intake', () => {
  it('refuses an unlisted target before reading the index or fetching anything', async () => {
    const f = fakeFetch({});
    const d = deps(f);
    for (const target of ['https://evil.example/', 'prospect-landing-2', `${BASE}?x=1`, 'http://akim136.github.io/v-copilot/prospect-landing/']) {
      expect(await runIntake({ ...input, target }, d)).toEqual({ ok: false, reason: 'not_allowlisted' });
    }
    expect(f).not.toHaveBeenCalled();
    expect(d.readDailySpend).not.toHaveBeenCalled();
  });

  it('refuses at $8 of spend in the last 24 hours before fetching the page', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const row = (runId: string, costUsd: number, endedAt: string): RunIndexRow => ({
      runId, target: 'prospect-landing', mode: 'plan', status: 'planned', costUsd, startedAt: endedAt, endedAt,
    });
    const { store } = memoryStore({
      [RUN_INDEX_PATH]: serializeRunIndex([row('wrun_A', 5, '2026-10-10T01:00:00.000Z'), row('wrun_B', 3, '2026-10-09T13:00:00.000Z'), row('wrun_OLD', 50, '2026-10-09T11:00:00.000Z')]),
    });
    const f = fakeFetch({});
    const res = await runIntake(input, { targets, fetch: f, readDailySpend: () => readDailySpend(store, now) });
    expect(res).toEqual({ ok: false, reason: 'daily_cap', targetName: 'prospect-landing', spentUsd: 8 });
    expect(f).not.toHaveBeenCalled();
  });

  it('extracts identical outline IDs from the same page twice', async () => {
    const routes = { [BASE]: page() };
    const a = await runIntake(input, deps(fakeFetch(routes)));
    const b = await runIntake(input, deps(fakeFetch(routes)));
    if (!a.ok || !b.ok) throw new Error('intake failed');
    expect(a.outline.order.length).toBeGreaterThan(10);
    expect(b.outline).toEqual(a.outline);
  });

  it('fetches the page without following redirects and refuses one', async () => {
    const f = fakeFetch({ [BASE]: page('', { location: 'https://evil.example/' }, 301) });
    const err = await runIntake(input, deps(f)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FatalError);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });

  it('refuses a page that is not HTML or is too large, and retries a server error', async () => {
    await expect(runIntake(input, deps(fakeFetch({ [BASE]: page('{}', { 'content-type': 'application/json' }) })))).rejects.toBeInstanceOf(FatalError);
    await expect(runIntake(input, deps(fakeFetch({ [BASE]: page('x'.repeat(MAX_HTML_BYTES + 1)) })))).rejects.toThrow(/larger than/);
    await expect(runIntake(input, deps(fakeFetch({ [BASE]: page('nope', {}, 404) })))).rejects.toBeInstanceOf(FatalError);
    const err = await runIntake(input, deps(fakeFetch({ [BASE]: page('down', {}, 503) }))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(FatalError);
  });

  it('reads the size of unsized images on the target with a ranged request, and never fetches other origins', async () => {
    const sized = `<main><img src="assets/a.png" alt="A"><img src="https://cdn.evil.example/b.png" alt="B"><img src="../other/c.png" alt="C"><img src="assets/d.png" width="10" height="10" alt="D"></main>`;
    const f = fakeFetch({ [BASE]: page(sized), [`${BASE}assets/a.png`]: image(1600, 900) });
    const res = await runIntake(input, deps(f));
    if (!res.ok) throw new Error('intake failed');
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([BASE, `${BASE}assets/a.png`]);
    expect(f.mock.calls[1]![1]).toMatchObject({ redirect: 'manual', headers: { range: 'bytes=0-65535' } });
    expect(res.imageSizes).toEqual([[`${BASE}assets/a.png`, { width: 1600, height: 900 }]]);
    expect(res.outline.images.map((i) => [i.width, i.height])).toEqual([[1600, 900], [0, 0], [0, 0], [10, 10]]);
  });

  it('probes at most 24 images and leaves a failed probe unknown', async () => {
    const tags = Array.from({ length: 30 }, (_, i) => `<img src="assets/${i}.png" alt="${i}">`).join('');
    const routes: Record<string, Route> = { [BASE]: page(`<main>${tags}</main>`) };
    for (let i = 0; i < 30; i++) routes[`${BASE}assets/${i}.png`] = i === 3 ? () => { throw new TypeError('fetch failed'); } : image(200, 100);
    const f = fakeFetch(routes);
    const res = await runIntake(input, deps(f));
    if (!res.ok) throw new Error('intake failed');
    expect(f).toHaveBeenCalledTimes(1 + MAX_IMAGE_PROBES);
    expect(res.imageSizes).toHaveLength(MAX_IMAGE_PROBES - 1);
  });
});
