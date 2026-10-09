# v-copilot and Vercel Ops MCP: Technical Spec

## Problem

A Solutions Architect's first move with a prospect is a proof of concept: measure what the prospect has today, agree on success criteria, build the smallest thing that proves Vercel can beat them, and report the result. The first pass of that loop is mostly mechanical, yet it takes an SA a day or more per account, and the startup segment has far more accounts than SA hours. The judgment worth an SA's time is choosing the criteria and reading the results, not running Lighthouse and scaffolding a template.

Alex wants to understand Vercel's products as a builder, especially the agent stack, and he learns fastest by building something real. v-copilot is that build. It is a durable agent workflow that takes one permissioned page and a brief, measures it, proposes success criteria for Alex to approve in Telegram, rebuilds the page on a Next.js 16 template, deploys a gated preview, measures again under identical conditions, and writes an SA-style POC report with the cost of producing it. A small MCP server is its front door from Claude, and it adds only the four guarded Vercel operations that the official Vercel MCP does not offer.

An agent workload is only credible if it can show it is working and notice when it stops. A performance agent has an obvious way to cheat, since deleting content makes any page faster, so the build refuses to call a POC a success unless the original content survived, grades its own judgment steps against a labeled set, checks its written claims against its measurements, and watches every model call, run and day of operation.

The work runs on Alex's personal Vercel Hobby team at 5 to 10 hours a week, in milestones that each teach a named set of Vercel products. The intended outside audience is Vercel's Solutions Architect team, for whom it doubles as a reference implementation of an evaluated, monitored agent on the Agent Stack.

## Decisions

### Platform and accounts

- We build a pnpm and Turborepo monorepo in a public `akim136` GitHub repo, with one Next.js app, `apps/web`, that hosts the workflows, the Telegram webhook, the cron routes, the runs page and the MCP endpoint, deployed to Alex's personal Hobby team (`team_J4ZFzFIZLMWznfsoWdG8nuV1`), because one project means one set of environment variables and one deployment, and Hobby is free for personal, non-commercial projects.
- We design inside the Hobby limits listed under Data model and interfaces, because Hobby cannot buy extra usage and hitting a cap pauses that product until the next month.
- The build touches only Alex's personal Vercel team, OpenAI project, GitHub account and Telegram, never Homebase's, because the repo, the reports and the demo are public.

### POC workflow

