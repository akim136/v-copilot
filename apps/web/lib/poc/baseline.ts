import {
  baselineCacheKey, BaselineSchema, fetchPsiField, LIGHTHOUSE_RUNS, lighthouseArgs, medianMetrics, medianRun,
  parseLighthouseResult, type AllowedTarget, type Baseline, type LighthouseRun,
} from '@v-copilot/poc-core';
import { Sandbox } from '@vercel/sandbox';
import { FatalError } from 'workflow';
import type { Store } from '@/lib/store';
import type { SandboxHandle, SaveBaselineRequest } from './types';

// Chromium and Lighthouse 13.5.0 preinstalled (spikes/lighthouse-sandbox.ts prepare, M1·P1).
export const SANDBOX_SNAPSHOT_ID = 'snap_lPPlYwCXqDdth3n0ga8azg5WQuN2';
const SANDBOX_VCPUS = 2;
// Well inside Hobby's 45-minute session; the Sandbox stops itself if the run dies before stopping it.
const SANDBOX_TIMEOUT_MS = 20 * 60_000;

// Sandbox names are lowercase; one per run, so a retried start finds the same Sandbox.
export const sandboxName = (runId: string) => `poc-${runId.toLowerCase().replace(/_/g, '-')}`;

// Today's cached baseline for the target. Anything unreadable or of the wrong shape is a miss, and the
// fresh measurement overwrites it.
export async function readCachedBaseline(store: Store, target: AllowedTarget, now: Date): Promise<Baseline | null> {
  const hit = await store.read(baselineCacheKey(target.url, now));
  if (!hit) return null;
  try {
    const cached = BaselineSchema.parse(JSON.parse(hit.body));
    return cached.url === target.url && cached.runs.length === LIGHTHOUSE_RUNS ? cached : null;
  } catch {
    return null;
  }
}

export async function startSandbox(runId: string): Promise<SandboxHandle> {
  const sbx = await Sandbox.getOrCreate({
    name: sandboxName(runId),
    source: { type: 'snapshot', snapshotId: SANDBOX_SNAPSHOT_ID },
    resources: { vcpus: SANDBOX_VCPUS },
    timeout: SANDBOX_TIMEOUT_MS,
    // A persistent Sandbox keeps a 1.6 GB snapshot of itself when stopped, for 30 days, against Hobby's 15 GB.
    persistent: false,
  });
  let chromePath: string;
  try {
    const find = await sbx.runCommand({
      cmd: 'bash', args: ['-lc', 'find / -name chrome -type f -path "*chrome-linux*" 2>/dev/null | head -1'], sudo: true,
    });
    chromePath = (await find.stdout()).trim();
    // A retry would find the same snapshot.
    if (find.exitCode !== 0 || !chromePath) throw new FatalError('Chromium not found in the Sandbox snapshot');
  } catch (err) {
    // The step gets no handle to remove, so remove the Sandbox here rather than leave it to time out.
    await removeSandbox(sbx).catch(() => {});
    throw err;
  }
  return { name: sbx.name, chromePath };
}

// One Lighthouse run per step, so no step comes near the 300-second function limit.
export async function runLighthouse(handle: SandboxHandle, target: AllowedTarget, index: number): Promise<LighthouseRun> {
  const sbx = await Sandbox.get({ name: handle.name });
  const output = `/tmp/lh-${index}.json`;
  // The URL is an argument, never part of a shell string.
  const res = await sbx.runCommand({ cmd: 'lighthouse', args: lighthouseArgs(target, output), env: { CHROME_PATH: handle.chromePath }, sudo: true });
  if (res.exitCode !== 0) throw new Error(`lighthouse exited with ${res.exitCode}`);
  const file = await sbx.readFileToBuffer({ path: output });
  if (!file) throw new Error('lighthouse wrote no result');
  const lhr: unknown = JSON.parse(file.toString('utf8'));
  // Chrome follows redirects that intake refuses; a measurement of any other page must not become the baseline.
  // mainDocumentUrl is where the document came from after redirects (finalDisplayedUrl follows pushState).
  const urls = (lhr ?? {}) as { mainDocumentUrl?: unknown; finalDisplayedUrl?: unknown };
  const measured = urls.mainDocumentUrl ?? urls.finalDisplayedUrl;
  if (!sameUrl(measured, target.url)) throw new FatalError(`Lighthouse measured ${String(measured)} instead of ${target.url}`);
  return parseLighthouseResult(lhr);
}

function sameUrl(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || !URL.canParse(a)) return false;
  return new URL(a).href === new URL(b).href;
}

export async function stopSandbox(handle: SandboxHandle): Promise<void> {
  await removeSandbox(await Sandbox.get({ name: handle.name }));
}

// Stopped, then deleted so no stopped Sandbox piles up. deleteOrphanSnapshots stays off: the shared Chromium
// snapshot must never go with it.
async function removeSandbox(sbx: Sandbox): Promise<void> {
  try {
    await sbx.stop();
  } finally {
    await sbx.delete();
  }
}

// Field data is context only: a PSI failure leaves it out rather than failing the run.
export async function readPsiField(target: AllowedTarget, f: typeof fetch = fetch): Promise<Record<string, number> | undefined> {
  try {
    return await fetchPsiField(target, { apiKey: process.env.PSI_API_KEY || undefined, fetch: f });
  } catch (err) {
    console.warn('baseline: PSI field data unavailable', (err as Error)?.message);
    return undefined;
  }
}

export function buildBaseline(target: AllowedTarget, req: SaveBaselineRequest): Baseline {
  if (req.runs.length !== LIGHTHOUSE_RUNS) throw new FatalError(`expected ${LIGHTHOUSE_RUNS} Lighthouse runs, got ${req.runs.length}`);
  const mid = medianRun(req.runs);
  return BaselineSchema.parse({
    url: target.url,
    measuredAt: req.measuredAt,
    lighthouseVersion: mid.lighthouseVersion,
    runs: req.runs.map((r) => r.metrics),
    median: medianMetrics(req.runs.map((r) => r.metrics)),
    opportunities: mid.opportunities,
    scriptBytes: mid.scriptBytes,
    ...(req.psiField ? { psiField: req.psiField } : {}),
  });
}

// Caches the measurement for the rest of the UTC day. A failed cache write only costs a re-measure later.
export async function saveBaseline(store: Store, target: AllowedTarget, req: SaveBaselineRequest): Promise<Baseline> {
  const baseline = buildBaseline(target, req);
  try {
    await store.write(baselineCacheKey(target.url, new Date(req.measuredAt)), JSON.stringify(baseline), { contentType: 'application/json', mode: 'overwrite' });
  } catch (err) {
    console.warn('baseline: cache write failed', (err as Error)?.name);
  }
  return baseline;
}
