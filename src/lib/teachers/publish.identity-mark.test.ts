import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * saveTeacherIdentityMark — the "Identity verified" switch's OWN save (owner, 2026-10-15; plan review R2). Pinned: OFF
 * always succeeds — whatever the rest of the stored profile would fail (screens, validation, gates: none is asked) and
 * whatever base it carries — stamping the withdrawal and keeping the last grant as history; ON is a consent, so it needs
 * today's notice (else 409 notice_changed, nothing read) AND a compare-and-set base matching the stored stamps (else 409
 * identity_mark_changed with NOTHING written); the saves' lock is taken FIRST; after the write, in the same transaction,
 * the mark is judged on the live identity (the real predicate over faked rows) and the card cache written from it —
 * shown only for a live verification whose name the profile's is within; the pages are purged after the commit.
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

const { saveTeacherIdentityMark, TeacherNoticeChangedError, TeacherIdentityMarkConflictError } = await import('./publish')
const { IDENTITY_MARK_NOTICE_VERSION } = await import('./constants')
const { assertSellerMayPublish } = await import('@/lib/compliance/seller-publish-gate')

// Past instants, so a grant made by the test (now) is always later than either.
const GRANT = new Date('2026-10-10T01:00:00.000Z')
const WITHDRAWN = new Date('2026-10-12T02:00:00.000Z')
const VERIFIED = {
  id: 'iv-1', profileId: 'p1', tier: 'B', method: 'passport_mrz', status: 'verified', decidedAt: new Date('2026-09-01T00:00:00+07:00'),
  documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: 'manual_review',
  evidence: { decisionInput: { surname: 'DOE', givenNames: 'JANE' } },
}
/** The stored row as the switch's save reads it under the lock — switched off, never granted. */
const stored = (o: Row = {}): Row => ({
  id: 'tp1', listingId: 'L1', currentDistrictKey: 'd7', currentDistrict: null,
  profileId: 'p1', fullName: 'Jane Doe', identityMarkOn: false, identityMarkNoticeVersion: null,
  identityMarkAt: null, identityMarkWithdrawnAt: null,
  ...o,
})
const NO_STAMPS = { at: null, withdrawnAt: null }
const on = (base: Row | null = NO_STAMPS, notice: string | null | undefined = IDENTITY_MARK_NOTICE_VERSION) =>
  saveTeacherIdentityMark('p1', { on: true, notice, base: base as never })
const off = (o: Row = {}) => saveTeacherIdentityMark('p1', { on: false, ...o })
const written = () => h.profileUpdates[0]?.data
const purges = () => h.order.filter((s) => s.startsWith('purge '))

beforeEach(() => {
  h.cardRows = 1
  vi.clearAllMocks()
  h.tp = stored(); h.identity = [VERIFIED]; h.order = []; h.profileUpdates = []; h.cardWrites = []; h.transactions = 0
})

