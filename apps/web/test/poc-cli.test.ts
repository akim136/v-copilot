import { describe, expect, it } from 'vitest';
import { pocBaseUrl } from '@/scripts/base-url';

describe('poc CLI base URL', () => {
  it('defaults to the local dev server and allows it over http', () => {
    expect(pocBaseUrl(undefined)).toEqual({ url: new URL('http://localhost:3000'), local: true });
    expect(pocBaseUrl('http://127.0.0.1:3001')).toMatchObject({ local: true });
  });

  it('allows an akim-projects deployment over https', () => {
    expect(pocBaseUrl('https://v-copilot-git-m1-p3-workflow-akim-projects.vercel.app')).toMatchObject({ local: false });
  });

  it('refuses any other host, or http to a remote host, before a secret is attached', () => {
    for (const raw of [
      'http://v-copilot-git-m1-p3-workflow-akim-projects.vercel.app',
      'https://evil.example',
      'https://v-copilot.vercel.app',
      'https://someone-else-akim-projects.vercel.app',
      'https://v-copilot-akim-projects.vercel.app.evil.example',
      'not a url',
    ]) expect(() => pocBaseUrl(raw)).toThrow();
  });
});
