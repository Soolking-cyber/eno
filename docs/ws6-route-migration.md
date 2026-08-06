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

  ⚠️ **The runtime vocabulary is edition-split, and the rule is MECHANICAL** (WS8). `ALL` is the
  marketplace half; `errors-services.ts` holds the 35 codes that only `.svc` source mentions, and
  `next.config.ts` aliases it to an empty stub on a marketplace build. The type union stays whole —
  types are erased, so it costs the bundle nothing and keeps one vocabulary for the compile-time
  subset assertions. Only the runtime array splits, because only the runtime array ships.

  The test enforces the rule rather than a guess: *a code whose literal appears only in `.svc`
  source is services-only*. An earlier version matched code NAMES against `/visa|itinerar|paypal/`
  and caught 8 of 35. ⚠️ **`/api/v1` counts as marketplace** — excluding it (reasonable, since it
  has its own error envelope) reported `invalid_request` as services-only when
  `api/v1/oauth/token/route.ts` emits it on eno.vn. *Exclusion by envelope is not exclusion by
  edition.*

  ⚠️ **THE SAME SHAPE APPEARS AT 40 ROUTE SITES — `{ error: <helper>.error }` — and measuring it
  was worth more than fixing the first instance.** A helper whose return type is a bare `string`
  puts codes on the wire that neither the compiler nor the harvest can name. Narrowing four of them
  (`ListingUpdateErrorCode`, `SellerUpdateErrorCode`, `ListingStatusErrorCode`,
  `VisaTransitionErrorCode`) surfaced **eleven** missing codes and one genuine contract drift:
  `admin_required` is returned by a server-action *wrapper* that the transition function itself
  never produces — invisible while the type was `string`.

  ⚠️ **Ten more came from a layer BELOW the routes, and one of them indicts the original harvest.**
  This file's own header cites `messages/[id]/page.tsx  data?.error === 'human_help_pending'` as
  its example of a client branching on a code — and `human_help_pending` was not a member of the
  union that header introduces, because `src/lib/visa/concierge.ts` emits it through an internal
  `fail(code)`, one library layer below anything a route scan sees. Nine more hid the same way in
  `visa/dm-flow.ts` and `trips/assistance.ts`. **The wire is not only what routes write; it is what
  everything routes delegate to writes.**

  As of WS8 there is **no bare `error: string` left on any wire path** in `src/lib`, and the total
  vocabulary went 213 → 232 (197 marketplace + 35 services).

  Each named union is now asserted a subset of `ApiErrorCode` at compile time, and
  `errors.test.ts` derives its members from source via a small table rather than allowlisting them.
  Five are named: `ListingUpdateErrorCode`, `SellerUpdateErrorCode`, `ListingStatusErrorCode`,
  `OwnerCheckErrorCode` and `VisaTransitionErrorCode`.

  ⚠️ `VisaTransitionErrorCode` is deliberately NOT coupled: its only consumer is a **server action**,
  so its codes are an RPC result, not an HTTP response body. Forcing them into the API vocabulary
  would have made this type describe something it does not describe.

  ⚠️ `OwnerCheckErrorCode` is the one that guards a **privilege** boundary rather than a validation
  message — six routes answer `{ error: r.error }` straight from `checkListingOwner`, which decides
  whether a caller may mutate a listing they do not own. Its four codes must stay distinct:
  `no_storefront` (signed in, no shop) and `forbidden` (signed in, wrong shop) are different
  sentences to the user.

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

## What IS and is NOT proven by a test

The three riskiest migrations now have real coverage — **201 tests** written across two rounds and
mutation-verified both times: `/api/admin/moderate` (79), `/api/visa/applications/[id]` submit +
DELETE (73), `/api/handle` (49). Plus `handler.cron.test.ts` (11, both directions, all six routes).

⚠️ **The mutation batteries are the load-bearing part, not the test count.** Round one produced
three green suites; independent verifiers then mutated the routes and found **~30 mutations that
should have gone red and did not**. Several were destructive shapes the tests were written to
catch: deleting `.eq('id', id)` from a visa update (an unfiltered whole-table write), dropping
`.eq('application_id', id)` from the documents read that feeds `removeVisaFiles()` (a bucket-wide
file wipe), flipping `verified: false → true` on bulk-confirm (publishing every reported listing
instead of pulling it), and accepting a client-supplied `profileId` so a caller could claim a handle
onto someone else's account. Round two closed them and re-verified each. **A test suite that has
never been mutated is an untested test suite** — write the mutation down, watch it go red, restore.

Still uncovered, honestly: `[id]/route.svc.ts`'s `GET` and `PATCH` have no executable coverage
anywhere, and `PATCH`'s CAS nulls all six consent stamps — the same class of write this exercise was
about. Several narrower gaps remain in `admin/moderate` (bulk-dismiss notifies nobody in any test;
the abusive-report purge's `syncEnforcement` tail is unasserted) and one mock-shape gap in the visa
fake (it ignores `.single()` vs `.maybeSingle()`, so a routine CAS miss answering 500 instead of 409
would not be caught). None is a known defect; all are unpinned behaviour.

## Two live oddities preserved on purpose

- `forbidden` (lowercase, 401, cron) and `Forbidden` (capital, 403, admin) are **different
  responses**, both on the wire. Same for `forbidden`/`Forbidden` across 21 and 16 sites generally.
- `PATCH`/`DELETE` on `/api/forum/posts/[id]` call `forumJson` with no methods argument, so they
  send the default `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS` while the
  preflight and `GET` send `GET, PATCH, DELETE, OPTIONS`. That inconsistency is live. Do not let a
  future migration normalise it as a drive-by.
