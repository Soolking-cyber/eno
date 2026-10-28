import { beforeEach, describe, expect, it, vi } from 'vitest'
// Zalo for urgent cover (zalo.ts) runs on a real database in zalo.it.test.ts; here only that the save calls it.
vi.mock('./zalo', () => ({ withdrawZaloForCoverOff: vi.fn(async () => false) }))

/**
 * saveTeacherIdentityMark — the "Identity verified" switch's OWN save (owner, 2026-10-15; plan review R2), AUTOMATIC since
 * 2026-10-16: the mark shows by itself, and this switch HIDES it or shows it again. Pinned: a HIDE always succeeds —
 * whatever the rest of the stored profile would fail (screens, validation, gates: none is asked) and whatever base or
 * notice it carries — writing the switch off and the hide's time WHENEVER the mark is not hidden already (the untouched
 * default included), reading no identity, keeping the last show as history; a repeated hide writes and purges nothing; a
 * SHOW needs no notice, only a compare-and-set base matching the stored stamps (else 409 identity_mark_changed with
 * NOTHING written), and writes only over a hide (the switch on, the show's time, the words version — the hide kept as
 * history); the saves' lock is taken FIRST; a show is judged on the live identity in the same transaction (the real
 * predicate over faked rows) and the card cache written from it; the pages are purged after the commit when anything moved.
 */
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  tp: null as Row | null,
  identity: [] as Row[],
  order: [] as string[],
  profileUpdates: [] as Row[],
  cardWrites: [] as Array<{ text: string; values: unknown[] }>,
  /** Rows the card UPDATE matches — 0 when the cache already holds the value (IS DISTINCT FROM). */
  cardRows: 1,
  transactions: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: vi.fn((p: string) => { h.order.push(`purge ${p}`) }) }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: vi.fn() }))
