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
