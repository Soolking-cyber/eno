# Multi-session coordination board

Two or more Claude Code sessions often work this repo **in the same worktree**.
This file is the live claims board. Protocol (also in CLAUDE.md, "Parallel
sessions"):

1. **Before starting a work item**: read this file + TaskList. Claim your item
   here (edit the table) and set the task's owner. Pick tasks the other
   session hasn't claimed.
2. **Stage explicitly — NEVER `git add -A` at the repo root.** The 5550b99b
   incident: a blanket add scooped another session's mid-flight edit and
   shipped a broken intermediate to main. Stage the exact files you changed
   (hook-generated files like src/generated/ui-strings.ts belong to whoever
   triggered the regeneration).
3. **Before committing**: `git status` — anything dirty outside your claim is
   the other session's; leave it unstaged. If HEAD moved since your gates ran,
   re-run tsc before pushing.
4. **Release your claim** (update the row) when the item lands.

| Session (started) | Claim | Files / area | Status |
|---|---|---|---|
| A (~2026-07-19 am, "audit" session) | Task #113 — structural extractions + §G perf + lint-zero | listings-explorer + extracted seams, forum-client rails/use-forum-feed, admin perf files | in progress (aa55d767, f15dc2af, 75043dda, 9341756c) |
| B (~2026-07-19 pm, "migration" session) | Task #114 — GCP cutover (DNS flips, schedulers, lockdown, Vercel decommission) + SEO wave follow-ups | Cloudflare zones, gcloud infra, docs/gcp-migration.md, sitemap/robots/footer/metadata files from 5550b99b | in progress |
