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

[#76]: https://github.com/gotgenes/pi-anthropic-auth/issues/76
