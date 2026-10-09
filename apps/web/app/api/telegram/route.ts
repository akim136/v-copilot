import { after } from 'next/server';
import { resumeHook } from 'workflow/api';
import { HookNotFoundError } from 'workflow/errors';
import { getBot, isAlex, RUN_ID } from '@/lib/telegram';
import { spikeToken, type SpikeDecision } from '@/workflows/spike-gate';

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  getBot().onAction(['sa', 'sr'], async (e) => {
    // The adapter has already verified the secret-token header. Only Alex may press.
    if (!isAlex(e.user.userId)) {
      console.warn('telegram: ignored press from non-allowed user');
      return;
    }
    if (!e.value || !RUN_ID.test(e.value)) return;
    const payload: SpikeDecision = { decision: e.actionId === 'sa' ? 'approve' : 'reject', userId: e.user.userId };
    try {
      await resumeHook(spikeToken(e.value), payload);
    } catch (err) {
      if (err instanceof HookNotFoundError || (err as Error)?.name === 'HookNotFoundError') {
        await e.thread?.post(`Run ${e.value}: already handled.`);
        return;
      }
      throw err;
    }
  });
}

export async function POST(req: Request) {
  register();
  return getBot().webhooks.telegram(req, { waitUntil: (task) => after(task) });
}
