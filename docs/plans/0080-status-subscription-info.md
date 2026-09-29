---
issue: 80
issue_title: "Show more information in the `status` diagnostics command regarding the subscription"
---

# Show per-provider subscription info in `/anthropic-auth:status`

## Release Recommendation

**Release:** ship independently

Issue #80 is not part of any `docs/architecture.md` roadmap step or release batch; it is a self-contained user-facing feature.

## Problem Statement

`/anthropic-auth:status` confirms that the extension loaded and which providers it shapes, but says nothing about the Anthropic subscription behind each provider's stored OAuth login.
Users with several Anthropic logins registered (pi-multi-pass's `anthropic-2` and friends) cannot tell from inside pi which account a provider's token belongs to, or what plan, rate-limit tier, and extra-usage setting that account has.
The claude.ai website cannot answer this either: it shows the account signed in to the browser, not the account that issued the token pi stored.
The third-party reporter proposed calling `GET https://api.anthropic.com/api/oauth/profile` and printing the email, organization name, seat tier, rate-limit tier, extra-usage flag, and Max/Pro flags.

## Goals

- Add an `accounts:` block to `/anthropic-auth:status` with one line per shaped provider (`anthropic` plus every config-named extra provider).
- By default, show only non-identifying plan fields, so a pasted report stays safe to share in a GitHub issue.
- Add an opt-in `--account` argument that also shows the account email and organization name per provider.
- Never fail the status command because of the lookup: a non-OAuth credential, a missing credential, an HTTP error, a timeout, or an unparseable body each become a short line in the report.
- Not breaking: the report gains a block; every existing line is unchanged.

## Non-Goals

- Usage or quota figures (Anthropic's separate `/api/oauth/usage` endpoint); nobody asked, and it is a different surface.
- Showing identity by default or in masked form (operator decision, see Design Overview).
- The Max/Pro booleans (`has_claude_max`, `has_claude_pro`): `organization_type` (`claude_max`, `claude_pro`, `claude_team`, ...) already carries the plan, and for a Team seat both booleans are `false`, which misleads.
- Moving `isAnthropicOAuthToken` out of `src/oauth-transport.ts` into a lighter module (see Deferred tidyings in the retro).
- Any change to request shaping; the profile call is diagnostics only.

## Background

- `src/diagnostics.ts` owns `ExtensionDiagnostics` (synchronous load-time facts plus `shapedProviders` and `configWarnings`), `formatDiagnosticsReport`, and `createStatusCommandHandler`, which routes the report to `ctx.ui.notify` or `console.log`.
  `StatusCommandContext` is a narrow ISP subset of `ExtensionCommandContext`, so the handler stays free of the Pi SDK.
- `src/index.ts` registers the command with `createStatusCommandHandler(readDiagnostics)`; `readDiagnostics` is read per invocation because project-layer providers arrive at `session_start`.
- `src/oauth-transport.ts` exports `isAnthropicOAuthToken`, the `sk-ant-oat` gate the transport already uses.
- Pi's `ExtensionCommandContext.modelRegistry.getApiKeyForProvider(provider)` is exported from the installed `dist/core/model-registry.d.ts` (pi 0.99.1) and present at the `v0.86.0` peer floor.
  It resolves through `ModelRuntime.getAuth` -> pi-ai `resolveProviderAuth`, which refreshes an OAuth credential that expires within five minutes under pi's credential lock, and returns `undefined` on any failure.
  That is better than reading `auth.json` as the reporter's snippet does: it refreshes, honors `PI_CODING_AGENT_DIR`, and works for any provider name.
- `RegisteredCommand.getArgumentCompletions` exists at the `v0.86.0` floor, so `--account` can be offered as a completion.
- AGENTS.md "Keep The Override Thin" governs request shaping, not diagnostics; the Issue #70 README section already routes multi-account users to this command.

### Measurements (2026-09-29, operator's Max login)

All measured live with `node` against the real endpoint:

1. `GET /api/oauth/profile` with `Authorization: Bearer <sk-ant-oat…>` returns 200 with `account`, `organization`, `application`, `enabled_plugins`, the same shape the issue shows.
2. The request also returns 200 without the `anthropic-beta: oauth-2025-04-20` header; we send it anyway, matching the reporter and Claude Code.
3. Latency: 267, 275, 316 ms (median 275 ms, n=3).
4. An API-key-shaped bearer returns 401 `authentication_error`, so the `sk-ant-oat` gate must skip the call rather than rely on the server.
5. For a personal Max account, `organization.name` contains the account email (`<email>'s Organization`), so the organization name is as identifying as the email.
6. Fields on that account: `organization_type: claude_max`, `rate_limit_tier: default_claude_max_20x`, `seat_tier: null`, `has_extra_usage_enabled: false`, `subscription_status: active`.

## Design Overview

### Operator decisions

The issue is third-party, so the direction was confirmed with the operator:

1. Surface plan fields in the status report, without identity, by default.
2. Look up every shaped provider, not only `anthropic`: users already register several accounts, and telling them apart is likely the underlying motivation.
3. Identity (email, organization name) is available through an opt-in `--account` argument, so the default report stays pasteable (measurement 5 rules out the organization name by default).

### Data shapes

```typescript
// src/account-profile.ts
export interface AccountProfile {
  organizationType: string | null;
  rateLimitTier: string | null;
  seatTier: string | null;
  subscriptionStatus: string | null;
  hasExtraUsageEnabled: boolean | null;
  email: string | null;
  organizationName: string | null;
}

export type AccountLookup =
  | { kind: "not-oauth" }
  | { kind: "unavailable"; reason: string }
  | { kind: "profile"; profile: AccountProfile };

/** The one `ModelRegistry` method the lookup reads. */
export interface ProviderCredentials {
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
}

export function lookupProviderAccount(
  provider: string,
  credentials: ProviderCredentials,
): Promise<AccountLookup>;
```

`lookupProviderAccount` never throws:

1. `getApiKeyForProvider` returns `undefined` or a non-`sk-ant-oat` key: `not-oauth`, with no network call.
2. The fetch rejects (network, `AbortSignal.timeout(5000)`): `unavailable` with `timeout` or the error message.
3. A non-2xx status: `unavailable` with `HTTP <status>`.
4. A body that is not a JSON object: `unavailable` with `unexpected response`.
5. Otherwise, `profile`, parsed tolerantly: each field is read only when it has the expected primitive type, else `null`.

The parser reads only the seven fields above, so the rest of the response (UUIDs, billing type, invoice URL) never enters the process's data model.

### Handler flow

`ExtensionDiagnostics` stays synchronous and unchanged; account data is fetched per invocation and passed alongside it.

```typescript
// src/diagnostics.ts, inside createStatusCommandHandler
return async (args, ctx) => {
  const diagnostics = readDiagnostics();
  const includeIdentity = args.trim().split(/\s+/).includes("--account");
  const accounts = await lookupAccounts(shapedProviderNames(diagnostics), ctx.modelRegistry);
  emitReport(formatDiagnosticsReport(diagnostics, { accounts, includeIdentity }), ctx);
};
```

`StatusCommandContext` gains `modelRegistry: ProviderCredentials`; the real `ExtensionCommandContext` stays structurally assignable, so `src/index.ts` needs no cast.
Lookups run with `Promise.all`, so the added wall time is roughly one profile round trip (measured median 275 ms) regardless of provider count.
Unknown arguments are ignored; a typo only omits identity, which is the safe direction.

`formatDiagnosticsReport(d, accounts?)` keeps its current output when `accounts` is omitted, so existing formatter tests stay valid.

### Report shape

Default:

```text
pi-anthropic-auth diagnostics
  version: 3.4.0
  module:  /root/.pi/agent/.../src/index.ts
  built-in Anthropic transport: resolved
  shaped providers: anthropic, anthropic-2 (global)
  accounts:
    anthropic: claude_max, rate limit default_claude_max_20x, subscription active, extra usage off
    anthropic-2: claude_team, seat team_standard, rate limit default_raven, subscription active, extra usage on
```

With `--account`, each profile line is prefixed with identity:

```text
    anthropic: user@example.com (user@example.com's Organization), claude_max, ...
```

Other outcomes:

```text
    anthropic: no OAuth login
    anthropic-2: unavailable (HTTP 401)
```

`null` fields are omitted from the line rather than printed as `null`.
The exact wording is settled in the formatter tests, which pin markers (`/anthropic: claude_max/`, `/extra usage off/`) rather than whole lines.

### Edge cases

- A provider logged in with an API key: `no OAuth login`, no request (measurement 4).
- An expired token that pi cannot refresh: `getApiKeyForProvider` returns `undefined`, reported as `no OAuth login` too, since the two are indistinguishable through this API; the README says so.
- Headless `-p` runs: the same `console.log` path; the network call still runs.
- The default report must contain no `email` and no `organizationName` value: a test asserts the fixture's email and organization name are absent.

## Module-Level Changes

1. `src/account-profile.ts` (new): `AccountProfile`, `AccountLookup`, `ProviderCredentials`, `lookupProviderAccount`, the tolerant parser, and the endpoint/beta/timeout constants.
2. `src/diagnostics.ts`: `formatDiagnosticsReport` split into per-section helpers (tidying), then an `accounts` section and `includeIdentity`; `StatusCommandContext` gains `modelRegistry`; `createStatusCommandHandler` becomes `async`, parses `--account`, runs the lookups, and emits through an extracted `emitReport`.
3. `src/index.ts`: command `description` mentions subscription info and `--account`; add `getArgumentCompletions` offering `--account`; update the comment above `registerCommand`.
4. `test/account-profile.test.ts` (new): the lookup's outcomes, with `globalThis.fetch` stubbed.
5. `test/diagnostics.test.ts`: shared `createStatusContext` fixture (tidying), then account formatting, identity gating, and handler wiring.
6. `test/index-registration.test.ts`: shared `createCommandContext` helper replacing the three inline handler contexts (lines 499, 625, 701), defaulting `modelRegistry.getApiKeyForProvider` to `undefined` so no test reaches the network.
7. `README.md`: the Troubleshooting "Verify the extension is loaded" sample gains the `accounts:` block and a sentence on `--account` and why identity is opt-in; the "Another Anthropic provider fails" section can point at the `accounts:` line for which account a provider uses.
8. `docs/architecture.md`: module-layout list gains `src/account-profile.ts`; the `src/diagnostics.ts` bullet mentions the account lookup.
9. `AGENTS.md`: Local Files list gains `src/account-profile.ts`; the `src/diagnostics.ts` entry mentions accounts; Coverage areas gains `test/account-profile.test.ts`.
10. `.pi/skills/anthropic/SKILL.md`: "0. Confirm the extension is loaded" mentions the `accounts:` block and `--account`.

## Test Impact Analysis

1. New tests enabled: `lookupProviderAccount` is a pure function of a credentials fake and `fetch`, so each outcome (not-oauth, HTTP error, rejection, timeout, malformed body, tolerant field parsing) is unit-testable without pi.
2. Redundant tests: none; the existing formatter and handler tests cover lines this change leaves intact.
3. Kept as-is: the `index-registration` status tests genuinely exercise registration and `readDiagnostics` wiring; they only switch to the shared context helper.

## Invariants at risk

- Status reports reflect state at call time (Issue #70, "reads the diagnostics when invoked, not when created" in `test/diagnostics.test.ts`): the async handler must still call `readDiagnostics()` per invocation; the existing test pins it.
- `anthropic` is always listed first and extras carry their layer (`index-registration` "lists the named provider with its layer"): unchanged, pinned by the existing tests.
- No test may reach the network: the shared context helpers default to a credentials fake returning `undefined`, which short-circuits before `fetch`.

## TDD Order

1. `test:` add a shared `createStatusContext(overrides)` fixture to `test/diagnostics.test.ts` and a `createCommandContext()` helper to `test/index-registration.test.ts`, replacing the seven inline handler contexts (4 + 3, counted by `grep -n "hasUI:"`).
   Prepares the `StatusCommandContext` widening, which would otherwise touch seven literals in the behavior commit.
   Commit: `test: share status command context fixtures`.
2. `refactor:` split `formatDiagnosticsReport` into per-section helpers (`formatShapedProviders`, alongside the existing `formatConfigWarnings`), and extract `emitReport(report, ctx)` from the handler; output byte-identical, existing tests green.
   Prepares the `accounts:` block as a sibling helper and keeps the async handler body to parse, lookup, format, emit.
   Commit: `refactor: split status report sections into helpers`.
3. Red→green `test/account-profile.test.ts`: `not-oauth` for `undefined` and for an API key (asserting `fetch` is not called); the request's URL, `Authorization`, and `anthropic-beta` headers; `unavailable` for a non-2xx, a rejected fetch, a timeout, and a non-object body; tolerant parsing that nulls mistyped fields and ignores unread ones.
   Commit: `refactor: add Anthropic OAuth account profile lookup` (no consumer yet).
4. Red→green `test/diagnostics.test.ts`: `formatDiagnosticsReport` renders the `accounts:` block for each outcome, omits `null` fields, omits the block when `accounts` is absent, and excludes the email and organization name unless `includeIdentity`; the handler passes `anthropic` plus shaped-provider names to the lookup, honors `--account`, and still reads diagnostics per call.
   Widen `StatusCommandContext`, make the handler async, and give the step-1 helpers their `modelRegistry` default in the same commit.
   Commit: `feat: show per-provider subscription info in /anthropic-auth:status (#80)`.
5. Red→green `test/index-registration.test.ts`: the registered command offers `--account` from `getArgumentCompletions`, and a status run with a fake OAuth credential and stubbed `fetch` shows an `accounts:` line for `anthropic`.
   Update the command description and comment in `src/index.ts`.
   Commit: `feat: offer --account completion for /anthropic-auth:status`.
6. Docs: `README.md`, `docs/architecture.md`, `AGENTS.md`, `.pi/skills/anthropic/SKILL.md` per Module-Level Changes.
   Commit: `docs: document status account lines and --account (#80)`.
7. Live check: `pi --model anthropic/claude-haiku-4-5 -ne --no-session -e /Users/chris/development/pi/pi-anthropic-auth/src/index.ts` interactively, run `/anthropic-auth:status` and `/anthropic-auth:status --account`, and confirm the accounts lines against the measurements above (no commit).

## Risks and Mitigations

- The profile endpoint is undocumented and may change shape: the tolerant parser degrades each missing field to omission, and a non-object body to `unavailable`, never an exception.
- A slow endpoint stalls the command: `AbortSignal.timeout(5000)` bounds it, and lookups run in parallel.
- Leaking identity in pasted reports: identity is opt-in, and a test asserts the default report omits the fixture's email and organization name.
- The status run now refreshes an expiring token as a side effect: this is the same refresh pi performs before any request, under pi's own lock.
- A test accidentally hitting the network: the shared fixtures default to no credential, and the index test that exercises the account line stubs `globalThis.fetch`.

## Open Questions

- If users ask for quota figures, `/api/oauth/usage` is the candidate; not filed until someone asks.
