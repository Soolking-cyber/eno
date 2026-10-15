import { beforeEach, describe, expect, it, vi } from 'vitest'

// The card cache's ONE writer (src/lib/teachers/identity-mark-card.ts). Pinned: ONE raw UPDATE carrying IS DISTINCT FROM
// — today's notice version while the mark is shown, NULL otherwise — and never tx.listing.update (a display cache is not
// an edit: Listing.updatedAt must not move); `changed` is the row count; the sync takes the teacher saves' own lock
// FIRST, then reads the stored switch and name and judges the LIVE identity on the same transaction (the real predicate
// and identity facts run here, over faked rows); no profile or no listing writes nothing; and it never purges.
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  tp: null as Row | null,
  identity: [] as Row[],
  updated: 1, // what the raw UPDATE reports
  order: [] as string[],
}))
const tx = {
  $executeRaw: vi.fn(async (q: unknown, ..._values: unknown[]) => {
    const isUpdate = !!q && typeof q === 'object' && 'strings' in (q as object) && !Array.isArray(q)
    h.order.push(isUpdate ? 'UPDATE' : 'lock')
    return isUpdate ? h.updated : 1
  }),
  teacherProfile: { findUnique: vi.fn(async () => { h.order.push('teacherProfile.findUnique'); return h.tp }) },
  identityVerification: { findMany: vi.fn(async () => { h.order.push('identityVerification.findMany'); return h.identity }) },
  listing: { update: vi.fn(), updateMany: vi.fn() },
}
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: vi.fn() }))

const { writeIdentityMarkCard, syncIdentityMarkCard } = await import('./identity-mark-card')
const { IDENTITY_MARK_NOTICE_VERSION } = await import('./constants')
const { revalidatePublicPath } = await import('@/lib/revalidate-lang')
const { districtPagesOf } = await import('./revalidate')

const NOW = new Date('2026-10-16T10:00:00+07:00')
const VERIFIED = {
  id: 'iv-1', profileId: 'p1', tier: 'B', method: 'passport_mrz', status: 'verified', decidedAt: new Date('2026-09-01T00:00:00+07:00'),
  documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: 'manual_review',
  evidence: { decisionInput: { surname: 'ERIKSSON', givenNames: 'ANNA MARIA' } },
}
const TP = {
  profileId: 'p1', fullName: 'Anna Eriksson', identityMarkOn: true, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION,
  listingId: 'L1', currentDistrictKey: 'd7', currentDistrict: 'Quận 7',
}
/** The raw UPDATEs made, as { text, values }. */
const updates = () => tx.$executeRaw.mock.calls
  .map(([q]) => q as { strings?: string[]; values?: unknown[]; text?: string })
  .filter((q) => q && typeof q === 'object' && 'strings' in q && !Array.isArray(q))
  .map((q) => ({ text: q.text!, values: q.values! }))

beforeEach(() => {
  vi.clearAllMocks()
  h.tp = { ...TP }; h.identity = [VERIFIED]; h.updated = 1; h.order = []
})

describe('writeIdentityMarkCard — the one raw write', () => {
  it('shown: ONE raw UPDATE of exactly that column to today\'s version, guarded by IS DISTINCT FROM; true when a row changed', async () => {
    expect(await writeIdentityMarkCard(tx as never, 'L1', true)).toBe(true)
    expect(updates()).toEqual([{
      text: 'UPDATE "Listing" SET "identityMarkNotice" = $1::text WHERE "id" = $2 AND "identityMarkNotice" IS DISTINCT FROM $3::text AND ($4::text IS NULL OR "status" <> $5)',
      values: [IDENTITY_MARK_NOTICE_VERSION, 'L1', IDENTITY_MARK_NOTICE_VERSION, IDENTITY_MARK_NOTICE_VERSION, 'removed'],
    }])
  })
  it('not shown: the same statement with NULL — a clear is allowed on any row, a tombstone included', async () => {
    await writeIdentityMarkCard(tx as never, 'L1', false)
    expect(updates()[0].values).toEqual([null, 'L1', null, null, 'removed'])
  })
  it('⛔ a value never lands on a tombstone: the statement itself refuses a non-null write onto a removed listing', async () => {
    await writeIdentityMarkCard(tx as never, 'L1', true)
    expect(updates()[0].text).toMatch(/AND \(\$4::text IS NULL OR "status" <> \$5\)$/)
    expect(updates()[0].values.slice(3)).toEqual([IDENTITY_MARK_NOTICE_VERSION, 'removed'])
  })
  it('an in-sync row (0 rows matched) is not a change', async () => {
    h.updated = 0
    expect(await writeIdentityMarkCard(tx as never, 'L1', true)).toBe(false)
  })
  it('⛔ never tx.listing.update / updateMany — Listing.updatedAt must not move for a display cache', async () => {
    await writeIdentityMarkCard(tx as never, 'L1', true)
    await syncIdentityMarkCard('p1', NOW)
    expect(tx.listing.update).not.toHaveBeenCalled()
    expect(tx.listing.updateMany).not.toHaveBeenCalled()
  })
})