- v-copilot only runs against URLs listed in `targets.config.json`, each recording whether Alex owns the page or has written permission to test it, and the check runs before any network fetch, because the agent fetches, measures and rebuilds pages and must never do that to a site without permission.
- The targets are four prospect fixtures served from GitHub Pages (deliberately slow static pages) and two control sites, akimbuilds.com and stagger.dev, which Vercel already serves, because the fixtures give honest before and after numbers and the controls test that the agent does not invent a win where little room exists.
- Each POC is one Workflow SDK run with fixed steps, and models run only inside `analyze`, `page_spec` and `fix` plus the report's prose and honesty check, because deterministic orchestration is resumable, auditable and explainable, and it confines model variance to the places that need judgment.
- Every model step returns structured output only, has no tools, and receives page content inside clearly delimited untrusted-data blocks, because a fetched page is untrusted input and text hidden in it must never be able to trigger an action.
- `intake` extracts a structural outline in code and gives every heading, text block and image a stable ID derived from its position and content, because the spec, the fidelity score and the labeled eval set all key on those IDs.
- The `analyze` step receives that outline (landmarks, headings, truncated text blocks, images with dimensions, scripts by host and size, Lighthouse opportunities), never raw HTML, because the outline carries what the model needs at a fraction of the tokens.
- The agent writes a `PageSpec` JSON document, validated with zod, in which every heading, text block and image is a `ref` to an outline ID that code resolves to the original content. Literal strings are allowed only for labels of 80 characters or fewer, and at most two custom components are allowed per POC, because the model should arrange content rather than retype it.
- Custom components are linted so they cannot call `fetch`, load external scripts, read environment variables or use `dangerouslySetInnerHTML`, because model-written code ends up on a preview.
- The template is a Next.js 16 app that renders statically by default and uses `next/image` and `next/font` everywhere, enforced by a lint rule, because those practices are the point of the POC and should never depend on the model remembering them.
- The template runs `eslint-plugin-jsx-a11y` and carries alt text from the outline into every image, because a rebuild must not trade accessibility for speed.
- Each target gets one Vercel project named `poc-<target>`, each POC adds a preview deployment to it, and `vercel-ops` removes previews beyond the newest ten in `poc-*` projects only, because one project per target keeps history together and avoids dozens of throwaway projects on Hobby.
- A POC preview is never promoted to production. The template ships its own access gate in `proxy.ts` that requires a signed, expiring token in a header or cookie and otherwise returns 401 with `noindex`, and Vercel Deployment Protection is layered on top when the plan offers it, because a rebuilt copy of someone's page at a public URL must not exist and the gate must not depend on a plan feature.
- Lighthouse runs inside the run's Sandbox with Chromium, three runs per URL on the mobile profile, reporting the median, and the original and the preview are measured in the same Sandbox session with the access token sent as a header, because identical conditions are the only fair comparison. PageSpeed Insights field data for the original is recorded as context only.
- Lighthouse's accessibility and SEO category scores are recorded with every measurement, and `analyze` may propose criteria on them, because enterprise POCs are judged on more than speed and both scores come free with the same Lighthouse run.
- Whether each success criterion is met is computed in code from the medians, with no model involved, because a verdict on the numbers must be reproducible and cannot be talked into a pass.
- There are two human gates, both Workflow hooks. `await_criteria` approves or edits the targets before anything is built, and `await_release` approves the final report before a share link exists. A share link is a URL to the preview carrying a signed token that expires after seven days, because agreeing on criteria first is how a real POC runs and sharing must be a deliberate act.

### Approvals and alerts

- Approvals and alerts go through a dedicated v-copilot Telegram bot using the Chat SDK's Telegram adapter, with Approve and Reject as inline buttons whose callback data (64 bytes at most) carries only the gate and a short run ID, because Alex wants Telegram and a separate bot keeps these messages and credentials apart from the Hermes trading bot.
- The Telegram webhook accepts an update only when Telegram's secret-token header matches and the sender's Telegram user ID equals Alex's, and a gate resumes at most once, because a button press is an authorization and must not be forgeable or replayable.
- The `approve_poc_gate` MCP tool resumes the same hook as the Telegram button, because one approval primitive keeps every surface identical.

### Models and cost

- Models are OpenAI through AI Gateway using Alex's OpenAI key as a bring-your-own-key credential on the personal team, with `gpt-5.6-terra` for `analyze`, `page_spec` and `fix` and `gpt-5.6-luna` for report prose and the honesty check, pinned to dated snapshot IDs, because AI Gateway is one of the products worth learning and an alias can be repointed to a model at a different price.
- The personal team holds a one-time $10 purchase of AI Gateway credits with automatic top-up off and a Gateway budget of $10, because BYOK is only available once a team has purchased credits, and a request that fails on Alex's key is retried on Vercel's credentials and billed to those credits.
- The app reaches AI Gateway through Vercel OIDC, so no model credential exists in the app's environment variables or code.
- Cost is computed in our own code from each call's token usage and a price table in `packages/poc-core/src/pricing.ts`. A run stops before its next model call once it passes $1.50, a new run is refused when spend in the last 24 hours is $8 or more, the fix loop is capped at three attempts, and the OpenAI project behind the key carries a monthly budget, because BYOK spend lands on the OpenAI bill and a runaway run must be impossible. The 24-hour ceiling follows the same pattern as the Hermes eval harness.
- Every prompt places its stable parts first (system prompt, schema, component catalog, examples) and the run-specific material last, because OpenAI caches repeated prompt prefixes and cached input costs a fraction of fresh input.
- Model calls go through one wrapper with `live`, `record` and `replay` modes keyed by a hash of the model ID and prompt, unit tests use AI SDK mock models, and live calls happen only when `MODEL_MODE` is `live` or `record`, because iteration is most of the token bill and replay makes it nearly free.
- Each run uses one Sandbox, started from a snapshot with the template's dependencies and Chromium preinstalled, and reuses it for the build, every fix attempt, both measurements and the screenshots, because repeated installs are the slowest and most network-hungry part of a run and Sandbox CPU is capped on Hobby.
- Baseline Lighthouse and PageSpeed results are cached in Blob per URL per day, because re-running a POC on the same day should not pay to measure the same page again.

