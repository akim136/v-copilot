import { z } from 'zod';
import type { AllowedTarget } from './allowlist';

export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// Never carries the request URL, which may hold the API key.
export class PsiError extends Error {
  override name = 'PsiError';
}

const PsiResponseSchema = z.object({
  loadingExperience: z.object({
    origin_fallback: z.boolean().optional(),
    metrics: z.record(z.string(), z.object({ percentile: z.number().finite() })).optional(),
  }).optional(),
});

// PageSpeed Insights field data (CrUX p75) for the page itself, recorded as context only. Returns
// undefined when the page has no URL-level field data, which is the case for the fixtures.
export async function fetchPsiField(
  target: AllowedTarget,
  opts: { apiKey?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<Record<string, number> | undefined> {
  const request = new URL(PSI_ENDPOINT);
  request.searchParams.set('url', target.url);
  request.searchParams.set('strategy', 'mobile');
  request.searchParams.set('category', 'performance');
  if (opts.apiKey) request.searchParams.set('key', opts.apiKey);

  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(request, { signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
  } catch (err) {
    throw new PsiError(`PSI request failed: ${(err as Error)?.name ?? 'error'}`);
  }
  if (!res.ok) throw new PsiError(`PSI request failed with status ${res.status}`);
  const parsed = PsiResponseSchema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new PsiError('PSI response was not in the expected shape');

  const le = parsed.data.loadingExperience;
  if (!le?.metrics || le.origin_fallback) return undefined;
  const field = Object.fromEntries(Object.entries(le.metrics).map(([k, m]) =>
    // PSI reports CLS multiplied by 100.
    [k, k === 'CUMULATIVE_LAYOUT_SHIFT_SCORE' ? m.percentile / 100 : m.percentile]));
  return Object.keys(field).length ? field : undefined;
}
