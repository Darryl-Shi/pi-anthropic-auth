---
description: Review this session for workflow improvements and persist retro notes to docs/retro/
model: anthropic/claude-opus-5-5
---

# Review session and persist retro notes

The user wants a retrospective on this session.
Issue number (if provided): `$1`

## Sync with remote (do this first)

Before reading anything, make sure the working tree is up to date with the remote:

1. Run `git pull --ff-only`.
2. If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure to the user.
   Do not attempt to stash, rebase, force, or otherwise resolve.
3. Only proceed once the pull reports a clean fast-forward (or `Already up to date.`).

## Load skills

Before investigating or proposing changes, load skills relevant to the retro.
Skip any already in this session's context — the trunk flow runs planning, implementation, ship, and retro in one process — but re-load after a compaction, which drops the body while leaving the memory of having read it.

- Load the `ask-user` skill for the structured clarification flow.
- Load the `anthropic` skill for package-specific architecture, OAuth compatibility lessons, priorities, and testing context.
- Load the `markdown-conventions` skill for writing the retro file.
- Load the `code-design` skill if proposing code-related adjustments to prompts or `AGENTS.md`.

## Session naming

After identifying the issue number and title, call `set_session_name` with name `#N Retrospective — <issue title>` to identify this session in the session selector.

## Step 1 — Identify the retro file

1. If `$1` is set, treat it as the issue number `N`.
2. Otherwise, infer `N` from recent commit subjects (`git log --oneline -25`; look for `(#N)` at the end of `feat:`, `fix:`, or `docs:` commits).
   If multiple issues appear, list them and ask the user which to retro on with `ask-user`.
3. Resolve the slug: find the plan for issue `N` at `docs/plans/NNNN-<slug>.md` and reuse its slug.
   If no plan exists, derive a short slug from the issue title via `gh issue view N --json title -q .title`.
4. The retro file is `docs/retro/NNNN-<slug>.md`.
   Create the directory if missing.

## Step 2 — Synthesize observations

Review what happened across this session — the user prompts, your tool calls, corrections, rework, and commits.

If the retro file already contains stage entries from prior sessions (sections headed `## Stage: <name> (<timestamp>)`), read them as primary context.
Your synthesis should span all stages — not just this session.
Look for patterns that recur across stages, friction that compounds, and whether earlier observations led to adjustments.
When the issue spanned multiple sessions, read the prior stages' transcripts, not only their breadcrumbs: `list_session_files({ cwd })` lists this repo's sessions newest-first (the filename embeds the session id), and `read_session_file({ path })` renders one — repeated friction shows only in the transcript.

Be specific: cite file paths, commit subjects, and concrete tool sequences.
Categorize each friction point with one label:

- `premature-convergence` — picked the first viable approach without exploring alternatives
- `missing-context` — didn't check existing code, docs, conventions, or upstream specs
- `wrong-abstraction` — operated at the wrong level (mechanical when strategy was needed, or vice versa)
- `scope-drift` — went beyond what was asked or missed the actual ask
- `rabbit-hole` — chased symptoms instead of questioning assumptions
- `instruction-violation` — had clear instructions in `AGENTS.md` or the prompt but didn't follow them
- `other` — describe

For each friction point describe the **concrete impact**: time wasted, rework caused, follow-up commits needed, or "added friction but no rework."

Note whether each `instruction-violation` was **self-identified** (you caught it mid-session) or **user-caught** (the user pointed it out).
Self-identified failures usually indicate a salience tweak; user-caught failures may indicate the rule needs to be more prominent.

### Bidirectional feedback

Look for moments where the user could have shared context earlier, intervened with a redirecting question instead of a correction, or where their involvement was mechanical oversight rather than strategic judgment.
Frame as opportunity, not criticism.

### Novel wins only

Record wins only if they are novel or surprising — a new pattern working for the first time, a tool proving its value, a notably clean execution.
Skip routine successes.

### Diagnostic lenses

