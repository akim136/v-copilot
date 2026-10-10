// Where the CLI may send ADMIN_API_TOKEN (and, for a preview, the protection bypass secret): the local dev
// server, or a v-copilot deployment on akim-projects over HTTPS. Checked before any secret is attached to a request.
export function pocBaseUrl(raw: string | undefined): { url: URL; local: boolean } {
  const url = new URL(raw || 'http://localhost:3000');
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return { url, local: true };
  if (url.protocol !== 'https:' || !/^v-copilot-[a-z0-9-]+-akim-projects\.vercel\.app$/.test(url.hostname)) {
    throw new Error(`POC_BASE_URL must be the local dev server or an https v-copilot deployment on akim-projects, not ${url.origin}`);
  }
  return { url, local: false };
}
