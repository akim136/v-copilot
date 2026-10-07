# Vercel Product Map for a Builder

A working map of Vercel's products as of October 7, 2026: what each one is, when to reach for it, what your Hobby team gets, the closest Cloudflare equivalent, and where it shows up in the v-copilot build. Hobby allowances come from Vercel's pricing page on that date. Hobby is for personal, non-commercial use and cannot buy extra usage, so hitting an allowance pauses that product until the next month. Your account also shows a Pro trial available, which is how Milestone 5 reaches the Pro-only products.

## Agent stack

This is where Vercel is putting its weight right now, and it is the part you have not built with yet.

| Product | What it is and when to reach for it | Hobby | Cloudflare equivalent | In this build |
|---|---|---|---|---|
| AI SDK | Open-source TypeScript library for model calls, tools, structured output and agents. Version 7 adds tool approvals, durable agents and a harness API that drives Claude Code or Codex. Reach for it in any app that calls a model, on any host. | Free library | Agents SDK covers part of it, and the AI SDK also runs on Workers | Milestone 1, and the harness API in Milestone 11 |
| AI Gateway | One endpoint for many model providers, with budgets, fallbacks, usage logs and no markup on tokens. Reach for it when you want model choice and spend control without per-provider plumbing. | Free tier with a monthly credit on a subset of models. Using your own provider key (BYOK) requires purchased credits. | AI Gateway | Milestone 1, with your OpenAI key |
| Workflow SDK | Durable functions written as ordinary TypeScript with `"use workflow"` and `"use step"`. Steps retry and resume after crashes, and hooks pause a run until something external happens, such as an approval. Reach for it for any multi-step agent run that must survive failures or wait on a human. | 50,000 events and 1 GB of storage writes a month | Workflows, or a hand-built Durable Object state machine | Milestone 1, the backbone |
| Sandbox | Isolated microVMs for running code you do not trust, including code a model wrote, builds and headless browsers. Reach for it whenever an agent needs to execute something. | 5 hours active CPU, 420 GB-hours memory, 5,000 creations, 20 GB transfer, 10 concurrent | Containers and the Sandbox SDK | Milestones 1 and 2 for Lighthouse and builds, Milestone 11 for coding agents |
| Chat SDK | One bot codebase for Slack, Teams, Discord, GitHub and Telegram, with buttons and cards. Telegram supports inline buttons but not modals, and button payloads are capped at 64 bytes. | Free library | No direct equivalent | Milestone 1, Telegram approvals |
| eve | Open-source agent framework where an agent is a folder of markdown instructions and TypeScript tools, with durable execution, sandboxes, approvals and evals wired in. Reach for it when you want an agent's behavior to live in readable files. | Free framework, billed through the products it uses | Agents SDK | Milestone 5 comparison |
| MCP on Vercel (`mcp-handler`) | Package for hosting an MCP server inside a Next.js or other app on Vercel, with helpers for OAuth-protected endpoints. | Free package, billed as functions | `workers-oauth-provider` with `McpAgent` | Milestone 4 |
| Vercel MCP (official) | Vercel's hosted MCP server for docs, projects, deployments, logs, env vars, domains and more, including writes. Reach for it for anything raw. | Available, already connected to your Claude | None | Used alongside your MCP |
| Vercel Agent | Vercel's own agent for code review and production investigation that opens fix pull requests. | Not available on Hobby | None | Milestone 5, on the trial |
| v0 | AI app and UI generator with its own plans at v0.app. Your account is on the free v0 plan. | Separate plans | None | Optional, for template sections |
| Vercel Connect and Passport | Short-lived, task-scoped credentials for agents (Connect) and identity-aware access to internal apps (Passport), both announced at Ship 2026. | Not verified for Hobby | Access and Zero Trust | Not used. Sign in with Vercel covers identity here. |

## Compute and platform

