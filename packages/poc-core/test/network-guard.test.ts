import https from 'node:https';
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { takeNetworkAttempts } from './network-guard';

describe('network guard', () => {
  it('counts a fetch even when the caller swallows the error', async () => {
    await fetch('https://example.com/').catch(() => undefined);
    expect(takeNetworkAttempts()).toBe(1);
  });

  it('blocks node:https and node:net', () => {
    expect(() => https.get('https://example.com/')).toThrow(/network/);
    expect(() => net.connect(443, 'example.com')).toThrow(/network/);
    expect(takeNetworkAttempts()).toBe(2);
  });
});
