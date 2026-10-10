import { z } from 'zod';
import { RunIndexRowSchema, type RunIndexRow } from './schemas';

export const RUN_INDEX_PATH = 'runs/index.json';

const RunIndexSchema = z.strictObject({ version: z.literal(1), rows: z.array(RunIndexRowSchema) });

// A missing index is empty. An unreadable one throws: reading it as empty would reset the 24-hour spend.
export function parseRunIndex(body: string | null): RunIndexRow[] {
  if (body === null) return [];
  return RunIndexSchema.parse(JSON.parse(body)).rows;
}

export function upsertRunIndexRow(rows: readonly RunIndexRow[], row: RunIndexRow): RunIndexRow[] {
  const parsed = RunIndexRowSchema.parse(row);
  const at = rows.findIndex((r) => r.runId === parsed.runId);
  return at === -1 ? [...rows, parsed] : rows.map((r, i) => (i === at ? parsed : r));
}

export function serializeRunIndex(rows: readonly RunIndexRow[]): string {
  return `${JSON.stringify({ version: 1, rows })}\n`;
}
