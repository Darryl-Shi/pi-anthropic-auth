---
issue: 77
issue_title: "Resync the remaining .pi/prompts and .pi/agents drift with pi-packages"
---

# Retro: #77 — Resync the remaining .pi/prompts and .pi/agents drift with pi-packages

## Stage: Planning (2026-09-30T05:25:52Z)

### Session summary

Diffed all nine prompts and both agents against pi-packages `origin/main` at `7b0357d3` (newer than the issue's `60c22b0a`), plus `ship-issue.md` against upstream `ship.md`, and classified every hunk as Keep, Port, Prune, Fix, or Drop in `docs/plans/0077-resync-prompts-and-agents.md`.
The operator chose to port the killing-mutation workflow (`/tdd-plan` becomes red→green→verify→commit), to port the `AGENTS.md` admission test without `/audit-agent-docs`, and to fold the post-[#76] shared-skill delta into this issue.

### Observations

- The issue's drift table omitted `ship-issue.md` (296 lines), because its upstream counterpart is named `ship.md`; most of that is the worktree lane, which is dropped.
- pi-packages ran a 2026-09-29 agent-docs audit (`731f9fd1`) that pruned lines a loaded skill already states; the plan applies a prune only where it can name the carrying skill line (`tidy-first` 11/12/46/64, `testing` 158, `markdown-conventions`).
- Found stale local claims: both ship prompts say `fallow dead-code` "is not a CI gate here", but `ci.yml` gates it on `main`; the assessor's "Repo shape" lists 8 of 17 `src/` files; the reviewer's §2a still derives a `git describe` base ref that [#76] made a dispatcher input; `AGENTS.md` line 159 names upstream prompts by old names.
- `docs/architecture.md` has no roadmap, so the ported `✅` grep check is conditional and measures 0.
- Dry-ran every shell command the new prompt text prescribes (plan-commit grep, `rev-parse`/`merge-base`, the fork-run `total_count`, the lint redirect, non-TTY Vitest at 10 lines), per the upstream Test Impact rule the plan itself ports.
- Tidy-First assessment skipped: no `src/`/`test/` file changes.
- No follow-up issues filed; `/audit-agent-docs` is an open question, not a named follow-up.

## Stage: Implementation — Build (2026-09-30T05:37:33Z)

### Session summary

Completed all 7 plan steps as 7 `docs:` commits (`d641083`..`20a15f3`), plus one WARN-fix commit (`4f95aca`): the `AGENTS.md` admission test and `/retro` gate, `/plan-issue` and `/tdd-plan` killing-mutation workflow, both agents, both ship prompts, `/pr-review`, and the post-[#76] skill delta.
Pre-completion reviewer: WARN (two findings, both fixed), then PASS on the delta re-dispatch.

### Observations

- Every splice copied lines out of `/tmp` snapshots of the upstream files at `7b0357d3` by Python (`uplines`/`after`/`replace_line` helpers), so almost no em-dash was typed; every step's rumdl, split-sentence, escape, and form-feed scans stayed clean.
  The one flagged escape is the intentional `\u2014` inside backticks in the ported `shell-traps` zsh `echo` rule.
- `uplines` kept upstream's leading indentation, so four inserted list lines in `ship-issue.md` landed double-indented; caught by reading the diff before commit.
- Deviations: the `AGENTS.md` Project Prompts entry for `tdd-plan` also said red→green→commit and was updated in step 3; upstream's pi-packages killing-mutation example (`resolveBackgroundMode`) was replaced with this repo's `isAnthropicOAuthToken`; the reviewer's sanctioned-reads block had an upstream sentence split across two lines, rejoined; `pr-review.md`'s capability-gate sentence now says steps 3–6.
- Reviewer warnings (fixed in `4f95aca`): `ship-issue.md` reused `$PLAN` across fresh shells in the co-shipped scan; the reviewer's §2b still derived a `git describe` base ref, which the plan dropped only from §2a.
  §2b now uses the dispatcher's base ref, with the tag as a fallback.

## Stage: Final Retrospective (2026-09-30T05:43:46Z)

### Session summary

One session covered planning, build, ship, and this retro.
Nine `docs:` commits resynced the remaining prompts, agents, and post-[#76] skill delta with pi-packages `7b0357d3`, including the killing-mutation workflow and the `AGENTS.md` admission test.
The reviewer returned WARN (two findings, fixed in `4f95aca`) and then PASS, CI was green, and #77 closed with no release, since every path is outside the release scope.

### Observations

#### What went well

- Novel: the scripted splice from [#76] became a reusable helper file.
  `/tmp/splice.py` (`uplines`, `after`, `replace_line`, `drop`, `rep` with a match-count assert) drove every edit in all seven steps; each helper asserts a unique anchor, so a drifted anchor failed loudly instead of silently mis-editing.
  Result: zero non-ASCII corruption across 12 edited files, with the em-dashes almost never typed.
- The plan applied its own newly ported rule: every shell command the new prompt text prescribes was dry-run at planning time and re-run at build time, which is where the stale "fallow is not a CI gate" claim was confirmed against `ci.yml`.

#### What caused friction (agent side)

1. `missing-context` — the plan classified the reviewer's §2a `git describe` base-ref block as stale, but the same block also sat in §2b, and the plan listed only §2a.
   `/plan-issue` already says to grep the edited file for other passages describing the same sequence, but that rule is scoped to workflow step-order, and this was a duplicated command block.
   Impact: one reviewer WARN, one fix commit (`4f95aca`), and a delta re-dispatch.
2. `other` — porting upstream `ship.md` text verbatim carried a latent defect: the co-shipped scan reuses `$PLAN` from an earlier code block, which a fresh shell does not carry.
   Upstream has the same line.
   Impact: the other half of the WARN fix; no rework beyond one sentence.
3. `other` — `uplines` kept upstream's leading indentation, so five inserted list lines in `ship-issue.md` landed double-indented, and two ship splice runs aborted on anchors (a duplicated `PLAN=` line, a sentence split differently upstream).
   Impact: three extra tool calls; caught by reading the diff before commit, never committed.
4. `instruction-violation` (self-identified) — writing this retro entry by `Edit`, the first draft emitted every em-dash, section sign, and ellipsis as a literal `\u2014`-style escape (seven lines), the exact form `markdown-conventions` warns about.
   The build stage avoided it only because the splices were scripted; hand-authored prose regressed on the first try.
   Impact: one scan and one scripted repair, caught before commit.

#### What caused friction (user side)

- None this session; the three `ask_user` decisions were answered in one round and drove the plan directly.

### Diagnostic details

1. **Model-performance correlation** — every main-session turn, including the mechanical build splices and the ship stage, ran on `anthropic/claude-opus-5-5`.
   Both `pre-completion-reviewer` dispatches ran on `anthropic/claude-sonnet-5-5` (from the subagent transcripts), a good fit for the review.
   Unexplained: the `/ship-issue` invocation expanded the **pre-resync** template body (it still said fallow "is not a CI gate"), and its turns ran on Opus rather than the newly ported `model: anthropic/claude-sonnet-5-5, …` line, while `/retro`, whose file changed earlier in the same session, expanded the new body.
   The next `/ship-issue` in a fresh session should confirm both the new body and the Sonnet switch.
2. **Feedback-loop gap analysis** — `rumdl`, the three non-ASCII scans, the leak grep (`/tmp/verify77.sh`), and `pnpm run lint` ran after every build step; no gap.

### Changes made

1. `.pi/prompts/plan-issue.md`: widened the "grep the edited file itself" rule in Module-Level Changes to cover a dropped command block, not only a reworked workflow or step-order.
2. Proposed and handed to the operator to fix upstream: pi-packages `.pi/prompts/ship.md` uses `"$PLAN"` in step 8 (line 155) before step 9 defines it (line 170), and again in step 9's co-shipped scan (line 211) without re-deriving it; step 10 (line 224) is the only use that re-derives.

[#76]: https://github.com/gotgenes/pi-anthropic-auth/issues/76
