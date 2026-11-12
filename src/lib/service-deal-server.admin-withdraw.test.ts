import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE MODERATOR'S UNDO (owner 2026-11-12) — service-deal-server.ts adminWithdrawDeal, and the queue's loader liveDealsFor.
 * Against an in-memory DealConfirmation with the conditional-write semantics the helper relies on (the deal route test's
 * harness, src/app/api/conversations/[id]/deal/route.test.ts): a raw FOR UPDATE / clock_timestamp(), a transaction that
 * rolls back on throw, and matches() for the WHERE. Pinned:
 *   · it writes what the seller's undo writes (confirmedAt → null, revokedAt → the DATABASE's clock) PLUS the thread's
 *     confirm budget spent, one 'admin_withdraw' event by MODERATION_ACTOR_ID, and the audit row with the admin's email;
 *   · ⛔ LOCK ORDER: a bounded lock_timeout, then the compliance_audit advisory lock, then the row lock, then the clock —
 *     account erasure takes the audit lock before it deletes the person's deal rows, so this takes them in the same
 *     order; and the row lock is NOWAIT, because a seller's own erasure locks deal rows (its listing cascade) BEFORE
 *     the audit lock — holding that global lock, this never queues on a row;
 *   · the WHERE pins the confirmation the admin SAW and carries NO time bound (the admin is not windowed);
 *   · a review (under the lock), a decline, an earlier undo or a stale card refuse with their reason and write nothing;
 *   · no chat line, no 'withdraw' / 'declined' / 'confirm' event.
 */

type Row = Record<string, any>
const DAY = 86_400_000

const h = vi.hoisted(() => ({
  deal: null as Row | null,
  review: null as Row | null,
  events: [] as Row[],
  audits: [] as Array<{ tx: unknown; input: Row }>,
  /** Every statement, in order: raw SQL text, and the Prisma calls that matter to the order. */
  sql: [] as string[],
  updates: [] as Row[],
  txOpts: [] as unknown[],
  dbNow: undefined as Date | undefined,
  /** Runs once when the row lock is taken: another write landing while this request waited for it. */
  whileLocked: null as (() => void) | null,
  missingTable: false,
  /** Another transaction holds the deal row: FOR UPDATE NOWAIT fails at once (55P03, wrapped by Prisma as P2010). */
  rowLockedElsewhere: false,
  /** The report's status as read under its row lock (another moderator may have decided the case first). */
  reportStatus: 'open' as string | null,
  /** liveDealsFor's rows. */
  rows: [] as Row[],
  reviews: [] as Row[],
  findManyCalls: [] as Row[],
  reviewFindManyCalls: [] as Row[],
  findManyThrows: null as Error | null,
  logged: [] as Array<{ err: unknown; ctx: unknown }>,
  inserted: [] as unknown[],
}))

/** Prisma's where, as far as these rows use it. */
function matches(row: Row, where: Row): boolean {
  for (const [k, cond] of Object.entries(where)) {
    const v = row[k]
    if (cond === null) { if (v != null) return false; continue }
    if (cond instanceof Date) { if (!(v instanceof Date) || v.getTime() !== cond.getTime()) return false; continue }
    if (typeof cond === 'object') {
      if ('not' in cond && cond.not === null && v == null) return false
      if ('lt' in cond && !(v < cond.lt)) return false
      if ('lte' in cond && !(v != null && v <= cond.lte)) return false
      if ('gte' in cond && !(v != null && v >= cond.gte)) return false
      if ('gt' in cond && !(v != null && v > cond.gt)) return false
      if ('equals' in cond && !(v instanceof Date && v.getTime() === cond.equals.getTime())) return false
      if ('in' in cond && !cond.in.includes(v)) return false
      continue
    }
    if (v !== cond) return false
  }
  return true
}
const missing = () => Object.assign(new Error('The table `public.DealConfirmation` does not exist in the current database.'), { code: 'P2021' })

