# eno.vn — Documentation

Engineering + integration docs for **eno.vn**, a verified marketplace for Vietnamese expats
(Next.js 16 App Router · Prisma 7 · Supabase Postgres · **Cloud Run** + Cloudflare).

<!-- docs-lint-allow: this warning DESCRIBES the drift; naming Vercel/Upstash is its whole purpose -->
> ⚠️ **These docs drifted badly and are being corrected.** Audited 2026-08-05: `ARCHITECTURE.md`
> still describes hosting on **Vercel** (38 mentions) and rate limiting on **Upstash Redis** (15),
> neither of which has existed since July 2026 — there is no `vercel.json`, and `upstash` appears
> zero times in `package.json`. Treat any *infrastructure* claim in `ARCHITECTURE.md` as suspect
> until it has been checked against the code; the *domain* sections (data model, trust, messaging,
> search) were not affected. `scripts/docs-lint.mjs` now fails the build on the specific false
> claims, so this class cannot silently return.

## ⚠️ Two editions, one codebase — the fact everything else depends on

**eno.vn is a licensed Vietnamese company (sàn TMĐT) and may not legally offer e-visa services,
itinerary services, or PayPal checkout.** Those live on **eno.forum**. Both are built from THIS
repository and deployed twice; `NEXT_PUBLIC_ENO_EDITION` decides which surfaces exist.

| | eno.vn (`marketplace`) | eno.forum (`services`) |
|---|---|---|
| marketplace | ✅ | ✅ (identical) |
| visa · itinerary · PayPal | ⛔ **not even a mention** | ✅ |

The failure mode is a **leak**, not a crash: anywhere the marketplace edition shows, links to,
describes, indexes, emails or serves one of those surfaces, the licensed company is advertising a
service it is not licensed for. Visa products are ordinary `Listing` rows sharing one `Seller` with
the trip desk, so browse, search, rails, sitemap, JSON-LD and the Google/Meta feeds leak them
unless filtered — that is the likeliest thing to miss, and it has nothing to do with the `/visa`
pages. Enforced by `src/lib/edition.ts`, `pageExtensions` + the `.svc.` convention in
`next.config.ts`, `turbopack.resolveAlias` stubs, and `scripts/edition-lint.mjs`.

This was documented in **none** of the core docs before 2026-08-05, which is why it leads now.

## Core

| Doc | What it covers |
|---|---|
| [**ARCHITECTURE.md**](./ARCHITECTURE.md) | The whole platform — stack & runtime, data model, auth, listings, search/ranking, trust, messaging, AI, dashboard/bulk, growth/feeds, and ops/security — with `file:line` citations. Start here, minding the drift warning above. |
| [**API-REFERENCE.md**](./API-REFERENCE.md) | Every `/api/*` route inventoried: method, auth class, rate-limit, request/response, purpose. Grouped by domain with an auth legend. ⚠️ Its route count is stale — 181 route files exist today. |
| [**PARTNER-API-ROADMAP.md**](./PARTNER-API-ROADMAP.md) | The path to **programmatic shop management** — for partners' own systems and for AI agents. Per-shop auth (API keys / OAuth2), a versioned `/api/v1`, quotas/idempotency/webhooks, an **MCP server** so AI agents manage shops in natural language, and a phased build plan (reuse-existing vs build-new). |

## Operational runbooks

| Doc | What it covers |
|---|---|
| [vertex-search-setup.md](./vertex-search-setup.md) | Vertex AI Search (the AI concierge / semantic search backend) setup. |

## History

<!-- docs-lint-allow: explains why history/ is exempt; naming the retired platform is the point -->
`docs/history/` holds finished write-ups — records of what was done once, not guidance for what to
do now. They are excluded from `scripts/docs-lint.mjs` precisely because describing a retired
platform is their *job*: [hosting-migration.md](./history/hosting-migration.md) and
[gcp-migration.md](./history/gcp-migration.md) are the Vercel → Cloud Run move, and reading them as
current instructions is what the drift warning above is about.

## Conventions

<!-- docs-lint-allow: this bullet FORBIDS the command; naming it is how the warning works -->
- ⛔ **Schema changes do NOT use `prisma db push`.** This line used to say they did, and following it
  destroys data: the database holds **67 tables against 52 Prisma models**, so `db push` reconciles
  the database *to* the schema and emits **18 `DROP TABLE`** statements — `visa_applications` (live
  applicant PII), the Postgres rate limiter (`rl_window`, `rl_cooldown`), the rotating OTP chain
  (`zalo_oauth_token`), `next_cache`, and more. The flow was safe when it was written and became
  lethal as tables were added outside Prisma, with no warning from Prisma itself.
  **The safe flow is `prisma migrate diff` → read the SQL → apply only the additive statements**, in
  full in [CLAUDE.md](../CLAUDE.md) and printed by the guard. `npm run db:push` / `db:setup` /
  `db:reset` now refuse to run and print it. The non-destructive half — realtime triggers, unique
  indexes, rate-limiter functions, compliance objects — is `npm run db:ddl`, and that is what you
  want after a restore.
<!-- docs-lint-allow: states the limiter is Postgres and names Upstash only as retired -->
- **Security posture:** RLS is bypassed by design; **app code is the only access guard**. Paid/PII
  routes fail *closed* when the limiter is unavailable; the `/api/*` surface is edge-pinned behind
  Cloudflare. The limiter is **Postgres**, not Redis (`src/lib/ratelimit.ts` — Upstash was retired
  2026-07-20).
- **Observability:** structured JSON to stdout via `src/lib/log.ts` → Cloud Logging → Error
  Reporting. Every server-side throw is captured by `src/instrumentation.ts`. No agent, no SDK.
- **Docs are generated from the code** via the `eno-docs-and-api-path` workflow — regenerate after
  large changes rather than hand-editing the big three above. ⚠️ That regeneration is what drifted:
  it had not been re-run since the platform moved off Vercel, so the generator's output outlived its
  subject. `scripts/docs-lint.mjs` is the backstop.
