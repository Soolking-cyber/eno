import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * WS6 MIGRATION GUARD FOR `POST /api/handle`.
 *
 * ⚠️ THIS ROUTE WAS MIGRATED ON READING ALONE. `docs/ws6-route-migration.md` names it explicitly as
 * one of three migrations with no executable coverage, and records that reasoning-without-a-test has
 * ALREADY missed a live wire code in this very workstream (`'reserved'` was emitted through a
 * variable, so the error-contract harvest could not see it and reported it stale while the route
 * returned it on every reserved name). This file closes that gap for this route.
 *
 * ⚠️ THE CONTRACT IS "ZERO BYTES CHANGE ON THE WIRE", so every branch asserts the status code AND
 * the exact response body text — not "it did not throw". The handle editor branches on these
 * strings with no compiler involved.
 *
 * ⚠️ THE SINGLE MOST VALUABLE ASSERTION HERE IS THE AUTH MODE, and it is FK-sensitive rather than
 * stylistic. `auth: 'profile'` calls `getCurrentProfile()`, which LAZILY PROVISIONS the Profile row;
 * `auth: 'userId'` verifies the JWT locally and never touches the database. `claimHandle()` then
 * writes a Handle row whose `profileId` is an FK to Profile — so on a first-ever claim the cheaper
 * mode would P2003 and turn a 200 into a 500 `failed`. The mocked database below MODELS THAT FK
 * (see `create`), and `getCurrentProfileId()` deliberately does NOT provision, so the
 * "first-ever claim" test goes red the moment anyone 'optimises' this route to `'userId'`.
 *
 * ⚠️ DATA SAFETY — MOCKED BY NAME, NOT TRANSITIVELY. `@/lib/db` is the only thing in this route's
 * import graph that can reach Postgres (`@/lib/handle`, `@/lib/ratelimit` and `@/lib/admin` all
 * funnel through it or through Supabase), and it is stubbed here with an in-memory store. A
 * reviewer already caught a test in this repo whose safety was transitive; nothing below relies on
 * one module happening to build its client via another.
 *
 * ⚠️ `@/lib/ratelimit` AND `@/lib/handle` ARE DELIBERATELY *NOT* MOCKED. Both are real, running
 * against the stubbed `db` — so the 429 comes from the actual `strict: true` fail-closed branch in
 * `src/lib/ratelimit.ts` and the `invalid`/`reserved`/`taken` codes come from the actual
 * `validateHandle()` + P2002 translation, rather than from a re-implementation of them in this file.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  /** Who the JWT says the caller is. `null` = guest. */
  jwtUserId: null as string | null,
  /**
   * The Profile rows that EXIST in the database — the FK target. `getCurrentProfile()` adds to this
   * (lazy provisioning); `getCurrentProfileId()` must not.
   */
  profileRows: new Set<string>(),
  profileCalls: 0,
  profileIdCalls: 0,
  /** ownerId → sellerId, i.e. who owns a storefront. */
  sellerByOwner: new Map<string, string>(),
  /**
   * ⚠️ THE QUERY THE ROUTE BUILT, not the row the mock chose to hand back. Every storefront lookup's
   * `where` is recorded here, because an outcome assertion alone cannot tell "the route asked for the
   * caller's shop" apart from "the mock only had one shop to give".
   */
  sellerWhere: [] as unknown[],
  /** ⚠️ Likewise the PAYLOAD: the exact `data` of every `handle.create`, so the owner key the route
   *  composed is pinned by shape rather than inferred from the stored row. */
  createData: [] as unknown[],
  handles: [] as Array<{ handle: string; profileId: string | null; sellerId: string | null }>,
  /** Args of every `rl_check` call: [bucket, key, limit, windowSeconds]. */
  rlCalls: [] as unknown[][],
  rlAllow: true,
  rlDown: false,
  /** Anything other than a P2002/P2003 that `handle.create` should reject with. */
  createThrows: null as Error | null,
  errors: [] as unknown[][],
  prismaErr: (code: string, message: string) => Object.assign(new Error(message), { code }),
}))

vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => {
    h.profileCalls++
    if (!h.jwtUserId) return null
    // ⚠️ THE LAZY PROVISIONING THAT THE MODE CHOICE IS ABOUT. The real getCurrentProfile() runs
    // ensureProfile(), so the row is guaranteed to exist by the time a handler sees it.
    h.profileRows.add(h.jwtUserId)
    return { id: h.jwtUserId, email: 'x@y.z' }
  },
  getCurrentProfileId: async () => {
    h.profileIdCalls++
    // No provisioning, by design: a local JWT verification, no network and no DB.
    return h.jwtUserId
  },
}))

