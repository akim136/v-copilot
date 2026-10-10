const SECRET_ENV = [
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_API_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'PSI_API_KEY',
  'VERCEL_OIDC_TOKEN', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'POC_TOKEN_SECRET', 'CRON_SECRET', 'VERCEL_TOKEN',
];
// A Telegram bot token, in case one arrives inside an upstream error message.
const BOT_TOKEN = /\b\d{6,}:[\w-]{30,}\b/g;

// Error text is written to Blob and sent to Telegram, so known secrets are removed from it first.
export function redactSecrets(text: string): string {
  let out = text.replace(BOT_TOKEN, '[redacted]');
  for (const name of SECRET_ENV) {
    const v = process.env[name];
    if (v && v.length >= 8) out = out.split(v).join('[redacted]');
  }
  return out;
}