vi.mock('@/lib/compliance/audit', () => ({
  appendAudit: async (tx: unknown, input: Row) => { h.sql.push('appendAudit'); h.audits.push({ tx, input }); return {} },
}))
vi.mock('@/lib/log', () => ({ logError: (err: unknown, ctx: unknown) => { h.logged.push({ err, ctx }) }, logWarn: () => {}, logInfo: () => {} }))
// Never reached by the helper (it writes no timeline line) — mocked so a regression that adds one is caught below.
vi.mock('@/lib/messages', () => ({ insertMessage: async (...a: unknown[]) => { h.inserted.push(a); return { id: 'm1' } } }))
vi.mock('@/lib/db', () => {
  const pick = (r: Row | null, select?: Row) => (r && select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : r)
  const db: Row = {
    review: {
      findUnique: async () => { h.sql.push('review.findUnique'); return h.review ? { id: h.review.id } : null },
      findMany: async (q: Row) => { h.reviewFindManyCalls.push(q); return h.reviews.filter((r) => q.where.conversationId.in.includes(r.conversationId)).map((r) => ({ conversationId: r.conversationId })) },
    },
    dealConfirmation: {
      findUnique: async ({ select }: Row) => { if (h.missingTable) throw missing(); h.sql.push('dealConfirmation.findUnique'); return pick(h.deal, select) },
      updateMany: async ({ where, data }: Row) => {
        if (h.missingTable) throw missing()
        h.sql.push('dealConfirmation.updateMany')
        h.updates.push({ where, data })
        if (!h.deal || !matches(h.deal, where)) return { count: 0 }
        Object.assign(h.deal, data)
        return { count: 1 }
      },
      findMany: async (q: Row) => {
        h.findManyCalls.push(q)
        if (h.findManyThrows) throw h.findManyThrows
        return h.rows.filter((r) => matches(r, q.where)).map((r) => pick(r, q.select))
      },
    },
    dealConfirmationEvent: { create: async ({ data }: Row) => { h.sql.push('dealConfirmationEvent.create'); h.events.push(data); return {} } },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { h.sql.push(strings.join('?') + (values.length ? ` [${values.join(',')}]` : '')); return 1 },
  }
  db.$queryRaw = async (strings: TemplateStringsArray) => {
    const q = strings.join('?')
    h.sql.push(q)
    if (q.includes('clock_timestamp()')) return [{ now: h.dbNow ?? new Date() }]
    if (q.includes('FROM "Report"')) return h.reportStatus === null ? [] : [{ status: h.reportStatus }]
    if (q.includes('FOR UPDATE')) {
      if (h.missingTable) throw missing()
      if (h.rowLockedElsewhere && q.includes('NOWAIT')) throw Object.assign(new Error('Raw query failed. Code: `55P03`. Message: `could not obtain lock on row in relation "DealConfirmation"`'), { code: 'P2010' })
      const run = h.whileLocked; h.whileLocked = null; run?.(); return []
    }
    return []
  }
  // An interactive transaction: everything it wrote is undone when it throws.
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>, opts?: unknown) => {
    h.txOpts.push(opts)
    const before = { deal: h.deal ? { ...h.deal } : null, events: h.events.length, audits: h.audits.length }
    try { return await fn(db) } catch (e) {
      h.deal = before.deal; h.events = h.events.slice(0, before.events); h.audits = h.audits.slice(0, before.audits)
      throw e
    }
  }
  return { db }
})

const { adminWithdrawDeal, liveDealsFor, MODERATION_ACTOR_ID } = await import('./service-deal-server')
const { SERVICE_DEAL, confirmsLeft, dealState } = await import('./service-deal')
const { db } = await import('@/lib/db')

const ADMIN = 'mod@eno.vn'
const withdraw = (seen: Date | null = h.deal?.confirmedAt ?? null) =>
  adminWithdrawDeal('c1', { admin: ADMIN, reportId: 'r1', seenConfirmedAt: seen ?? new Date(0) })

/** A deal confirmed `ageMs` ago — long past the seller's own 10-minute undo. */
const liveDeal = (ageMs = 3 * DAY, over: Row = {}): Row => ({
  conversationId: 'c1', listingId: 'L1', sellerId: 'shop-1', sellerProfileId: 'seller-p', buyerProfileId: 'buyer-p', kind: 'rental',
  confirmedAt: new Date(Date.now() - ageMs), revokedAt: null, declinedAt: null, confirmCount: 1, reviewId: null, ...over,
})