vi.mock('@/lib/db', () => {
  const handle = {
    findUnique: async ({ where }: Row) => {
      const row = h.handles.find((r) =>
        'profileId' in where ? r.profileId === where.profileId
          : 'sellerId' in where ? r.sellerId === where.sellerId
            : r.handle === where.handle)
      return row ?? null
    },
    delete: async ({ where }: Row) => {
      const i = h.handles.findIndex((r) => r.handle === where.handle)
      if (i < 0) throw h.prismaErr('P2025', 'An operation failed because it depends on one or more records that were required but not found.')
      return h.handles.splice(i, 1)[0]
    },
    create: async ({ data }: Row) => {
      h.createData.push(data)
      if (h.createThrows) throw h.createThrows
      // The PK is the handle itself (model Handle: `handle` is the id), so a collision is P2002.
      if (h.handles.some((r) => r.handle === data.handle)) {
        throw h.prismaErr('P2002', 'Unique constraint failed on the fields: (`handle`)')
      }
      // ⚠️ THE FK THAT PINS THE AUTH MODE. Handle.profileId references Profile(id); writing it for a
      // Profile row that was never provisioned is a P2003, NOT the P2002 the catch maps to `taken`.
      if (data.profileId && !h.profileRows.has(data.profileId)) {
        throw h.prismaErr('P2003', 'Foreign key constraint violated on the constraint: `Handle_profileId_fkey`')
      }
      if (data.sellerId && ![...h.sellerByOwner.values()].includes(data.sellerId)) {
        throw h.prismaErr('P2003', 'Foreign key constraint violated on the constraint: `Handle_sellerId_fkey`')
      }
      const row = { handle: data.handle, profileId: data.profileId ?? null, sellerId: data.sellerId ?? null }
      h.handles.push(row)
      return row
    },
  }
  return {
    db: {
      // The real `@/lib/ratelimit` runs on top of this: `select ... from rl_check($1,$2,$3,$4)`.
      $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        h.rlCalls.push(values)
        if (h.rlDown) throw new Error('rl_check unavailable')
        return [{ success: h.rlAllow, remaining: 0 }]
      },
      $transaction: async (fn: (tx: { handle: typeof handle }) => Promise<unknown>) => fn({ handle }),
      seller: {
        findUnique: async ({ where }: Row) => {
          h.sellerWhere.push(where)
          const id = h.sellerByOwner.get(where.ownerId)
          return id ? { id } : null
        },
      },
      handle,
    },
  }
})

import * as routeModule from './route'
import { POST } from './route'
import { route } from '@/lib/api/handler'