After categorizing friction points, run these four structured analyses.
Include findings in the retro file under a `### Diagnostic details` subsection when any lens produces actionable observations.
Skip a lens entirely when it finds nothing notable.

1. **Model-performance correlation** — for each subagent dispatch (if any), note which model ran and what task it performed.
   Flag quality mismatches: a reasoning-weak model on judgment-heavy work (architecture decisions, code review), or a high-cost model on purely mechanical work (formatting, simple grep).
   If the `read_session`, `read_parent_session`, or `read_session_file` tools are available, attribute each turn from the inline `[provider/model]` label the transcript renders on it, in a **type-unfiltered** call.
   A `types: ["model_change"]`-filtered call bypasses phantom-switch suppression and renders switches that never ran a turn.
   `offset` and `elide_user_text` are not type filters and are the intended way to run this lens on a long multi-stage session: page backward with `{ limit: N }` then `{ offset: N, limit: N }` rather than re-requesting a larger window, and set `elide_user_text: true` to drop prompt bodies the lens never reads while keeping every label.
   A rewound session renders only its live path, so the turns the lens counts are the ones that survived; an `[abandoned branch] N entries omitted` line marks each stretch that did not, and `branches: "all"` renders it when the abandoned attempt is itself the subject.
   `[session] → <name>` lines mark the stage boundaries to attribute each run of turns to.
   Use `read_session`/`read_session_file`, not `jq` over `$PI_SESSION_FILE`, and never `PI_MODEL`/`PI_PROVIDER`, which report only the session's *current* model and invent an attribution when extrapolated across stages.
   A subagent's turns live in its own transcript, which `list_subagent_sessions({ path })` finds for a given session file and `read_session_file({ path })` renders — attribute a subagent's model from that transcript rather than from its agent definition, which records the model it was configured with and not the one that ran.
2. **Escalation-delay tracking** — for each `rabbit-hole` friction point, count how many consecutive tool calls the agent spent on the same error or approach before resolving or changing strategy.
   Flag sequences longer than 5 consecutive tool calls on the same error as "should have dispatched an Explore or Plan subagent" or "should have asked the user."
3. **Unused-tool detection** — for each `rabbit-hole` or `missing-context` friction point, check whether a subagent type or tool was available that could have helped but was never dispatched.
   Examples: an Explore agent for codebase understanding, `colgrep` for semantic search, `web_search` for library docs.
4. **Feedback-loop gap analysis** — check which verification tools the agent ran (`pnpm run check`, `pnpm test`, `pnpm run lint`) and when in the session they were invoked.
   Flag cases where verification ran only at the end rather than incrementally after each change.

## Step 3 — Write the retro file

Append (or create) `docs/retro/NNNN-<slug>.md` with this structure.
When creating a new file, include YAML frontmatter (see the `markdown-conventions` skill § Documentation frontmatter):

```markdown
---
issue: N
issue_title: "<exact title from `gh issue view N`>"
---

# Retro: #N — <issue title>

## Stage: Final Retrospective (<ISO 8601 timestamp>)

### Session summary

2–3 sentences on what was accomplished.

### Observations

#### What went well

- ...

#### What caused friction (agent side)

- `<label>` — <description>.
  Impact: <concrete impact>.

#### What caused friction (user side)

- ...
```

If the file already exists with prior stage entries, **append** the new entry — do not overwrite existing content.
Anchor the `Edit` on the file's last line or use `Write` with the full content — the repeated `### Observations` / `### Session summary` headers make header-anchored edits ambiguous.
The retro file accumulates entries across sessions.

Wrap all code identifiers, filenames, route paths, CLI names, and any text containing underscores in backticks.

## Step 4 — Present highlights and proposals (before asking)

Surface the synthesis as regular message text **before** invoking `ask-user`.
The message must include:

1. **Cross-session highlights** — 2–4 short paragraphs synthesizing dominant friction patterns and any wins worth promoting.
   Not a copy of the retro file — the bridge between observations and proposals.
