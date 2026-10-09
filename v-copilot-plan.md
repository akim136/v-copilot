# v-copilot and Vercel Ops MCP: Implementation Plan

## Approach

This is a learning build first and a portfolio piece second. The goal is to understand Vercel's products by using them for something real, and to end up with work a Solutions Architect team would recognize as their own job: a proof of concept with agreed success criteria, honest measurement, and a report. The centerpiece is v-copilot, a durable agent workflow that takes one permissioned page and a brief, measures it, proposes success criteria for Alex to approve in Telegram, rebuilds that page on a Next.js 16 template, deploys a gated preview, measures again under identical conditions, and writes the POC report with what it cost to produce. Each POC is a Workflow SDK run with fixed steps, and models (OpenAI through AI Gateway with Alex's own key) only appear in the steps that need judgment. The agent writes a validated page spec that points at the original page's content by ID, and a fixed template renders it, which keeps output tokens low and makes it measurable whether content survived. A POC only counts as a success when it keeps at least 90 percent of the original content and meets every approved criterion, both scored in code, because a performance agent can always win by deleting things. A small Ops MCP is the front door: it starts POCs from Claude and adds only the four guarded operations the official Vercel MCP lacks. The work is ordered agent first, because building agents on Vercel is the gap, and it is cut into milestones of roughly two weeks at 5 to 10 hours a week. Each milestone ends with something demoable and teaches a named set of Vercel products, so stopping after any milestone still leaves a complete story. Milestones 1 to 4 are the core and take about eight weeks. Milestone 5 uses the Pro trial, and Milestones 6 to 12 extend v-copilot into other parts of an SA's job, for about six months in total if everything is built. Every session ends by updating `PROGRESS.md` and adding to a friction log of anything a Vercel product made harder than it should be, which is both the learning record and the raw material for the write-up. Everything runs on Alex's personal Vercel Hobby team, a personal OpenAI project, the `akim136` GitHub account and a dedicated Telegram bot. There is no external deadline.

## Cost estimates

Every milestone below carries its own estimate. These are the assumptions behind them:
- Vercel stays on the free Hobby plan, so platform usage costs nothing as long as it fits the Hobby allowances listed in the spec.
- Model prices are $2 input and $12 output per million tokens for `gpt-5.6-terra` and $0.20 and $1.20 for `gpt-5.6-luna`, from third-party reporting of OpenAI's July 30 price cut, so they are confirmed in Milestone 1.
- Token spend is billed to your OpenAI account through BYOK, not to AI Gateway credits. The one-time Gateway credit only unlocks BYOK and covers retries on Vercel's own credentials.
- Replay mode keeps most development free, so the token ranges assume 20 to 50 live runs per milestone.
- Claude Code usage comes from your existing Claude plan and is not counted here.

| Milestone | Upfront | Tokens during the milestone | Ongoing after it ships |
|---|---|---|---|
| 1. Plan a POC | $10 AI Gateway credits (one time) | $2 to $5 | $0 idle, about $0.05 to $0.10 per plan-only run |
| 2. Build, preview, measure | $0 | $10 to $25 | $0 idle, about $0.40 to $0.80 per full POC |
| 3. Evals and monitoring | $0 | $10 to $15 | $0 idle, up to $5 per live eval you choose to run |
| 4. MCP front door | $0 | $2 to $5 | $0 idle |
| 5. Pro trial, eve, packaging | $0 during the 14-day trial | $4 to $10 | $0, or $20 a month if you keep Pro |
| 6. Multi-template POCs | $0 | $15 to $30 | about $1.20 to $2.40 per multi-template POC |
| 7. Dynamic and commerce pages | $0 | $5 to $15 | $0 idle |
| 8. Post-launch watch | $0 | under $1 | under $1 a month |
| 9. Security posture | $0 | $3 to $8 | $0 idle |
| 10. Migration plan and cutover | $0, or about $12 a year for an optional test domain | $5 to $10 | $0 idle |
| 11. Coding-agent harnesses | $0 | $20 to $40 | about $0.50 to $2 per harness fix attempt |
| 12. Self-serve design | $0 | $0 | $0 (design only) |
| **Core, Milestones 1 to 4** | **$10** | **about $24 to $50** | **$0 idle** |
| **Everything, Milestones 1 to 12** | **$10 to $22** | **about $76 to $164** | **$0 idle on Hobby, $20 a month if Pro is kept** |

