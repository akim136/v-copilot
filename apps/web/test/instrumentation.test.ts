import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const world = vi.hoisted(() => ({ start: vi.fn(), getWorld: vi.fn() }));
vi.mock('workflow/runtime', () => ({ getWorld: world.getWorld }));

const { register } = await import('@/instrumentation');

describe('register', () => {
  beforeEach(() => {
    world.start.mockReset().mockResolvedValue(undefined);
    world.getWorld.mockReset().mockResolvedValue({ start: world.start });
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VERCEL', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('starts the local World, which re-queues runs a killed dev server left running', async () => {
    await register();
    expect(world.start).toHaveBeenCalledTimes(1);
  });

  it('leaves a Vercel deployment and the edge runtime alone', async () => {
    vi.stubEnv('VERCEL', '1');
    await register();
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(world.getWorld).not.toHaveBeenCalled();
  });
});
