import { beforeEach, describe, expect, it, vi } from 'vitest'

// The "Identity verified" predicate (src/lib/teachers/identity-mark.ts) — THE ONE every surface asks. Pinned: the full
// state matrix in its order (identity facts first, then the name, then the consent), through the REAL identity facts
// (kyc/identity.ts identityMarkFacts, so the one derivation decides) over faked identity rows; that a missing profile is
// never shown; and that identityMarkShownFor makes ZERO identity reads unless the teacher switched it on under today's
// notice with a name — the chat route, the most-polled in the app, asks it.
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ rows: [] as Row[], reads: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { identityVerification: { findMany: async () => { h.reads++; return h.rows } } } }))

const { identityMarkState, identityMarkStateOf, identityMarkShownFor, identityMarkSwitchedOn, IDENTITY_MARK_TP_SELECT } = await import('./identity-mark')
const { IDENTITY_MARK_NOTICE_VERSION } = await import('./constants')
type IdentityMarkInput = import('./identity-mark').IdentityMarkInput

const day = 86_400_000
const NOW = new Date('2026-10-16T10:00:00+07:00')
let n = 0
const iv = (status: string, over: Row = {}): Row => ({
  id: `iv-${++n}`, profileId: 'p1', tier: 'B', method: 'passport_mrz', status,
  decidedAt: status === 'pending' ? null : new Date(NOW.getTime() - 30 * day),
  documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: 'manual_review',
  evidence: { decisionInput: { surname: 'ERIKSSON', givenNames: 'ANNA MARIA' } },
  ...over,
})
/** A teacher who switched it on under today's notice, named as on their ID. */
const ON: IdentityMarkInput = { profileId: 'p1', fullName: 'Anna Eriksson', identityMarkOn: true, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION }
const state = (m: Partial<IdentityMarkInput> = {}) => identityMarkState({ ...ON, ...m }, NOW)

beforeEach(() => { h.rows = []; h.reads = 0 })

describe('identityMarkState — the matrix', () => {
  it('SHOWN: a live verification, the name within the ID, switched on under today\'s notice', async () => {
    h.rows = [iv('verified')]
    expect(await state()).toEqual({ shown: true, reason: null })
  })
  it('a CCCD with no expiry, and a document expiring TODAY (good through its last day, ICT), still show', async () => {
    h.rows = [iv('verified', { tier: 'A', method: 'cccd_manual', documentExpiresAt: null, evidence: { decisionInput: { surname: 'Nguyễn', givenNames: 'Thị Minh Khai' } } })]
    expect(await state({ fullName: 'Khai Nguyen' })).toEqual({ shown: true, reason: null })
    h.rows = [iv('verified', { documentExpiresAt: new Date('2026-10-16T00:00:00+07:00') })]
    expect(await state()).toEqual({ shown: true, reason: null })
  })
  it('the consent: switched off → off; on under an older notice → notice_changed', async () => {
    h.rows = [iv('verified')]
    expect(await state({ identityMarkOn: false })).toEqual({ shown: false, reason: 'off' })
    expect(await state({ identityMarkNoticeVersion: '2026-10-01' })).toEqual({ shown: false, reason: 'notice_changed' })
    expect(await state({ identityMarkNoticeVersion: null })).toEqual({ shown: false, reason: 'notice_changed' })
  })
  it('the identity: none → unverified; rejected → unverified; pending → pending', async () => {
    expect(await state()).toEqual({ shown: false, reason: 'unverified' })
    h.rows = [iv('rejected')]
    expect(await state()).toEqual({ shown: false, reason: 'unverified' })
    h.rows = [iv('pending')]
    expect(await state()).toEqual({ shown: false, reason: 'pending' })
  })
  it('expired yesterday → expired; expired with a renewal in flight → pending', async () => {
    h.rows = [iv('verified', { documentExpiresAt: new Date('2026-10-15T00:00:00+07:00') })]
    expect(await state()).toEqual({ shown: false, reason: 'expired' })
    h.rows = [...h.rows, iv('pending')]
    expect(await state()).toEqual({ shown: false, reason: 'pending' })
  })
  it('⛔ revoked → revoked, whatever else is true (a newer verification, the switch)', async () => {
    h.rows = [iv('revoked', { decidedAt: new Date(NOW.getTime() - 90 * day) }), iv('verified')]
    expect(await state()).toEqual({ shown: false, reason: 'revoked' })
  })
  it('the name: a word the ID lacks → name_mismatch; no name on the verified record → no_name', async () => {
    h.rows = [iv('verified')]
    expect(await state({ fullName: 'Dr Anna Eriksson' })).toEqual({ shown: false, reason: 'name_mismatch' })
    expect(await state({ fullName: 'Anna Schmidt' })).toEqual({ shown: false, reason: 'name_mismatch' })
    h.rows = [iv('verified', { evidence: { documentPath: 'x' } })]
    expect(await state()).toEqual({ shown: false, reason: 'no_name' })
  })
  // ⛔ (review, 2026-10-16) each of these folded to ANNA ERIKSSON and SHOWED the tick — a title or a word in another
  // script, a digit, a symbol, a repeated word. The name beside a public "Identity verified" adds nothing the ID lacks.
  it.each(['Доктор Anna Eriksson', '博士 Anna Eriksson', 'Anna Eriksson 王老师', 'Anna Eriksson 2', 'Anna Eriksson ✅', 'Annaя Eriksson', 'Anna Anna Eriksson'])(
    '⛔ %j → name_mismatch, never shown', async (fullName) => {
      h.rows = [iv('verified')]
      expect(await state({ fullName })).toEqual({ shown: false, reason: 'name_mismatch' })
      expect(await identityMarkShownFor({ ...ON, fullName }, NOW)).toBe(false)
    },
  )
  it('⛔ no profile (fullName null) is NEVER shown — even switched on under today\'s notice — and its name is not judged', async () => {
    h.rows = [iv('verified')]
    expect(await state({ fullName: null })).toEqual({ shown: false, reason: 'off' })
    expect(await state({ fullName: null, identityMarkOn: false, identityMarkNoticeVersion: null })).toEqual({ shown: false, reason: 'off' })
    h.rows = []
    expect(await state({ fullName: null })).toEqual({ shown: false, reason: 'unverified' })
  })
  it('THE ORDER: identity facts before the name, the name before the consent', () => {
    const off = { ...ON, identityMarkOn: false }
    // an off switch never hides an identity reason — the teacher learns what to fix first
    expect(identityMarkStateOf(off, { status: 'pending', resubmitted: true, name: 'none' })).toEqual({ shown: false, reason: 'pending' })
    expect(identityMarkStateOf(off, { status: 'verified', resubmitted: false, name: 'mismatch' })).toEqual({ shown: false, reason: 'name_mismatch' })
    expect(identityMarkStateOf({ ...ON, identityMarkNoticeVersion: 'old' }, { status: 'verified', resubmitted: false, name: 'none' })).toEqual({ shown: false, reason: 'no_name' })
    expect(identityMarkStateOf(ON, { status: 'revoked', resubmitted: true, name: 'match' })).toEqual({ shown: false, reason: 'revoked' })
  })
})