describe('syncIdentityMarkCard', () => {
  it('⛔ takes the teacher saves\' lock FIRST — the same key — then reads the row, then judges the identity on the same transaction, then writes', async () => {
    await syncIdentityMarkCard('p1', NOW)
    expect(h.order).toEqual(['lock', 'teacherProfile.findUnique', 'identityVerification.findMany', 'UPDATE'])
    const [strings, key] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, string]
    expect(strings.join('?')).toBe('select pg_advisory_xact_lock(hashtext(?))')
    expect(key).toBe('teacher:p1')
  })
  it('reads exactly the mark\'s columns plus the listing and its districts — the switch and the name AS STORED', async () => {
    await syncIdentityMarkCard('p1', NOW)
    expect(tx.teacherProfile.findUnique.mock.calls[0]).toEqual([{
      where: { profileId: 'p1' },
      select: { profileId: true, fullName: true, identityMarkOn: true, identityMarkNoticeVersion: true, listingId: true, currentDistrictKey: true, currentDistrict: true },
    }])
  })
  it('shown (verified, the name within the ID, on under today\'s notice): writes the version and says so — with the switch, the listing and its districts', async () => {
    expect(await syncIdentityMarkCard('p1', NOW)).toEqual({ listingId: 'L1', districts: districtPagesOf(TP), changed: true, shown: true, reason: null, on: true })
    expect(updates()[0].values[0]).toBe(IDENTITY_MARK_NOTICE_VERSION)
  })
  it('not shown — revoked, a renamed profile, switched off, an older notice — writes NULL, with the reason and the stored switch', async () => {
    h.identity = [{ ...VERIFIED, status: 'revoked' }]
    expect(await syncIdentityMarkCard('p1', NOW)).toMatchObject({ shown: false, reason: 'revoked', on: true })
    h.identity = [VERIFIED]
    h.tp = { ...TP, fullName: 'Dr Anna Eriksson' }
    expect(await syncIdentityMarkCard('p1', NOW)).toMatchObject({ shown: false, reason: 'name_mismatch', on: true })
    h.tp = { ...TP, identityMarkOn: false }
    expect(await syncIdentityMarkCard('p1', NOW)).toMatchObject({ shown: false, reason: 'off', on: false })
    h.tp = { ...TP, identityMarkNoticeVersion: '2026-10-01' }
    expect(await syncIdentityMarkCard('p1', NOW)).toMatchObject({ shown: false, reason: 'notice_changed', on: true })
    expect(updates().map((u) => u.values[0])).toEqual([null, null, null, null])
  })
  it('⛔ a document good through 16 Oct: the 23:59 sync keeps the tick — the 00:05 ICT sync (/api/cron/identity-marks) clears it', async () => {
    // The real derivation (deriveVerification, through identityMarkFacts): good through its expiry DAY, lapsed at 00:00
    // ICT the day after — which is why the card pass runs alone at 00:05 and not only after the 09:05 reconcile.
    h.identity = [{ ...VERIFIED, documentExpiresAt: new Date('2026-10-16T00:00:00+07:00') }]
    expect(await syncIdentityMarkCard('p1', new Date('2026-10-16T23:59:59+07:00'))).toMatchObject({ shown: true, reason: null })
    expect(await syncIdentityMarkCard('p1', new Date('2026-10-17T00:05:00+07:00'))).toMatchObject({ changed: true, shown: false, reason: 'expired', on: true })
    expect(updates().map((u) => u.values[0])).toEqual([IDENTITY_MARK_NOTICE_VERSION, null])
  })
  it('already in sync: `changed: false` (the count of the guarded UPDATE)', async () => {
    h.updated = 0
    expect(await syncIdentityMarkCard('p1', NOW)).toMatchObject({ changed: false, shown: true })
  })
  it('no profile, or a profile with no listing: null, and no UPDATE', async () => {
    h.tp = null
    expect(await syncIdentityMarkCard('p1', NOW)).toBeNull()
    h.tp = { ...TP, listingId: null }
    expect(await syncIdentityMarkCard('p1', NOW)).toBeNull()
    expect(updates()).toEqual([])
    expect(tx.identityVerification.findMany).not.toHaveBeenCalled()
  })
  it('⛔ never purges — the callers do, after their commit', async () => {
    await syncIdentityMarkCard('p1', NOW)
    expect(revalidatePublicPath).not.toHaveBeenCalled()
  })
})
