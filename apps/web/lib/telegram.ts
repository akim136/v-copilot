import { createMemoryState } from '@chat-adapter/state-memory';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { Chat } from 'chat';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let bot: Chat<{ telegram: ReturnType<typeof createTelegramAdapter> }> | undefined;

// Webhook-only Telegram bot. The adapter rejects any update whose
// x-telegram-bot-api-secret-token header does not match TELEGRAM_WEBHOOK_SECRET.
// Memory state is enough: gates are made at-most-once by the workflow hook, not by chat state.
export function getBot() {
  bot ??= new Chat({
    userName: 'v-copilot',
    adapters: {
      telegram: createTelegramAdapter({
        botToken: required('TELEGRAM_BOT_TOKEN'),
        secretToken: required('TELEGRAM_WEBHOOK_SECRET'),
        mode: 'webhook',
      }),
    },
    state: createMemoryState(),
  });
  return bot;
}

// Posting outside a webhook (from a workflow step) must initialize the state adapter first.
export async function getReadyBot() {
  const b = getBot();
  await b.initialize();
  return b;
}

export const alexChatThread = () => `telegram:${required('TELEGRAM_CHAT_ID')}`;
export const isAlex = (userId: string) => userId === required('TELEGRAM_ALEX_USER_ID');
