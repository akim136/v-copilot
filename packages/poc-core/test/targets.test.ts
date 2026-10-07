import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTargetsConfig } from '../src/targets';

const configPath = fileURLToPath(new URL('../../../targets.config.json', import.meta.url));
const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;

describe('targets.config.json', () => {
  it('validates with the six spec targets', () => {
    const targets = parseTargetsConfig(raw);
    expect(Object.keys(targets).sort()).toEqual(
      ['akimbuilds', 'prospect-blog', 'prospect-catalog', 'prospect-docs', 'prospect-landing', 'stagger'],
    );
    expect(Object.values(targets).filter((t) => t.kind === 'fixture')).toHaveLength(4);
    expect(Object.values(targets).filter((t) => t.kind === 'control')).toHaveLength(2);
  });

  it('serves every fixture from GitHub Pages, never from Vercel', () => {
    for (const t of Object.values(parseTargetsConfig(raw))) {
      if (t.kind === 'fixture') expect(new URL(t.url).host).toBe('akim136.github.io');
    }
  });

  it.each([
    ['http url', { a: { url: 'http://example.com/', permission: 'owned', kind: 'fixture' } }],
    ['missing permission', { a: { url: 'https://example.com/', kind: 'fixture' } }],
    ['unknown permission', { a: { url: 'https://example.com/', permission: 'maybe', kind: 'fixture' } }],
    ['extra key', { a: { url: 'https://example.com/', permission: 'owned', kind: 'fixture', x: 1 } }],
    ['bad name', { 'Bad Name': { url: 'https://example.com/', permission: 'owned', kind: 'fixture' } }],
    ['empty', {}],
  ])('rejects %s', (_label, bad) => {
    expect(() => parseTargetsConfig(bad)).toThrow();
  });
});
