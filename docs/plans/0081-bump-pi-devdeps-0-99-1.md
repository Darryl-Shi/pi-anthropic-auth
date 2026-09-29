---
issue: 81
issue_title: "chore: bump pi devDependencies to 0.99.1"
---

# Bump pi devDependencies to 0.99.1

## Release Recommendation

**Release:** ship independently

The issue is not part of any roadmap batch.
The operator chose a `chore:` commit, which cuts v3.3.3 because `package.json` is inside the release scope, even though consumers see no behavior change.

## Problem Statement

The `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` devDependencies are pinned at 0.86.0, while the operator runs 0.87.1 and the newest release is 0.99.1.
The drift canaries only guard the installed devDep's catalog and transport, so they cannot see anything added after 0.86.0, including Claude Sonnet 5.5 (`claude-sonnet-5-5`), which 0.99.0 added as a managed-effort model.
Even after a bump, `test/managed-effort-drift.test.ts` drives only the first model `.find()` returns (`claude-fable-5-1`), so Sonnet 5.5 would still not be exercised.

## Goals

- Pin both devDependencies at exactly `0.99.1`.
- Keep the `>=0.86.0` peer floor unchanged.
- Drive the managed-effort drift checks for every model the catalog flags `compat.supportsMidConvoEffort`, so a newly added model is covered without a test edit.
- Not breaking: devDependencies and a test do not change the published behavior.

## Non-Goals