2. **Per-proposal context** — for each proposed change: the concrete pain (with tool-call counts or specific examples), why the proposed location is the right home, and the proposed content as a fenced block.
3. **What you considered but did not propose** — name candidate changes you rejected and why.

Candidate change locations:

- `AGENTS.md` — project-wide priorities, code style, conventions.
- `.pi/prompts/*.md` — slash-command prompt bodies.
- New skill or new prompt — only if the rule is reusable across many sessions.

## Step 5 — Ask before editing

Use the `ask-user` skill once to confirm which proposals to implement.
The question itself stays a single sentence; the context belongs in the message above.

## Step 6 — Implement approved changes (with scope discipline)

The retro session is scoped to **observations and small consensus-driven adjustments**, not substantive rework.
A retro commit (`docs(retro): ...`) should land the retro file plus small (~1–3 file) prompt or `AGENTS.md` adjustments the user explicitly confirmed.

If a proposed change is larger — touches more than ~3 files, restructures content significantly, or rewrites a prompt's scope — record it in the retro file as a follow-up but **do not** implement it inline.
Suggest the user open a GitHub issue and run `/plan-issue` on it.

## Step 7 — Verbosity check before landing changes

Retro-driven additions to `AGENTS.md` and prompt bodies should land as **rule + tight example**, not **rule + rationale + worked example**.
The retro file is the right home for rationale and worked examples.

First, put each proposed addition to `AGENTS.md`, a skill, a prompt template, or an agent definition through the `## Admission test` in `AGENTS.md`.
A passage that fails its first question is not landed anywhere; one that fails its second is landed in the named skill's body instead.
For a template, the second question fails when a skill the template loads already owns the rule — land it there, or nowhere if it is already said.
For an agent definition, it fails when the child already gets the rule from `AGENTS.md`, its dispatch prompt, or a skill its body tells it to load.

Then, for what passes, ask:

1. **Rationale placement** — is the *why* in the retro file, or has it leaked into `AGENTS.md`/prompt?
   If the latter, move it back and leave a one-clause justification, with a `Refs #N` pointer only when the issue encodes an active constraint a reader may need to trace.
2. **Example tightness** — can the example fit in one or two lines?
3. **Hedging audit** — phrases like "should generally," "typically," "usually" often signal the rule isn't crisp enough.
   Name the exceptions or drop the hedge.
4. **Sentence length** — sentences over ~30 words usually carry rationale that should be split out.

## Step 8 — Record changes made

After implementing, edit the retro file directly to append a `### Changes made` subsection under the Final Retrospective stage entry — a numbered list of changes with file paths.
Do not split this into multiple sections; one coherent list per retro.

## Step 9 — Commit and push

1. `git add` the retro file (`docs/retro/`), `AGENTS.md`, `.pi/prompts/`, and any other touched files.
2. Commit as `docs(retro): add retro notes for issue #N`.
   Split any `src/` or `test/` change into its own `test:`/`refactor:` commit first — `src/` is inside the release scope, so bundling code under a `docs:` commit cuts a pointless patch release.
3. `git push`.

If the user suggests further refinements after the commit, implement them, append to the same `### Changes made` section, and commit again.
Every change made during the retro must be recorded before the session ends.

## Step 10 — Recommend the next issue

After the retro is committed, surface the next issue to work on so the operator can start it directly.
Derive it from the shipped issue's roadmap: read the plan's dependency diagram or `docs/architecture.md` for the step this issue unblocks (e.g. "unblocks #M", the next incomplete numbered step).
If a successor exists, recommend `/plan-issue #M` (name the step).
Re-check state with `gh` — this ship may have already closed the successor.
If the roadmap queues nothing, say so explicitly.

## Rules

- Be conservative — only propose changes clearly justified by evidence in this session.
- Be specific — provide exact proposed text, not vague suggestions.
- Look for removals alongside additions.
- Don't duplicate — check whether a rule already exists in `AGENTS.md`, a skill, or a prompt before adding, and apply the `AGENTS.md` admission test to decide which of those it belongs in.
- Do not edit `CHANGELOG.md` — the release workflow owns it.
