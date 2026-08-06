import { afterAll, describe, expect, it, vi } from 'vitest'
import { timingSafeEqual } from 'node:crypto'
import { route } from '@/lib/api/handler'

// Hoisted (vitest requires top level): the five real route modules are imported below purely to
// probe their auth branch, which runs before any of these are touched. Stubs, not fixtures.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('@/lib/mail', () => ({ sendMail: async () => true, mailEnabled: () => false }))
vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => ({}), LISTING_VIDEOS_BUCKET: 'v' }))
// ⚠️ NEEDED ONLY BY THE ACCEPT-PATH ASSERTION BELOW, WHICH ACTUALLY ENTERS THE HANDLERS. With `db`
// stubbed to `{}`, weekly-digest's fan-out floated a rejection that escaped route()'s catch and
// surfaced as an unhandled error AFTER its test had passed. Returning an empty digest lets that one
// handler complete cleanly; every other cron body still throws into route() and answers 500, which
// is all the assertion needs (see the note on `good` below).
vi.mock('@/lib/digest', () => ({ getDigestContent: async () => ({ top: [], sales: [] }) }))
/**
 * ⚠️ EXPLICIT, THOUGH `@/lib/supabase-admin` ABOVE ALREADY COVERS IT — AND THE REASON IS THE BLAST
 * RADIUS. `visa-retention` is a RETENTION SWEEP: it selects expired terminal cases, removes their
 * stored files and deletes up to 2000 rows of real applicant PII. The accept-path assertion below
 * invokes it for real, so the only thing standing between `npx vitest run` and a live purge is that
 * `getVisaDb()` happens to build its client via `getSupabaseAdmin()` (src/lib/visa/db.ts:3), which
 * is mocked. Measured: it answers 500 `{"error":"internal_error"}`, so no client is ever built.
 *
 * That safety is TRANSITIVE, and transitive safety on a destructive path is not safety. The day
 * someone gives `getVisaDb()` its own `createClient`, this file silently starts deleting production
 * rows and the `.not.toBe(401)` assertion passes either way — it cannot tell a 500 from a
 * successful purge. Mocking the destructive modules by name puts the protection where a reader
 * looking at this test will see it. Raised by a reviewer on the staged diff; the finding as stated
 * was wrong, the hazard it pointed at was not.
 */
vi.mock('@/lib/visa/db', () => ({
  getVisaDb: () => { throw new Error('visa db is not available in unit tests') },
  visaTableMissing: () => false,
}))

/**
 * THE `auth: 'cron'` MODE, PINNED AGAINST THE CODE IT REPLACED.
 *
 * ⚠️ THIS EXISTS BECAUSE THE FAILURE IS SILENT IN BOTH DIRECTIONS. `auth: 'cron'` (WS6,
 * 2026-08-06) collapsed five byte-identical copies of a `bearerOk()` timing-safe secret
 * comparison into one implementation. Both ways of getting it wrong are invisible:
 *   · TOO STRICT — every scheduled job 401s and simply stops running. No error, no alert; the
 *     first symptom is that nobody got a digest email for a week.
 *   · TOO LOOSE — an unset `CRON_SECRET` or a `===` that short-circuits turns endpoints that mail
 *     the entire user base and delete storage objects into open, unauthenticated ones.
 * Neither shows up in a typecheck, a lint, or a page that renders. So the guard is tested
 * directly, on the bytes.
 *
 * `LEGACY` below is pasted VERBATIM from `git show HEAD:src/app/api/cron/daily-reminders/route.ts`
 * as of the migration commit — the point is to compare against the original, not against a
 * restatement of the new code's intent.
 */
function legacyBearerOk(header: string | null, secret: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}
/** The legacy call site, verbatim: `if (!secret || !bearerOk(hdr, secret))` → 401 `forbidden`. */
const legacyRejects = (hdr: string | null) => {
  const secret = process.env.CRON_SECRET
  return !secret || !legacyBearerOk(hdr, secret)
}

const OK = route({ auth: 'cron' }, async () => ({ ok: true, reached: true }))
const mkReq = (hdr: string | null) =>
  new Request('https://eno.vn/api/cron/x', { headers: hdr === null ? undefined : { authorization: hdr } })

/**
 * ⚠️ RESTORE `CRON_SECRET`, BECAUSE THIS FILE REWRITES IT ~40 TIMES AND VITEST SHARES THE WORKER.
 * Every test below assigns or deletes it, and the last write wins for whatever runs next in the
 * same process — a suite that ends with the secret set to 'sekret' hands the next file a
 * *configured* cron environment it never asked for, which is order-dependent and would show up as
 * a test that passes alone and fails in the suite. Caught by two reviewers on the staged diff.
 */
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET
afterAll(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET
})

