import { describe, expect, it } from 'vitest';
import { MODELS, STEP_MODEL } from '../src/models';
import { costUsd, inputTokenUpperBound, PRICES_PER_MTOK } from '../src/pricing';

const usage = (inputTokens: number, cachedInputTokens: number, outputTokens: number, cacheWriteTokens = 0) =>
  ({ inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens });

describe('models', () => {
  it('pins terra for analyze, page_spec and fix and luna for the summary and honesty check', () => {
    expect(STEP_MODEL).toEqual({
      analyze: 'openai/gpt-5.6-terra', page_spec: 'openai/gpt-5.6-terra', fix: 'openai/gpt-5.6-terra',
      summary: 'openai/gpt-5.6-luna', honesty: 'openai/gpt-5.6-luna',
    });
  });
});

describe('costUsd', () => {
  it('uses the recorded price table', () => {
    expect(PRICES_PER_MTOK).toEqual({
      'openai/gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
      'openai/gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
    });
  });

  it('prices fresh input, cached input and output on terra', () => {
    // 8,000 fresh × $2 + 2,000 cached × $0.20 + 1,000 out × $12 = $0.0284
    expect(costUsd(MODELS.terra, usage(10_000, 2_000, 1_000))).toBeCloseTo(0.0284, 10);
  });

  it('prices luna at a tenth of terra', () => {
    expect(costUsd(MODELS.luna, usage(10_000, 2_000, 1_000))).toBeCloseTo(0.00284, 10);
  });

  it('prices cache writes at 1.25x input', () => {
    // 6,000 fresh × $2 + 4,000 written × $2.50 = $0.022
    expect(costUsd(MODELS.terra, usage(10_000, 0, 0, 4_000))).toBeCloseTo(0.022, 10);
  });

  it('prices a prompt over 272K input tokens at 2x input and 1.5x output rather than understating it', () => {
    // 300,000 × $4 + 1,000 × $18 = $1.218
    expect(costUsd(MODELS.terra, usage(300_000, 0, 1_000))).toBeCloseTo(1.218, 10);
    expect(costUsd(MODELS.terra, usage(272_000, 0, 1_000))).toBeCloseTo(0.556, 10);
  });

  it.each([
    ['negative tokens', usage(-1, 0, 0)],
    ['fractional tokens', usage(1.5, 0, 0)],
    ['NaN', usage(Number.NaN, 0, 0)],
    ['cached more than input', usage(100, 200, 0)],
  ])('rejects %s', (_label, u) => {
    expect(() => costUsd(MODELS.terra, u)).toThrow();
  });
});

describe('inputTokenUpperBound', () => {
  it('counts UTF-8 bytes, never fewer than the tokens the text can produce', () => {
    expect(inputTokenUpperBound('abc', 'é')).toBe(5);
    expect(inputTokenUpperBound('🙂')).toBe(4);
  });
});
