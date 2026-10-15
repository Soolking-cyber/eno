import { beforeEach, describe, expect, it, vi } from 'vitest'

// identityMarkFacts — the three facts the teacher's "Identity verified" mark is decided from (src/lib/teachers/
// identity-mark.ts). Pinned: the SAME derivation as every identity read (revoked outranks everything, a standing
// verification survives a later rejection, the document clock), a renewal in flight reads as `resubmitted`, the name is
// judged against the VERIFIED source row's carried decision input with the strict rule (never a split fullName), and
// only `{ status, resubmitted, name }` leaves — no tier, method, expiry or evidence.
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ rows: [] as Row[], calls: [] as Row[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: { identityVerification: { findMany: async (a: Row) => { h.calls.push({ client: 'db', ...a }); return h.rows } } },
}))
const { identityMarkFacts, NO_IDENTITY_MARK_FACTS } = await import('./identity')

const day = 86_400_000
const NOW = new Date('2026-10-16T10:00:00+07:00')
const di = (surname: string, givenNames: string) => ({ decisionInput: { surname, givenNames, documentExpiry: '2030-01-01', mrzValid: true, accountName: 'x' } })
let n = 0
const row = (profileId: string, status: string, over: Row = {}): Row => ({
  id: `iv-${++n}`, profileId, tier: 'B', method: 'passport_mrz', status,
  decidedAt: status === 'pending' ? null : new Date(NOW.getTime() - 30 * day),
  documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: 'manual_review',
  evidence: { ...di('ERIKSSON', 'ANNA MARIA'), documentPath: 'p/doc.webp', selfiePath: 'p/selfie.webp', checksPassed: ['mrz_checksums'] },
  ...over,
})
const facts = async (displayName = 'Anna Eriksson', profileId = 'p1') => (await identityMarkFacts([{ profileId, displayName }], NOW)).get(profileId)

beforeEach(() => { h.rows = []; h.calls = [] })

describe('identityMarkFacts — the derivation is the one every identity read uses', () => {
  it('a live verification whose name the shown one is within: verified, match', async () => {
    h.rows = [row('p1', 'verified')]
    expect(await facts()).toEqual({ status: 'verified', resubmitted: false, name: 'match' })
  })
  it('⛔ revoked outranks everything — a newer verified row included', async () => {
    h.rows = [row('p1', 'revoked', { decidedAt: new Date(NOW.getTime() - 60 * day) }), row('p1', 'verified')]
    expect((await facts())!.status).toBe('revoked')
  })
  it('a standing verification survives a later rejection — and the name comes from the VERIFIED row, not the rejected one', async () => {
    h.rows = [
      row('p1', 'verified', { decidedAt: new Date(NOW.getTime() - 60 * day) }),
      // the later, rejected submission carried another name: it is not evidence of anything
      row('p1', 'rejected', { decidedAt: new Date(NOW.getTime() - 5 * day), evidence: di('SCHMIDT', 'ANNA') }),
    ]
    expect(await facts('Anna Eriksson')).toEqual({ status: 'verified', resubmitted: false, name: 'match' })
    expect((await facts('Anna Schmidt'))!.name).toBe('mismatch')
  })
  it('the document clock: good through its expiry day (ICT), expired the day after; a CCCD with no expiry never lapses', async () => {
    h.rows = [row('p1', 'verified', { documentExpiresAt: new Date('2026-10-16T00:00:00+07:00') })]
    expect((await facts())!.status).toBe('verified')
    h.rows = [row('p1', 'verified', { documentExpiresAt: new Date('2026-10-15T00:00:00+07:00') })]
    expect(await facts()).toEqual({ status: 'expired', resubmitted: false, name: 'none' })
    h.rows = [row('p1', 'verified', { tier: 'A', method: 'cccd_manual', documentExpiresAt: null, evidence: di('Nguyễn', 'Thị Minh Khai') })]
    expect(await facts('Khai Nguyen')).toEqual({ status: 'verified', resubmitted: false, name: 'match' })
  })
  it('expired with a renewal pending: `resubmitted` — what the mark reads as "pending", not "expired"', async () => {
    h.rows = [row('p1', 'verified', { documentExpiresAt: new Date('2026-10-01T00:00:00+07:00') }), row('p1', 'pending')]
    expect(await facts()).toEqual({ status: 'expired', resubmitted: true, name: 'none' })
  })
  it('no row, only a pending one, or only a rejection: never `verified`, and no name is read', async () => {
    expect(await facts()).toEqual(NO_IDENTITY_MARK_FACTS)
    h.rows = [row('p1', 'pending')]
    expect(await facts()).toEqual({ status: 'pending', resubmitted: true, name: 'none' })
    h.rows = [row('p1', 'rejected')]
    expect(await facts()).toEqual({ status: 'rejected', resubmitted: false, name: 'none' })
  })
})

