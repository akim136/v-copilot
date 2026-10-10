import type { Target, TargetsConfig } from './targets';

declare const checked: unique symbol;

// A target that passed the allowlist check. Only checkAllowlist produces one, so any function that
// fetches, measures or prompts about a page can demand it in its signature.
export type AllowedTarget = Readonly<Target & { name: string }> & { readonly [checked]: true };

export type AllowlistResult = { ok: true; target: AllowedTarget } | { ok: false; reason: 'not_allowlisted' };

function normalize(url: string): string | undefined {
  try {
    return new URL(url).href;
  } catch {
    return undefined;
  }
}

// Resolves a target name or its exact URL against targets.config.json. Runs before any network fetch,
// Sandbox start or model call; anything not listed verbatim is refused.
export function checkAllowlist(config: TargetsConfig, nameOrUrl: string): AllowlistResult {
  let name: string | undefined;
  if (Object.hasOwn(config, nameOrUrl)) {
    name = nameOrUrl;
  } else {
    const wanted = normalize(nameOrUrl);
    if (wanted) name = Object.keys(config).find((key) => normalize(config[key]!.url) === wanted);
  }
  if (!name) return { ok: false, reason: 'not_allowlisted' };
  return { ok: true, target: Object.freeze({ ...config[name]!, name }) as AllowedTarget };
}

// True when a subresource URL (an image, a script) sits on the target's origin under the target's path,
// so intake may fetch it.
export function isWithinTarget(target: AllowedTarget, url: string): boolean {
  const base = new URL(target.url);
  const dir = base.pathname.endsWith('/') ? base.pathname : base.pathname.replace(/[^/]*$/, '');
  let candidate: URL;
  try {
    candidate = new URL(url);
  } catch {
    return false;
  }
  return candidate.protocol === 'https:' && candidate.origin === base.origin && !candidate.username
    && !candidate.password && candidate.pathname.startsWith(dir);
}
