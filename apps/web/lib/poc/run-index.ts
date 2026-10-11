import { parseRunIndex, RUN_INDEX_PATH, serializeRunIndex, spendLast24h, upsertRunIndexRow, type RunIndexRow } from '@v-copilot/poc-core';
import { StoreConflictError, type Store } from '@/lib/store';

const WRITE_ATTEMPTS = 5;

// Why a run's row did not reach the index, worded so the alert says what to go fix. The original is the cause.
export class RunIndexWriteError extends Error {
  override name = 'RunIndexWriteError';
}

const messageOf = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));
// A schema failure as its first issue ("rows.0.target: …"); a zod message is the whole issue list as JSON.
function whyUnreadable(err: unknown): string {
  const issue = (err as { name?: string; issues?: { path: PropertyKey[]; message: string }[] }).issues?.[0];
  return (err as Error)?.name === 'ZodError' && issue ? `${issue.path.map(String).join('.')}: ${issue.message}` : messageOf(err);
}

function parseIndex(body: string | null, consequence: string, error: new (msg: string, opts: ErrorOptions) => Error): RunIndexRow[] {
  try {
    return parseRunIndex(body);
  } catch (err) {
    throw new error(`${RUN_INDEX_PATH} is unreadable, so ${consequence}: ${whyUnreadable(err)}`, { cause: err });
  }
}

// Model spend of runs that ended in the last 24 hours. An unreadable index throws: the ceiling fails closed.
export async function readDailySpend(store: Store, now: Date): Promise<number> {
  const current = await store.read(RUN_INDEX_PATH);
  return spendLast24h(parseIndex(current?.body ?? null, "the 24-hour spend can't be checked", Error), now);
}

// Adds or replaces this run's row. Read-modify-write guarded by the etag (or create-only when the index
// does not exist yet), so two runs ending together cannot drop each other's rows.
export async function recordRun(store: Store, row: RunIndexRow): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const current = await store.read(RUN_INDEX_PATH).catch((err: unknown) => {
      throw new RunIndexWriteError(`Blob read of ${RUN_INDEX_PATH} failed: ${messageOf(err)}`, { cause: err });
    });
    const rows = parseIndex(current?.body ?? null, 'it was left as is', RunIndexWriteError);
    const body = serializeRunIndex(upsertRunIndexRow(rows, row));
    try {
      await store.write(RUN_INDEX_PATH, body, { contentType: 'application/json', mode: current ? { ifMatch: current.etag } : 'create' });
      return;
    } catch (err) {
      if (!(err instanceof StoreConflictError)) {
        throw new RunIndexWriteError(`Blob write of ${RUN_INDEX_PATH} failed: ${messageOf(err)}`, { cause: err });
      }
      if (attempt === WRITE_ATTEMPTS) {
        throw new RunIndexWriteError(`${RUN_INDEX_PATH} changed between read and write on all ${WRITE_ATTEMPTS} attempts`, { cause: err });
      }
    }
  }
}
