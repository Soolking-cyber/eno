import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * WS6 — `POST /api/admin/moderate` ON THE WIRE, BRANCH BY BRANCH.
 *
 * ⚠️ THIS ROUTE WAS MIGRATED ONTO `route()` BY READING ALONE, and `docs/ws6-route-migration.md`
 * names it first in its own "migrated with no test" list: *fourteen irreversible actions* that dock
 * trust, drive the enforcement ladder, pull listings from sale, purge a false reporter's confirmed
 * history and write into dispute rooms. The same workstream has already shipped one live wire code
 * (`'reserved'`) that reasoning could not see. So this file asserts the contract the migration
 * actually made — **status code AND exact response body bytes, per branch** — rather than "it did
 * not throw".
 *
 * ⚠️ TWO FACTS ABOUT `auth: 'admin'` ARE PINNED HERE BECAUSE THEY WERE CHOSEN, NOT INHERITED:
 *   1. a non-admin gets exactly `{"error":"Forbidden"}` at **403** — capital F, which is a
 *      genuinely different response from the cron mode's lowercase `forbidden` at 401; and
 *   2. the mode resolves **no Profile at all**. The handler receives the admin's EMAIL and nothing
 *      else. Every `resolvedBy` this route writes is therefore a plain email STRING, never an FK to
 *      a Profile row — which is exactly what makes the no-profile mode safe. If someone "restores"
 *      the `getCurrentProfile()` call, or rewires `resolvedBy` to an id, the `resolvedBy` byte
 *      assertions below go red.
 *
 * ⚠️ EVERY DATA MODULE IS MOCKED BY NAME. This handler deletes listings, increments false-report
 * strikes, overturns up to 200 confirmed reports and mutates seller trust mirrors. `@/lib/db` alone
 * would *appear* to be enough — but `@/lib/trust`, `@/lib/enforcement` and `@/lib/dispute` each
 * build their own writes, and `@/lib/dispute` additionally reaches `@/lib/supabase-admin`
 * (evidence bucket) and `@/lib/push`. Relying on one of those happening to route through a mocked
 * `db` is *transitive* safety, and a reviewer already caught transitive safety fronting a live
 * retention purge elsewhere in this repo. So the destructive modules are stubbed explicitly, at the
 * top, where a reader sees them.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  /** null ⇒ getAdmin() finds no admin session ⇒ the 403 branch. */
  admin: 'mod@eno.vn' as string | null,
  report: null as Row | null,
  listing: null as Row | null,
  seller: null as Row | null,
  locale: 'en' as string | null,
  /** db.report.updateMany → { count }. A queue lets one request return different counts per call. */
  updateManyCount: 1,
  updateManyQueue: [] as number[],
  /** db.report.findMany, dispatched on `where.status` — the route uses it three different ways. */
  dismissedRows: [] as Row[],
  batchReports: [] as Row[],
  purgedReports: [] as Row[],
  listingUpdateThrows: false,
  /** Name of a db method that should reject, for the accepted `internal_error` wire change. */
  throwOn: null as string | null,
  calls: [] as Array<{ m: string; args?: unknown }>,
  /** Side effects that leave `db` entirely — the trust/enforcement/dispute writes. */
  fx: [] as Array<{ m: string; args: unknown[] }>,
  revalidated: [] as string[],
}))

// ── the database ────────────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => {
  const rec = (m: string, args?: unknown) => {
    h.calls.push({ m, args })
    if (h.throwOn === m) throw new Error('db exploded')
  }
  return {
    db: {
      report: {
        findUnique: async (a: Row) => { rec('report.findUnique', a); return h.report },
        findMany: async (a: Row) => {
          rec('report.findMany', a)
          const st = a?.where?.status
          if (st === 'dismissed') return h.dismissedRows
          if (st === 'confirmed') return h.purgedReports
          return h.batchReports
        },
        update: async (a: Row) => { rec('report.update', a); return {} },
        updateMany: async (a: Row) => {
          rec('report.updateMany', a)
          return { count: h.updateManyQueue.length ? h.updateManyQueue.shift()! : h.updateManyCount }
        },
      },
      listing: {
        findUnique: async (a: Row) => { rec('listing.findUnique', a); return h.listing },
        update: async (a: Row) => {
          rec('listing.update', a)
          if (h.listingUpdateThrows) throw new Error('takedown write failed')
          return {}
        },
        delete: async (a: Row) => { rec('listing.delete', a); return {} },
      },
      profile: {
        findUnique: async (a: Row) => { rec('profile.findUnique', a); return { locale: h.locale } },
        update: async (a: Row) => { rec('profile.update', a); return {} },
      },
      seller: { findUnique: async (a: Row) => { rec('seller.findUnique', a); return h.seller } },
      notification: { create: async (a: Row) => { rec('notification.create', a); return {} } },
      disputeMessage: { create: async (a: Row) => { rec('disputeMessage.create', a); return { id: 'dm-1', createdAt: new Date(0) } } },
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        rec('$executeRaw', { sql: strings.join('${}'), values }); return 1
      },
      // The array form is what `approve` uses. Prisma's members are lazy; ours are already-invoked
      // promises, which is harmless here and lets the two writes be asserted individually.
      $transaction: async (ops: unknown) => {
        rec('$transaction', { n: Array.isArray(ops) ? ops.length : 1 })
        return Array.isArray(ops) ? Promise.all(ops) : ops
      },
    },
  }
})

// ── the caller ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/admin', () => ({
  getAdmin: async () => h.admin,
  // Present so a regression that re-adds the removed `getCurrentProfile()` call is LOUD rather than
  // silently satisfied by a passthrough stub.
  getCurrentProfile: async () => { throw new Error('auth: admin must not resolve a Profile') },
  getCurrentProfileId: async () => { throw new Error('auth: admin must not resolve a profile id') },
}))

