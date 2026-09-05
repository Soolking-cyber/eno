# Agent orientation — what is deployed, from where (verified 2026-09-05)

- **One codebase, deployed twice.** The repository ROOT is the whole product. It is built into two
  images on the VN box — `eno-vn` (eno.vn, the licensed marketplace, :3001) and `eno-forum`
  (eno.forum, marketplace + visa/itinerary/PayPal, :3002) — by `infra/vn-node/eno-deploy.sh`, the
  only path to users. An edition flag inlined at BUILD time decides which surfaces exist in each
  image; see the "Shipping" section of CLAUDE.md for the legal boundary and its leak modes.
- **A push is not a deploy.** Nothing deploys automatically from `main`. The owner runs the deploy
  script on the box; it purges Cloudflare itself. Vercel and Cloud Run are retired (July/August
  2026) — a doc that says a push deploys, or names a Vercel project, is describing history.
- **`apps/forum/` is a dormant, separate app.** It was the eno.forum source until the 2026-07-31
  reversal (visa/itinerary/PayPal moved to a services EDITION of the root, not a second codebase)
  and nothing builds or deploys it now. It still carries its own `package-lock.json`, `Dockerfile`,
  `cloudbuild.yaml`, README and the CI job `forum-e2e`, all of which describe a deployment that no
  longer exists. Do not port root changes into it and do not fix product bugs there; a fix ships
  by landing in the root and deploying both editions. Whether the tree is deleted is the owner's
  call (a few forum-only assets, like the Browserbase hosted-prefill flow, live only there).
- **Reviewer seats (codex, agy, fable)** review the STAGED diff via `scripts/second-opinion.mjs`
  at plan and at diff time. They do not commit, push or deploy; the commit hook checks the receipt.
- The former `/Users/mk1e3/eno-forum` checkout and the `Soolking-cyber/eno-forum` repository are
  retired migration history. Never edit, commit, push or deploy from them.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
