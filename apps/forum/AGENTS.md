# `apps/forum` — DORMANT. Nothing here builds, ships, or serves eno.forum.

⛔ **READ THIS BEFORE ACTING ON ANYTHING IN THIS DIRECTORY.** Every instruction this file used to
carry described a deployment that no longer exists, and following it would send changes to a tree
that reaches no user. Reconciled 2026-09-06 against the live deployment.

## What is actually true

- **eno.forum is served by the repository ROOT**, built a second time as the SERVICES edition
  (`NEXT_PUBLIC_ENO_EDITION=services`). The forum, itinerary builder, concierge and e-Visa surfaces
  that users reach all live under `/Users/mk1e3/eno.vn/src/**`, gated by `IS_SERVICES` and the
  `.svc.` route infix. Root `CLAUDE.md` is the authority; this file only exists to stop someone
  editing the wrong tree.
- **This directory is kept, not maintained.** Owner: *"dont delete project itself let it sit in git
  so we can host it later"*. It is dormant SOURCE — read it for reference, do not treat its presence
  as evidence that anything deploys from it.
- **Two things here are still load-bearing and are named in root `CLAUDE.md`**: the Browserbase
  hosted-prefill operator flow (`src/lib/visa/hosted-prefill.ts` and its two routes), which has no
  equivalent in the root tree — porting or abandoning it is an owner decision, not a cleanup; and
  the six `src/lib/visa/*` files byte-coupled to their root copies by `src/lib/sync-pairs.test.ts`,
  which fails the ROOT vitest suite if one side is edited alone.

## What was wrong here, so nobody restores it

- *"the sole source of truth for eno.forum"* — it has not been since the 2026-07-31 edition split.
  The services edition is the root codebase.
- *"an independent Next.js application and Vercel project… Root Directory `apps/forum`"* — the
  Vercel projects were **deleted** in the GCP migration, and Cloud Build was removed on 2026-08-22.
  Code reaches users only when `infra/vn-node/eno-deploy.sh` runs on the box.
- *"Codex owns `apps/forum/**`… Claude owns the commit and push"* — the two-agent split is retired.
  One session plans, implements and ships; codex is a REVIEWER seat in `scripts/second-opinion.mjs`.
- *"Vercel builds automatically afterward"* — nothing builds automatically. A push is not a deploy.

## What still applies, because it was never about this directory

- The retired `/Users/mk1e3/eno-forum` checkout and the `Soolking-cyber/eno-forum` repository are
  migration history: never edit, commit, push or deploy from either.
- Both editions share one database and one eno account. Keep cross-origin tokens server-only or
  single-use, and keep OAuth callbacks outside verified-link path capture.
- Public forum, itinerary and visa UI support the same 11 languages as the marketplace: preserve
  English and hand-authored Vietnamese, translate the rest through the cached service.
- Design priorities: open borders, balanced spacing, visual symmetry, consistent control heights.
  Calm layouts over dense decoration; check desktop and mobile together.