- Refreshing the managed-effort model lists, the Claude Code floor notes, and the loader-mode prose (Issue [#82], filed alongside this one).
- Verifying the peer floor in CI (Issue [#56]).
- Pruning the stale `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml`.
- Moving to TypeScript 7, which Pi 0.99.0 adopted for its own build; our `typescript` 6.0.3 typechecks the new `.d.ts` files cleanly.
- Sharing a capture helper between `test/managed-effort-drift.test.ts` and `test/claude-code-version-drift.test.ts` (rejected by the Tidy-First assessor as the wrong abstraction).

## Background

- `package.json` pins both pi packages exactly under `devDependencies` and declares `>=0.86.0` under `peerDependencies`.
- `pnpm-workspace.yaml` sets `minimumReleaseAge: 60`; `minimumReleaseAgeExclude` is ignored under `pnpm install --frozen-lockfile`, which CI runs (AGENTS.md, "Fresh Upstream Releases Trip The Lockfile Age Gate").
- Both 0.99.1 packages were published at 2026-09-29T18:20Z, so the gate clears at 19:20Z.
- `test/managed-effort-drift.test.ts` has three tests: a catalog test asserting a flagged model exists, a test that Pi carries historical and active effort in content-less system messages, and a test that OAuth shaping keeps every one of them.
  `captureOutboundBody` and `priorAssistantTurn` already take the model as a parameter.
- The issue author assessed 0.86.0 → 0.99.1 with `/upstream-impact` and found no compile-time, behavioral-silent, or coverage-gap findings; live `PONG` repros on `claude-haiku-4-5` and `claude-sonnet-5-5` passed with no version recovery.

## Design Overview

### Dependency bump

Run a targeted `pnpm add -D @earendil-works/pi-ai@0.99.1 @earendil-works/pi-coding-agent@0.99.1` once the age gate has cleared.
Do not run `pnpm clean --lockfile`: a targeted add preserves the other locked devDeps, while a full re-resolution pulls them forward (the issue saw `typescript-eslint` 8.70.0 → 8.71.0 that way).

Measured at planning time, in a scratch worktree with the gate temporarily set to 0:

| Check | Result |
| --- | --- |
| `git diff --stat` | `package.json` (2 lines), `pnpm-lock.yaml` (+86/−35) |
| Other devDeps | unchanged (`typescript-eslint` stays 8.70.0) |
| New transitive packages | `openai` 6.40.0 → 7.19.0, `quickjs-wasi` 3.6.2 |
| `tsc --noEmit` | rc=0 |
| `pnpm run lint` | rc=0 |
| `vitest run` | 199 passed |
| `fallow dead-code` | no issues |
| compat delegate probe | `function` |

Managed-effort catalog on 0.99.1 (measured): `claude-fable-5-1`, `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5-5`.

The implementer must confirm `pnpm-workspace.yaml` is unchanged after the add; with the gate cleared, pnpm writes no exclude entry.

### Parametrized drift test

Replace the finder with a filter, evaluated once at module level so the `test.each` table and the catalog assertion share it:

```typescript
const MANAGED_EFFORT_MODELS = getBuiltinModels("anthropic").filter(
  (model) => model.compat?.supportsMidConvoEffort === true,
);

test("Pi's catalog still has a managed-effort Anthropic model", () => {
  assert.notDeepEqual(MANAGED_EFFORT_MODELS.map((m) => m.id), [], "...");
});

test.each(MANAGED_EFFORT_MODELS.map((m) => [m.id, m] as const))(
  "OAuth shaping keeps every effort message Pi sends (%s)",
  async (_id, model) => { /* body unchanged, minus the assert.ok(model) narrowing */ },
);
```

The catalog test stays because `test.each([])` would run no cases, so the catalog assertion is what fails loudly if Pi drops the flag.
Keying each case by model id names the failing model in the report.

A spike of this change measured 9/9 passing on 0.99.1 (1 catalog test plus 2 tests × 4 models).
On 0.86.0 the table is smaller; step 1 runs there first, so the bump in step 2 visibly adds the `claude-opus-5-5` and `claude-sonnet-5-5` cases.

## Module-Level Changes

- `test/managed-effort-drift.test.ts`: `findManagedEffortModel()` → module-level `MANAGED_EFFORT_MODELS`; the two transport tests become `test.each` keyed by model id.
- `package.json`: both pi devDependencies `0.86.0` → `0.99.1`; `peerDependencies` untouched.
- `pnpm-lock.yaml`: regenerated by the targeted add.
- `AGENTS.md`, Coverage areas item 13: "Pi's catalog still flags a managed-effort model" → "every model Pi's catalog flags as managed-effort".

## Test Impact Analysis

1. The parametrization makes it possible to check each flagged model, not just the first, and adds a case automatically for any model a future Pi release flags.
2. No existing test becomes redundant.
3. The other drift suites (`test/claude-code-version-drift.test.ts`, `test/upstream-prompt-drift.test.ts`) stay as-is; they now simply read the 0.99.1 transport and prompt.

## Invariants at risk

- The PR [#79] invariant that shaping keeps every content-less effort message is pinned by the "OAuth shaping keeps every effort message" test, which this plan widens rather than weakens.
- The anti-vacuity guards (non-empty unshaped effort list, billing marker present in the shaped body) must stay inside each parametrized case.
- The issue [#74] drift alarm (our pin not below Pi's `claude-cli` version) stays green on 0.99.1: measured in the full-suite run above.

## TDD Order

1. **Parametrize the managed-effort drift test on 0.86.0.**
   Surface: `test/managed-effort-drift.test.ts`.
   Replace the finder with `MANAGED_EFFORT_MODELS`, convert the two transport tests to `test.each`, and run the suite on the current 0.86.0 pin; every generated case must pass.
   Commit: `test: drive the managed-effort drift checks for every flagged model (#81)`.
2. **Bump the devDependencies** (not before 2026-09-29T19:20Z).
   Run the targeted `pnpm add -D`, confirm `pnpm-workspace.yaml` is unchanged, then run `pnpm run check`, `pnpm run lint`, `pnpm test`, and `pnpm fallow dead-code`.
   Confirm the drift suite now lists the `claude-sonnet-5-5` cases.
   Reproduce CI's supply-chain check locally: delete `~/.cache/pnpm/lockfile-verified.jsonl`, run `pnpm install --frozen-lockfile`, and confirm the output shows `Verifying lockfile against supply-chain policies`.
   Run the live repro with `pi --model anthropic/claude-haiku-4-5 -ne --no-session -e src/index.ts -p "reply with exactly: PONG"`.
   Commit: `chore: bump pi devDependencies to 0.99.1 (#81)`.
3. **Update the coverage note.**
   Surface: `AGENTS.md` Coverage areas item 13.
   Commit: `docs: note the managed-effort drift checks cover every flagged model (#81)`.

## Risks and Mitigations

- **Age gate not yet cleared.** CI's frozen install fails on a package younger than 60 minutes; step 2 carries a not-before time and a local frozen-install check with the verdict cache cleared.
- **Full re-resolution drags other devDeps.** Use the targeted `pnpm add`, never `pnpm clean --lockfile`; the measured diff moved no other devDep.
- **Empty table hides a lost flag.** The catalog test fails when no model is flagged, so an empty `test.each` cannot pass silently.
- **A future flagged model behaves differently.** That is the intended signal: the case fails by name, prompting a look at how Pi carries effort for it.

## Open Questions

- None.

[#56]: https://github.com/gotgenes/pi-anthropic-auth/issues/56
[#74]: https://github.com/gotgenes/pi-anthropic-auth/issues/74
[#79]: https://github.com/gotgenes/pi-anthropic-auth/pull/79
[#82]: https://github.com/gotgenes/pi-anthropic-auth/issues/82
