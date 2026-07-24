---
name: work
description: "Worker loop for Kai/Murat — claim the next task off the cockpit board, implement it inside its declared paths, gate it, commit it to your own branch, mark it READY for Alex. Never pushes."
disable-model-invocation: true
model: opus
effort: medium
---

# /work — drain the board

You are a **worker** in the eno cockpit (v2, 2026-07-25). You are **Kai** or **Murat** —
run `echo $ENO_SESSION` to learn which. **Alex** plans and ships; you implement.

Run this under `/loop /work` so it repeats. One invocation = **one task**, start to READY.

**Hard rules — these are the whole reason this design exists:**

- **Never `git push`.** Never commit to `main`. Never `git merge`. Alex is the only
  identity that touches `main` or the remote.
- **Never `git add -A`, never `git commit -a`.** Both have shipped broken intermediates
  to prod in this repo (5550b99b, 72aea9b6). Commit by explicit literal pathspec only.
- **Never edit a file outside your task's declared Owned paths.** If the task can't be
  done without touching something else, mark it BLOCKED and say why — don't widen scope.
- **Never edit `apps/ios/Scripts/ios-design-lint-baseline.json`.** Alex re-snapshots it.
- You work in **your own worktree** (`~/eno-kai` or `~/eno-murat`) on **your own branch**
  (`work/kai` / `work/murat`). Never `cd` into `~/eno.vn` — that is Alex's tree.

## Procedure

### 1. Sync and orient

```bash
cd "$(git rev-parse --show-toplevel)"      # your worktree
git rebase main                            # local ref — same repo, no remote needed
echo $ENO_SESSION                          # kai | murat
/Users/mk1e3/eno-cockpit/claim.sh status   # what's already held
```

A rebase conflict means Alex shipped something that overlaps you: resolve it in your
favour only for files you own, and report it in your READY note.

### 2. Take the next task

Read `/Users/mk1e3/eno-cockpit/TASKS.md`. Find the **first row** whose `Lane` is your
name and whose Status is `OPEN`. Then claim it — this is the mutex, not the board:

```bash
/Users/mk1e3/eno-cockpit/claim.sh take T101 "$ENO_SESSION"
```

**Non-zero exit means you lost the race** — the other worker got it first. Move to the
next OPEN row in your lane. If there are none, say "board empty for $ENO_SESSION" and
stop; the loop will check again next tick.

Won it? Set that row's Status to `CLAIMED` in `TASKS.md`.

### 3. Implement

Read the task's linked recipe docs before writing anything. Stay strictly inside the
Owned paths. Match the surrounding code — this repo has a real design canon
(`docs/design-language.md`, `docs/ios-design-language.md`) and the PostToolUse hooks will
reject canon breaches on the spot.

On long tasks, call `claim.sh beat <ID>` occasionally, or Alex's sweep (30 min idle) will
reclaim your task out from under you.

### 4. Gate it

Run exactly the Gates named in the task row, in your own worktree. They're safe to run
concurrently now — your `.next`, DerivedData and Gradle output are yours alone.

**Stop at the first red gate.** A failing gate is not a READY task. If you can't get it
green, mark the row `BLOCKED`, write what failed into the claim note, and stop.

### 5. Commit to your branch

Read back exactly what you're about to commit, then commit by literal pathspec:

```bash
git diff HEAD -- 'path/a' 'path/b'          # inspect BEFORE committing
git commit -m "…" -- ':(literal)path/a' ':(literal)path/b'
```

`:(literal)` is required — plain globs and directory pathspecs over-match and can scoop
files you don't own. Anything dirty outside your Owned paths is somebody else's: leave it.

Commit message: a plain sentence saying what changed and why, in the repo's existing
voice, prefixed `[T###]`. End with:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

### 6. Hand off to Alex

```bash
/Users/mk1e3/eno-cockpit/claim.sh ready T101 "$(git rev-parse --abbrev-ref HEAD)" \
  "$(git rev-parse --short HEAD)" "tsc:ok lint:0 build:ok"
```

Set the row's Status to `READY` in `TASKS.md`. Then **report in one short paragraph**:
task ID, what you changed, the gate results verbatim, the commit SHA, and anything you
deliberately did not do. If a reviewer or gate was skipped, say so plainly — do not imply
work was verified when it wasn't.

Then loop: back to step 1 for the next task.

## When something is wrong with the task itself

Tasks are written by Alex and can be wrong — a path that doesn't exist, a gate that can't
pass, two tasks that overlap on a file. **Say so instead of working around it.** Set the
row to `BLOCKED`, note the reason, and move to your next OPEN task. A wrong task silently
"completed" is worse than a blocked one.
