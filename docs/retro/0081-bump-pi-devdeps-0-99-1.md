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
