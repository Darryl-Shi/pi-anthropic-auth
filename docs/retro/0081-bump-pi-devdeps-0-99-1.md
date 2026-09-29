---
issue: 81
issue_title: "chore: bump pi devDependencies to 0.99.1"
---

# Retro: #81 — chore: bump pi devDependencies to 0.99.1

## Stage: Planning (2026-09-29T18:38:28Z)

### Session summary

Planned the bump of both pi devDependencies from 0.86.0 to 0.99.1, keeping the `>=0.86.0` peer floor, plus a parametrization of `test/managed-effort-drift.test.ts` over every `supportsMidConvoEffort` model.
Spiked the whole change in a scratch worktree with the age gate set to 0: `tsc`, lint, 199 tests, `fallow dead-code`, and the compat delegate probe were all green, and the parametrized suite ran 9/9.

### Observations

- A targeted `pnpm add -D` left every other devDep at its locked version (`typescript-eslint` stayed 8.70.0), which contradicts the issue's observation of drift; that drift came from a full re-resolution, so the plan forbids `pnpm clean --lockfile`.
- The existing drift test used `.find()`, so after a bare bump it would still exercise only `claude-fable-5-1` and not Sonnet 5.5; the operator chose to parametrize it.
- The operator chose `chore:` over `build(deps):`, accepting a v3.3.3 release that consumers won't notice, because `package.json` is in the release scope.
- 0.99.1 was published at 18:20Z, so step 2 cannot pass CI's frozen install before 19:20Z.
- Docs refresh for the model lists and loader modes stays in sibling Issue #82.
- The Tidy-First assessor recommended no preparatory commits; its optional module-level hoist is folded into step 1.

## Stage: Implementation — TDD (2026-09-29T20:03:12Z)

### Session summary

Completed all three steps: parametrized `test/managed-effort-drift.test.ts` over every `supportsMidConvoEffort` model, bumped both pi devDependencies to 0.99.1, and updated `AGENTS.md` coverage item 13.
The suite went from 199 to 205 tests; the drift file runs 5 cases on 0.86.0 and 9 on 0.99.1, including `claude-sonnet-5-5`.

### Observations

- Step 1 was a characterization change with no red phase.
- Deviation: `pi-coding-agent@0.99.1` was published at 18:23:26Z, not 18:20Z as the plan recorded, so the first `pnpm add` at 19:21Z failed with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`; check every package's publish time (`npm view <pkg> time`), not just one.
- The targeted `pnpm add` left `pnpm-workspace.yaml` untouched and moved no other devDep, as the spike predicted.
- Deleting `~/.cache/pnpm/lockfile-verified.jsonl` was not enough to reproduce CI's check (the file did not exist; an up-to-date `node_modules` skips verification); a fresh worktree with `pnpm install --frozen-lockfile` printed `Verifying lockfile against supply-chain policies (321 entries)` and passed.
- Live repro on the pi 0.99.1 binary with `-ne -e src/index.ts` answered `PONG`.
- Pre-completion reviewer: WARN. Reviewer warnings: stale managed-effort model lists in `docs/architecture.md` and the `anthropic` skill, which the plan defers to Issue #82.