### Storage

- There is no application database. In-flight state lives in the Workflow run. Each finished run writes at most four Blob objects (`bundle.json` holding the report, spec, measurements and trace, plus `report.md` and two screenshots) and updates `runs/index.json`, and the runs page and health job read the index rather than listing Blob, because Hobby includes only 2,000 Blob advanced operations a month and a listing on every page load would exhaust them.
- The only database is the auth store described below, kept separate from POC data.

### Quality gates and evals

- A POC counts as a success only when every approved criterion is met and content fidelity is at least 0.9, because a POC that drops half the page proves nothing.
- Fidelity is computed in code from the spec's resolved refs against the outline. Heading coverage is the share of outline headings referenced. Text coverage is the share of content text blocks of 40 characters or more referenced. Image coverage is the share of content images at least 100 pixels on either side referenced. Order is the longest common subsequence of referenced IDs against outline order, divided by the number referenced. The score weights these 0.3, 0.3, 0.2 and 0.2, because each part is cheap, deterministic and explainable.
- When fidelity is below 0.9, `page_spec` runs exactly once more with the missing IDs listed, and if it is still below 0.9 the run ends `needs_human` without building, because one retry with specific feedback fixes most omissions while a loop would burn budget.
- Visual similarity is SSIM over the first three mobile viewport tiles of each page, averaged, and it is reported but never used as a gate, because a template is expected to look somewhat different from the original.
- The report's prose summary passes an honesty check before the report is final. Code confirms every number in it matches a value in the measurements or criteria after rounding, and a Luna call lists any qualitative claim the measurements do not support. A flagged summary is regenerated once, and if still flagged the report uses a summary templated in code, because a POC report that overstates results is worse than none.
- The eval set is the six targets, hand-labeled in `evals/labels/` with their expected sections anchored by heading text, plus metric bounds in `evals/bounds.json`. Step evals grade `analyze` (section recall, every target better than baseline and inside bounds) and `page_spec` (schema validity, fidelity) in code, and no model judges page quality, because code graders are free, deterministic and cannot drift.
- A hard fail is a spec that fails schema validation, a draft target outside bounds, or a summary that had to be templated. A live eval regresses when its success rate is more than 10 points lower than the saved baseline, its median fidelity is more than 0.02 lower, or it has a hard fail the baseline did not, because these are the same regression rules as the `compare-to-main` gate in `hermes-skills`, adjusted for fidelity.
- `pnpm eval:replay` runs in GitHub Actions on every pull request with recorded model responses, recorded measurements and a local `next build` in place of the Sandbox, and makes no model, Vercel or Sandbox call, because pipeline regressions should be caught on every change for free.
- `pnpm eval:live` runs only when Alex starts it. It auto-approves drafted criteria, stops each run after `report` without a share link, and has a $5 total cap. CI fails any pull request that changes a prompt or the model table without also changing `evals/baselines/live.json`, because live evals cost real money and should run exactly when the thing they measure changes.
- v-copilot keeps its eval history in its own Blob store rather than in the Hermes eval harness, because that Worker's eval route judges Notion pages against investing rubrics and now shares its deployment and D1 database with paper trading, so coupling a public demo to it would add risk and teach nothing about Vercel. Three of its patterns are reused instead: signed expiring links, the regression rules, and the 24-hour spend ceiling.

### Monitoring

