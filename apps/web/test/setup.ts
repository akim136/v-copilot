import { blockNetwork, takeNetworkAttempts } from '@v-copilot/poc-core/testing';
import { afterEach, expect } from 'vitest';

// Tests never make live model, Vercel, Sandbox, Blob, Telegram or page fetches. Every network API throws,
// and a test that attempted a request fails even when the code under test swallowed the error.
blockNetwork();
// A placeholder, so the Gateway provider never reads a cached OIDC token from disk.
process.env.AI_GATEWAY_API_KEY = 'test-placeholder-not-a-key';

afterEach(() => {
  expect(takeNetworkAttempts(), 'network requests attempted').toBe(0);
});