describe('identityMarkShownFor — the boolean the public surfaces get', () => {
  it('⛔ ZERO identity reads when switched off, under an older notice, or with no name', async () => {
    h.rows = [iv('verified')]
    for (const m of [{ identityMarkOn: false }, { identityMarkNoticeVersion: '2026-10-01' }, { identityMarkNoticeVersion: null }, { fullName: null }, { fullName: '' }, { fullName: '   ' }]) {
      expect(await identityMarkShownFor({ ...ON, ...m } as IdentityMarkInput, NOW), JSON.stringify(m)).toBe(false)
    }
    expect(h.reads).toBe(0)
  })
  it('switched on: one read, and the matrix decides', async () => {
    h.rows = [iv('verified')]
    expect(await identityMarkShownFor(ON, NOW)).toBe(true)
    expect(h.reads).toBe(1)
    h.rows = [iv('revoked')]
    expect(await identityMarkShownFor(ON, NOW)).toBe(false)
    expect(await identityMarkShownFor({ ...ON, fullName: 'Dr Anna Eriksson' }, NOW)).toBe(false)
  })
  it('reads on the client it is given — a transaction judges inside itself', async () => {
    const tx = { identityVerification: { findMany: vi.fn(async () => [iv('verified')]) } }
    expect(await identityMarkShownFor(ON, NOW, tx as never)).toBe(true)
    expect(tx.identityVerification.findMany).toHaveBeenCalledTimes(1)
    expect(h.reads).toBe(0)
  })
  it('identityMarkSwitchedOn is that same short-circuit', () => {
    expect(identityMarkSwitchedOn(ON)).toBe(true)
    expect(identityMarkSwitchedOn({ ...ON, identityMarkOn: false })).toBe(false)
    expect(identityMarkSwitchedOn({ ...ON, identityMarkNoticeVersion: '2026-10-01' })).toBe(false)
    expect(identityMarkSwitchedOn({ ...ON, fullName: null })).toBe(false)
  })
})

describe('IDENTITY_MARK_TP_SELECT', () => {
  it('reads exactly the four columns the mark is decided from — nothing private rides along', () => {
    expect(IDENTITY_MARK_TP_SELECT).toEqual({ profileId: true, fullName: true, identityMarkOn: true, identityMarkNoticeVersion: true })
  })
})