- Every model call emits a span carrying run ID, step, model, input, cached input and output tokens, cost and latency. Spans are stored in the run's bundle and exported through `@vercel/otel` to Vercel Observability, which includes tracing span units on Hobby, because cost and latency questions are answered per step.
- A run that ends `failed` or hits the per-run or daily cap sends one Telegram alert immediately, because the expensive failure is the one nobody sees until the bill.
- A daily cron at `/api/cron/health` writes `health/<date>.json` and sends a Telegram message only when a threshold is crossed: seven-day failure rate above 20 percent, needs-human rate above 40 percent, any cap hit, any gate waiting more than 24 hours, median cost above $0.80, or Sandbox CPU or Blob advanced operations above 80 percent of the monthly Hobby allowance. A daily cadence fits Hobby's cron limits and matches how often POCs run.
- A `/runs` page lists every run from `runs/index.json`, is readable at phone width, and is reachable only after Sign in with Vercel as Alex, because debugging and the demo both need one view of every run.

### Identity and the MCP front door

- Sign in with Vercel is the only way to sign in to anything in `apps/web`, and only Alex's Vercel user ID (`U31nYf8Nkc3FrFkgZKhrkjOD`) is allowed, because it is Vercel's own identity provider, needs no new account, and replaces the Cloudflare Access setup used for Alex's other MCP servers.
- Better Auth runs inside `apps/web` with Vercel as its only login provider. It provides the runs page session in Milestone 3, and in Milestone 4 its MCP plugin acts as the OAuth authorization server for the MCP endpoint (dynamic client registration and PKCE), with `withMcpAuth` from `mcp-handler` verifying its tokens. Its tables live in a free Neon Postgres database from the Vercel Marketplace, because MCP clients such as claude.ai need an authorization server that registers them dynamically, and this keeps identity on Vercel while teaching the Marketplace.
- The MCP exposes four Ops tools (`safe_deploy`, `env_diff`, `secret_hygiene_audit`, `set_crons`) and five POC tools, and nothing that duplicates the official Vercel MCP, because Claude already has the official connector for raw reads and writes and this server's value is the guardrails and the agent.
- `vercel-ops` implements every Vercel call once on `@vercel/sdk`, and both MCP tools and workflow steps import it directly, because two implementations of deploy or promote would drift. The workflow never calls the MCP over HTTP.
- Production-mutating tools require `confirm_production: true` and write an audit record to Blob, and they may only mutate the smoke-target fixture and `poc-*` projects. Against Alex's real projects the Ops tools are read-only, because the risk this server exists to reduce is an agent changing production without a deliberate act.
- `safe_deploy` promotes directly and then watches runtime errors and smoke checks for a fixed window, rolling back automatically on failure, because Rolling Releases are not available on Hobby. Milestone 5 adds a rolling-release path behind a flag for the Pro trial.

### Working practices

- The repo carries a `CLAUDE.md` that points to the plan, the spec, the pinned constraints and the common commands, and a `PROGRESS.md` that records the last completed acceptance criterion, the next step, open blockers and model spend to date, updated at the end of every session, because at 5 to 10 hours a week most sessions start cold.
- `docs/friction-log.md` gets an entry whenever a Vercel product makes something harder than expected, written by Alex or by Claude Code during the session, because the log is the learning record, the source of product feedback for the SA conversation, and the backbone of the final write-up.

## Data model and interfaces

### Hobby limits this design must respect

| Product | Hobby allowance per month | How the design stays inside it |
|---|---|---|
| Sandbox | 5 hours active CPU, 420 GB-hours memory, 5,000 creations, 20 GB transfer, 10 concurrent | one Sandbox per run from a snapshot, baseline cache, health alert at 80 percent |
| Fluid compute | 4 hours active CPU, 360 GB-hours memory, 1M invocations | heavy work runs in the Sandbox, not in functions |
| Workflow | 50,000 events, 1 GB storage writes | about a dozen steps per run |
| Blob | 1 GB storage, 10,000 simple and 2,000 advanced operations | four objects per run, index file instead of listing, health alert at 80 percent |
| Image Optimization | 5,000 transformations | gated previews see little traffic |
| Observability | 1M tracing span units, 1 hour runtime log retention | spans also stored in each run's bundle |
| Cron Jobs | included, daily schedules | one daily health job |
| Rolling Releases | not available | direct promotion with a watch window |

