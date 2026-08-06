# WS6 — the `route()` migration, and the routes that will never take it

`src/lib/api/handler.ts` replaces the preamble every first-party handler was retyping by hand:
resolve the caller, rate-limit, parse the body, validate it, shape the error. This file records
where that landed, and — more usefully — **which routes are deliberately excluded and why**, so
nobody re-derives the analysis or "finishes the job" by breaking one.

**Status (2026-08-06):** 106 of 200 in-scope method exports are on `route()`. The other 94 each
carry a `// ⚠️ WS6 — NOT MIGRATED:` block in their own file naming the specific bytes that block
them. There is no undocumented remainder — that is checkable:

```bash
# Every file holding an UNMIGRATED method export must carry a refusal block. Prints nothing today.
for f in $(find src/app/api \( -name 'route.ts' -o -name 'route.svc.ts' \) | grep -v '/api/v1/'); do
  grep -qE '^export (async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b' "$f" || continue
  grep -q 'WS6 — NOT MIGRATED' "$f" || echo "UNDOCUMENTED: $f"
done
```

⚠️ **Two things that check deliberately does *not* do**, because a reviewer caught an earlier draft
claiming more than it delivered. It keys on the presence of an *unmigrated export* rather than the
absence of a migrated one, so a file cannot pass just by importing the handler somewhere; and it
matches the exact marker `WS6 — NOT MIGRATED`, not the bare token `WS6`, which a *migration* note
also contains. It is still file-granular: a file with both migrated and unmigrated exports would
pass on one refusal block. No such mixed file exists today — verify with:

```bash
for f in $(find src/app/api \( -name 'route.ts' -o -name 'route.svc.ts' \) | grep -v '/api/v1/'); do
  m=$(grep -cE '^export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = route\(' "$f")
  u=$(grep -cE '^export (async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b' "$f")
  [ "$m" -gt 0 ] && [ "$u" -gt 0 ] && echo "MIXED: $f"
done
```

`/api/v1/**` (18 exports) is out of scope by design: it has its own `resolveApiKey` +
`apiOk`/`apiError` and a richer `{ error: { code, message } }` envelope. Never point `route()` at it.

## The contract that made a 200-route migration safe to start

`route()` emits exactly `{ error: '<code>' }` with the same status codes the hand-written blocks
already used. Clients branch on those strings, so **the wire must not change** — that is what let
this proceed one route at a time with no client coordination.

One exception is accepted and must always be declared in the route's header: a handler with no
try/catch used to let a rejection reach Next's default 500 HTML, and `route()` now catches it, logs
with an `op`, and returns `{"error":"internal_error"}` 500.

⚠️ **State that as a shape, never as an inventory of causes.** A header that listed "a rejection
from `db.conversation.findUnique` / `db.message.findMany`" was incomplete: a JSON body of literal
`null` *parses*, so a tolerant `catch { body = {} }` never fires and the next property access
TypeErrors with no DB involved at all.

## The five auth modes

| mode | resolves | guest gets |
|---|---|---|
| `public` | nothing | — |
| `userId` | `getCurrentProfileId()` — JWT verified locally from cached JWKS, no network, no DB | 401 `auth_required` |
| `profile` | `getCurrentProfile()` — verifies with the auth server, reads *and lazily provisions* the Profile row | 401 `auth_required` |
| `admin` | `getAdmin()` — Supabase auth only, no Prisma | 403 `Forbidden` (capital F) |
| `cron` | `Authorization: Bearer $CRON_SECRET`, timing-safe | 401 `forbidden` (lowercase) |

Choosing between `userId` and `profile` is a real decision, not a style question:

- **`profile` where `userId` would do** puts an auth-server round-trip and a Profile read on a hot
  path. That is the wrapper making the codebase worse.
- **`userId` where the old code called `getCurrentProfile()`** drops the *lazy row provisioning*.
  If the handler writes a row with an FK to `Profile`, a first-ever caller now gets a P2003/P2025.

⚠️ **`admin` deliberately resolves no Profile.** It used to. Across all 11 admin routes not one
handler reads `profile` or `userId` — they read `admin` (the email) or nothing — so the call was
pure cost, and it cost three real things: `/api/admin/ai-health` and `/api/admin/brands/ai` touch
no database *by design* (they are what you curl during an outage) and started 500ing when Postgres
was down; the presence heartbeat turned read-only admin GETs into deferred DB writes; and on an
admin's first-ever call `ensureProfile()` runs the **irreversible** guest-Seller auto-claim.

