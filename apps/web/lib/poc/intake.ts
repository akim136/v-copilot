import {
  checkAllowlist, checkDailyCap, extractOutline, imageDimensions, isWithinTarget, type AllowedTarget, type TargetsConfig,
} from '@v-copilot/poc-core';
import { FatalError } from 'workflow';
import type { IntakeResult, PocInput } from './types';

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_PROBES = 24;
// Enough of a PNG, JPEG, GIF or WebP file to read its dimensions.
export const IMAGE_PROBE_BYTES = 64 * 1024;
const PAGE_TIMEOUT_MS = 30_000;
const IMAGE_TIMEOUT_MS = 10_000;

export interface IntakeDeps {
  targets: TargetsConfig;
  readDailySpend: () => Promise<number>;
  fetch: typeof fetch;
}

// Reads at most `limit` bytes of a body. With `truncate`, a longer body is cut off; without it, refused.
async function readCapped(res: Response, limit: number, truncate: boolean): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = limit - total;
      if (value.byteLength > room) {
        if (!truncate) throw new FatalError(`page is larger than ${limit} bytes`);
        chunks.push(value.subarray(0, room));
        total = limit;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// The page itself: no redirects followed (a redirect could leave the allowlist), HTML only, size-capped.
async function fetchPage(target: AllowedTarget, f: typeof fetch): Promise<string> {
  const res = await f(target.url, { redirect: 'manual', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  if (res.status >= 300 && res.status < 400) throw new FatalError(`target answered ${res.status}; redirects are not followed`);
  if (res.status >= 500) throw new Error(`target answered ${res.status}`);
  if (!res.ok) throw new FatalError(`target answered ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/^text\/html\b/i.test(type)) throw new FatalError('target did not return text/html');
  return new TextDecoder().decode(await readCapped(res, MAX_HTML_BYTES, false));
}

// The first bytes of an image on the target's own path, for its dimensions. Any failure leaves it unknown.
async function probeImage(src: string, f: typeof fetch) {
  try {
    const res = await f(src, {
      redirect: 'manual', headers: { range: `bytes=0-${IMAGE_PROBE_BYTES - 1}` }, signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (res.status !== 200 && res.status !== 206) {
      await res.body?.cancel().catch(() => {});
      return undefined;
    }
    return imageDimensions(await readCapped(res, IMAGE_PROBE_BYTES, true));
  } catch {
    return undefined;
  }
}

// Allowlist first, then the 24-hour spend ceiling, and only then the first network request.
export async function runIntake(input: PocInput, deps: IntakeDeps): Promise<IntakeResult> {
  const allowed = checkAllowlist(deps.targets, input.target);
  if (!allowed.ok) return { ok: false, reason: 'not_allowlisted' };
  const target = allowed.target;

  const spentUsd = await deps.readDailySpend();
  if (!checkDailyCap(spentUsd).ok) return { ok: false, reason: 'daily_cap', targetName: target.name, spentUsd };

  const html = await fetchPage(target, deps.fetch);
  const first = extractOutline(html, { baseUrl: target.url });
  const unknown = [...new Set(first.images.filter((i) => !i.width || !i.height).map((i) => i.src))]
    .filter((src) => isWithinTarget(target, src))
    .slice(0, MAX_IMAGE_PROBES);
  const sizes = await Promise.all(unknown.map((src) => probeImage(src, deps.fetch)));
  const imageSizes = unknown.flatMap((src, i): [string, { width: number; height: number }][] => (sizes[i] ? [[src, sizes[i]]] : []));
  const outline = imageSizes.length ? extractOutline(html, { baseUrl: target.url, imageSizes: new Map(imageSizes) }) : first;
  return { ok: true, targetName: target.name, html, imageSizes, outline };
}