These figures come from Vercel's pricing page on October 7, 2026, and are confirmed again during investigation.

### Repository layout

```
v-copilot/                         public repo under akim136
  CLAUDE.md                          session primer: plan, spec, constraints, commands
  PROGRESS.md                        where things stand, updated at the end of every session
  docs/friction-log.md               product friction, one entry per issue
  .github/workflows/eval-replay.yml  replay eval and prompt-change baseline check
  apps/web/                          Next.js app on the personal Hobby team
    app/api/telegram/route.ts        Chat SDK Telegram webhook (approvals)
    app/api/cron/health/route.ts     daily health job (checks CRON_SECRET)
    app/api/auth/[...all]/route.ts   Better Auth with Sign in with Vercel
    app/api/[transport]/route.ts     MCP endpoint (Milestone 4)
    app/.well-known/...              OAuth metadata (Milestone 4)
    app/runs/                        runs page
    instrumentation.ts               @vercel/otel registration
    workflows/poc.ts                 "use workflow" POC definition
    workflows/steps/*.ts             "use step" functions, one file per step
    scripts/poc.ts                   pnpm poc start <target>
    scripts/eval.ts                  replay and live eval runner
  packages/vercel-ops/               Vercel calls on @vercel/sdk, guardrails, audit writer
  packages/poc-core/
    src/allowlist.ts                 targets.config.json check
    src/outline.ts                   outline extractor with stable IDs
    src/lighthouse.ts                Lighthouse runner and medians
    src/screenshots.ts, similarity.ts
    src/fidelity.ts, verdicts.ts, honesty.ts
    src/telemetry.ts                 span writer and alert sender
    src/caps.ts                      per-run and 24-hour spend ceilings
    src/models.ts, pricing.ts        pinned model IDs and price table
    src/prompts/                     prompt files
    src/model-wrapper.ts             live, record and replay modes
    src/tokens.ts                    signed preview and share tokens
  packages/poc-template/             Next.js 16 template, section components, renderer, proxy.ts gate, lint rules
  fixtures/
    smoke-target/                    Vercel fixture for safe_deploy tests
    prospects/landing/, docs/, catalog/, blog/
  evals/
    labels/<target>.json, bounds.json
    baselines/replay.json, baselines/live.json
  recordings/                        replay recordings and recorded measurements, no secrets
  targets.config.json
```

The prospect fixtures are served by GitHub Pages from this repo through a Pages workflow that Alex enables, so they live on a non-Vercel host. The POC workflow never deploys them.

### Targets

```json
// targets.config.json
{
  "prospect-landing": { "url": "https://akim136.github.io/v-copilot/prospect-landing/", "permission": "owned", "kind": "fixture" },
  "prospect-docs":    { "url": "https://akim136.github.io/v-copilot/prospect-docs/",    "permission": "owned", "kind": "fixture" },
  "prospect-catalog": { "url": "https://akim136.github.io/v-copilot/prospect-catalog/", "permission": "owned", "kind": "fixture" },
  "prospect-blog":    { "url": "https://akim136.github.io/v-copilot/prospect-blog/",    "permission": "owned", "kind": "fixture" },
  "akimbuilds":       { "url": "https://akimbuilds.com/",                     "permission": "owned", "kind": "control" },
  "stagger":          { "url": "https://stagger.dev/",                        "permission": "owned", "kind": "control" }
}
```

### MCP tools (Milestone 4)

