// AI Gateway model IDs. OpenAI publishes no dated snapshots for these models (checked 2026-10-07);
// both were released 2026-07-09. If a snapshot ID appears, pin it here and in pricing.ts.
export const MODELS = {
  terra: 'openai/gpt-5.6-terra',
  luna: 'openai/gpt-5.6-luna',
} as const;
export type ModelId = (typeof MODELS)[keyof typeof MODELS];

// The only places a model runs.
export const STEP_MODEL = {
  analyze: MODELS.terra,
  page_spec: MODELS.terra,
  fix: MODELS.terra,
  summary: MODELS.luna,
  honesty: MODELS.luna,
} as const satisfies Record<string, ModelId>;
export type ModelStep = keyof typeof STEP_MODEL;