// ── irreversible side effects, stubbed BY NAME (see the header) ─────────────────
// Constants come from the real modules so the caps and penalties asserted below are the live ones;
// only the functions that WRITE are replaced.
const fx = (m: string) => (...args: unknown[]) => { h.fx.push({ m, args }) }
vi.mock('@/lib/trust', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  applyTrustEvent: async (...a: unknown[]) => { h.fx.push({ m: 'applyTrustEvent', args: a }); return { score: 70, breakdown: { bd: true } } },
  penalizeSeller: async (...a: unknown[]) => { h.fx.push({ m: 'penalizeSeller', args: a }) },
  recomputeTrust: async (...a: unknown[]) => { h.fx.push({ m: 'recomputeTrust', args: a }); return { score: 71, breakdown: { bd: true } } },
}))
vi.mock('@/lib/enforcement', () => ({ syncEnforcement: async (...a: unknown[]) => { h.fx.push({ m: 'syncEnforcement', args: a }) } }))
vi.mock('@/lib/dispute', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  notifyDispute: async (...a: unknown[]) => { h.fx.push({ m: 'notifyDispute', args: a }) },
  addDisputeMessage: async (...a: unknown[]) => { h.fx.push({ m: 'addDisputeMessage', args: a }); return { id: 'dm-1', createdAt: new Date(0) } },
  respondentProfileId: async (...a: unknown[]) => { h.fx.push({ m: 'respondentProfileId', args: a }); return h.report?.__respondent ?? null },
}))
// Reached only through the modules above, and stubbed anyway: `@/lib/dispute` builds a Supabase
// storage client for the evidence bucket and `@/lib/push` sends real device notifications.
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => { throw new Error('no storage client in unit tests') },
  EVIDENCE_BUCKET: 'evidence',
  LISTING_VIDEOS_BUCKET: 'videos',
}))
vi.mock('@/lib/push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('@/lib/mail', () => ({ sendMail: async () => true, mailEnabled: () => false }))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {}, logInfo: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => { h.revalidated.push(p) } }))
vi.mock('next/server', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  after: (fn: () => unknown) => { void fn() },
}))

import { POST } from './route'
import { SEVERITY_PENALTY, FALSE_REPORT_PENALTY, REPORT_COOLDOWN_DAYS } from '@/lib/trust'
import { DISPUTE_BODY_MAX, DISPUTE_WINDOW_MS } from '@/lib/dispute'