```ts
// Four Ops tools
safe_deploy({ project, source: { deploymentId } | { files }, smoke: SmokeCheck[],
              promote: boolean, watchMinutes?: number /* default 5 */, confirm_production?: boolean })
  -> { previewUrl, promoted: boolean, rolledBack: boolean, checks: CheckResult[], auditId }

env_diff({ project, targets: string[] })
  -> { key, presentIn: string[], valuesMatch: boolean | 'unknown-sensitive' }[]   // never returns values

secret_hygiene_audit({ projects?: string[] })
  -> { project, key, targets, type, finding }[]                                   // report only

set_crons({ project, crons: { path, schedule }[], confirm_production?: boolean })
  -> { deploymentId } | { patch: string, reason: 'git-connected' }

// Five POC tools
start_poc({ target: string, brief: string, mode: 'plan' | 'full' }) -> { runId }
get_poc_status({ runId }) -> { status: RunStatus, step, startedAt, costUsd }
list_pocs({ status?: RunStatus }) -> PocSummary[]
approve_poc_gate({ runId, gate: 'criteria' | 'release', decision: 'approve' | 'reject',
                   criteriaEdits?: { id: string, target: number }[], note?: string })
  -> { resumed: boolean }
get_poc_report({ runId }) -> PocReport

type SmokeCheck = { path: string; expectStatus: number; expectBodyIncludes?: string };
```

### Workflow steps

| Step | Kind | Model | Output |
|---|---|---|---|
| intake | deterministic | none | allowlist and daily cap check, fetched HTML, outline with stable IDs |
| baseline | deterministic, Sandbox | none | three Lighthouse runs and median, PSI field data, cached in Blob |
| analyze | agent, structured output | gpt-5.6-terra | section inventory, opportunities, draft criteria |
| await_criteria | hook, Telegram | none | approved or edited criteria |
| page_spec | agent, one fidelity retry | gpt-5.6-terra | validated `PageSpec`, fidelity score, missing IDs |
| build | deterministic, Sandbox | none | rendered project, lint, typecheck, `next build` |
| fix | agent, max 3 attempts | gpt-5.6-terra | recorded diff, then back to build |
| deploy_preview | deterministic via vercel-ops | none | gated preview in `poc-<target>`, old previews pruned |
| measure | deterministic, Sandbox | none | Lighthouse on both pages, screenshots, visual similarity |
| report | deterministic plus summary | gpt-5.6-luna | verdicts and success in code, honesty-checked summary |
| await_release | hook, Telegram | none | approval or rejection |
| release | deterministic | none | seven-day share link, report marked final |

A plan-mode run stops after `await_criteria` and writes a plan report. An eval-mode run auto-approves the drafted criteria and stops after `report`.

### Outline and PageSpec

```ts
interface Outline {
  headings: { id: string; level: 1 | 2 | 3 | 4; text: string }[];
  textBlocks: { id: string; text: string; preview: string /* truncated for the model */ }[];
  images: { id: string; src: string; alt: string; width: number; height: number; content: boolean }[];
  landmarks: { kind: 'nav' | 'header' | 'main' | 'section' | 'footer'; childIds: string[] }[];
  scripts: { host: string; bytes: number; blocking: boolean }[];
  order: string[];                                 // every heading, text block and image ID in document order
}

type PageSpec = {
  meta: { title: Text; description: Text; lang: string };
  theme: { colors: { bg: string; fg: string; accent: string; muted: string };
           font: 'sans' | 'serif' | 'mono'; radius: 'none' | 'sm' | 'md' | 'lg' };
  sections: Section[];
};

type Text = { ref: string } | string;             // literal strings max 80 characters
type Img = { ref: string };                       // always an outline image
type Link = { label: Text; href: string };

type Section =
  | { kind: 'nav'; logo?: Img; links: Link[] }
  | { kind: 'hero'; heading: Text; body?: Text; image?: Img; ctas: Link[] }
  | { kind: 'feature-grid'; heading?: Text; items: { title: Text; body: Text; icon?: string }[] }
  | { kind: 'logo-cloud'; logos: Img[] }
  | { kind: 'product-grid'; items: { name: Text; price?: Text; image: Img; href?: string }[] }
  | { kind: 'testimonial'; quote: Text; author: Text; role?: Text }
  | { kind: 'content'; blocks: Text[] }
  | { kind: 'faq'; items: { q: Text; a: Text }[] }
  | { kind: 'cta'; heading: Text; body?: Text; link: Link }
  | { kind: 'footer'; columns: { heading: Text; links: Link[] }[]; legal?: Text }
  | { kind: 'custom'; name: string; tsx: string; refs: string[] };   // max two per spec, linted
```

### Report, telemetry, health and evals

