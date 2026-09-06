// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * ⛔ THE LOST UPDATE, AGAINST A REAL POSTGRES — BECAUSE NOTHING ELSE CAN SEE IT.
 *
 * `appendVerificationDoc` reads a case's `documents` array, appends one entry and writes the array
 * back. It always did that inside `db.$transaction`, and the comment above it said that made two
 * concurrent uploads safe. It did not: Postgres runs at READ COMMITTED, so both transactions read
 * the same array, both write their own version of it, both `updateMany`s report count 1, and both
 * requests answer 201 — with one of the two documents simply absent from the row. The object is in
 * the private bucket, the seller was told it uploaded, and nothing references it.
 *
 * A mocked database cannot reproduce that: the bug IS the isolation level. So this file talks to a
 * real database, and every guard below exists to make sure that database is a throwaway.
 *
 * ⛔ IT OPTS IN ON `RACE_DB_TESTS=1`, NOT ON `DATABASE_URL`. CI sets a dummy DATABASE_URL purely so
 * Prisma can generate, which means "the variable is set" is true in exactly the environments that
 * have no database (the same trap daily.probe.test.ts documents). And unlike that probe this file
 * WRITES, so it additionally refuses any host that is not loopback and any connection on port 5433
 * — which in this repo is the SSH tunnel to production.
 *
 * Run it: DATABASE_URL=postgresql://…@127.0.0.1:5432/throwaway RACE_DB_TESTS=1 npx vitest run \
 *   src/lib/core/business-verification-race.probe.test.ts
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const loopback = ['127.0.0.1', 'localhost', '::1', 'postgres'].includes(parsed?.hostname ?? '')
const live = process.env.RACE_DB_TESTS === '1' && loopback && parsed?.port !== '5433'

const SELLER = 'race-seller-bv'
/** Profile.id is a uuid (it mirrors auth.users), so this has to be hex — not a readable label. */
const OWNER = '00000000-0000-4000-8000-0000000race1'.replace(/race/g, 'face')

const doc = (n: number) => ({ kind: n === 0 ? 'identity' : 'bank', path: `race/${n}.jpg`, mime: 'image/jpeg', size: 10, uploadedAt: new Date().toISOString() })

describe.skipIf(!live)('appendVerificationDoc against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let svc: typeof import('./business-verification-service')

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    svc = await import('./business-verification-service')
    await reset()
  })
  afterAll(async () => { await reset() })

  async function reset() {
    await db.sellerVerification.deleteMany({ where: { sellerId: SELLER } })
    await db.seller.deleteMany({ where: { id: SELLER } })
    await db.profile.deleteMany({ where: { id: OWNER } })
    await db.profile.create({ data: { id: OWNER, email: 'race@eno.vn', displayName: 'Race', accountType: 'business' } })
    await db.seller.create({ data: { id: SELLER, name: 'Race Shop', ownerId: OWNER } })
  }

  async function freshDraft(): Promise<string> {
    await db.sellerVerification.deleteMany({ where: { sellerId: SELLER } })
    const row = await db.sellerVerification.create({ data: { sellerId: SELLER, version: 1, status: 'draft', documents: [] }, select: { id: true } })
    return row.id
  }

  async function docsOf(caseId: string): Promise<string[]> {
    const row = await db.sellerVerification.findUnique({ where: { id: caseId }, select: { documents: true } })
    return (row?.documents as Array<{ path: string }> | null)?.map((d) => d.path) ?? []
  }

  it('keeps BOTH documents when two uploads append at the same time', async () => {
    const caseId = await freshDraft()
    const [a, b] = await Promise.all([
      svc.appendVerificationDoc(caseId, doc(0) as never),
      svc.appendVerificationDoc(caseId, doc(1) as never),
    ])
    expect([a, b]).toEqual([true, true])
    // ⛔ THE REGRESSION: this was length 1 before the row lock, with one 201 lying.
    expect((await docsOf(caseId)).sort()).toEqual(['race/0.jpg', 'race/1.jpg'])
  })

  /**
   * ⚠️ THIS IS THE DETERMINISTIC REPRODUCTION, AND THE TWO-WAY CASE ABOVE IS NOT. A race can be
   * won cleanly; measured against the pre-fix service, the pair passed on one run while this burst
   * kept THREE of eight documents — five uploads answered 201 and vanished. Keep both: the pair is
   * the readable statement of the bug, this is the one that fails every time.
   */
  it('keeps all of them under a wider burst', async () => {
    const caseId = await freshDraft()
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => svc.appendVerificationDoc(caseId, doc(i) as never)))
    expect(results.every(Boolean)).toBe(true)
    expect((await docsOf(caseId))).toHaveLength(8)
  })

  it('refuses a late upload once the case is frozen, and never loses one it accepted', async () => {
    const caseId = await freshDraft()
    await svc.appendVerificationDoc(caseId, doc(0) as never)
    await svc.appendVerificationDoc(caseId, doc(1) as never)
    // A submit and an upload racing: whichever wins, the outcome must be coherent — either the
    // upload is in the frozen set, or it was refused. Never accepted-and-absent.
    const [submitted, appended] = await Promise.all([
      db.sellerVerification.updateMany({ where: { id: caseId, status: 'draft' }, data: { status: 'pending' } }),
      svc.appendVerificationDoc(caseId, doc(2) as never),
    ])
    const paths = await docsOf(caseId)
    expect(submitted.count).toBe(1)
    if (appended) expect(paths).toContain('race/2.jpg')
    else expect(paths).not.toContain('race/2.jpg')
  })
})
