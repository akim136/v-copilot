// M1·P1 spike: pause a workflow on a hook, resume it from a Telegram button press.
import { createHook, FatalError, getWorkflowMetadata } from 'workflow';

export type SpikeDecision = { decision: 'approve' | 'reject'; userId: string };

export const spikeToken = (runId: string) => `spike:${runId}`;

export async function spikeGate() {
  'use workflow';
  const { workflowRunId } = getWorkflowMetadata();
  const hook = createHook<SpikeDecision>({ token: spikeToken(workflowRunId) });
  if (await hook.getConflict()) throw new FatalError('spike hook token already owned by another run');
  // Two steps so a retried send can never leave a second card with live buttons.
  const messageId = await sendGateCard(workflowRunId);
  await armGateCard(workflowRunId, messageId);
  // Await exactly once, then release the token: later presses get HookNotFoundError.
  const payload = await hook;
  hook.dispose();
  await sendOutcome(workflowRunId, payload.decision);
  return payload;
}

const GATE_TITLE = 'v-copilot spike gate';

// Step 1: post the prompt without buttons and checkpoint its message ID. If Telegram accepted
// the message but the step still threw, the retry only duplicates this inert text.
export async function sendGateCard(runId: string): Promise<string> {
  'use step';
  const { Card, CardText } = await import('chat');
  const { alexChatThread, getReadyBot } = await import('@/lib/telegram');
  const telegram = (await getReadyBot()).getAdapter('telegram');
  const sent = await telegram.postMessage(
    alexChatThread(),
    Card({ title: GATE_TITLE, children: [CardText(`Run ${runId}: preparing approval…`)] }),
  );
  return sent.id;
}

// Step 2: add the buttons to that one message. Repeating the edit is a no-op.
export async function armGateCard(runId: string, messageId: string) {
  'use step';
  const { Actions, Button, Card, CardText } = await import('chat');
  const { alexChatThread, getReadyBot } = await import('@/lib/telegram');
  const telegram = (await getReadyBot()).getAdapter('telegram');
  try {
    await telegram.editMessage(
      alexChatThread(),
      messageId,
      Card({
        title: GATE_TITLE,
        children: [
          CardText(`Run ${runId} is waiting. Approve or reject.`),
          Actions([
            Button({ id: 'sa', label: 'Approve', value: runId, style: 'primary' }),
            Button({ id: 'sr', label: 'Reject', value: runId, style: 'danger' }),
          ]),
        ],
      }),
    );
  } catch (err) {
    // A retry after an edit that already landed: Telegram reports the content as unchanged.
    if (!/message is not modified/i.test((err as Error)?.message ?? '')) throw err;
  }
}

// Best effort: the decision is already consumed, so a failed confirmation must not fail the gate.
async function sendOutcome(runId: string, decision: string) {
  'use step';
  try {
    const { alexChatThread, getReadyBot } = await import('@/lib/telegram');
    await (await getReadyBot()).thread(alexChatThread()).post(`Run ${runId}: ${decision} recorded.`);
  } catch (err) {
    console.error('spike: outcome message failed', (err as Error)?.message);
  }
}
