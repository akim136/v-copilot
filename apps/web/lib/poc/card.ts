import { escapeMarkdown as e, formatMetric, METRIC_LABEL, oneLine } from '@v-copilot/poc-core';
import { Actions, Button, Card, CardText, type CardElement } from 'chat';
import { CRITERIA_BUTTONS, type GateDecision } from '@/lib/gates';
import { alexChatThread, getReadyBot } from '@/lib/telegram';
import { redactSecrets } from '@/lib/redact';
import type { CriteriaCard } from './types';

const SHOWN_METRICS = ['performance', 'lcp', 'cls', 'tbt'] as const;

// The card's lines. The adapter reads them as Markdown, so each line is stripped of known secrets and
// escaped whole; with the clips below the message stays well under Telegram's 4,096 characters.
export function criteriaCardLines(c: CriteriaCard): string[] {
  const lines = [
    `Run ${c.runId}`,
    `Brief: ${oneLine(c.brief, 200) || '(none)'}`,
    `Baseline, median of ${c.runs} mobile runs: ${SHOWN_METRICS.map((m) => `${METRIC_LABEL[m]} ${formatMetric(m, c.median[m])}`).join(', ')}`,
  ];
  if (c.criteria.length) {
    lines.push('Proposed success criteria:');
    for (const k of c.criteria) {
      lines.push(`${k.id} ${METRIC_LABEL[k.metric]}: ${formatMetric(k.metric, k.baseline)} to ${formatMetric(k.metric, k.target)}. ${oneLine(k.rationale, 120)}`);
    }
  } else {
    lines.push('No criteria survived the checks in code.');
  }
  if (c.dropped.length) lines.push(`Dropped in code: ${c.dropped.map((d) => `${d.metric} (${d.reason})`).join(', ')}`);
  if (c.opportunities.length) lines.push(`Top opportunities: ${c.opportunities.slice(0, 2).map((o) => oneLine(o, 80)).join('; ')}`);
  lines.push(`Model spend so far: $${c.costUsd.toFixed(4)}`);
  return lines.map((l) => e(redactSecrets(l)));
}

function criteriaCard(c: CriteriaCard, footer?: string, buttons = false): CardElement {
  return Card({
    title: `v-copilot plan: ${c.targetName}`,
    children: [
      ...criteriaCardLines(c).map((l) => CardText(l)),
      ...(footer ? [CardText(footer)] : []),
      ...(buttons
        ? [Actions([
          Button({ id: CRITERIA_BUTTONS.approve, label: 'Approve', value: c.runId, style: 'primary' }),
          Button({ id: CRITERIA_BUTTONS.reject, label: 'Reject', value: c.runId, style: 'danger' }),
        ])]
        : []),
    ],
  });
}

const telegram = async () => (await getReadyBot()).getAdapter('telegram');
const notModified = (err: unknown) => /message is not modified/i.test((err as Error)?.message ?? '');

// Posted without buttons first; a retry after Telegram accepted it only repeats inert text.
export async function postCriteriaCard(c: CriteriaCard): Promise<string> {
  const sent = await (await telegram()).postMessage(alexChatThread(), criteriaCard(c, e('Preparing approval…')));
  return sent.id;
}

// Adds the buttons to that one message. Repeating the edit is a no-op.
export async function armCriteriaCard(c: CriteriaCard, messageId: string): Promise<void> {
  try {
    await (await telegram()).editMessage(alexChatThread(), messageId, criteriaCard(c, e('Approve or reject these criteria.'), true));
  } catch (err) {
    if (!notModified(err)) throw err;
  }
}

// Removes the buttons once the gate is consumed.
export async function closeCriteriaCard(c: CriteriaCard, messageId: string, d: Pick<GateDecision, 'decision' | 'via'>): Promise<void> {
  const footer = e(`${d.decision === 'approve' ? 'Approved' : 'Rejected'} via ${d.via}.`);
  try {
    await (await telegram()).editMessage(alexChatThread(), messageId, criteriaCard(c, footer));
  } catch (err) {
    if (!notModified(err)) throw err;
  }
}

// Plain text from the workflow; escaped and stripped of known secrets before it leaves.
export async function sendAlert(text: string): Promise<void> {
  await (await getReadyBot()).thread(alexChatThread()).post(e(redactSecrets(text)));
}