beforeEach(() => {
  h.deal = null; h.review = null; h.events = []; h.audits = []; h.sql = []; h.updates = []; h.txOpts = []
  h.dbNow = undefined; h.whileLocked = null; h.missingTable = false; h.rowLockedElsewhere = false; h.reportStatus = 'open'
  h.rows = []; h.reviews = []; h.findManyCalls = []; h.reviewFindManyCalls = []; h.findManyThrows = null; h.logged = []; h.inserted = []
})

describe('adminWithdrawDeal — the write', () => {
  it('a live deal 3 days old: revoked on the database clock, the confirm budget spent, one admin_withdraw event, one audit row', async () => {
    h.deal = liveDeal()
    const confirmedAt = h.deal.confirmedAt as Date
    h.dbNow = new Date(Date.now() + 1234)
    expect(await withdraw()).toEqual({ ok: true })

    expect(h.deal).toMatchObject({ confirmedAt: null, revokedAt: h.dbNow, confirmCount: SERVICE_DEAL.MAX_CONFIRMS_PER_THREAD, declinedAt: null, reviewId: null })
    // The seller's strip reads this row: no confirm left on the thread, the deal reads as none (the buyer's card closes).
    expect(confirmsLeft(h.deal as never)).toBe(0)
    expect(dealState(h.deal as never, false)).toBe('none')

    expect(h.events).toEqual([{ conversationId: 'c1', listingId: 'L1', sellerId: 'shop-1', actorProfileId: MODERATION_ACTOR_ID, buyerProfileId: 'buyer-p', action: 'admin_withdraw' }])
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0].tx).toBe(db) // inside the act's transaction (the mock's tx is the client)
    expect(h.audits[0].input).toEqual({
      actorType: 'admin', actorId: ADMIN, action: 'deal.confirmation.withdrawn', subjectType: 'seller', subjectId: 'shop-1',
      detail: { conversationId: 'c1', reportId: 'r1', listingId: 'L1', kind: 'rental', confirmedAt: confirmedAt.toISOString() },
    })
  })

  it('MODERATION_ACTOR_ID is the fixed sentinel — never the nil UUID (an erased person), never v4-shaped like a real Profile id', () => {
    expect(MODERATION_ACTOR_ID).toBe('00000000-0000-0000-0000-00000000a0d1')
    expect(MODERATION_ACTOR_ID).not.toBe('00000000-0000-0000-0000-000000000000')
    expect(MODERATION_ACTOR_ID).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('⛔ ORDER: lock_timeout, then the compliance_audit advisory lock, then the row lock, then the clock — and the audit after the write', async () => {
    h.deal = liveDeal()
    await withdraw()
    const at = (needle: string) => h.sql.findIndex((s) => s.includes(needle))
    expect(h.sql[0]).toBe("SELECT set_config('lock_timeout', '5000ms', true)")
    expect(h.sql[1]).toBe("SELECT pg_advisory_xact_lock(hashtext('compliance_audit'))")
    // NOWAIT: holding the global audit lock, it never queues on the row (a seller's own erasure locks deal rows through
    // its listing cascade BEFORE taking the audit lock — a blocking wait here could close a cycle with it).
    // The case's own row next, also NOWAIT: it must still be open under its lock (gate review, codex).
    expect(h.sql[2]).toMatch(/^SELECT "status" FROM "Report" WHERE "id" = \? FOR UPDATE NOWAIT$/)
    expect(h.sql[3]).toMatch(/^SELECT 1 FROM "DealConfirmation" WHERE "conversationId" = \? FOR UPDATE NOWAIT$/)
    expect(h.sql[4]).toBe('SELECT clock_timestamp() AS now')
    expect(at('review.findUnique')).toBeGreaterThan(at('clock_timestamp'))
    expect(at('dealConfirmation.updateMany')).toBeGreaterThan(at('review.findUnique'))
    expect(at('dealConfirmationEvent.create')).toBeGreaterThan(at('dealConfirmation.updateMany'))
    expect(at('appendAudit')).toBeGreaterThan(at('dealConfirmationEvent.create'))
    // The interactive transaction outlives the bounded audit-lock wait, so the database's lock_timeout answers a stuck wait.
    expect(h.txOpts).toEqual([{ timeout: 15_000 }])
  })

  it('the WHERE: reviewId / revokedAt / declinedAt null and the SEEN confirmedAt — with NO lower or upper time bound', async () => {
    h.deal = liveDeal(40 * DAY) // past even the 30-day review window: the admin is not windowed
    const seen = h.deal.confirmedAt as Date
    expect(await withdraw(seen)).toEqual({ ok: true })
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0].where).toEqual({ conversationId: 'c1', reviewId: null, revokedAt: null, declinedAt: null, confirmedAt: { equals: seen } })
    expect(h.updates[0].data).toEqual({ confirmedAt: null, revokedAt: expect.any(Date), confirmCount: SERVICE_DEAL.MAX_CONFIRMS_PER_THREAD })
  })

  it('no chat line, and no withdraw / declined / confirm event: the confirm cap and the decline flag do not move', async () => {
    h.deal = liveDeal()
    await withdraw()
    expect(h.inserted).toEqual([])
    expect(h.events.map((e) => e.action)).toEqual(['admin_withdraw'])
    expect(h.events.filter((e) => ['withdraw', 'declined', 'confirm'].includes(e.action))).toEqual([])
  })
})