⚠️ **The wrapper is not cookies-only.** `getCurrentProfile()` and `getCurrentProfileId()` both pass
`bearerToken()` to Supabase (`src/lib/admin.ts:78`, `:150`, helper at `:138`), so `auth: 'profile'`
answers an `Authorization: Bearer <supabase jwt>` caller exactly as a cookie caller. Seven skip
comments asserted the opposite before a review read `admin.ts`. If you are about to skip a route
because "the wrapper can't read a bearer token", you are wrong.

## Why a route gets refused — the taxonomy

Every one of the 94 refusals is an instance of one of these. All are **wire facts**.

1. **The guest response is not 401.** `403 business_only` (`/api/keys`, `/api/webhooks`),
   `200 {"unread":0}` (`/api/conversations/unread`), `200 {"user":null}` (`/api/forum/me`),
   a bodyless `new NextResponse(null, {status:401})` (`/api/conversations/[id]/typing`), a 204, a
   redirect (`/api/auth/forum-handoff`).
2. **A guard must run before the caller is resolved.** `route()`'s order is fixed —
   auth → rateLimit → body → handler. So: `aiGuard`'s `503 ai_unavailable`
   (`/api/ai/{classify,rephrase,visual-search}`), the `isAllowedForumOrigin` 403, the
   `visaCryptoReady()` 503, a webhook signature check.
3. **The limiter cannot be hoisted.** Its key or its `strict` flag is computed from the parsed body
   (`PATCH /api/profile`, `/api/listings/[id]/save`, whose key is `${ip}:${id}:${saved}`); two
   limiters must both pass; a lifetime counter rather than a window (`spendRefinement`); or it must
   run *after* a role check — hoisting it above the business-tier gate on `/api/listings/bulk`
   would turn a caller's permanent 403 into a 429.
4. **The throttled answer is not `{"error":"rate_limited"}` 429.** It is a domain payload
   (`{"listings":[],"personalized":false}`, `{"channel":null}`, `{"ok":true,"counted":false}` at
   **200**), or a different code (`too_many`).
5. **The response carries headers.** `forumJson`'s five CORS headers on every branch, a
   `Content-Disposition` download, `Cache-Control: no-store`, `WWW-Authenticate`, `Retry-After`.
   A handler *can* return a `Response` to keep them — but then `auth`/`body` stay in the handler
   too, all four options are empty, and the wrapper buys nothing.
6. **The error envelope differs.** Extra fields beside `error` (`{"error":"too_many_keys","max":10}`,
   `{"error":"invalid_post","issues":[…]}`), `{"ok":false,"reason":…}`, prose messages, JSON-RPC,
   XML/CSV feeds.
7. **Authorization is a helper that resolves the caller itself and answers more than 401.**
   `checkListingOwner()` answers four outcomes (401 · 403 `no_storefront` · 404 · 403 `forbidden`);
   `auth: 'profile'` reproduces only the 401 *and* resolves the caller a second time.
8. **Churn** — all four options would be empty. A public GET with no limiter and no body gains
   nothing from a wrapper. This is a legitimate reason and about a third of the refusals are it.

## Traps worth carrying forward

- **`.svc.ts` is a whole second surface.** The original survey globbed `route.ts` and therefore
  missed **38 files / 45 method exports** of services-edition routes (visa, itineraries, trips,
  payments). That is also how a sixth byte-identical copy of the cron guard survived five rounds of
  "we deduplicated it". Any inventory of this API must glob `route.ts` **and** `route.svc.ts`.
