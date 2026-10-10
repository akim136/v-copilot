// pnpm poc start <target> --brief "..." --mode plan
// pnpm poc status <runId>
// pnpm poc approve <runId> | reject <runId>
// Calls /api/poc on POC_BASE_URL (default the local dev server) with ADMIN_API_TOKEN from apps/web/.env.local.
// Redirects are refused, so the secrets only ever go to the checked host.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pocBaseUrl } from './base-url';

const envFile = join(import.meta.dirname, '..', '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const USAGE = 'usage: poc start <target> --brief "..." --mode plan | poc status <runId> | poc approve <runId> | poc reject <runId>';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const token = process.env.ADMIN_API_TOKEN;
if (!token) fail('ADMIN_API_TOKEN is not set (apps/web/.env.local)');
let target: ReturnType<typeof pocBaseUrl>;
try {
  target = pocBaseUrl(process.env.POC_BASE_URL);
} catch (err) {
  fail((err as Error).message);
}
const base = target.url;
const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
if (!target.local) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!bypass) fail('VERCEL_AUTOMATION_BYPASS_SECRET is needed to reach a protected preview');
  headers['x-vercel-protection-bypass'] = bypass;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { brief: { type: 'string', default: '' }, mode: { type: 'string', default: 'plan' } },
});
const [command, arg] = positionals;
if (!command || !arg) fail(USAGE);

let res: Response;
if (command === 'start') {
  if (values.mode !== 'plan') fail('only --mode plan exists in Milestone 1');
  res = await fetch(new URL('/api/poc', base), { method: 'POST', headers, redirect: 'error', body: JSON.stringify({ action: 'start', target: arg, brief: values.brief, mode: 'plan' }) });
} else if (command === 'approve' || command === 'reject') {
  res = await fetch(new URL('/api/poc', base), { method: 'POST', headers, redirect: 'error', body: JSON.stringify({ action: command, runId: arg }) });
} else if (command === 'status') {
  const url = new URL('/api/poc', base);
  url.searchParams.set('runId', arg);
  res = await fetch(url, { headers, redirect: 'error' });
} else {
  fail(USAGE);
}

const text = await res.text();
console.log(res.ok ? text : `HTTP ${res.status}: ${text.slice(0, 500)}`);
if (!res.ok) process.exit(1);