/** Returns status + the RAW body text, because the contract is bytes, not a deep-equal shape. */
async function post(body?: unknown, raw?: string) {
  const req = new Request('https://eno.vn/api/admin/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const res = await POST(req)
  return { status: res.status, text: await res.text(), res }
}

const called = (m: string) => h.calls.filter((c) => c.m === m)
const args = (m: string, i = 0) => called(m)[i]?.args as Row | undefined
const effects = (m: string) => h.fx.filter((f) => f.m === m)

beforeEach(() => {
  h.admin = 'mod@eno.vn'
  h.report = null
  h.listing = null
  h.seller = null
  h.locale = 'en'
  h.updateManyCount = 1
  h.updateManyQueue = []
  h.dismissedRows = []
  h.batchReports = []
  h.purgedReports = []
  h.listingUpdateThrows = false
  h.throwOn = null
  h.calls = []
  h.fx = []
  h.revalidated = []
})

// ────────────────────────────────────────────────────────────────────────────────
describe('auth: admin — the only line the migration replaced', () => {
  it('a guest / non-admin gets EXACTLY {"error":"Forbidden"} 403 — capital F', async () => {
    h.admin = null
    const r = await post({ action: 'reject', id: 'l1' })
    expect(r.status).toBe(403)
    // Byte assertion, not toEqual: the cron mode's lowercase `forbidden` at 401 is a DIFFERENT live
    // response, and both are on the wire. Normalising either one is a client-visible change.
    expect(r.text).toBe('{"error":"Forbidden"}')
  })

  it('the 403 lands BEFORE the body is read and before any write — order is the guarantee', async () => {
    h.admin = null
    // Malformed JSON *and* no id: a wrapper that parsed first would answer 400 "Invalid body".
    const r = await post(undefined, '{not json')
    expect(r.status).toBe(403)
    expect(r.text).toBe('{"error":"Forbidden"}')
    expect(h.calls).toEqual([])
    expect(h.fx).toEqual([])
  })

  it('the handler receives the ADMIN EMAIL, and `resolvedBy` is that plain STRING — not an FK', async () => {
    // This is what makes `auth: 'admin'` resolving no Profile safe. If the mode ever went back to
    // resolving a row, or `resolvedBy` were rewired to a profile id, this goes red.
    h.report = { id: 'r1', targetProfileId: null, targetSellerId: null, listingId: null, reporterProfileId: null }
    await post({ action: 'dismiss-report', id: 'r1' })
    const data = args('report.updateMany')!.data
    expect(data.resolvedBy).toBe('mod@eno.vn')
    expect(typeof data.resolvedBy).toBe('string')
    // getCurrentProfile()/getCurrentProfileId() are stubbed to THROW; reaching this line proves the
    // wrapper called neither.
    expect(called('profile.findUnique')).toHaveLength(0)
  })

  it('answers JSON — the content type is part of the wire too', async () => {
    h.admin = null
    const { res } = await post({ action: 'reject', id: 'x' })
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })
})

describe('the hand parse — no `body:` schema, deliberately', () => {
  it('malformed JSON → 400 {"error":"Invalid body"} (free text, NOT an ApiErrorCode)', async () => {
    const r = await post(undefined, '{not json')
    expect(r.status).toBe(400)
    expect(r.text).toBe('{"error":"Invalid body"}')
    expect(h.calls).toEqual([])
  })

  it('an absent body is also "Invalid body" — req.json() rejects on empty', async () => {
    const r = await post()
    expect(r.status).toBe(400)
    expect(r.text).toBe('{"error":"Invalid body"}')
  })

  it('a JSON body of literal `null` is the shape a tolerant catch would miss → 500 internal_error', async () => {
    // `null` PARSES, so `catch { body = {} }` never fires; the route's `body.decisionNote` read is
    // the first thing to touch it. This is the exact failure the migration doc calls out.
    const r = await post(undefined, 'null')
    expect(r.status).toBe(500)
    expect(r.text).toBe('{"error":"internal_error"}')
  })

  it('no id on a non-bulk action → 400 {"error":"Missing id"}', async () => {
    const r = await post({ action: 'confirm-report' })
    expect(r.status).toBe(400)
    expect(r.text).toBe('{"error":"Missing id"}')
    expect(h.calls).toEqual([])
  })

  it('a whitespace-only id is no id', async () => {
    expect((await post({ action: 'confirm-report', id: '   ' })).text).toBe('{"error":"Missing id"}')
  })

  it('the two BULK actions are exempt from the id check — that is what `isBulk` buys', async () => {
    for (const action of ['bulk-dismiss', 'bulk-confirm']) {
      h.calls = []
      const r = await post({ action })
      expect(r.status, action).toBe(400)
      expect(r.text, action).toBe('{"error":"No ids"}') // NOT "Missing id"
    }
  })

  it('an unrecognised action → 400 {"error":"Unknown action"}', async () => {
    const r = await post({ action: 'delete-everything', id: 'r1' })
    expect(r.status).toBe(400)
    expect(r.text).toBe('{"error":"Unknown action"}')
    expect(h.calls).toEqual([])
  })

  it('an EMPTY action with an id falls through to Unknown action, not to a default case', async () => {
    expect((await post({ id: 'r1' })).text).toBe('{"error":"Unknown action"}')
  })
})

describe('set-note / append-note — staff-only, and fail-quiet', () => {
  it('set-note → 200 {"ok":true}, capped at 2000 chars', async () => {
    const r = await post({ action: 'set-note', id: 'r1', note: 'x'.repeat(2500) })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
    expect(args('report.update')).toEqual({ where: { id: 'r1' }, data: { internalNote: 'x'.repeat(2000) } })
  })

  it('set-note with an empty note writes NULL, not ""', async () => {
    await post({ action: 'set-note', id: 'r1', note: '' })
    expect(args('report.update')!.data).toEqual({ internalNote: null })
  })

  it('set-note swallows a DB failure and still answers 200 — the .catch(logError) is load-bearing', async () => {
    h.throwOn = 'report.update'
    const r = await post({ action: 'set-note', id: 'r1', note: 'hi' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
  })

  it('append-note appends ATOMICALLY in SQL, capped at 500 per line', async () => {
    const r = await post({ action: 'append-note', id: 'r1', note: 'y'.repeat(700) })
    expect(r.text).toBe('{"ok":true}')
    const raw = args('$executeRaw')!
    expect(raw.values).toEqual(['y'.repeat(500), 'r1'])
    expect(raw.sql).toContain('UPDATE "Report"')
    expect(raw.sql).toContain('left(coalesce') // the 2000 cap lives in the SET, server-side
  })

  it('append-note with an empty line writes nothing at all', async () => {
    const r = await post({ action: 'append-note', id: 'r1', note: '' })
    expect(r.text).toBe('{"ok":true}')
    expect(called('$executeRaw')).toHaveLength(0)
  })
})

describe('dismiss-target — the pile-on clear', () => {
  it('unknown report → 404 {"error":"Not found"}', async () => {
    h.report = null
    const r = await post({ action: 'dismiss-target', id: 'r1' })
    expect(r.status).toBe(404)
    expect(r.text).toBe('{"error":"Not found"}')
    expect(called('report.updateMany')).toHaveLength(0)
  })

  it('→ 200 {"ok":true,"dismissed":n}, stamping resolvedBy with the admin EMAIL', async () => {
    h.report = { targetProfileId: 'p9', targetSellerId: null, listingId: null }
    h.updateManyCount = 4
    const r = await post({ action: 'dismiss-target', id: 'r1' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true,"dismissed":4}')
    const upd = args('report.updateMany')!
    expect(upd.where).toEqual({ targetProfileId: 'p9', status: 'open' })
    expect(upd.data.status).toBe('dismissed')
    expect(upd.data.resolvedBy).toBe('mod@eno.vn')
    expect(upd.data.resolvedAt).toBeInstanceOf(Date)
  })

  it.each([
    ['targetProfileId', { targetProfileId: 'p9', targetSellerId: 's1', listingId: 'l1' }, { targetProfileId: 'p9' }],
    ['targetSellerId', { targetProfileId: null, targetSellerId: 's1', listingId: 'l1' }, { targetSellerId: 's1' }],
    ['listingId', { targetProfileId: null, targetSellerId: null, listingId: 'l1' }, { listingId: 'l1' }],
    ['the report itself', { targetProfileId: null, targetSellerId: null, listingId: null }, { id: 'r1' }],
  ])('scopes the pile-on by %s', async (_label, report, where) => {
    h.report = report
    await post({ action: 'dismiss-target', id: 'r1' })
    expect(args('report.updateMany')!.where).toEqual({ ...where, status: 'open' })
  })

  it('notifies from the rows THIS call transitioned — matched by the exact resolve stamp', async () => {
    // The anti-double-notify guard: the re-read is keyed on resolvedBy+resolvedAt, so a concurrent
    // resolve cannot be swept into this call's notifications.
    h.report = { targetProfileId: 'p9', targetSellerId: null, listingId: null }
    h.dismissedRows = [{ id: 'r1', reporterProfileId: 'rep1' }, { id: 'r2', reporterProfileId: null }]
    await post({ action: 'dismiss-target', id: 'r1' })
    const stamp = args('report.updateMany')!.data.resolvedAt
    expect(args('report.findMany')!.where).toEqual({
      targetProfileId: 'p9', resolvedBy: 'mod@eno.vn', resolvedAt: stamp, status: 'dismissed',
    })
    // Only the row with a reporter is notified; the anonymous one is skipped.
    expect(effects('notifyDispute').map((e) => e.args)).toEqual([['rep1', 'r1', 'decided_dismissed_reporter']])
  })
})

describe('bulk-dismiss', () => {
  it('empty ids → 400 {"error":"No ids"}', async () => {
    const r = await post({ action: 'bulk-dismiss', ids: [] })
    expect(r.status).toBe(400)
    expect(r.text).toBe('{"error":"No ids"}')
  })

  it('→ 200 {"ok":true,"dismissed":n} for exactly the ids given', async () => {
    h.updateManyCount = 2
    const r = await post({ action: 'bulk-dismiss', ids: ['a', 'b', 'c'] })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true,"dismissed":2}')
    const upd = args('report.updateMany')!
    expect(upd.where).toEqual({ id: { in: ['a', 'b', 'c'] }, status: 'open' })
    expect(upd.data.resolvedBy).toBe('mod@eno.vn')
  })

  it('caps the batch at 200 ids', async () => {
    await post({ action: 'bulk-dismiss', ids: Array.from({ length: 250 }, (_, i) => `id${i}`) })
    expect(args('report.updateMany')!.where.id.in).toHaveLength(200)
  })
})

describe('bulk-confirm — the batch that docks trust', () => {
  const rep = (over: Row = {}) => ({ id: 'r1', targetProfileId: 'p1', targetSellerId: null, listingId: null, reporterProfileId: 'rep1', ...over })

  it('empty ids → 400 {"error":"No ids"}', async () => {
    expect((await post({ action: 'bulk-confirm', ids: [] })).text).toBe('{"error":"No ids"}')
  })

  it('→ 200 {"ok":true,"confirmed":n,"skipped":m}', async () => {
    h.batchReports = [rep({ id: 'r1' }), rep({ id: 'r2' })]
    const r = await post({ action: 'bulk-confirm', ids: ['r1', 'r2', 'r3'], severity: 'severe' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true,"confirmed":2,"skipped":1}')
    expect(effects('applyTrustEvent')[0].args).toEqual([
      'p1', 'report_confirmed', -SEVERITY_PENALTY.severe, { reason: 'report:r1', reportId: 'r1' },
    ])
    // ⚠️ `toEqual`, NOT `toMatchObject` — the latter ignores an ABSENT key, so a dropped field on
    // the highest-volume destructive write would read as a pass. Every key here is load-bearing:
    // `severity` is what the next read derives a penalty from, `resolvedBy` is the admin EMAIL
    // (the header's "plain STRING, never an FK" fact — bulk-confirm is the one writer that was
    // not checking it), `resolvedAt` is the stamp the resolve-matched re-reads key on.
    expect(args('report.updateMany', 0)!.data).toEqual({
      status: 'confirmed', severity: 'severe', resolvedBy: 'mod@eno.vn', resolvedAt: expect.any(Date),
    })
    // The ladder must know WHICH report triggered it — that id is what the enforcement record
    // links back to in the console. Dropping it left every bulk enforcement unattributed.
    expect(effects('syncEnforcement').map((e) => e.args)).toEqual([
      ['p1', { bd: true }, { persistedScore: 70, triggerReportId: 'r1' }],
      ['p1', { bd: true }, { persistedScore: 70, triggerReportId: 'r2' }],
    ])
    // Both sides, per report: the reported party gets the appeal notice deep-linked to their case…
    expect(called('notification.create').map((c) => (c.args as Row).data)).toEqual([
      expect.objectContaining({ recipientId: 'p1', type: 'dispute', actorName: 'eno.vn moderation', url: '/disputes/r1' }),
      expect.objectContaining({ recipientId: 'p1', type: 'dispute', actorName: 'eno.vn moderation', url: '/disputes/r2' }),
    ])
    // …and the reporter is told the case was upheld.
    expect(effects('notifyDispute').map((e) => e.args)).toEqual([
      ['rep1', 'r1', 'decided_upheld_reporter'],
      ['rep1', 'r2', 'decided_upheld_reporter'],
    ])
  })

  it('an already-resolved row is SKIPPED, never double-docked — the idempotency gate', async () => {
    h.batchReports = [rep({ id: 'r1' }), rep({ id: 'r2' })]
    h.updateManyQueue = [1, 0] // r1 transitions, r2 was already resolved
    const r = await post({ action: 'bulk-confirm', ids: ['r1', 'r2'] })
    expect(r.text).toBe('{"ok":true,"confirmed":1,"skipped":1}')
    expect(effects('applyTrustEvent')).toHaveLength(1)
    // ⚠️ THE GATE IS THE `where`, NOT THE QUEUED COUNT. `updateManyQueue` only exercises the
    // route's `upd.count === 0` read; the actual double-dock guard is the `status: 'open'` clause,
    // which no mock value can prove. Widening it to `{ id: rid }` would re-confirm and re-dock an
    // already-resolved row on every retry — so assert the query the route BUILT, per id, exactly
    // as confirm-report already does.
    expect(args('report.updateMany', 0)!.where).toEqual({ id: 'r1', status: 'open' })
    expect(args('report.updateMany', 1)!.where).toEqual({ id: 'r2', status: 'open' })
  })

  it('an unrecognised severity normalises to `moderate` rather than 400ing', async () => {
    h.batchReports = [rep()]
    await post({ action: 'bulk-confirm', ids: ['r1'], severity: { nope: true } })
    expect(effects('applyTrustEvent')[0].args[2]).toBe(-SEVERITY_PENALTY.moderate)
  })

  it('a storefront target is docked through penalizeSeller, not applyTrustEvent', async () => {
    h.batchReports = [rep({ targetProfileId: null, targetSellerId: 's7' })]
    await post({ action: 'bulk-confirm', ids: ['r1'], severity: 'minor' })
    expect(effects('applyTrustEvent')).toHaveLength(0)
    expect(effects('penalizeSeller')[0].args).toEqual(['s7', -SEVERITY_PENALTY.minor, { reason: 'report:r1', reportId: 'r1' }])
  })

  /**
   * ⚠️ THE TAKEDOWN SUCCESS PATH — untested until now, and it is the whole point of the action.
   * Every OTHER bulk test carrying a `listingId` sets `listingUpdateThrows`, so the write was only
   * ever observed FAILING: a mutation flipping `verified: false` to `true` would make the batch
   * PUBLISH every reported listing instead of pulling it, and deleting the `revalidatePath` would
   * leave a pulled listing serving from ISR — both invisible.
   */
  it('a SUCCESSFUL takedown unverifies each reported listing and revalidates its page', async () => {
    h.batchReports = [rep({ id: 'r1', listingId: 'l1' }), rep({ id: 'r2', listingId: 'l2' })]
    h.listingUpdateThrows = false
    const r = await post({ action: 'bulk-confirm', ids: ['r1', 'r2'] })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true,"confirmed":2,"skipped":0}') // no stillPublic — nothing failed
    expect(called('listing.update').map((c) => c.args)).toEqual([
      { where: { id: 'l1' }, data: { verified: false } },
      { where: { id: 'l2' }, data: { verified: false } },
    ])
    expect(h.revalidated).toEqual(['/listings/l1', '/listings/l2'])
  })

  /**
   * ⚠️ THE PARTIAL-SUCCESS CONTRACT `moderation-client.tsx` DEPENDS ON. The trust docks landed and
   * the listings did NOT come down — so this is a 500 carrying the still-public ids, and it must
   * never read as success. The loop keeps going rather than stranding the remaining reports.
   */
  it('a failed takedown → 500 {"error":"takedown_failed",…} naming the still-public listings', async () => {
    h.batchReports = [rep({ id: 'r1', listingId: 'l1' }), rep({ id: 'r2', listingId: 'l2' })]
    h.listingUpdateThrows = true
    const r = await post({ action: 'bulk-confirm', ids: ['r1', 'r2'] })
    expect(r.status).toBe(500)
    expect(r.text).toBe('{"error":"takedown_failed","confirmed":2,"skipped":0,"stillPublic":["l1","l2"]}')
  })

  it('caps the batch at 100 ids, and `skipped` counts against the CAPPED length', async () => {
    h.batchReports = []
    const r = await post({ action: 'bulk-confirm', ids: Array.from({ length: 150 }, (_, i) => `id${i}`) })
    expect(args('report.findMany')!.where.id.in).toHaveLength(100)
    expect(r.text).toBe('{"ok":true,"confirmed":0,"skipped":100}')
  })

  it('reads the whole batch in ONE findMany, then guards each id with its own updateMany', async () => {
    h.batchReports = [rep({ id: 'r1' }), rep({ id: 'r2' })]
    await post({ action: 'bulk-confirm', ids: ['r1', 'r2'] })
    expect(called('report.findMany').filter((c) => !(c.args as Row).where.status)).toHaveLength(1)
    expect(called('report.updateMany')).toHaveLength(2)
  })
})

describe('approve / reject / unpublish — the listing actions', () => {
  it('approve on an unknown listing → 404 {"error":"Not found"}', async () => {
    h.listing = null
    const r = await post({ action: 'approve', id: 'l1' })
    expect(r.status).toBe(404)
    expect(r.text).toBe('{"error":"Not found"}')
    expect(called('$transaction')).toHaveLength(0)
  })

  it('approve → 200 {"ok":true}: publishes and dismisses its open reports in ONE transaction', async () => {
    h.listing = { id: 'l1' }
    const r = await post({ action: 'approve', id: 'l1' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
    expect(args('$transaction')).toEqual({ n: 2 })
    expect(args('listing.update')).toEqual({ where: { id: 'l1' }, data: { verified: true } })
    const upd = args('report.updateMany')!
    expect(upd.where).toEqual({ listingId: 'l1', status: 'open' })
    expect(upd.data.status).toBe('dismissed')
    expect(upd.data.resolvedBy).toBe('mod@eno.vn')
    expect(h.revalidated).toEqual(['/listings/l1'])
  })

  it('reject on an unknown listing → 404, and deletes NOTHING', async () => {
    h.listing = null
    const r = await post({ action: 'reject', id: 'l1' })
    expect(r.status).toBe(404)
    expect(r.text).toBe('{"error":"Not found"}')
    expect(called('listing.delete')).toHaveLength(0)
  })

  it('reject → 200 {"ok":true} and deletes the listing', async () => {
    h.listing = { id: 'l1' }
    const r = await post({ action: 'reject', id: 'l1' })
    expect(r.text).toBe('{"ok":true}')
    expect(args('listing.delete')).toEqual({ where: { id: 'l1' } })
    expect(h.revalidated).toEqual(['/listings/l1'])
  })

  it('unpublish → 200 {"ok":true}, with NO existence check (it is a blind update, by design)', async () => {
    const r = await post({ action: 'unpublish', id: 'l1' })
    expect(r.text).toBe('{"ok":true}')
    expect(called('listing.findUnique')).toHaveLength(0)
    expect(args('listing.update')).toEqual({ where: { id: 'l1' }, data: { verified: false } })
    // A pulled listing that keeps serving its cached page is still for sale to every visitor
    // holding the ISR copy — the revalidate is the second half of the takedown, not a nicety.
    expect(h.revalidated).toEqual(['/listings/l1'])
  })

  it('unpublish on a missing listing surfaces the Prisma rejection as internal_error 500', async () => {
    h.throwOn = 'listing.update'
    const r = await post({ action: 'unpublish', id: 'nope' })
    expect(r.status).toBe(500)
    expect(r.text).toBe('{"error":"internal_error"}')
  })
})

describe('confirm-report — the single most consequential action', () => {
  const R = { id: 'r1', status: 'open', targetProfileId: 'p1', targetSellerId: null, listingId: null, severity: null, reporterProfileId: 'rep1' }

  it('unknown report → 404 {"error":"Not found"}', async () => {
    h.report = null
    const r = await post({ action: 'confirm-report', id: 'r1' })
    expect(r.status).toBe(404)
    expect(r.text).toBe('{"error":"Not found"}')
    expect(h.fx).toEqual([])
  })

  it('→ 200 {"ok":true}: docks trust, syncs enforcement, notifies both sides', async () => {
    h.report = { ...R }
    const r = await post({ action: 'confirm-report', id: 'r1', severity: 'severe' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
    const upd = args('report.updateMany')!
    expect(upd.where).toEqual({ id: 'r1', status: 'open' })
    // `toEqual`, not `toMatchObject`: the latter ignores an ABSENT key, so dropping `resolvedAt`
    // — the stamp every resolve-matched re-read and the whole audit trail key on — passed.
    expect(upd.data).toEqual({
      status: 'confirmed', severity: 'severe', resolvedBy: 'mod@eno.vn', resolvedAt: expect.any(Date), decisionNote: null,
    })
    expect(effects('applyTrustEvent')[0].args).toEqual(['p1', 'report_confirmed', -SEVERITY_PENALTY.severe, { reason: 'report:r1', reportId: 'r1' }])
    expect(effects('syncEnforcement')[0].args).toEqual(['p1', { bd: true }, { persistedScore: 70, triggerReportId: 'r1' }])
    expect(effects('notifyDispute').map((e) => e.args)).toEqual([['rep1', 'r1', 'decided_upheld_reporter']])
  })

  /** IDEMPOTENT: an admin double-click must not re-dock a score. */
  it('an already-resolved report → 200 {"ok":true} with NO penalty and NO notification', async () => {
    h.report = { ...R }
    h.updateManyCount = 0
    const r = await post({ action: 'confirm-report', id: 'r1' })
    expect(r.text).toBe('{"ok":true}')
    expect(h.fx).toEqual([])
    expect(called('notification.create')).toHaveLength(0)
  })

  it('severity: body wins, then the report\'s own, then `moderate`', async () => {
    for (const [body, stored, want] of [
      ['minor', 'severe', 'minor'],
      ['garbage', 'severe', 'severe'],
      ['', null, 'moderate'],
    ] as const) {
      h.calls = []; h.fx = []
      h.report = { ...R, severity: stored }
      await post({ action: 'confirm-report', id: 'r1', severity: body })
      expect(args('report.updateMany')!.data.severity, `${body}/${stored}`).toBe(want)
      expect(effects('applyTrustEvent')[0].args[2], `${body}/${stored}`).toBe(-SEVERITY_PENALTY[want])
    }
  })

  it('a decisionNote is trimmed and capped at DISPUTE_BODY_MAX; blank becomes null', async () => {
    h.report = { ...R }
    await post({ action: 'confirm-report', id: 'r1', decisionNote: `  ${'z'.repeat(DISPUTE_BODY_MAX + 50)}  ` })
    expect(args('report.updateMany')!.data.decisionNote).toBe('z'.repeat(DISPUTE_BODY_MAX))
    h.calls = []
    await post({ action: 'confirm-report', id: 'r1', decisionNote: '   ' })
    expect(args('report.updateMany')!.data.decisionNote).toBeNull()
  })

  it('takes the reported listing down and notifies the reported party in THEIR language', async () => {
    h.report = { ...R, listingId: 'l1' }
    h.locale = 'vi'
    await post({ action: 'confirm-report', id: 'r1' })
    expect(args('listing.update')).toEqual({ where: { id: 'l1' }, data: { verified: false } })
    expect(h.revalidated).toEqual(['/listings/l1'])
    const notif = args('notification.create')!.data
    // `toEqual` on the whole row: the appeal notice is the reported party's ONLY route to a
    // dispute, so a dropped `body` (the sentence that says an appeal exists) or a dropped `url`
    // (the deep link) would leave a notice that notifies nothing — and `toMatchObject` ignores
    // exactly that. Both strings come out in THEIR language, via pickLocale(profile.locale).
    expect(notif).toEqual({
      recipientId: 'p1',
      type: 'dispute',
      title: 'Nội dung của bạn đã bị xử lý',
      body: 'Nội dung của bạn đã bị xử lý do vi phạm chính sách eno.vn. Nếu bạn cho rằng đây là nhầm lẫn, bạn có thể khiếu nại kèm bằng chứng.',
      actorName: 'eno.vn moderation',
      url: '/disputes/r1',
    })
  })

  /**
   * ⚠️ A DISTINCT 500, NOT AN UNCAUGHT THROW. The report row already flipped to `confirmed`, so a
   * retry hits the idempotency guard and answers a clean 200 with the listing still public. The
   * distinct code is what lets the console say the true thing: dock landed, listing did not.
   */
  it('a failed takedown → 500 {"error":"takedown_failed","listingId":…} AFTER the dock landed', async () => {
    h.report = { ...R, listingId: 'l1' }
    h.listingUpdateThrows = true
    const r = await post({ action: 'confirm-report', id: 'r1' })
    expect(r.status).toBe(500)
    expect(r.text).toBe('{"error":"takedown_failed","listingId":"l1"}')
    expect(effects('applyTrustEvent')).toHaveLength(1) // the dock DID land — that is the point
    expect(effects('notifyDispute')).toHaveLength(1)   // and both sides were still told
  })

  it('a storefront-only target is docked via penalizeSeller and gets no appeal notice', async () => {
    h.report = { ...R, targetProfileId: null, targetSellerId: 's7' }
    const r = await post({ action: 'confirm-report', id: 'r1', severity: 'minor' })
    expect(r.text).toBe('{"ok":true}')
    expect(effects('penalizeSeller')[0].args).toEqual(['s7', -SEVERITY_PENALTY.minor, { reason: 'report:r1', reportId: 'r1' }])
    expect(called('notification.create')).toHaveLength(0)
  })
})

describe('dismiss-report', () => {
  const R = { id: 'r1', reporterProfileId: 'rep1', targetProfileId: 'p1', targetSellerId: null, __respondent: 'p1' }

  it('unknown report → 404 {"error":"Not found"}', async () => {
    h.report = null
    const r = await post({ action: 'dismiss-report', id: 'r1' })
    expect(r.status).toBe(404)
    expect(r.text).toBe('{"error":"Not found"}')
  })

  it('→ 200 {"ok":true}, stamping resolvedBy and closing the loop for BOTH sides', async () => {
    h.report = { ...R }
    const r = await post({ action: 'dismiss-report', id: 'r1', decisionNote: 'no violation' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
    expect(args('report.updateMany')!.data).toEqual({
      status: 'dismissed', resolvedBy: 'mod@eno.vn', resolvedAt: expect.any(Date), decisionNote: 'no violation',
    })
    expect(effects('notifyDispute').map((e) => e.args)).toEqual([
      ['rep1', 'r1', 'decided_dismissed_reporter'],
      ['p1', 'r1', 'decided_closed_respondent'],
    ])
  })

  it('an already-resolved report → 200 {"ok":true} with no second notification', async () => {
    h.report = { ...R }
    h.updateManyCount = 0
    expect((await post({ action: 'dismiss-report', id: 'r1' })).text).toBe('{"ok":true}')
    expect(effects('notifyDispute')).toHaveLength(0)
  })
})

describe('abusive-report — the anti-fake-report purge', () => {
  const R = { id: 'r1', reporterProfileId: 'rep1', targetProfileId: null, targetSellerId: null, __respondent: null }

  it('unknown report → 404 {"error":"Not found"}', async () => {
    h.report = null
    expect((await post({ action: 'abusive-report', id: 'r1' })).text).toBe('{"error":"Not found"}')
  })

  it('→ 200 {"ok":true}: strike + cooldown + trust hit on the REPORTER', async () => {
    h.report = { ...R }
    const before = Date.now()
    const r = await post({ action: 'abusive-report', id: 'r1' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
    expect(args('report.updateMany')!.data).toEqual({
      status: 'abusive', resolvedBy: 'mod@eno.vn', resolvedAt: expect.any(Date), decisionNote: null,
    })
    const p = args('profile.update')!
    expect(p.where).toEqual({ id: 'rep1' })
    expect(p.data.falseReportStrikes).toEqual({ increment: 1 })
    expect(p.data.reportCooldownUntil.getTime()).toBeGreaterThanOrEqual(before + REPORT_COOLDOWN_DAYS * 86_400_000)
    expect(effects('applyTrustEvent')[0].args).toEqual([
      'rep1', 'manual_adjust', -FALSE_REPORT_PENALTY, { reason: 'false_report:r1', reportId: 'r1' },
    ])
  })

  /**
   * ⚠️ THE NOTIFICATION BLOCK WAS DEAD IN EVERY OTHER TEST HERE. The shared fixture pins
   * `__respondent: null`, so `decided_closed_respondent` was never reached at all; and no test
   * named the reporter's macro, so swapping `decided_abusive_reporter` for
   * `decided_dismissed_reporter` — which tells a false reporter their case simply closed, with no
   * mention of the strike, cooldown and trust hit this branch is about to apply — stayed green.
   */
  it('tells the REPORTER it was abusive and the respondent the case closed — both macros, in order', async () => {
    h.report = { ...R, __respondent: 'resp9' }
    const r = await post({ action: 'abusive-report', id: 'r1' })
    expect(r.text).toBe('{"ok":true}')
    expect(effects('notifyDispute').map((e) => e.args)).toEqual([
      ['rep1', 'r1', 'decided_abusive_reporter'],
      ['resp9', 'r1', 'decided_closed_respondent'],
    ])
    // Best-effort, but BEFORE the purge — the strike still landed on the same request.
    expect(called('profile.update')).toHaveLength(1)
  })

  it('an already-resolved report → 200 {"ok":true} and NO strike (idempotent)', async () => {
    h.report = { ...R }
    h.updateManyCount = 0
    expect((await post({ action: 'abusive-report', id: 'r1' })).text).toBe('{"ok":true}')
    expect(called('profile.update')).toHaveLength(0)
    expect(h.fx).toEqual([])
  })

  it('overturns the reporter\'s OTHER confirmed reports and recomputes each affected owner', async () => {
    h.report = { ...R }
    h.purgedReports = [
      { id: 'r2', targetProfileId: 'victim1', targetSellerId: null, severity: 'severe' },
      { id: 'r3', targetProfileId: 'victim1', targetSellerId: null, severity: 'minor' },
    ]
    await post({ action: 'abusive-report', id: 'r1' })
    const purgeRead = called('report.findMany').map((c) => c.args as Row).find((a) => a.where.status === 'confirmed')!
    expect(purgeRead.where).toEqual({ reporterProfileId: 'rep1', status: 'confirmed', id: { not: 'r1' } })
    expect(purgeRead.take).toBe(200)
    const overturn = called('report.updateMany').map((c) => c.args as Row).find((a) => a.data.status === 'overturned')!
    expect(overturn.where).toEqual({ id: { in: ['r2', 'r3'] } })
    expect(overturn.data.resolvedBy).toBe('mod@eno.vn')
    // Deduped: one recompute for the one affected owner, uncapped so the stolen points restore.
    expect(effects('recomputeTrust').map((e) => e.args)).toEqual([['victim1', { uncapped: true }]])
  })

  it('an UNCLAIMED storefront victim gets its mirror credited back directly', async () => {
    h.report = { ...R }
    h.purgedReports = [{ id: 'r2', targetProfileId: null, targetSellerId: 's5', severity: 'moderate' }]
    h.seller = { ownerId: null }
    await post({ action: 'abusive-report', id: 'r1' })
    expect(effects('penalizeSeller')[0].args).toEqual(['s5', SEVERITY_PENALTY.moderate, { reason: 'overturned:r2' }])
  })

  it('a storefront CLAIMED since the report goes through the owner recompute instead', async () => {
    h.report = { ...R }
    h.purgedReports = [{ id: 'r2', targetProfileId: null, targetSellerId: 's5', severity: 'moderate' }]
    h.seller = { ownerId: 'owner9' }
    await post({ action: 'abusive-report', id: 'r1' })
    expect(effects('penalizeSeller')).toHaveLength(0)
    expect(effects('recomputeTrust').map((e) => e.args)).toEqual([['owner9', { uncapped: true }]])
  })

  it('a failing purge is best-effort — the caller still gets 200 {"ok":true}', async () => {
    h.report = { ...R }
    h.throwOn = 'report.findMany'
    const r = await post({ action: 'abusive-report', id: 'r1' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
  })
})

describe('extend-window', () => {
  const R = { id: 'r1', status: 'open', evidenceUntil: null, reporterProfileId: 'rep1', targetProfileId: 'p1', targetSellerId: null, __respondent: 'p1' }

  it('unknown report → 404 {"error":"Not found"}', async () => {
    h.report = null
    expect((await post({ action: 'extend-window', id: 'r1' })).text).toBe('{"error":"Not found"}')
  })

  it('an ALREADY-RESOLVED case → 409 {"error":"already_resolved"}', async () => {
    h.report = { ...R, status: 'confirmed' }
    const r = await post({ action: 'extend-window', id: 'r1' })
    expect(r.status).toBe(409)
    expect(r.text).toBe('{"error":"already_resolved"}')
    expect(called('report.update')).toHaveLength(0)
  })

  it('→ 200 {"ok":true,"evidenceUntil":<iso>} measured from NOW when the window has lapsed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'))
    h.report = { ...R, evidenceUntil: new Date('2026-08-01T00:00:00.000Z') }
    const until = new Date(Date.parse('2026-08-06T00:00:00.000Z') + DISPUTE_WINDOW_MS).toISOString()
    const r = await post({ action: 'extend-window', id: 'r1' })
    expect(r.status).toBe(200)
    expect(r.text).toBe(`{"ok":true,"evidenceUntil":"${until}"}`)
    expect(args('report.update')).toEqual({ where: { id: 'r1' }, data: { evidenceUntil: new Date(until) } })
    vi.useRealTimers()
  })

  it('extends from the CURRENT deadline when it is still in the future', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'))
    const deadline = Date.parse('2026-08-09T00:00:00.000Z')
    h.report = { ...R, evidenceUntil: new Date(deadline) }
    const r = await post({ action: 'extend-window', id: 'r1' })
    expect(r.text).toBe(`{"ok":true,"evidenceUntil":"${new Date(deadline + DISPUTE_WINDOW_MS).toISOString()}"}`)
    vi.useRealTimers()
  })

  it('writes a SILENT thread event and notifies both sides with the richer copy', async () => {
    h.report = { ...R }
    await post({ action: 'extend-window', id: 'r1' })
    const msg = effects('addDisputeMessage')[0].args
    /**
     * ⚠️ `toEqual`, NOT `toMatchObject` — the latter ignores ADDED keys, and the key that matters
     * here is one nobody meant to add. The route's own comment says the admin's identity is never
     * stored or exposed in a dispute room; a mutation adding `adminEmail: admin` to this event
     * survived `toMatchObject` while the byte-identical leak one describe over was caught, because
     * that test uses an exact shape. An individual moderator's email in a room the reported party
     * can read is a doxxing vector, not a formatting detail.
     */
    expect({ ...(msg[1] as Row), body: undefined }).toEqual({ senderProfileId: null, senderRole: 'system', body: undefined })
    expect(String((msg[1] as Row).body)).toMatch(/^Evidence window extended until /)
    expect(msg[2]).toEqual({ notify: false })
    expect(effects('notifyDispute').map((e) => e.args)).toEqual([
      ['rep1', 'r1', 'window_extended'],
      ['p1', 'r1', 'window_extended'],
    ])
  })
})

describe('dispute-message', () => {
  const R = { id: 'r1', status: 'open', reporterProfileId: 'rep1', targetProfileId: 'p1', targetSellerId: null }

  it('empty text → 400 {"error":"empty"} BEFORE the report is even read', async () => {
    // The order matters: an empty-body 400 must not cost a database read.
    h.report = { ...R }
    const r = await post({ action: 'dispute-message', id: 'r1', message: '   ' })
    expect(r.status).toBe(400)
    expect(r.text).toBe('{"error":"empty"}')
    expect(h.calls).toEqual([])
  })

  it('unknown report → 404 {"error":"Not found"}', async () => {
    h.report = null
    const r = await post({ action: 'dispute-message', id: 'r1', message: 'hello' })
    expect(r.status).toBe(404)
    expect(r.text).toBe('{"error":"Not found"}')
    expect(effects('addDisputeMessage')).toHaveLength(0)
  })

  it('→ 200 {"ok":true,"id":<rowId>}, posted as `admin` with NO individual identity attached', async () => {
    h.report = { ...R }
    const r = await post({ action: 'dispute-message', id: 'r1', message: '  please send the receipt  ' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true,"id":"dm-1"}')
    // The admin's email is NEVER stored on the message — rows render as "eno.vn moderation".
    expect(effects('addDisputeMessage')[0].args[1]).toEqual({
      senderProfileId: null, senderRole: 'admin', body: 'please send the receipt',
    })
    expect(JSON.stringify(h.fx)).not.toContain('mod@eno.vn')
  })

  it('caps the body at DISPUTE_BODY_MAX', async () => {
    h.report = { ...R }
    await post({ action: 'dispute-message', id: 'r1', message: 'q'.repeat(DISPUTE_BODY_MAX + 100) })
    expect((effects('addDisputeMessage')[0].args[1] as Row).body).toHaveLength(DISPUTE_BODY_MAX)
  })
})

describe('remediated', () => {
  const R = { id: 'r1', status: 'confirmed', targetProfileId: 'p1' }

  it('unknown report → 404 {"error":"Not found"}', async () => {
    h.report = null
    expect((await post({ action: 'remediated', id: 'r1' })).text).toBe('{"error":"Not found"}')
  })

  it('a NON-confirmed report → 400 {"error":"not_confirmed"}', async () => {
    h.report = { ...R, status: 'open' }
    const r = await post({ action: 'remediated', id: 'r1' })
    expect(r.status).toBe(400)
    expect(r.text).toBe('{"error":"not_confirmed"}')
    expect(called('report.updateMany')).toHaveLength(0)
  })

  it('→ 200 {"ok":true,"remediated":true} and recomputes, guarded on remediatedAt:null', async () => {
    h.report = { ...R }
    const r = await post({ action: 'remediated', id: 'r1' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true,"remediated":true}')
    expect(args('report.updateMany')!.where).toEqual({ id: 'r1', remediatedAt: null })
    // No `{ uncapped: true }` here — unlike the abusive-report purge, a remediation is a normal
    // capped recompute. The absent second argument IS the distinction.
    expect(effects('recomputeTrust').map((e) => e.args)).toEqual([['p1']])
    expect(effects('syncEnforcement')[0].args).toEqual(['p1', { bd: true }, { persistedScore: 71 }])
  })

  it('a second click → 200 {"ok":true,"remediated":false} with NO recompute', async () => {
    h.report = { ...R }
    h.updateManyCount = 0
    const r = await post({ action: 'remediated', id: 'r1' })
    expect(r.text).toBe('{"ok":true,"remediated":false}')
    expect(h.fx).toEqual([])
  })
})

/**
 * ⚠️ THE ONE BRANCH THE MIGRATION KNOWINGLY CHANGED, asserted rather than claimed away. There is no
 * try/catch around the switch, so a rejection from a call that is NOT individually caught used to
 * reach Next's default 500 HTML; `route()` now catches it and answers `{"error":"internal_error"}`
 * 500. Better (a structured code, and never the exception text — which here could carry a
 * reporter's identity), but it IS a wire change, and the DELIBERATE 500s must survive it.
 */
describe('the accepted wire change — and what it must NOT swallow', () => {
  it.each([
    ['confirm-report', { action: 'confirm-report', id: 'r1' }, 'report.findUnique'],
    ['dismiss-report', { action: 'dismiss-report', id: 'r1' }, 'report.updateMany'],
    ['approve', { action: 'approve', id: 'l1' }, 'listing.findUnique'],
    ['bulk-confirm', { action: 'bulk-confirm', ids: ['r1'] }, 'report.findMany'],
  ])('%s: an uncaught rejection → 500 {"error":"internal_error"}, never the exception text', async (_l, body, where) => {
    h.report = { id: 'r1', status: 'open', targetProfileId: 'p1', targetSellerId: null, listingId: null, severity: null, reporterProfileId: 'rep1' }
    h.listing = { id: 'l1' }
    h.throwOn = where
    const r = await post(body)
    expect(r.status).toBe(500)
    expect(r.text).toBe('{"error":"internal_error"}')
    expect(r.text).not.toContain('exploded')
  })

  it('takedown_failed keeps its OWN 500 body — the generic catch must not absorb it', async () => {
    h.report = { id: 'r1', status: 'open', targetProfileId: 'p1', targetSellerId: null, listingId: 'l1', severity: null, reporterProfileId: null }
    h.listingUpdateThrows = true
    expect((await post({ action: 'confirm-report', id: 'r1' })).text).toBe('{"error":"takedown_failed","listingId":"l1"}')
  })
})
