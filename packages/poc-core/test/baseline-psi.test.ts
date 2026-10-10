import { describe, expect, it } from 'vitest';
import { checkAllowlist, type AllowedTarget } from '../src/allowlist';
import { baselineCacheKey, urlHash } from '../src/baseline-cache';
import { fetchPsiField, PSI_ENDPOINT, PsiError } from '../src/psi';
import { parseTargetsConfig } from '../src/targets';

const LANDING = 'https://akim136.github.io/v-copilot/prospect-landing/';

describe('baselineCacheKey', () => {
  it('is cache/baseline/<urlHash>/<yyyy-mm-dd>.json', () => {
    expect(baselineCacheKey(LANDING, new Date('2026-10-09T08:00:00Z'))).toMatch(/^cache\/baseline\/[0-9a-f]{16}\/2026-10-09\.json$/);
  });

  it('is the same all UTC day and changes at UTC midnight', () => {
    const morning = baselineCacheKey(LANDING, new Date('2026-10-09T00:00:00Z'));
    expect(baselineCacheKey(LANDING, new Date('2026-10-09T23:59:59Z'))).toBe(morning);
    expect(baselineCacheKey(LANDING, new Date('2026-10-10T00:00:00Z'))).not.toBe(morning);
    // 17:30 in Los Angeles on Oct 9 is already Oct 10 in UTC.
    expect(baselineCacheKey(LANDING, new Date('2026-10-09T17:30:00-07:00'))).toContain('/2026-10-10.json');
  });

  it('hashes the normalized URL so equivalent spellings share a key and different pages do not', () => {
    expect(urlHash('https://AKIM136.github.io/v-copilot/prospect-landing/')).toBe(urlHash(LANDING));
    expect(urlHash('https://akim136.github.io/v-copilot/prospect-docs/')).not.toBe(urlHash(LANDING));
  });
});

describe('fetchPsiField', () => {
  const r = checkAllowlist(parseTargetsConfig({ 'prospect-landing': { url: LANDING, permission: 'owned', kind: 'fixture' } }), 'prospect-landing');
  const target = (r.ok ? r.target : undefined) as AllowedTarget;
  const KEY = 'psi-test-key-0000';

  const respond = (status: number, body: unknown) => {
    const calls: { url: URL; headers: Headers }[] = [];
    const fetchFn = (async (input: URL, init?: RequestInit) => {
      calls.push({ url: input, headers: new Headers(init?.headers) });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  };

  it('asks for mobile performance data for the target URL, with the key in a header, never the URL', async () => {
    const { calls, fetchFn } = respond(200, {});
    await fetchPsiField(target, { apiKey: KEY, fetch: fetchFn });
    const { url, headers } = calls[0]!;
    expect(`${url.origin}${url.pathname}`).toBe(PSI_ENDPOINT);
    // Request URLs end up in traces, so the key travels only in the header.
    expect(Object.fromEntries(url.searchParams)).toEqual({ url: LANDING, strategy: 'mobile', category: 'performance' });
    expect(url.href).not.toContain(KEY);
    expect(headers.get('x-goog-api-key')).toBe(KEY);
  });

  it('returns URL-level field percentiles, with CLS rescaled', async () => {
    const { fetchFn } = respond(200, { loadingExperience: { metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2600, category: 'AVERAGE' },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12, category: 'AVERAGE' },
    } } });
    expect(await fetchPsiField(target, { fetch: fetchFn })).toEqual({ LARGEST_CONTENTFUL_PAINT_MS: 2600, CUMULATIVE_LAYOUT_SHIFT_SCORE: 0.12 });
  });

  it.each([
    ['no loading experience', {}],
    ['no metrics', { loadingExperience: { overall_category: 'NONE' } }],
    ['origin-level fallback', { loadingExperience: { origin_fallback: true, metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1 } } } }],
    ['empty metrics', { loadingExperience: { metrics: {} } }],
  ])('returns undefined with %s', async (_label, body) => {
    expect(await fetchPsiField(target, { fetch: respond(200, body).fetchFn })).toBeUndefined();
  });

  it('fails on an HTTP error without leaking the key', async () => {
    const err = await fetchPsiField(target, { apiKey: KEY, fetch: respond(403, { error: 'bad key' }).fetchFn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PsiError);
    expect(String((err as Error).message)).not.toContain(KEY);
    expect((err as Error).message).toContain('403');
  });

  it('fails on a network error without leaking the key', async () => {
    const fetchFn = (async (input: URL) => { throw new TypeError(`fetch failed for ${input.href}`); }) as unknown as typeof fetch;
    const err = await fetchPsiField(target, { apiKey: KEY, fetch: fetchFn }).catch((e: unknown) => e) as Error;
    expect(err).toBeInstanceOf(PsiError);
    expect(JSON.stringify({ m: err.message, s: err.stack })).not.toContain(KEY);
  });
});