describe('adminWithdrawDeal — the refusals write nothing', () => {
  const nothingWritten = (before: Row) => {
    expect(h.deal).toEqual(before)
    expect(h.events).toEqual([])
    expect(h.audits).toEqual([])
    expect(h.inserted).toEqual([])
  }

  it.each([['confirmed'], ['dismissed'], ['abusive'], [null]])('⛔ the case was decided (%s) before this took its row lock → already_resolved, the deal row never locked, nothing written', async (status) => {
    h.deal = liveDeal()
    const before = { ...h.deal }
    h.reportStatus = status
    await expect(withdraw()).resolves.toEqual({ ok: false, reason: 'already_resolved' })
    expect(h.sql.some((s) => s.includes('FROM "DealConfirmation"'))).toBe(false)
    expect(h.updates).toEqual([])
    nothingWritten(before)
  })

  it('⛔ the deal row is held elsewhere (an erasure, a review in flight) → the NOWAIT refusal is thrown at once, nothing written', async () => {
    h.deal = liveDeal()
    const before = { ...h.deal }
    h.rowLockedElsewhere = true
    await expect(withdraw()).rejects.toMatchObject({ code: 'P2010' })
    expect(h.sql.some((s) => s.includes('clock_timestamp'))).toBe(false) // it never got past the lock
    expect(h.updates).toEqual([])
    nothingWritten(before)
  })

  it('a review committed just before the row lock was taken → already_reviewed, no update even attempted', async () => {
    h.deal = liveDeal()
    const before = { ...h.deal }
    h.whileLocked = () => { h.review = { id: 'rv1' } }
    expect(await withdraw()).toEqual({ ok: false, reason: 'already_reviewed' })
    expect(h.updates).toEqual([])
    nothingWritten(before)
  })

  it('the row already carries a review id (linked under the lock) → already_reviewed', async () => {
    h.deal = liveDeal(3 * DAY, { reviewId: 'rv1' })
    const before = { ...h.deal }
    expect(await withdraw()).toEqual({ ok: false, reason: 'already_reviewed' })
    nothingWritten(before)
  })

  it('already withdrawn (the seller\'s undo, or another moderator) → not_confirmed', async () => {
    const seen = new Date(Date.now() - 3 * DAY)
    h.deal = liveDeal(3 * DAY, { confirmedAt: null, revokedAt: new Date(Date.now() - DAY) })
    const before = { ...h.deal }
    expect(await withdraw(seen)).toEqual({ ok: false, reason: 'not_confirmed' })
    nothingWritten(before)
  })

  it('the buyer said "No" → deal_declined', async () => {
    h.deal = liveDeal(3 * DAY, { declinedAt: new Date(Date.now() - DAY) })
    const before = { ...h.deal }
    expect(await withdraw()).toEqual({ ok: false, reason: 'deal_declined' })
    nothingWritten(before)
  })

  it('⛔ a STALE card (the seller undid and re-confirmed since the page loaded) → not_confirmed, the new confirmation untouched', async () => {
    h.deal = liveDeal(DAY, { confirmCount: 2 })
    const before = { ...h.deal }
    const seenOnTheCard = new Date((h.deal.confirmedAt as Date).getTime() - 2 * DAY)
    expect(await withdraw(seenOnTheCard)).toEqual({ ok: false, reason: 'not_confirmed' })
    nothingWritten(before)
  })

  it('no row at all → not_confirmed', async () => {
    expect(await withdraw(new Date())).toEqual({ ok: false, reason: 'not_confirmed' })
    expect(h.events).toEqual([])
    expect(h.audits).toEqual([])
  })

  it('a missing table is THROWN (the route answers 503 migration_pending), nothing written', async () => {
    h.missingTable = true
    await expect(withdraw(new Date())).rejects.toMatchObject({ code: 'P2021' })
    expect(h.events).toEqual([])
    expect(h.audits).toEqual([])
  })
})

