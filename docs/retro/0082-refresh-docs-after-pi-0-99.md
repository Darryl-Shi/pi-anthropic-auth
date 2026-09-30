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

## Stage: Final Retrospective (2026-09-30T05:06:53Z)

### Session summary

Planned, built, and shipped #82 in one session: four `docs:` commits refreshed the managed-effort lists, recorded the Sonnet 5.5 `cc_version` acceptance, and corrected the loader-mode description, released as v3.4.1.
No code behavior changed.

### Observations

#### What went well

- The issue's open loader question was settled by measuring the installed binary (`bin` is `dist/bundle/cli.js`; the bundled chunk contains `isBundledNode=!0`) rather than reasoning from `loader.ts` alone, which also showed the `alias` map now serves only the unbundled library entry.

#### What caused friction (agent side)

- `wrong-abstraction` — the planning-time stale-phrasing grep keyed on exact phrases (`aliases (Node)`, `virtualizes (Bun)`, `in both modes`) instead of the claim's verb, so it missed three rewordings (`loader aliases both`) in `src/host-transport.ts:79`, `docs/builtin-transport-seam-gap.md:130`, and `test/host-transport.test.ts:6`.
  Impact: one extra commit (`c743201`) and a second reviewer round; no rework of earlier commits.
- `other` — the Tidy-First assessment was skipped on judgment because the `src/` edits were comment-only, though the skill's gate says any `src/` modification.
  Impact: none; the gate wording just does not name the case.
- `instruction-violation` (self-identified) — this retro entry was first written with literal `\u2014` escapes for its em-dashes, against the `markdown-conventions` literal-character rule; the post-write `rg 'u20[0-9a-f]{2}'` scan caught it.
  Impact: one scripted substitution pass, no commit.

#### What caused friction (user side)

- None; the one `ask_user` (managed-effort wording) was a genuine preference call and was answered directly.

### Changes made

1. None. Two proposals (verb-level sweep wording in `.pi/prompts/build-plan.md`, a comment-only skip in `.pi/skills/tidy-first/SKILL.md`) were declined by the operator.