const post = (body?: unknown, opts?: { raw?: string; headers?: Record<string, string> }) =>
  new Request('http://x/api/handle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...opts?.headers },
    ...(opts?.raw !== undefined ? { body: opts.raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

/** Status + the exact bytes. Anything less would not be testing the migration's contract. */
const wire = async (res: Response) => ({ status: res.status, body: await res.text() })

beforeEach(() => {
  h.jwtUserId = 'user-1'
  h.profileRows = new Set(['user-1'])
  h.profileCalls = 0
  h.profileIdCalls = 0
  h.sellerByOwner = new Map()
  h.sellerWhere = []
  h.createData = []
  h.handles = []
  h.rlCalls = []
  h.rlAllow = true
  h.rlDown = false
  h.createThrows = null
  h.errors = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { h.errors.push(a) })
})

describe('POST /api/handle — the route segment config', () => {
  /**
   * ⚠️ NOT DECORATION, AND NOT SOMETHING ANY REQUEST-LEVEL TEST CAN SEE. These two exports are read
   * by the Next builder, never by the handler, so every other assertion in this file stays green if
   * they are deleted. `runtime: 'nodejs'` keeps the route off the edge runtime, where the Prisma
   * client this route reaches through `claimHandle` does not run at all; `dynamic: 'force-dynamic'`
   * keeps a POST that writes to a public namespace out of any static/prerender treatment. Asserted
   * as one object with `toEqual` so that dropping EITHER export — undefined, not merely different —
   * is red.
   */
  it('exports runtime nodejs + dynamic force-dynamic', () => {
    expect({ runtime: routeModule.runtime, dynamic: routeModule.dynamic }).toEqual({
      runtime: 'nodejs', dynamic: 'force-dynamic',
    })
  })

  /**
   * ⚠️ WHICH METHODS EXIST, NOT JUST WHAT THE ONE METHOD DOES. Next routes every exported HTTP verb,
   * so `export const GET = POST` is a one-line change that makes this handler — a strict-limited,
   * namespace-MUTATING write — reachable by ordinary navigation and by link prefetch, which
   * browsers issue without user intent. Nothing else in this file would notice: every assertion
   * calls POST directly. Raised by a mutation review; the mutant passed 48/48.
   */
  it('exports POST and nothing else — a GET here would be prefetchable', () => {
    expect(Object.keys(routeModule).sort()).toEqual(['POST', 'dynamic', 'runtime'])
  })
})

describe('POST /api/handle — the caller (auth: profile, and it is load-bearing)', () => {
  it('guest → 401 {"error":"auth_required"}, before the limiter and before any write', async () => {
    h.jwtUserId = null
    expect(await wire(await POST(post({ handle: 'alex' })))).toEqual({
      status: 401, body: '{"error":"auth_required"}',
    })
    // route()'s order is fixed auth → rateLimit → handler; a guest must not spend a limiter token
    // or reach the namespace at all.
    expect(h.rlCalls).toEqual([])
    expect(h.handles).toEqual([])
  })

  /**
   * ⚠️ THE MODE PIN. THIS IS THE TEST THIS FILE EXISTS FOR.
   *
   * A caller whose Profile row has NEVER been provisioned claims a handle. With `auth: 'profile'`
   * the wrapper's `getCurrentProfile()` provisions the row first, so the FK holds and the claim
   * succeeds. Swap the route to the cheaper `auth: 'userId'` — which resolves the same id from the
   * JWT with no DB round-trip — and `handle.create` violates `Handle_profileId_fkey` with a P2003;
   * `claimHandle` only translates P2002, so the route's catch falls through to
   * `console.error` + 500 `{"error":"failed"}`. Verified by mutation: this goes red.
   */
  it('a FIRST-EVER claim succeeds because the mode provisions the Profile row (P2003 otherwise)', async () => {
    h.jwtUserId = 'brand-new'
    h.profileRows = new Set() // no Profile row exists yet — the FK target is missing
    expect(await wire(await POST(post({ handle: 'alex' })))).toEqual({
      status: 200, body: '{"handle":"alex"}',
    })
    expect(h.profileRows.has('brand-new')).toBe(true) // the row was provisioned on the way in
    expect(h.handles).toEqual([{ handle: 'alex', profileId: 'brand-new', sellerId: null }])
  })

  it('resolves the caller ONLY through getCurrentProfile — never the DB-free id path', async () => {
    await POST(post({ handle: 'alex' }))
    expect(h.profileCalls).toBe(1)
    expect(h.profileIdCalls).toBe(0)
  })
})

describe('POST /api/handle — the limiter (handle-claim, 6/h, strict)', () => {
  it('over limit → 429 {"error":"rate_limited"} and nothing is claimed', async () => {
    h.rlAllow = false
    expect(await wire(await POST(post({ handle: 'alex' })))).toEqual({
      status: 429, body: '{"error":"rate_limited"}',
    })
    expect(h.handles).toEqual([])
  })

  it('is keyed by the CALLER, not the client IP, on bucket handle-claim at 6 per hour', async () => {
    // A cf-connecting-ip is present precisely so a fallback to `clientIp()` would be visible: an
    // IP-keyed limit would let one person burn the whole office NAT's budget, and would let one
    // person evade their own limit by changing address.
    await POST(post({ handle: 'alex' }, { headers: { 'cf-connecting-ip': '203.0.113.9' } }))
    // ⚠️ arrayContaining, NOT toEqual, AND THE `not.toContain` BELOW IS THE REAL ASSERTION.
    // `h.rlCalls` records the raw bind-parameter array of the `$queryRaw` statement, so an exact
    // match couples this test to the SQL's TEXT, not to its meaning: adding `reset_sec` to the
    // select list prepended two window binds and reddened this test while the limiter behaved
    // identically. What the test is actually for is the sentence in the comment above — the bucket,
    // the caller-derived key, the limit and the window are what reach the limiter, and the client
    // IP does not.
    expect(h.rlCalls).toHaveLength(1)
    expect(h.rlCalls[0]).toEqual(expect.arrayContaining(['handle-claim', 'user-1', 6, 3600]))
    expect(h.rlCalls[0]).not.toContain('203.0.113.9')
  })

  it('runs BEFORE the handler: an over-limit caller gets 429, not the handler\'s 400', async () => {
    h.rlAllow = false
    // target:'seller' with no storefront is a 400 no_shop when the handler is reached at all.
    expect(await wire(await POST(post({ handle: 'alex', target: 'seller' })))).toEqual({
      status: 429, body: '{"error":"rate_limited"}',
    })
  })

  it('a limiter OUTAGE REFUSES (strict: true fails CLOSED) — an outage never un-limits a claim', async () => {
    h.rlDown = true
    expect(await wire(await POST(post({ handle: 'alex' })))).toEqual({
      status: 429, body: '{"error":"rate_limited"}',
    })
    expect(h.handles).toEqual([])
  })

  it('CONTROL: the same outage on a NON-strict limiter is allowed — so the 429 above is the flag', async () => {
    // Without this, the test above would pass for the wrong reason ("everything throws ⇒ 429").
    // `src/lib/ratelimit.ts` returns `{ success: !opts?.strict }` on a backend error, so a route
    // that dropped `strict: true` would sail through the identical outage.
    h.rlDown = true
    const lenient = route(
      { auth: 'profile', rateLimit: { bucket: 'handle-claim', limit: 6, window: '1 h' } },
      async () => ({ reached: true }),
    )
    expect(await wire(await lenient(post({ handle: 'alex' })))).toEqual({
      status: 200, body: '{"reached":true}',
    })
  })
})

describe('POST /api/handle — the tolerant body parse (no zod schema, on purpose)', () => {
  // ⚠️ A `body:` schema would answer 400 `bad_request` here. Same status, DIFFERENT code, and
  // `invalid` is what the handle editor branches on — so the hand-rolled parse stays.
  it.each([
    ['no body at all', undefined],
    ['{} — no handle key', {}],
    ['an empty handle', { handle: '' }],
    ['a number', { handle: 42 }],
    ['an object', { handle: { a: 1 } }],
    ['explicit null', { handle: null }],
    ['too short', { handle: 'ab' }],
    ['not letter-first', { handle: '1abc' }],
    ['too long', { handle: 'a'.repeat(31) }],
    // ⚠️ WAS `alex-doe`, WHICH IS NOW LEGAL. The grammar gained `-` on 2026-08-30 so a handle can
    // also be a hostname (`<handle>.eno.vn`) — see HANDLE_RE. A dot is still illegal and is the
    // better probe anyway: it is the character that would let a handle claim a second label.
    ['illegal characters', { handle: 'alex.doe' }],
    ['whitespace only', { handle: '   ' }],
    // ⚠️ `false` IS THE SOLE DISCRIMINATOR BETWEEN `||` AND `??` HERE, which is why it is spelled
    // out rather than left to the other falsy cases. `String(body.handle || '')` is the live code;
    // under `String(body.handle ?? '')` the absent key, `''`, `0` and `null` all still land on 400
    // `invalid` (`String(undefined ?? '')` is `''`, `String(null ?? '')` is `''`, `String(0)` is
    // `'0'` which fails letter-first) — but `String(false)` is `'false'`, five letters, letter-first
    // and not reserved, so `??` would CLAIM THE HANDLE "false" and answer 200. This row is the only
    // thing standing between the two operators.
    ['a boolean false — the one value where `||` and `??` diverge', { handle: false }],
  ])('%s → 400 {"error":"invalid"}', async (_label, body) => {
    expect(await wire(await POST(post(body)))).toEqual({ status: 400, body: '{"error":"invalid"}' })
    expect(h.handles).toEqual([])
  })

  /**
   * ⚠️ MEASURED, NOT ASSUMED — AND MY READING OF IT WAS WRONG FIRST. This file originally asserted
   * that a non-string handle always lands on 400 `invalid`. It does not: `String(['alex'])` is
   * `'alex'` and `String(true)` is `'true'`, both of which pass HANDLE_RE, so a JSON array or
   * boolean CLAIMS A HANDLE today. That is the live wire and it is harmless (the claim is still
   * owner-scoped, still validated, still limited) — but it is exactly what a `body:` zod schema
   * would change, so it is pinned here rather than left as a surprise for whoever adds one.
   */
  it.each([
    [['alex'], 'alex'],
    [true, 'true'],
  ])('a non-string %p coerces and CLAIMS "%s" — the tolerant parse, warts and all', async (handle, claimed) => {
    expect(await wire(await POST(post({ handle })))).toEqual({
      status: 200, body: `{"handle":"${claimed}"}`,
    })
  })

  it('MALFORMED json → 400 {"error":"invalid"} — the tolerant catch, not a 400 bad_request', async () => {
    expect(await wire(await POST(post(undefined, { raw: '{not json' })))).toEqual({
      status: 400, body: '{"error":"invalid"}',
    })
  })

  /**
   * ⚠️ THE ONE BRANCH THAT IS NOT BYTE-IDENTICAL, and it is the exact case
   * `docs/ws6-route-migration.md` uses to argue the exception must be stated as a SHAPE rather than
   * an inventory of causes. A JSON body of literal `null` PARSES, so `catch { body = {} }` never
   * fires and `body.handle` TypeErrors with no database involved at all. Before the migration that
   * reached Next's default 500 HTML page; route() now catches it, logs with an `op`, and answers a
   * structured `{"error":"internal_error"}`.
   */
  it('a body of literal null → 500 {"error":"internal_error"} — CHANGED by the migration, deliberately', async () => {
    expect(await wire(await POST(post(null)))).toEqual({
      status: 500, body: '{"error":"internal_error"}',
    })
    expect(h.handles).toEqual([])
  })
})

describe('POST /api/handle — reserved names', () => {
  it.each(['admin', 'support', 'messages', 'eno_vietnam'])(
    '%s → 400 {"error":"reserved"} (a DIFFERENT code from `invalid`, and the editor tells them apart)',
    async (name) => {
      expect(await wire(await POST(post({ handle: name })))).toEqual({
        status: 400, body: '{"error":"reserved"}',
      })
      expect(h.handles).toEqual([])
    },
  )

  it('reserved is matched after normalisation — "@ADMIN " is reserved too', async () => {
    expect(await wire(await POST(post({ handle: '@ADMIN ' })))).toEqual({
      status: 400, body: '{"error":"reserved"}',
    })
  })
})

describe('POST /api/handle — target: seller', () => {
  it('no storefront → 400 {"error":"no_shop"} and the namespace is never touched', async () => {
    expect(await wire(await POST(post({ handle: 'alex', target: 'seller' })))).toEqual({
      status: 400, body: '{"error":"no_shop"}',
    })
    expect(h.handles).toEqual([])
  })

  it('with a storefront → claims for the SELLER row, 200 {"handle":"…"}', async () => {
    h.sellerByOwner.set('user-1', 'shop-1')
    expect(await wire(await POST(post({ handle: 'apple_store', target: 'seller' })))).toEqual({
      status: 200, body: '{"handle":"apple_store"}',
    })
    expect(h.handles).toEqual([{ handle: 'apple_store', profileId: null, sellerId: 'shop-1' }])
  })

  it('OWNER-SCOPED: an id in the body is ignored — the shop is looked up from the caller', async () => {
    h.sellerByOwner.set('user-1', 'shop-1')
    h.sellerByOwner.set('someone-else', 'shop-666')
    await POST(post({ handle: 'apple_store', target: 'seller', sellerId: 'shop-666', profileId: 'someone-else' }))
    // The PAYLOAD, not just the stored row: `data` is `{ handle, ...owner }`, so an extra id
    // smuggled out of the body would show up here as a third key even if the write still landed.
    expect(h.createData).toEqual([{ handle: 'apple_store', sellerId: 'shop-1' }])
    expect(h.handles).toEqual([{ handle: 'apple_store', profileId: null, sellerId: 'shop-1' }])
  })

  it.each([undefined, 'profile', 'SELLER', 'seller ', 'x', 1, true])(
    'target %p is not the literal "seller", so the claim is the caller\'s own profile',
    async (target) => {
      h.sellerByOwner.set('user-1', 'shop-1')
      await POST(post({ handle: 'alex', target }))
      expect(h.handles).toEqual([{ handle: 'alex', profileId: 'user-1', sellerId: null }])
    },
  )
})

/**
 * ⚠️ THE PRIVILEGE BOUNDARY — the one property this route states in PROSE (`route.ts:11`,
 * "Owner-scoped (no target id is ever accepted from the client)") and that nothing enforced.
 * It is not a wire shape: it is "a caller cannot claim a handle onto someone ELSE'S identity",
 * and it has two independently mutable halves, both of which were silently green before this
 * block existed —
 *   · `owner = { profileId: profile.id }`   → `body.profileId || profile.id` : claim onto another
 *     user's PROFILE, the branch every ordinary user handle claim takes.
 *   · `where: { ownerId: profile.id }`      → `body.ownerId  || profile.id` : claim onto another
 *     user's STOREFRONT.
 * ⚠️ EACH TEST SEEDS THE VICTIM AS A REAL, CLAIMABLE TARGET (the other Profile row is provisioned;
 * the other Seller exists), because otherwise a mutant would merely trip the mocked FK into a 500
 * and the test would pass for the WRONG reason — "the smuggled id was rejected" instead of "the
 * smuggled id was never read". And each pins the QUERY / PAYLOAD the route composed, not just the
 * row the mock chose to hand back.
 */
describe('POST /api/handle — owner-scoped: no target id is EVER accepted from the client', () => {
  it('a profileId in the body cannot redirect the claim onto another user\'s profile', async () => {
    h.profileRows = new Set(['user-1', 'someone-else']) // the victim EXISTS — the FK would hold
    expect(await wire(await POST(post({ handle: 'alex', profileId: 'someone-else' })))).toEqual({
      status: 200, body: '{"handle":"alex"}',
    })
    expect(h.createData).toEqual([{ handle: 'alex', profileId: 'user-1' }])
    expect(h.handles).toEqual([{ handle: 'alex', profileId: 'user-1', sellerId: null }])
  })

  it('an ownerId in the body cannot redirect the storefront lookup onto another user\'s shop', async () => {
    h.sellerByOwner.set('user-1', 'shop-1')
    h.sellerByOwner.set('someone-else', 'shop-666') // a real, claimable victim storefront
    expect(await wire(await POST(post({ handle: 'apple_store', target: 'seller', ownerId: 'someone-else' })))).toEqual({
      status: 200, body: '{"handle":"apple_store"}',
    })
    expect(h.sellerWhere).toEqual([{ ownerId: 'user-1' }]) // the caller, and only ever the caller
    expect(h.createData).toEqual([{ handle: 'apple_store', sellerId: 'shop-1' }])
    expect(h.handles).toEqual([{ handle: 'apple_store', profileId: null, sellerId: 'shop-1' }])
  })
})

describe('POST /api/handle — claim outcomes', () => {
  it('success → 200 {"handle":"alex"}, as JSON', async () => {
    const res = await POST(post({ handle: 'alex' }))
    expect(await wire(res)).toEqual({ status: 200, body: '{"handle":"alex"}' })
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('answers the NORMALISED handle, which is what gets stored', async () => {
    expect(await wire(await POST(post({ handle: '  @ALEX_Doe ' })))).toEqual({
      status: 200, body: '{"handle":"alex_doe"}',
    })
    expect(h.handles).toEqual([{ handle: 'alex_doe', profileId: 'user-1', sellerId: null }])
  })

  it('someone else owns it (PK collision) → 409 {"error":"taken"}', async () => {
    h.handles = [{ handle: 'alex', profileId: 'other', sellerId: null }]
    expect(await wire(await POST(post({ handle: 'alex' })))).toEqual({
      status: 409, body: '{"error":"taken"}',
    })
    expect(h.handles).toEqual([{ handle: 'alex', profileId: 'other', sellerId: null }]) // untouched
  })

  it('any other claimHandle throw → console.error + 500 {"error":"failed"}', async () => {
    h.createThrows = new Error('connection terminated unexpectedly')
    expect(await wire(await POST(post({ handle: 'alex' })))).toEqual({
      status: 500, body: '{"error":"failed"}',
    })
    // The header states this branch as "console.error + 500 failed"; the log line is part of it.
    expect(h.errors.some((a) => a[0] === '[handle] claim failed')).toBe(true)
  })

  it('a rename frees the previous name in the same transaction', async () => {
    h.handles = [{ handle: 'alex', profileId: 'user-1', sellerId: null }]
    expect(await wire(await POST(post({ handle: 'alexander' })))).toEqual({
      status: 200, body: '{"handle":"alexander"}',
    })
    expect(h.handles).toEqual([{ handle: 'alexander', profileId: 'user-1', sellerId: null }])
  })

  it('re-claiming your own current name is a 200 no-op, not a 409', async () => {
    h.handles = [{ handle: 'alex', profileId: 'user-1', sellerId: null }]
    expect(await wire(await POST(post({ handle: 'alex' })))).toEqual({
      status: 200, body: '{"handle":"alex"}',
    })
    expect(h.handles).toEqual([{ handle: 'alex', profileId: 'user-1', sellerId: null }])
  })
})
