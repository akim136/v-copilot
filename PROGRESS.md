# Progress

## Status — 2026-10-10
- **Milestone:** 1 (plan a POC), phase P4 (live checks + close-out) on branch `m1/p4-live`. P3 merged as PR #4.
- **Last completed criterion:** all M1 Verify checks passed live (2026-10-10, 22:41–23:37 UTC):
  - Preview run wrun_41M4KZM4PK0GSP3DHSTTSSBTE4 on `prospect-landing`: baseline from the day's cache (no
    Sandbox), `analyze` 13 s (structured, no tools, 4 criteria), one card with two buttons, paused until a press.
    A forged press from another user ID (valid secret header) → `ignored press from non-allowed user`, run
    still paused. Alex's Approve → `planned`. A second Approve as Alex after the gate closed → 200, run not
    resumed. Cost $0.0289 = tokens × `pricing.ts`.
  - Run wrun_41M4M0K7XT0GJVWYRK8Z7V88QF (same prompt): 4,435 of 4,438 input tokens read from the prompt cache,
    $0.0205. Alex's Reject → report `rejected`/`criteria_rejected`; the run then failed its index write (below).
  - Local record run wrun_01M4M1KVZEH14Z6M06YV742W2Z and replay run wrun_01M4M1N99W625W5S5CM7RV2VSX:
    `comparableReport` equal, analysis and gate equal, replay span `mode: replay`, analyze step 35 ms, no new
    recording; both $0.022553 = tokens × `pricing.ts`.
  - Kill test, local run wrun_01M4M1Q7NGKSWP7P1TKF7TBVM4 on `prospect-docs`: dev server killed 0.3 s into
    `analyze`, restarted; `startSandboxStep` and the three `lighthouseStep`s each started once (event log);
    `analyze` re-ran after its 860 s inline lease, approved with `pnpm poc approve` → `planned`, $0.2411
    (the killed attempt charged its worst case, $0.2258; its request had reached OpenAI, since the re-run read
    4,066 of 4,069 tokens from the cache). The run's Sandbox was deleted and left no snapshot.
  - Secret scan of every P4 run object, the index, the recording, runtime and dev logs: zero matches for the
    six secrets in the env files.
- **P4 fixes (on `m1/p4-live`):** 46bc905 steps called as plain functions; 1e426e1 model errors keep the
  gateway's reason; 2744924 run Sandbox `persistent: false` and deleted; 4a603bc index writes use the strong
  etag (`get()` returns `W/"…"` once the object is compressed at 1 KB, so every guarded write conflicted);
  `instrumentation.ts` starts the Local World so a killed dev server's runs are re-queued; P1 spike gate removed.
- **Next step:** codex-review and the P4 PR, then the M1 report and Alex's confirmation before Milestone 2.
- **Blockers:** none. BYOK works on akim-projects after Alex's $10 Gateway top-up.
- **Open for Alex:** delete the four disposable Sandbox snapshots (only `snap_lPPlYw…` is needed; they expire in
  ~30 days); remove `MODEL_MODE` for branch `m1/p3-workflow` (optional); production deployment c48c65e is still
  the first Git deploy (protected, no sensitive vars). Decide whether a failed index write should block new runs:
  today the alert fires but that run's spend is missing from the 24-hour total until its row is written (run
  …88QF's row was added by hand).
- **Model spend to date:** $0.087 measured over four completed calls ($0.0289, $0.0205, $0.0226, $0.0153), plus
  the killed attempt, charged $0.2258 worst case (actual unknown). BYOK bills Alex's OpenAI project directly;
  Gateway credits are untouched (`/v1/credits`: balance 15, used 0). The index carries $0.79 over 24 hours,
  including $0.46 of worst-case charges for the two calls the gateway refused before the top-up and the replay
  run's recorded $0.0226.
- **Deferred (minor):** the worst-case span for a killed attempt carries the run-level `attempt` (1), the same
  as the live span after it; `mutate.py` M14 predates the Sandbox delete.

## P3 decisions (for the PR)
- Spend: the 24-hour spend is read in its own step right before each analyze call, and an analyze attempt
  that did not return is charged its worst case (it may have paid). In-flight runs are still invisible to
  other runs' 24-hour check until they end (plan design choice 2); each is bounded by its $1.50 cap.
  Reserving spend per call would need a write before every model call; not done. A runtime retry of the
  analyze step reuses the reading taken just before it (seconds old; still bounded by the per-run cap).
- Plan-mode Reject at the criteria gate ends `rejected` with `rejectReason: criteria_rejected`.
- A not-allowlisted request is reported under `pocs/_unlisted/<runId>/` and indexed with target
  `_unlisted`; an allowlisted run that fails later keeps its target name.
- `/api/poc` approve/reject works on previews with the admin token plus the protection bypass secret,
  for the local-world and kill-the-dev-server tests. Replace it with `approve_poc_gate` before M2's
  approval starts a build.
- Lighthouse results are refused unless `mainDocumentUrl` (else `finalDisplayedUrl`) is the target URL
  (Chrome follows redirects that intake refuses). Lighthouse still runs with `sudo`, as in the P1 spike.
- The `pnpm poc` CLI sends its secrets only to localhost or an `https://v-copilot-*-akim-projects.vercel.app`
  deployment, and refuses redirects.
- A not-allowlisted run whose report write fails stays `rejected` (a report for an unlisted target can be
  nothing else); any run whose report write fails sends the alert.
- Spec wording only, in Decisions: callback data carries "the run ID" (the full ID, 53 of 64 bytes), not
  "a short run ID".
- Deferred: give the `spikes` workspace a typecheck script; `alertStep` and the card post can
  repeat on a step retry (rare; the card pattern keeps only one pressable card).

## P2 decisions (for the PR)
- Outline gains `order` (all IDs in document order, needed by fidelity's order component); spec updated.
- PocReport: `kind`/`permission` absent only on a `not_allowlisted` rejection; `baseline` required from
  `planned` on; `rejectReason` set exactly when `rejected` (enforced by the schema); spec updated.
- A model call that fails without usage (timeout, 5xx, missing usage) is charged its worst case: input
  upper bound at the cache-write rate plus 16K output (≤ $0.87 on terra). Fail-closed reading of "caps are
  never bypassed"; Alex can choose zero instead. SDK retries are off: a retry is a new, cap-checked call.
- The 24-hour check also runs before every model call (plan, design choice 2); a run stopped mid-way by it
  will end `failed` in P3, with the cap alert the spec's Observability section requires. Index rows are written when a run ends, so other
  in-flight runs are invisible to it; each is bounded by its own $1.50 cap.
- Criteria baselines are owned by code (the measured median), not the model.
- The baseline cache object (`cache/baseline/<hash>/<date>.json`) is per URL per day, outside a run's
  four Blob objects.

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
- From the P2 review (deferred to the step that uses them):
  - Extract the outline's script sizes after `baseline` (`LighthouseRun.scriptBytes`, kept in the cached
    Baseline); intake runs first and can't know them.
  - Reconcile analyze's sections and opportunities in code before the Telegram card: drop IDs not in
    `outline.order`, at most six opportunities, clip titles and details. Escape all model text in the card.
  - Intake fetches with `redirect: 'manual'` (or re-checks `res.url`) so `isWithinTarget` holds after
    redirects; it downloads image bytes for `imageDimensions`.
  - M2: an empty criteria list must never count as success; backstop `CAPS.fixAttempts` in the fix step.
  - M3: subpath exports so a client bundle importing poc-core never pulls `node:` built-ins.

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