vi.mock('@/lib/translate', () => ({ warmTranslations: vi.fn() }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: vi.fn(async () => { throw new Error('never asked: no gate guards the switch') }) }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/core/listings', () => ({ deleteListingCore: vi.fn(), parseVideoField: () => ({ action: 'ignore' }) }))

const tx = {
  $executeRaw: vi.fn(async (q: unknown, ...values: unknown[]) => {
    if (q && typeof q === 'object' && 'strings' in (q as object) && !Array.isArray(q)) {
      const sql = q as { text: string; values: unknown[] }
      h.order.push('card UPDATE')
      h.cardWrites.push({ text: sql.text, values: sql.values })
      return h.cardRows
    }
    h.order.push(`lock ${String(values[0])}`)
    return 1
  }),
  teacherProfile: {
    findUnique: vi.fn(async () => { h.order.push('teacherProfile.findUnique'); return h.tp }),
    update: vi.fn(async (a: Row) => { h.order.push('teacherProfile.update'); h.profileUpdates.push(a); return {} }),
  },
  identityVerification: { findMany: vi.fn(async () => { h.order.push('identityVerification.findMany'); return h.identity }) },
  listing: { update: vi.fn(), updateMany: vi.fn() },
}
vi.mock('@/lib/db', () => ({
  db: {
    // A throw inside the callback undoes every write it made, as the real transaction does — so "nothing written" pins
    // that a refusal is thrown INSIDE the transaction, never after a commit.
    $transaction: async (cb: (t: typeof tx) => unknown) => {
      h.transactions++
      const marks = [h.profileUpdates.length, h.cardWrites.length]
      try {
        const r = await cb(tx)
        h.order.push('COMMIT')
        return r
      } catch (e) {
        h.profileUpdates.length = marks[0]
        h.cardWrites.length = marks[1]
        h.order.push('ROLLBACK')
        throw e
      }
    },
  },
}))

const { saveTeacherIdentityMark, TeacherIdentityMarkConflictError } = await import('./publish')
const { IDENTITY_MARK_NOTICE_VERSION } = await import('./constants')
const { assertSellerMayPublish } = await import('@/lib/compliance/seller-publish-gate')

// Past instants, so a write made by the test (now) is always later than either.
const SHOWN = new Date('2026-10-10T01:00:00.000Z')
const HID = new Date('2026-10-12T02:00:00.000Z')
const VERIFIED = {
  id: 'iv-1', profileId: 'p1', tier: 'B', method: 'passport_mrz', status: 'verified', decidedAt: new Date('2026-09-01T00:00:00+07:00'),
  documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: 'manual_review',
  evidence: { decisionInput: { surname: 'DOE', givenNames: 'JANE' } },
}
/** The stored row as the switch's save reads it under the lock — never touched: the automatic default, NOT hidden. */
const stored = (o: Row = {}): Row => ({
  id: 'tp1', listingId: 'L1', currentDistrictKey: 'd7', currentDistrict: null,
  profileId: 'p1', fullName: 'Jane Doe', identityMarkOn: false, identityMarkWithdrawnAt: null,
  identityMarkAt: null,
  ...o,
})
/** Hidden by the teacher: the switch off WITH a hide time (a hide of today's, or a switch-off under the old opt-in). */
const hiddenRow = (o: Row = {}) => stored({ identityMarkWithdrawnAt: HID, ...o })
const NO_STAMPS = { at: null, withdrawnAt: null }
const HIDDEN_STAMPS = { at: null, withdrawnAt: HID.toISOString() }
const show = (base: Row | null = HIDDEN_STAMPS) => saveTeacherIdentityMark('p1', { on: true, base: base as never })
const hide = (o: Row = {}) => saveTeacherIdentityMark('p1', { on: false, ...o })
const written = () => h.profileUpdates[0]?.data
const purges = () => h.order.filter((s) => s.startsWith('purge '))

beforeEach(() => {
  h.cardRows = 1
  vi.clearAllMocks()
  h.tp = stored(); h.identity = [VERIFIED]; h.order = []; h.profileUpdates = []; h.cardWrites = []; h.transactions = 0
})

describe('HIDE — never blocked', () => {
  it('⛔ from the UNTOUCHED default (false, NULL — which is SHOWN): writes the switch off and the hide\'s time, clears the card\'s tick, purges', async () => {
    const r = await hide()
    expect(written()).toEqual({ identityMarkOn: false, identityMarkWithdrawnAt: expect.any(Date) })
    expect(h.cardWrites.map((w) => w.values)).toEqual([[null, 'L1', null, null, 'removed']])
    expect(r).toEqual({ identityMark: { shown: false, reason: 'hidden' }, stamps: { at: null, withdrawnAt: written().identityMarkWithdrawnAt.toISOString() } })
    expect(purges()).toEqual(expect.arrayContaining(['purge /listings/L1', 'purge /c/teachers', 'purge /c/teachers/d7', 'purge /']))
  })
  it('over a SHOW (a switch-on under the old opt-in, or a show-again): the same hide — the last show and its words kept as history', async () => {
    h.tp = stored({ identityMarkOn: true, identityMarkAt: SHOWN, identityMarkNoticeVersion: '2026-10-16' })
    const r = await hide()
    expect(written()).toEqual({ identityMarkOn: false, identityMarkWithdrawnAt: expect.any(Date) })
    expect(written().identityMarkWithdrawnAt.getTime()).toBeGreaterThan(SHOWN.getTime())
    expect(r?.stamps).toEqual({ at: SHOWN.toISOString(), withdrawnAt: written().identityMarkWithdrawnAt.toISOString() })
    // a show-again's history: the switch on, an older hide kept — hidden again with a NEW hide time
    h.profileUpdates = []
    h.tp = stored({ identityMarkOn: true, identityMarkAt: SHOWN, identityMarkWithdrawnAt: HID })
    await hide()
    expect(written().identityMarkWithdrawnAt.getTime()).toBeGreaterThan(HID.getTime())
  })
  it('⛔ succeeds even when the stored profile would FAIL every screen and rule a full save applies — none is asked', async () => {
    // a contact in the name, a banned word in the bio, an unmigrated row with no teach areas: a full save refuses all three
    h.tp = stored({ fullName: 'jane@example.com', bio: 'Call 0901 234 567 — cocaine', teachAreas: [], situationVersion: null, headline: '' })
    await expect(hide()).resolves.toMatchObject({ identityMark: { shown: false, reason: 'hidden' } })
    expect(written()).toMatchObject({ identityMarkOn: false, identityMarkWithdrawnAt: expect.any(Date) })
    expect(assertSellerMayPublish).not.toHaveBeenCalled()
  })
  it('⛔ needs no notice and no base — a stale base, or any notice, never blocks it', async () => {
    h.tp = stored({ identityMarkOn: true, identityMarkAt: SHOWN })
    await expect(hide({ notice: '2020-01-01', base: { at: '2000-01-01T00:00:00.000Z', withdrawnAt: null } })).resolves.toBeTruthy()
    expect(written()).toMatchObject({ identityMarkOn: false })
  })
  it('⛔ a REPEATED hide is a no-op: no row write, no second hide time, and — the card already clear — no purge', async () => {
    h.tp = hiddenRow({ identityMarkAt: SHOWN })
    h.cardRows = 0 // the cache already NULL
    const r = await hide()
    // Commit gate, 2026-10-16: hides are never rate-limited, so a repeated hide must cost no row write and no purge.
    expect(h.profileUpdates).toEqual([])
    expect(purges()).toEqual([])
    expect(r?.stamps).toEqual({ at: SHOWN.toISOString(), withdrawnAt: HID.toISOString() })
    expect(r?.identityMark).toEqual({ shown: false, reason: 'hidden' })
  })
  it('…but a card that still carried a value is cleared and purged, even with the mark already hidden', async () => {
    h.tp = hiddenRow()
    h.cardRows = 1
    await hide()
    expect(h.profileUpdates).toEqual([])
    expect(h.cardWrites.map((w) => w.values[0])).toEqual([null])
    expect(purges().length).toBeGreaterThan(0)
  })
  // Commit gate, 2026-10-16: a hide used to judge the identity inside its transaction — an identity read that failed
  // rolled the HIDE back. A hidden mark is never shown, so a hide reads nothing about the identity at all.
  it('⛔ a hide never reads the identity — an identity outage cannot roll a hide back', async () => {
    tx.identityVerification.findMany.mockRejectedValue(new Error('identity read down'))
    try {
      const r = await hide()
      expect(r?.identityMark).toEqual({ shown: false, reason: 'hidden' })
      expect(written()).toMatchObject({ identityMarkOn: false })
      expect(tx.identityVerification.findMany).not.toHaveBeenCalled()
    } finally {
      tx.identityVerification.findMany.mockReset()
      tx.identityVerification.findMany.mockImplementation(async () => { h.order.push('identityVerification.findMany'); return h.identity })
    }
  })
})

describe('SHOW AGAIN — a compare-and-set, never a consent', () => {
  it('⛔ needs NO notice — a show without one, or with any (an older form still sends it), is judged the same', async () => {
    h.tp = hiddenRow()
    expect(await show()).toMatchObject({ identityMark: { shown: true, reason: null } })
    h.tp = hiddenRow(); h.profileUpdates = []
    expect(await saveTeacherIdentityMark('p1', { on: true, base: HIDDEN_STAMPS, notice: '2026-10-01' } as never)).toMatchObject({ identityMark: { shown: true } })
  })
  it('⛔ a STALE base → identity_mark_changed, and NOTHING is written — no show, no card, no purge', async () => {
    // tab A loaded it hidden at HID; tab B showed it (SHOWN) and hid it again since (a newer hide): tab A must not un-hide it
    const NEWER = new Date('2026-10-14T03:00:00.000Z')
    h.tp = hiddenRow({ identityMarkAt: SHOWN, identityMarkWithdrawnAt: NEWER })
    for (const base of [HIDDEN_STAMPS, { at: SHOWN.toISOString(), withdrawnAt: HID.toISOString() }, NO_STAMPS, { at: 'not a date', withdrawnAt: NEWER.toISOString() }, null]) {
      await expect(show(base), JSON.stringify(base)).rejects.toBeInstanceOf(TeacherIdentityMarkConflictError)
    }
    expect(h.profileUpdates).toEqual([])
    expect(h.cardWrites).toEqual([])
    expect(tx.identityVerification.findMany).not.toHaveBeenCalled()
    expect(purges()).toEqual([])
  })
  it('over a HIDE, with a matching base — by instant, whatever the ISO spelling: the switch on, now, the words version; the hide kept as history', async () => {
    h.tp = hiddenRow({ identityMarkAt: SHOWN, identityMarkNoticeVersion: '2026-10-16' })
    const r = await show({ at: '2026-10-10T01:00:00Z', withdrawnAt: '2026-10-12T02:00:00.000Z' })
    expect(written()).toEqual({ identityMarkOn: true, identityMarkAt: expect.any(Date), identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION })
    expect(written()).not.toHaveProperty('identityMarkWithdrawnAt')
    expect(written().identityMarkAt.getTime()).toBeGreaterThan(SHOWN.getTime())
    expect(r?.stamps).toEqual({ at: written().identityMarkAt.toISOString(), withdrawnAt: HID.toISOString() })
  })
  it('SHOWN for a live verification whose name the profile\'s is within: the card cache carries today\'s version', async () => {
    h.tp = hiddenRow()
    const r = await show()
    expect(r).toEqual({ identityMark: { shown: true, reason: null }, stamps: { at: expect.any(String), withdrawnAt: HID.toISOString() } })
    expect(h.cardWrites).toEqual([{
      text: 'UPDATE "Listing" SET "identityMarkNotice" = $1::text WHERE "id" = $2 AND "identityMarkNotice" IS DISTINCT FROM $3::text AND ($4::text IS NULL OR "status" <> $5)',
      values: [IDENTITY_MARK_NOTICE_VERSION, 'L1', IDENTITY_MARK_NOTICE_VERSION, IDENTITY_MARK_NOTICE_VERSION, 'removed'],
    }])
    expect(tx.listing.update).not.toHaveBeenCalled()
  })
  it('the show is recorded either way — but the card stays clear, with the reason, when the mark cannot show', async () => {
    const cases: Array<[Row, Row[], string]> = [
      [hiddenRow({ fullName: 'Dr Jane Doe' }), [VERIFIED], 'name_mismatch'],
      [hiddenRow(), [], 'unverified'],
      [hiddenRow(), [{ ...VERIFIED, status: 'pending', decidedAt: null }], 'pending'],
      [hiddenRow(), [{ ...VERIFIED, status: 'revoked' }], 'revoked'],
      [hiddenRow(), [{ ...VERIFIED, evidence: {} }], 'no_name'],
    ]
    for (const [row, identity, reason] of cases) {
      h.tp = row; h.identity = identity; h.profileUpdates = []; h.cardWrites = []
      const r = await show()
      expect(r?.identityMark, reason).toEqual({ shown: false, reason })
      expect(written()?.identityMarkOn, reason).toBe(true)
      expect(h.cardWrites.map((w) => w.values[0]), reason).toEqual([null])
    }
  })
  it('over a mark that is NOT hidden (untouched, or shown again already): no write, no new show time — the live state, the card re-synced', async () => {
    for (const row of [stored(), stored({ identityMarkOn: true, identityMarkAt: SHOWN, identityMarkWithdrawnAt: HID })]) {
      h.tp = row; h.profileUpdates = []; h.cardWrites = []; h.order = []
      const base = { at: (row.identityMarkAt as Date | null)?.toISOString() ?? null, withdrawnAt: (row.identityMarkWithdrawnAt as Date | null)?.toISOString() ?? null }
      const r = await show(base)
      expect(h.profileUpdates).toEqual([])
      expect(r).toEqual({ identityMark: { shown: true, reason: null }, stamps: base })
      expect(h.cardWrites.map((w) => w.values[0])).toEqual([IDENTITY_MARK_NOTICE_VERSION])
    }
  })
  it('…and a card already in sync with nothing written: nothing moved, so nothing is purged', async () => {
    h.cardRows = 0
    await show(NO_STAMPS)
    expect(h.profileUpdates).toEqual([])
    expect(purges()).toEqual([])
  })
})

describe('the lock, the transaction and the purge', () => {
  it('⛔ the saves\' lock FIRST — the same key — then the row, the show, the live identity and the card; the purge only after the COMMIT', async () => {
    h.tp = hiddenRow()
    await show()
    expect(h.order.slice(0, 6)).toEqual(['lock teacher:p1', 'teacherProfile.findUnique', 'teacherProfile.update', 'identityVerification.findMany', 'card UPDATE', 'COMMIT'])
    expect(h.order.slice(6).every((s) => s.startsWith('purge '))).toBe(true)
    expect(purges().length).toBeGreaterThan(0)
  })
  it('a hide: the lock, the row, the hide and the card — no identity read — then the purge after the COMMIT', async () => {
    await hide()
    expect(h.order.slice(0, 5)).toEqual(['lock teacher:p1', 'teacherProfile.findUnique', 'teacherProfile.update', 'card UPDATE', 'COMMIT'])
  })
  it('the identity is judged on the transaction (tx), never another connection', async () => {
    h.tp = hiddenRow()
    await show()
    expect(tx.identityVerification.findMany).toHaveBeenCalledTimes(1)
  })
  it('no TeacherProfile: null — nothing written, nothing purged', async () => {
    h.tp = null
    expect(await hide()).toBeNull()
    expect(await show()).toBeNull()
    expect([h.profileUpdates, h.cardWrites, purges()]).toEqual([[], [], []])
  })
  it('a profile with no listing: the show is saved, no card to write, its other pages purged', async () => {
    h.tp = hiddenRow({ listingId: null })
    await expect(show()).resolves.toMatchObject({ identityMark: { shown: true } })
    expect(written()).toMatchObject({ identityMarkOn: true })
    expect(h.cardWrites).toEqual([])
    expect(purges()).toEqual(expect.arrayContaining(['purge /c/teachers', 'purge /']))
  })
  it('⚠️ a throw inside (the identity read failing) rolls the show back, purges nothing, and reaches the caller', async () => {
    h.tp = hiddenRow()
    tx.identityVerification.findMany.mockRejectedValueOnce(new Error('connection reset'))
    await expect(show()).rejects.toThrow('connection reset')
    expect([h.profileUpdates, h.cardWrites, purges()]).toEqual([[], [], []])
  })
})
