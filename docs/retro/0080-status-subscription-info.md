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
