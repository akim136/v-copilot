// Human gates. Imported by the workflow body, so it stays free of Node APIs.
export type GateDecision = { decision: 'approve' | 'reject'; userId: string; via: 'telegram' | 'admin' };

export const criteriaToken = (runId: string) => `criteria:${runId}`;

// Telegram button IDs. Callback data is `chat:{"a":"ca","v":"<runId>"}`, 53 bytes of Telegram's 64.
export const CRITERIA_BUTTONS = { approve: 'ca', reject: 'cr' } as const;

export function isGateDecision(v: unknown): v is GateDecision {
  const d = v as Partial<GateDecision> | null;
  return typeof d === 'object' && d !== null && (d.decision === 'approve' || d.decision === 'reject')
    && typeof d.userId === 'string' && (d.via === 'telegram' || d.via === 'admin');
}
