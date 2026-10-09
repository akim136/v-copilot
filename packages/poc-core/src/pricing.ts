import { MODELS, type ModelId } from './models';
import { TokenUsageSchema, type TokenUsage } from './schemas';

// USD per million tokens for prompts up to 272K input tokens, from OpenAI's pricing page (2026-10-07).
export const PRICES_PER_MTOK: Readonly<Record<ModelId, { input: number; cachedInput: number; output: number }>> = Object.freeze({
  [MODELS.terra]: { input: 2.0, cachedInput: 0.2, output: 12.0 },
  [MODELS.luna]: { input: 0.2, cachedInput: 0.02, output: 1.2 },
});
export const CACHE_WRITE_MULTIPLIER = 1.25;

// Prompts above this are priced higher (2x input, 1.5x output). The model wrapper refuses to send one;
// if a call still lands above it, it is priced at the higher rate so spend is never understated.
export const MAX_INPUT_TOKENS = 272_000;
const LONG_INPUT_MULTIPLIER = 2;
const LONG_OUTPUT_MULTIPLIER = 1.5;

// Never fewer tokens than the text will tokenize to: every token is at least one UTF-8 byte.
export function inputTokenUpperBound(...texts: string[]): number {
  return texts.reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0);
}

// Cost of one call. inputTokens is the total, including cached and cache-write tokens.
export function costUsd(model: ModelId, usage: TokenUsage): number {
  const u = TokenUsageSchema.parse(usage);
  const price = PRICES_PER_MTOK[model];
  if (!price) throw new Error(`no price for model ${model}`);
  const fresh = u.inputTokens - u.cachedInputTokens - u.cacheWriteTokens;
  if (fresh < 0) throw new Error('cached and cache-write tokens exceed input tokens');
  const long = u.inputTokens > MAX_INPUT_TOKENS;
  const inRate = long ? LONG_INPUT_MULTIPLIER : 1;
  const outRate = long ? LONG_OUTPUT_MULTIPLIER : 1;
  // Tokens × $/Mtok is micro-dollars.
  const micro = fresh * price.input * inRate
    + u.cachedInputTokens * price.cachedInput * inRate
    + u.cacheWriteTokens * price.input * CACHE_WRITE_MULTIPLIER * inRate
    + u.outputTokens * price.output * outRate;
  return micro / 1_000_000;
}
