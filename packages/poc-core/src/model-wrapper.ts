import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateText, NoObjectGeneratedError, Output, type LanguageModel, type LanguageModelUsage } from 'ai';
import { z } from 'zod';
import { checkBeforeModelCall, type CapCheck } from './caps';
import { STEP_MODEL, type ModelStep } from './models';
import { costUsd, inputTokenUpperBound, MAX_INPUT_TOKENS } from './pricing';
import { TokenUsageSchema, type Span, type TokenUsage } from './schemas';

export const MODEL_MODES = ['live', 'record', 'replay'] as const;
export type ModelMode = (typeof MODEL_MODES)[number];

// Live calls happen only when MODEL_MODE is live or record; unset means replay.
export function modelModeFromEnv(value: string | undefined = process.env.MODEL_MODE): ModelMode {
  if (value === undefined || value === '') return 'replay';
  if ((MODEL_MODES as readonly string[]).includes(value)) return value as ModelMode;
  throw new Error('MODEL_MODE must be live, record or replay');
}

// Bounds a single call: 272K input (at the cache-write rate) and 16K output tokens on terra is at most about $0.87.
export const MAX_OUTPUT_TOKENS = 16_000;

export function recordingKey(model: string, system: string, prompt: string, schema: z.ZodType): string {
  return createHash('sha256').update(JSON.stringify([model, system, prompt, z.toJSONSchema(schema)])).digest('hex');
}

// A recording holds the structured output and token usage only: no prompt, no credentials.
const RecordingSchema = z.strictObject({
  version: z.literal(1),
  key: z.string(),
  model: z.string(),
  step: z.string(),
  output: z.unknown(),
  usage: TokenUsageSchema,
  latencyMs: z.number().nonnegative(),
  recordedAt: z.iso.datetime(),
});

export class CapExceededError extends Error {
  override name = 'CapExceededError';
  constructor(readonly check: Extract<CapCheck, { ok: false }>) {
    super(`${check.reason}: $${check.spentUsd} against a limit of $${check.limitUsd}`);
  }
}
export class PromptTooLargeError extends Error {
  override name = 'PromptTooLargeError';
}
export class ReplayMissError extends Error {
  override name = 'ReplayMissError';
  constructor(readonly key: string) {
    super(`no recording for ${key}`);
  }
}
// The call may have been paid for but returned nothing usable; span carries the cost to add to the run.
// The message never holds the request or response body (prompt, page text or upstream output).
export class ModelCallError extends Error {
  override name = 'ModelCallError';
  constructor(message: string, readonly span: Span, readonly retryable = false) {
    super(message);
  }
}

export interface ModelCall<T> {
  runId: string;
  step: ModelStep;
  attempt: number;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  mode: ModelMode;
  // Spend so far in this run, and in finished runs over the last 24 hours.
  budget: { runCostUsd: number; dailySpendUsd: number };
  recordingsDir: string;
  // Tests pass an AI SDK mock model, whose modelId must be the step's pinned ID. Otherwise the step's
  // Gateway model ID is used (OIDC, BYOK).
  model?: LanguageModel;
  now?: () => Date;
}

export interface ModelResult<T> {
  output: T;
  usage: TokenUsage;
  costUsd: number;
  span: Span;
}

// Undefined when the response's usage is missing or inconsistent, so it can't be priced.
function toUsage(u: LanguageModelUsage | undefined): TokenUsage | undefined {
  const parsed = TokenUsageSchema.safeParse({
    inputTokens: u?.inputTokens,
    cachedInputTokens: u?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: u?.inputTokenDetails?.cacheWriteTokens ?? 0,
    outputTokens: u?.outputTokens,
  });
  if (!parsed.success) return undefined;
  const t = parsed.data;
  return t.cachedInputTokens + t.cacheWriteTokens > t.inputTokens ? undefined : t;
}