describe('auth: cron', () => {
  it('fails CLOSED when CRON_SECRET is unset — an unset secret is never an open cron', async () => {
    delete process.env.CRON_SECRET
    const r = await OK(mkReq('Bearer anything'))
    expect(r.status).toBe(401)
    expect(await r.text()).toBe('{"error":"forbidden"}')
  })

  it('emits the legacy bytes: lowercase `forbidden` at 401, NOT `Forbidden` and NOT 403', async () => {
    process.env.CRON_SECRET = 'sekret'
    // 403/capital-F is what `auth: 'admin'` emits; these five routes are on the other pairing and
    // a scheduler branches on the status. The oddity is the contract.
    const r = await OK(mkReq('Bearer wrong!'))
    expect(r.status).toBe(401)
    expect(await r.text()).toBe('{"error":"forbidden"}')
  })

  it('lets the CORRECT token through', async () => {
    process.env.CRON_SECRET = 'sekret'
    const r = await OK(mkReq('Bearer sekret'))
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('{"ok":true,"reached":true}')
  })

  it('authenticates a SECRET, not a person: profile/userId/admin stay null', async () => {
    process.env.CRON_SECRET = 'sekret'
    let seen: unknown
    const g = route({ auth: 'cron' }, async (c) => { seen = { p: c.profile, u: c.userId, a: c.admin }; return {} })
    await g(mkReq('Bearer sekret'))
    expect(seen).toEqual({ p: null, u: null, a: null })
  })

  it('agrees with the legacy guard on every (secret, header) pair', async () => {
    const SECRETS = [undefined, '', 'sekret', 'Bearer', 'a', 'ünïcode-ké', 'x'.repeat(64)]
    const HEADERS: (string | null)[] = [
      null, '', 'Bearer', 'bearer sekret', 'Bearer sekret', 'BEARER sekret', 'Bearer sekret ',
      ' Bearer sekret', 'sekret', 'Basic sekret', 'Bearer ünïcode-ké', 'Bearer a',
      'Bearer ' + 'x'.repeat(64), 'Bearer Bearer', 'Bearer sekre', 'Bearer sekrets',
    ]
    let compared = 0
    for (const secret of SECRETS) {
      if (secret === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = secret
      for (const hdr of HEADERS) {
        let req: Request
        // undici refuses to CONSTRUCT a header value with an interior/trailing whitespace run, so
        // those rows are unreachable over real HTTP too.
        try { req = mkReq(hdr) } catch { continue }
        /**
         * ⚠️ COMPARE ON THE HEADER THE HANDLER ACTUALLY SEES. undici TRIMS the value, so
         * `'Bearer sekret '` arrives as `'Bearer sekret'` and is ACCEPTED — by the legacy guard
         * too, since both read it back off the Request. Modelling the raw string made an earlier
         * draft of this test report a mismatch that did not exist.
         */
        const label = `secret=${JSON.stringify(secret)} hdr=${JSON.stringify(hdr)}`
        const r = await OK(req)
        if (legacyRejects(req.headers.get('authorization'))) {
          expect(r.status, label).toBe(401)
          expect(await r.text(), label).toBe('{"error":"forbidden"}')
        } else {
          expect(r.status, label).toBe(200)
        }
        compared++
      }
    }
    expect(compared).toBeGreaterThan(100)
  })
})

/**
 * ⚠️ ALL SIX, AND THE SIXTH IS THE POINT. This block covered only the five `route.ts` cron routes,
 * because `visa-retention/route.svc.ts` migrated in a later wave — and a services-edition wiring
 * failure would have escaped a test that only imports marketplace modules. That is precisely the
 * missed-surface problem this migration exists to close: the original inventory globbed `route.ts`
 * and never saw 38 `.svc.ts` files, which is how a sixth byte-identical copy of the cron guard
 * survived. A test that reproduces the blind spot it was written about is worth nothing.
 */
describe('the six migrated cron routes still emit the legacy 401', () => {
  const mods = {
    'daily-reminders': () => import('@/app/api/cron/daily-reminders/route'),
    'price-stats': () => import('@/app/api/cron/price-stats/route'),
    'saved-search-alerts': () => import('@/app/api/cron/saved-search-alerts/route'),
    'video-gc': () => import('@/app/api/cron/video-gc/route'),
    'weekly-digest': () => import('@/app/api/cron/weekly-digest/route'),
    'visa-retention (.svc)': () => import('@/app/api/cron/visa-retention/route.svc'),
  }
  for (const [name, load] of Object.entries(mods)) {
    it(name, async () => {
      process.env.CRON_SECRET = 'sekret'
      const { GET } = await load()
      const r = await GET(mkReq('Bearer nope'))
      expect(r.status).toBe(401)
      expect(await r.text()).toBe('{"error":"forbidden"}')

      /**
       * ⚠️ AND THE ACCEPT PATH, WHICH IS THE FAILURE THIS SUITE EXISTS FOR. Asserting only the 401
       * proves the guard is not too LOOSE and says nothing about it being too STRICT — and too
       * strict is the silent one: every scheduled job 401s, nothing errors, and the first symptom
       * is that nobody got a digest email for a week. A per-route wiring mistake (wrong mode, a
       * stale hand-rolled guard left in front of the wrapper) passes a reject-only test green.
       * Caught by a reviewer on the staged diff; the gap was real.
       *
       * The assertion is deliberately "NOT the 401", not "200": these handlers do real database
       * work and there is no database in a unit test, so a correct token gets past auth and then
       * throws, which route() turns into `internal_error` 500. Any status other than 401-forbidden
       * proves the token was accepted, which is the whole claim. Asserting 200 would need a DB and
       * would make this an integration test.
       */
      const good = await GET(mkReq('Bearer sekret'))
      expect(good.status, `${name}: a CORRECT token must not be rejected`).not.toBe(401)
    })
  }
})
