import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The monorepo root (where pnpm-workspace.yaml is), found from the working directory; `next dev` runs in apps/web.
function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (dirname(dir) === dir) return process.cwd();
  }
}

// Model recordings for MODEL_MODE=record/replay. Record only writes locally.
export const recordingsDir = () => join(repoRoot(), 'recordings', 'models');
