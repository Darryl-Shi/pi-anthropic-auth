---
issue: 77
issue_title: "Resync the remaining .pi/prompts and .pi/agents drift with pi-packages"
---

# Resync the remaining prompt and agent drift with pi-packages

## Release Recommendation

**Release:** ship independently

`docs/architecture.md` has no roadmap, so this issue belongs to no batch.
Every file this plan touches (`.pi/**`, `AGENTS.md`) is in `CLIFF_EXCLUDED_PATHS` since [#78], so no version is cut (measured: `next-version.sh` prints `Nothing to release (at v3.4.1).` today, and nothing here changes that).

## Problem Statement

[#76] resynced the shared skills and ported only the prompt and agent hunks those skills needed: the Tidy-First relocation and the reviewer's `fallow decision-surface` check.
All other prompt and agent drift from pi-packages was left for this issue.
pi-packages has moved on since, too: a 2026-09-29 agent-docs audit pruned its templates, added an `AGENTS.md` admission test, and added killing-mutation verification to its TDD flow.
So the local prompts are missing upstream improvements, and some local text is stale on its own terms.
For example, `/ship-issue` and `/ship-no-issue` both say `fallow dead-code` "is not a CI gate here", but `.github/workflows/ci.yml` gates it on every `main` push.

## Goals

1. Classify every differing hunk in the nine prompts and two agents (the tables below) as Keep (a local adaptation or local-only rule), Port (an upstream improvement, adapted), or Drop (monorepo-, worktree-, or tool-specific).
2. Port the killing-mutation workflow: `/plan-issue` names a killing mutation per TDD step, and `/tdd-plan` becomes red→green→verify→commit (operator decision).
3. Port the `AGENTS.md` `## Admission test` and gate `/retro` Step 7 on it, without the `/audit-agent-docs` reference (operator decision).
4. Apply upstream's audit prunes where the pruned line repeats a skill the prompt already loads (the admission test's second question).
   Local-only lines with no other home stay.
5. Fold in the portable shared-skill drift since [#76] (`testing`, `shell-traps`, `pre-completion`) (operator decision).
6. Leak no pi-packages issue refs, monorepo paths, worktree lanes, or fallow 3.x subcommands into this repo.

Package users see no change: nothing under `src/` or `package.json` `files` changes.
This repo's own workflow does change: `/tdd-plan` gains a verify step, and `/retro` gains an admission gate.

## Non-Goals

1. Porting `/audit-agent-docs`, `/finish-phase`, `/plan-improvements`, `/sync-worktree`, `/triage-backlog`, or the `craftsmanship-scout` agent.
2. Porting the skills pi-packages prompts now load that this repo does not have (`reading-artifacts`, `reproduction`, `clarification-gates`, `delegation`, `git-workflow`, `releasing`, `roadmap-fit`, `worktrees`).
   Where upstream moved a rule into one of those skills, the local prompt keeps its inline copy.
3. The worktree lane of upstream `/ship` (steps 0, 1, 4, 12, and every `BRANCH`/`PRE_MERGE` clause).
4. pi-packages-only skill delta since [#76]: the `unicode-escapes.mjs` gate in `markdown-conventions` (no such script here) and the roadmap edge vocabulary in `improvement-discovery` (no `roadmap-check.mjs`, and no roadmap).
5. `retro-note.md`: its 6 differing lines are all local path adaptations, so it does not change.
6. Pushing local-only prompt rules upstream.

## Background

The adaptation rules from [#76] still apply: single package (no `--filter`, `--workspace`, `packages/<PKG>`), `docs/architecture.md` as one file, `/ship-issue` rather than `/ship`, fallow 2.104.0 (no `guard`, `--type-aware`, `--symbol-impact`), no pi-packages issue numbers.

Drift was measured on 2026-09-30 against pi-packages `origin/main` at `7b0357d3` (the issue's `60c22b0a` is 60 commits older), counting `diff` lines on both sides:

| File | Lines | Upstream counterpart |
| --- | --- | --- |
| `.pi/prompts/ship-issue.md` | 296 | `ship.md` (mostly the worktree lane) |
| `.pi/prompts/plan-issue.md` | 165 | |
| `.pi/prompts/tdd-plan.md` | 86 | |
| `.pi/prompts/retro.md` | 80 | |
| `.pi/agents/pre-completion-reviewer.md` | 61 | |
| `.pi/prompts/ship-no-issue.md` | 53 | |
| `.pi/prompts/build-plan.md` | 49 | |
| `.pi/agents/tidy-first-assessor.md` | 48 | |
| `.pi/prompts/pr-review.md` | 46 | |
| `.pi/prompts/retro-note.md` | 6 | |

The issue's table omitted `ship-issue.md`, because its upstream file has a different name.

Measured baselines:

1. `pnpm exec rumdl check .pi AGENTS.md` passes on 28 files.
2. `.fallowrc.json` sets `circular-dependencies: error`, and `fallow dead-code --help` on 2.104.0 lists `--circular-deps`, so upstream's import-cycle rule applies here as written.
3. A non-TTY `pnpm test` prints 10 lines for 234 tests (exit 0), which is the number the ported "run Vitest bare" rule cites.
4. `docs/architecture.md` has no `✅`, `Landed:`, or `Release:` marks, so the `✅` grep check below is conditional and reports 0 today.
5. `opencode-go/deepseek-v4-flash` is enabled in `~/.pi/agent/settings.json`, so upstream `/ship`'s model line works here unchanged.

## Design Overview

Keep, Port, and Drop are defined in Goal 1.
"Prune" marks a local line upstream's audit deleted because a skill the prompt loads already states it; each prune names that skill.

### `AGENTS.md`

Add `## Admission test` between the intro and `## Project`, ported from pi-packages `AGENTS.md` lines 114–128 with two adaptations:

1. The delete-candidate sentence loses its pi-packages date ("has not recurred in any recent retro").
2. The `/audit-agent-docs` sentence is dropped.

### `plan-issue.md`

| Hunk | Verdict |
| --- | --- |
| Paths, `anthropic` skill, `upstream-watch` load, step numbering, `/ship-issue` | Keep |
| `testing` load "for any plan with TDD steps — its TDD planning rules govern sequencing" | Port |
| `reading-artifacts`, `reproduction`, `clarification-gates`, `delegation` loads | Drop (Non-Goal 2) |
| Target-package step 2, `docs/triage/` read, "reach us" and third-party immunity check | Drop |
| Search the upstream tracker when a diagnosis blames a dependency; read its source and the reporter's tarball; confirm the mechanism in the tracking checkout | Port (`--repo earendil-works/pi`, `~/development/pi/pi`) |
| Trace what triggers a bug, not only what it does | Port |
| Enumerate a shared mutable artifact's other writers | Port, adapted: the system prompt's other writers include `@gotgenes/*` extensions in `~/development/pi/pi-packages` |
| `git log -S` before removing a convention | Port |
| Local "Before an `ask_user` option rests on an upstream symbol", "npm pack a real caller", "(Refs #65)" repro sentence, false-precision example | Keep |
| State breaking classification in the gate even when settled | Port |
| Published-scope collision (README / architecture Non-Goals) | Port (`README.md`, `docs/architecture.md`) |
| Bug-report gate leads with the observed scenario | Port |
| A qualitative cost claim is measurable | Port, beside the local example |
| `Co-authored-by:` trailer recorded in the TDD Order | Port, without the `git-workflow` reference |
| Decision-record issues never skip the gate | Port |
| Tidy-First section: "Make the change easy", "runs in a subagent", "Skip when… no `src/`" | Prune (`tidy-first` lines 11, 12, and its applicability gate) |
| "A count it reports is a lead" | Keep (no skill carries it) |
| Non-Goal reachability re-derived when the change moves the bound | Port |
| Import-cycle A → B check | Port, adapted: no zones, so the cycle surfaces as `fallow dead-code`'s `circular-dependencies` error |
| Replaced evidence enumerated in both directions | Port |
| A diagram is prose too (Mermaid labels) | Port (`docs/architecture.md`) |
| Local "grep once per claim", "new required field constructors" | Keep |
| Optional produced field vs exact-equality assertions | Port |
| Predicted-unchanged files listed with their claim | Port |
| Test Impact: dry-run a prompt's shell commands; parser input domain; absence predicate | Port |
| Invariants: open each named test; corpus is not reachability; name the constituency | Port |
| Local timing median, counts need one run | Keep |
| TDD Order: red→green→verify→commit, killing mutation per step, one per equivalence class, relocated-line mutation | Port (Goal 2) |
| `feat:`/`fix:` subject names the observable outcome; type by what a user observes | Port, replacing the local `refactor:` sentence, without the `git-workflow` reference |
| Mechanism half and data half as separate steps; a mutable field's whole lifecycle in one step | Port |
| Tidy-First placement sentences in TDD Order | Prune (`tidy-first` lines 46 and 64) |
| "Single call site factory" sentence | Prune (`testing` line 158) |
| Trailing "If the change is breaking…" line | Prune (the Decide section states it) |
| Risks: spike the absence, not the presence | Port |
| Follow-up number from `gh issue create` output; `git rev-parse` cited SHAs | Port |
| `roadmap-fit`, `#### Phase handoff` | Drop |
| MD053 parenthetical, `#### Deferred tidyings` | Keep |
| Heredoc line in stage notes | Prune (`markdown-conventions` "Lines and sentences") |
| End with the next command on its own line | Port |

### `tdd-plan.md` and `build-plan.md`

| Hunk | Verdict |
| --- | --- |
| Trunk-only sync, local plan lookup, "if its issue is closed, stop" | Keep |
| "Skip any skill already in this session's context; re-load after a compaction" | Port (both) |
| "Prior stage entries contain…" | Prune (both; the retro file is self-describing) |
| `edit-tool` load line | Port, without `git-workflow` (both) |
| `pnpm test` (not `run test`), `pnpm fallow:dead-code` | Keep |
| Red: run unpiped; derive your own input set for a literal pattern; copy produced strings from the producer | Port, with `pnpm test <test-path>` |
| Step 3 "Verify the pins", including the five mandatory cases, `cp` to `/tmp` in its own call, confirm the file changed, prefer a compared literal, count the reds | Port (Goal 2) |
| "Filing an issue mid-implementation": file it and keep going | Port the first sentence; drop `roadmap-fit` (both) |
| "From a package subdirectory detects fewer entry points" | Drop |
| `✅` confirmation `grep -cE '✅.*#<N>\b' docs/architecture.md` must report 2 | Port, conditional on a roadmap step (both) |
| Changelog preview: retype to `refactor:` or reword to the symptom | Port |
| build-plan local "reasoning first (Refs #35)" and "grep the old phrasing" | Keep |

### `retro.md`

| Hunk | Verdict |
| --- | --- |
| Skip-loaded-skills line | Port |
| `clarification-gates`, `git-workflow`, `roadmap-fit`, worktree peer transcript, `/finish-phase`, `docs/triage/` | Drop |
| Read prior stages' transcripts with `list_session_files` and `read_session_file` | Port |
| Model lens: type-unfiltered call, `offset`/`elide_user_text` paging, `[abandoned branch]` marks, `[session] →` boundaries, subagent model from `list_subagent_sessions`, never `PI_MODEL` | Port, without "this repo's own tooling" |
| Step 7 admission gate, `*why*`, `Refs #N` only for an active constraint | Port (Goal 3) |
| Split a `src/`/`test/` change out of `docs(retro):` | Port (a `docs:` commit touching `src/` is inside the release scope) |
| Rules: "Don't duplicate" names skills and the admission test | Port |
| "Author with Edit/Write", "sequential numbering" | Prune (`markdown-conventions`) |
| Step 10 roadmap wording, "If the roadmap queues nothing" | Keep |

### `ship-issue.md` and `ship-no-issue.md`

| Hunk | Verdict |
| --- | --- |
| `model: anthropic/claude-sonnet-5-5, opencode-go/deepseek-v4-flash` | Port to `ship-issue.md` (the [#76] retro flagged Opus as overkill for ship) |
| Derive an empty `$1` from the newest plan commit | Port |
| "Every SHA is command output; never measure its shape" | Port |
| Load `github-voice` before the close comment | Port; drop `git-workflow`, `releasing`, `worktrees` |
| Read the retro in full for ship-time close targets | Port |
| No plan found: say so in the final report | Port |
| `git rev-list --count origin/main..main` unpushed-commit report | Port |
| Pre-push: "fallow is not a CI gate here" | Fix (both): `pnpm fallow:dead-code` is a gate, since `ci.yml` runs it on every `main` push |
| Run each gate unpiped; redirect with `>/tmp/x.log 2>&1 \|\| tail -30` | Port (both) |
| `ci_watch` `timeout: 600` | Port (both) |
| Close comment range anchored on the plan commit (`docs: \(re-\)\?plan .*(#$1)`), not the previous tag | Port |
| Anchor on the title-defect commit; name the entry point as the code spells it; credit third-party commenters | Port |
| Never cite a released version in the close comment | Port, replacing the local "post after the tag" bullet |
| Re-resolve every hex token in the finished draft; compose it inside the `issue_close` call | Port, replacing the local pre-draft resolve |
| Read each superseded PR's body before closing it | Port |
| Co-shipped issue: subject `(#M)` counts, a body `Refs #M` does not | Port; drop the roadmap fold-in heading |
| `prepare` re-dispatched once; a second failure is a defect; diff log timestamps | Port |
| `git tag --points-at HEAD` empty is a finding | Port |
| Local 4b/4c, hypothesis-pending close, single-tag dispatch, Constraints | Keep |
| `ship-no-issue.md` local structure and ad-hoc reviewer dispatch | Keep (upstream delegates to `ship.md`'s sections; the local copy stays self-contained) |

### `pr-review.md`

| Hunk | Verdict |
| --- | --- |
| Target-package step, "reach us", `PathFlavor`, skill loads from Non-Goal 2 | Drop |
| Fork status: empty for two reasons; `total_count` tells them apart; `ci_find` `timeout: 300`; an already-approved fork runs later pushes | Port (`gotgenes/pi-anthropic-auth`) |
| Read the downstream consumer the report blames, at the reporter's version | Port, with `gh`/`npm pack` in place of `fetch_content` |
| Local capability gate, merge-base diff, OAuth surface, adopt-as-is flow (Refs #79) | Keep |

### `tidy-first-assessor.md`

| Hunk | Verdict |
| --- | --- |
| `read` tool line, thin-override constraint, governing skills, output examples | Keep |
| "Repo shape" module list | Fix: it names 8 of the 17 `src/` files; replace the list with a pointer to `AGENTS.md` "Local Files" |
| Step 2b "what the change leaves behind" | Port |
| "Nest the `describe` tree" candidate | Port (the `testing` skill carries `describe` nesting since [#76]) |
| `guard`, zones, `--symbol-impact`, per-package version pin | Drop |

### `pre-completion-reviewer.md`

| Hunk | Verdict |
| --- | --- |
| `/ship-issue`, `pnpm test`, local paths, local decision-surface example, no `coupling-boundary` | Keep |
| Sanctioned reads outside the repo: `../pi` (the Pi clone) and `pnpm view <pkg>@<version> dist.tarball`; a version-boundary question stops the working-tree search | Port; add `pnpm view` to the Bash allowlist, since the rule prescribes it |
| Establish reachability before a missing-coverage finding | Port |
| §2a "Determine the base ref" `git describe` block | Drop: the dispatcher supplies the base ref since [#76], and a tag base spans other issues |
| §2d "or a reproduction", "a real session, real config", the stochastic-source examples | Port |
| `mmdc`: "the command's own output is the verdict" | Port |
| WARN list: "unverified evidence provenance" | Port (§2d already reports WARN; the severity list omits it) |

### Shared-skill delta since [#76]

| Skill | Hunk | Verdict |
| --- | --- | --- |
| `testing` | Confirm a mutation applied (`git diff --stat`) before reading its run | Port |
| `testing` | Sweep a named external oracle combinatorially | Port, without the pi-packages incident sentence |
| `testing` | Run Vitest bare, narrow with a path and `-t` | Port, with the 10-line / 234-test measurement |
| `testing` | Pair a run with the typecheck using `&&` | Port (`pnpm test <path> && pnpm run check`) |
| `testing` | Re-run a failing file alone, unpiped | Port (replaces "read the unfiltered `tail`") |
| `shell-traps` | zsh `echo` decodes backslash escapes; print bytes with `print -r --` | Port |
| `pre-completion` | A delta dispatch never states the dispatcher's own check results | Port |
| `code-design` | `sonnet-5-5` | Already local |

## Module-Level Changes

1. `AGENTS.md`: new `## Admission test`.
   Line 159 names the unported pi-packages prompts by names upstream no longer uses (`land-worktree`, `ship-worktree`); list the current ones instead (`plan-improvements`, `finish-phase`, `audit-agent-docs`, `sync-worktree`, `triage-backlog`).
   The Project Prompts and Project Agents list entries stay accurate (no local prompt or agent is added or renamed).
2. `.pi/prompts/plan-issue.md`, `tdd-plan.md`, `build-plan.md`, `retro.md`, `ship-issue.md`, `ship-no-issue.md`, `pr-review.md`: per the tables.
3. `.pi/agents/tidy-first-assessor.md`, `.pi/agents/pre-completion-reviewer.md`: per the tables.
4. `.pi/skills/testing/SKILL.md`, `.pi/skills/shell-traps/SKILL.md`, `.pi/skills/pre-completion/SKILL.md`: the delta table.
5. Predicted unchanged: `retro-note.md` (Non-Goal 5); `upstream-impact.md` (no upstream counterpart); `README.md` and `docs/architecture.md` (neither names a prompt or agent, measured in [#76]).

Greps run at planning time:

1. `fallow.*CI gate|not a CI gate` hits only the two ship prompts.
2. `Refs #|#[0-9]{3,}` in `.pi/prompts` and `.pi/agents` hits only local refs (#35, #53, #65, #79).
3. The `sonnet-5-5` model string is already in `code-design` (line 222).

## Test Impact Analysis

No `src/` or `test/` change.
The testable surface is the shell commands the new prompt text prescribes; each was dry-run at planning time, and `/build-plan` re-runs them as verification:

| Command | Expected (measured 2026-09-30) |
| --- | --- |
| `git log --format='%h %s' --grep="docs: \(re-\)\?plan .*(#76)" -1` | `98a2be8 docs: plan resyncing shared workflow skills with pi-packages (#76)` |
| `git log --format='%s' --grep='^docs: \(re-\)\?plan ' -1` | the newest plan commit subject (`(#82)` before this plan lands, `(#77)` after) |
| `git rev-parse 98a2be8^{commit} && git merge-base --is-ancestor 98a2be8 main` | full SHA, exit 0 |
| `gh api "repos/gotgenes/pi-anthropic-auth/actions/runs?head_sha=$(git rev-parse HEAD)" --jq .total_count` | an integer (`1` at the pre-plan HEAD) |
| `pnpm run lint >/tmp/lint.log 2>&1 \|\| tail -30 /tmp/lint.log` | silent, exit 0 |
| `grep -cE '✅.*#46\b' docs/architecture.md` | `0` (no roadmap) |
| `pnpm test` (non-TTY) | 10 lines, exit 0 |

## Invariants at Risk

1. `.pi` and `AGENTS.md` pass `rumdl` (28 files).
   `lint:md` skips `.pi/**`, so every step runs `pnpm exec rumdl check .pi AGENTS.md`.
2. No non-ASCII corruption: every step runs the three `markdown-conventions` scans on the files it touched.
3. No leaked pi-packages content: after every step, `rg -n 'packages/<|--workspace|--filter|/ship([^-]|$)|worktree|roadmap-fit|git-workflow|reading-artifacts|clarification-gates|fallow guard|--type-aware|--symbol-impact|docs/triage|#[0-9]{3,}' .pi/prompts .pi/agents AGENTS.md` returns only lines kept on purpose.
   The measured baseline has 9 hits of three kinds: the scratch `git worktree` checkouts in `pr-review.md` and `upstream-impact.md`, `AGENTS.md`'s `pnpm/pnpm#11203` citation, and `AGENTS.md` line 159 naming the unported flows.
4. The [#76] relocation holds: `plan-issue.md` keeps `## Tidy First assessment` and the `#### Deferred tidyings` instruction, and `tdd-plan.md`/`build-plan.md` keep "run no separate assessment".

## TDD Order

This is a docs-only plan for `/build-plan`, with one commit per step.
Each step's verify: `pnpm exec rumdl check .pi AGENTS.md`, the non-ASCII scans, and the Invariant 3 grep.
Splice ported text by script from `/tmp` copies of the upstream files (`git -C ~/development/pi/pi-packages show 7b0357d3:<path>`), as the [#76] build did, rather than retyping em-dashes.

1. Add the `AGENTS.md` admission test and port `retro.md`.
   It comes first because steps 2–6 prune against it.
   Commit: `docs: gate retro-driven additions on an AGENTS.md admission test (#77)`.
2. Port `plan-issue.md`, including killing mutations in the TDD Order.
   Verify also: Invariant 4, and the first two Test Impact commands.
   Commit: `docs: resync /plan-issue with pi-packages and name a killing mutation per step (#77)`.
3. Port `tdd-plan.md` and `build-plan.md`, including "Verify the pins".
   Verify also: `rg -n 'red→green→verify→commit' .pi/prompts/tdd-plan.md .pi/prompts/plan-issue.md` hits both files, and the `✅` grep reports `0`.
   Commit: `docs: verify each TDD step's pins by mutation before committing (#77)`.
4. Port both agents.
   Verify also: `rg -n 'git describe' .pi/agents/pre-completion-reviewer.md` no longer hits §2a, and the assessor names no `src/` file list.
   Commit: `docs: resync the tidy-first and pre-completion agents with pi-packages (#77)`.
5. Port `ship-issue.md` and `ship-no-issue.md`.
   Verify also: `rg -n 'not a CI gate' .pi/prompts` returns nothing, and the plan-commit, `rev-parse`, and lint-redirect commands reproduce their table rows.
   Commit: `docs: resync the ship prompts with pi-packages and gate on fallow dead-code (#77)`.
6. Port `pr-review.md`.
   Verify also: the `total_count` command returns an integer.
   Commit: `docs: resync /pr-review with pi-packages (#77)`.
7. Port the shared-skill delta.
   Verify also: a non-TTY `pnpm test` still prints about 10 lines; update the cited count if it has moved.
   Commit: `docs: port the post-#76 testing, shell-traps, and pre-completion skill delta (#77)`.

Finish with `pnpm run lint` and the pre-completion review, with this plan commit's parent as the base ref.

## Risks and Mitigations

1. Step 3 changes `/tdd-plan`, and step 1 changes `/retro`, while `/build-plan` runs; the running session holds the old text.
   Mitigation: none is needed, since `/build-plan` runs neither; the next `/retro` reads the new file.
2. Pruning a local line that no skill actually carries silently drops a rule.
   Mitigation: each Prune row names the skill line that carries it; before deleting, `rg` that line.
3. Porting upstream text that is plausible here but false (a gate, a script, a subcommand this repo lacks).
   Mitigation: Invariant 3's grep, plus the dry-run table.
4. The verify step lengthens every `/tdd-plan` cycle.
   Accepted by the operator; `testing` already asks for mutation proofs, and the step turns that into a per-cycle checkpoint.

## Open Questions

1. Whether to port `/audit-agent-docs` once the admission test has run through a few retros here.
   Deferred; no issue filed until a retro asks for it.

[#76]: https://github.com/gotgenes/pi-anthropic-auth/issues/76
[#78]: https://github.com/gotgenes/pi-anthropic-auth/issues/78
