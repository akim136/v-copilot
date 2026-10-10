# Friction log

One entry per issue a Vercel product made harder than expected. Format:

```markdown
## YYYY-MM-DD · Milestone N · Product
What happened:
What I expected:
Severity: blocker | slowdown | papercut
Suggested fix:
Links:
```

## 2026-10-07 · Milestone 1 · Workflow SDK
What happened: `withWorkflow` silently adds a public `/.well-known/workflow/v1/webhook/[token]` route to the app. It is not obvious from the hooks docs whether a token created with `createHook` (not `createWebhook`) can be resumed through that public route, which matters when the token is derived from a run ID.
What I expected: a clear statement in the hooks docs of which hook kinds are reachable over HTTP, and a recommendation for unguessable tokens on approval hooks.
Severity: papercut — resolved in P1: the public route uses `resumeWebhook`, which refuses `createHook` tokens (verified live, 404)
Suggested fix: document the reachability of `createHook` tokens via the webhook route next to the custom-token example.
Links: workflow@5.1.0 `docs/` bundle

## 2026-10-07 · Milestone 1 · AI Gateway (via OpenAI model catalog)
What happened: the spec called for dated snapshot IDs for `gpt-5.6-terra` and `gpt-5.6-luna`, but neither OpenAI nor AI Gateway publishes dated snapshots for this family, only the bare aliases.
What I expected: a dated, immutable model ID to pin, so a silent model update cannot change cost or behavior.
Severity: papercut
Suggested fix: expose a release date or revision field on `/v1/models` entries so a client can detect when an alias changes.
Links: https://ai-gateway.vercel.sh/v1/models, https://developers.openai.com/api/docs/models/gpt-5.6-terra

## 2026-10-07 · Milestone 1 · Chat SDK
What happened: `ChatConfig.state` is required, and the Telegram adapter dedupes updates through it, but the README quick start omits it. The only zero-infrastructure option, `@chat-adapter/state-memory`, is documented as dev-only, which conflicts with a no-database design on serverless.
What I expected: guidance on a stateless webhook mode for bots that keep their own idempotency (here, Workflow hooks that resume once).
Severity: slowdown
Suggested fix: show `state` in the quick start and document what breaks with memory state on Fluid compute.
Links: chat@4.41.1, @chat-adapter/telegram@4.41.1

## 2026-10-09 · Milestone 1 · Vercel deployments (Git integration)
What happened: right after `vercel git connect`, the first push to a feature branch (`m1/p1-spikes`) was built with target `production` and aliased to `v-copilot.vercel.app`, because the project had no production deployment yet. `apps/web/vercel.json` already disabled deploys from `main`, and the production branch is `main`, so nothing in the config asked for this.
What I expected: a push to a non-production branch to always produce a preview deployment.
Severity: slowdown (protected by Vercel Authentication, and sensitive env vars are preview-only, so the spike build had none of them and could not run the test)
Suggested fix: never auto-assign production to a non-production-branch build, or warn about it in `vercel git connect`.
Links: deployment v-copilot-8vp93iufs-akim-projects.vercel.app (commit c48c65e)

## 2026-10-09 · Milestone 1 · Vercel Blob
What happened: connecting the private Blob store created `BLOB_READ_WRITE_TOKEN` as a `Config` (non-sensitive) variable on Production, Preview and Development, so `vercel env ls` prints the start of the token.
What I expected: a read-write credential created as a sensitive variable, scoped to the environments I chose.
Severity: papercut
Suggested fix: create store tokens as sensitive by default and ask which environments to attach.
Links: store_XvValUcqtyqZyI0i

## 2026-10-09 · Milestone 1 · Vercel CLI
What happened: `vercel env add NAME preview --sensitive` with the value piped on stdin failed silently in a loop on CLI 59.7, because it stopped to ask for a Git branch. Adding `--yes` fixed it.
What I expected: a non-interactive stdin run to either use the all-branches default or exit with a clear error.
Severity: slowdown
Suggested fix: when stdin is not a TTY, apply defaults or fail loudly instead of waiting on a prompt.
Links: vercel CLI 59.7.0

## 2026-10-09 · Milestone 1 · Chat SDK
What happened: posting a card from a Workflow step (not a webhook) failed with "MemoryStateAdapter is not connected. Call connect() first." after the message was already sent to Telegram, so the step's retries sent the card four times.
What I expected: `thread.post()` to initialize the instance lazily, as webhook handling does, or to fail before sending anything.
Severity: slowdown
Suggested fix: call `ensureInitialized()` inside `post()`, or document that non-webhook senders must call `chat.initialize()` first.
Links: chat@4.41.1, run wrun_41M4GCT4ZK0GG1908JWPTXY2YW

