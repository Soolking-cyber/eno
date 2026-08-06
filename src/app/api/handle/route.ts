import { db } from '@/lib/db'
import { claimHandle } from '@/lib/handle'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Claim / change a public @handle for the CALLER's own identity:
//   { handle, target: 'profile' }  → their user handle
//   { handle, target: 'seller' }   → their storefront's handle (must own one)
// Owner-scoped (no target id is ever accepted from the client). Strict limit —
// fail CLOSED: renames churn a public namespace, and a scripted claim/release
// loop could squat names; 6/h is plenty for a human.
//
// ⚠️ WS6 MIGRATION — auth AND the limiter both become options, the ideal shape.
//
// ⚠️ `auth: 'profile'`, NOT `'userId'`, and this one is load-bearing rather than habit. The old code
// called getCurrentProfile(), which LAZILY PROVISIONS the Profile row; claimHandle then creates a
// Handle with `profileId: profile.id`, an FK to that row. `'userId'` verifies the JWT locally and
// never touches the DB, so for a token whose Profile has not been provisioned yet it would hand back
// an id and the create would fail on the FK (P2003 — not the P2002 the catch translates to `taken`),
// turning a first-ever handle claim into a 500 `failed`. Same reasoning as PATCH /api/profile.
//
// ⚠️ THE LIMITER MOVES, INCLUDING `strict: true`. It ran AFTER auth and BEFORE the body parse, which
// is exactly route()'s fixed order, and it was keyed by `profile.id` — the same value the wrapper
// uses for an authed caller. Nothing about it is computed from the body (unlike PATCH /api/profile,
// where the strict flag is), so hoisting it is free of the ordering trap that pins that one down.
//
// ⚠️ NO `body:` SCHEMA, DELIBERATELY. The current parse is tolerant twice over: unparseable/absent
// JSON falls through to `body = {}`, and `String(body.handle || '')` accepts a number, an object or
// null. Both then land on `validateHandle('')` → 400 `{"error":"invalid"}`. A zod schema would answer
// 400 `bad_request` instead — same status, DIFFERENT code, and `invalid` is what the handle editor
// branches on. So the tolerant parse stays in the handler verbatim.
//
// Branches held, all byte-identical: guest → 401 `auth_required` · over limit → 429 `rate_limited` ·
// malformed / empty / non-string handle → 400 `invalid` · reserved name → 400 `reserved` ·
// target:'seller' with no storefront → 400 `no_shop` · PK collision → 409 `taken` · any other
// claimHandle throw → console.error + 500 `failed` · success → 200 `{"handle":"…"}`.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: ANY unhandled throw in this handler used to reach Next's
// default 500 HTML page, and route() now catches it, logs with an `op`, and returns
// `{"error":"internal_error"}` 500 — an improvement, but a wire change on that failure path,
// stated here rather than claimed away.
//
// The first draft of this note scoped the cause to `db.seller.findUnique` and getCurrentProfile.
// That list was too short, and the review caught it: a JSON body of literal `null` PARSES, so the
// tolerant `catch { body = {} }` above never fires, and `String(body.handle || '')` then TypeErrors
// on null with no DB involved at all. Enumerating causes invites exactly that kind of miss — the
// honest statement is about the shape of the change, not an inventory of what can produce it.
//
// ⚠️ `'reserved'` HAD TO BE ADDED TO src/lib/api/errors.ts. It was already on the wire — the catch
// re-emits validateHandle()'s own code — but the harvest regex in that file only matches a LITERAL
// `error: '…'`, and this route returns a variable, so the code was invisible to it. Added, not
// renamed: the handle editor tells reserved names apart from malformed ones by that string.
export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'handle-claim', limit: 6, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    let body: { handle?: string; target?: string } = {}
    try { body = await req.json() } catch {}
    const raw = String(body.handle || '')
    const target = body.target === 'seller' ? 'seller' : 'profile'

    let owner: { profileId: string } | { sellerId: string }
    if (target === 'seller') {
      const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
      if (!seller) throw new ApiError('no_shop', 400)
      owner = { sellerId: seller.id }
    } else {
      owner = { profileId: profile.id }
    }

    try {
      const handle = await claimHandle(owner, raw)
      return { handle }
    } catch (e) {
      const code = (e as Error).message
      if (code === 'taken') throw new ApiError('taken', 409)
      // ⚠️ TWO LITERAL THROWS, NOT `throw new ApiError(code, 400)` — AND THE REDUNDANCY IS THE POINT.
      // `src/lib/api/errors.test.ts` re-harvests the wire on every run by TEXT-SCANNING the routes
      // for `error: '…'` / `ApiError('…'` / `apiFail('…'`, which is the only thing keeping the
      // 197-code union from decaying into fiction. A code passed through a VARIABLE is invisible to
      // that scan: `'reserved'` went into the union and straight back out again as "stale — no route
      // emits it any more", while this line was emitting it on every reserved name. The test's own
      // header predicts this shape and asks the next person not to assume it away, so: spell them out.
      if (code === 'invalid') throw new ApiError('invalid', 400)
      if (code === 'reserved') throw new ApiError('reserved', 400)
      console.error('[handle] claim failed', code)
      throw new ApiError('failed', 500)
    }
  },
)
