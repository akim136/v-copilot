// Where the CLI may send ADMIN_API_TOKEN (and, for a preview, the protection bypass secret): the local dev
// server, or an akim-projects deployment over HTTPS. Checked before any secret is attached to a request.
export function pocBaseUrl(raw: string | undefined): { url: URL; local: boolean } {
  const url = new URL(raw || 'http://localhost:3000');
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return { url, local: true };
  if (url.protocol !== 'https:' || !url.hostname.endsWith('-akim-projects.vercel.app')) {
    throw new Error(`POC_BASE_URL must be the local dev server or an https akim-projects deployment, not ${url.origin}`);
  }
  return { url, local: false };
}
