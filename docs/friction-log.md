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
Severity: papercut (pending the P1 spike result)
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