## Milestone 1: A durable agent that plans a POC (about two weeks)

Build the monorepo, the allowlist, the outline extractor, the Sandbox snapshot with Chromium and Lighthouse, the baseline measurement, the `analyze` agent step, the criteria approval in Telegram, and a plan report in Blob. A run is started from a local script. Nothing is built or deployed for the target yet, so this is the smallest complete agent: durable, metered, human-approved. It teaches the Workflow SDK, Sandbox, the AI SDK, AI Gateway, Blob, the Chat SDK and Fluid compute.

Estimated cost: $10 upfront for the AI Gateway credits that unlock BYOK, $2 to $5 in OpenAI tokens while building, because only `analyze` calls a model, and about $0.05 to $0.10 per plan-only run afterward. Telegram, GitHub Pages and the PageSpeed Insights API are free.

Acceptance criteria:
- WHEN `pnpm poc start <target>` names a URL not in `targets.config.json`, THEN the run ends `rejected` before any network fetch, Sandbox start or model call.
- GIVEN an allowlisted prospect fixture, WHEN `intake` runs twice on the same HTML, THEN it produces identical outline IDs for every heading, text block and image.
- GIVEN an allowlisted prospect fixture, WHEN `baseline` runs, THEN the report records three Lighthouse runs and their median for performance score, LCP, CLS, TBT, FCP, TTFB, total JavaScript bytes, and the accessibility and SEO scores, plus PageSpeed Insights field data when it exists.
- WHEN `analyze` completes, THEN it returned structured output only, made no tool calls, and every proposed criterion names a metric, its baseline value, a numeric target and a one-line rationale.
- WHEN a run reaches `await_criteria`, THEN one Telegram message with Approve and Reject buttons arrives from the v-copilot bot, and the run stays paused until a button is pressed.
- WHEN Alex presses Approve, THEN the run resumes and finishes as `planned`; WHEN a Telegram user other than Alex presses a button, THEN nothing resumes; WHEN Approve is pressed a second time, THEN it is ignored.
- WHEN the local dev server is killed during `analyze` and restarted, THEN the run resumes and `baseline` is not re-executed.
- WHEN the same URL is baselined twice on the same day, THEN the second run reads results from the Blob cache and starts no Sandbox.
- WHEN a recorded run is replayed with `MODEL_MODE=replay`, THEN it produces an identical report with zero live model calls.
- The report's `costUsd` equals token usage multiplied by the price table for every model call in the run.
- GIVEN $8 or more of model spend across runs in the last 24 hours, WHEN a new run starts, THEN it ends `rejected` with the reason `daily_cap` before any model call.
- The repo has a `CLAUDE.md` that points to the plan, spec and pinned constraints, and a `PROGRESS.md` that names the last completed acceptance criterion, the next step, open blockers and model spend to date.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 2: Build, preview and measure (about two weeks)

Build the Next.js 16 template, the `page_spec` agent step with the fidelity gate, the Sandbox build with the bounded fix loop, the minimal `vercel-ops` library, gated preview deploys into one Vercel project per target, the before and after measurement, the verdicts, the honesty-checked report, and the release gate in Telegram. This depends on Milestone 1 because the spec references the outline's IDs and builds toward the approved criteria. It teaches deployments through the Vercel SDK, Next.js 16 rendering and caching, Image Optimization, Routing Middleware and the Vercel project model.

Estimated cost: nothing upfront, $10 to $25 in OpenAI tokens while building (20 to 40 live full runs, the rest in replay), and about $0.40 to $0.80 per full POC afterward. Each full POC uses roughly five minutes of Sandbox CPU, so Hobby's five hours a month covers about 60 full POCs.

