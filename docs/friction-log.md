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

