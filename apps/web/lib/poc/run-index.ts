import { parseRunIndex, RUN_INDEX_PATH, serializeRunIndex, spendLast24h, upsertRunIndexRow, type RunIndexRow } from '@v-copilot/poc-core';
import { StoreConflictError, type Store } from '@/lib/store';

const WRITE_ATTEMPTS = 5;

// Model spend of runs that ended in the last 24 hours. An unreadable index throws: the ceiling fails closed.
export async function readDailySpend(store: Store, now: Date): Promise<number> {
  const current = await store.read(RUN_INDEX_PATH);
  return spendLast24h(parseRunIndex(current?.body ?? null), now);
}

// Adds or replaces this run's row. Read-modify-write guarded by the etag (or create-only when the index
// does not exist yet), so two runs ending together cannot drop each other's rows.
export async function recordRun(store: Store, row: RunIndexRow): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const current = await store.read(RUN_INDEX_PATH);
    const body = serializeRunIndex(upsertRunIndexRow(parseRunIndex(current?.body ?? null), row));
    try {
      await store.write(RUN_INDEX_PATH, body, { contentType: 'application/json', mode: current ? { ifMatch: current.etag } : 'create' });
      return;
    } catch (err) {
      if (!(err instanceof StoreConflictError) || attempt === WRITE_ATTEMPTS) throw err;
    }
  }
}
