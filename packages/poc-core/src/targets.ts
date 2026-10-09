import { z } from 'zod';

export const TargetSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }),
  permission: z.enum(['owned', 'written']),
  kind: z.enum(['fixture', 'control']),
});

export const TargetsConfigSchema = z
  .record(z.string().regex(/^[a-z0-9-]{1,40}$/), TargetSchema)
  .refine((targets) => Object.keys(targets).length > 0, 'at least one target is required');

export type Target = z.infer<typeof TargetSchema>;
export type TargetsConfig = z.infer<typeof TargetsConfigSchema>;

export function parseTargetsConfig(input: unknown): TargetsConfig {
  return TargetsConfigSchema.parse(input);
}
