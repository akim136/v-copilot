# Progress

## Status — 2026-10-07
- **Milestone:** 1 (plan a POC), phase P0 (scaffold + fixtures).
- **Last completed acceptance criterion:** none of M1's yet (P0 is groundwork). Done in P0: monorepo,
  `targets.config.json` with schema + tests, four prospect fixtures with deterministic build and
  structure tests, CI and GitHub Pages workflows, `CLAUDE.md`, friction log.
- **Next step:** P1 spikes — Lighthouse in Sandbox (5 runs, LCP spread ≤10%) and Telegram button →
  Workflow hook resume on a preview deployment (incl. whether `/.well-known/workflow/v1/webhook/[token]`
  can resume `createHook` tokens).
- **Blockers:** none. Alex adds sensitive env vars to the `v-copilot` Vercel project himself.
- **Model spend to date:** $0.00.

## Investigation record (kickoff steps 2–8)
- Package versions confirmed from npm on 2026-10-07:
  workflow 5.1.0, ai 7.0.130, @vercel/sdk 1.28.41, @vercel/sandbox 3.5.1, @vercel/blob 2.8.1,
  chat + @chat-adapter/telegram 4.41.1, lighthouse 13.5.0, zod 4.6.5, next 16.4.0.
- Models: no dated snapshots exist; pinned `openai/gpt-5.6-terra` and `openai/gpt-5.6-luna`
  (released 2026-07-09). Prices per 1M: terra $2.00 / $0.20 cached / $12.00 out; luna $0.20 / $0.02 /
  $1.20; cache write 1.25× input; >272K input priced higher (we refuse such prompts).
- Hobby limits differing from the spec: Sandbox 45-min max session and 4 vCPU; Fluid 300 s max
  duration; Workflow storage retention not available; cron hourly precision; Deployment Protection
  (Vercel Authentication) is available on Hobby.