describe('identityMarkFacts — the name, judged strictly against the carried decision input', () => {
  it('⛔ a shown name that adds a word (a title, a middle name the document lacks) is a mismatch', async () => {
    h.rows = [row('p1', 'verified', { evidence: di('ERIKSSON', 'ANNA') })]
    expect((await facts('Dr Anna Eriksson'))!.name).toBe('mismatch')
    expect((await facts('Anna Maria Eriksson'))!.name).toBe('mismatch')
    expect((await facts('Anna Eriksson'))!.name).toBe('match')
  })
  it('\'none\' when the verified row carries no decision input, or an empty / filler-only surname — never a guess', async () => {
    for (const evidence of [null, {}, { decisionInput: null }, di('', 'ANNA'), di('<<<', 'ANNA'), { decisionInput: { surname: 42, givenNames: 'ANNA' } }]) {
      h.rows = [row('p1', 'verified', { evidence })]
      expect((await facts())!.name, JSON.stringify(evidence)).toBe('none')
    }
  })
  it('⛔ never splits the stored fullName into a surname (review.ts: VAN DER BILT became "BILT")', async () => {
    h.rows = [row('p1', 'verified', { evidence: {}, fullName: 'Anna Eriksson' })]
    expect((await facts('Anna Eriksson'))!.name).toBe('none')
  })
})

describe('identityMarkFacts — what it reads and what leaves', () => {
  it('ONE read for every entry, every row of each history (no status filter), and only the three keys come out', async () => {
    h.rows = [row('p1', 'verified'), row('p2', 'pending')]
    const out = await identityMarkFacts([{ profileId: 'p1', displayName: 'Anna Eriksson' }, { profileId: 'p2', displayName: 'Bo' }, { profileId: 'p3', displayName: 'Cy' }], NOW)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].where).toEqual({ profileId: { in: ['p1', 'p2', 'p3'] } })
    expect(h.calls[0].select).toMatchObject({ status: true, decidedAt: true, documentExpiresAt: true, evidence: true })
    expect([...out.keys()]).toEqual(['p1', 'p2', 'p3'])
    for (const f of out.values()) expect(Object.keys(f).sort()).toEqual(['name', 'resubmitted', 'status'])
    expect(out.get('p3')).toEqual(NO_IDENTITY_MARK_FACTS)
    // nothing of the document, the evidence or the row rides along
    const text = JSON.stringify([...out.values()])
    for (const leak of ['ERIKSSON', 'passport', 'doc.webp', 'iv-', '2030', 'manual_review', 'tier']) expect(text).not.toContain(leak)
  })
  it('the `client` parameter is the one read — a transaction judges inside itself', async () => {
    h.rows = []
    const tx = { identityVerification: { findMany: vi.fn(async () => [row('p1', 'verified')]) } }
    const out = await identityMarkFacts([{ profileId: 'p1', displayName: 'Anna Eriksson' }], NOW, tx as never)
    expect(tx.identityVerification.findMany).toHaveBeenCalledTimes(1)
    expect(h.calls).toEqual([]) // the default client was never touched
    expect(out.get('p1')).toEqual({ status: 'verified', resubmitted: false, name: 'match' })
  })
  it('asks nothing for no entries', async () => {
    expect((await identityMarkFacts([], NOW)).size).toBe(0)
    expect(h.calls).toEqual([])
  })
})
