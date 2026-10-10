import { resumeHook } from 'workflow/api';
import { HookNotFoundError } from 'workflow/errors';
import { CRITERIA_BUTTONS, criteriaToken, type GateDecision } from '@/lib/gates';
import { RUN_ID } from '@/lib/run-id';
import { getBot, isAlex } from '@/lib/telegram';

// Button ID → resume the hook it belongs to with the decision it carries.
const criteria = (decision: GateDecision['decision']) => (runId: string, userId: string) =>
  resumeHook(criteriaToken(runId), { decision, userId, via: 'telegram' } satisfies GateDecision);
const BUTTONS: Record<string, (runId: string, userId: string) => Promise<unknown>> = {
  [CRITERIA_BUTTONS.approve]: criteria('approve'),
  [CRITERIA_BUTTONS.reject]: criteria('reject'),
};

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  getBot().onAction(Object.keys(BUTTONS), async (e) => {
    // The adapter has already verified the secret-token header. Only Alex may press.
    if (!isAlex(e.user.userId)) {
      console.warn('telegram: ignored press from non-allowed user');
      return;
    }
    const resume = Object.hasOwn(BUTTONS, e.actionId) ? BUTTONS[e.actionId] : undefined;
    if (!resume || !e.value || !RUN_ID.test(e.value)) return;
    try {
      await resume(e.value, e.user.userId);
    } catch (err) {
      if (err instanceof HookNotFoundError || (err as Error)?.name === 'HookNotFoundError') {
        // The gate is already consumed; the reply is a courtesy and must not trigger a redelivery.
        await e.thread?.post(`Run ${e.value}: already handled.`).catch(() => {});
        return;
      }
      throw err;
    }
  });
}

// Resume the hook before acknowledging Telegram: if it fails, a 500 makes Telegram redeliver,
// and a redelivery after a partial success only reaches the disposed hook ("already handled").
export async function POST(req: Request) {
  register();
  const tasks: Promise<unknown>[] = [];
  const res = await getBot().webhooks.telegram(req, { waitUntil: (t) => void tasks.push(t), propagateHandlerErrors: true });
  try {
    await Promise.all(tasks);
  } catch (err) {
    console.error('telegram: action failed', (err as Error)?.name);
    return new Response('action failed', { status: 500 });
  }
  return res;
}
