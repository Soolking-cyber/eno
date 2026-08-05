# eno.vn — Platform Architecture

eno.vn is a verified marketplace for Vietnamese expats: Next.js 16 (App Router, Turbopack) + Prisma 7 (driver adapters) over Supabase Postgres, served via Cloud Run behind Cloudflare. This document maps the whole system — runtime, data model, every subsystem, and the security/ops posture — with `file:line` citations. See also [API-REFERENCE.md](./API-REFERENCE.md) and [PARTNER-API-ROADMAP.md](./PARTNER-API-ROADMAP.md).

## Contents

- [Stack & Runtime Architecture](#stack-runtime-architecture)
- [Data Model](#data-model)
- [Auth & Identity](#auth-identity)
- [Listings & Posting](#listings-posting)
- [Search, Facets & Ranking](#search-facets-ranking)
- [Trust & Reputation](#trust-reputation)
- [Messaging & Contact](#messaging-contact)
- [AI features](#ai-features)
- [Seller Dashboard & Bulk Operations](#seller-dashboard-bulk-operations)
- [Growth, Feeds & Analytics](#growth-feeds-analytics)
- [Ops, Security & Deploy](#ops-security-deploy)

---

## Stack & Runtime Architecture

eno.vn is a server-rendered Next.js marketplace deployed on Cloud Run (asia-southeast1) behind Cloudflare, with all persistence in a single Supabase Postgres instance reached through Prisma 7 driver adapters. This section describes the runtime stack and traces a request end-to-end. File references are to the actual source.

### Stack at a glance

| Layer | Technology | Pinned version | Source of truth |
|---|---|---|---|
| Framework | Next.js App Router + Turbopack | `16.2.9` (declared `^16.1.1`) | `package.json`, `next.config.ts` |
| UI runtime | React | `19.x` | `package.json` |
| Node | `>=24` | engine gate | `package.json:engines` |
| ORM | Prisma + `@prisma/adapter-pg` (node-postgres `pg` 8.22) | `7.8.0` | `src/lib/db.ts`, `prisma.config.ts` |
| Database | Supabase Postgres (AWS `ap-southeast-1`, Singapore) | — | `.env.example`, `next.config.ts:36` |
| Hosting | Cloud Run, region `asia-southeast1` (Singapore) | — | `cloudbuild.yaml`, `Dockerfile` |
| Edge / CDN / TLS | Cloudflare (DNS-proxied) | — | `src/lib/client-ip.ts`, `src/middleware.ts` |
| Rate-limit store | Supabase Postgres (UNLOGGED tables + SECURITY DEFINER functions) | — | `src/lib/ratelimit.ts` |

Note the deliberate geographic colocation: Cloudflare edge → Cloud Run `asia-southeast1` → Supabase `ap-southeast-1` are all in/near Singapore, keeping the server-to-DB hop intra-region for the Vietnamese-expat audience.

### Build & runtime targets

`next.config.ts:8` switches output by environment:
<!-- docs-lint-allow: next.config.ts:100,111 genuinely still branch on process.env.VERCEL; this documents a VESTIGIAL code path, not a live deployment -->
- ⚠️ *Vestigial — the app has not run on Vercel since 2026-07, but the branch is still in the code.* On **Vercel** (`process.env.VERCEL` set) `output` is left `undefined` so Vercel handles bundling natively. The inline comment documents a real gotcha: forcing `standalone` on Vercel makes it bundle the Edge middleware with Node globals (`__dirname`) and crashes with `MIDDLEWARE_INVOCATION_FAILED`.
- Off Vercel it emits `"standalone"` for self-hosting. `Dockerfile` builds that standalone server for Cloud Run (Singapore) — Prisma 7 has no Rust engine and `pg` is pure JS, so no native-binary/OpenSSL handling is needed. `Caddyfile` is the local reverse-proxy front (`:81` → `localhost:3000`, forwarding `X-Forwarded-For`/`X-Real-IP`). These are the self-host fallback path, not the production path.

Other build-shaping config in `next.config.ts`:
- `experimental.inlineCss: true` (`:13`) — CSS is inlined into `<head>` instead of a render-blocking `<link>`; the comment notes this removed the #1 mobile render blocker (~570 ms stylesheet round-trip in PSI). Do not regress this.
- `experimental.optimizePackageImports: ["lucide-react"]` (`:16`) — barrel tree-shaking; `lucide-react` is imported across ~68 files.
- `turbopack.root: __dirname` (`:21`) — pins the workspace root so Turbopack won't latch onto a stray lockfile higher in the tree (e.g. `~/package-lock.json`).
- `typescript.ignoreBuildErrors: false` (`:51`) — type errors fail the Cloud Build / CI build.
- `reactStrictMode: false` (`:53`).

### Image pipeline

`next.config.ts:23-46` configures the Next image optimizer tuned for cost and mobile-VN:
- `formats: ["image/avif","image/webp"]`, `minimumCacheTTL: 2592000` (30 days; listing photos rarely change).
- `qualities: [60, 70]`, `deviceSizes: [360, 640, 1080]`, `imageSizes: [64, 128, 256]` — each width×quality is a billed transformation, so the variant matrix is deliberately small. (Per project memory: don't lower card quality below 60.)
- `remotePatterns` allow-lists the Supabase Storage `listings` bucket (`xihiryllwmjoouipkyhw.supabase.co/storage/v1/object/public/listings/**`) plus `picsum.photos`/`loremflickr.com` — the latter two are **mock-seed-only** and the comment marks them for removal before launch.

### Security headers & CSP (enforcing)

`next.config.ts:61-100` attaches baseline headers to every response (`source: "/:path*"`): HSTS (2-year, `includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), payment=()`.

The **Content-Security-Policy is enforcing** (promoted from Report-Only after an audit). Key allowances (`:62-83`): `script-src` keeps `'unsafe-inline' 'unsafe-eval'` (Next has no nonce setup) plus GTM, Meta `connect.facebook.net`, Leaflet via `unpkg.com`, <!-- docs-lint-allow: va.vercel-scripts.com is genuinely still in the CSP allowlist at next.config.ts -->
Cloudflare Insights, and `va.vercel-scripts.com`; `connect-src` allows Supabase REST + realtime (`https://*.supabase.co wss://*.supabase.co`), GA, Meta, Cloudflare. Violations are still collected via `report-to`/`report-uri` → `/api/csp-report` (the `Reporting-Endpoints` header at `:95` names the `csp-endpoint` group). Adding any new browser-loaded external origin requires updating this allowlist or it will be blocked.

### Prisma 7 over the Supabase pooler — the two-URL split

This is the most load-bearing architectural detail. Prisma 7 dropped the Rust query engine; the client talks to Postgres through a **driver adapter**.

- **Runtime** (`src/lib/db.ts`): `new PrismaPg({ connectionString: process.env.DATABASE_URL })` wraps node-postgres and connects to the **pooled** Supabase URL — Supavisor on **port 6543, transaction mode** (`?pgbouncer=true`). node-postgres uses *unnamed* prepared statements, which are compatible with the transaction pooler. The `PrismaClient` is a `globalThis` singleton (`:15-24`) so serverless invocations and dev HMR don't exhaust pooler connections. Query logging is `['error']` in production and `['query','error']` in dev — the comment flags that query logs contain seller phone numbers (PII), hence prod-quiet.
- **Schema/DDL & CLI** (`prisma.config.ts`): the Prisma CLI datasource points at `env('DIRECT_URL')` — the **direct** connection on **port 5432**, so `prisma db push` / `studio` / migrations never run DDL over the transaction pooler. `prisma.config.ts` also explicitly `import 'dotenv/config'` because Prisma 7 no longer auto-loads `.env`.
- `prisma/schema.prisma:13-15` declares `datasource db { provider = "postgresql" }` with **no `url`** — the runtime URL lives in `db.ts`, the CLI URL in `prisma.config.ts`. The generator emits an ESM client to `src/generated/prisma` (`@/generated/prisma/client`).
- Maintenance scripts under `scripts/` consistently prefer `DIRECT_URL || DATABASE_URL` (e.g. `messaging-realtime.mjs`, `unique-constraints.mjs`, `search-index.mjs`) so DDL/index work bypasses the pooler. `db:setup` = `prisma db push && node scripts/messaging-realtime.mjs && node scripts/unique-constraints.mjs` re-applies realtime + unique-index DDL after a reset.

### Security posture: RLS is bypassed by design

There are two distinct Supabase access paths, and **neither is constrained by Row-Level Security** — the application code is the only authorization guard:
- The Prisma runtime connects as the Postgres role over the pooler and reads/writes every table directly; RLS is not in the request path.
- `src/lib/supabase-admin.ts` creates a lazy, server-only client with `SUPABASE_SECRET_KEY` (the comment states it "bypasses RLS — never expose"); used for Storage (`listings` bucket) and privileged auth ops. It's instantiated lazily so `next build` page-data collection doesn't throw on missing env.

Auth/session is handled separately via `@supabase/ssr`: `src/lib/supabase/server.ts` (`createSupabaseServer`) reads/writes the auth-session cookies in Server Components and route handlers using the **publishable** key; there's a matching `browser.ts` client. So: cookies authenticate *who the user is*, but data-access enforcement lives entirely in route/handler code — there is no DB-level backstop.

### RSC / ISR caching strategy (real revalidate values)

Rendering is split between cached RSC/ISR shells and live client fetches:
- **Home** `src/app/page.tsx:12` — `revalidate = 21600` (6h). The server fetches the first page via Prisma (`verified:true, status:'active'`, sorted trust→featured→recency→id) only to seed first paint + SEO; the client `ListingsExplorer` then fetches live data from `/api/listings` and the SSR sort is matched exactly so hydration doesn't reshuffle.
- **Brand directory** `src/app/brands/page.tsx:17` — `revalidate = 21600` (6h).
- **Listing detail** `src/app/listings/[id]/page.tsx:49` — `revalidate = 2592000` (30d). This is a high-cardinality route (one page per listing); real edits/sold/moderation purge **on-demand** via `revalidatePath('/listings/<id>')` (called from `api/listings/[id]/route.ts`, `.../status/route.ts`, `.../availability/route.ts`, `api/admin/moderate/route.ts`), so the 30-day timer only covers off-listing changes.
- **Static SEO landing pages** (`housing-vietnam-expats`, `moving-sales-vietnam`, `motorbikes-for-sale-vietnam`, `services-for-expats-vietnam`) — `revalidate = 604800` (7d).
- **Always-dynamic**: `post`, `listings/[id]/edit`, `dashboard`, and all `admin/*` pages use `export const dynamic = 'force-dynamic'`; nearly every `/api/*` route is `force-dynamic` + `runtime = 'nodejs'` (e.g. `api/auth/send-sms` needs Node `crypto` for `standardwebhooks`, per `:14`). `/api/fx` is the notable cached API route (`revalidate = 21600`).

Mutation routes also call `revalidatePath('/')` / `'/brands'` after admin changes to purge the cached shells.

### Request flow: browser → Cloudflare → Cloud Run → Postgres

1. **Browser → Cloudflare.** DNS for eno.vn is proxied through Cloudflare, which terminates TLS, serves CDN/static assets, runs Insights, and — when configured — applies a **Transform Rule that injects `x-eno-edge: <secret>`** on inbound requests. Cloudflare also sets `cf-connecting-ip` to the true client IP.
2. **Cloudflare → Cloud Run (`asia-southeast1`).** The request reaches the Cloud Run origin. `src/middleware.ts` runs first (Edge, `matcher: '/api/:path*'`). It's an **ingress guard**: when `EDGE_SECRET` is set, any `/api/*` request missing the matching `x-eno-edge` header gets `403`. This blocks attackers hitting the raw Cloud Run `*.run.app` origin directly — which would otherwise let them spoof `cf-connecting-ip` and bypass every IP-keyed rate limit and drain the paid AI/translate/geocode routes. It **no-ops until `EDGE_SECRET` is configured** (safe to ship early). Exempt paths that legitimately arrive off-Cloudflare with their own auth bypass it: `/api/cron/*` (CRON_SECRET), `/api/auth/send-sms` (Standard-Webhooks HMAC from Supabase Auth), and `/api/feeds/*` (Basic-Auth, fetched by Google Merchant/Meta).
3. **Inside Cloud Run.** Cached RSC/ISR shells are served per the revalidate values above; dynamic pages and route handlers (Node runtime) execute server logic. IP-keyed work uses `clientIp()` (`src/lib/client-ip.ts`), which prefers `cf-connecting-ip` → `x-real-ip` → first `x-forwarded-for` hop (the comment explains XFF's first hop is a Cloudflare edge IP, useless for keying). Rate limiting (`src/lib/ratelimit.ts`) uses Postgres-backed sliding windows — SECURITY DEFINER functions over UNLOGGED tables, needing no extra credentials. Critical default: limits **fail OPEN** (allow) when Redis is absent/erroring, but security/paid routes pass `{ strict: true }` to **fail CLOSED** (deny) so a missing env var can never silently reopen a billing-drain or PII-harvest vector.
4. **Cloud Run → Postgres.** Data access goes through the Prisma singleton (`src/lib/db.ts`) over the **Supavisor pooler (6543, transaction mode)** to Supabase Postgres in `ap-southeast-1`. RLS is not enforced; the route/handler code that issued the query is the authorization boundary.
5. **Cron path (out-of-band).** Cloud Scheduler invokes `/api/cron/daily-reminders` (`0 2 * * *`) and `/api/cron/saved-search-alerts` (`0 5 * * *`) directly against the origin, authenticating with `CRON_SECRET` and bypassing the edge guard.

### Operational gotchas to know

- The runtime DB URL **must** be the 6543 pooler with `pgbouncer=true`; pointing it at 5432 (or DDL over 6543) is the classic failure mode the two-URL split exists to prevent.
- The edge ingress guard and rate limits are interlocked: until `EDGE_SECRET` + the Cloudflare Transform Rule + Cloud Run ingress restrictions are all live, the raw Cloud Run `*.run.app` origin is directly reachable and `cf-connecting-ip` is spoofable. Rate limiting shares the app's Postgres, so "the limiter is down" generally means the route is down anyway.
- CSP is enforcing — any new third-party script/connect/image origin must be added to `next.config.ts` or it silently breaks in the browser.
- Mock image hosts (`picsum.photos`, `loremflickr.com`) are still allow-listed in both `images.remotePatterns` and the CSP `img-src`; remove before launch.

Key files: `/Users/mk1e3/eno.vn/next.config.ts`, `/Users/mk1e3/eno.vn/src/middleware.ts`, `/Users/mk1e3/eno.vn/src/lib/db.ts`, `/Users/mk1e3/eno.vn/prisma.config.ts`, `/Users/mk1e3/eno.vn/prisma/schema.prisma`, `/Users/mk1e3/eno.vn/src/lib/client-ip.ts`, `/Users/mk1e3/eno.vn/src/lib/ratelimit.ts`, `/Users/mk1e3/eno.vn/src/lib/supabase/server.ts`, `/Users/mk1e3/eno.vn/src/lib/supabase-admin.ts`, `/Users/mk1e3/eno.vn/Dockerfile`, `/Users/mk1e3/eno.vn/Caddyfile`.

---

## Data Model

eno.vn persists to a single Supabase Postgres database via **Prisma 7 with the `@prisma/adapter-pg` driver adapter** (the Rust query engine is gone). Two facts shape everything below:

- **The Prisma `datasource` URL is intentionally empty** (`prisma/schema.prisma:13-15`). The runtime client connects through the adapter on the **pooled** Supavisor URL (`DATABASE_URL`, port 6543, transaction mode — `src/lib/db.ts:13`), while the CLI (`db push`, `studio`, `generate`) connects on the **direct** URL (port 5432) via `prisma.config.ts:14-16` so DDL never runs over the transaction pooler. Generated client lands in `src/generated/prisma` (`schema.prisma:8-11`), not `node_modules`.
- **RLS is bypassed by design.** App code is the only guard on the hot paths; the server uses an admin/service-role connection. The one place RLS is actually enforced (`Profile`, `realtime.messages`) is set up by raw-SQL scripts, not Prisma (detailed under *Cross-schema FK* below).

### Models

There are **16 models**. Grouped by concern:

**Identity & accounts**
- **`Profile`** (`schema.prisma:32-71`) — the app account, a **1:1 extension of Supabase `auth.users`**. `id String @id @db.Uuid` with **no `@default`**: the id is `auth.users.id`, supplied by app code in `ensureProfile` (`src/lib/profile.ts:27-29`, `create: { id: user.id, … }`), never DB-generated. Mirrors `email`/`phone` (both `@unique`) from verified auth for display/search. `accountType` (`'individual' | 'business'`) is null until onboarding. Carries the **denormalized trust cache** (`trustScore @default(100)`, `trustTier @default("standard")`, `positiveInteractions`), anti-abuse counters (`falseReportStrikes`, `reportCooldownUntil`), and **first-touch acquisition attribution** (`attrSource/Medium/Campaign/Referrer/LandingAt`) for per-channel CAC. Indexed on `phone`, `trustTier`, `attrSource`.
- **`Seller`** (`schema.prisma:124-152`) — a storefront. `ownerId String? @unique @db.Uuid` → `Profile` with **`onDelete: SetNull`**: a Profile owns **at most one** Seller (1:0..1); `ownerId` null = a **legacy/guest seller** with no account yet, `claimedAt` records when a real account claims it. `phone @unique` is deliberately kept as **the guest-claim join key**. Holds a **mirror** of the owner's `trustScore`/`trustTier` so a storefront card renders without a Profile join.
- **`Review`** (`schema.prisma:154-164`) — free-text reviews attached to a `Seller`.

**Catalog**
- **`Category`** (`schema.prisma:17-26`) — top-level taxonomy (bilingual `name`/`nameVi`, `slug @unique`, `icon`, `color`). Categories are seeded/synced out-of-band; `scripts/sync-categories.ts` updates them without the destructive reseed that `seed.ts` performs (per project memory: rentals is its own category).
- **`Brand`** (`schema.prisma:77-91`) — auto-growing brand catalogue. `normalized @unique` (lowercased, de-accented, alphanumeric) is the typo-dedupe key; `aliases` is a JSON array of merged variants; `iconSlug`/`logoPath` drive monotone logos. Indexed `[status, listingCount]` for the directory ranking.
- **`Listing`** (`schema.prisma:166-263`) — the central entity; see below.
- **`Translation`** (`schema.prisma:419-428`) — machine-translation cache keyed `@@unique([hash, target])` to avoid re-paying the translation API.

**Messaging & engagement**
- **`Conversation`** (`schema.prisma:285-318`) — buyer↔storefront thread scoped to a listing. `@@unique([listingId, buyerProfileId])` = one thread per buyer per listing. `sellerProfileId` is **nullable until the seller claims their account** (`onDelete: SetNull`); existing threads "light up" on claim. Denormalized `lastMessageAt/Text`, `buyerUnread/sellerUnread` power the inbox with no N+1. Per-user soft-delete via `buyerDeletedAt`/`sellerDeletedAt` (non-destructive: the thread reappears if the other party sends a newer message).
- **`Message`** (`schema.prisma:320-335`) — `kind` is `'text' | 'offer'`; offers carry `offerAmount` + `offerStatus` (`pending/accepted/declined/countered`) inline in the timeline. Indexed `[conversationId, createdAt]`.
- **`Notification`** (`schema.prisma:340-356`) — in-app bell items; display fields denormalized (`actorName`, deep-link `conversationId/listingId/url`) so the bell never joins.
- **`PushSubscription`** (`schema.prisma:111-122`) — one row per opted-in browser (`endpoint @unique`, `p256dh`, `auth`), `onDelete: Cascade` from Profile.
- **`SavedSearch`** (`schema.prisma:95-107`) — a buyer's filter set; `params` is JSON, `lastNotifiedAt` ensures only newer listings trigger alerts.
- **`ContactReveal`** (`schema.prisma:268-279`) — one row per `(listingId, viewerId)` (`@@unique`) recording an authenticated viewer who revealed seller contact; `ipHash` is a salted hash (never the raw IP). `viewerId` is the raw `auth.users.id` string — **note this model has no FK to `Profile`** (Phase-1 lead signal that predates the Profile table).

**Trust, moderation, feedback**
- **`TrustEvent`** (`schema.prisma:403-415`) — **append-only audit log** of every score change (`type`, signed `delta`, optional `reason`/`actorId`/`reportId`). The source of truth; `Profile.trustScore` is just `max(0, 100 + Σ delta)`.
- **`Report`** (`schema.prisma:360-381`) — anonymous-friendly abuse report that can target a listing **and/or** an account (`targetProfileId`) **and/or** a storefront (`targetSellerId`); `reporterProfileId` enables trust-weighting and false-report anti-abuse. Lifecycle: `open → confirmed | dismissed | abusive`.
- **`Feedback`** (`schema.prisma:386-398`) — Help-sheet feedback. Deliberately uses a **plain optional `profileId` with no relation** ("to avoid FK churn") so the schema-change flow below isn't triggered.

### The denormalized `Listing.sellerTrustScore` + composite indexes

`Listing` carries `sellerTrustScore Int @default(100)` (`schema.prisma:202`) — a **local mirror of `Seller.trustScore`**. This is the hot-read-path scaling fix: the default "Recommended" feed sorts by trust then recency, and a local indexed column means the `ORDER BY` is an **index scan instead of a `Seller` join + external sort**. It is purely a ranking key; card display still reads the joined seller.

Sync points (the column is write-maintained, never computed at read time):
- **On create**, set from the seller's current score: `sellerTrustScore: seller.trustScore` (`src/app/api/listings/route.ts:611`, and bulk import `src/app/api/listings/bulk/route.ts:139`).
- **On every trust recompute**, cascaded to all the seller's listings: `recomputeTrust` resolves the owned storefront(s) then `db.listing.updateMany({ where: { sellerId: { in … } }, data: { sellerTrustScore: score } })` (`src/lib/trust.ts:159-162`); the seller-direct penalty path does the same (`src/lib/trust.ts:211`). **`updateMany` can't filter by relation**, hence the explicit two-step (resolve seller ids, then update) — a real gotcha if you add new write paths.

The score flows **Profile → Seller → Listing**: `recomputeTrust` writes `Profile`, mirrors to owned `Seller` via `updateMany({ where: { ownerId } })`, then cascades to `Listing` (`src/lib/trust.ts:153-162`). Consumers ORDER BY the local column everywhere (`src/app/page.tsx:29`, `src/app/api/listings/route.ts:240`, category rails, search-suggest, AI concierge, recommendations).

**Composite indexes** on `Listing` (`schema.prisma:235-262`) are designed so `verified` (and usually `status`) are leading equality predicates — every public read filters `verified = true AND status = 'active'`:
- `[verified, postedAt]`, `[verified, status, postedAt]` — default recency feeds (supersedes a standalone `postedAt`).
- `[verified, status, sellerTrustScore, postedAt]` and `[verified, status, categoryId, sellerTrustScore, postedAt]` — the **trust-ranked feeds**, all-categories and by-category. These are why the denormalized column pays off.
- `[verified, status, categoryId, postedAt/listingType/subcategorySlug, …]`, `[verified, status, brandSlug, postedAt]`, `[verified, status, brandSlug, model]` — faceted feeds.
- **Vehicle range facets** get one index each — `[verified, status, categoryId, year]` and `[…, mileageKm]` — because a B-tree can range-scan only **one** trailing column after the leading equalities.
- `[searchText … gin_trgm_ops] type: Gin` (`schema.prisma:262`) for accent-folded `LIKE '%term%'`; **requires the `pg_trgm` extension**.

`Conversation` mirrors this discipline: `[buyerProfileId, lastMessageAt(sort: Desc)]` and `[sellerProfileId, lastMessageAt(sort: Desc)]` (`schema.prisma:316-317`) let each side of the inbox's `WHERE buyer=me OR seller=me ORDER BY lastMessageAt DESC` be served index-ordered.

### Cross-schema `Profile → auth.users` FK and the schema-change flow it forces

Prisma **cannot model the Supabase `auth` schema**, so the FK from `public."Profile".id` to `auth.users(id)` lives outside the Prisma schema (only a comment at `schema.prisma:28-31` documents it). It is applied by raw SQL in **`scripts/profile-auth-fk.mjs`**, which (idempotently):
1. Adds `constraint profile_auth_fk foreign key (id) references auth.users(id) on delete cascade` (deleting the auth user cascades to the Profile).
2. Enables RLS on `Profile` with **select-own / update-own** policies (`auth.uid() = id`) and **deliberately no INSERT policy** — provisioning goes through the server admin client that bypasses RLS (`scripts/profile-auth-fk.mjs:23-31`).

This forces a specific **schema-change dance**, because `prisma db push` trips on **P4002** while introspecting the cross-schema constraint:

1. **Drop the FK** — `node scripts/drop-profile-auth-fk.mjs` (`alter table … drop constraint if exists profile_auth_fk`).
2. **Push the schema** — `prisma db push` (over `DIRECT_URL`).
3. **Re-add the FK** — `node scripts/profile-auth-fk.mjs`.

`db push` is non-destructive to the FK in practice, but a **`prisma migrate reset` wipes it and the policies**, so step 3 must always be re-run after a reset (`scripts/profile-auth-fk.mjs:2-3`).

Crucially, **`prisma db push` also does not manage other raw/partial DB objects**, so the canonical setup script is `npm run db:setup` = `prisma db push && node scripts/messaging-realtime.mjs && node scripts/unique-constraints.mjs` (`package.json:24`). The two follow-on scripts re-apply, idempotently, what Prisma can't:
- **`scripts/messaging-realtime.mjs`** — `SECURITY DEFINER` triggers on `Message` that `realtime.send(...)` the full message body on a **private** topic `convo:<id>` plus content-free activity nudges on `user:<profileId>`, a participant-gated `broadcast_typing` RPC, `REVOKE EXECUTE` on those functions from `public/anon/authenticated` (so they can't be called via PostgREST), and **RLS receive policies on `realtime.messages`** limiting broadcasts to the two conversation participants (`auth.uid()` compared directly to `Conversation.buyerProfileId`/`sellerProfileId` — no join). This is the second place RLS is genuinely enforced.
- **`scripts/unique-constraints.mjs`** — **partial unique index** `TrustEvent_one_time_reason_unique` on `(subjectProfileId, reason)` **only for the one-time reasons** `new_account/phone_verified/zalo_linked/kyc/profile_complete` (so the −40 new-account deficit and the verification bonuses can never double-apply under a race, while repeatable engagement/transaction/report events stay unconstrained), a recompute that un-sticks any score corrupted by a past race, and `SavedSearch_profile_params_unique` on `(profileId, params)`. This is the DB "belt"; `recomputeTrust` also de-dupes one-time reasons in app code as the "suspenders" (`src/lib/trust.ts:54, 128-140`).

**Bottom line for an integration partner:** never assume `prisma db push`/`migrate` reproduces a working database. The cross-schema FK, the Profile/realtime RLS, the realtime broadcast triggers, and the partial unique indexes are all out-of-band raw SQL that must be re-applied via `npm run db:setup` + `scripts/profile-auth-fk.mjs` after any reset, over the **direct** (5432) connection.

Relevant files: `/Users/mk1e3/eno.vn/prisma/schema.prisma`, `/Users/mk1e3/eno.vn/src/lib/db.ts`, `/Users/mk1e3/eno.vn/prisma.config.ts`, `/Users/mk1e3/eno.vn/src/lib/trust.ts`, `/Users/mk1e3/eno.vn/src/lib/profile.ts`, `/Users/mk1e3/eno.vn/scripts/profile-auth-fk.mjs`, `/Users/mk1e3/eno.vn/scripts/drop-profile-auth-fk.mjs`, `/Users/mk1e3/eno.vn/scripts/messaging-realtime.mjs`, `/Users/mk1e3/eno.vn/scripts/unique-constraints.mjs`, `/Users/mk1e3/eno.vn/package.json`.

---

## Auth & Identity

eno.vn authenticates with **Supabase Auth (GoTrue)** and maps each Supabase user 1:1 onto an application `Profile` row (`Profile.id == auth.users.id == JWT sub`). Postgres RLS is **bypassed by design** — the application server is the only access guard. This section documents the real flow, the two distinct "who am I" helpers, the onboarding gate, the RLS posture, and the consent tiers.

### Sign-in surface (phone-OTP-first)

`SignInForm` (`src/components/marketplace/sign-in-form.tsx`) is shared verbatim by the sign-in modal and the `/signin` page. It defaults to the **phone** tab (`useState<'email'|'phone'>('phone')`, line 21) — phone OTP is the primary path for the Vietnamese-expat audience. Three methods:

- **Phone OTP** — `signInWithOtp({ phone })` (line 90) → `verifyOtp({ phone, token, type:'sms' })` (line 99). The number is normalized to E.164 `+84…` client-side (line 89). The 6-digit entry auto-submits on completion (`onCodeComplete`, line 107), and on Android Chrome the **WebOTP API** (`navigator.credentials.get({ otp })`, lines 118-131) auto-fills/submits the SMS code. Phone OTP completes **in place** — no server round-trip through `/auth/callback`; the modal just closes via the `onAuthStateChange` listener.
- **Google OAuth** — `signInWithOAuth({ provider:'google', options:{ redirectTo } })` (line 74). Because Google rejects OAuth inside in-app webviews / iOS PWAs (`disallowed_useragent`), `googleOauthBlocked()` (line 34) is detected client-side and the flow hands off to the system browser (`openGoogleInBrowser`, lines 59-67) rather than dead-ending.
- **Email magic-link** — `signInWithOtp({ email, options:{ emailRedirectTo } })` (line 80).

OAuth and magic-link round-trip through `redirectTo = ${origin}/auth/callback?next=…` (lines 41-48). `next` is sanitized to a same-origin path everywhere via `safeNextPath` (open-redirect guard).

### OTP delivery — the Send-SMS hook

Supabase **generates, rate-limits, and verifies** the OTP natively. The app only **delivers** it, via the Supabase "Send SMS Hook" at `src/app/api/auth/send-sms/route.ts`. Critical properties:

- **Public route, HMAC-gated.** The only thing protecting it from OTP-spray (which would burn the SMS/ZNS balance) is the **Standard Webhooks** signature, verified against `SEND_SMS_HOOK_SECRET` over the **raw** body (lines 113-124). A bad signature → 401.
- **Channels:** eSMS.vn multichannel — **Zalo ZNS first, SMS-brandname fallback** (`deliverViaEsms`, lines 45-81), with **SpeedSMS.vn** as a day-1 stopgap (lines 83-105). `webhook-id` is used as the eSMS `RequestId` for idempotency (no double-send on hook retry).
- **Never logs the OTP**; returns **200 even on delivery failure** (line 139) so a transient provider hiccup doesn't abort the user's login (Supabase already stored the code; the user can resend).
- This route is **explicitly exempt** from the edge-ingress guard in `src/middleware.ts` (line 25) — it's called by Supabase off-Cloudflare and carries its own HMAC auth; gating it would kill phone-OTP signup/login.

### Profile provisioning (`ensureProfile`)

`ensureProfile(user)` in `src/lib/profile.ts` is the idempotent bridge from a Supabase user to a `Profile`. It `upsert`s on `id` (line 27), mirroring identity fields but **never clobbering** a user-edited `displayName`/`avatar` on re-login (`update` only backfills `email`/`phone`, lines 31-32). Gotchas worth knowing:

- Only a **confirmed** phone is mirrored (`user.phone && user.phone_confirmed_at`, line 18), normalized to canonical `+84…`.
- A `P2002` phone-unique collision is swallowed and retried without the phone (lines 37-43) — **login must never throw**.
- New accounts are seeded **below 100** (`recordNewAccount` → −40 deficit) and earn `+15` for a verified phone (`recordPhoneVerified`); both are apply-once idempotent (lines 48-50).
- **Auto-claim:** a verified phone matching an **unowned** guest `Seller` atomically stamps ownership via `updateMany` guarded by `ownerId:null` (claim-once, lines 57-79), transferring the storefront + listings and re-pointing waiting conversations.

It runs over the **pooled Prisma connection, which bypasses RLS** — intentional, since there is no client INSERT policy on `Profile` (see comment at lines 9-13).

### The two identity helpers (local JWT vs DB) — `src/lib/admin.ts`

These are **not interchangeable**; pick by the security need:

- **`getCurrentProfile()`** (line 38) — calls `supabase.auth.getUser()`, which **revalidates the JWT against the auth server**, then loads (and lazily `ensureProfile`-provisions, line 44) the DB `Profile`. Use where the row must exist or where instant revocation matters: admin, `/api/me`, the account page, conversation create / FK targets. It also lazily credits the phone-verified bonus for phones confirmed after first creation (idempotent, deferred via `after()`, lines 53-55).
- **`getCurrentProfileId()`** (line 73) — calls `supabase.auth.getClaims()`, which verifies the token **locally** (no auth-server round-trip, **no DB hit**) against cached **JWKS**. The project uses **asymmetric ES256 signing keys**, so a forged/tampered/expired/absent token all **fail closed to `null`** (lines 76-81). Returns only `claims.sub` (== profile id). Use on **hot 2-party messaging read/write paths** that only need the participant id. **Trade-off (documented at lines 67-71):** server-side revocation/ban takes effect only at **token expiry (~1h)**, not instantly — acceptable for participant-gated messaging, **never for admin powers**. It does **not** provision a Profile.

**Admin gate:** `getAdmin()` (line 26) uses the revalidating `getUser()` and checks the verified email against the `ADMIN_EMAILS` allowlist (`isAdminEmail`, line 16). Admin is email-allowlist-based, deliberately on the `getUser()` (instant-revocation) path.

### Session plumbing & client identity

- **Server** (`src/lib/supabase/server.ts`): `createSupabaseServer()` is the SSR cookie-bound client (publishable key) used by all server helpers/route handlers.
- **Browser** (`src/lib/supabase/browser.ts`): `createSupabaseBrowser()` is a **per-tab singleton** so Realtime keeps one socket; it **arms `realtime.setAuth(token)` on boot and re-arms on every token refresh** (lines 20-23), or private channels silently stop delivering after the ~1h token expiry.
- **Client identity** (`src/context/auth-context.tsx`): the Supabase client is **lazy-loaded on first idle/interaction** (lines 73-99) to keep ~62 KiB + GoTrue off the anonymous home page's critical path. It tracks `user` via `getSession()` + `onAuthStateChange`, and **fail-closed defaults to logged-out** on any chunk/session error (line 79). `accountType` is fetched separately from `/api/me` (lines 117-128). Sign-out (lines 144-173) first tears down Web Push, then `auth.signOut()`, then clears per-user functional caches so a shared device doesn't leak the previous user's inbox/threads.

### Onboarding / account-type gate

A new account has `accountType == null` and must choose **individual vs business** exactly once. It is enforced in **two layers**:

1. **Server (OAuth/magic-link):** `/auth/callback` (`src/app/auth/callback/route.ts`) exchanges the code, runs `ensureProfile`, and if `!profile.accountType` redirects to `/onboard?next=…` (lines 23-25).
2. **Client (covers phone OTP, which has no callback):** the `AuthProvider` gate (lines 134-142) bounces any signed-in user with loaded identity but no `accountType` to `/onboard`, **skipping** `/onboard`, `/auth`, and `/signin` to avoid double-redirects. It **fails open** — a transient `/api/me` failure leaves `identityLoaded=false` so the gate stays inert (never traps a real user in onboarding, lines 122-128).

The choice is persisted by `POST /api/profile/account-type` (`src/app/api/profile/account-type/route.ts`). It is **owner-scoped via `getCurrentProfile()`** (trusts the session, never the client body, line 20). For `business` it creates/claims a `Seller` storefront (phone-match claim of an unowned storefront, else create, lines 60-77). One-number-↔-one-account is enforced via `phoneTakenByOther` → 409 `phone_taken` (lines 44-46). On the genuine first onboarding it records first-touch attribution and fires the Meta CAPI `CompleteRegistration` conversion **after the response flushes** (`after()`, zero added latency, lines 84-119). The same route powers the self-serve switch later (`account-type-switcher.tsx`), honoring onboarding's "you can change this later" promise.

### RLS-bypass posture (app code is the only guard)

This is the single most important security invariant. **There are no RLS policies anywhere** (no `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` in the repo, schema, or SQL). Database access flows through two RLS-bypassing channels:

- **Prisma over the pooled Supabase URL** (`src/lib/db.ts`) — Supavisor port 6543, transaction mode, via the `@prisma/adapter-pg` driver adapter (Prisma 7, no Rust engine). This connects as the database owner and **bypasses RLS entirely**. The client is a global singleton to avoid exhausting the pooler. Query logging is `['error']` in production because query logs contain seller phone numbers (PII).
- **Supabase admin client** (`src/lib/supabase-admin.ts`) — `getSupabaseAdmin()` uses `SUPABASE_SECRET_KEY` for Storage (the `listings` bucket); also RLS-bypassing, server-only, lazily constructed so a missing env fails on first request rather than at build (lines 8-20).

**Consequence:** every authorization decision (ownership, participant checks, admin) lives in **application code** — chiefly the `getCurrentProfile()` / `getCurrentProfileId()` helpers above. There is no database-level backstop. A route that forgets to scope a query by the caller's profile id is a real vulnerability; do not assume the DB will catch it.

Network-layer hardening: `src/middleware.ts` is an **edge-ingress guard** — when `EDGE_SECRET` is set, every `/api/*` request must carry the `x-eno-edge` header injected by a Cloudflare Transform Rule, blocking attackers hitting the raw Cloud Run `*.run.app` origin directly (which would let them spoof `cf-connecting-ip` and defeat IP-keyed rate limits). It is a no-op until configured, and bypasses crons, `/api/auth/send-sms`, and `/api/feeds/*` (which carry their own auth).

### Consent tiers (`src/lib/consent.ts`)

A three-tier client-side consent model, stored in `localStorage` under `eno-cookie-consent` (`ConsentLevel = 'all' | 'personalized' | 'essential'`, line 9):

- **`essential`** — functional storage only (caching the user's own inbox/prefs/recently-viewed for instant repeat loads).
- **`personalized`** — essential + on-site "For You" personalization using the user's own first-party on-site activity (ranked on eno's own server, never leaves). **No ad-network pixels.**
- **`all`** — personalized + ad-network signals (Meta/Google retargeting).

Before any choice, functional caching stays in-memory only. The accessors encode the policy:

- `hasConsent()` (line 17) — true once any choice is made (incl. legacy `'accepted'`).
- `personalizationAllowed()` (line 28) — **`read() !== 'essential'`**: on-site personalization is **ON by default**; only an explicit "Essential only / Decline" opts out, so a returning user with local searches gets "For You" without re-consenting. Independent of the ad tier.
- `hasAdConsent()` (line 33) — **`read() === 'all'`** only; gates ad-network pixels.
- `setConsent(level='all')` (line 48) writes the choice and broadcasts a `eno:consent` `CustomEvent` so live components react without a reload.

These are the actual enforcement points: `analytics-tags.tsx` gates ad pixels on `hasAdConsent()` and re-reads on the `eno:consent` event (lines 26-29); `lib/analytics.ts` gates the Meta `ViewContent` beacon on `hasAdConsent()` (line 87); `for-you-rail.tsx` gates its first-party rail on `personalizationAllowed()` (line 34). Legacy `'accepted'` maps to `essential` for ad purposes but keeps personalization on.

Relevant files: `src/lib/admin.ts`, `src/lib/profile.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`, `src/lib/supabase-admin.ts`, `src/lib/db.ts`, `src/lib/consent.ts`, `src/middleware.ts`, `src/app/api/auth/send-sms/route.ts`, `src/app/auth/callback/route.ts`, `src/app/api/profile/account-type/route.ts`, `src/app/api/me/route.ts`, `src/app/onboard/onboard-client.tsx`, `src/context/auth-context.tsx`, `src/components/marketplace/sign-in-form.tsx`, `src/components/marketplace/account-type-switcher.tsx`.

---

## Listings & Posting

The create/read/update/delete lifecycle for marketplace listings, plus the in-browser post wizard that feeds it. Manual per-listing moderation was removed: listings **publish instantly** and are policed reactively by the trust score + reporting. Prisma runs with RLS bypassed by design, so **every ownership and visibility rule below is enforced in app code only** — there is no database-level backstop.

### Files at a glance

| Concern | Path |
|---|---|
| List feed + create | `src/app/api/listings/route.ts` (`GET`, `POST`) |
| Edit / delete | `src/app/api/listings/[id]/route.ts` (`PATCH`, `DELETE`) |
| Availability toggle | `src/app/api/listings/[id]/status/route.ts` (`POST`) |
| Single "still available?" bump | `src/app/api/listings/[id]/confirm/route.ts` (`POST`) |
| Batch availability review | `src/app/api/listings/availability/route.ts` (`POST`) |
| Image upload + re-encode | `src/app/api/upload/route.ts` (`POST`) |
| Post wizard UI | `src/components/marketplace/post-wizard.tsx` |
| Post page (auth gate) | `src/app/post/page.tsx` |
| Owner authz helper | `src/lib/listing-owner.ts` |
| Phone normalize + detector | `src/lib/phone.ts` |
| Image-URL allowlist | `src/lib/listing-image.ts` |
| Client image compress | `src/lib/normalize-image.ts` |
| Batched upload client | `src/lib/upload-client.ts` |
| Serialize → API shape | `src/lib/serialize.ts`, types in `src/lib/types.ts` |
| Listing model | `prisma/schema.prisma:166` (`model Listing`) |

### The post wizard flow (`post-wizard.tsx`)

A single client component (~940 lines) that doubles as **create** and **edit** (driven by an optional `edit` prop) and can render standalone (`/post`) or `embedded` in the dashboard. The `/post` page (`src/app/post/page.tsx:18`) requires sign-in and `redirect('/signin?next=/post')`s guests — even though the `POST /api/listings` endpoint itself still supports guest-by-phone resolution (see below), the UI never exercises that path because an orphaned guest listing would have no owner inbox.

Notable client behaviors:
- **Photos** (`addPhotos`, line 374): accepts up to 6, filters to `image/*` or `.heic/.heif`, and runs each through `compressImageFile` (`src/lib/normalize-image.ts`) — HEIC→JPEG (native `createImageBitmap`, WASM `heic-to` fallback), then downscale to 1600px longest edge + WebP q0.82, **matching the server's output exactly** so the double-compress adds no visible loss. This client pass exists to dodge the platform request-body cap (a raw phone photo would 413 before sharp could shrink it). EXIF/GPS is stripped via canvas re-encode.
- **AI assist**: cover photo → `POST /api/ai/classify` autofills category/brand; description → `POST /api/ai/rephrase`.
- **Required-field checklist** (`checks`, line 343): photo ≥1, category, title ≥3 chars, price set, an area, and contact (name ≥2 + phone ≥9 digits). `canSubmit` is `missing.length === 0 && !submitting`.
- **Client-side phone block** (`submit`, line 400): runs `containsPhoneNumber` on title/description/contactName before any network call — the same function the server re-runs, so this is UX-only, not the security boundary.
- **Submit** (line 398): new photos (those carrying a `File`) are uploaded via `uploadInBatches`; already-hosted URLs (edit mode) are kept in order so the cover/sequence survive. Then a single JSON payload is `POST`ed (new) or `PATCH`ed (`/api/listings/${edit.id}`). Server error codes are mapped to localized messages: `upload`, `no_phone_in_listing`, `phone_taken`.

**Upload batching** (`src/lib/upload-client.ts`): files are sent `BATCH = 3` at a time as multipart `files`; any short batch throws `'upload'`. Order-preserving.

### Image upload + sharp re-encode (`/api/upload`)

`runtime = 'nodejs'` (sharp needs native bindings). Open to guests (the wizard is conceptually a guest flow) but **rate-limited two ways** (`src/app/api/upload/route.ts:29`): signed-in sellers `upload-user` 120/h **fail-open** (a Redis blip must not block an accountable account from posting); anonymous `upload-ip` 30/h **fail-closed** (`strict: true`).

Per file (max 8): client `content-type` must be in `ALLOWED = {image/jpeg, image/png, image/webp}` (note: **no SVG** — scriptable), size 1 byte–`MAX_BYTES` 12 MB. Then the real validation — the file is **decoded by sharp** (`{ limitInputPixels: 50_000_000 }`), auto-oriented (`.rotate()` bakes EXIF rotation, then all metadata incl. GPS is dropped), resized to fit `MAX_EDGE = 1600` (`withoutEnlargement`), and re-encoded WebP q82. sharp throwing on a non-decodable/disguised/corrupt file is what rejects it (`failed++`), not the content-type header. Output lands in Supabase Storage `LISTINGS_BUCKET` at a random `${Date.now()}-${rand}.webp` path (`upsert: false`), and the public URL is returned. Response is `{ urls, failed }`.

### POST /api/listings — create

`force-dynamic`. Flow (`src/app/api/listings/route.ts:442`):

1. **Rate limit** `listing-create` by IP, 15/h (each create can fan out paid translation + syndication).
2. **Parse + validate** required fields: `categorySlug`, `title` (trimmed, ≤140, **≥3 chars**), `contactPhone` normalized then ≥9 digits, `price` finite and `0 ≤ price ≤ 1e12`. Failure → 400 `Missing or invalid fields`.
3. **Phone-in-text block**: `containsPhoneNumber` over title, description, contactName → 400 `no_phone_in_listing`. Contact info is deliberately kept OFF the public listing — buyers message in-app.
4. **Seller resolution** (the identity core, lines 471–523):
   - Signed-in (`getCurrentProfileId()`): the listing must attach to **their** `Seller` (`ownerId === profileId`), or dashboard + buyer messages (`conversation.sellerProfileId = seller.ownerId`) never reach them. If they own a storefront, the contact phone is set/updated on it — but never one already `phoneTakenByOther` (→ 409 `phone_taken`, also caught on the unique-constraint race). If they have no storefront, an unowned guest storefront with that phone is claimed, else a new `Seller` is created.
   - Guest (no profile): a phone already tied to a real account is rejected (`phoneTakenByOther(..., null)` → 409); otherwise an existing or new unowned `Seller` is used. **One phone = one account** is the invariant throughout (`src/lib/phone-unique.ts`).
5. **Images**: `body.images.filter(isListingImageUrl).slice(0, 8)`. `isListingImageUrl` (`src/lib/listing-image.ts`) pins to `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/listings/` — **our project's bucket only**, so a stored URL can't point at an attacker bucket that bypassed the raster-only upload.
6. **The automated publish gate** (line 541): `autoPublish = images.length >= 1 && seller.trustTier !== 'restricted'`. Tiers come from `src/lib/trust.ts` (`restricted` = score < 60). A photoless listing **or** a Restricted seller is held (`verified: false`) — instantly live otherwise. Phone-in-text is already blocked upstream.
7. **Taxonomy normalization** (`src/lib/taxonomy.ts`): `listingType` must be in `typesFor(categorySlug)` else the category's primary type; `subcategorySlug` must be valid else `suggestSubcategory(...)` keyword fallback. `priceUnit` derives from intent (`VND/month` for rent/job, `VND/service (from)` for service, else `VND`). `attributes` is whitelisted to `/^[a-z0-9_]+$/` string keys, values ≤40 chars, stored as JSON. Range facets (`year`/`mileageKm`/`engineL`) are clamped to each facet's declared `[min,max]` onto dedicated columns. `brandSlug` is resolved/typo-deduped via `resolveBrand` (product categories only, never blocks). `searchText` is the folded EN+VI blob (`buildSearchText`).
8. **Create** with `sellerTrustScore: seller.trustScore` (denormalized ranking key) and `verified: autoPublish`.
9. **Post-response work via `after()`** (never delays the 201): `warmTranslations` of user text into all languages; and **only when `autoPublish`** — `syndicateListing` (Telegram/FB cross-post), `sendMetaCapiEvent('Lead', …)` (server-side CAPI), `reindexListing` (adds to AI/Vertex search). Brand-count bump + logo enrichment if a brand resolved.

Returns `{ id, verified: autoPublish }` (201).

### PATCH /api/listings/[id] — edit

`runtime = 'nodejs'`, `force-dynamic`. Owner-gated via `checkListingOwner` (see below). Category is **not** editable here. Builds a sparse `data` object — only keys present in the body are touched:
- title (≥3 else 400 `title_too_short`; setting it also nulls `titleVi` so the stale VI translation is dropped), description, price (same `0…1e12` bounds → `invalid_price`), district (recomputes `location`, never writes null to that non-nullable column), condition, images (same allowlist + slice 8).
- Same `containsPhoneNumber` block (line 47) → `no_phone_in_listing`.
- subcategory/listingType validated against the listing's existing category; attributes whitelisted; lat/lng/city bounded; brand/model re-resolved with listing-count moved old→new brand.
- Range specs: explicit `null`/`''` clears, omitted leaves untouched, else clamped.
- **`searchText` is rebuilt** from new-or-current values.
- **Re-publish a held listing** (line 140): if `current.verified === false` and the seller isn't `restricted` and the (new or existing) images now total ≥1, `data.verified = true`. This mirrors the create gate so adding a photo to a held listing makes it public — there is no manual queue to flip it.

Empty `data` → `{ ok: true }` no-op. On success: `revalidatePath('/listings/${id}')` (purge ISR detail page), and `after()` → `reindexListing` + `warmTranslations` of changed text. Brand-count rebalance also in `after()`.

### DELETE /api/listings/[id]

Owner-gated. Hard `db.listing.delete` (Prisma relations cascade reports/conversations/contactReveals). Decrements the brand count, `revalidatePath`s the detail page, and `after()` → `removeFromIndex`. Returns `{ ok: true }`.

### Status + confirm (availability)

Availability (`status`) is **separate from `verified` moderation**. Public feed requires **both** `verified: true` AND `status: 'active'` (`route.ts:85-88`); `sold`/`hidden` stay only in the seller's dashboard.

- **`POST /api/listings/[id]/status`** — owner sets `status` ∈ `{active, sold, hidden}` (`STATUSES` set; anything else → `invalid_status`). Re-activating also stamps `availabilityConfirmedAt` (re-activation counts as confirming availability). Always `revalidatePath` (sold/hidden must drop from the cached page, which 404s non-active) and `after()` → `reindexListing` (active reindexes, sold/hidden removes).
- **`POST /api/listings/[id]/confirm`** — Carousell-style **bump**. Owner-gated. Sets `status: 'active'`, stamps `availabilityConfirmedAt`, and **conditionally bumps `postedAt = now`** (feed recency) only if `canBump` passes — `BUMP_COOLDOWN_DAYS = 7` (`src/lib/stale.ts`). Inside the cooldown, the confirm still records availability (stops the reminder) but does **not** re-top the feed (anti-camping). Deliberately **no `revalidatePath`** — a daily confirm only bumps recency (surfaced live via the client feed fetch); regenerating the ISR page per confirm was the top ISR-write driver. `after()` → `recordEngagement` (daily-capped trust reward).
- **`POST /api/listings/availability`** — batch daily review. Owner-scoped to the caller's `seller.id`; takes `{ confirm: string[], sold: string[] }` (each capped at 500). `sold` → `updateMany status:'sold'`; `confirm` splits into a bump set (`postedAt < cutoff` → bump recency + stamp) and a refresh set (`>= cutoff` → stamp only) in parallel. Only **sold** ids `revalidatePath` + `removeFromIndex`; confirmed ids ride their time window. Returns `{ ok, confirmed, markedSold }`.

### Ownership authorization (`src/lib/listing-owner.ts`)

`checkListingOwner` is the single gate for PATCH/DELETE/status/confirm. It is `'server-only'` and explicitly re-checks ownership because **Prisma bypasses RLS**: caller must be signed in (`401 auth_required`), own a storefront (`403 no_storefront`), the listing must exist (`404 not_found`), and `listing.sellerId === seller.id` (`403 forbidden`). Returns `{ ok, sellerId, profileId }`.

### Validation primitives

- **`containsPhoneNumber`** (`src/lib/phone.ts:73`) — shared client+server. Catches VN mobile/landline (`0`/`+84` then a 2–9 lead digit), generic international `+digits`, full-width digits (`０９…`→ASCII), dot-separated VN numbers (`090.123.4567`, via a dots-stripped pass), and runs of ≥7 spelled-out digit words (EN+VI, with/without diacritics). Tuned so dotted VND prices (`1.080.000.000`) **don't** false-positive (the regex excludes dots; the dotted-fallback anchors on `0`/`84` with digit-boundary lookarounds).
- **`normalizePhone`** — canonical stored form is E.164 **with** leading `+` (`+84901234567`); `normalizePhoneNoPlus` matches Supabase `auth.users.phone`. This shared form is why the guest post and the later verified-phone business claim join on the same key.

### Serialize / types

`serializeListing` (`src/lib/serialize.ts:23`) maps a `Listing & { category, seller(+owner.accountType) }` row to `SerializedListing` (`src/lib/types.ts:17`). Key points:
- `images` is `JSON.parse`d (`safeParse` swallows bad JSON → `[]`) and run through `fixMockImage` (rewrites dead loremflickr URLs to picsum — removed at launch).
- **`seller.phone` is hard-coded to `null`** in list/feed payloads to prevent bulk PII harvesting (the comment references a `serializeListingWithContact` for single-listing detail, but no such function currently exists — contact is instead revealed through the separate gated `/api/listings/[id]/contact` route).
- `seller.isBusiness` is `owner?.accountType === 'business'`, only truthy when the query `include`d `seller.owner` (safe-default false).
- All `DateTime`s → ISO strings; `attributes` → parsed object or null; structured specs `year`/`mileageKm`/`engineL` passed through.

### Security posture & gotchas

- **App code is the only guard** — RLS is bypassed; every visibility/ownership rule lives in these routes. The public `GET` deliberately ignores any `verified` query param (`void verifiedParam`, line 80) and forces `verified: true` + `status: 'active'`, so the pending/held queue and raw guest phone numbers can never be scraped. Even the `?ids=` fast path re-applies that invariant.
- **Held inventory is self-healing, not human-reviewed**: the only ways a held listing goes live are (a) the seller adds a photo / their trust recovers and they PATCH it, triggering the re-publish branch, or (b) trust recompute. Nothing auto-flips `verified` on a held listing in the background.
- **Image trust chain**: upload re-encodes with sharp (no SVG, decode-validated, EXIF stripped) → stored only in our pinned bucket → create/PATCH re-validate every URL against that exact prefix. A URL is never trusted just because it looks like a Supabase URL.
- **`after()` is load-bearing**: translation warming, syndication, CAPI, and search indexing all run post-response; a failure there never fails the post, but also never surfaces to the user.
- **Phone uniqueness races** are caught both proactively (`phoneTakenByOther`) and on the unique-constraint catch, always surfacing `409 phone_taken` rather than silently attaching a listing to the wrong storefront.

---

## Search, Facets & Ranking

The browse/search subsystem is anchored by a single read endpoint — **`GET /api/listings`** (`src/app/api/listings/route.ts`) — backed by accent-folded keyword search over a denormalized `searchText` blob (pg_trgm), an optional semantic re-ranking pass through Vertex AI Search, and a trust-first ordering signal denormalized onto every `Listing` row. The client surface is `ListingsExplorer` (`src/components/marketplace/listings-explorer.tsx`) with the faceting UI in `facet-bar.tsx` and the price histogram in `price-range-filter.tsx`.

> Security invariant up front: every public read path is hard-pinned to `verified: true` AND `status: 'active'`. The `?verified=` param is read but deliberately ignored (`route.ts:80-81`) — there is no auth on this route, so the pending-moderation queue and raw guest phone numbers can never be scraped via `?verified=false/all`. The same gate is repeated in `/api/search/suggest`, `/api/search/resolve`, `/api/brands`, and the `?ids=` fast path.

### Request shape & filters (`GET /api/listings`)

The route is `export const dynamic = 'force-dynamic'`. It builds an `andFilters: Prisma.ListingWhereInput[]` array (`route.ts:83`) and combines it as `{ AND: andFilters }`. Recognized params:

- `category`, `subcategory` — taxonomy slugs. Subcategory filters the dedicated `subcategorySlug` column (`route.ts:166-169`), not a keyword heuristic.
- `type` — intent (`listingType`: sell/rent/job/service), filtered on the dedicated column.
- `condition` — case-insensitive bucketing: `new` matches `contains 'new'` OR `contains 'mới'`; `used` is `condition NOT null AND NOT newish` (so blank-condition rows aren't mis-counted as used) — `route.ts:101-112`.
- `priceMin`/`priceMax` — VND `gte/lte` (skipped in histogram mode).
- `brand` (canonical slug on `brandSlug` column) and `model` (exact display string) — `route.ts:175-183`.
- `attr_<name>` — category-specific attribute facets. Both the seed and the post wizard store attributes as JSON keyed by taxonomy `.value` strings, so the filter is a literal `attributes contains '"<name>":"<value>"'` substring match (`route.ts:191-198`). The attr name is sanitized to `[a-z0-9_]`.
- `range_<col>=min-max` — numeric range facets. The column is **allow-listed** via `isRangeColumn()` (`year`, `mileageKm`, `engineL`, `engineCc` — `taxonomy.ts:597-600`) so a caller can't probe an arbitrary field; either side of the dash may be open (`route.ts:203-213`).
- `sort` — `newest` (default/"Recommended"), `price-low`, `price-high`, `popular`, `verified-first`.
- `limit` (clamped ≤100, default 24), `offset` (≥0).
- `match=any` — loose OR-matching (see semantic/visual-search note below).
- `featured=true`, `histogram=1`, `priorityCategory` — see below.

**`?ids=` fast path** (`route.ts:47-58`): fetches a specific set (≤200) of listings by id, used by the `/saved` page. It re-applies the `verified + active` invariant — without `status: 'active'` a saved-but-since-hidden/sold listing would leak its full payload to anyone holding the id. Results are re-ordered to match the requested id order.

### Area model: district + province/ward

Two location models coexist:

- **District (legacy, the one current inventory carries)**: `buildDistrictFilter()` (`route.ts:115-129`) looks up `DISTRICTS[].match` (a list of EN+VI string variants per district, e.g. Thủ Đức also matches "Thao Dien", "District 2", "Quận 2" — `listings-explorer.constants.ts:74+`) and OR-matches each variant against **both** the `district` and `location` columns via `contains`.
- **New province → ward model** (`route.ts:134-141`): `province` matches the listing `city` (the only level current listings carry) OR `location`; `ward` is best-effort against `district` OR `location`. Gotcha documented inline: ward won't hit pre-2025 listings until they're re-tagged. `PROVINCES`/`WARDS` live in `listings-explorer.constants.ts`.

### Accent-folded keyword search (`fold` / `searchText` + pg_trgm)

Cross-language, accent-insensitive matching is the baseline (used whenever Vertex is off or for non-default sorts):

- `fold()` (`src/lib/fold.ts:3-11`): lowercases, NFD-normalizes, strips combining diacritics, maps `đ→d`, collapses whitespace. So "Quận 1" → "quan 1", "Căn hộ" → "can ho".
- On write, `buildSearchText([...])` folds a blob of EN title + VI titleVi + description + district + category name/nameVi + brand + model into the `Listing.searchText` column (`route.ts:602`).
- On read (`route.ts:150-159`): the folded query is split into ≥2-char tokens (max 6); each token becomes a `{ searchText: { contains: t } }` clause. Default mode **ANDs** the tokens (so "honda red" must match a row containing both, any order/field — a narrowing query); `match=any` **ORs** them (a descriptive phrase still surfaces the closest items). This `pgTextFilter` is tracked separately so the semantic path and facet counts can drop just the keyword clause.
- **Index**: `searchText` carries a GIN trigram index — `@@index([searchText(ops: raw("gin_trgm_ops"))], type: Gin)` (`schema.prisma:262`). It requires the `pg_trgm` extension. The index/extension are (re)created idempotently by `scripts/search-index.mjs` over `DIRECT_URL` (not the pooler), because `CREATE INDEX CONCURRENTLY` can't run in a transaction. Gotcha: `npm run db:setup` runs `prisma db push && messaging-realtime.mjs && unique-constraints.mjs` — it does **not** call `search-index.mjs`, so after a DB reset the trigram index must be restored separately (the schema's `@@index` push will recreate it only if `pg_trgm` already exists).

`/api/search/suggest` (typeahead, `src/app/api/search/suggest/route.ts`) reuses the exact same folded-token AND logic, returns up to 6 trust-ranked listings + ≤4 matching categories (categories matched on folded `name`/`nameVi` in JS since the set is tiny), and is IP rate-limited at 120/min.

### Trust-first ordering (`Listing.sellerTrustScore`)

Seller trust is a ranking signal on **every** sort, not just the default. `TRUST = { sellerTrustScore: 'desc' }` (`route.ts:240`) and the per-sort `orderBy` arrays (`route.ts:242-264`):

- `newest` (default "Recommended"): `[TRUST, featured desc, postedAt desc, id desc]` — trust dominates, so a low-trust listing never floats to the top of an unfiltered feed; featured/recency only break ties among equal trust.
- `price-low`/`price-high`/`popular`: the chosen key leads, then `TRUST`, then `id desc` — the price/popularity order is honored, but ties favor trusted sellers.
- `verified-first`: `[verified desc, TRUST, postedAt desc, id desc]`.
- **Every** branch terminates in `{ id: 'desc' }` — a unique, monotonic tiebreaker. Without it, rows tied on the sort key (notably the bulk of accounts sitting at trustScore=100) would get no stable order across independent LIMIT/OFFSET pages, so listings would appear twice and others would be silently skipped.

`sellerTrustScore` is a **denormalized mirror** of the seller's effective trust score (`schema.prisma:197-202`), so the ORDER BY is a local indexed column scan rather than a `Seller` join + external sort on every read (the hot-path scaling fix). It's set on create from `seller.trustScore` (`route.ts:611`) and kept in sync by the trust engine (`src/lib/trust.ts`): `recomputeTrust()` cascades the new score onto `Profile` → `Seller` → all the seller's `Listing.sellerTrustScore` rows (`trust.ts:153-162`); `penalizeSeller()` does the same for guest sellers with no owning Profile (`trust.ts:208-211`). Dedicated composite indexes back the trust-ranked feed: `@@index([verified, status, sellerTrustScore, postedAt])` and the by-category variant (`schema.prisma:241-242`).

The score itself: `max(0, 100 + Σ TrustEvent.delta)`, no ceiling; tiers are `<60 restricted · 60–84 standard · 85–109 trusted · 110–159 exceptional · 160+ elite` (`src/lib/trust-score.ts:12-18`, `src/lib/trust.ts`). New accounts start at 60 and earn up via verification; completed transactions are uncapped, penalties asymmetric and recoverable.

### Facet & subcategory counts (respecting active filters)

The core faceting rule: **a facet must not constrain its own option counts**, and the free-text query is dropped from the count base so a semantic-only search doesn't zero the counts.

- `facetBaseFilters = andFilters minus subcategoryFilter and pgTextFilter` (`route.ts:341`). This is the base for both the subcategory counts and the category "All" total.
- **Subcategory counts**: a single `groupBy(['subcategorySlug'])` over `facetBaseFilters` (`route.ts:376-384`) — one grouped query, taxonomy-aligned. This fixed a real bug noted inline: a count said "12" but clicking yielded 2 because the structural chips (condition/type/brand/model/price/district) were previously ignored in the count. Counts now match what the click returns.
- **`categoryTotal`**: count over `facetBaseFilters` when a category is selected (`route.ts:343-346`), powering the "All subcategories" tab.
- **Caching**: subcategory counts are memoized per filter-signature with a 60s TTL (`SUBCOUNT_TTL`, `subCountCache`, `route.ts:28-29, 366-385`). The cache key is `JSON.stringify(facetBaseFilters)`, so a change to **any** active filter invalidates it. This bounds the expensive fan-out to at most once/minute per filter combination on a warm instance.

### Price histogram (`histogram=1`)

When `histogram=1`, the route returns just the matching VND prices for the **current filters excluding the price range itself** — `db.listing.findMany({ where, select: { price }, orderBy: price asc, take: 5000 })` (`route.ts:219-228`). The client (`price-range-filter.tsx`) fetches this with a filter-signature query (sans price/sort/pagination — `listings-explorer.tsx:751`), then buckets the raw prices client-side into an Airbnb-style distribution behind a dual-handle slider, showing where the user's chosen range sits in available inventory. The histogram response is cached harder at the edge (`s-maxage=120, stale-while-revalidate=300`) than the main feed (`s-maxage=60`) so hot price queries are served from the Vietnam CDN edge, not Cloud Run origin.

### Semantic path (Vertex AI Search): ranked-id cache, keyword tail, true total

When `q` is present on the **default `newest` sort** (and not loose-match, not featured-only) and `vertexConfigured()` is true (`route.ts:274`), the route upgrades ranking from literal keyword AND-match to semantic relevance via Vertex AI Search / Discovery Engine (`src/lib/vertex-search.ts`). It is designed as a **pure ranking upgrade with no regression risk** — any failure falls back to the keyword query already sitting in `where`.

Mechanics:

1. **Ranked-id cache** (`rankCache`, `RANK_TTL=60_000`, `RANK_CACHE_MAX=200` — `route.ts:36-38`). Key = `JSON.stringify({ q, catArg, minP, maxP })` (`route.ts:281`) — only the args actually sent to Vertex. Structural filters (district/condition/etc.) are **not** sent to Vertex; they're re-applied in Postgres, so two pages differing only in those still share one ranked order. Rationale (documented inline `route.ts:31-38`): re-querying Vertex per page can return a slightly different order (rows duplicated on one page, skipped on the next) AND spends the trial credit on every page; caching the ranked list for 60s lets a search session page through a stable set at one Vertex call per (query, filter band). Cache eviction is oldest-first (insertion order) at 200 entries.
2. **Vertex call**: `vertexSearchListingIds(q, { categorySlug, minPriceVnd, maxPriceVnd, take: 120 })` (`route.ts:288`) → `POST {SERVING_CONFIG}:search` with `pageSize`, a `filter` string (`categorySlug: ANY(...) AND price >= .. AND price <= ..`), and a **trust-first `BOOST_SPEC`** (`vertex-search.ts:101-106`: `trustScore >= 110 → +0.5`, `trustScore < 60 → −0.5`) over the `trustScore` indexed on each document. The whole call is wrapped in `Promise.race` with a **2500ms timeout** (`route.ts:287-290`) — "never hang a search on Vertex."
3. **Structural safety net** (`route.ts:296-303`): the route re-fetches the ranked ids from Postgres with `{ AND: [...structural, { id: { in: ids } }] }` (where `structural` = `andFilters` minus `pgTextFilter`), then re-orders the rows to Vertex's relevance order via a `Map`. This re-applies every structural filter on the DB side and drops only the keyword tokens, so RLS-style guarantees and chip filters still hold even though Vertex did the ranking.
4. **Keyword tail + true total** (`route.ts:306-327`): the ranked set is capped at ≤120. To keep deep pages of a popular query loading (instead of capping at 120) and to report an **honest** count, `semanticTotal = R (ranked count) + tailTotal`, where `tailTotal = count of literal-keyword matches NOT already in the ranked set` (`{ AND: [...andFilters, { id: { notIn: rankedIds } }] }`). When a requested page reaches past the ranked set, the remainder is filled from keyword-ordered results (trust→recency `orderBy`, `skip: offset − R`) excluding ids already shown. `total` always equals the paginable count, so the client's `listings.length < total` load-more terminates correctly.

**Visual / loose search** (`match=any`) deliberately bypasses the semantic path (the condition requires `!looseMatch`) and uses OR-token keyword matching — the image-search flow (`/api/ai/visual-search` → `src/lib/visual-search.ts`) lands the user on the explorer with `?match=any` so a descriptive multi-label phrase ("blue pen") still surfaces the closest items.

**Ingestion / sync** (`src/lib/listing-index.ts`, `vertex-search.ts:148-215`): `reindexListing(id)` upserts a listing's **public-fields-only** document (`listingToDoc` — explicitly omits seller phone/PII) when it's `verified && active`, else deletes it; called from `after()` on create/edit/sold/hidden/publish so the index tracks the public feed. Bulk backfill goes through `documents:import` (INCREMENTAL, ≤100/call). Everything is env-gated by `vertexConfigured()` (`PROJECT && RAW_CREDS && (DATASTORE || ENGINE)` — `vertex-search.ts:30-32`) and no-ops/swallows errors when unconfigured. Note: the same module also powers the AI concierge (`conciergeSearch`, `relevanceThreshold: 'MEDIUM'`, generated summary via `CONCIERGE_PREAMBLE`) which draws the same GenAI App Builder trial credit.

### Brand catalogue, resolver & search-intent resolution

The brand system canonicalizes free-typed brand strings into a growing catalogue and powers a search-intent shortcut.

- **Normalization** (`src/lib/brand-normalize.ts`): `normalizeBrand()` strips to `[a-z0-9]` after de-accenting ("Louis Vuitton"→"louisvuitton") — the uniqueness/dedup key; `brandSlugify()` makes the URL slug; `levenshtein(a,b,max)` is an early-exit edit-distance for the typo guard.
- **Write-side resolver** `resolveBrand()` (`src/lib/brand.ts:30-85`), called from `POST /api/listings` only for brand-relevant categories (`BRAND_CATEGORY_SLUGS` — electronics, fashion-beauty, vehicles, rentals, furniture-appliances, baby-kids, hobbies-sports; `taxonomy.ts:570-575`). Four-step grow-the-catalogue logic: (1) exact normalized match; (2) alias match (a typo merged earlier); (3) fuzzy match within a length-scaled budget (`fuzzyBudget`: ≤4 chars→1, ≤8→2, else 3) — records the new spelling as an alias of the closest brand; (4) otherwise create a new brand, preferring a simple-icons display name + logo. Never blocks the post if it fails. After create, `after()` runs `bumpBrandCount` + `enrichBrandLogoIfMissing` (theSVG monotone logo fallback).
- **Read-side matcher** `matchBrand(raw, maxDist=2)` (`brand.ts:94-118`): the same exact→alias→fuzzy ladder but **never creates** and only considers `status: 'active'` brands. The fuzzy budget is capped (search passes `1` for tight matching) so generic words don't get yanked onto a near-spelled brand — explicit guard: "macbook" must NOT become "facebook".
- **Search-intent resolver** `GET /api/search/resolve` (`src/app/api/search/resolve/route.ts`): "best match, not exact." For a short query (2–40 chars, ≤5 words) it tries to interpret the text as brand + model so the UI opens the matching category/brand/model facets instead of a keyword search. Order (`route.ts:96-126`): (1) exact/alias brand from leading 2-then-1 tokens ("Louis Vuitton" first); (2) best model on the remaining tokens via `bestModelMatch` (ILIKE-scan ≤120 rows, scored exact>prefix>substring>token-match, tie-broken by length-closeness then live demand = views + 5×contacts); (3) exact brand with no model → open the brand's `dominantCategory` (the category with the most live listings for that brand); (4) typo fallback `matchBrand(q, 2)` — only reached last, so a real word can't get pulled onto a brand. IP rate-limited 120/min; cached `max-age=120`.
- **Catalogue read** `GET /api/brands` (`src/app/api/brands/route.ts`): `?q=` (normalized substring, datalist), `?category=` (brands with live listings in that category, ranked by live demand views+5×contacts, count fallback — powers the rail), or neither (most-listed overall). `iconPath` is resolved server-side so simple-icons never ships to the client.
- The `Listing` brand path has dedicated indexes `@@index([verified, status, brandSlug, postedAt])` and `@@index([verified, status, brandSlug, model])` (`schema.prisma:246-247`).

**Soft brand hierarchy** (`priorityCategory`, `route.ts:186, 404-411`): a brand search spans **all** categories, but the category the user was browsing is surfaced first. This is not a hard WHERE filter — after the DB returns trust/recency order, a **stable** sort promotes the active category's rows to the front (ties keep the DB order), so "the rest of the brand across other categories" still appears below.

### Caching & rate limiting

The feed response carries `Cache-Control: public, max-age=15, s-maxage=60, stale-while-revalidate=300` (`route.ts:427`) — short browser TTL, 60s Cloudflare edge TTL, SWR so cache hits never touch Cloud Run. Because all public data is verified+active only, edge caching of hot terms is safe. Write/scan-amplifying routes are IP rate-limited via `@/lib/ratelimit` (`listing-create` 15/h; `search-resolve`/`search-suggest` 120/min) — these no-op (fail-open vs fail-closed depends on the `strict` flag) when the limiter errors, per the security memo.

Key files: `src/app/api/listings/route.ts` (feed + facets + histogram + semantic), `src/lib/vertex-search.ts` (Vertex client + ingestion), `src/lib/listing-index.ts` (sync), `src/lib/trust.ts` + `src/lib/trust-score.ts` (ranking signal), `src/lib/fold.ts` (accent folding), `src/lib/brand.ts` + `src/lib/brand-normalize.ts` (catalogue/resolver), `src/app/api/search/{resolve,suggest}/route.ts`, `src/app/api/brands/route.ts`, `prisma/schema.prisma:188-263` (Listing model + indexes), `scripts/search-index.mjs` (pg_trgm GIN DDL), `src/components/marketplace/{listings-explorer,facet-bar,price-range-filter}.tsx` (client).

---

## Trust & Reputation

The trust subsystem is eno.vn's single public credibility signal — a color-coded numeric **score** that replaced the old manual-verification / stars / badge system entirely. Every score change flows through an append-only audit log (`TrustEvent`); the score itself lives as a denormalized cache on three tables (`Profile` → `Seller` → `Listing`) and is **never mutated blindly** — it is always recomputed as `max(0, 100 + Σ deltas)`. Core engine: `src/lib/trust.ts`. Color/band mapping: `src/lib/trust-score.ts`.

### The score model

- Baseline is **100** (= good standing). There is **no upper ceiling** — completed transactions earn trust without limit, so the most active sellers keep climbing and ranking higher (`src/lib/trust.ts:40-43`).
- Floor is **0** (`SCORE_MIN`, clamped in `recomputeTrust` and `penalizeSeller`).
- **Sybil resistance**: brand-new accounts start *below* 100. `recordNewAccount` applies a one-time `-40` deficit (`NEW_ACCOUNT_DEFICIT`), so a throwaway account begins at ~60/Restricted-Standard boundary and must *earn up* via verification: phone `+15`, Zalo `+10`, KYC `+15`, complete profile `+5`. The three identity verifications fill the deficit exactly back to 100 (`trust.ts:82-89`).

### Tiers vs. color bands (an important mismatch)

There are **two** tier vocabularies and they do not have the same arity:

- `tierFor()` (`trust.ts:102-114`) returns the `TrustTier` union: `restricted | standard | trusted | exceptional`. This is what gets **stored** in `Profile.trustTier` / `Seller.trustTier`. Thresholds: `<60` restricted, `60-84` standard, `85-109` trusted, `≥110` exceptional.
- `trustBand()` / `trustScoreColor()` (`trust-score.ts:12-30`) returns a **five**-band `TrustBand`: adds `elite` at `≥160`. This is render-time only, derived from the numeric score (red → slate → green → gold → violet, all theme-aware CSS vars tuned for WCAG AA on both light/dark cards).

**Gotcha**: the stored `trustTier` column never holds `'elite'` — `tierFor` caps at `'exceptional'`. The Elite/violet tier exists *purely* as a color computed from the live score at display time. Anything keying off the persisted `trustTier` string will never see Elite; anything keying off `trustScoreColor(score)` will. Don't treat the two as interchangeable.

`tierFor` also enforces a **track-record gate** beyond the raw threshold: Trusted/Exceptional require `positiveInteractions ≥ 5` **OR** `accountAgeDays ≥ 30` (`TRACK_RECORD_MIN_INTERACTIONS` / `TRACK_RECORD_MIN_DAYS`). So a fresh account that buys its way to score 100 still reads **Standard** (no badge) until it has a history. Exceptional additionally requires **no confirmed report in the last 90 days** (`RECENT_BAD_WINDOW_DAYS`) — a recent confirmed report caps you at Trusted regardless of score.

### `TrustEvent` — the audit log

`model TrustEvent` (`prisma/schema.prisma:403-415`) is append-only: `{ subjectProfileId, type, delta, reason?, actorId?, reportId?, createdAt }`, indexed on `(subjectProfileId, createdAt)`. `type` is one of `report_confirmed | report_dismissed | positive_review | fast_response | engagement | transaction | decay_recover | decay_inactive | manual_adjust`. The cached score on `Profile`/`Seller` is just a materialized `100 + sum(delta)`, so every change is attributable and reversible. `onDelete: Cascade` from Profile.

### `applyTrustEvent` → `recomputeTrust` (the engine core)

`applyTrustEvent(subjectProfileId, type, delta, meta?)` (`trust.ts:170-192`):
1. Inserts one `TrustEvent` row.
2. If `delta > 0` and type is one of `positive_review | engagement | fast_response | transaction`, increments `Profile.positiveInteractions` (the track-record counter that gates the badges).
3. Calls `recomputeTrust`.

`recomputeTrust(profileId)` (`trust.ts:117-164`) is the only thing that writes a score. It:
1. Loads all the profile's `TrustEvent` rows and sums deltas — but **dedupes one-time reasons**: `new_account, phone_verified, zalo_linked, kyc, profile_complete` (`ONE_TIME_REASONS`) are counted **at most once** in the sum. This is the "suspenders" guarding against a race double-inserting the `-40` deficit (which would otherwise strand a new user at 20/Restricted). The DB partial unique index is the "belt" (see below).
2. `score = max(0, 100 + sum)`.
3. Computes `recentBad` = count of `report_confirmed` events in the last 90 days, derives the tier via `tierFor`.
4. **Dual-writes** the score+tier: updates `Profile`, mirrors onto the owned `Seller` (`updateMany` by `ownerId`), and cascades the score onto **all that seller's listings** (`Listing.sellerTrustScore`). See denormalization below.

### One-time idempotency: app dedupe + DB partial unique index

`applyOnce` (`trust.ts:61-69`) wraps `applyTrustEvent` and swallows Prisma `P2002` (unique violation) as "already applied". Each `recordX` one-time helper *also* does a pre-check count. The real guard is a **partial unique index** `TrustEvent_one_time_reason_unique ON (subjectProfileId, reason) WHERE reason IN (one-time set)`, created by `scripts/unique-constraints.mjs:46-50`.

**Operational gotcha**: Prisma does **not** manage this partial index — it must be re-applied after every `prisma db push`. It runs as part of `npm run db:setup` (`prisma db push && messaging-realtime.mjs && unique-constraints.mjs`). That script also (a) dedupes any existing one-time events keeping the earliest, and (b) recomputes `Profile.trustScore`/`Seller.trustScore` from the deduped events to un-stick accounts corrupted by past races. Note the SQL recompute in that script (`unique-constraints.mjs:53-57`) sums **all** deltas (relying on the prior DELETE-dedupe), whereas `recomputeTrust` dedupes in-app — same result post-cleanup, but they are not the identical code path.

### Earn loop (deltas and anti-farming)

Constants at `trust.ts:71-89`:

| Reason | Delta | Cap / gate | Wired in |
|---|---|---|---|
| Completed transaction | `+5` | **UNCAPPED** (gated by a real-money fee) | `recordTransaction` — **defined, not yet wired** |
| Verified-buyer review | `+3` | one per real transaction | `recordReview` — **defined, not yet wired** |
| Daily engagement (confirm availability) | `+2` | **1/day** (`ENGAGEMENT_DAILY_CAP`, enforced by counting today's events in `recordEngagement`) | `/api/listings/[id]/confirm` (via `after()`) |
| Fast response | `+1` | capped | `fast_response` type — **not wired** |
| Phone verified | `+15` | one-time | `lib/profile.ts` (ensureProfile) + `lib/admin.ts` |
| Zalo linked | `+10` | one-time | `recordZaloLinked` — **defined, not yet wired** |
| KYC | `+15` | one-time | `recordKyc` — **defined, not yet wired** |
| Profile complete | `+5` | one-time | `/api/seller` route (when name/bio/location/avatar/phone all set) |
| New-account deficit | `-40` | one-time | `lib/profile.ts` |

So today only **new-account, phone-verified, profile-complete, and engagement** are live; transaction/review/KYC/Zalo/fast-response are implemented engine-side but await their respective flows (checkout, identity, Zalo OAuth). A reviewer should not assume the full earn loop is active.

### Report flow + severity penalties

**Filing** — `POST /api/report` (`src/app/api/report/route.ts`):
- **Auth required** (`getCurrentProfile`) — reports must be attributable for the anti-abuse rules to work (line 18-21).
- A report can target a listing and/or a storefront. Critically, when a `listingId` is given the server **derives `sellerId`/`targetProfileId` from the listing itself and ignores any client-supplied `sellerId`** (`report.ts:51-54`) — otherwise a report about listing X could be pinned on seller Y.
- Anti-abuse gates *before* insert: (1) `reportCooldownUntil` block → 429; (2) `rateLimit('report', reporterId, 10, '1h')`; (3) can't report self; (4) **one open report per reporter per resolved target identity** — deduped on `targetProfileId` (falling back to `targetSellerId`, then `listingId`) so a reporter can't stack a listing-report + storefront-report against the same seller (`report.ts:71-84`); (5) `MAX_OPEN_PER_LISTING = 50` — past the cap it **silently returns ok** without revealing the cap.
- Reasons: `scam | counterfeit | sold | wrong-info | duplicate | offensive | other`. `severity` is pre-stamped at creation via `severityForReason` (`trust.ts:92-96`): scam/counterfeit → `severe`, wrong-info/offensive/misrepresentation → `moderate`, everything else → `minor`. Admin can override on confirm.

**Resolution** — `POST /api/admin/moderate` (`src/app/api/admin/moderate/route.ts`), re-checks `getAdmin()` server-side. Report actions:
- `confirm-report`: idempotent open→confirmed transition (uses `updateMany ... where status:'open'`, bails if `count===0` so a double-click can't re-dock). Penalty = `-SEVERITY_PENALTY[severity]` → **minor −3, moderate −10, severe −25** (`trust.ts:30-34`). One severe report erases five completed transactions. Routes to `applyTrustEvent(targetProfileId, 'report_confirmed', …)` for owned accounts, else `penalizeSeller(targetSellerId, …)` for guest sellers. Then **reactively unpublishes the reported listing** (`verified:false`).
- `dismiss-report`: open→dismissed, no score change.
- `abusive-report` (anti-fake-report): idempotent open→abusive, then penalizes the **reporter** — `falseReportStrikes += 1`, `reportCooldownUntil = now + 14 days` (`REPORT_COOLDOWN_DAYS`), and a `-10` trust hit (`FALSE_REPORT_PENALTY`, logged as `manual_adjust` reason `false_report:<id>`).

### `penalizeSeller` — the guest-seller path

`penalizeSeller(sellerId, delta, meta?)` (`trust.ts:201-212`) handles sellers with **no owning account** (`ownerId` null — the common anonymous-post case). If the seller *is* owned, it just forwards to `applyTrustEvent` on the owner (Profile is source of truth). If it's a guest seller there's no Profile to attach an event to, so it **docks the `Seller.trustScore` mirror directly** (clamped at 0), sets `trustTier` to `restricted` (`<60`) or `standard`, and syncs the listings' `sellerTrustScore`. Guest sellers can therefore only ever be Standard or Restricted — the badged tiers require an account. Their penalties are **not** captured in the audit log and are **not** recoverable by the cron (no `TrustEvent` rows).

### Denormalization dual-write (the ranking key)

The score is materialized down three levels so the hot feed read-path never joins:
- `Profile.trustScore` / `trustTier` — source-of-truth cache.
- `Seller.trustScore` / `trustTier` — mirror so a storefront card renders join-free.
- `Listing.sellerTrustScore` — pure **ranking key** (`schema.prisma:197-202`). The feed `ORDER BY`s this local indexed column instead of joining Seller + external-sorting on every query. Card display still reads the joined seller; this column is *only* for ordering.

Every `recomputeTrust` cascades all three (`trust.ts:153-162`). Because Prisma `updateMany` can't filter by a relation, it first resolves the owned seller id(s) then bulk-updates listings. `sellerTrustScore` is also written at listing-create time (`api/listings/route.ts:611`, `api/listings/bulk/route.ts:139`) from the seller's current score. Consumers ordering by it: home feed, category pages, `/api/listings`, recommendations, search suggest, category rails, AI concierge — the standard tiebreak chain is `[{sellerTrustScore:'desc'}, {featured:'desc'}, {postedAt:'desc'}, {id:'desc'}]`. Backfill helper: `scripts/backfill-listing-trust.mjs`.

**Gotcha**: this is eventually-consistent denormalization with no transaction spanning the three writes — a crash mid-`recomputeTrust` can leave Listing rows stale until the next event or a backfill run. It's a ranking signal, not an integrity-critical value, so this is acceptable by design.

### Decay & recovery cron

`runTrustMaintenance()` (`trust.ts:285-340`) is invoked at the tail of the daily-reminders cron — `GET /api/cron/daily-reminders` (`src/app/api/cron/daily-reminders/route.ts:97`), scheduled `0 2 * * *` in `cloudbuild.yaml`, guarded by `CRON_SECRET` via constant-time bearer check. It is **not** its own cron entry — it piggybacks. Two passes:

- **Decay**: owners with ≥1 verified+active listing whose `availabilityConfirmedAt` (or `postedAt` if never confirmed) is older than `INACTIVE_DAYS = 7` get `-3` (`INACTIVE_PENALTY`, type `decay_inactive`), **at most once per 7-day window** (skips owners already docked within the window). Rewards keeping listings fresh; the "confirm availability" bump both stops the reminder and earns the `+2` engagement.
- **Recovery**: accounts with `trustScore < 100` that have at least one behavioral penalty (`report_confirmed` or `decay_inactive`) drift back up `+1/day` (`RECOVERY_DELTA`, type `decay_recover`) — **only** if clean for the last `RECOVERY_CLEAN_DAYS = 14` (no recent report/inactivity hit). Crucially, recovery is **capped at the total magnitude of behavioral penalties** (`remaining = penalty − alreadyHealed`): it heals reports/inactivity but **never** the new-account/verification deficit. So recovery alone can't lift an unverified account to 100 — only actually verifying (KYC/phone/Zalo/profile) closes that gap. This gives "no permanent death" for a single old mistake while keeping the Sybil baseline intact.

Both passes are bounded (`take: 20000`) and per-account work is serial within the loop. Failures are caught and logged so trust maintenance never breaks the reminder job.

### Security posture summary

- Reports are auth-gated and attributable; client-supplied target ids are never trusted (derived server-side from the listing).
- All score mutations are append-only + recomputed, so they're auditable and reversible; the cached columns are disposable and rebuildable via `unique-constraints.mjs`.
- Idempotency is enforced at three layers: app pre-check counts, `applyOnce` P2002 swallowing, and the DB partial unique index (which must be re-applied after every `db push`).
- Confirm/abusive transitions are idempotent on the `open → X` status change, so admin retries/double-clicks can't double-penalize.
- RLS is bypassed by design across the whole app — these app-code guards are the *only* enforcement; there is no database-level policy backstop on `TrustEvent`/`Report`.

Key files: `src/lib/trust.ts` (engine), `src/lib/trust-score.ts` (color bands), `prisma/schema.prisma:360-415` (Report + TrustEvent + denorm columns at :42-47, :137-140, :197-202), `src/app/api/report/route.ts` (filing), `src/app/api/admin/moderate/route.ts` (resolution), `src/app/api/cron/daily-reminders/route.ts` (decay/recovery trigger), `scripts/unique-constraints.mjs` (DB belt + rebuild), `src/lib/profile.ts` / `src/lib/admin.ts` / `src/app/api/seller/route.ts` / `src/app/api/listings/[id]/confirm/route.ts` (earn wiring).

---

## Messaging & Contact

In-app, listing-scoped chat between a buyer and a seller's storefront, with structured price offers, Supabase realtime delivery, and a server-enforced "reply-first" gate that is the *only* way to obtain a seller's phone number. RLS is bypassed by design across the app; the realtime layer is the one place where Postgres RLS is actually relied on (see Realtime below).

### Data model

`prisma/schema.prisma:285-335`.

**`Conversation`** — one thread per `(listingId, buyerProfileId)` (enforced by `@@unique`, `schema.prisma:308`):
- `buyerProfileId` (`@db.Uuid`) is always a real account; `buyerProfileId == auth.users.id == auth.uid()`.
- `sellerId` points at the `Seller` storefront. `sellerProfileId` is **nullable** — null until the seller claims their business account, at which point existing threads "light up" (the seller side gets a participant id and starts receiving). A claimed seller has `Seller.ownerId` set; on conversation create, `sellerProfileId = listing.seller.ownerId ?? null` (`api/conversations/route.ts:45`).
- Denormalized inbox state, kept consistent on every send: `lastMessageAt`, `lastMessageText` (truncated to 140 chars), and per-side `buyerUnread` / `sellerUnread` counters. This powers the inbox list and the global unread badge with no joins / no N+1.
- Per-user soft delete: `buyerDeletedAt` / `sellerDeletedAt`. "Delete conversation" stamps the caller's timestamp; the inbox query hides the row only while `lastMessageAt <= myDeletedAt`, so it **reappears if the other party replies** (non-destructive; the other side never loses the thread). See `api/conversations/route.ts:113-117` and the DELETE handler at `api/conversations/[id]/route.ts:64-86`.
- Two composite indexes `(buyerProfileId, lastMessageAt desc)` and `(sellerProfileId, lastMessageAt desc)` so each arm of the inbox `WHERE buyer=me OR seller=me ORDER BY lastMessageAt DESC` is served index-ordered (`schema.prisma:316-317`).

**`Message`** (`schema.prisma:320-335`) — `body`, `senderProfileId` (`@db.Uuid`), plus a structured-offer overlay carried in the same timeline: `kind` is `'text' | 'offer'`; offers also set `offerAmount` (VND float) and `offerStatus` (`'pending' | 'accepted' | 'declined' | 'countered'`). Indexed `(conversationId, createdAt)`.

Offers and offer-action outcomes are stored as ordinary messages (with a leading 💰/✅/❌ emoji in `body`), so the chat timeline is the single source of truth.

### Auth model on hot paths

Read/write message paths use `getCurrentProfileId()` (`lib/admin.ts:73`), which verifies the JWT **locally** via `supabase.auth.getClaims()` (ES256 / cached JWKS, no network, no DB) and returns `claims.sub`. A forged/expired/absent token fails closed to null. Trade-off: server-side ban/revocation only takes effect at token expiry (~1h) — deemed acceptable for 2-party participant-gated chat, but **not** for the contact reveal or admin powers, which use the network-revalidating `getUser()`. Conversation *create* uses `getCurrentProfile()` (`lib/admin.ts:38`) because it must provision/own the Profile FK target.

Every route is `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, and re-checks `iAmBuyer || iAmSeller` before doing anything (e.g. `api/conversations/[id]/messages/route.ts:41-43`). Clients never write to the DB directly; all inserts go through Prisma server routes.

### The reply-first contact-reveal gate (phone is never in any payload)

`src/app/api/listings/[id]/contact/route.ts` is the **only** code path that can resolve a seller's phone. The number is server-only: `lib/contact.ts` is `import 'server-only'`, `phoneForSeller()` returns the seller's real stored phone or null (never a synthetic fallback), and no listing/seller API ever selects `phone` into a client payload.

`POST /api/listings/[id]/contact` enforces, in order:
1. **`getUser()`** — JWT revalidated against Supabase Auth (not the spoofable cookie/getClaims path). No user → 401 (`contact/route.ts:26-28`).
2. **Dual sliding-window rate limit**, both must pass: 30/h per user *and* 60/h per IP, `strict` (`contact/route.ts:33-39`) → 429.
3. Listing must exist **and be `verified`** — pending/hidden listings never expose contact → 404 (`:46`).
4. **Reply-first gate** (`contact/route.ts:53-60`): the caller must have a `Conversation` for this `(listingId, buyerProfileId)` **and** that conversation must contain at least one message whose `senderProfileId != user.id` (i.e. the seller actually replied). Otherwise → **403 `reply_required`**. Rationale in the code: listing IDs are public/enumerable, so without this gate a single account could enumerate listings and harvest every seller's phone. This rule was previously only enforced in the UI; it is now enforced server-side.
5. Only then is `phone` resolved and returned as `{ phone, telHref, zaloHref }` (`tel:` normalized to `+84`, Zalo deep link).

Side effects on a *new* reveal: a `ContactReveal` row is created (unique `(listingId, viewerId)`), `Listing.contactCount` is incremented, and a Meta CAPI `Contact` event is fired via `after()` (post-flush, zero client cost). A Prisma `P2002` (already revealed by this viewer) is swallowed so the contact is still returned without double-counting (`contact/route.ts:67-86`).

UI side (`messages/[id]/page.tsx`): the "Request number / Zalo" button only renders once `thread.messages.some(m => !m.mine)` is true (`:316`); before that the user sees "You can request the seller's number or Zalo once they reply." The button itself is a thin call to the gated route (`requestContact`, `:201`). The UI gate is convenience only — the 403 is the real boundary.

### Sending, offers, and notifications

`insertMessage()` in `lib/messages.ts:25` is the single side-effect point, shared by the send route and the conversation-create route (initial message). In **one `db.$transaction`** it: (a) for an offer, marks any still-`pending` offer in the thread `countered` (the "counter" flow — only the latest offer is actionable); (b) inserts the `Message`; (c) updates the denormalized `lastMessageAt`/`lastMessageText` and increments the **other** party's unread counter (`messages.ts:30-58`).

Notification policy (`messages.ts:64-92`): plain text messages do **not** create a bell `Notification` or a web push — they already surface on the unread badge. Only **offers** (and offer outcomes) create a `Notification` + a best-effort `sendPushToProfile()` fired via `after()`. `actOnOffer()` (`messages.ts:103`) lets only the offer's **recipient** accept/decline, using an atomic `updateMany ... where offerStatus='pending'` claim so concurrent clicks (TOCTOU) can't both emit a confirmation message/notification (`messages.ts:120-121`); it drops a `✅/❌` confirmation line into the timeline and notifies the offerer.

Endpoints: `POST /api/conversations` (idempotent create + optional first message/offer, relying on the unique constraint and a P2002 catch so `created` stays accurate under a double-tap race — `api/conversations/route.ts:46-87`); `POST /api/conversations/[id]/messages` (rate-limited 20/min, max 2000 chars); `POST /api/conversations/[id]/offer`; `DELETE /api/conversations/[id]/messages/[mid]` (own message only, recomputes the last-message preview if the deleted one was last).

### Realtime (Supabase broadcast)

Set up by `scripts/messaging-realtime.mjs` (run via `npm run db:setup`; **idempotent, must be re-applied after any DB reset/`prisma db push`** — it is not part of the Prisma schema). The design uses **broadcast triggers + RLS receive policies**, not Postgres logical replication:

- **`broadcast_new_message()`** — an `AFTER INSERT` trigger on `"Message"`, `SECURITY DEFINER` (so the send itself bypasses RLS; clients are granted **no** insert policy and can never publish content). It calls `realtime.send(...)` twice (`messaging-realtime.mjs:33-75`):
  - The full message (`id`, `conversationId`, `senderProfileId`, `body`, `createdAt`) on the **private** topic `convo:<conversationId>` — receivers render straight from the socket with **zero refetch**.
  - A content-free `convo_activity` nudge (`conversationId`, `senderProfileId` only) to **each participant's** private `user:<profileId>` topic, so a client subscribes to **one** channel for the global unread badge / inbox refresh instead of one-per-conversation (unbounded, no convo cap).
- **`broadcast_deleted_message()`** (`AFTER DELETE`) broadcasts a content-free `message_deleted` `{id}` on `convo:<id>` so the other side removes the bubble live.
- **`broadcast_typing(p_convo, p_from)`** (`messaging-realtime.mjs:105`) — a `SECURITY DEFINER` function the app calls via `db.$executeRaw` from `POST /api/conversations/[id]/typing` (ephemeral, no DB write). It **re-checks participation** before emitting `typing` on `convo:<id>`, so a client can never signal on a conversation it isn't in.
- All three `broadcast_*` functions have `EXECUTE` revoked from `public/anon/authenticated` (`messaging-realtime.mjs:130-132`) so they can't be reached via PostgREST `/rpc/...` (Supabase advisor 0028/0029); only triggers and the service-role app invoke them.
- **RLS receive policies** on `realtime.messages` (`messaging-realtime.mjs:138-170`) are what actually gate delivery: a `SELECT` policy lets a user receive on `convo:<id>` only if `auth.uid()` is that conversation's buyer or seller (`split_part(realtime.topic(), ':', 2)` → conversation id, no join needed because `Profile.id == auth.uid()`), and a second policy lets a user receive on `user:<id>` only when the topic equals `'user:' || auth.uid()`. These are the only RLS policies the app depends on.

Client side: `chat-context.tsx` subscribes once per signed-in user to `user:<id>` (private), calls `supabase.realtime.setAuth(access_token)` first, and on a `convo_activity` event (ignoring its own `senderProfileId`) debounces a `refreshUnread()` + `refreshConvos()` (`chat-context.tsx:166-205`). It drops the socket on `pagehide` and restores on `pageshow` so an open WebSocket doesn't disqualify the page from bfcache. A 45s visibility-gated poll is the only backstop. The open thread (`messages/[id]/page.tsx:80-152`) additionally subscribes to `convo:<id>`, appending incoming `new_message` payloads directly (dedup by id; skip own echo via `meRef`); offer/offer-action payloads (body starts with 💰/✅/❌) trigger a `load()` refetch instead, since the realtime payload omits the structured offer fields. There's a capped reconnect loop (5 attempts, 3s) and a 15s backstop poll.

### Mark-read on a live message

Opening a thread is "read": `GET /api/conversations/[id]` zeroes the caller's side, but **only writes when there's something to clear** (`api/conversations/[id]/route.ts:32-39`) so the polling/realtime reloads stay write-free. When a counterpart message arrives over the socket while the thread is already open, the client immediately re-runs `load()` (which performs that zeroing GET) and then `refreshUnread()` + `refreshConvos()` (`messages/[id]/page.tsx:119-125`), so the header badge and the inbox row's unread pill clear instantly for the already-read thread instead of drifting until the next backstop poll — the own-echo case is skipped via `senderProfileId !== meRef.current`.

### Inbox / thread UI

`/messages` is a persistent two-pane messenger (`messages/layout.tsx`): the `ConversationList` lives in the layout so it never remounts when switching threads (left pane / full-screen on mobile), and the thread renders in the right pane (`children`). `messages/page.tsx` is just the desktop empty-state placeholder.

- **`ConversationList`** (`components/marketplace/conversation-list.tsx`) reads `convos` from `ChatContext`, pins an "eno AI" entry on top, supports client-side search, floats unread (and the open) threads to the top via a stable sort, renders offer-aware previews ("💰 New offer", "✅ Offer accepted", etc.), and does optimistic per-user delete with a 5s Undo (the server DELETE is held for the toast's lifetime — `chat-context.tsx:110-132`).
- **`ChatProvider`** (`context/chat-context.tsx`) owns inbox + per-thread caches (in-memory `Map` backed by per-user `localStorage`, keyed by `userId` so nothing leaks across accounts and a cleared on sign-out), prefetches the top 3 threads, and exposes `refreshUnread`/`refreshConvos` plus the floating-widget state.
- **Thread page** (`messages/[id]/page.tsx`) paints instantly from cache, then revalidates with count-aware reconciliation of optimistic `temp-` messages (so a poll landing mid-POST never duplicates or flicker-hides a bubble — `:58-74`). Sends are optimistic with a tap-to-retry failure state (Vietnam mobile networks drop requests often — `:189-197`). The composer's Tag button flips the single input between text and an offer-amount field with a `+000` (×1,000 VND) shortcut; offer cards render Accept/Decline/Counter only for the recipient on a `pending` offer.

Key gotchas: realtime DDL is **not** in the Prisma schema and is lost on reset — re-run `npm run db:setup`; `convo:<id>` content delivery depends entirely on the `realtime.messages` RLS receive policy being present; the phone number lives only behind the `getUser()` + verified-listing + reply-first + rate-limit gate and exists in exactly one server-only resolver (`lib/contact.ts`).

---

## AI features

eno.vn ships four AI surfaces, all server-side and all funnelled through one shared gate. Two distinct Google billing sources back them, and the code is deliberately built so the open-ended (credit-draining) paths can never be hit anonymously or without a spend ceiling.

### The four paths at a glance

| Path | Route | Model / engine | Google account & credit | Entry point |
|---|---|---|---|---|
| **Concierge** ("eno AI" chat) | `POST /api/ai/concierge` (`src/app/api/ai/concierge/route.ts`) | Gemini for query-rewrite + **Vertex AI Search** for retrieval & summary | rewrite → Gemini project; retrieval/summary → **$1000 "GenAI App Builder" credit** | `src/app/messages/ai/page.tsx`, launched by `AISearchButton` in `src/components/marketplace/ai-concierge.tsx` |
| **Classify** (photo → category autofill) | `POST /api/ai/classify` (`src/app/api/ai/classify/route.ts`) | Gemini 2.5 Flash (vision) | Gemini project (real money / $300 trial) | `src/components/marketplace/post-wizard.tsx` |
| **Rephrase** ("Polish" description) | `POST /api/ai/rephrase` (`src/app/api/ai/rephrase/route.ts`) | Gemini 2.5 Flash (text) | Gemini project | `src/components/marketplace/post-wizard.tsx` |
| **Visual search** (photo → search query) | `POST /api/ai/visual-search` (`src/app/api/ai/visual-search/route.ts`) | Gemini 2.5 Flash (vision) | Gemini project | `src/lib/visual-search.ts` (camera/paste in search bar) |

### Which Google account / credit each path draws from

This is the crux of the subsystem and is **non-obvious**: there are **two separate Google projects with two separate credits**, decoupled on purpose (`src/lib/gemini.ts:14-43`, `src/lib/vertex-search.ts:4-22`).

- **Vertex AI Search (Discovery Engine)** — the only thing that draws the **$1000 GenAI App Builder trial credit**. Catalog search + the generated summary bill under the "Vertex AI Search & Conversation" SKUs that the credit covers. Configured via `GOOGLE_VERTEX_PROJECT` / `GOOGLE_VERTEX_CREDENTIALS` / `VERTEX_SEARCH_DATASTORE_ID` / `VERTEX_SEARCH_ENGINE_ID` (the `eno-vn` project where the data store lives).
- **Gemini API (`gemini-2.5-flash`)** — bills **real money; the $1000 credit does NOT cover it** (`src/lib/gemini.ts:16-20`). `getGemini()` therefore prefers its own `GEMINI_PROJECT` / `GEMINI_LOCATION` / `GEMINI_CREDENTIALS` env (the `eno-translate` project on the $300 free trial) and only falls back to the shared `GOOGLE_VERTEX_*` creds when those are unset. So the Gemini spend and the Vertex Search credit stay on different billing accounts even though both run "on Vertex AI."

Net effect per path:
- **Concierge** uses *both*: the multi-turn query-rewrite is a tiny Gemini call (real money, fractions of a cent), while retrieval and the one-sentence reply run on Vertex AI Search so they hit the $1000 credit (`route.ts:18-23`, `170-179`; `conciergeSearch` in `vertex-search.ts:114-139`). When Vertex isn't configured or is over budget it degrades to a free Postgres keyword search (`source:"fallback"`, `route.ts:185-187`) — that path draws *no* credit.
- **Classify / rephrase / visual-search** are **Gemini-only** → real-money / $300-trial project. No Vertex involvement.

Credentials in both libs accept the service-account JSON either raw or base64-encoded (base64 is paste-safe in the Secret Manager console) and are injected inline — no key file on serverless (`gemini.ts:28-37`, `vertex-search.ts:48-50`).

### The shared gate: `src/lib/ai-guard.ts`

Every paid AI route calls `aiGuard(name, hourlyLimit?)` before doing any work:

1. **Login-only.** `getCurrentProfileId()` (`src/lib/admin.ts:73-82`) verifies the Supabase JWT *locally* via `getClaims()` (ES256/JWKS, no network or DB hit); a forged/expired/absent token fails closed to `null` → `401 auth_required`. Keying on the Profile id (not IP) makes the account the accountable unit, since per-IP is spoofable behind Cloudflare (`ai-guard.ts:6-11`).
2. **Per-account hourly cap, strict (fail-closed).** `rateLimit('ai-<name>', profileId, limit, '1 h', { strict: true })` → `429 rate_limited` when exceeded. Default `AI_HOURLY_LIMIT = 10` for the discovery/credit-drain surfaces (**concierge, visual-search**); the authoring routes pass higher caps because a seller legitimately processes many items — **classify 40** (`classify/route.ts:27`), **rephrase 60** (`rephrase/route.ts:18`).

**Gotcha — strict means no limiter = AI fully off.** `rateLimit` (`src/lib/ratelimit.ts:45,57`) returns `success: !opts.strict` when the limiter errors. Because `aiGuard` is always `strict`, a limiter outage fails **closed**: every AI request 429s. This is intentional — a missing env var must never silently reopen the paid-credit drain — but it means the limiter is a hard dependency for AI to function at all, not just for protection.

### Global daily budget breakers (concierge only)

The per-account cap bounds one abuser; the **global** breakers bound total spend across all accounts and IP rotation. They exist **only on the concierge route**:

- `ai-concierge-gemini`, key `'global'`, **5000/day**, strict (`concierge/route.ts:90-91`) — caps total Gemini rewrite spend. Over budget, or Redis down (strict), the rewrite degrades to the regex/keyword `heuristicRewrite` (`route.ts:71-75`) — no Gemini call.
- `ai-concierge-vertex`, key `'global'`, **20000/day**, strict (`route.ts:173-175`) — caps Vertex AI Search (the $1000 credit). Over budget / Redis down → skip Vertex, use the free Postgres `fallbackSearch` (`route.ts:127-143`).

**Gotcha:** classify, rephrase, and visual-search have **no** global daily breaker — only the per-account hourly cap protects them. Their real-money Gemini ceiling is therefore `(active accounts) × (40/60/10 per hour)`, not a single global number.

### Concierge behavior & safety details

- **Multi-turn rewrite** (`rewriteQuery`, `route.ts:79-124`): a `temperature:0`, JSON-mode Gemini call turns the latest message into a standalone query and extracts `sort` / `min/maxPriceVnd` / `categorySlug`, resolving references ("cheapest one" after "computer" → "computer"; a new topic *replaces* the old). It always computes a heuristic fallback first so a Gemini hiccup never drops the concierge to the dumb path.
- **Vertex summary voice** is constrained by `CONCIERGE_PREAMBLE` (`vertex-search.ts:88-89`): one warm sentence, and explicitly forbidden from restating price/location/trust/IDs (the cards already show those). `relevanceThreshold: 'MEDIUM'` and a trust-score boost spec (`vertex-search.ts:99-106`) keep results on-topic and trust-first. The generated summary requires an *engine* (`VERTEX_SEARCH_ENGINE_ID`) with LLM features; a bare data store still returns ranked ids.
- **Re-hydration from Postgres**: Vertex returns only ids; the route re-fetches them filtered to `verified:true, status:'active'` and preserves relevance order (`route.ts:182-184`).
- **Ingestion indexes PUBLIC fields only** — `listingToDoc` deliberately omits seller phone/contact/PII (`vertex-search.ts:149-180`); mutations sync via fire-and-forget `syncListingToVertex` (`vertex-search.ts:211-215`).

### Authoring/vision safety (classify, rephrase, visual-search)

- **Never trust the model's output.** Classify validates the returned category/subcategory/type against `TAXONOMY` server-side and falls back to nulls on a miss (`classify/route.ts:130-134`); visual-search validates `category` against `CAT_SLUGS` (`visual-search/route.ts:95`). A bad model response can never write an invalid slug onto a listing.
- **Brand anti-hallucination:** brand is only surfaced when `brandConfident === true` *and* the category actually has brands (`categoryHasBrand`), else `brandUncertain` is returned so the wizard asks for a clearer logo photo rather than guessing a luxury brand from a look-alike (`classify/route.ts:140-145`, prompt at `66-69`).
- **Phone-number scrubbing:** both classify and rephrase run `containsPhoneNumber()` over generated text and drop/replace it (classify nulls the description `classify/route.ts:149`; rephrase falls back to the seller's original `rephrase/route.ts:58`).
- **Image handling:** uploads are decoded and downscaled to 512px JPEG via `sharp` before the vision call (`classify/route.ts:43-49`, `visual-search/route.ts:38-44`); `MAX_BYTES = 12 MB`.
- **`thinkingConfig.thinkingBudget: 0`** is set on every Gemini call. 2.5-flash is a thinking model; left on, its tokens eat the output budget and truncate the JSON (`MAX_TOKENS` → unparseable). Disabling it routes all tokens to the structured answer (`classify/route.ts:85-88`).
- **Graceful disable:** `getGemini()` returns `null` when unconfigured (`gemini.ts:24`), so classify/rephrase/visual-search return `503 ai_unavailable`; the concierge instead keeps working on heuristic + Postgres fallback.

### Client gotcha

The concierge chat (`messages/ai/page.tsx`) is **members-only on the client too**: it calls `openSignIn()` before firing rather than letting the server 401 (`page.tsx:59-61`), shows a sign-in CTA in the composer when logged out, surfaces the 10/h limit message on a `429` (`page.tsx:78-79`), and persists history only in `localStorage` (`eno:ai_chat_v1`) — there is no DB conversation row. Visual search likewise dispatches an `eno:require-signin` event on `401` (`src/lib/visual-search.ts:16`).

---

## Seller Dashboard & Bulk Operations

The seller-side CRM: a tiered dashboard (individual vs. business), an inline business-profile editor, business-only bulk CSV import, a daily availability-review flow, and the cron jobs + Web Push that nudge sellers to keep listings fresh. All authorization is in app code — Supabase RLS is bypassed by design, so every route below independently re-derives the caller via `getCurrentProfile()` and scopes writes to the caller's own storefront.

### Dashboard (`/dashboard`)

- **Server page** `src/app/dashboard/page.tsx` is a thin shell: `dynamic = 'force-dynamic'`, `robots: noindex`, loads only categories (to power the inline "Post" tab) and hands off to the client. The real payload comes from a client `fetch`.
- **Data API** `src/app/api/dashboard/route.ts` (`GET`) returns the owner-scoped CRM payload. It looks up the `Seller` by `ownerId: profile.id`, includes that seller's listings, aggregates unread messages from `Conversation.sellerUnread` where `sellerProfileId = profile.id`, and computes `stats` (totalViews, totalLeads = sum of `contactCount`, activeCount, soldCount, hiddenCount, `heldCount` = active-but-`!verified`, staleCount, unreadMessages). The crucial field is `tier`: `profile.accountType === 'business' ? 'business' : 'individual'` (`route.ts:48`) — this single flag drives every business-only UI branch.
- **Client** `src/app/dashboard/dashboard-client.tsx` is cache-first: it paints from a `localStorage` snapshot keyed `eno-dashboard` (gated on matching `user.id`) then revalidates via `/api/dashboard`. Late responses after sign-out/account-switch are discarded by re-checking `uid !== user?.id` (`dashboard-client.tsx:99`). Three tabs (`post` / `listings` / `account`) are driven reactively from `?tab=` so the header account menu can switch tabs even when already on `/dashboard`.
  - **Tiering in the UI:** the second analytics row (live/sold counts, response rate, and the **Bulk → /dashboard/bulk** card) renders only when `isBusiness` (`dashboard-client.tsx:210`). A business with no storefront yet (no first listing) gets a "Set up your storefront" nudge instead. The "account" tab shows `BusinessProfileEditor` when `isBusiness && d.seller`, else the individual `ProfileEditor`.
  - **"Needs attention"** = live listings only that are held (`!verified`) or stale (`isStale(availabilityConfirmedAt, postedAt)`); sold/hidden are terminal.
  - **Auto availability redirect:** the first time per day a seller with ≥1 active listing lands on a *bare* `/dashboard` (no `?tab=`), they're `router.replace`'d to `/dashboard/availability`. The once-per-day guard is a `localStorage` marker `eno-avail:<uid>` set to `todayStr()` (`availability-client.tsx:16-17`). A deep-link with `?tab=` suppresses the hijack.

### Business profile editor

`src/components/marketplace/business-profile-editor.tsx` edits the storefront inline via `PATCH /api/seller` (name/bio/location/phone, and `avatarUrl` only when changed — re-sending an unchanged non-bucket logo URL would 400 because the API only accepts Supabase-hosted images, `business-profile-editor.tsx:78-79`). The **representative name** is a separate concept: it lives on the `Profile.displayName` (one business → many staff accounts) and is saved with a parallel `PATCH /api/profile`; buyers see the business name, not the rep. Logo upload runs the file through `compressImageFile` (HEIC→JPEG + downscale to avoid 413) then `POST /api/upload`. "Use my location" reverse-geocodes device GPS via `/api/reverse-geocode`. Server-side `/api/seller` PATCH returns typed errors the editor maps to copy: `no_phone_in_profile`, `phone_taken`, `bad_phone`.

### Bulk CSV import

Entry point `/dashboard/bulk` (`src/app/dashboard/bulk/page.tsx`, noindex). Client `bulk-client.tsx` parses CSV with PapaParse (headers lowercased/trimmed), validates a preview that **mirrors** the server rules, and submits only valid rows. Columns: `category_slug,title,description,price,district,condition,image_urls`. Template download includes a `# Valid category_slug values:` legend line.

**Server** `src/app/api/listings/bulk/route.ts` (`POST`, `runtime = 'nodejs'`) is the authoritative validator — the client preview is never trusted. Gating and budgets:

- **Auth/tier gate:** 401 if no profile; **403 `business_only`** if `accountType !== 'business'` (`bulk/route.ts:69`); 403 `no_storefront` if the business has no `Seller` row yet.
- **Rate limit:** `rateLimit('bulk-import', profile.id, 10, '1 h')` → 429 `rate_limited`. This limiter **fails OPEN** — `src/lib/ratelimit.ts` returns `success: true` when the limiter errors (unless `strict`). The deliberate posture (`bulk/route.ts:71-74`): an accountable, authenticated business shouldn't be blocked by a Redis blip; the cap only stops a runaway loop. (Contrast: this is one of the routes where rate-limiting fails open.)
- **Row cap:** `MAX_ROWS = 200`. Over-cap is surfaced as **400 `too_many_rows`** rather than silently truncated (`bulk/route.ts:84-87`). The client also `.slice(0, 200)` defensively.
- **Per-row validation** (`bulk/route.ts:106-117`): category slug must resolve (slugs are batch-resolved once via one `category.findMany`); title ≥3 chars (capped 140); description capped 5000; price finite, `0 ≤ price ≤ 1e12`; **phone numbers rejected** in title/description via `containsPhoneNumber`. Each row is independent — a bad row pushes an error to `results[]` and `continue`s; one bad row never aborts the batch.
- **Image re-hosting + per-import fetch budget** — the security-load-bearing part. `image_urls` is split on `[|,\n]`, capped at 8 per row. For each URL, `rehost()` (`bulk/route.ts:32-60`):
  - First-party URLs (`isListingImageUrl` → pinned to *our* Supabase `listings/` bucket prefix, `src/lib/listing-image.ts:8`) pass straight through and **do not** touch the budget.
  - Remote URLs each cost one unit of `MAX_IMG_FETCHES = 120` — a **global per-import budget** on remote fetches. The rationale (`bulk/route.ts:21-24`): 200 rows × 8 imgs = 1600 potential fetch+decode+upload ops; a single request must not fan out that far (network/CPU/SSRF amplification). When the budget is exhausted, remaining remote images are skipped and `imageBudgetReached` is returned `true` so the UI can prompt to add photos later.
  - Remote fetch is **SSRF-guarded** via `safeFetch` (https-only, re-validates host at every redirect hop, rejects private/loopback/link-local). Then sharp decodes → `.rotate()` (bake EXIF, drop all metadata incl. GPS) → resize longest edge to 1600 → re-encode WebP q82, with `limitInputPixels: 50_000_000` against decompression bombs. sharp throwing on non-raster input is the defense that rejects a payload disguised with an image content-type or an SVG — it's never re-served as-is. `MAX_IMG_BYTES = 12 MiB` raw ceiling. Re-encoded bytes are uploaded to `bulk/<ts>-<rand>.webp` in the listings bucket; the public URL is stored, so bulk images become first-party validated assets, never hotlinks.
- **Auto-publish gate** mirrors single posts: `verified = hosted.length >= 1 && seller.trustTier !== 'restricted'` (`bulk/route.ts:132`). No usable image → held (`verified:false`, still status `active`) for review. Listings are created under the caller's own `sellerId` with denormalized `sellerTrustScore`, and `searchText` built via `buildSearchText`.
- **Side effects** via `after()` (non-blocking): `warmTranslations` for created titles/descriptions and `reindexListing` for AI search. Response: `{ created, failed, results[], imageBudgetReached }` — per-row results let the UI show exactly what imported.

### Availability reminders

The "is it still available?" loop that keeps the feed fresh. `STALE_DAYS = 7` and `BUMP_COOLDOWN_DAYS = 7` (`src/lib/stale.ts`).

- **Review UI** `/dashboard/availability` (`availability-client.tsx`): loads active listings from `/api/dashboard`, lets the seller tick sold items, submits `{ confirm, sold }` to `POST /api/listings/availability`, then marks the day done and returns to `/dashboard`.
- **Batch endpoint** `src/app/api/listings/availability/route.ts`: owner-scoped, ids capped at 500 each. `sold` → `updateMany status:'sold'`. `confirm` is split in two `updateMany`s (`availability/route.ts:36-45`): listings older than the 7-day cooldown get **both** `postedAt` and `availabilityConfirmedAt` bumped to now (re-tops the feed); listings still within cooldown only record `availabilityConfirmedAt` (stops the reminder without re-topping — anti-gaming). Only sold ids `revalidatePath('/listings/<id>')` (their cached page 404s non-active) — a plain confirm deliberately does **not** revalidate, to avoid ISR-write waste. Sold ids are pulled from AI search via `removeFromIndex` in `after()`.

### Web Push

- **Schema** `PushSubscription` (`prisma/schema.prisma:111`): one row per browser/device, `endpoint @unique`, `p256dh`/`auth`/`userAgent`, cascades on profile delete. The opt-in flag is `Profile.dailyReminderOptIn Boolean @default(true)` (`schema.prisma:48`).
- **Subscribe** `POST /api/push/subscribe`: upserts on `endpoint` (re-subscribing the same browser re-homes it to the current account if the device switched users). **SSRF gate:** `isAllowedPushEndpoint` requires https + a hostname matching a known push service (`src/lib/ssrf.ts:68-74`: googleapis.com/FCM, mozilla, windows WNS, apple) — the endpoint is later fetched server-side by web-push, so an arbitrary stored endpoint would be an SSRF sink. **Unsubscribe** `POST /api/push/unsubscribe` is owner-scoped (`deleteMany where endpoint + profileId`). **Prefs** `/api/profile/reminder-prefs` GET/POST toggles `dailyReminderOptIn` (strict boolean validation).
- **Sender** `src/lib/push.ts` (`server-only`): configures VAPID once per process from `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`. **If keys are unset, `sendPushToProfile` is a safe no-op returning 0** (not a throw) — so push silently disabled in dev/unconfigured prod. Sends to every device in parallel (best-effort, per-sub failures swallowed), and self-cleans: 404/410 endpoints are pruned, scoped to `profileId` so a concurrent re-home isn't clobbered by a stale 410 (`push.ts:47-49`).
- **Client** `reminder-settings.tsx` registers `/sw.js`, requests notification permission, and subscribes with the VAPID key; if an existing subscription used a *different* applicationServerKey (rotated keys), it unsubscribes first to avoid the re-subscribe throw. **Gotcha:** the daily availability review is always-on (not gated on push); push is just extra reach, and on iOS the site must be added to the Home Screen for push to be available (`reminder-settings.tsx:70`). **Service worker** `public/sw.js` (36 lines, intentionally minimal — push display + click only, no precache/offline so it never interferes with Next asset handling); `tag` collapses repeats; click focuses an existing tab (navigating where supported) or opens a new one.

### Cron jobs

Registered as Cloud Scheduler jobs (region `asia-southeast1`). Both are `runtime='nodejs'`, `maxDuration=60`, and authenticated by a **CRON_SECRET bearer check** using `timingSafeEqual` over the `Authorization: Bearer …` header (Cloud Scheduler attaches this to scheduled invocations) — missing/mismatched → 401. **Gotcha:** without `CRON_SECRET` set, the jobs return 401 to everyone, including Cloud Scheduler, so they never run.

- **`/api/cron/daily-reminders` — `0 2 * * *`** (`src/app/api/cron/daily-reminders/route.ts`): scans active+verified listings owned by a real account that haven't been confirmed since the 7-day cutoff, tallies stale count per owning profile, then for each profile with `dailyReminderOptIn:true` who hasn't been reminded within `REMIND_EVERY_MS` (20h, cross-run dedupe so duplicate fires are idempotent → one nudge/day) it inserts a `Notification` (type `'reminder'`, deep-links `/dashboard`) and calls `sendPushToProfile` (tag `eno-availability`). Bounded: `MAX_SELLERS = 1000`, `CONCURRENCY = 20` fan-out batches. Also runs `runTrustMaintenance()` (decay inactive / recover clean accounts) in a try/catch so a trust failure doesn't break reminders.
- **`/api/cron/saved-search-alerts` — `0 5 * * *`** (`src/app/api/cron/saved-search-alerts/route.ts`): for each `SavedSearch` with `notify:true` (ordered by `lastNotifiedAt asc`, cap `MAX_SEARCHES=5000`, `CONCURRENCY=10`), counts listings created since `lastNotifiedAt` matching `buildListingWhere(params)`; if any, drops a `Notification` (type `'saved_search'`, url `/?<params>`) + Web Push (tag `eno-saved-<id>`), then advances `lastNotifiedAt = runStart` so matches don't repeat. `runStart` is captured once before the loop to avoid a race where listings created mid-run are skipped.

### Security posture summary

App-code is the only guard (RLS bypassed). Every route re-derives the caller and owner-scopes writes (`sellerId`/`profileId` filters in `updateMany`/`deleteMany`). Three distinct SSRF defenses converge here: `safeFetch` (bulk remote image fetch), `isListingImageUrl` (only our bucket counts as first-party), and `isAllowedPushEndpoint` (push endpoint allowlist). Bulk import's two abuse brakes are the fail-open per-account rate limit and the fail-closed-ish `MAX_IMG_FETCHES=120` per-import remote-fetch budget (always enforced, in-process). Cron auth depends entirely on `CRON_SECRET`; push depends on VAPID keys (absent → silent no-op, never a crash).

---

## Growth, Feeds & Analytics

This subsystem covers everything eno.vn does to *measure* acquisition, *optimize* paid ads, *syndicate* inventory to ad/shopping networks, and *internationalize* content. The unifying design principle: **measurement is best-effort and invisible** — every path runs after the response flushes (`after()`), no-ops until configured, never throws into a user flow, and adds zero client/first-load cost wherever possible. The browser is deliberately under-used; the server is the source of truth.

### 1. Meta Conversions API (server-side, the primary conversion channel)

`src/lib/meta-capi.ts` is the single CAPI client. There is **no browser Pixel by default** (it was removed for performance — see §3), so conversions go straight from our server to Meta's Graph API (`graph.facebook.com/v21.0/{PIXEL_ID}/events`, `meta-capi.ts:25`).

- **Config / fail-safe**: `metaCapiConfigured()` (`meta-capi.ts:27`) requires **both** `META_PIXEL_ID` (falls back to `NEXT_PUBLIC_META_PIXEL_ID`) and `META_CAPI_TOKEN`. Until both are present, every `sendMetaCapiEvent` call is a **silent no-op** (`meta-capi.ts:91`) — safe to ship before creds exist. `META_TEST_EVENT_CODE` routes events to the Events Manager "Test events" tab.
- **Identity hashing** (`meta-capi.ts:31-63`): email/external_id are trim-lowercased then SHA-256; phone is digits-only (country code kept) then SHA-256; `_fbp`/`_fbc` cookies are sent **raw** (not hashed). `metaUserDataFromHeaders()` (`meta-capi.ts:67`) pulls IP (via `clientIp`, `'anon'` dropped), User-Agent, and the `_fbp`/`_fbc` cookies off the *incoming* request for Event Match Quality, merged with first-party identifiers (phone/email/our stable id).
- **Non-blocking by contract**: `sendMetaCapiEvent` uses `AbortSignal.timeout(4000)` (`meta-capi.ts:112`) so a slow Meta endpoint can't hold a serverless function open; failures are logged, never surfaced. Every caller wraps it in `after()`.
- **Conversion events wired** (all server-side, all in `after()`):
  - **`CompleteRegistration`** — `src/app/api/profile/account-type/route.ts:110`, on first onboard only. Enriched with first-touch `source/medium/campaign` (§2).
  - **`Contact`** — `src/app/api/listings/[id]/contact/route.ts:75`, fired **only inside the `contactReveal.create` try block** so it emits once per *new* (listing, viewer) reveal — a P2002 duplicate (already revealed) does not re-fire.
  - **`Lead`** — `src/app/api/listings/route.ts:645`, only when a new listing actually goes live (`autoPublish`), carrying `content_ids`/category/price.

### 2. ViewContent backstop with event_id dedup (`/api/track/view`)

`view_item` / `ViewContent` is the one **browsing** (non-conversion) event that also flows through CAPI, as a **reliability backstop** for the browser Pixel (ad-blockers drop the Pixel; a first-party server call survives).

Flow:
1. The server-rendered listing page mounts `<TrackView>` (`src/components/marketplace/track-view.tsx`), idempotent via a `useRef` keyed on listing id (survives StrictMode double-invoke, re-fires on soft-nav).
2. `trackViewListing()` (`src/lib/analytics.ts:69`) generates **one** `event_id`, passes it to the Pixel as `{ eventID }` (`analytics.ts:43`) **and** — *only if `hasAdConsent()`* (`analytics.ts:87`) — beacons the **same** `event_id` to `/api/track/view` via `navigator.sendBeacon` (keepalive, same-origin cookies so `_fbp`/`_fbc` reach the server).
3. Meta dedupes the Pixel `ViewContent` and the CAPI `ViewContent` into one event because they share the `event_id`.

`src/app/api/track/view/route.ts`:
- **Always returns 204** — analytics must never surface an error.
- No-ops immediately if CAPI isn't configured (`route.ts:17`).
- Per-IP rate limit `track-view`, **240/min, fail-OPEN** (`route.ts:27`) — a Redis blip must never drop a real view; the cap is generous because real browsing hits many listings.
- Inside `after()` it re-reads the listing and emits **only for a real public catalog item** (`verified === true && status === 'active'`, `route.ts:41`), so it never sends `ViewContent` for ids Meta couldn't match, and sources accurate price/currency (`'₫' → 'VND'`, else `'USD'`).

**Gotcha / nuance**: the header comment in `meta-capi.ts:10-14` says "no event_id dedup is needed" — that statement is about *conversions vs. browsing* (different event names). The ViewContent backstop *does* rely on event_id dedup, but only between the Pixel ViewContent and the CAPI ViewContent (same event name). The two systems are otherwise non-overlapping.

### 3. Consent-gated Pixel & GA4

`src/lib/consent.ts` defines three tiers stored in `localStorage` (`eno-cookie-consent`): `essential` → `personalized` → `all`. Helpers: `hasConsent()` (any choice), `personalizationAllowed()` (on-site "For You", ON unless explicit `essential`), and **`hasAdConsent()` (only `'all'`)** which gates every ad-network signal.

`src/components/marketplace/analytics-tags.tsx`:
- **GA4** (`NEXT_PUBLIC_GA_ID`, default `G-CKTZK62B0X`) is injected **only after first user interaction** (`pointerdown`/`keydown`/`touchstart`/`scroll`) with a 6 s idle fallback, via `next/script` `lazyOnload` — so ~155 KiB of vendor JS never competes with LCP/TBT and Lighthouse (which never interacts) sees a clean critical path.
- **Meta Pixel** is rendered **only if `hasAdConsent()` AND `NEXT_PUBLIC_META_PIXEL_ID` is set** (`analytics-tags.tsx:69`). It's reactive to the `eno:consent` event, so it flips on the instant the user clicks "Allow". By default the Pixel is **off**, `window.fbq` is undefined, and every `fb()` call in `analytics.ts` no-ops harmlessly. The CAPI conversions in §1 are independent of this and always run.

GA4 events still fire for `view_item`, `search` (`analytics.ts:91`), `generate_lead` (contact), `post_listing`, and `sign_up`. The Meta *conversion* equivalents (Contact/Lead/CompleteRegistration) are deliberately **not** fired client-side — they're server-side CAPI only, to avoid double-counting.

### 4. First-touch attribution & CAC

`src/lib/attribution.ts` implements sticky first-touch acquisition tracking via a tiny first-party cookie **`eno_attr`** (180-day max-age, `SameSite=Lax`, packed with short keys to stay small).

- `deriveFromLocation()` (`attribution.ts:39`) resolves channel from, in priority: `utm_source/medium/campaign` → `gclid` (google/cpc) → `fbclid` (facebook/paid-social) → referrer hostname mapping (`channelFromReferrer`, covers facebook/instagram/twitter/telegram/reddit/youtube/tiktok/zalo/google/bing/duckduckgo) → `direct/none`. Self-referrals are ignored so internal nav never overwrites the real source.
- `captureFirstTouch()` writes the cookie **only if none exists** (idempotent, sticky first-touch). It's invoked from `<AttributionCapture>` (`src/components/marketplace/attribution-capture.tsx`) in a mount effect — synchronous cookie ops only, no network, never blocks paint.
- **Server-side persistence**: on first onboard, `parseAttributionCookie()` reads `eno_attr` from the request Cookie header and (`account-type/route.ts:88-105`) persists it onto the `Profile` (`attrSource/attrMedium/attrCampaign/attrReferrer/attrLandingAt`, `prisma/schema.prisma:50-54`, indexed at `:70`). The write is wrapped in try/catch so a not-yet-migrated DB can't break signup, and the same attribution enriches the `CompleteRegistration` CAPI event and the GA4 `sign_up`.
- **CAC report**: `scripts/cac-by-channel.ts` groups onboarded Profiles (`accountType != null`) by first-touch `attrSource`/`attrMedium` straight from our DB (read-only; run with `DIRECT_URL`). CAC = channel spend ÷ that channel's signup count.

### 5. Product feeds — Google Shopping + Facebook/Meta catalog

One shared config module, two endpoints. **Both feeds reuse the GMC-style format** (Google product taxonomy, condition vocabulary, price format) so a single product mapping serves Meta and Google.

`src/lib/product-feed.ts` (shared):
- `FEED_CATEGORIES` — physical-product categories only (electronics, fashion-beauty, vehicles, furniture-appliances, baby-kids, hobbies-sports, pets, food-drink, moving-sale). Rentals/jobs/services/events/property are excluded because feeding non-products flags the whole feed.
- `GOOGLE_PRODUCT_CATEGORY` — category slug → Google taxonomy id (also accepted by Meta in `google_product_category`).
- `isMockImages()` — drops seeded picsum/loremflickr/placehold test data when `?exclude_mock=1` or `CATALOG_EXCLUDE_MOCK=true` (default OFF so the first import works); matches on URL **hostname**, not substring.
- **`feedAuthError()`** — optional HTTP **Basic auth** gated on `FEED_USER`+`FEED_PASSWORD` (the credentials Meta/Google enter in their scheduled-fetch "login details"). **Open by default** until both are set. Uses a length-guarded `crypto.timingSafeEqual` constant-time compare; full `user:pass` string match so a `:` in the password is fine.
- **`feedCacheHeaders()`** — returns `Cache-Control: private, no-store` + `Vary: Authorization`. This is a deliberate security choice: the open and protected feed share one path, so a shared-CDN copy could be served across the auth boundary; `no-store` prevents any cross-request reuse (feeds are pulled hourly, so CDN caching buys nothing anyway).

Both routes query `verified && active && listingType === 'sell' && category.slug ∈ FEED_CATEGORIES`, resolve real brand names in one batch query (a real brand beats the `eno.vn` fallback for matching), and **UTM-tag each item link** so catalog/shop clicks attribute back to the right channel in first-touch CAC:

- **`/api/feeds/google-shopping`** (`route.ts`) — RSS 2.0 XML with the `g:` namespace; `?utm_source=google&utm_medium=shopping`; emits `g:brand` when known, else `g:identifier_exists=no`.
- **`/api/feeds/facebook-catalog`** (`route.ts`) — Commerce Manager CSV (RFC-4180 escaping; `additional_image_link` carries a comma-list in one cell); `?utm_source=facebook&utm_medium=catalog`; powers FB/IG Shop + Advantage+ (DPA) ads.

Both map condition to `new | used | refurbished` (Vietnamese "mới" → new, "refurb" → refurbished, else used), title is brand-led + capped (150 chars), and price is formatted `"<amount> VND"`/`"<amount> USD"`.

### 6. Google Shopping / Merchant (organic) & Product JSON-LD

Beyond the Merchant feed, each listing detail page emits **Product + Offer JSON-LD** (`src/app/listings/[id]/page.tsx:162-204`) for free Google product listings: `Product` with `sku`/`mpn` = listing id, real `brand` when known, `Offer` with price/currency, 90-day `priceValidUntil`, `itemCondition`, `availability` (`SoldOut` for sold), plus `hasMerchantReturnPolicy` (`MerchantReturnNotPermitted` — meet-and-inspect marketplace, sales final) and `shippingDetails` (free local handover) to satisfy Merchant's "improve item appearance" recommendations. JSON-LD is emitted **only for indexable listings** (`:222`), and `<` is escaped to `\u003c`.

### 7. Social syndication (auto cross-post on publish)

`src/lib/syndicate.ts` cross-posts each newly **published** listing to the platform's own social channels. Invoked from `src/app/api/listings/route.ts:632` in `after()`, **only when `autoPublish`** (the listing actually went live — held/restricted posts don't broadcast).

- Built channels, both **env-gated and best-effort, isolated via `Promise.all` with per-channel try/catch** (one failure never blocks another or the request):
  - **Telegram** — `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (`sendPhoto` with caption if an image exists, else `sendMessage`).
  - **Facebook Page** — `FB_PAGE_ID` + `FB_PAGE_TOKEN` (photo post for reach, else link post).
- Instagram / X / Zalo are **not** implemented (need app review / paid tier / Official Account). A channel with no creds is simply skipped — the whole subsystem is dormant until configured. Caption = title + formatted price + district/location + listing URL.

### 8. Runtime translation

Lets every listing and the UI render in the visitor's chosen language. `src/lib/translate.ts`:
- **11 languages** (`LANGS`): en (source), vi (home market, often hand-authored), zh-Hans, ko, ja, ru, km, ms, th, fr, hi.
- **Provider cascade**: Google Cloud Translation v2 (`GOOGLE_TRANSLATE_API_KEY`) **primary**, Azure Translator (`AZURE_TRANSLATOR_KEY`/`REGION`) **fallback**, source-text passthrough if neither is set (`translateChunk`, `translate.ts:151`). Both have retry/backoff on 429/5xx. Note the per-provider code quirk: Simplified Chinese is `zh-Hans` internally (Azure-canonical) but Google needs `zh-CN`.
- **DB cache** (`Translation` table, keyed by `sha1(source)` + target): a string is billed once then cached forever. `translateBatch` (`:165`) pulls hits, translates only misses, upserts results (cache write best-effort).
- **Write-time warming**: `warmTranslations()` (`:256`) is called from `after()` on listing publish (`listings/route.ts:627`) to pre-translate title/description/location/attribute values into every language **sequentially** (to respect Azure F0's ~33k-chars/min throttle), so the public read path is always a pure cache hit. `EAGER_LANGS` documents the high-volume markets.

`src/app/api/translate/route.ts` is the public client endpoint (used by `src/context/language-context.tsx` for the UI dictionary and on-demand listing translation). Its cost defense is the load-bearing detail:
- Validates `target ∈ LANGS`, bounds raw payload at 1500 strings.
- **Bounds only BILLABLE work**, not total size: `uncachedStats()` (`translate.ts:228`) counts how many strings are *not yet cached*; rejects if `newCount > 250` or `newChars > 30000`. This is intentional so the ~555-string UI dictionary and repeat listing views (all cache hits, $0) pass straight through, while a flood of brand-new strings is rejected.
- **Rate-limits only uncached requests**, `strict` mode (`route.ts:41`) so a Redis outage can't be looped to drain the paid translation budget — while pure cache hits always serve even when Redis is down, so the translated UI never breaks on a limiter outage.

### Security posture & gotchas (summary)

- Every measurement path is **fail-open for the user** (204/no-op) but **fail-closed for cost** (`/api/translate` strict limit on billable work; `/api/track/view` is fail-open because views aren't billable).
- CAPI and feeds **silently no-op / open by default** until env is configured — safe to deploy ahead of creds, but that also means **feeds are publicly scrapeable until `FEED_USER`/`FEED_PASSWORD` are set**, and conversions/ViewContent don't record until `META_PIXEL_ID`+`META_CAPI_TOKEN` are set.
- Ad-network signals (Pixel + the CAPI ViewContent beacon) require explicit `'all'` consent; CAPI **conversions** (Contact/Lead/CompleteRegistration) fire server-side regardless of cookie consent, matched on first-party request data + hashed PII.
- Feed responses are `no-store` + `Vary: Authorization` specifically to prevent a CDN serving an authed feed body to an anonymous request.
- Double-counting is structurally avoided: conversions are server-only, browsing ViewContent shares one `event_id` across Pixel + CAPI, and the contact event is bound to the unique `contactReveal` insert.

Key files: `src/lib/meta-capi.ts`, `src/app/api/track/view/route.ts`, `src/lib/analytics.ts`, `src/components/marketplace/track-view.tsx`, `src/components/marketplace/analytics-tags.tsx`, `src/lib/consent.ts`, `src/lib/attribution.ts`, `src/components/marketplace/attribution-capture.tsx`, `src/app/api/profile/account-type/route.ts`, `src/app/api/listings/[id]/contact/route.ts`, `src/app/api/listings/route.ts`, `scripts/cac-by-channel.ts`, `src/lib/product-feed.ts`, `src/app/api/feeds/google-shopping/route.ts`, `src/app/api/feeds/facebook-catalog/route.ts`, `src/app/listings/[id]/page.tsx`, `src/lib/syndicate.ts`, `src/lib/translate.ts`, `src/app/api/translate/route.ts`.

---

## Ops, Security & Deploy

This section covers everything an operator or integration partner needs to run, secure, and ship eno.vn: the full environment-variable surface, the Cloudflare→Cloud Run edge-ingress pin, Postgres rate limiting, the enforcing Content-Security-Policy and its report collector, CI, the schema-change workflow, deployment, and local development.

Stack reminder: Next.js 16 (App Router, Turbopack) + Prisma 7 (driver adapters, no Rust engine) + Supabase Postgres (Singapore region), fronted by Cloudflare → Cloud Run (region `asia-southeast1`, see `cloudbuild.yaml`). **Postgres RLS is bypassed by design — the Node app code is the only authorization guard** (the one exception is the realtime broadcast path, which *does* use an RLS SELECT policy; see `scripts/messaging-realtime.mjs`).

### Environment variables (grouped by subsystem)

There is no committed secret: `.env` and all `.env*.local` / `.env.production` / `*.pem` / `*.key` are git-ignored (`.gitignore`). `.env.example` is the public template. Prisma 7 no longer auto-loads `.env`, so CLI/scripts load it explicitly (`prisma.config.ts:1` does `import 'dotenv/config'`; ad-hoc scripts expect `set -a; . ./.env; set +a` first).

**Database — Prisma → Supabase Postgres**
- `DATABASE_URL` — pooled Supavisor connection, **transaction mode, port 6543** (`?pgbouncer=true`). The runtime app uses this via the `@prisma/adapter-pg` (node-postgres) driver adapter (`src/lib/db.ts:13`). node-postgres uses unnamed prepared statements, compatible with the transaction pooler.
- `DIRECT_URL` — direct **session mode, port 5432**. Used by the Prisma CLI (`db push`, studio) via `prisma.config.ts:15`, and by every script in `scripts/` and `prisma/seed.ts` (DDL / bulk insert must not run over the txn pooler).

**Supabase API (auth + storage)**
- `NEXT_PUBLIC_SUPABASE_URL` — public project URL (also the image `remotePatterns` host in `next.config.ts:36`).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — public/anon key for browser + SSR clients.
- `SUPABASE_SECRET_KEY` — server-only service-role key; the admin client throws if it (or the URL) is missing (`src/lib/supabase-admin.ts:14`). Never exposed to the client.

**Site + admin**
- `NEXT_PUBLIC_APP_URL` — canonical origin (`https://eno.vn`); used for absolute URLs in syndication, feeds, etc.
- `ADMIN_EMAILS` — comma-separated allowlist gating `/admin` moderation; checked against the verified session email in `src/lib/admin.ts:10,16,26`.

**Edge ingress + cron auth** (see dedicated sections below)
- `EDGE_SECRET` — shared secret for the Cloudflare→origin header pin (`src/middleware.ts:17`). No-op until set.
- `CRON_SECRET` — Bearer token guarding `/api/cron/*`; Cloud Scheduler attaches `Authorization: Bearer $CRON_SECRET`. Verified with `timingSafeEqual` (`src/app/api/cron/daily-reminders/route.ts:19,32`; same in `saved-search-alerts`).

**Rate limiting — Supabase Postgres**
- ~~`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`~~ — **removed 2026-07-20.** The limiter is Postgres and needs no extra credentials. The historical dual-name acceptance (`KV_REST_API_URL` / `KV_REST_API_TOKEN` (the names a KV/Marketplace integration formerly injected) — this dual-name acceptance existed specifically to avoid the "added the store but limiting still off" name-mismatch trap (`src/lib/ratelimit.ts:15-16`).
- `CONTACT_IP_SALT` — salt for SHA-256-hashing reveal IPs before storage (`src/app/api/listings/[id]/contact/route.ts`). **There is no default any more.** It used to fall back to the literal `'eno-contact'`, which is not a secret once it is in a public repo — and the protected input space is IPv4, so a stolen `ContactReveal` table could be reversed to raw IPs by brute force in minutes. Unset, the route now stores `ipHash = NULL` rather than a guessable digest, and logs once per process. Set it (32+ random bytes, `openssl rand -base64 32`) in Secret Manager to restore the abuse signal; rotation is free because no stored hash is ever compared. ⚠️ Rows written before 2026-08-05 were hashed with the old default and should be treated as storing the raw client IP of a signed-in buyer.

**Phone OTP delivery — Supabase Send SMS Hook → eSMS.vn / SpeedSMS.vn**
- `SEND_SMS_HOOK_SECRET` — Standard-Webhooks HMAC secret (form `v1,whsec_<base64>`); the *only* thing authenticating the public `/api/auth/send-sms` route — every request is verified and the OTP is never logged (`src/app/api/auth/send-sms/route.ts:11-17`).
- `ESMS_API_KEY`, `ESMS_SECRET_KEY`, `ESMS_OAID`, `ESMS_ZNS_OTP_TEMPLATE`, `ESMS_SMS_BRANDNAME` (default `ENO`) — Zalo ZNS primary + SMS-brandname fallback.
- `SPEEDSMS_TOKEN` — day-1 stopgap sender before brandname/ZNS approvals clear.

**Translation**
- `GOOGLE_TRANSLATE_API_KEY` — primary (Google Cloud Translation).
- `AZURE_TRANSLATOR_KEY` / `AZURE_TRANSLATOR_REGION` / `AZURE_TRANSLATOR_ENDPOINT` — fallback (Azure F0 free tier).

**AI — Gemini on Vertex (paid; draws GenAI/free-trial credit)**
- `GOOGLE_VERTEX_PROJECT` / `GOOGLE_VERTEX_LOCATION` (default `us-central1`) / `GOOGLE_VERTEX_CREDENTIALS` — service-account JSON, accepted as raw JSON **or** base64 (base64 is paste-safe in the Secret Manager console) (`src/lib/gemini.ts:21-28`).
- `GEMINI_PROJECT` / `GEMINI_LOCATION` / `GEMINI_CREDENTIALS` — optional override so Gemini billing can sit on a *separate* project from Vertex Search (the $1000 credit covers Vertex **Search**, not the Gemini API). Falls back to the `GOOGLE_VERTEX_*` trio (`src/lib/gemini.ts:21-23`). Unconfigured → `getGemini()` returns `null` and AI routes degrade gracefully.
- `NEXT_PUBLIC_AI_ASSIST` — client feature flag for the post-wizard AI assist.

**AI — Vertex AI Search (concierge data store)**
- `VERTEX_SEARCH_DATASTORE_ID` / `VERTEX_SEARCH_ENGINE_ID` (optional) / `VERTEX_SEARCH_LOCATION` (default `global`) — `src/lib/vertex-search.ts:25-27`.

**Maps / geocoding**
- `GOOGLE_MAPS_API_KEY` — server-side reverse-geocode (`src/app/api/reverse-geocode/route.ts:11`).

**Web Push (daily availability reminders)**
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

**Product feeds (Google Merchant + Meta catalog)**
- `FEED_USER` / `FEED_PASSWORD` — Basic-Auth on `/api/feeds/*` (open until both set; `src/app/api/feeds/google-shopping/route.ts:18-20`, helper `feedAuthError` in `src/lib/product-feed.ts`).
- `CATALOG_EXCLUDE_MOCK` — `true` drops mock (picsum/loremflickr) listings from feeds.

**Social syndication (auto cross-post new listings, all env-gated/dormant)**
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`; `FB_PAGE_ID` / `FB_PAGE_TOKEN` (`src/lib/syndicate.ts`).

**Growth / analytics**
- `NEXT_PUBLIC_GA_ID` — GA4 (default `G-CKTZK62B0X` if unset; `src/components/marketplace/analytics-tags.tsx:16`).
- `META_PIXEL_ID` (falls back to `NEXT_PUBLIC_META_PIXEL_ID`), `META_CAPI_TOKEN`, `META_TEST_EVENT_CODE` — server-side Meta Conversions API; both id+token required or every call is a silent no-op (`src/lib/meta-capi.ts:22-30`). The browser Pixel is deliberately disabled for performance; conversions fire server-side via `after()`.

**Build/runtime (mostly platform-set)**
<!-- docs-lint-allow: describes a vestigial branch that still exists at next.config.ts:100 -->
- `VERCEL` — ⚠️ *vestigial, never set in production since 2026-07.* When set, toggles off `output: 'standalone'` (`next.config.ts:100`).
- `NODE_ENV` — gates Prisma query logging (PII; prod logs `error` only, `src/lib/db.ts:20`) and the ratelimit "limiter missing" warning (`src/lib/ratelimit.ts:21`).
- `NEXT_TELEMETRY_DISABLED`, `PORT` (Cloud Run default 8080), `HOSTNAME` — Dockerfile/self-host only.

**Script-only** (not runtime): `MOCK_PER_CATEGORY`, `BACKFILL_BASE_URL`, `BASE_URL`.

### Edge-ingress pin (Cloudflare Transform Rule + `x-eno-edge` + `EDGE_SECRET`)

`src/middleware.ts` (matcher `'/api/:path*'`, `middleware.ts:34`) closes the "attacker hits the Cloud Run origin directly" hole. Without it, anyone who knows the raw `*.run.app` URL can spoof `cf-connecting-ip` and bypass every IP-keyed rate limit (and drain the paid AI/translate/geocode routes), since `clientIp()` trusts `cf-connecting-ip` first (`src/lib/client-ip.ts:11-13`).

Mechanism: when `EDGE_SECRET` is set, every `/api/*` request must carry `x-eno-edge: <EDGE_SECRET>` or it gets a `403 Forbidden` (`middleware.ts:28-29`). That header is injected by a **Cloudflare Transform Rule** on the real domain, so only traffic that actually transited Cloudflare carries it.

Three server-to-server routes are **exempt** because they legitimately hit the origin off-Cloudflare and carry their own auth (`middleware.ts:25`):
- `/api/cron/*` — Cloud Scheduler, authed by `CRON_SECRET`.
- `/api/auth/send-sms` — Supabase Auth hook, authed by Standard-Webhooks HMAC. (Killing it would break phone-OTP signup/login.)
- `/api/feeds/*` — Google Merchant / Meta fetchers, authed by Basic-Auth.

It is a **no-op until `EDGE_SECRET` is configured** (`middleware.ts:18`), so it ships safely ahead of the Cloudflare rule. Full enable sequence (documented at `middleware.ts:11-15`): (1) add the Cloudflare Transform Rule setting `x-eno-edge`, (2) set `EDGE_SECRET` to the same value in Secret Manager (`eno-root-env`) so the Cloud Run revision has it, (3) turn on Cloud Run ingress restrictions so the raw `*.run.app` isn't publicly reachable at all.

### Rate limits — fail-open default vs. strict fail-closed

Sliding-window limiting backed by Supabase Postgres (`src/lib/ratelimit.ts`; Upstash Redis was retired 2026-07-20). In-memory limiting would be a no-op across Cloud Run instances (fresh process per invocation), so Redis is effectively required for real limits.

The keystone behavior is the **open/closed posture** (`ratelimit.ts:38-58`):
- **Default = fail OPEN.** If the limiter errors or its tables are missing, `rateLimit()` returns `success: true` — a missing/flaky Redis must never block legitimate use (messaging, posting). In production a missing config logs a warning (`ratelimit.ts:21-22`) but the app keeps working.
- **`{ strict: true }` = fail CLOSED.** On security/paid routes, if Redis is unavailable the request is **denied** (`success: false`), so a missing env var or Redis outage can never reopen a billing-drain or PII-harvest vector (`ratelimit.ts:45,57`).

Keying uses `clientIp()` which prefers `cf-connecting-ip` (true client behind Cloudflare), then `x-real-ip`, then first `x-forwarded-for` hop (`src/lib/client-ip.ts`) — note this is only trustworthy *because* of the edge pin above.

Strict (fail-closed) call sites — the paid/PII surface:
- Contact reveal: `contact:user` 30/h + `contact:ip` 60/h (`api/listings/[id]/contact/route.ts:34-35`).
- Paid AI via `aiGuard` (login-only, keyed on Profile id, default 10/h; classify 40, rephrase 60): `src/lib/ai-guard.ts:23`. Plus **global daily budget breakers**: `ai-concierge-gemini` 5000/day and `ai-concierge-vertex` 20000/day, keyed `'global'` (`api/ai/concierge/route.ts:90,174`).
- Translate 60/min (`api/translate/route.ts:42`), reverse-geocode 30/min (`api/reverse-geocode/route.ts:102`), anonymous upload 30/h (`api/upload/route.ts:31`).

Fail-open call sites (telemetry / accountable accounts): CSP report 60/min (`api/csp-report/route.ts:19`), authed seller upload 120/h (`api/upload/route.ts:30`).

### Enforcing CSP + `/api/csp-report` collector

Security headers are set on every response in `next.config.ts` `headers()` (`next.config.ts:61-100`), source `/:path*`: HSTS (2y, `includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), payment=()`, `Reporting-Endpoints`, and the CSP.

The **CSP is ENFORCING** (promoted from Report-Only after an audit confirmed every browser-loaded origin is allow-listed; `next.config.ts:54-60,96`). Key directives (`next.config.ts:62-83`): `default-src 'self'`; `object-src 'none'`; `base-uri/form-action/frame-ancestors 'self'`. `script-src`/`style-src` keep `'unsafe-inline' 'unsafe-eval'` (Next has no nonce setup; needed for GTM/Meta/Leaflet bootstrap) and allow-list googletagmanager, connect.facebook.net, unpkg, <!-- docs-lint-allow: genuinely still in the CSP allowlist -->
cloudflareinsights, va.vercel-scripts.com. `img-src`/`connect-src` allow Supabase REST+`wss`, CARTO basemaps, GA, Facebook, plus the mock image hosts. Violations are wired to both `report-to csp-endpoint` (modern Reporting API, paired with the `Reporting-Endpoints` header) and `report-uri /api/csp-report` (older browsers).

Collector `src/app/api/csp-report/route.ts` (nodejs, force-dynamic) parses **both** shapes — legacy `{ "csp-report": {...} }` and Reporting-API `[{ type, body }]` batches — and logs one concise `[csp] <directive> blocked=… doc=…` line per violation (`csp-report/route.ts:25-33`). It is hardened against the known report-flood vector: 16 KB body cap, 60/min fail-open rate limit, never echoes the payload, and **always returns 204** so a prober gets no feedback (`csp-report/route.ts:14-23,38`).

Related server-side defenses worth noting: SSRF guard `src/lib/ssrf.ts` (`assertSafeUrl`/`safeFetch` reject non-https, IP-literal/private/link-local/metadata hosts, and re-validate the host at **every** redirect hop with `redirect:'manual'`); web-push endpoints are restricted to known push-service hosts (`ssrf.ts:68-85`).

### CI (tsc + eslint + vitest)

`.github/workflows/ci.yml` runs on push and PR to `main`. Single `check` job on `ubuntu-latest`, Node 24, npm cache: `npm ci` → `npx prisma generate` → **`npx tsc --noEmit`** → **`npx eslint .`** → **`npx vitest run`** (`ci.yml:34-41`). Prisma reads dummy `DATABASE_URL`/`DIRECT_URL` from job env since `generate` doesn't connect (`ci.yml:15-19`).

- This is a ~1-minute pre-merge gate; the **Cloud Build image build also enforces types** independently (`next.config.ts:47-51`, `ignoreBuildErrors: false`), so a type error fails the deploy even if CI is skipped. `tsc --noEmit` is kept green so this gate never blocks a legit deploy.
- ESLint config (`eslint.config.mjs`) is mostly relaxed (most TS/React/Next rules off) except a **design-system guard**: `no-restricted-syntax` errors on hardcoded brand-hex Tailwind classes (`bg-[#0a66c2]` etc.) to protect the token migration (`eslint.config.mjs:16-26`).
- Vitest only runs pure security/correctness unit tests, `src/**/*.test.ts`, node environment (`vitest.config.ts`). Present tests: `fold`, `phone`, `slug`, `url`, `vnd` (`src/lib/*.test.ts`). No DB / Next runtime needed.

Local equivalents: `npm run lint`, `npm test` / `npm run test:watch`.

### Schema-change flow + `scripts/`

**This project uses `prisma db push`, not migrations** — there is **no `prisma/migrations/` directory**. The generator emits an ESM client to `src/generated/prisma` (git-ignored, regenerated on install/build); runtime connects via the driver adapter, not the schema datasource (`prisma/schema.prisma:8-15`).

<!-- docs-lint-allow: names the command in order to FORBID it -->
The canonical flow WAS `npm run db:setup` (⛔ now refused — it emits 18 DROP TABLEs here; see the Conventions note in docs/README.md), which was `prisma db push && node scripts/messaging-realtime.mjs && node scripts/unique-constraints.mjs` (`package.json`). The two follow-up scripts re-apply **raw/partial DDL that Prisma does not manage and that `db push` wipes**, so they MUST be re-run after every push/reset:
- `scripts/messaging-realtime.mjs` — AFTER-INSERT trigger on `"Message"` that broadcasts full message payloads on the private `convo:<id>` topic via `realtime.send(... private=true)`, gated by an RLS SELECT policy on `realtime.messages` so only the two participants receive it. `SECURITY DEFINER`; clients can never publish. Idempotent.
- `scripts/unique-constraints.mjs` — dedupes + creates partial unique indexes for `TrustEvent` (one-time reasons), `Profile`/`Seller` trust recompute, and `SavedSearch` (prevents the alerts cron from amplifying duplicates). Idempotent.

Other relevant scripts (all run over `DIRECT_URL`): `setup-storage.mjs` (storage buckets), the `backfill-*` family (profiles, search index, translations, trust, brand logos, account-type), `sync-categories.ts` (syncs the 15-category taxonomy without the destructive reseed), `purge-mock.mjs`, and the mock generators. `prisma/seed.ts` (run `npx tsx prisma/seed.ts`, `MOCK_PER_CATEGORY` default 180) is **TEST data** — set `MOCK_PER_CATEGORY=0` and remove the picsum/loremflickr hosts from `next.config.ts:43-44` before launch.

Other `package.json` DB scripts exist but are not the chosen workflow here: `db:push`, `db:generate`, and `db:migrate`/`db:reset` (the latter two assume a migrations dir this repo doesn't use).

### Deploy (git push `main` → Cloud Build → Cloud Run)

Production deploys are triggered by pushing to `main` (the same branch CI gates) — Cloud Build builds the image and deploys the Cloud Run revision. Build/deploy config lives in `cloudbuild.yaml`: region `sin1` (Singapore, co-located with Supabase) and two Cloud Schedulers — `/api/cron/daily-reminders` at `0 2 * * *` and `/api/cron/saved-search-alerts` at `0 5 * * *`, both Bearer-authed by `CRON_SECRET`.

Build command (`package.json`): `prisma generate && next build` <!-- docs-lint-allow: describes the vestigial process.env.VERCEL branch that still exists at next.config.ts:100 -->
(plus a standalone copy step that is skipped when `VERCEL` is set — ⚠️ vestigial). On Vercel, `output: 'standalone'` is disabled because the `VERCEL` env var is set — standalone targets a Node server and makes Vercel bundle Edge middleware with Node globals (`__dirname`), crashing it with `MIDDLEWARE_INVOCATION_FAILED` (`next.config.ts:4-8`).

Secrets caveat (operational reality, per project memory): Secret Manager values (`eno-root-env`) must be uploaded manually — automated writes land empty. After changing env, **redeploy** for it to take effect.

Alternative target: <!-- docs-lint-allow: names the vestigial VERCEL env branch, which is still real code -->
a `Dockerfile` builds the standalone server (when `VERCEL` is unset) into a non-root `node:24-alpine` image on `$PORT` (8080) for Cloud Run Singapore. `NEXT_PUBLIC_*` values are inlined at build time and must be passed as `--build-arg`; `DATABASE_URL`/`DIRECT_URL` stay in the builder stage and never reach the runtime layer (`Dockerfile`).

### Running locally

1. Copy `.env.example` → `.env` and fill at minimum `DATABASE_URL` + `DIRECT_URL` (Supabase → Connect → ORMs → Prisma). Supabase auth/storage keys, and `ADMIN_EMAILS` for `/admin`, are needed for those features.
2. Install: `npm ci` (the `postinstall` hook runs `prisma generate`).
<!-- docs-lint-allow: names the command in order to FORBID it -->
3. Sync schema: ⛔ NOT `npm run db:setup` — it is refused (it emits 18 DROP TABLEs on this database). Use `prisma migrate diff` → read the SQL → apply only additive statements, then `npm run db:ddl` for the realtime triggers + unique indexes. Optionally seed mock data with `npx tsx prisma/seed.ts`.
4. `npm run dev` — Next dev on port 3000 with Turbopack (output tee'd to `dev.log`).

Notes for local dev:
- **Rate limiting fails OPEN** if the limiter is unreachable — fine for dev; required in prod (`ratelimit.ts:8-10`).
- The **edge-ingress pin is a no-op** without `EDGE_SECRET`, so local `/api/*` calls aren't 403'd.
- Prisma query logging is on in dev (`['query','error']`) and off in prod to avoid logging seller-phone PII (`src/lib/db.ts:20`).
- To run the production server locally (standalone build): `npm run build && npm start` (serves `.next/standalone/server.js`).
- `Caddyfile` is a local reverse-proxy helper (port 81 → app on 3000, with an `XTransformPort` passthrough) for emulating the front proxy during development.

Reference paths: `next.config.ts`, `cloudbuild.yaml`, `src/middleware.ts`, `src/lib/ratelimit.ts`, `src/lib/client-ip.ts`, `src/app/api/csp-report/route.ts`, `.github/workflows/ci.yml`, `prisma.config.ts`, `prisma/schema.prisma`, `scripts/`, `Dockerfile`, `Caddyfile`.