Acceptance criteria:
- WHEN `page_spec` completes, THEN its output validates against the `PageSpec` schema, every `ref` resolves to an outline item, no literal string exceeds 80 characters, and it contains at most two custom components.
- WHEN `page_spec` completes, THEN a fidelity score from 0 to 1 and the list of outline IDs it left out are stored.
- GIVEN a recorded spec with one content section deleted, WHEN fidelity is scored, THEN the score falls below 0.9 and that section's IDs appear in the missing list.
- WHEN fidelity is below 0.9, THEN `page_spec` runs exactly once more with the missing IDs listed, and if the score is still below 0.9 the run ends `needs_human` without building.
- GIVEN a custom component that calls `fetch`, loads an external script or uses `dangerouslySetInnerHTML`, WHEN the template lint runs, THEN the build fails.
- WHEN the template is linted, THEN `eslint-plugin-jsx-a11y` reports no errors and every rendered image carries alt text from the outline.
- GIVEN a valid spec, WHEN `build` runs, THEN the project passes `next build` in a Sandbox started from the snapshot, with the dependency install finishing in under 30 seconds.
- GIVEN a custom component that fails to compile, WHEN the fix loop runs, THEN it makes at most three attempts and, if all fail, ends `needs_human` with only the failing log lines attached.
- WHEN the first POC runs for a target, THEN `vercel-ops` creates the project `poc-<target>`; WHEN later POCs run for that target, THEN each adds a preview deployment to the same project and previews beyond the newest ten are removed.
- WHEN a preview is requested without a valid access token, THEN it returns 401 with `noindex`, whether or not Vercel Deployment Protection is available on the plan.
- WHEN `measure` runs, THEN both URLs get three Lighthouse runs in the same Sandbox session, the preview is reached with the access token, and mobile screenshots of both pages plus a visual similarity score are recorded without affecting any verdict.
- WHEN the report is written, THEN each approved criterion is marked met or not met from the medians in code, and the run is a success only when every criterion is met and fidelity is at least 0.9.
- GIVEN a recorded summary seeded with a number not in the measurements, WHEN the honesty check runs, THEN the summary is flagged and regenerated once, and if still flagged the report uses a summary templated in code.
- WHEN `await_release` is approved in Telegram, THEN the run creates a share link that expires after seven days and marks the report final; WHEN it is rejected, THEN no share link exists.
- WHEN a full run finishes, THEN it wrote at most four Blob objects for that run and updated `runs/index.json`.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 3: Evals and monitoring (about two weeks)

Label the fixture and control set, grade the judgment steps in code, run the replay eval in CI on every pull request, run a live eval with a saved baseline and regression rules, and add per-call traces, Telegram alerts, a daily health job and a runs page behind Sign in with Vercel. This comes after Milestone 2 because there is now a full pipeline to grade and enough moving parts to need watching. It teaches Vercel Observability tracing, Cron Jobs, runtime logs and Sign in with Vercel.

Estimated cost: nothing upfront, since the Neon database for sign-in uses its free tier and GitHub Actions is free for a public repo. Expect $10 to $15 in OpenAI tokens for two or three live evals, each capped at $5. Afterward the daily health job costs nothing, and a live eval costs up to $5 whenever you choose to run one.

Acceptance criteria:
- GIVEN the six labeled targets (four prospect fixtures and the two control sites), WHEN the step eval runs in live mode, THEN `analyze` section recall is at least 0.9 on every fixture, every draft target beats its baseline and falls inside `evals/bounds.json`, and every spec validates with median fidelity of at least 0.9.
- WHEN `pnpm eval:replay` runs in GitHub Actions on a pull request, THEN it makes no model, Vercel or Sandbox call and fails if any score differs from `evals/baselines/replay.json`.
- WHEN `pnpm eval:live` runs, THEN it auto-approves drafted criteria, stops each run after `report` with no share link, stops before total spend passes $5, and writes its results to Blob.
- WHEN a live eval's success rate is more than 10 points lower than `evals/baselines/live.json`, its median fidelity is more than 0.02 lower, or it has a hard fail the baseline did not, THEN the command exits non-zero; WHEN run with `--update-baseline`, THEN it rewrites the baseline.
- WHEN a pull request changes a prompt file or the model table without also changing `evals/baselines/live.json`, THEN CI fails.
- GIVEN a control site already served by Vercel, WHEN a full POC runs on it, THEN its summary passes the honesty check without regeneration.
- WHEN any model call runs, THEN a span with run ID, step, model, input, cached input and output tokens, cost and latency is stored in the run's bundle and exported to Vercel Observability.
- WHEN a run ends `failed` or hits the per-run or daily cap, THEN one Telegram alert naming the run, step and reason arrives within a minute.
- WHEN the daily health job runs, THEN it writes `health/<date>.json` with the seven-day failure rate, needs-human rate, cost, cap hits, stale gates, and Sandbox CPU and Blob advanced operations as a share of the Hobby allowance, and it sends a Telegram message only when a threshold in the spec is crossed.
- WHEN Alex opens `/runs` signed in with Vercel, THEN it lists every run from `runs/index.json` with status, success, fidelity, visual similarity, criteria met, cost and duration, readable at phone width; WHEN anyone else signs in or no one is signed in, THEN access is denied.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 4: The MCP front door (about two weeks)