| Product | What it is and when to reach for it | Hobby | Cloudflare equivalent | In this build |
|---|---|---|---|---|
| Vercel Functions on Fluid compute | Full Node.js functions billed on active CPU plus provisioned memory, so waiting on a model costs little. Reach for it for APIs, webhooks and anything that waits on I/O. | 4 hours active CPU, 360 GB-hours memory, 1M invocations | Workers, which also bill CPU time, so the cost story is closer than the marketing suggests. Fluid's advantage is the full Node runtime and longer durations. | Every milestone |
| Cron Jobs | Scheduled requests to a route, declared in `vercel.json`. | Included, daily schedules | Cron Triggers, where your akim04 account is already at its 5-trigger limit | Milestone 3, health job |
| Queues | Durable message queue, also used under the hood by Workflow. | 1M operations a month | Queues | Milestone 6, fanning out page templates |
| Routing Middleware (`proxy.ts`) | Code that runs before a request reaches the page, for auth gates, rewrites and redirects. | Included | Worker routes | Milestone 2, the preview gate |
| Builds and deployments | Every push gets an immutable deployment, previews per branch, production is an alias you promote or roll back. Your account allows one concurrent build. | Unlimited deployments, basic build machines | Workers versions and deployments | Every milestone |
| Rolling Releases | Gradual production rollouts with promote and abort. | Not available on Hobby | Gradual deployments | Milestone 5, on the trial |

## Data

| Product | What it is and when to reach for it | Hobby | Cloudflare equivalent | In this build |
|---|---|---|---|---|
| Blob | Object storage for files and JSON. Note the low allowance on advanced operations such as uploads and listings. | 1 GB storage, 10,000 simple and 2,000 advanced operations a month | R2 | Every milestone, four objects per run |
| Global Config (formerly Edge Config) | Small, very fast read-mostly config such as flags and allowlists, readable without a redeploy. | 100,000 reads and 100 writes a month | KV used for config | Milestone 7, the experiment split |
| Marketplace storage | Databases and caches from partners (Neon, Upstash, Supabase, and AWS Aurora, DynamoDB and OpenSearch) provisioned and billed through Vercel, with env vars injected for you. | Each provider's free tier | D1 and Hyperdrive | Milestone 3 for the auth store, Milestone 7 for commerce data |
| Flags SDK | Feature flags and experiments in Next.js, with flag values that can live in Global Config. | Free library | Workers feature flags or a KV lookup | Milestone 7 |

## Delivery, security and identity

| Product | What it is and when to reach for it | Hobby | Cloudflare equivalent | In this build |
|---|---|---|---|---|
| CDN | Global caching and delivery for every deployment. | 1M requests and 100 GB transfer a month | CDN | Every milestone |
| Image Optimization | On-demand resizing and format conversion through `next/image`. | 5,000 transformations a month | Images | Milestone 2 |
| Firewall and WAF | Custom rules, IP blocks, rate limiting and automatic DDoS mitigation. | 3 custom rules, 3 IP rules, 1M rate-limited requests | WAF | Milestone 9. A rate-limit rule on the MCP and Telegram routes is a cheap addition in Milestone 4. |
| BotID | Invisible bot checks for forms and APIs. | Basic checks | Turnstile and Bot Management | Milestone 9 |
| Domains and DNS | Buying, attaching and managing domains and DNS records, plus redirects and rewrites in routing config. | Included for domains you own | Registrar and DNS | Milestone 10, the cutover rehearsal |
| Deployment Protection | Restricting who can open preview or production deployments. The pricing page does not make Hobby availability clear. | Unclear on Hobby | Access | Milestone 2 layers it on top of the template's own gate |
| Sign in with Vercel | Vercel as an OAuth 2.0 and OpenID Connect identity provider, generally available. | Available | Access as the login in front of your MCP servers | Milestones 3 and 4 |

## Observability and analytics

| Product | What it is and when to reach for it | Hobby | Cloudflare equivalent | In this build |
|---|---|---|---|---|
| Observability | Runtime logs, traces and function metrics in the dashboard, fed by OpenTelemetry through `@vercel/otel`. | 1M tracing span units, 1 hour of runtime logs | Workers Logs and Traces | Milestone 3 |
| Speed Insights | Real-user Core Web Vitals per page. | 10,000 events per 30 days | Web Analytics and Observatory | Milestone 8. Worth turning on for akimbuilds and stagger now, so field data has built up by then. |
| Web Analytics | Privacy-friendly traffic analytics. | 50,000 events a month | Web Analytics | Milestone 8 |
| Drains and Observability Plus | Exporting logs and traces to other tools, and longer retention with deeper queries. | Not on Hobby | Logpush | Optional in Milestone 8 if you keep Pro |

