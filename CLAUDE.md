# v-copilot — session primer

Start every session by reading this file and `PROGRESS.md`. Reopen `v-copilot-plan.md` and
`v-copilot-spec.md` only for the milestone in progress. The spec's Decisions section is settled.
Work one milestone at a time, keep each session small, and leave the repo green.

## Sources of truth
- `v-copilot-plan.md` — milestones and acceptance criteria.
- `v-copilot-spec.md` — decisions, data model, interfaces, Hobby limits.
- `vercel-product-map.md` — product context.
- `PROGRESS.md` — last completed criterion, next step, blockers, model spend.
- `docs/friction-log.md` — Vercel product friction, spec format.

## Pinned constraints (never violate)
- Accounts: only Vercel team `team_J4ZFzFIZLMWznfsoWdG8nuV1` (akim-projects), Alex's personal OpenAI
  project, GitHub `akim136`, the v-copilot Telegram bot. Never Homebase, Hermes Workers/D1/bot.
  Verify `vercel whoami` and the team before any Vercel write.
- Never write to the akimbuilds or stagger Vercel projects. Never promote, attach a domain to,
  weaken the gate of, or delete a `poc-*` project. Only delete deployments in `poc-*`, keep newest ten.
- `apps/web` stays on preview deployments; Alex promotes it himself.
- Check `targets.config.json` and the 24-hour spend ceiling before any fetch, Sandbox or model call.
- Models only in `analyze`, `page_spec`, `fix`, report summary and honesty check. Structured output,
  no tools, page content inside delimited untrusted-data blocks, outline never raw HTML.
- Models via AI Gateway + BYOK through Vercel OIDC: `openai/gpt-5.6-terra` (analyze, page_spec, fix),
  `openai/gpt-5.6-luna` (summary, honesty). No model key in env, code, traces or recordings.
- Caps: stop a run before its next model call past $1.50; refuse new runs at $8 in 24h; fix loop max
  3; live eval max $5; fidelity gate 0.9. Never bypass, including in tests.
- Verdicts and success are computed in code. Visual similarity never gates anything.
- Gates are Workflow hooks; Telegram press accepted only with valid secret header and Alex's user ID;
  each gate resumes at most once.
- Blob: ≤4 objects per run + `runs/index.json`; never list Blob on page load or in the health job.
  No database except the Neon auth store (M3).
- Tests never make live model, Vercel or Sandbox calls.
- `pnpm eval:live` only when Alex starts it, never in CI.

## Layout
`apps/web` (Next.js 16 + Workflow SDK), `packages/poc-core` (pure logic), `packages/vercel-ops` (M2),
`packages/poc-template` (M2), `fixtures/prospects` (GitHub Pages test pages), `evals/`, `recordings/`.

## Commands
- `pnpm install`
- `pnpm turbo build typecheck lint test --force` — full check, bypasses cache
- `pnpm --filter @v-copilot/fixtures build:pages` — build fixtures into `fixtures/prospects/dist`
- `pnpm --filter @v-copilot/web dev` — local dev (Local World in `apps/web/.workflow-data/`)
- `pnpm poc start <target> --brief "..." --mode plan` — start a run (M1·P3)

## End of every session
Update `PROGRESS.md` (last completed criterion, next step, blockers, model spend to date) and add a
`docs/friction-log.md` entry for anything a Vercel product made harder than expected.