// The most a call could have cost: every possible input token billed at the cache-write rate, plus full
// output. Charged whenever a call fails without usage, so spend is never understated.
export function worstCaseUsage(system: string, prompt: string): TokenUsage {
  const input = inputTokenUpperBound(system, prompt);
  return { inputTokens: input, cachedInputTokens: 0, cacheWriteTokens: input, outputTokens: MAX_OUTPUT_TOKENS };
}

// Name, status and code only: SDK errors carry the full request and response bodies.
function describeError(err: unknown): string {
  const e = (typeof err === 'object' && err !== null ? err : {}) as { name?: unknown; statusCode?: unknown; code?: unknown };
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const detail = [typeof e.statusCode === 'number' ? `status ${e.statusCode}` : '', typeof e.code === 'string' ? e.code : ''].filter(Boolean);
  return detail.length ? `${name} (${detail.join(', ')})` : name;
}

// The one way any step calls a model: caps first, structured output only, no tools.
export async function callModel<T>(call: ModelCall<T>): Promise<ModelResult<T>> {
  const cap = checkBeforeModelCall(call.budget);
  if (!cap.ok) throw new CapExceededError(cap);
  if (inputTokenUpperBound(call.system, call.prompt) > MAX_INPUT_TOKENS) {
    throw new PromptTooLargeError(`prompt may exceed ${MAX_INPUT_TOKENS} input tokens`);
  }

  const model = STEP_MODEL[call.step];
  if (call.model !== undefined && (typeof call.model === 'string' ? call.model : call.model.modelId) !== model) {
    throw new Error(`model override must be the pinned ${model}`);
  }
  const key = recordingKey(model, call.system, call.prompt, call.schema);
  const startedAt = (call.now ?? (() => new Date()))().toISOString();
  const span = (usage: TokenUsage, latencyMs: number): Span => ({
    runId: call.runId, step: call.step, model, attempt: call.attempt,
    inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens, costUsd: costUsd(model, usage), latencyMs, mode: call.mode, startedAt,
  });
  const file = join(call.recordingsDir, `${key}.json`);

  if (call.mode === 'replay') {
    const raw = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
      throw err.code === 'ENOENT' ? new ReplayMissError(key) : err;
    });
    const rec = RecordingSchema.parse(JSON.parse(raw));
    if (rec.key !== key || rec.model !== model) throw new Error(`recording ${key} does not match this call`);
    const s = span(rec.usage, rec.latencyMs);
    return { output: call.schema.parse(rec.output), usage: rec.usage, costUsd: s.costUsd, span: s };
  }

  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);
  let result;
  try {
    result = await generateText({
      model: call.model ?? model,
      instructions: call.system,
      prompt: call.prompt,
      output: Output.object({ schema: call.schema }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // One request per call: a retry goes back through callModel, so it is cap-checked and priced.
      maxRetries: 0,
      timeout: { totalMs: 240_000 },
    });
  } catch (err) {
    const noObject = NoObjectGeneratedError.isInstance(err);
    const usage = (noObject ? toUsage(err.usage) : undefined) ?? worstCaseUsage(call.system, call.prompt);
    const retryable = (err as { isRetryable?: unknown })?.isRetryable === true;
    const message = noObject ? 'model returned no valid structured output' : `model call failed: ${describeError(err)}`;
    throw new ModelCallError(message, span(usage, elapsed()), retryable);
  }
  const latencyMs = elapsed();
  const usage = toUsage(result.usage);
  if (!usage) throw new ModelCallError('model response carried no token usage', span(worstCaseUsage(call.system, call.prompt), latencyMs));
  const s = span(usage, latencyMs);

  if (call.mode === 'record') {
    const rec = { version: 1, key, model, step: call.step, output: result.output, usage, latencyMs, recordedAt: startedAt };
    // A unique temp file, so identical calls recorded at once never share one; the rename is atomic.
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
      await mkdir(call.recordingsDir, { recursive: true });
      await writeFile(tmp, `${JSON.stringify(rec, null, 2)}\n`);
      await rename(tmp, file);
    } catch (err) {
      throw new ModelCallError(`recording write failed: ${describeError(err)}`, s);
    }
  }
  return { output: result.output, usage, costUsd: s.costUsd, span: s };
}