```ts
type RunStatus = 'intake' | 'baselining' | 'analyzing' | 'awaiting_criteria' | 'specifying'
  | 'building' | 'fixing' | 'deploying_preview' | 'measuring' | 'reporting' | 'awaiting_release'
  | 'released' | 'reported' | 'planned' | 'rejected' | 'needs_human' | 'failed';

type Metric = 'performance' | 'lcp' | 'cls' | 'tbt' | 'fcp' | 'ttfb' | 'jsBytes' | 'accessibility' | 'seo';

interface PocReport {
  runId: string; target: string; url: string;      // url is the request as given on a not_allowlisted rejection
  kind?: 'fixture' | 'control'; permission?: 'owned' | 'written';   // absent only on a not_allowlisted rejection
  mode: 'plan' | 'full' | 'eval'; status: RunStatus;
  success?: boolean;                               // all criteria met and fidelity >= 0.9
  rejectReason?: 'not_allowlisted' | 'daily_cap';
  brief: string;
  criteria: { id: string; metric: Metric; baseline: number; target: number;
              rationale: string; result?: number; met?: boolean }[];
  baseline?: { lighthouse: Record<Metric, number>; runs: number; psiField?: Record<string, number> };  // from planned on
  preview?: { lighthouse: Record<Metric, number>; runs: number };
  fidelity?: { score: number; headings: number; text: number; images: number; order: number;
               missing: string[]; retried: boolean };
  visualSimilarity?: number;                       // reported, never a gate
  hardFails: string[];
  diffs: { file: string; patch: string; attempt: number }[];
  architecture: string[];                          // Vercel features the POC used
  summary?: string;
  summaryCheck?: 'passed' | 'regenerated' | 'templated';
  previewUrl?: string;                             // gated
  shareLinkExpiresAt?: string;                     // only after await_release approval
  costUsd: number;
  tokens: { input: number; cachedInput: number; output: number };
  timingsMs: Record<string, number>;
}

interface Span {
  runId: string; step: string; model: string; attempt: number;
  inputTokens: number; cachedInputTokens: number; outputTokens: number;
  costUsd: number; latencyMs: number; mode: 'live' | 'record' | 'replay'; startedAt: string;
}

interface Health {
  windowDays: 7; runs: number; failureRate: number; needsHumanRate: number;
  medianCostUsd: number; totalCostUsd: number; capHits: string[]; 
  staleGates: { runId: string; gate: 'criteria' | 'release'; waitingHours: number }[];
  hobbyUsage: { sandboxCpuPct: number; blobAdvancedOpsPct: number };
  breaches: string[];                              // Telegram message only if non-empty
}

interface EvalResult {
  sha: string; date: string; mode: 'replay' | 'live';
  targets: { target: string; kind: 'fixture' | 'control'; status: RunStatus; success: boolean;
             sectionRecall: number; targetsInBounds: boolean; specValid: boolean; fidelity: number;
             visualSimilarity?: number; criteriaMet: number; criteriaTotal: number;
             hardFails: string[]; costUsd: number; durationMs: number }[];
  summary: { successRate: number; medianFidelity: number; medianSimilarity?: number;
             criteriaHitRate: number; hardFails: number; medianCostUsd: number;
             totalCostUsd: number; medianDurationMs: number };
}
```

### Storage and configuration

```
Blob layout
pocs/<target>/<runId>/bundle.json           report, spec, measurements, trace
pocs/<target>/<runId>/report.md
pocs/<target>/<runId>/screenshot-original.png
pocs/<target>/<runId>/screenshot-preview.png
runs/index.json                             one row per run, read by /runs and the health job
cache/baseline/<urlHash>/<yyyy-mm-dd>.json
health/<yyyy-mm-dd>.json
eval/<yyyy-mm-dd>-<sha>.json
audit/<yyyy-mm-dd>/<timestamp>-<tool>.json
```

