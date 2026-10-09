// M1·P1 spike: pause a workflow on a hook, resume it from a Telegram button press.
import { createHook, FatalError, getWorkflowMetadata } from 'workflow';

export type SpikeDecision = { decision: 'approve' | 'reject'; userId: string };

export const spikeToken = (runId: string) => `spike:${runId}`;

export async function spikeGate() {
  'use workflow';
  const { workflowRunId } = getWorkflowMetadata();
  const hook = createHook<SpikeDecision>({ token: spikeToken(workflowRunId) });
  if (await hook.getConflict()) throw new FatalError('spike hook token already owned by another run');
  await sendGateCard(workflowRunId);
  // Await exactly once, then release the token: later presses get HookNotFoundError.
  const payload = await hook;
  hook.dispose();
  await sendOutcome(workflowRunId, payload.decision);
  return payload;
}

async function sendGateCard(runId: string) {
  'use step';
  const { Actions, Button, Card, CardText } = await import('chat');
  const { alexChatThread, getReadyBot } = await import('@/lib/telegram');
  await (await getReadyBot()).thread(alexChatThread()).post(
    Card({
      title: 'v-copilot spike gate',
      children: [
        CardText(`Run ${runId} is waiting. Approve or reject.`),
        Actions([
          Button({ id: 'sa', label: 'Approve', value: runId, style: 'primary' }),
          Button({ id: 'sr', label: 'Reject', value: runId, style: 'danger' }),
        ]),
      ],
    }),
  );
}

async function sendOutcome(runId: string, decision: string) {
  'use step';
  const { alexChatThread, getReadyBot } = await import('@/lib/telegram');
  await (await getReadyBot()).thread(alexChatThread()).post(`Run ${runId}: ${decision} recorded.`);
}