## 2026-10-09 · Milestone 1 · AI SDK
What happened: `generateText` retries a failed call twice by default (`maxRetries: 2`), and only the last attempt's usage reaches the result, so a caller that checks a spend cap once per call can pay for three requests and count one. With structured output and no tools it also still sends `toolChoice: { type: 'auto' }`.
What I expected: retries to be opt-in, or the result to carry the usage of every attempt.
Severity: slowdown (found in review; we set `maxRetries: 0` and retry through our own cap-checked wrapper)
Suggested fix: document the retry default next to usage accounting, and report per-attempt usage on `RetryError`.
Links: ai@7.0.130

## 2026-10-10 · Milestone 1 · Workflow SDK
What happened: the generated `.well-known/workflow/v1/flow/route.js` was 1.43 MB and contained `@vercel/sandbox`, Chat SDK, zod locales and a Markdown parser, which looked like Node-only step dependencies leaking into the workflow VM. Confirming they were not took reading `route.js.__wf_tmp.js.debug.json`: the builder adds the modules of every class with custom serialization (Sandbox, Chat SDK) as "serdeOnlyFiles". Separately, `getStepMetadata().attempt` is documented as "increases with each retry", but the runtime's own comment says duplicate `step_started` events can inflate the raw count on the local World.
What I expected: a build summary saying which files went into the workflow bundle and why, and an attempt number documented as possibly overcounting.
Severity: slowdown
Suggested fix: print the workflow bundle's file list (or the debug JSON path) in the build output, and document `attempt`'s guarantees.
Links: workflow@5.1.0, @workflow/core dist/runtime/count-step-started-events.js

## 2026-10-10 · Milestone 1 · Vercel Blob
What happened: `put(path, body, { allowOverwrite: false })` onto an existing path throws a generic `BlobError`, not a typed error like `BlobPreconditionFailedError`, so a create-only write cannot tell "already exists" from a network failure without a second read. `get()` also types `blob.etag` as a string that can be empty, and `put({ ifMatch: '' })` then sends no condition at all, which silently turns a guarded write into an overwrite.
What I expected: a typed "already exists" error, and `ifMatch` with an empty value to be rejected.
Severity: papercut (found while writing the index store; we re-read on a failed create and refuse an empty etag)
Suggested fix: export `BlobAlreadyExistsError`; throw on an empty `ifMatch`.
Links: @vercel/blob@2.8.1

## 2026-10-10 · Milestone 1 · Vercel Sandbox
What happened: a Sandbox created from a snapshot gives no way to locate binaries the snapshot installed, so every start runs `find /` for Playwright's versioned Chromium path. Lighthouse also needed `sudo` to launch Chrome. If the lookup fails after `getOrCreate`, the Sandbox keeps running until its timeout unless the caller stops it.
What I expected: snapshot metadata (environment or PATH captured at `snapshot()`), so a restored Sandbox starts with the same environment as the session that made it.
Severity: papercut
Suggested fix: persist the session's environment variables with the snapshot, or let `snapshot()` record an env map.
Links: @vercel/sandbox@3.5.1, snapshot snap_lPPlYwCXqDdth3n0ga8azg5WQuN2


## 2026-10-10 · Milestone 1 · Workflow SDK
What happened: the first deployed plan run failed in under two seconds and wrote nothing, not even its failure report. The steps were passed to a pure function as fields of a deps object and called as `d.recordRun(row)`, and the runtime serializes a step's `this`, so every call failed with "Failed to serialize step arguments at path .thisVal.now" (the object also holds plain functions). The error was only in the deployment's runtime logs; unit tests with a mocked runtime can't see it.
What I expected: a step called as a method to ignore `this`, or the build (or the SWC transform) to warn when a step is referenced as a value.
Severity: blocker until found (fixed by calling each step through an arrow function, with a test that no step receives a `this`)
Suggested fix: don't capture `this` for top-level step functions, or document it next to the serialization rules.
Links: workflow@5.1.0, run wrun_41M4KS6FNB0GVH2T2NZREAWZNT

