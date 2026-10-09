import { z } from 'zod';

export const METRICS = ['performance', 'lcp', 'cls', 'tbt', 'fcp', 'ttfb', 'jsBytes', 'accessibility', 'seo'] as const;
export const MetricSchema = z.enum(METRICS);
export type Metric = z.infer<typeof MetricSchema>;

const value = z.number().finite().nonnegative();

// Scores are 0–100; lcp, tbt, fcp and ttfb are milliseconds; cls is unitless; jsBytes is transfer bytes.
export const MetricValuesSchema = z.strictObject({
  performance: value,
  lcp: value,
  cls: value,
  tbt: value,
  fcp: value,
  ttfb: value,
  jsBytes: value,
  accessibility: value,
  seo: value,
});
export type MetricValues = z.infer<typeof MetricValuesSchema>;

export const RUN_STATUSES = [
  'intake', 'baselining', 'analyzing', 'awaiting_criteria', 'specifying', 'building', 'fixing',
  'deploying_preview', 'measuring', 'reporting', 'awaiting_release', 'released', 'reported', 'planned',
  'rejected', 'needs_human', 'failed',
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const OutlineSchema = z.strictObject({
  headings: z.array(z.strictObject({ id: z.string(), level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), text: z.string() })),
  textBlocks: z.array(z.strictObject({ id: z.string(), text: z.string(), preview: z.string() })),
  images: z.array(z.strictObject({
    id: z.string(), src: z.string(), alt: z.string(), width: value, height: value, content: z.boolean(),
  })),
  landmarks: z.array(z.strictObject({ kind: z.enum(['nav', 'header', 'main', 'section', 'footer']), childIds: z.array(z.string()) })),
  scripts: z.array(z.strictObject({ host: z.string(), bytes: value, blocking: z.boolean() })),
  // Every heading, text block and image ID in document order (fidelity's order component needs it).
  order: z.array(z.string()),
});
export type Outline = z.infer<typeof OutlineSchema>;

export const CriterionSchema = z.strictObject({
  id: z.string().regex(/^c[1-9]$/),
  metric: MetricSchema,
  baseline: value,
  target: value,
  rationale: z.string().min(1).max(200).regex(/^[^\r\n]*$/, 'rationale must be one line'),
  result: value.optional(),
  met: z.boolean().optional(),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const OpportunitySchema = z.strictObject({
  id: z.string(),
  category: z.enum(['performance', 'accessibility', 'seo']),
  title: z.string(),
  displayValue: z.string().optional(),
  savings: z.record(z.string(), z.number()),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const PsiFieldSchema = z.record(z.string(), z.number());

// What a baseline measurement stores, in the Blob cache and in the run bundle.
export const BaselineSchema = z.strictObject({
  url: z.url(),
  measuredAt: z.iso.datetime(),
  lighthouseVersion: z.string(),
  runs: z.array(MetricValuesSchema).min(1),
  median: MetricValuesSchema,
  opportunities: z.array(OpportunitySchema),
  // From the median run, so a cached baseline still gives the outline its script sizes.
  scriptBytes: z.record(z.string(), value),
  psiField: PsiFieldSchema.optional(),
});
export type Baseline = z.infer<typeof BaselineSchema>;

export const TokenUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const SpanSchema = z.strictObject({
  runId: z.string(),
  step: z.string(),
  model: z.string(),
  attempt: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: value,
  latencyMs: value,
  mode: z.enum(['live', 'record', 'replay']),
  startedAt: z.iso.datetime(),
});
export type Span = z.infer<typeof SpanSchema>;

// One row per run in runs/index.json; the 24-hour spend ceiling is computed from these rows.
export const RunIndexRowSchema = z.strictObject({
  runId: z.string(),
  target: z.string(),
  mode: z.enum(['plan', 'full', 'eval']),
  status: RunStatusSchema,
  costUsd: value,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  success: z.boolean().optional(),
});
export type RunIndexRow = z.infer<typeof RunIndexRowSchema>;

const MEASURED: readonly RunStatus[] = ['planned', 'reported', 'released'];

// The Milestone 1 subset of the spec's PocReport (no preview, fidelity, diffs or share link yet).
export const PocReportSchema = z.strictObject({
  runId: z.string(),
  target: z.string(),
  // kind and permission are unknown, and url is whatever was requested, on a not_allowlisted rejection.
  kind: z.enum(['fixture', 'control']).optional(),
  url: z.string(),
  permission: z.enum(['owned', 'written']).optional(),
  mode: z.enum(['plan', 'full', 'eval']),
  status: RunStatusSchema,
  success: z.boolean().optional(),
  rejectReason: z.enum(['not_allowlisted', 'daily_cap']).optional(),
  brief: z.string(),
  criteria: z.array(CriterionSchema),
  baseline: z.strictObject({ lighthouse: MetricValuesSchema, runs: z.number().int().positive(), psiField: PsiFieldSchema.optional() }).optional(),
  hardFails: z.array(z.string()),
  architecture: z.array(z.string()),
  summary: z.string().optional(),
  summaryCheck: z.enum(['passed', 'regenerated', 'templated']).optional(),
  costUsd: value,
  tokens: z.strictObject({ input: z.number().int().nonnegative(), cachedInput: z.number().int().nonnegative(), output: z.number().int().nonnegative() }),
  timingsMs: z.record(z.string(), value),
}).superRefine((r, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if ((r.status === 'rejected') !== (r.rejectReason !== undefined)) issue('rejectReason is set exactly when status is rejected');
  if (r.rejectReason !== 'not_allowlisted') {
    if (!r.kind || !r.permission) issue('an allowlisted target has a kind and a permission');
    if (!z.url().safeParse(r.url).success) issue('an allowlisted target has a URL');
  }
  if (MEASURED.includes(r.status) && !r.baseline) issue(`a ${r.status} report has a baseline`);
});
export type PocReport = z.infer<typeof PocReportSchema>;