- **`src/lib/api/errors.test.ts` re-harvests the wire by TEXT SCAN** and only sees three literal
  forms: `error: '…'`, `ApiError('…'`, `apiFail('…'`. A code passed through a **variable** is
  invisible to it — `throw new ApiError(code, 400)` made `'reserved'` land in the union and
  immediately report as stale while the route was emitting it on every request. Spell codes out as
  literals, even when it looks redundant.

  ⚠️ **That blind spot had already cost nine codes.** Every `PublishBlockCode` is re-emitted
  wholesale as `e.code` when `POST /api/listings` catches a `PublishBlockedError`, and nine of the
  twelve were absent from the union — so `apiErrorCode()` answered `null` for the most common
  refusal a seller ever sees. All twelve are now members, the test **derives** them from source
  rather than exempting them, and `PublishBlockCode extends ApiErrorCode` is asserted at **compile
  time** in `errors.ts`.

  ⚠️ **`visa_schema_not_ready` is deliberately still absent**, and the reasoning is a licensing one.
  It is emitted only by `.svc.ts` routes, and `ALL` is a **runtime** array in a module both editions
  share — adding it would put a visa-named string in eno.vn's bundle the day `lib/api/client.ts`
  gains its first production importer. Two such codes (`visa_database_unavailable`,
  `visa_encryption_not_configured`) are already members and predate this work; splitting the
  vocabulary by edition is the fix, and it is a deliberate change rather than a drive-by.

  ⚠️ **Five codes are STILL knowingly outside the union, and that is the honest count.** Four come
  through `updateListingCore`'s `r.error` on `PATCH /api/listings/[id]` — `title_too_short`,
  `no_phone_in_listing`, `invalid_price`, `urgent_quota` — which is the same variable-shaped
  emission, just a different helper; plus `visa_schema_not_ready` above. `apiErrorCode()` returns
  `null` for all five today. They are the next increment, each needing its own on-wire derivation,
  and PATCH cannot take a `body:` schema until the four are resolved.

  ⚠️ **The derivation took four attempts and the first three were provably vacuous.** This is the
  more transferable lesson, so the whole sequence is recorded in the test: `.includes()` matched the
  identifier in the file's own *prose* and accepted a renamed symbol; two independent regexes proved
  only that both strings existed *somewhere*; joining them with a 400-character window was still
  proximity, not coupling. What works is capturing the identifier the `instanceof` binds and
  requiring `error: <that same identifier>.code`. **Mutate the source and watch the check go red
  before believing it** — twice here a "fix" silently re-opened an earlier hole, and only the
  mutation battery noticed.
- **Blockers must be stated as wire facts, not as client behaviour.** Reviews caught **six**
  refusals justified by a claim about what some component does, where the component did no such
  thing: `bulk-upload-panel.tsx` was cited for `/api/keys` but calls `/api/listings/bulk`;
  `/api/forum/me` was called "the session probe the shell calls on every load" and has zero callers
  repo-wide; `direct: true` was read as "cross-origin to eno.vn" when it resolves against the
  forum's *own* origin. Each skip was still correct — on bytes. A wire fact outlives a client
  refactor; a client fact does not.
- **A migration diff must include `handler.ts` as context even though it is unchanged.** Five
  consecutive reviews filed the same false positive — that `auth: 'userId'` yields something other
  than a `Profile.id` — because they reasoned from the option *name*. It calls
  `getCurrentProfileId()`, the same function the old handlers called, and `prisma/schema.prisma`
  documents `Profile.id` as `= auth.users.id`.

## What is NOT proven by a test — stated plainly

The only executable coverage this migration added is `src/lib/api/handler.cron.test.ts`
(`auth: 'cron'`, both directions, all six routes). Everything else rests on branch-by-branch
reading plus an adversarial review pass, and on whatever route tests already existed
(`messages/translate` 25, visa `resume`/`select-product` 16, itineraries 102).

Migrated on reasoning alone, with no test: `/api/admin/moderate` (fourteen irreversible actions),
`/api/visa/applications/[id]/submit` and `DELETE` with their CAS guards, and `/api/handle`'s
FK-sensitive `'profile'`-vs-`'userId'` choice. The `'reserved'` incident recorded above is proof
that reasoning without a test already missed a live wire code once in this very work. Treat the
absence as a known gap, not as confidence.

## Two live oddities preserved on purpose

- `forbidden` (lowercase, 401, cron) and `Forbidden` (capital, 403, admin) are **different
  responses**, both on the wire. Same for `forbidden`/`Forbidden` across 21 and 16 sites generally.
- `PATCH`/`DELETE` on `/api/forum/posts/[id]` call `forumJson` with no methods argument, so they
  send the default `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS` while the
  preflight and `GET` send `GET, PATCH, DELETE, OPTIONS`. That inconsistency is live. Do not let a
  future migration normalise it as a drive-by.
