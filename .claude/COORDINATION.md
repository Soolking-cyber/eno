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

**Names (owner, 2026-07-19): the two workers are KYLE and MURAT** — assigned by the
cockpit launcher (`~/eno-cockpit.sh`, wired into the SessionStart hook; it also keeps
the two second-opinion terminals, Codex and Agy, open). At session start run
`echo $ENO_SESSION` to learn which one you are; sign this board with that name.

| Session (started) | Claim | Files / area | Status |
|---|---|---|---|
| **Kyle** (worker #1 — ex-A, audit lane) | Task #113 — structural extractions + §G perf + lint-zero | listings-explorer + extracted seams, forum-client rails/use-forum-feed, admin perf files, providers.tsx | **COMPLETE + RELEASED** (75043dda, f15dc2af, aa55d767, 9341756c, be385a0a, a3359f50 api-listings split, 0b98ce4a post-wizard split). Task #113 closed; nothing left unclaimed from the audit |
| **Murat** (worker #2 — ex-B, migration lane) | Task #114 — GCP cutover + SEO follow-ups | Cloudflare zones, gcloud infra, docs/gcp-migration.md, forum next.config, sitemap/robots/footer/metadata files | CUTOVER COMPLETE: BOTH domains on GCP, ingress locked (run.app 404s — use domains for smoke/e2e), crons on domain URLs; **Vercel DECOMMISSIONED 2026-07-19** (owner waived soak; projects eno + eno-forum deleted, sdc-shop kept; RESEND_API_KEY live v6) |
| **Murat** (cont.) | Vercel remnants purge + AI-503 fix | vercel.json (delete), .claude/skills/ship/SKILL.md, eno-root-env secret (GOOGLE_VERTEX_CREDENTIALS was quote-mangled → sh sourcing dropped it → all /api/ai/* 503; re-encoded base64) | IN PROGRESS — secret v7 push + redeploy pending owner-run command (classifier-blocked) |
