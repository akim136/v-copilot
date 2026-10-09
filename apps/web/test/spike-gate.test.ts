import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Telegram chat. `failAfterAccept` makes the next call throw *after* Telegram has
// accepted the message, which is how the Chat SDK failed live (state write after the send).
const tg = vi.hoisted(() => ({
  messages: new Map<string, { body: string; actionable: boolean }>(),
  nextId: 1,
  failAfterAccept: 0,
}));

function accept<T>(result: T): T {
  if (tg.failAfterAccept > 0) {
    tg.failAfterAccept--;
    throw new Error('MemoryStateAdapter is not connected. Call connect() first.');
  }
  return result;
}

function deliver(message: unknown) {
  const id = String(tg.nextId++);
  const body = JSON.stringify(message);
  tg.messages.set(id, { body, actionable: body.includes('"type":"button"') });
  return accept({ id, threadId: 'telegram:1', raw: {} });
}

const fakeTelegram = {
  postMessage: async (_threadId: string, message: unknown) => deliver(message),
  editMessage: async (_threadId: string, messageId: string, message: unknown) => {
    const existing = tg.messages.get(messageId);
    if (!existing) throw new Error('Bad Request: message to edit not found');
    const body = JSON.stringify(message);
    if (existing.body === body) throw new Error('Bad Request: message is not modified');
    tg.messages.set(messageId, { body, actionable: body.includes('"type":"button"') });
    return accept({ id: messageId, threadId: 'telegram:1', raw: {} });
  },
};

vi.mock('@/lib/telegram', () => ({
  alexChatThread: () => 'telegram:1',
  getReadyBot: async () => ({
    getAdapter: () => fakeTelegram,
    thread: () => ({ post: (message: unknown) => fakeTelegram.postMessage('telegram:1', message) }),
  }),
}));
vi.mock('workflow', () => ({ createHook: vi.fn(), FatalError: class extends Error {}, getWorkflowMetadata: vi.fn() }));

const { armGateCard, sendGateCard } = await import('@/workflows/spike-gate');

// What the Workflow runtime does with a step: run it, and retry on a throw (default 3 retries).
async function runStep<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries) throw err;
    }
  }
}

const RUN = 'wrun_41M4GCW7PK0GZN9PC2CX634QPA';

// The gate's send sequence as the workflow runs it, each step under the runtime's retry rule.
async function presentGate(runId: string) {
  const messageId = await runStep(() => sendGateCard(runId));
  await runStep(() => armGateCard(runId, messageId));
}
const actionable = () => [...tg.messages.values()].filter((m) => m.actionable).length;

describe('gate card delivery', () => {
  beforeEach(() => {
    tg.messages.clear();
    tg.nextId = 1;
    tg.failAfterAccept = 0;
  });

  it('leaves exactly one actionable card when nothing fails', async () => {
    await presentGate(RUN);
    expect(actionable()).toBe(1);
  });

  it('never leaves a second actionable card when a send is retried after Telegram accepted it', async () => {
    tg.failAfterAccept = 1;
    await presentGate(RUN);
    expect(actionable()).toBe(1);
  });

  it('treats a retried edit that already landed as done', async () => {
    tg.failAfterAccept = 0;
    const messageId = await runStep(() => sendGateCard(RUN));
    tg.failAfterAccept = 1; // the edit lands, then the step throws and is retried
    await expect(runStep(() => armGateCard(RUN, messageId))).resolves.toBeUndefined();
    expect(actionable()).toBe(1);
    expect(tg.messages.size).toBe(1);
  });

  it('still fails the step on a real edit error', async () => {
    await expect(armGateCard(RUN, '999')).rejects.toThrow(/not found/);
  });
});
