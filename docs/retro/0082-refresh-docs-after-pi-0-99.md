---
issue: 82
issue_title: "docs: refresh managed-effort model lists and loader modes after pi 0.99"
---

# Retro: #82 — docs: refresh managed-effort model lists and loader modes after pi 0.99

## Stage: Planning (2026-09-30T04:37:14Z)

### Session summary

Planned a comments-and-prose refresh in three `docs:` commits: managed-effort wording, the Sonnet 5.5 `cc_version` acceptance, and the loader-mode correction.
The operator chose "flag + dated list" wording, naming `compat.supportsMidConvoEffort` first.
The plan runs under `/build-plan`, since it has no test cycles.

### Observations

- The loader question in the issue resolved decisively: the npm `pi` bin has been `dist/bundle/cli.js` (`isBundledNode=!0`) since v0.84.3, so npm installs take the embedded `virtualModules` path, not the `alias` map.
  The alias map only serves the unbundled `dist/index.js` library entry.
- The same stale claim recurs beyond the issue's list: "aliases (Node) / virtualizes (Bun)" in `src/host-transport.ts` (two comments), `docs/architecture.md`, `docs/builtin-transport-seam-gap.md`, and `AGENTS.md`, plus "in both modes" twice; all are folded into the plan.
- The Sonnet 5.5 measurement is recorded as an acceptance at 2.1.280, not a floor.
- Tidy-First assessment was skipped: the `src/` edits are doc comments only, with no structure to prepare.

## Stage: Implementation — Build (2026-09-30T04:44:47Z)

### Session summary

Executed all three plan steps as `docs:` commits (managed-effort wording, Sonnet 5.5 acceptance, loader modes), plus one follow-up sweep commit.
Only comments and prose changed; `check`, `lint`, and all 234 tests stayed green.

### Observations

- Deviation: the plan's stale-phrasing grep keyed on "aliases (Node)" and "in both modes", so it missed the variant "loader aliases both", in a third `src/host-transport.ts` comment (caught by the final sweep), `docs/builtin-transport-seam-gap.md:130`, and `test/host-transport.test.ts:6` (caught by the reviewer).
  A wording sweep should grep the verb (`loader aliases`), not only the exact phrase.
- Pre-completion reviewer: WARN in round 1 (the `seam-gap` residual), PASS on the delta after `c743201`.