`apps/web` environment variables, all secrets marked sensitive: `VERCEL_TOKEN` (team-scoped), `VERCEL_TEAM_ID`, `BLOB_READ_WRITE_TOKEN`, `PSI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALEX_USER_ID`, `TELEGRAM_CHAT_ID`, `POC_TOKEN_SECRET`, `CRON_SECRET`, `BETTER_AUTH_SECRET`, the Sign in with Vercel client ID and secret, the Neon connection string injected by the Marketplace integration, `ALLOWED_VERCEL_USER_ID`, and `MODEL_MODE`. The OpenAI key lives only in the AI Gateway BYOK settings.

### Friction log entry

```markdown
## 2026-10-20 · Milestone 1 · Workflow SDK
What happened: resuming a hook from the Telegram webhook needed the run ID and hook token, and the docs only showed resuming from inside the app.
What I expected: an example of resuming from an external webhook.
Severity: slowdown (blocker, slowdown or papercut)
Suggested fix: add a webhook-resume example to the hooks page.
Links: docs page, commit
```

## Non-goals

This spec settles Milestones 1 to 5. Milestones 6 to 12 in the plan revisit some of the non-goals below (one page per POC, no domain on a POC project, no Firewall writes), and each of those changes is decided in that milestone's own spec addendum.

- POC projects are never promoted to production or given a custom domain.
- A POC rebuilds one page, not a site, and only static marketing-style content.
- This does not run against any page that is not in `targets.config.json`.
- This never writes to the akimbuilds or stagger Vercel projects. Ops tools only audit them.
- This does not contact prospects or send reports anywhere automatically.
- No model judges design or page quality. The only model-graded check is the honesty check.
- No Slack, no third-party observability or eval vendor, and no paging.
- No integration with the Hermes eval harness Worker or its D1 database.
- The live eval never runs automatically in CI.
- The MCP does not re-implement the official Vercel MCP's raw tools, and it is single-tenant.
- Rolling Releases, Vercel Agent, v0 and Observability Plus wait for the optional Pro trial in Milestone 5.
- No Homebase account, repo, Telegram bot or Vercel team is involved.

## Open risks

- The Workflow SDK's API for starting runs, pausing on hooks, resuming from a webhook and reading run status may not match these assumptions, resolved by reading the installed package's types during Milestone 1 investigation.
- Whether the Chat SDK's Telegram adapter can resume a Workflow hook from a button press as cleanly as its Slack adapter is unconfirmed, resolved in the first Milestone 1 spike. The fallback is the signed URL-button pattern from `hermes-invest/eval-harness/src/trade/sign.ts`, ported to `apps/web`.
- Whether OpenAI's prompt caching applies through AI Gateway with BYOK is unconfirmed, resolved by one repeated test call that reads `cachedInputTokens`.
- The exact OpenAI snapshot IDs and prices for the GPT-5.6 family come from third-party reporting, resolved by reading OpenAI's models and pricing pages during investigation.
- Whether Better Auth's MCP plugin completes the OAuth flow with both Claude Code and the claude.ai connector, and whether Sign in with Vercel works for an app on a Hobby team, are unconfirmed, resolved by a spike at the start of Milestone 3 for the runs page and at the start of Milestone 4 for MCP. The fallback is WorkOS AuthKit with Vercel as its social login.
- Running Chromium and Lighthouse inside a Sandbox, and how noisy its results are, is unproven, resolved by a first-day spike that runs Lighthouse five times on one fixture. If LCP varies by more than 10 percent, the run count rises to five.
- Whether Vercel Deployment Protection is available on Hobby is unclear from the pricing page, and the template's own gate makes the design independent of the answer.
- The Hobby allowances may change or bite sooner than expected, resolved by the health job's usage alerts and by keeping the per-run Blob and Sandbox footprint small.
- The fidelity constants (40-character text blocks, 100-pixel images, the 0.9 gate) are judgment calls, resolved by scoring the labeled targets by hand in Milestone 2 and adjusting once, before the live baseline is saved.
- SSIM on pages of different heights may be unstable, resolved by comparing only the first three viewport tiles and treating the score as informational.
- The control sites may need sections the template lacks, resolved by the Milestone 1 section inventory. If the catalog misses common sections, add them to the template rather than raising the custom cap.
