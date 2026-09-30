---
issue: 80
issue_title: "Show more information in the `status` diagnostics command regarding the subscription"
---

# Retro: #80 — Show more information in the `status` diagnostics command regarding the subscription

## Stage: Planning (2026-09-29T23:24:55Z)

### Session summary

Planned a per-provider `accounts:` block for `/anthropic-auth:status`, fed by `GET /api/oauth/profile` through `ctx.modelRegistry.getApiKeyForProvider`, with identity behind an opt-in `--account` argument.
The issue is third-party, so direction, provider scope, and identity handling were confirmed with the operator before writing `docs/plans/0080-status-subscription-info.md`.

### Observations

- Measured live on the operator's Max login: the endpoint returns 200 (median 275 ms, n=3), 200 without the `anthropic-beta` header, and 401 for an API-key bearer.
- A personal organization's `name` embeds the account email (`<email>'s Organization`), so the organization name is identifying; this turned the reporter's field list into "plan fields by default, identity opt-in".
- The operator pointed out that users already register several Anthropic accounts, which is likely the real motivation; that moved identity from "never" to the opt-in `--account` argument, and scoped the lookup to every shaped provider.
- `getApiKeyForProvider` (present at the `v0.86.0` floor) refreshes expiring OAuth tokens, so it replaces the reporter's `auth.json` read.
- Dropped the `has_claude_max`/`has_claude_pro` booleans: `organization_type` carries the plan, and both booleans are `false` for a Team seat.
- Workflow friction: explanatory text sent in the same turn as an `ask_user` call was not visible to the operator; send the context as a message, end the turn, then ask.

#### Deferred tidyings

- `src/oauth-transport.ts`: `isAnthropicOAuthToken` lives in the transport module, so `src/account-profile.ts` importing it pulls in the transport's dependencies; move it to a small token module if a cycle or weight becomes a problem.

## Stage: Implementation — TDD (2026-09-30T03:06:04Z)

### Session summary

Implemented all six plan steps as commits (fixtures, formatter split, `src/account-profile.ts`, the `accounts:` block with `--account`, argument completions, docs), then ran the live check.
Tests went from 205 to 234 (+29); `check`, `lint`, and `fallow:dead-code` are clean.

### Observations

- Live check needed no interactive session: `pi -ne -e src/index.ts -p "/anthropic-auth:status"` runs the command headlessly, and the output matched the planning measurements on the operator's Max login (plain and `--account`).
- Deviation: the completions helper lives in `src/diagnostics.ts` as `statusArgumentCompletions`, next to the `--account` constant, rather than inline in `src/index.ts`, so the constant stays module-private.
- The index-registration account-line test passed at Red, because step 4 had already wired the handler; it was kept as a wiring pin and proven by mutating the handler to ignore `ctx.modelRegistry`.
- The identity-gating pins in `test/diagnostics.test.ts` were mutation-checked (forcing `includeIdentity` true, and dropping the gate in `describeProfile`).
- `mockReset` (not `mockClear`) was needed in the diagnostics `beforeEach`, because one test installs a per-provider `mockImplementation`.
- Pre-completion reviewer: PASS, including an independent re-derivation of the privacy invariant (no email or organization name in the default report for any field combination).

## Stage: Final Retrospective (2026-09-30T04:05:51Z)

### Session summary

One session planned, implemented, shipped, and released #80 as v3.4.0: a per-provider `accounts:` block in `/anthropic-auth:status`, with email and organization name behind `--account`.
The design came out of three `ask_user` rounds with the operator on a third-party issue, grounded in live measurements of `/api/oauth/profile`.

### Observations

#### What went well

- Measuring the endpoint live at planning time (six `node -e` probes, well under a minute) found that a personal organization is named `<email>'s Organization`.
  No amount of reading the issue would have shown that, and it turned "show the org name" into "org name is identity, opt-in only".
- Novel: `pi -ne -e src/index.ts -p "/anthropic-auth:status"` runs an extension slash command headlessly and prints its `console.log` output.
  The plan had called the live check "interactive"; the headless form made it a scripted, repeatable step.
- The TDD execution was clean: six commits, each green, with mutation checks on the privacy pins and on the one test that passed at Red.

#### What caused friction (agent side)

- `other` — context sent as message text immediately before a *follow-up* `ask_user` call (no other tool call in between) was not visible to the operator.
  The first `ask_user` after tool calls displayed its preceding context fine; the two calls that came straight after an `ask_user` result did not, and the operator had to say so twice ("Your thinking is hidden", "You did it again").
  User-caught.
  Impact: two wasted dialog rounds and a third turn to deliver the explanation as a plain message.
- `missing-context` — I recommended "never show email", calling the same-plan multi-account case niche, although this repo's own Issue #70 work and README section exist because users register several Anthropic accounts (pi-multi-pass's `anthropic-2`).
  User-caught: the operator pointed out that multi-account users exist and are likely the issue's real motivation.
  Impact: one extra decision round; no rework, since it was caught before the plan was written.

#### What caused friction (user side)

- None of substance; the operator's multi-account note was exactly the strategic context the design needed, and arrived at the right moment.

### Diagnostic details

- **Feedback-loop gap analysis** — `pnpm run check` and the affected test file ran after every step; two lint slips (biome formatting, and an eslint `no-unnecessary-condition` on `init?.headers` in `test/account-profile.test.ts`) were caught only by the pre-commit hook in step 3, costing one failed commit attempt.

### Changes made

1. `.pi/skills/pi-cli-repro/SKILL.md`: added the headless slash-command recipe (`pi -ne -e <path>/src/index.ts -p "/anthropic-auth:status"`).
2. Proposed but not landed, at the operator's call: an `AGENTS.md` rule for context before back-to-back `ask_user` calls; the mechanism is unverified, and same-turn context before a first `ask_user` does work.
