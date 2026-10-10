import { StoreConflictError, type Store, type WriteMode } from '@/lib/store';

// An in-memory Store with Blob's etag semantics, recording every operation.
export function memoryStore(seed: Record<string, string> = {}) {
  const objects = new Map<string, { body: string; etag: string; contentType: string }>();
  let version = 0;
  for (const [path, body] of Object.entries(seed)) objects.set(path, { body, etag: `"e${++version}"`, contentType: 'application/json' });
  const ops: { op: 'read' | 'write'; path: string; mode?: WriteMode }[] = [];
  // Called before a write lands, so a test can slip in a concurrent writer.
  let beforeWrite: ((path: string) => void) | undefined;

  const store: Store = {
    async read(path) {
      ops.push({ op: 'read', path });
      const o = objects.get(path);
      return o ? { body: o.body, etag: o.etag } : null;
    },
    async write(path, body, { contentType, mode }) {
      ops.push({ op: 'write', path, mode });
      beforeWrite?.(path);
      const current = objects.get(path);
      if (mode === 'create' && current) throw new StoreConflictError(`${path} already exists`);
      if (typeof mode === 'object' && current?.etag !== mode.ifMatch) throw new StoreConflictError(`${path} changed`);
      objects.set(path, { body, etag: `"e${++version}"`, contentType });
    },
  };
  return {
    store,
    objects,
    ops,
    writes: () => ops.filter((o) => o.op === 'write'),
    onBeforeWrite(fn: typeof beforeWrite) {
      beforeWrite = fn;
    },
  };
}