Expose v-copilot and four guarded Vercel operations as an MCP server on `mcp-handler`, authenticated through Sign in with Vercel, so Claude can start and approve POCs and audit Alex's real projects while the official Vercel MCP handles everything else. This is last of the core milestones because it only composes pieces that already work. It teaches hosting MCP servers on Vercel, OAuth on Vercel, and how the official Vercel MCP and a custom one divide the work.

Estimated cost: nothing upfront, $2 to $5 in OpenAI tokens for test POCs started from Claude, and nothing while idle. The MCP endpoint runs inside the existing app on Hobby.

Acceptance criteria:
- WHEN Claude Code and the claude.ai connector add the MCP endpoint, THEN each completes OAuth through Sign in with Vercel and lists exactly nine tools: the four Ops tools and the five POC tools in the spec.
- WHEN anyone other than Alex's Vercel account completes sign-in, THEN the MCP returns 403 for every tool.
- WHEN an unauthenticated client calls the MCP endpoint, THEN it receives a 401 that points to the protected-resource metadata.
- WHEN the official Vercel MCP and this MCP are both connected in Claude, THEN one session can read a deployment's logs through the official server and start a POC through this one with no tool-name collisions.
- GIVEN the smoke-target fixture with its preview smoke check forced to fail, WHEN `safe_deploy` runs with `promote: true`, THEN nothing is promoted; GIVEN `FAIL_IN_PROD=true` only on production, WHEN `safe_deploy` promotes, THEN it rolls back within the watch window and writes an audit record.
- WHEN any production-mutating tool is called without `confirm_production: true`, THEN it refuses and changes nothing.
- WHEN `secret_hygiene_audit` and `env_diff` run against the akimbuilds and stagger projects, THEN they return findings without any variable value and make no change to either project.
- GIVEN a Git-connected project, WHEN `set_crons` runs, THEN it returns the `vercel.json` patch and deploys nothing.
- WHEN Claude calls `start_poc` and then `approve_poc_gate`, THEN the run starts, pauses and resumes exactly as it does from the script and Telegram.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 5 (optional): Pro features, eve and packaging (about two weeks)

Alex's account has a Pro trial available. Spending it here unlocks the products Hobby cannot use: Rolling Releases inside `safe_deploy`, Vercel Agent reviewing the repo, v0 for designing new template sections, and Observability Plus. In the same window, rebuild the `analyze` step as an eve agent and write up how it compares with the AI SDK version, then package the work: a README with the architecture diagram, a three-minute Loom of one POC from Claude to Telegram approval to the runs page, and a short write-up on cost per POC, how the fidelity gate keeps the agent honest, and the most useful product feedback from the friction log.

Estimated cost: nothing upfront during the 14-day trial. Expect $1 to $5 for Vercel Agent (about $0.25 per million tokens plus the model cost) and $3 to $5 in OpenAI tokens for the eve comparison. v0 and Loom stay on their free plans. Afterward it costs nothing if the team returns to Hobby, or $20 a month if you keep Pro. Start the trial only when you can use most of its 14 days.

Acceptance criteria:
- WHEN the trial is active, THEN `safe_deploy` uses a rolling release on the smoke-target fixture and still rolls back on a forced failure.
- WHEN the eve version of `analyze` runs on the labeled set, THEN its section recall, target checks, cost and latency are recorded next to the AI SDK version in one comparison table.
- The README, the Loom and the write-up are published from the `akim136` account, and none of them shows a token, a secret value or a Homebase resource.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Extension milestones

Milestones 6 to 12 extend v-copilot into other parts of a Solutions Architect's job. They are scoped here but not yet specified. Each one gets a short spec addendum and kickoff before it starts, because its load-bearing decisions are not settled. Several deliberately relax a rule from the v1 spec, such as one page per POC, no domain on a POC project, or no writes to Firewall settings. Each relaxation is decided in that milestone's addendum, never earlier. Every extension milestone keeps the core guardrails: the allowlist, the spend caps, gated previews, no writes to Alex's real projects, and Telegram approval before anything is applied.

## Milestone 6: Multi-template POCs (about two weeks)

