import { checkAllowlist, parseTargetsConfig, type AllowedTarget, type TargetsConfig } from '@v-copilot/poc-core';
import { FatalError } from 'workflow';
import raw from '../../../targets.config.json';

let targets: TargetsConfig | undefined;

// The allowlist ships with the deployment; nothing at runtime can add to it.
export function loadTargets(): TargetsConfig {
  targets ??= parseTargetsConfig(raw);
  return targets;
}

// For steps after intake: the run's target name must still be on the allowlist.
export function allowedTarget(name: string): AllowedTarget {
  const allowed = checkAllowlist(loadTargets(), name);
  if (!allowed.ok) throw new FatalError(`${name} is not in targets.config.json`);
  return allowed.target;
}
