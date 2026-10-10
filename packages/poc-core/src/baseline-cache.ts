import { createHash } from 'node:crypto';

export function urlHash(url: string): string {
  return createHash('sha256').update(new URL(url).href).digest('hex').slice(0, 16);
}

export function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

// One cached baseline per URL per UTC day: a second run on the same day reads it and starts no Sandbox.
export function baselineCacheKey(url: string, at: Date): string {
  return `cache/baseline/${urlHash(url)}/${utcDate(at)}.json`;
}
