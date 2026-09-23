import { beforeEach, describe, expect, it, vi } from 'vitest'

// sanctionedProfilesSharingIdentity — the cross-account check a scam-hold RELEASE runs: is the person
// behind this account also behind another account that is held or suspended? (src/lib/scam-hold.ts)

type Row = Record<string, any>
const h = vi.hoisted(() => ({ rows: [] as Row[], profiles: {} as Record<string, string>, queries: [] as Row[] }))

vi.mock('@/lib/db', () => ({
  db: {
    identityVerification: {
      findMany: async (a: Row) => {
        h.queries.push(a)
        const w = a.where
        return h.rows.filter((r) => {
          if (w.profileId !== undefined && typeof w.profileId === 'string' && r.profileId !== w.profileId) return false
          if (w.subjectHash?.in && !w.subjectHash.in.includes(r.subjectHash)) return false
          // Postgres `profileId <> $1` is NULL (dropped) for a NULL profileId.
          if (w.profileId?.not !== undefined && (r.profileId == null || r.profileId === w.profileId.not)) return false
          const states = w.profile?.is?.enforcementState?.in
          if (states && !states.includes(h.profiles[r.profileId] ?? 'good_standing')) return false
          return true
        })
      },
    },
  },
}))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, cache: (fn: unknown) => fn }
})

const { sanctionedProfilesSharingIdentity } = await import('./identity')

const row = (profileId: string | null, subjectHash: string, status = 'verified') => ({ profileId, subjectHash, status })

beforeEach(() => { h.rows = []; h.profiles = {}; h.queries = [] })

describe('sanctionedProfilesSharingIdentity', () => {
  it('names another HELD or SUSPENDED account carrying the same identity subject', async () => {
    h.rows = [row('me', 'H1'), row('other-held', 'H1', 'rejected'), row('other-susp', 'H1', 'revoked')]
    h.profiles = { 'other-held': 'held', 'other-susp': 'suspended' }
    expect((await sanctionedProfilesSharingIdentity('me')).sort()).toEqual(['other-held', 'other-susp'])
  })

  it('ignores accounts in good standing, throttled or warned — only a sanction blocks a release', async () => {
    h.rows = [row('me', 'H1'), row('a', 'H1'), row('b', 'H1'), row('c', 'H1')]
    h.profiles = { a: 'good_standing', b: 'throttled', c: 'warned' }
    expect(await sanctionedProfilesSharingIdentity('me')).toEqual([])
  })

  it('reads EVERY row of this profile — a rejected upload is still the same document', async () => {
    h.rows = [row('me', 'H-old', 'rejected'), row('me', 'H-new'), row('twin', 'H-old', 'pending')]
    h.profiles = { twin: 'held' }
    expect(await sanctionedProfilesSharingIdentity('me')).toEqual(['twin'])
  })

  it('never reports the profile itself, and an erased (profile-less) row is nobody', async () => {
    h.rows = [row('me', 'H1'), row('me', 'H1', 'expired'), row(null, 'H1')]
    h.profiles = { me: 'held' }
    expect(await sanctionedProfilesSharingIdentity('me')).toEqual([])
  })

  it('no verification history → [] with ONE read', async () => {
    expect(await sanctionedProfilesSharingIdentity('me')).toEqual([])
    expect(h.queries).toHaveLength(1)
  })

  it('the second read selects profile ids only — the subject hash never leaves the module', async () => {
    h.rows = [row('me', 'H1'), row('x', 'H1')]
    h.profiles = { x: 'held' }
    await sanctionedProfilesSharingIdentity('me')
    expect(h.queries[1].select).toEqual({ profileId: true })
  })
})
