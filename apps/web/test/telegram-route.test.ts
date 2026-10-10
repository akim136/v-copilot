import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handler: undefined as undefined | ((e: unknown) => Promise<void>),
  resumeHook: vi.fn(),
  replyFails: false,
  replies: [] as string[],
}));

class HookNotFoundError extends Error {
  override name = 'HookNotFoundError';
}

vi.mock('workflow/errors', () => ({ HookNotFoundError }));
vi.mock('workflow/api', () => ({ resumeHook: h.resumeHook }));
vi.mock('@/workflows/spike-gate', () => ({ spikeToken: (id: string) => `spike:${id}` }));
vi.mock('@/lib/telegram', () => ({
  isAlex: (id: string) => id === '1234567890',
  getBot: () => ({
    onAction: (_ids: string[], fn: (e: unknown) => Promise<void>) => void (h.handler = fn),
    // Stand-in for the adapter: verified update → dispatch the press through waitUntil.
    webhooks: {
      telegram: async (_req: Request, opts: { waitUntil: (t: Promise<unknown>) => void }) => {
        opts.waitUntil(h.handler!(press));
        return new Response('ok');
      },
    },
  }),
}));

const RUN = 'wrun_41M4GCW7PK0GZN9PC2CX634QPA';
const press = {
  actionId: 'sa',
  value: RUN as string,
  user: { userId: '1234567890' },
  thread: {
    post: async (text: string) => {
      if (h.replyFails) throw new Error('Telegram unavailable');
      h.replies.push(text);
    },
  },
};

const { POST } = await import('@/app/api/telegram/route');
const call = () => POST(new Request('https://x/api/telegram', { method: 'POST', body: '{}' }));

describe('telegram route', () => {
  beforeEach(() => {
    h.resumeHook.mockReset();
    h.replyFails = false;
    h.replies = [];
    Object.assign(press, { actionId: 'sa', value: RUN, user: { userId: '1234567890' } });
  });

  it('resumes the hook for Alex and acknowledges', async () => {
    h.resumeHook.mockResolvedValue({});
    expect((await call()).status).toBe(200);
    expect(h.resumeHook).toHaveBeenCalledWith(`spike:${RUN}`, { decision: 'approve', userId: '1234567890' });
  });

  it('acknowledges a press on an already-handled gate', async () => {
    h.resumeHook.mockRejectedValue(new HookNotFoundError('Hook not found'));
    expect((await call()).status).toBe(200);
    expect(h.replies).toEqual([`Run ${RUN}: already handled.`]);
  });

  it('acknowledges an already-handled press even when the courtesy reply fails', async () => {
    h.resumeHook.mockRejectedValue(new HookNotFoundError('Hook not found'));
    h.replyFails = true;
    expect((await call()).status).toBe(200);
  });

  it('returns 500 so Telegram redelivers when resuming fails for another reason', async () => {
    h.resumeHook.mockRejectedValue(new Error('world unavailable'));
    expect((await call()).status).toBe(500);
  });

  it('maps the criteria buttons to the criteria hook with the decision and its source', async () => {
    h.resumeHook.mockResolvedValue({});
    Object.assign(press, { actionId: 'ca' });
    expect((await call()).status).toBe(200);
    Object.assign(press, { actionId: 'cr' });
    expect((await call()).status).toBe(200);
    expect(h.resumeHook.mock.calls).toEqual([
      [`criteria:${RUN}`, { decision: 'approve', userId: '1234567890', via: 'telegram' }],
      [`criteria:${RUN}`, { decision: 'reject', userId: '1234567890', via: 'telegram' }],
    ]);
  });

  it('ignores a press from anyone but Alex', async () => {
    Object.assign(press, { actionId: 'ca', user: { userId: '999' } });
    expect((await call()).status).toBe(200);
    expect(h.resumeHook).not.toHaveBeenCalled();
  });

  it('ignores a press that carries no valid run ID', async () => {
    for (const value of ['', 'wrun_short', `${RUN}x`, '../criteria:wrun_41M4GCW7PK0GZN9PC2CX634QPA']) {
      Object.assign(press, { actionId: 'ca', value });
      expect((await call()).status).toBe(200);
    }
    expect(h.resumeHook).not.toHaveBeenCalled();
  });
});
