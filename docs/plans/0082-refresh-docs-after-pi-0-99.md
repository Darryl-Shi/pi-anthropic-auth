---
issue: 82
issue_title: "docs: refresh managed-effort model lists and loader modes after pi 0.99"
---

# Refresh managed-effort lists, Claude Code floors, and loader modes after pi 0.99

## Release Recommendation

**Release:** ship independently

The issue is not part of any roadmap batch.
The edits touch `src/` doc comments and `docs/*.md` reference docs, both inside the release scope, so the `docs:` commits cut a patch release even though no behavior changes.

## Problem Statement

The pi 0.86.0 → 0.99.1 assessment left several statements stale that agents read before reasoning about upstream.
Pi 0.99.0 added Claude Sonnet 5.5 (`claude-sonnet-5-5`) as a managed-effort model, but three places still enumerate the managed-effort models as "Fable 5.1, Opus 5, Opus 5.5".
The Claude Code version notes record the Fable 5.1 and Opus 5.5 floors but not the live measurement that Sonnet 5.5 accepts `cc_version=2.1.280`.
The "Verify Each Loader Mode" gotcha says built Node resolves extensions through the `alias` map, while the loader actually takes the embedded-module path for the bundled Node distribution, which is what the npm `pi` bin runs.

## Goals

- Name `compat.supportsMidConvoEffort` as the source of truth for managed-effort models everywhere a list appears, followed by a dated list (operator's choice: "flag + dated list").
- Record that `claude-sonnet-5-5` accepts `cc_version=2.1.280` on pi 0.99.1, alongside the known Fable 5.1 and Opus 5.5 floors.
- Correct the loader-mode description to match `packages/coding-agent/src/core/extensions/loader.ts`, and sweep the same stale "aliases (Node) / virtualizes (Bun)" phrasing wherever it recurs.
- Not breaking: comments and prose only.

## Non-Goals

- Any code or test behavior change.
  `test/managed-effort-drift.test.ts` already enumerates models by the flag (Issue [#81]), so it needs no edit.
- Adding a loader-mode row to the `upstream-watch` watchlist.
- Rewriting the historical Issue #31 narrative ("failed under `pi install` / the Bun binary"), which describes what happened at the time and stays accurate.
- Verifying the peer floor in CI (Issue [#56]).

## Background

Facts established at planning time (all measured, not inferred):

1. Enumerating `getBuiltinModels("anthropic")` from the installed pi-ai 0.99.1 shows exactly four models with `compat.supportsMidConvoEffort`: `claude-fable-5-1`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5-5`.
2. In the upstream clone (`v0.99.1-9`), `loader.ts` computes `usesEmbeddedModules = isBunBinary || isNodeSeaBinary || isBundledNode` and picks:
   - embedded: `{ virtualModules, tryNative: false }`,
   - else TypeScript source: `{ virtualModules, tsconfigPaths: true }`,
   - else `{ alias: getAliases() }`.
3. `isBundledNode` is `PI_BUNDLED_NODE`, defined `true` only by `scripts/build-coding-agent-bundle.mjs`.
   The bundle landed in commit `7d4c0e05d` ("bundle Node runtime"), first tagged in v0.84.3, and the package's `bin` has been `dist/bundle/cli.js` from v0.86.0 through v0.99.x.
4. The operator's own `pi` is a global npm install under Homebrew's node prefix (`/opt/homebrew/lib/node_modules/...`, no Homebrew formula), whose bin is `dist/bundle/cli.js`; its bundled chunk contains `isBundledNode=!0`.
   So every supported npm install takes the embedded `virtualModules` path, and every live repro in this repo has validated that path.
5. The `alias` map now applies only to the unbundled `dist/index.js` library entry (SDK embedders running the loader themselves).
6. No release script builds a Node SEA binary (`scripts/build-binaries.sh` builds Bun executables only); the SEA check is defensive.
7. Both `virtual-modules.ts` and `getAliases()` map the bare `@earendil-works/pi-ai` specifier and `/compat` to pi-ai's compat entrypoint, so `src/host-transport.ts` is unaffected.
8. The Sonnet 5.5 measurement (accepts `cc_version=2.1.280`, no rejection, no recovery retry, pi 0.99.1 binary) comes from the issue body, filed by the operator.
   It shows the floor, if any, is at or below 2.1.280; it does not name a floor.

## Design Overview

### Managed-effort wording

Each mention names the flag first and the models second, with the pi version the list was read from:

```text
managed-effort models (those pi-ai flags `compat.supportsMidConvoEffort`; as of pi 0.99.1: Fable 5.1, Opus 5, Opus 5.5, Sonnet 5.5)
```

Adapt the phrasing to each sentence; the three sites are an architecture list item, a skill bullet, and a JSDoc block.

### Claude Code floors

Add a third sentence after the Opus 5.5 floor, worded as an acceptance rather than a floor:

```text
Claude Sonnet 5.5 (`claude-sonnet-5-5`, added in pi-ai 0.99.0) accepts 2.1.280 with no rejection and no recovery retry (measured live on pi 0.99.1).
```

Mirror it compactly in the `src/claude-code-version.ts` "Known floors" comment.

### Loader modes

Rewrite the "Verify Each Loader Mode" list around the three resolution configurations the loader actually chooses, keyed by condition rather than by install type:

1. Embedded modules (Bun binary, Node SEA binary, or the esbuild-bundled Node distribution): `virtualModules` with `tryNative: false`.
   The npm `pi` bin has run the bundled Node distribution since pi 0.84.3, so npm installs take this path; no pi release builds a SEA binary.
2. TypeScript source: `virtualModules` plus `tsconfigPaths`.
3. Unbundled built Node (the `dist/index.js` library entry, for SDK embedders): the `alias` map resolved to `dist/...` entrypoints.

Keep the closing sentence that every mode maps both the bare specifier and `/compat` to pi-ai's compat entrypoint.
Elsewhere, replace "aliases (Node) / virtualizes (Bun)" with wording that does not tie aliasing to Node installs, e.g. "maps (via its `alias` or `virtualModules` table)", and replace "in both modes" with "in every mode".

## Module-Level Changes

1. `src/request-shaping.ts`: `carriesEffort` JSDoc (line ~127) uses the flag-plus-dated-list wording.
2. `docs/architecture.md`:
   - line ~131 ("What the wrapper does", item 2): flag-plus-dated-list wording.
   - line ~79: loader "aliases (Node) / virtualizes (Bun)" phrasing.
   - line ~81: "in both modes" → "in every mode".
3. `.pi/skills/anthropic/SKILL.md` line ~36: flag-plus-dated-list wording.
4. `src/claude-code-version.ts`: "Known floors" comment adds the Sonnet 5.5 acceptance.
5. `AGENTS.md`:
   - "Claude Code Version Floors Gate New Models": Sonnet 5.5 acceptance sentence.
   - "Verify Each Loader Mode": rewritten list per Design Overview; "As of pi 0.84.0" becomes "As of pi 0.99.1", and the "Pi 0.84.0 added mode 2" sentence stays.
   - "Registering `streamSimple`" (lines ~587, ~592): the "aliases (Node) / virtualizes (Bun)" and "in both modes" phrasing.
6. `src/host-transport.ts`: the two doc comments (lines ~23 and ~75) saying "aliases (Node) / virtualizes (Bun)".
7. `docs/builtin-transport-seam-gap.md` line ~120: "aliases (Node) and virtualizes (Bun)".

`docs/builtin-transport-seam-upstream-request.md` line 63 says "aliases/virtualizes" without tying either to an install type, so it stays.

## Test Impact Analysis

None: comment and prose edits only.
Verification is `pnpm run lint` (includes `rumdl` for `*.md docs/**/*.md`), `pnpm exec rumdl check .pi`, `pnpm run check`, and `pnpm test` as a regression guard.
After editing, grep to confirm no stale phrasing survives:

```bash
rg -n "Opus 5\.5\)|aliases \(Node\)|virtualizes \(Bun\)|in both modes|three modes" --glob '!docs/plans/**' --glob '!docs/retro/**' .
```

## Invariants at risk

None.
No code path changes, and `test/managed-effort-drift.test.ts` already pins the managed-effort behavior for every flagged model.

## Build Order

This is a non-TDD plan; run it with `/build-plan`.

1. Managed-effort wording in `src/request-shaping.ts`, `docs/architecture.md`, and `.pi/skills/anthropic/SKILL.md`.
   Commit: `docs: name supportsMidConvoEffort as the managed-effort source of truth (#82)`.
2. Sonnet 5.5 acceptance in `src/claude-code-version.ts` and `AGENTS.md`.
   Commit: `docs: record claude-sonnet-5-5 accepting cc_version 2.1.280 (#82)`.
3. Loader modes in `AGENTS.md`, `docs/architecture.md`, `docs/builtin-transport-seam-gap.md`, and `src/host-transport.ts`.
   Commit: `docs: correct loader modes for the bundled Node distribution (#82)`.

Run the stale-phrasing grep and the lint/check/test commands before the final commit.

## Risks and Mitigations

- A dated model list drifts again with the next model: the flag is named first, so a stale list is visibly secondary, and the drift test enumerates by flag.
- Overstating the Sonnet 5.5 measurement as a floor: the wording says "accepts", not "requires".
- Non-ASCII corruption in rewritten prose (em-dashes in `AGENTS.md`): run the `markdown-conventions` scans after each edit.

## Open Questions

- Whether a Homebrew formula for pi exists that installs differently from npm; none was found on the operator's machine, and the issue's question is answered for npm installs, which this repo's users run.

[#56]: https://github.com/gotgenes/pi-anthropic-auth/issues/56
[#81]: https://github.com/gotgenes/pi-anthropic-auth/issues/81