describe('liveDealsFor — the queue\'s batched loader', () => {
  const at = new Date('2026-11-09T08:00:00Z')
  const row = (conversationId: string, over: Row = {}): Row => ({ conversationId, kind: 'rental', confirmedAt: at, revokedAt: null, declinedAt: null, reviewId: null, ...over })

  it('ONE DealConfirmation read for many ids (live rows only), then one Review read that drops reviewed threads; only the three kinds', async () => {
    h.rows = [
      row('c1'),
      row('c2', { kind: 'lesson' }),
      row('c3', { kind: 'service' }), // reviewed through the offer path — never linked to the deal
      row('c4', { kind: 'goods' }), // not a service kind
      row('c5', { confirmedAt: null, revokedAt: at }), // withdrawn
      row('c6', { declinedAt: at }), // declined
      row('c7', { reviewId: 'rv7' }), // reviewed through the deal
    ]
    h.reviews = [{ conversationId: 'c3' }]
    const out = await liveDealsFor(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c1', 'c-none'])
    expect(h.findManyCalls).toHaveLength(1)
    expect(h.findManyCalls[0]).toEqual({
      where: { conversationId: { in: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c-none'] }, confirmedAt: { not: null }, revokedAt: null, declinedAt: null, reviewId: null },
      select: { conversationId: true, kind: true, confirmedAt: true },
    })
    expect(h.reviewFindManyCalls).toEqual([{ where: { conversationId: { in: ['c1', 'c2', 'c3'] } }, select: { conversationId: true } }])
    expect([...out]).toEqual([['c1', { kind: 'rental', confirmedAt: at }], ['c2', { kind: 'lesson', confirmedAt: at }]])
  })

  it('no ids → an empty map, and no query at all', async () => {
    expect((await liveDealsFor([])).size).toBe(0)
    expect(h.findManyCalls).toEqual([])
    expect(h.reviewFindManyCalls).toEqual([])
  })

  it('no live row → no Review read', async () => {
    h.rows = [row('c1', { declinedAt: at })]
    expect((await liveDealsFor(['c1'])).size).toBe(0)
    expect(h.reviewFindManyCalls).toEqual([])
  })

  it('before the DDL (a missing table) → an empty map, silently', async () => {
    h.findManyThrows = missing()
    expect((await liveDealsFor(['c1'])).size).toBe(0)
    expect(h.logged).toEqual([])
  })

  it('⛔ any other failure → an empty map, LOGGED: the moderation page never 500s over it', async () => {
    const boom = new Error('connection terminated')
    h.findManyThrows = boom
    expect((await liveDealsFor(['c1'])).size).toBe(0)
    expect(h.logged).toEqual([{ err: boom, ctx: { op: 'service-deal.liveDealsFor' } }])
  })
})
