import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

let attempts = 0;
const blocked = (): never => {
  attempts += 1;
  throw new Error('tests must not make network requests');
};

// How many network requests were attempted since the last call; resets the count.
export function takeNetworkAttempts(): number {
  const n = attempts;
  attempts = 0;
  return n;
}

export function blockNetwork(): void {
  globalThis.fetch = async () => blocked();
  for (const mod of [http, https]) Object.assign(mod, { request: blocked, get: blocked });
  Object.assign(net, { connect: blocked, createConnection: blocked });
  Object.assign(tls, { connect: blocked });
}
