import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAllowlist, isWithinTarget, type AllowedTarget } from '../src/allowlist';
import { parseTargetsConfig } from '../src/targets';

const config = parseTargetsConfig(JSON.parse(readFileSync(new URL('../../../targets.config.json', import.meta.url), 'utf8')));
const LANDING = 'https://akim136.github.io/v-copilot/prospect-landing/';

function allowed(nameOrUrl: string): AllowedTarget {
  const r = checkAllowlist(config, nameOrUrl);
  if (!r.ok) throw new Error(`expected ${nameOrUrl} to be allowlisted`);
  return r.target;
}

describe('checkAllowlist', () => {
  it('resolves a target by name', () => {
    expect(allowed('prospect-landing')).toMatchObject({ name: 'prospect-landing', url: LANDING, permission: 'owned', kind: 'fixture' });
  });

  it('resolves a target by its exact URL', () => {
    expect(allowed(LANDING).name).toBe('prospect-landing');
    expect(allowed('https://AKIMBUILDS.com').name).toBe('akimbuilds');
  });

  it.each([
    ['unknown name', 'prospect-shop'],
    ['unlisted URL', 'https://example.com/'],
    ['missing trailing slash', 'https://akim136.github.io/v-copilot/prospect-landing'],
    ['other path on a listed origin', 'https://akim136.github.io/v-copilot/prospect-landing/admin/'],
    ['http instead of https', 'http://akim136.github.io/v-copilot/prospect-landing/'],
    ['query string', `${LANDING}?x=1`],
    ['fragment', `${LANDING}#top`],
    ['credentials', 'https://user:pw@akimbuilds.com/'],
    ['prototype key', '__proto__'],
    ['inherited key', 'toString'],
    ['empty', ''],
  ])('refuses %s', (_label, input) => {
    expect(checkAllowlist(config, input)).toEqual({ ok: false, reason: 'not_allowlisted' });
  });

  it('returns a frozen copy so callers cannot repoint the target', () => {
    const t = allowed('stagger');
    expect(Object.isFrozen(t)).toBe(true);
    expect(config.stagger!.url).toBe('https://stagger.dev/');
  });
});

describe('isWithinTarget', () => {
  const landing = allowed('prospect-landing');
  const akimbuilds = allowed('akimbuilds');

  it('accepts subresources under the target path', () => {
    expect(isWithinTarget(landing, `${LANDING}assets/hero-dashboard.jpg`)).toBe(true);
    expect(isWithinTarget(akimbuilds, 'https://akimbuilds.com/_next/image?url=x')).toBe(true);
  });

  it.each([
    ['a sibling fixture', 'https://akim136.github.io/v-copilot/prospect-docs/assets/a.png'],
    ['a traversal out of the target path', `${LANDING}../prospect-docs/assets/a.png`],
    ['another origin', 'https://cdn.example.com/v-copilot/prospect-landing/a.png'],
    ['plain http', 'http://akim136.github.io/v-copilot/prospect-landing/a.png'],
    ['credentials', 'https://u:p@akim136.github.io/v-copilot/prospect-landing/a.png'],
    ['not a URL', 'assets/a.png'],
  ])('rejects %s', (_label, url) => {
    expect(isWithinTarget(landing, url)).toBe(false);
  });
});