describe('OFF — a withdrawal is never blocked', () => {
  it('stamps the withdrawal, keeps the last grant as history, clears the card\'s tick and purges', async () => {
    h.tp = stored({ identityMarkOn: true, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION, identityMarkAt: GRANT })
    const r = await off()
    expect(written()).toEqual({ identityMarkOn: false, identityMarkAt: GRANT, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION, identityMarkWithdrawnAt: expect.any(Date) })
    expect(h.cardWrites.map((w) => w.values)).toEqual([[null, 'L1', null, null, 'removed']])
    expect(r).toEqual({ identityMark: { shown: false, reason: 'off' }, stamps: { at: GRANT.toISOString(), withdrawnAt: written().identityMarkWithdrawnAt.toISOString() } })
    expect(purges()).toEqual(expect.arrayContaining(['purge /listings/L1', 'purge /c/teachers', 'purge /c/teachers/d7', 'purge /']))
  })
  it('⛔ succeeds even when the stored profile would FAIL every screen and rule a full save applies — none is asked', async () => {
    // a contact in the name, a banned word in the bio, an unmigrated row with no teach areas: a full save refuses all three
    h.tp = stored({
      identityMarkOn: true, identityMarkNoticeVersion: '2026-10-01', identityMarkAt: GRANT,
      fullName: 'jane@example.com', bio: 'Call 0901 234 567 — cocaine', teachAreas: [], situationVersion: null, headline: '',
    })
    await expect(off()).resolves.toMatchObject({ identityMark: { shown: false } })
    expect(written()).toMatchObject({ identityMarkOn: false, identityMarkWithdrawnAt: expect.any(Date) })
    expect(assertSellerMayPublish).not.toHaveBeenCalled()
  })
  it('⛔ needs no notice and no base — a stale base, or an old notice, never blocks it', async () => {
    h.tp = stored({ identityMarkOn: true, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION, identityMarkAt: GRANT, identityMarkWithdrawnAt: WITHDRAWN })
    await expect(off({ notice: '2020-01-01', base: { at: '2000-01-01T00:00:00.000Z', withdrawnAt: null } })).resolves.toBeTruthy()
    expect(written()).toMatchObject({ identityMarkOn: false })
  })
  it('switching off what is already off records no new withdrawal (the history stands) — and, card clear, purges nothing', async () => {
    h.tp = stored({ identityMarkAt: GRANT, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION, identityMarkWithdrawnAt: WITHDRAWN })
    h.cardRows = 0 // the cache already NULL
    const r = await off()
    // Commit gate, 2026-10-16: withdrawals are never rate-limited, so a repeated OFF must cost no row write and no purge.
    expect(h.profileUpdates).toEqual([])
    expect(purges()).toEqual([])
    expect(r?.stamps).toEqual({ at: GRANT.toISOString(), withdrawnAt: WITHDRAWN.toISOString() })
    expect(r?.identityMark).toEqual({ shown: false, reason: 'off' })
  })

  it('…but a card that still carried a value is cleared and purged, even with the switch already off', async () => {
    h.tp = stored({ identityMarkAt: GRANT, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION, identityMarkWithdrawnAt: WITHDRAWN })
    h.cardRows = 1
    await off()
    expect(h.profileUpdates).toEqual([])
    expect(purges().length).toBeGreaterThan(0)
  })

  // Commit gate, 2026-10-16: OFF used to judge the identity inside its transaction — an identity read that failed rolled
  // the WITHDRAWAL back. A switched-off mark is never shown, so OFF reads nothing about the identity at all.
  it('⛔ OFF never reads the identity — an identity outage cannot roll a withdrawal back', async () => {
    h.tp = stored({ identityMarkOn: true, identityMarkAt: GRANT, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION })
    tx.identityVerification.findMany.mockRejectedValue(new Error('identity read down'))
    try {
      const r = await off()
      expect(r?.identityMark).toEqual({ shown: false, reason: 'off' })
      expect(written()).toMatchObject({ identityMarkOn: false })
      expect(tx.identityVerification.findMany).not.toHaveBeenCalled()
    } finally {
      tx.identityVerification.findMany.mockReset()
      tx.identityVerification.findMany.mockImplementation(async () => { h.order.push('identityVerification.findMany'); return h.identity })
    }
  })
})

