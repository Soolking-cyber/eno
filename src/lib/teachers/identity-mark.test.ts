import { beforeEach, describe, expect, it, vi } from 'vitest'

// The "Identity verified" predicate (src/lib/teachers/identity-mark.ts) — THE ONE every surface asks, AUTOMATIC since
// 2026-10-16 (owner: "so show if kyc passed"). Pinned: what "hidden" means — the teacher's LAST act read from the two
// switch columns, so an untouched row (false, NULL) is SHOWN; the eight reasons in their order (identity facts first, then
// the name, then the profile, then the teacher's hide), through the REAL identity facts (kyc/identity.ts
// identityMarkFacts, so the one derivation decides) over faked identity rows; identityMarkMayShow; that
// identityMarkShownFor makes ZERO identity reads for a hidden mark or a nameless row (and judges everyone else LIVE); and
// that identityMarkShownOnCard — the public surfaces' gate, the chat route among them, the most-polled in the app — makes
// ZERO reads unless the card cache carries today's value, and even then never decides from the card alone.
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ rows: [] as Row[], reads: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { identityVerification: { findMany: async () => { h.reads++; return h.rows } } } }))

const {
  identityMarkState, identityMarkStateOf, identityMarkShownFor, identityMarkShownOnCard, identityMarkMayShow, identityMarkHidden,
  IDENTITY_MARK_TP_SELECT,
} = await import('./identity-mark')
const { IDENTITY_MARK_NOTICE_VERSION } = await import('./constants')
type IdentityMarkInput = import('./identity-mark').IdentityMarkInput

const day = 86_400_000
const NOW = new Date('2026-10-16T10:00:00+07:00')
const HID = new Date('2026-10-12T02:00:00.000Z')
let n = 0
const iv = (status: string, over: Row = {}): Row => ({
  id: `iv-${++n}`, profileId: 'p1', tier: 'B', method: 'passport_mrz', status,
  decidedAt: status === 'pending' ? null : new Date(NOW.getTime() - 30 * day),
  documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: 'manual_review',
  evidence: { decisionInput: { surname: 'ERIKSSON', givenNames: 'ANNA MARIA' } },
  ...over,
})
/** A teacher nobody ever touched the switch of (the column defaults), named as on their ID — the AUTOMATIC default. */
const UNTOUCHED: IdentityMarkInput = { profileId: 'p1', fullName: 'Anna Eriksson', identityMarkOn: false, identityMarkWithdrawnAt: null }
/** The same teacher, who hid it (a hide writes the switch false and the hide's time). */
const HIDDEN: IdentityMarkInput = { ...UNTOUCHED, identityMarkWithdrawnAt: HID }
const state = (m: Partial<IdentityMarkInput> = {}) => identityMarkState({ ...UNTOUCHED, ...m }, NOW)

beforeEach(() => { h.rows = []; h.reads = 0 })

describe('identityMarkHidden — the teacher\'s last act on the switch, from its two columns (no new column)', () => {
  it('⛔ untouched (false, NULL) is NOT hidden — the mark is automatic; the default is shown', () => {
    expect(identityMarkHidden({ identityMarkOn: false, identityMarkWithdrawnAt: null })).toBe(false)
  })
  it('hidden ⇔ the switch false WITH a hide time — a hide made today, or a switch-off under the old opt-in', () => {
    expect(identityMarkHidden({ identityMarkOn: false, identityMarkWithdrawnAt: HID })).toBe(true)
  })
  it('the switch true is the last act being a SHOW — never hidden, whatever hide it keeps as history', () => {
    expect(identityMarkHidden({ identityMarkOn: true, identityMarkWithdrawnAt: null })).toBe(false)
    expect(identityMarkHidden({ identityMarkOn: true, identityMarkWithdrawnAt: HID })).toBe(false)
  })
})