## Frameworks and tools

| Product | What it is | In this build |
|---|---|---|
| Next.js 16 | The React framework, now with Cache Components, Turbopack by default and `proxy.ts`. | Milestone 2 for the template, Milestones 6 and 7 for caching and revalidation |
| Turborepo | Monorepo task runner with remote caching, already enabled on your account. | Milestone 1 |
| `@vercel/sdk` and the REST API | Typed client for everything the dashboard does. | Milestones 2 and 4, inside `vercel-ops` |
| Vercel CLI | Deploys, env vars, logs and `vercel mcp` from the terminal. | Daily use |

## What is most useful to you as a builder

Ranked for someone who already runs 38 Workers and a dozen MCP servers on Cloudflare.

1. **AI SDK with AI Gateway.** These pay off even if you never move a Worker. The AI SDK runs on Cloudflare too, and the Gateway gives you model choice, fallbacks and per-project spend limits in one place. Learn these first, and they make everything else on the agent stack easier.
2. **Workflow SDK.** This is the clearest step up from what you build today. Durable steps and approval hooks replace the hand-rolled state you would otherwise keep in Durable Objects or D1, and the Hermes approval flow you built with signed Telegram links is roughly what hooks give you natively.
3. **Sandbox.** It gives you a safe place to run model-written code and headless browsers, which agents increasingly need and which is awkward on Workers.
4. **Chat SDK.** One bot codebase covers Telegram, Slack and the rest, which matters given how much of your tooling already talks to you through Telegram.
5. **Sign in with Vercel with `mcp-handler`.** Together these are the Vercel-native way to host an OAuth-protected MCP server, the counterpart to your Cloudflare Access setup.
6. **Observability and Speed Insights.** Cheap to turn on and the source of the numbers an SA brings to a customer conversation.

Lower priority for you: Global Config and Queues until Milestones 6 and 7 need them, v0 (useful but its own product with its own plans), and Vercel Agent, Rolling Releases and Observability Plus, which need Pro and are best explored together during the trial.

## How this maps to the SA conversation

Your edge as a Vercel SA candidate is that you can translate fluently between the two platforms. The Workers you know map onto Functions on Fluid compute, R2 onto Blob, KV onto Global Config or a Marketplace Redis, D1 onto a Marketplace database, Workflows and Durable Object state machines onto the Workflow SDK, Cron Triggers onto Cron Jobs, Access onto Sign in with Vercel or Passport, and Cloudflare's AI Gateway onto Vercel's. Vercel publishes its own Cloudflare migration guides, and startups arriving from Cloudflare, Railway, Render or Fly.io are exactly the accounts a startups-focused SA team sees.

## Sources

- [Vercel pricing](https://vercel.com/pricing), read October 7, 2026, for Hobby allowances
- [AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing), for free tier, BYOK and credit rules
- [Sign in with Vercel](https://vercel.com/docs/sign-in-with-vercel)
- [Chat SDK adds Telegram adapter support](https://vercel.com/changelog/chat-sdk-adds-telegram-adapter-support)
- [Vercel Ship 2026 recap](https://vercel.com/blog/vercel-ship-2026-recap), for eve, Connect, Passport and Vercel Agent
- [AI SDK 7](https://vercel.com/blog/ai-sdk-7), [Vercel Workflows](https://vercel.com/docs/workflows), [Edge Config is now Global Config](https://vercel.com/changelog/edge-config-is-now-global-config)
- [Deploy MCP servers to Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel) and [Vercel MCP tools](https://vercel.com/docs/agent-resources/vercel-mcp/tools)
- [Migrate to Vercel from Cloudflare](https://vercel.com/kb/guide/migrate-to-vercel-from-cloudflare)
