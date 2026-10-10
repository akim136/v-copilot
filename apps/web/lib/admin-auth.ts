import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s: string) => createHash('sha256').update(s).digest();

export const notFound = () => new Response('Not found', { status: 404 });

// Admin-only, never in production. Compares SHA-256 digests so lengths always match.
export function isAdmin(req: Request): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  const expected = process.env.ADMIN_API_TOKEN;
  const header = req.headers.get('authorization') ?? '';
  if (!expected || !header.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(expected));
}