describe('identityMarkState — the matrix', () => {
  it('⛔ SHOWN BY DEFAULT: a live verification and the name within the ID — no switch, no notice, nothing to opt into', async () => {
    h.rows = [iv('verified')]
    expect(await state()).toEqual({ shown: true, reason: null })
    // A switch-on under the old opt-in (any notice version, or none) shows too — it was a SHOW.
    expect(await state({ identityMarkOn: true, identityMarkWithdrawnAt: null })).toEqual({ shown: true, reason: null })
    // A show-again after a hide (the switch true, the hide kept as history) shows.
    expect(await state({ identityMarkOn: true, identityMarkWithdrawnAt: HID })).toEqual({ shown: true, reason: null })
  })
  it('a CCCD with no expiry, and a document expiring TODAY (good through its last day, ICT), still show', async () => {
    h.rows = [iv('verified', { tier: 'A', method: 'cccd_manual', documentExpiresAt: null, evidence: { decisionInput: { surname: 'Nguyễn', givenNames: 'Thị Minh Khai' } } })]
    expect(await state({ fullName: 'Khai Nguyen' })).toEqual({ shown: true, reason: null })
    h.rows = [iv('verified', { documentExpiresAt: new Date('2026-10-16T00:00:00+07:00') })]
    expect(await state()).toEqual({ shown: true, reason: null })
  })
  it('the teacher HID it → hidden', async () => {
    h.rows = [iv('verified')]
    expect(await state({ identityMarkWithdrawnAt: HID })).toEqual({ shown: false, reason: 'hidden' })
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
  it('⛔ revoked → revoked, whatever else is true (a newer verification, a show-again)', async () => {
    h.rows = [iv('revoked', { decidedAt: new Date(NOW.getTime() - 90 * day) }), iv('verified')]
    expect(await state()).toEqual({ shown: false, reason: 'revoked' })
    expect(await state({ identityMarkOn: true })).toEqual({ shown: false, reason: 'revoked' })
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
      expect(await identityMarkShownFor({ ...UNTOUCHED, fullName }, NOW)).toBe(false)
    },
  )
  it('⛔ no profile (fullName null) is NEVER shown — `no_profile` once the identity is live, its name not judged', async () => {
    h.rows = [iv('verified')]
    expect(await state({ fullName: null })).toEqual({ shown: false, reason: 'no_profile' })
    // a hide carries no further — there is nothing to hide yet: the profile is the missing step
    expect(await state({ fullName: null, identityMarkWithdrawnAt: HID })).toEqual({ shown: false, reason: 'no_profile' })
    h.rows = [iv('verified', { evidence: {} })] // no name on the record — not asked: no profile to compare
    expect(await state({ fullName: null })).toEqual({ shown: false, reason: 'no_profile' })
    h.rows = []
    expect(await state({ fullName: null })).toEqual({ shown: false, reason: 'unverified' })
  })
  it('THE ORDER: identity → name (with a profile) → no_profile → hidden → SHOWN', () => {
    const v = (name: 'match' | 'mismatch' | 'none') => ({ status: 'verified' as const, resubmitted: false, name })
    // a hide never hides an identity reason or a name reason — the teacher learns what to fix first
    expect(identityMarkStateOf(HIDDEN, { status: 'pending', resubmitted: true, name: 'none' })).toEqual({ shown: false, reason: 'pending' })
    expect(identityMarkStateOf(HIDDEN, { status: 'revoked', resubmitted: true, name: 'match' })).toEqual({ shown: false, reason: 'revoked' })
    expect(identityMarkStateOf(HIDDEN, { status: 'expired', resubmitted: false, name: 'none' })).toEqual({ shown: false, reason: 'expired' })
    expect(identityMarkStateOf(HIDDEN, { status: 'unverified', resubmitted: false, name: 'none' })).toEqual({ shown: false, reason: 'unverified' })
    expect(identityMarkStateOf(HIDDEN, v('none'))).toEqual({ shown: false, reason: 'no_name' })
    expect(identityMarkStateOf(HIDDEN, v('mismatch'))).toEqual({ shown: false, reason: 'name_mismatch' })
    expect(identityMarkStateOf({ ...HIDDEN, fullName: null }, v('match'))).toEqual({ shown: false, reason: 'no_profile' })
    expect(identityMarkStateOf(HIDDEN, v('match'))).toEqual({ shown: false, reason: 'hidden' })
    expect(identityMarkStateOf(UNTOUCHED, v('match'))).toEqual({ shown: true, reason: null })
  })
  it('the reasons are exactly the eight — no `off`, no `notice_changed` (the opt-in is gone)', () => {
    const facts = [
      { status: 'revoked', resubmitted: false, name: 'match' }, { status: 'pending', resubmitted: true, name: 'none' },
      { status: 'expired', resubmitted: false, name: 'none' }, { status: 'unverified', resubmitted: false, name: 'none' },
      { status: 'verified', resubmitted: false, name: 'none' }, { status: 'verified', resubmitted: false, name: 'mismatch' },
      { status: 'verified', resubmitted: false, name: 'match' },
    ] as const
    const seen = new Set<string | null>()
    for (const f of facts) for (const m of [UNTOUCHED, HIDDEN, { ...UNTOUCHED, fullName: null }]) seen.add(identityMarkStateOf(m, f).reason)
    expect([...seen].sort()).toEqual([null, 'expired', 'hidden', 'name_mismatch', 'no_name', 'no_profile', 'pending', 'revoked', 'unverified'].sort())
  })
})

describe('identityMarkMayShow — the teacher\'s side alone', () => {
  it('a profile with a name, not hidden — whatever the switch said under the old opt-in', () => {
    expect(identityMarkMayShow(UNTOUCHED)).toBe(true)
    expect(identityMarkMayShow({ ...UNTOUCHED, identityMarkOn: true })).toBe(true)
    expect(identityMarkMayShow({ ...HIDDEN, identityMarkOn: true })).toBe(true) // shown again after a hide
  })
  it('hidden, no profile, or a name that is empty: false', () => {
    expect(identityMarkMayShow(HIDDEN)).toBe(false)
    for (const fullName of [null, '', '   ']) expect(identityMarkMayShow({ ...UNTOUCHED, fullName }), String(fullName)).toBe(false)
  })
})

describe('identityMarkShownFor — the boolean judged LIVE (writers, and readers with no card cache)', () => {
  it('⛔ ZERO identity reads for a hidden mark or a nameless row', async () => {
    h.rows = [iv('verified')]
    for (const m of [HIDDEN, { ...UNTOUCHED, fullName: null }, { ...UNTOUCHED, fullName: '' }, { ...UNTOUCHED, fullName: '   ' }]) {
      expect(await identityMarkShownFor(m, NOW), JSON.stringify(m)).toBe(false)
    }
    expect(h.reads).toBe(0)
  })
  it('⛔ the untouched default is judged — one read — and SHOWN when the identity is live: no opt-in needed', async () => {
    h.rows = [iv('verified')]
    expect(await identityMarkShownFor(UNTOUCHED, NOW)).toBe(true)
    expect(h.reads).toBe(1)
  })
  it('one read each time, and the matrix decides — no memo (a revocation shows on the very next call)', async () => {
    h.rows = [iv('verified')]
    expect(await identityMarkShownFor(UNTOUCHED, NOW)).toBe(true)
    h.rows = [iv('revoked')]
    expect(await identityMarkShownFor(UNTOUCHED, NOW)).toBe(false)
    expect(await identityMarkShownFor({ ...UNTOUCHED, fullName: 'Dr Anna Eriksson' }, NOW)).toBe(false)
    expect(h.reads).toBe(3)
  })
  it('reads on the client it is given — a transaction judges inside itself', async () => {
    const tx = { identityVerification: { findMany: vi.fn(async () => [iv('verified')]) } }
    expect(await identityMarkShownFor(UNTOUCHED, NOW, tx as never)).toBe(true)
    expect(tx.identityVerification.findMany).toHaveBeenCalledTimes(1)
    expect(h.reads).toBe(0)
  })
})

describe('identityMarkShownOnCard — the public surfaces\' gate (the profile page, the chat chip)', () => {
  it('⛔ ZERO reads unless the card cache carries TODAY\'s value: NULL, absent, the opt-in\'s old value, anything else', async () => {
    h.rows = [iv('verified')]
    for (const card of [null, undefined, '', '2026-10-16', '2026-01-01', 'true', `${IDENTITY_MARK_NOTICE_VERSION} `]) {
      expect(await identityMarkShownOnCard(UNTOUCHED, card, NOW), String(card)).toBe(false)
    }
    expect(h.reads).toBe(0)
  })
  it('today\'s value: judged LIVE — one read, and the live rule decides', async () => {
    h.rows = [iv('verified')]
    expect(await identityMarkShownOnCard(UNTOUCHED, IDENTITY_MARK_NOTICE_VERSION, NOW)).toBe(true)
    expect(h.reads).toBe(1)
  })
  it('⛔ NEVER DECIDES FROM THE CARD ALONE: a cache that still says shown after a lapse, a revocation, a rename or a hide shows nothing', async () => {
    h.rows = [iv('verified', { documentExpiresAt: new Date('2026-10-15T00:00:00+07:00') })] // lapsed at 00:00 today, before the 00:05 pass
    expect(await identityMarkShownOnCard(UNTOUCHED, IDENTITY_MARK_NOTICE_VERSION, NOW)).toBe(false)
    h.rows = [iv('revoked')]
    expect(await identityMarkShownOnCard(UNTOUCHED, IDENTITY_MARK_NOTICE_VERSION, NOW)).toBe(false)
    h.rows = [iv('verified')]
    expect(await identityMarkShownOnCard({ ...UNTOUCHED, fullName: 'Dr Anna Eriksson' }, IDENTITY_MARK_NOTICE_VERSION, NOW)).toBe(false)
    const before = h.reads
    // hidden: the card's value is not even enough for a read
    expect(await identityMarkShownOnCard(HIDDEN, IDENTITY_MARK_NOTICE_VERSION, NOW)).toBe(false)
    expect(h.reads).toBe(before)
  })
  it('reads on the client it is given', async () => {
    const tx = { identityVerification: { findMany: vi.fn(async () => [iv('verified')]) } }
    expect(await identityMarkShownOnCard(UNTOUCHED, IDENTITY_MARK_NOTICE_VERSION, NOW, tx as never)).toBe(true)
    expect(tx.identityVerification.findMany).toHaveBeenCalledTimes(1)
    expect(h.reads).toBe(0)
  })
})

describe('IDENTITY_MARK_TP_SELECT', () => {
  it('reads exactly the four columns the mark is decided from — the name and the hide\'s two — nothing private rides along', () => {
    expect(IDENTITY_MARK_TP_SELECT).toEqual({ profileId: true, fullName: true, identityMarkOn: true, identityMarkWithdrawnAt: true })
  })
})
