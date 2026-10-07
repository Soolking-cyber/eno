---
name: preview
description: How to preview eno.vn locally before calling anything ready — the :3000-only port rule, dev vs production-preview commands for both editions, the bounded wait for the "── serving" marker, and why `next dev` and `npm run start` are not previews. Load before starting a dev/preview server or pointing verify:local / e2e at localhost.
---

Moved out of the root CLAUDE.md (2026-09-26, /doctor) so it loads only when a preview is needed; the
three hard rules stay in the root. The bounded-wait shell recipe is `ship` skill step 2.

# Local review, before saying anything is ready

```bash
npm run dev:vn          # marketplace, :3000   — fast iteration, hot reload
npm run dev:forum       # services,    :3001   — ⚠️ NOT at the same time, see below
npm run preview:vn      # marketplace, :3000   — PRODUCTION build, the real artifact
npm run preview:forum   # services,    :3101   — CAN run alongside a dev server
npm run verify:local    # unit + tsc + smoke + seo + content + sec-probe vs :3000
E2E_BASE=http://localhost:3000 npm run e2e:guest
```

⚠️ **THE MARKETPLACE LIVES ON :3000 AND NOTHING ELSE (owner, 2026-08-17: "kill 3000 and 3100
use only 3000 from now on").** `dev:vn` and `preview:vn` deliberately share the port — you
are meant to run ONE of them, and `preview.mjs` kills whatever holds :3000 before binding.
The old split (dev on 3000, preview on 3100) existed to dodge a squatting `next-server`, and
it cost more than it saved: two ports meant two things to check, and on 2026-08-17 a
**three-day-old** server on :3000 served stale code that read as a live bug, while the real
build sat on :3100. One port, force-claimed, so "what is on :3000" has exactly one answer.
⚠️ A server that loses the bind does NOT fail loudly — Node exits with EADDRINUSE and the OLD
process keeps answering 200 (`next dev` is worse: it silently moves to :3001). `preview.mjs`
and `dev:vn` both free the port BEFORE building, via `scripts/free-port.mjs`, which aborts
rather than continuing if it cannot take it.
⛔ **So wait for the `── serving` line, never for the port to answer 200.** The port is free
for the whole build, so a 200 in that window is by definition another server — polling for one
runs your suite against the wrong build and then loses it mid-run when the real one binds.
`preview.mjs` emits that line only after confirming the child it spawned is alive AND holding
the port. ⚠️ **Bound the wait and watch the process** (`kill -0 $!`): a build failure never
writes the marker, so a bare `until grep` turns a RED gate into a silent hang. The recipe is
in the `ship` skill — copy it rather than improvising one.

⚠️ **:3000 no longer implies "production build" — that is the accepted cost of one port.**
`dev:vn` and `preview:vn` both live there, so `verify:local` / `e2e:guest` pointed at :3000
while a dev server is up will happily test `next dev`, which does not exercise prerendered ISR
HTML, inlined `NEXT_PUBLIC_*`, or edition exclusion. Start the preview yourself and wait for
its marker; do not inherit whatever is already running.

**`preview` is a clean production build, not `next dev`, and the difference is the point.**
Three bug classes are invisible in dev and have each reached prod: prerendered ISR HTML (the
home page bakes listing data at build time), the inlined `NEXT_PUBLIC_*` values every
canonical and OG url derives from, and edition exclusion (`.svc.` routes only disappear
because `next build` resolves `pageExtensions`). `preview` also wipes `.next` first, because
a stale chunk from the other edition survives an incremental build — the leak class
`edition-lint` exists to catch.

⚠️ **One edition at a time**: both build into the same `.next`, so the second overwrites the
first. Run it twice when a change touches both. And `npm run start` alone is NOT a preview —
`next build` does not copy `.next/static` or `public/` into the standalone bundle (the
Dockerfile does it in two COPY lines), so every asset 404s. `scripts/preview.mjs` does that
copy; that is most of why it exists.