Real POCs cover a site's key page templates, not one page. v-copilot samples the home, one listing and one detail page from a sitemap, runs them through the pipeline in parallel, and produces one report and one preview with routing between the pages. It teaches Queues, parallel Workflow steps, and Next.js Cache Components with time-based and tag-based revalidation.

Estimated cost: nothing upfront, $15 to $30 in OpenAI tokens while building because each POC now covers three pages, and about $1.20 to $2.40 per multi-template POC afterward. Each one uses roughly three times the Sandbox CPU of a single-page POC, so Hobby's allowance covers about 20 a month.

Acceptance criteria:
- GIVEN a target with a sitemap, WHEN `intake` runs, THEN it selects at most three pages (home, one listing, one detail) by URL pattern, and the selection is approved in the criteria gate.
- WHEN a multi-template POC runs, THEN each page's baseline, spec and build run as parallel Workflow steps, and a failure on one page ends that page `needs_human` without stopping the others.
- WHEN the run finishes, THEN one preview in `poc-<target>` serves every selected page with working links between them, and one report shows per-page verdicts, fidelity and cost.
- WHEN listing and detail pages render, THEN they use Cache Components with tag-based revalidation, and revalidating one tag refreshes only the pages that use it.
- The per-run cap scales to $1.50 per page with a ceiling of $4.50, and the run stops before its next model call once it passes that cap.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 7: Dynamic and commerce pages (about two weeks)

Add data-backed sections, such as a product grid fed by a Shopify development store or a headless CMS on a free plan. The rebuilt page reads live data instead of a snapshot, and the preview runs an experiment between two rendering variants of the same page through the Flags SDK, with the split stored in Global Config. Composable commerce and headless CMS are named in the SA job posting, so this milestone maps most directly onto the role. It teaches the Flags SDK, Global Config, Marketplace and partner data sources, and caching for dynamic content.

Estimated cost: nothing upfront, since a Shopify Partners development store, a headless CMS free plan such as Sanity's, the Flags SDK and Global Config within Hobby's 100 writes a month are all free. Expect $5 to $15 in OpenAI tokens while building and nothing while idle.

Acceptance criteria:
- GIVEN a commerce fixture backed by a development store or CMS, WHEN `page_spec` maps a product grid, THEN it binds the grid to the data source instead of copying product data into the spec.
- WHEN data-backed sections render on the preview, THEN they are cached with tags, and a content change in the source appears on the preview after revalidation without a redeploy.
- WHEN the release gate is approved, THEN the preview serves two rendering variants behind a Flags SDK flag whose split lives in Global Config, and changing the split takes effect without a redeploy.
- WHEN the experiment report is written, THEN it shows Lighthouse results for both variants measured in the same Sandbox session, with the verdict computed in code.
- No more than 20 Global Config writes happen in a calendar month, enforced in code.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 8: Post-launch watch (about two weeks)

After a POC "goes live," the SA job continues with onboarding and optimization. v-copilot watches the two control sites with real-user data, comparing field Core Web Vitals from Speed Insights and traffic from Web Analytics against their most recent POC lab numbers, and alerts on regressions. Alex enables Speed Insights and Web Analytics on akimbuilds and stagger himself, and v-copilot only reads them. It teaches Speed Insights, Web Analytics and Cron Jobs, and the difference between field and lab data.

Estimated cost: nothing upfront, because Speed Insights (10,000 events per 30 days), Web Analytics (50,000 events a month) and a weekly cron all fit Hobby. Expect under $1 in tokens while building and under $1 a month afterward for the weekly Luna summary. Log drains and Observability Plus would need Pro at $20 a month and are left out unless you keep Pro after Milestone 5.

Acceptance criteria:
- WHEN the weekly job runs, THEN it reads field Core Web Vitals and traffic for both control sites without changing either project, and records which numbers are field data and which are lab data.
- WHEN a site's p75 LCP, CLS or INP crosses the "needs improvement" threshold or worsens by more than 20 percent week over week, THEN one Telegram alert names the metric, page and change.
- WHEN the weekly report is written, THEN it compares field data with the site's most recent POC lab numbers and passes the honesty check.
- The weekly job's model spend stays under $0.10 a week, recorded in its trace.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 9: Security posture (about two weeks)

Security and architecture reviews are part of the SA job. v-copilot reviews a target's security setup, proposes Firewall custom rules, rate limits and BotID placements, applies them to the target's `poc-*` project only after Telegram approval, and verifies them with harmless tests against Alex's own previews. It teaches the Vercel Firewall and WAF, rate limiting and BotID.