## 2026-10-10 · Milestone 1 · AI Gateway
What happened: the first live `analyze` call from a preview failed with `GatewayInternalServerError (status 403)`. The reason, only in the error's message, was "Free tier users do not have access to this model. Upgrade to paid credits…". OIDC auth worked (`/v1/credits` returned 200, balance 5, used 0) and BYOK was set up, but a free-tier team can't reach `gpt-5.6-terra` at all, so the OpenAI key was never tried. Nothing in `/v1/models` or `/v1/credits` says which models a team's tier can call.
What I expected: an `authorization`- or `tier`-typed error (not "internal server error"), and the tier or model access visible in the API before the first call.
Severity: blocker (stop-and-ask: BYOK fails on the personal team)
Suggested fix: return a distinct error type for tier restrictions; show the tier in `/v1/credits`; say on the BYOK page that BYOK needs paid credits.
Links: @ai-sdk/gateway@4.0.106, runs wrun_41M4KW00JE0GXE84P6A2Y8JF3C and wrun_41M4KW928V0GS5D5EKDM8SC6CC

## 2026-10-10 · Milestone 1 · Vercel Sandbox
What happened: every stopped Sandbox kept a 1.6 GB snapshot of itself for 30 days (`vercel sandbox snapshots ls`), because Sandboxes are persistent by default. After P1's spikes and one live baseline there were five, about 8 GB of Hobby's 15 GB snapshot storage, so about nine baselines a month would have hit the limit.
What I expected: one-off Sandboxes not to snapshot themselves on stop, or the Hobby limit to be shown next to the persistence default.
Severity: slowdown (found by listing Sandboxes; the run's Sandbox is now created with `persistent: false` and deleted after the baseline)
Suggested fix: default `persistent` to false for Sandboxes created from a snapshot, and warn when snapshot storage nears the plan limit.
Links: @vercel/sandbox@3.5.1

## 2026-10-10 · Milestone 1 · Vercel Blob
What happened: once `runs/index.json` reached 1,024 bytes, every etag-guarded write to it failed. `get(path, { useCache: false })` returned the etag from a compressed response, in weak form (`W/"a2ab…"`), while `head()` returned the strong form (`"a2ab…"`). `put({ ifMatch })` compares strongly, so the weak etag never matched, and run wrun_41M4M0K7XT0GJVWYRK8Z7V88QF failed its index write 20 times (5 tries × 4 step attempts) with no other writer. Smaller objects come back uncompressed with a strong etag, so the bug only shows up once the object grows.
What I expected: `get()` to return the blob's own etag, the one `put({ ifMatch })` and `head()` use.
Severity: blocker for the 24-hour spend ceiling (a run's spend stayed out of the index until its row was added by hand). Fixed by stripping `W/` on read; a wrong tag would only conflict, never overwrite.
Suggested fix: return `blob.etag` from the blob's metadata rather than the response header, or have `ifMatch` accept the weak form.
Links: @vercel/blob@2.8.1, run wrun_41M4M0K7XT0GJVWYRK8Z7V88QF

## 2026-10-10 · Milestone 1 · Workflow SDK (Local World)
What happened: after `next dev` was killed during `analyze` and restarted, the run stayed `running` and nothing happened for 4.5 minutes. The Local World re-queues interrupted runs only in `world.start()`, and in a Next.js app nothing calls it unless `instrumentation.ts` does; the docs show that file only for the Postgres World. With `instrumentation.ts` added, the run was re-queued on restart but the step still waited out its 860-second inline ownership lease (`WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS`), so `analyze` re-ran 14 minutes after it started. The data directory is `apps/web/.next/workflow-data`, not `.workflow-data`.
What I expected: the Next.js integration to start the Local World itself (or the Local World docs to say recovery needs `instrumentation.ts`), and a dev server's own restart to release the steps that dev server owned.
Severity: slowdown (a Verify check looked like a failure until the runtime source explained it)
Suggested fix: call `world.start()` from `withWorkflow` in dev; release inline ownership on Local World start-up, since no other process can own the step.
Links: workflow@5.1.0, @workflow/world-local@5.0.2, run wrun_01M4M1Q7NGKSWP7P1TKF7TBVM4

## 2026-10-10 · Milestone 1 · Fluid compute (runtime logs)
What happened: Hobby keeps runtime logs for one hour, so a failure from the morning could only be read from what had been saved locally. On a preview, the whole plan run from intake to the posted Telegram card ran inside a single `/.well-known/workflow/v1/flow` request (inline steps), so the request log shows one line with no per-step entries or durations; `workflow inspect steps` was the only way to see which step ran when. Hobby's 300-second limit also meant one Lighthouse run per step.
What I expected: step names in the function's log lines, or a link from the request log to the run in the Workflow view.
Severity: papercut
Suggested fix: tag log lines emitted inside a step with the run and step IDs; show retention next to the logs view on Hobby.
Links: preview dpl_Cue7yWyzo4iXznRacEniF3VPoHeR, run wrun_41M4KZM4PK0GSP3DHSTTSSBTE4
