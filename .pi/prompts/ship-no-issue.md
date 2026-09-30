---
description: Push, verify CI, and dispatch the release (no issue to close)
---

# Ship (no issue)

## 1. Sync with remote

Before pushing, make sure local `HEAD` is current with the remote:

1. Run `git pull --ff-only`.
2. If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure to the user.
   Do not attempt to stash, rebase, force, or otherwise resolve.
3. Only proceed once the pull reports a clean fast-forward (or `Already up to date.`).

## 2. Pre-push checks

Mirror what CI runs (`.github/workflows/ci.yml` runs these on every push and PR):

1. `pnpm run check` — typecheck.
2. `pnpm run lint` — biome, eslint, and rumdl.
3. `pnpm test` — the vitest suite.
4. `pnpm fallow:dead-code` — CI runs this gate on every `main` push (not on PRs), so a pre-existing failure blocks your push regardless of whether this work introduced it.

Run each gate unpiped — a pipeline's exit status is the filter's, so `pnpm run lint | tail` reports success on a failure.
Redirect instead: `pnpm run lint >/tmp/lint.log 2>&1 || tail -30 /tmp/lint.log`.

If any fails, fix the issues and commit before pushing.

If this session did not run `/tdd-plan` or `/build-plan`, dispatch the `pre-completion-reviewer` subagent before pushing — ad-hoc work otherwise reaches a tagged release with no fresh-context review.

## 3. Push

- Determine the current branch (`git branch --show-current`).
- `git push`.
- If the push is rejected as non-fast-forward, stop and report — do not force-push.

## 4. Verify CI on the pushed commit

1. Run `git rev-parse HEAD` to capture the full SHA, and pass that exact value to `ci_find` with workflow `ci` — never hand-expand the short SHA from the `git push` output.
   If `ci_find` times out, re-check the SHA you passed against `git rev-parse HEAD` before assuming a timing miss.
2. Use `ci_watch` with the returned `run_id`, workflow `ci`, and `timeout: 600` to wait for it to complete.
3. If the run conclusion is `failure`, stop and report.
   Do not merge anything.
4. If it lands `success`, continue.

## 5. Dispatch the release (if anything is releasable)

1. Ask what would release:

   ```bash
   ./scripts/release/next-version.sh
   ```

   It prints the tag it would cut (`vX.Y.Z`), or nothing.
   Read-only and offline; it never mutates anything.
2. If it prints nothing, skip to step 6.
3. There is no issue plan here to say whether this push was meant to release, so **show the operator the tag and ask** before dispatching — do not release just because something is releasable.
4. Dispatch the confirmed release, pinning the commit:

   ```bash
   gh workflow run release.yml -f sha="$(git rev-parse HEAD)"
   ```

5. Follow it with `ci_find` (workflow `release`, that same SHA) and `ci_watch` with `timeout: 600`, then `git pull --ff-only`.
   If `prepare` fails, nothing was tagged and the release can be re-dispatched.
   If `publish` or `github-release` fails, the tag is already pushed — re-run that job rather than re-dispatching.

## 6. Final report

Print:

- The new HEAD on `main` (`git log --oneline -1`).
- The released version, if a release commit just landed (`git tag --points-at HEAD` or read `package.json`).
- Anything that was skipped and why.

## Constraints

- Never force-push.
- Never dispatch a release without the operator's confirmation (step 5.3) — this flow has no plan to say what the push was for.
- Never re-dispatch a release after `prepare` succeeded; the tag exists, and the run would refuse on it (step 5.5).
- If CI fails, do not dispatch a release.