Estimated cost: nothing upfront, since Hobby includes three custom rules, three IP rules, a million rate-limited requests a month and basic BotID checks. Expect $3 to $8 in OpenAI tokens while building and nothing while idle. BotID's deep analysis needs Pro and is not used.

Acceptance criteria:
- WHEN a security review runs, THEN the report lists each proposed rule, rate limit and BotID placement with a one-line reason, and nothing is applied before approval.
- WHEN Alex approves in Telegram, THEN the rules are applied only to the target's `poc-*` project, stay within Hobby's rule limits, and are written to the audit log.
- WHEN the verification step sends a burst of requests from the Sandbox to that preview, THEN responses past the configured limit return 429, and no request is sent to any host outside the allowlist.
- WHEN a BotID-protected form on the preview is submitted by a headless script, THEN the submission is flagged, and a submission from a normal browser session passes.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 10: Migration plan and cutover (about two weeks)

This brings back the cf2vercel idea in a smaller, safer form, and it is where Alex's Cloudflare background matters most. For a site hosted elsewhere, v-copilot writes the migration plan: the redirects and rewrites to carry over, the DNS changes, and a cutover and rollback checklist. It tests the redirects on the preview and rehearses the cutover on a dedicated test subdomain, without editing any existing DNS record. It teaches Domains and DNS, bulk redirects and routing rules.

Estimated cost: nothing upfront if the rehearsal uses a test subdomain of akimbuilds.com, or about $12 a year for an optional throwaway test domain. Expect $5 to $10 in OpenAI tokens while building and nothing while idle.

Acceptance criteria:
- GIVEN a multi-URL fixture hosted on GitHub Pages, WHEN a migration plan runs, THEN it produces a redirect map covering every crawled URL, the Vercel routing configuration, a DNS change list, and a cutover and rollback checklist with estimated downtime.
- WHEN the redirect map is deployed to the target's `poc-*` preview, THEN every old URL returns its planned status code and destination, checked in code.
- WHEN the cutover rehearsal runs after Telegram approval, THEN it attaches one dedicated test subdomain to the `poc-*` project, confirms it serves, and removes it, and no existing DNS record is edited or deleted.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 11: Coding-agent harnesses in the fix step (about two weeks)

Swap the fix step's single model call for AI SDK 7's harness API, so Claude Code or Codex works on a failing build inside the Sandbox, and grade them against the original fixer. This goes deepest into the agent stack and builds on Alex's eval work. It teaches the AI SDK harness API, Sandbox network policies and multi-provider routing through AI Gateway.

Estimated cost: nothing upfront, though Claude Code through the harness needs an Anthropic key added to AI Gateway as a second BYOK credential. Expect $20 to $40 in tokens across OpenAI and Anthropic while building, because coding agents use far more tokens per task than a single call. Afterward, expect about $0.50 to $2 per harness fix attempt if harness mode stays on.

Acceptance criteria:
- WHEN the fix step runs in harness mode, THEN Claude Code or Codex runs inside the run's Sandbox with network access limited to package registries and cannot change files outside the generated project.
- GIVEN at least ten recorded failing builds, WHEN the harness eval runs, THEN it records fix success rate, attempts, wall time and cost for the single-call fixer, Claude Code and Codex in one comparison table.
- Harness runs count toward the per-run and daily caps and stop before spending more than $2 on a single fix.
- `docs/friction-log.md` has at least one entry for each Vercel product this milestone introduced.

## Milestone 12: Self-serve design (about one week, design only)

Design, but do not build, a public "run a POC on your site" page. Permission comes from DNS TXT domain verification instead of the allowlist, and it adds per-visitor budgets, BotID and rate limits on the intake form, and abuse handling. This is the step from a personal tool to a product, and it is commercial use, so it would require Pro.

Estimated cost: nothing, because this milestone produces a document. If it is ever built, expect Pro at $20 a month plus token exposure bounded by a per-visitor budget, for example $1 per POC.

Acceptance criteria:
- `docs/self-serve.md` covers domain verification, per-visitor budgets, BotID and rate limits, abuse cases, the Pro cost model at 10, 100 and 1,000 POCs a month, and a go or no-go recommendation.
- No public intake endpoint is deployed in this milestone.
