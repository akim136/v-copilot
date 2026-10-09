// M1·P1 spike: can Lighthouse run inside a Vercel Sandbox, and how noisy is LCP?
//   node --env-file=../.env.local lighthouse-sandbox.ts prepare   # install Chromium + Lighthouse, snapshot
//   node --env-file=../.env.local lighthouse-sandbox.ts run [n]   # n mobile runs (default 5) from the snapshot
// Only measures `prospect-landing` from targets.config.json. Writes results to spikes/.out/.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Sandbox } from '@vercel/sandbox';

const OUT = join(import.meta.dirname, '.out');
const SNAPSHOT_FILE = join(OUT, 'snapshot.json');
const LIGHTHOUSE_VERSION = '13.5.0';
const VCPUS = 2;

const targets = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'targets.config.json'), 'utf8'));
const url: string = targets['prospect-landing'].url;

async function sh(sbx: Sandbox, script: string, sudo = false) {
  const res = await sbx.runCommand({ cmd: 'bash', args: ['-lc', script], sudo });
  const [stdout, stderr] = await Promise.all([res.stdout(), res.stderr()]);
  if (res.exitCode !== 0) throw new Error(`exit ${res.exitCode}: ${script}\n${stderr.slice(-2000)}`);
  return stdout;
}

async function prepare() {
  const sbx = await Sandbox.create({ resources: { vcpus: VCPUS }, timeout: 30 * 60_000 });
  console.log('sandbox', sbx.name);
  try {
    console.log(await sh(sbx, 'cat /etc/os-release | head -3; node -v; nproc'));
    const t0 = Date.now();
    await sh(sbx, `npm i -g lighthouse@${LIGHTHOUSE_VERSION} playwright@1 && npx playwright install --with-deps chromium`, true);
    console.log(await sh(sbx, 'lighthouse --version; ls -d /root/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null || find / -name chrome -type f -path "*chrome-linux*" 2>/dev/null | head -1', true));
    console.log(`install took ${Math.round((Date.now() - t0) / 1000)}s`);
    const snap = await sbx.snapshot({ expiration: 0 });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(SNAPSHOT_FILE, JSON.stringify({ snapshotId: snap.snapshotId, createdAt: new Date().toISOString() }, null, 2));
    console.log('snapshot', snap.snapshotId);
  } catch (err) {
    await sbx.stop().catch(() => {});
    throw err;
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

async function run(n: number) {
  if (!existsSync(SNAPSHOT_FILE)) throw new Error('run `prepare` first');
  const { snapshotId } = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'));
  const t0 = Date.now();
  const sbx = await Sandbox.create({ source: { type: 'snapshot', snapshotId }, resources: { vcpus: VCPUS }, timeout: 20 * 60_000 });
  console.log('sandbox', sbx.name, `ready in ${Math.round((Date.now() - t0) / 1000)}s`);
  const rows = [];
  try {
    const chrome = (await sh(sbx, 'find / -name chrome -type f -path "*chrome-linux*" 2>/dev/null | head -1', true)).trim();
    for (let i = 0; i < n; i++) {
      const s = Date.now();
      await sh(sbx, `CHROME_PATH=${chrome} lighthouse '${url}' --quiet --output=json --output-path=/tmp/lh-${i}.json ` +
        `--only-categories=performance,accessibility,seo --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage"`, true);
      const lhr = JSON.parse((await sbx.readFileToBuffer({ path: `/tmp/lh-${i}.json` }))!.toString('utf8'));
      const a = lhr.audits;
      const row = {
        run: i + 1,
        seconds: Math.round((Date.now() - s) / 1000),
        formFactor: lhr.configSettings.formFactor,
        performance: lhr.categories.performance.score,
        accessibility: lhr.categories.accessibility.score,
        seo: lhr.categories.seo.score,
        lcpMs: a['largest-contentful-paint'].numericValue,
        fcpMs: a['first-contentful-paint'].numericValue,
        tbtMs: a['total-blocking-time'].numericValue,
        cls: a['cumulative-layout-shift'].numericValue,
        ttfbMs: a['server-response-time']?.numericValue,
        runtimeError: lhr.runtimeError?.code,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  } finally {
    await sbx.stop().catch(() => {});
  }
  const lcps = rows.map((r) => r.lcpMs);
  const med = median(lcps);
  const spreadPct = ((Math.max(...lcps) - Math.min(...lcps)) / med) * 100;
  const maxDevPct = Math.max(...lcps.map((x) => Math.abs(x - med) / med)) * 100;
  const summary = { url, vcpus: VCPUS, runs: n, lcpMedianMs: med, lcpSpreadPct: spreadPct, lcpMaxDeviationFromMedianPct: maxDevPct, totalSeconds: Math.round((Date.now() - t0) / 1000), rows };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `run-${Date.now()}.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, rows: undefined }, null, 2));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'prepare') await prepare();
else if (cmd === 'run') await run(Number(arg ?? 5));
else throw new Error('usage: prepare | run [n]');