describe('ON — a consent: today\'s notice, and the state the form showed', () => {
  it('⛔ without a notice, or under an older one → notice_changed (\'identity\'), before anything is read or written', async () => {
    for (const notice of [undefined, null, '', '2026-10-01']) {
      const e = await saveTeacherIdentityMark('p1', { on: true, notice, base: NO_STAMPS }).catch((x: unknown) => x)
      expect(e, String(notice)).toBeInstanceOf(TeacherNoticeChangedError)
      expect((e as InstanceType<typeof TeacherNoticeChangedError>).notice).toBe('identity')
    }
    expect(h.transactions).toBe(0)
    expect(h.profileUpdates).toEqual([])
  })
  it('⛔ a STALE base → identity_mark_changed, and NOTHING is written — no consent, no card, no purge', async () => {
    // tab A loaded it ON (granted at GRANT); tab B switched it OFF since (WITHDRAWN): tab A's ON must not re-grant
    h.tp = stored({ identityMarkAt: GRANT, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION, identityMarkWithdrawnAt: WITHDRAWN })
    for (const base of [{ at: GRANT.toISOString(), withdrawnAt: null }, NO_STAMPS, { at: null, withdrawnAt: WITHDRAWN.toISOString() }, { at: 'not a date', withdrawnAt: WITHDRAWN.toISOString() }, null]) {
      await expect(on(base), JSON.stringify(base)).rejects.toBeInstanceOf(TeacherIdentityMarkConflictError)
    }
    expect(h.profileUpdates).toEqual([])
    expect(h.cardWrites).toEqual([])
    expect(tx.identityVerification.findMany).not.toHaveBeenCalled()
    expect(purges()).toEqual([])
  })
  it('a matching base — by instant, whatever the ISO spelling — grants: switch on, now, today\'s notice; the withdrawal kept as history', async () => {
    h.tp = stored({ identityMarkAt: GRANT, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION, identityMarkWithdrawnAt: WITHDRAWN })
    const r = await on({ at: '2026-10-10T01:00:00Z', withdrawnAt: '2026-10-12T02:00:00.000Z' })
    expect(written()).toEqual({ identityMarkOn: true, identityMarkAt: expect.any(Date), identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION, identityMarkWithdrawnAt: WITHDRAWN })
    expect(written().identityMarkAt.getTime()).toBeGreaterThan(GRANT.getTime())
    expect(r?.stamps).toEqual({ at: written().identityMarkAt.toISOString(), withdrawnAt: WITHDRAWN.toISOString() })
  })
  it('SHOWN only for a live verification whose name the profile\'s is within: the card cache carries today\'s version', async () => {
    const r = await on()
    expect(r).toEqual({ identityMark: { shown: true, reason: null }, stamps: { at: expect.any(String), withdrawnAt: null } })
    expect(h.cardWrites).toEqual([{
      text: 'UPDATE "Listing" SET "identityMarkNotice" = $1::text WHERE "id" = $2 AND "identityMarkNotice" IS DISTINCT FROM $3::text AND ($4::text IS NULL OR "status" <> $5)',
      values: [IDENTITY_MARK_NOTICE_VERSION, 'L1', IDENTITY_MARK_NOTICE_VERSION, IDENTITY_MARK_NOTICE_VERSION, 'removed'],
    }])
    expect(tx.listing.update).not.toHaveBeenCalled()
  })
  it('the consent is recorded either way — but the card stays clear, with the reason, when the mark cannot show', async () => {
    const cases: Array<[Row, Row[], string]> = [
      [stored({ fullName: 'Dr Jane Doe' }), [VERIFIED], 'name_mismatch'],
      [stored(), [], 'unverified'],
      [stored(), [{ ...VERIFIED, status: 'pending', decidedAt: null }], 'pending'],
      [stored(), [{ ...VERIFIED, status: 'revoked' }], 'revoked'],
      [stored(), [{ ...VERIFIED, evidence: {} }], 'no_name'],
    ]
    for (const [row, identity, reason] of cases) {
      h.tp = row; h.identity = identity; h.profileUpdates = []; h.cardWrites = []
      const r = await on()
      expect(r?.identityMark, reason).toEqual({ shown: false, reason })
      expect(written()?.identityMarkOn, reason).toBe(true)
      expect(h.cardWrites.map((w) => w.values[0]), reason).toEqual([null])
    }
  })
  it('ON over an ON grant under today\'s notice records no new grant (the time stands)', async () => {
    h.tp = stored({ identityMarkOn: true, identityMarkAt: GRANT, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION })
    await on({ at: GRANT.toISOString(), withdrawnAt: null })
    expect(written()).toMatchObject({ identityMarkOn: true, identityMarkAt: GRANT })
  })
})

describe('the lock, the transaction and the purge', () => {
  it('⛔ the saves\' lock FIRST — the same key — then the row, the consent, the live identity and the card; the purge only after the COMMIT', async () => {
    await on()
    expect(h.order.slice(0, 6)).toEqual(['lock teacher:p1', 'teacherProfile.findUnique', 'teacherProfile.update', 'identityVerification.findMany', 'card UPDATE', 'COMMIT'])
    expect(h.order.slice(6).every((s) => s.startsWith('purge '))).toBe(true)
    expect(purges().length).toBeGreaterThan(0)
  })
  it('the identity is judged on the transaction (tx), never another connection', async () => {
    await on()
    expect(tx.identityVerification.findMany).toHaveBeenCalledTimes(1)
  })
  it('no TeacherProfile: null — nothing written, nothing purged', async () => {
    h.tp = null
    expect(await off()).toBeNull()
    expect(await on()).toBeNull()
    expect([h.profileUpdates, h.cardWrites, purges()]).toEqual([[], [], []])
  })
  it('a profile with no listing: the consent is saved, no card to write, its other pages purged', async () => {
    h.tp = stored({ listingId: null })
    await expect(on()).resolves.toMatchObject({ identityMark: { shown: true } })
    expect(written()).toMatchObject({ identityMarkOn: true })
    expect(h.cardWrites).toEqual([])
    expect(purges()).toEqual(expect.arrayContaining(['purge /c/teachers', 'purge /']))
  })
  it('⚠️ a throw inside (the identity read failing) rolls the switch back, purges nothing, and reaches the caller', async () => {
    tx.identityVerification.findMany.mockRejectedValueOnce(new Error('connection reset'))
    await expect(on()).rejects.toThrow('connection reset')
    expect([h.profileUpdates, h.cardWrites, purges()]).toEqual([[], [], []])
  })
})
