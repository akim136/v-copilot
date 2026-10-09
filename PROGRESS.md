# Progress

## Status — 2026-10-09
- **Milestone:** 1 (plan a POC), phase P2 (poc-core libraries) on branch `m1/p2-poc-core`.
- **Last completed:** P1 merged (PR #2, 13bbfd5): Lighthouse-in-Sandbox and Telegram-gate spikes pass;
  no Vercel deployment from `main`; fixture Pages URLs return 200.
- **Next step:** P2 — allowlist, caps, outline, Lighthouse parsing and medians, baseline cache key, PSI
  client, models, pricing, model wrapper, analyze prompt, zod schemas. Unit tests with mocks only.
- **Blockers:** none. Open decision for Alex: the first Git deploy (feature branch, c48c65e) became the
  production deployment on `v-copilot.vercel.app` (protected; no sensitive vars; `/api/spike` 404s there).
- **Model spend to date:** $0.00. Sandbox use: one prepare session + one 5-run session (~2.5 min, 2 vCPU).

## P1 spike results (2026-10-09)
### Lighthouse in Sandbox — pass
- Default image is Ubuntu 26.04, Node 24, passwordless sudo. `npm i -g lighthouse@13.5.0 playwright@1 &&
  npx playwright install --with-deps chromium` took 36 s; snapshot `snap_lPPlYwCXqDdth3n0ga8azg5WQuN2`
  (no expiry) holds it. A Sandbox from the snapshot is ready in ~2 s.
- 5 mobile runs on `prospect-landing`, 2 vCPU: LCP median 18,400 ms, spread 0.32 % (limit 10 %), ~14 s per
  run, 78 s total. Performance 0.59–0.62, accessibility 0.85, SEO 0.82, CLS 0.093 every run.
- Lighthouse's default simulated throttling (Lantern) models LCP from one trace, which is why the spread is so
  small. Keep 3 runs per spec.
### Telegram button → Workflow hook on a preview — pass
- Card with two buttons delivered; Alex's press resumed the paused run → `completed`, `approve`, user = Alex.
- Second press after completion → hook disposed → `HookNotFoundError` → "already handled"; run unchanged.
- No secret header / wrong secret → 401 (adapter). Valid secret, other user → 200, logged
  `ignored press from non-allowed user`, run stayed `running`. Same forged press with Alex's ID after
  completion reached the handler, so the user-ID check is what stopped the wrong-user press.
- Public `/.well-known/workflow/v1/webhook/spike:<runId>` → 404 `HookNotFoundError`: the route uses
  `resumeWebhook`, which refuses `createHook` tokens. Signed-link fallback not needed.
### Carry into P3
- Posting from a workflow step must `await bot.initialize()` first (memory state is otherwise unconnected).
- A step that sends a message and then throws is retried and re-sends it (Alex got duplicate cards).
  Fixed in P1 for gate cards: step 1 posts the prompt without buttons and checkpoints its message ID,
  step 2 adds the buttons by editing that message ("message is not modified" on a retry = done), so a
  run never has two pressable cards. Reuse this pattern for both M1/M2 gates.
- Telegram webhook URL = branch alias + `?x-vercel-protection-bypass=…`; the secret is in
  `apps/web/.env.local` as `VERCEL_AUTOMATION_BYPASS_SECRET`. It still points at the `m1/p1-spikes`
  alias; re-point it at the P3 branch alias.
- From codex round 5 (deferred, non-blocking): route tests for a wrong-user press, an invalid run ID
  and the reject mapping; give the `spikes` workspace a typecheck and lint script.

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
