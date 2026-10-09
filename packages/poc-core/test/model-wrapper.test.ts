import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  callModel, CapExceededError, MAX_OUTPUT_TOKENS, ModelCallError, modelModeFromEnv, PromptTooLargeError,
  recordingKey, ReplayMissError, type ModelCall,
} from '../src/model-wrapper';
import { MODELS } from '../src/models';
import { costUsd } from '../src/pricing';

type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

const Schema = z.object({ verdict: z.string(), score: z.number() });
const USAGE = { inputTokens: { total: 5000, noCache: 3000, cacheRead: 2000, cacheWrite: undefined }, outputTokens: { total: 400, text: 300, reasoning: 100 } };

function mock(text = JSON.stringify({ verdict: 'ok', score: 7 })) {
  const result: GenerateResult = {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: USAGE,
    warnings: [],
  };
  return new MockLanguageModelV4({ doGenerate: async () => result });
}

function call(overrides: Partial<ModelCall<z.infer<typeof Schema>>> = {}): ModelCall<z.infer<typeof Schema>> {
  return {
    runId: 'wrun_TEST', step: 'analyze', attempt: 1, system: 'You are a test.', prompt: 'Rate this.', schema: Schema,
    mode: 'record', budget: { runCostUsd: 0, dailySpendUsd: 0 }, recordingsDir: mkdtempSync(join(tmpdir(), 'rec-')),
    now: () => new Date('2026-10-09T12:00:00.000Z'),
    ...overrides,
  };
}

const expectedCost = costUsd(MODELS.terra, { inputTokens: 5000, cachedInputTokens: 2000, cacheWriteTokens: 0, outputTokens: 400 });

describe('callModel', () => {
  it('records a structured call with no tools and prices it from the table', async () => {
    const model = mock();
    const c = call({ model });
    const r = await callModel(c);
    expect(r.output).toEqual({ verdict: 'ok', score: 7 });
    expect(r.usage).toEqual({ inputTokens: 5000, cachedInputTokens: 2000, cacheWriteTokens: 0, outputTokens: 400 });
    expect(r.costUsd).toBe(expectedCost);
    expect(r.span).toMatchObject({ runId: 'wrun_TEST', step: 'analyze', model: MODELS.terra, attempt: 1, inputTokens: 5000, cachedInputTokens: 2000, outputTokens: 400, costUsd: expectedCost, mode: 'record', startedAt: '2026-10-09T12:00:00.000Z' });

    expect(model.doGenerateCalls).toHaveLength(1);
    const sent = model.doGenerateCalls[0]!;
    // No tools are offered, so the model cannot call any (the SDK still sends its default toolChoice).
    expect(sent.tools ?? []).toEqual([]);
    expect(sent.responseFormat).toMatchObject({ type: 'json' });
    expect(sent.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(sent.prompt[0]).toMatchObject({ role: 'system', content: 'You are a test.' });

    const files = readdirSync(c.recordingsDir);
    expect(files).toEqual([`${recordingKey(MODELS.terra, c.system, c.prompt, Schema)}.json`]);
    const saved = readFileSync(join(c.recordingsDir, files[0]!), 'utf8');
    expect(saved).not.toContain('Rate this.');
  });

  it('replays a recording with zero model calls and the same output, usage and cost', async () => {
    const recorded = call({ model: mock() });
    const live = await callModel(recorded);
    const model = mock();
    const replayed = await callModel({ ...recorded, mode: 'replay', model });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(replayed.output).toEqual(live.output);
    expect(replayed.usage).toEqual(live.usage);
    expect(replayed.costUsd).toBe(live.costUsd);
    expect(replayed.span).toEqual({ ...live.span, mode: 'replay' });
  });

  it('fails a replay with no recording instead of calling the model', async () => {
    const model = mock();
    await expect(callModel(call({ mode: 'replay', model }))).rejects.toBeInstanceOf(ReplayMissError);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('keys recordings on model, system, prompt and schema', () => {
    const base = recordingKey(MODELS.terra, 's', 'p', Schema);
    expect(recordingKey(MODELS.terra, 's', 'p', Schema)).toBe(base);
    expect(recordingKey(MODELS.luna, 's', 'p', Schema)).not.toBe(base);
    expect(recordingKey(MODELS.terra, 's2', 'p', Schema)).not.toBe(base);
    expect(recordingKey(MODELS.terra, 's', 'p2', Schema)).not.toBe(base);
    expect(recordingKey(MODELS.terra, 's', 'p', Schema.extend({ extra: z.string() }))).not.toBe(base);
  });

  it.each([
    ['the run has passed $1.50', { runCostUsd: 1.51, dailySpendUsd: 0 }, 'run_cap'],
    ['24-hour spend is at $8', { runCostUsd: 0.2, dailySpendUsd: 7.8 }, 'daily_cap'],
  ])('refuses before any call when %s, in every mode', async (_label, budget, reason) => {
    for (const mode of ['live', 'record', 'replay'] as const) {
      const model = mock();
      const err = await callModel(call({ mode, model, budget })).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CapExceededError);
      expect((err as CapExceededError).check.reason).toBe(reason);
      expect(model.doGenerateCalls).toHaveLength(0);
    }
  });

  it('refuses a prompt that could exceed 272K input tokens', async () => {
    const model = mock();
    await expect(callModel(call({ model, prompt: 'x'.repeat(272_001) }))).rejects.toBeInstanceOf(PromptTooLargeError);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('reports the cost of a call whose output failed validation', async () => {
    const err = await callModel(call({ model: mock('{"verdict": 3}') })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelCallError);
    expect((err as ModelCallError).span.costUsd).toBe(expectedCost);
  });

  it('never reaches the network when no mock model is given', async () => {
    await expect(callModel(call({ mode: 'live' }))).rejects.toThrow();
  });
});

describe('modelModeFromEnv', () => {
  it('defaults to replay and accepts only the three modes', () => {
    expect(modelModeFromEnv(undefined)).toBe('replay');
    expect(modelModeFromEnv('')).toBe('replay');
    expect(modelModeFromEnv('record')).toBe('record');
    expect(modelModeFromEnv('live')).toBe('live');
    expect(() => modelModeFromEnv('LIVE')).toThrow();
  });
});
