import { describe, expect, it, vi, beforeEach } from 'vitest'

// ⚠️ THIS PREDICATE WAIVES TWO SPAM GATES (the probation listing cap and the duplicate guard), so
// the tests that matter are the ones proving it says NO. The desk exclusion in particular is not
// decoration: it replaced an `edition-lint` ALLOW entry that three review families rejected,
// on the grounds that a file-path exemption is permanent while the reason attached to it is only
// true of today's code. If the exclusion is ever removed, these tests are what should stop it.

const h: { services: boolean; deskIds: string[]; deskThrows: Error | null; sellersById: Record<string, unknown>; lastId: string | null } = {
  services: false,
  deskIds: ['desk-1'],
  deskThrows: null,
  sellersById: {},
  lastId: null,
}

vi.mock('server-only', () => ({}))
vi.mock('./edition', () => ({
  get IS_SERVICES() { return h.services },
  get IS_MARKETPLACE() { return !h.services },
}))
vi.mock('./edition-scope', () => ({
  deskSellerIds: async () => {
    if (h.deskThrows) throw h.deskThrows
    return h.deskIds
  },
}))
// ⚠️ THE MOCK HONOURS THE `where.id`, AND IT HAS TO. The first version returned the same fixture
// for every id, which made the services-build test a FALSE POSITIVE — it passed because the
// fixture was a partner, not because the requested id was ever looked up. Two reviewers caught it
// independently. Now an id with no fixture behaves like a missing row.
vi.mock('./db', () => ({
  db: {
    seller: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        h.lastId = where.id
        return h.sellersById[where.id] ?? null
      },
    },
  },
}))
// react's cache() memoises per request; outside one it would freeze the first fixture.
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: (f: unknown) => f }))

const { isVerifiedCatalogueSeller } = await import('./catalogue-seller')

const partner = { officialPartner: true, name: 'VietKite', legalName: null, legalAddress: null, idNumber: null, taxCode: null, taxCheckedAt: null, taxRegisteredName: null, taxActive: null, verifiedIdentityHash: null, verifiedUntil: null }

beforeEach(() => {
  h.services = false
  h.deskIds = ['desk-1']
  h.deskThrows = null
  h.lastId = null
  // Both rows are official partners on purpose: the ONLY thing that may separate them is the desk
  // exclusion, so a test that passes for the wrong reason has nowhere to hide.
  h.sellersById = { vietkite: partner, 'desk-1': { ...partner, name: 'eno desk' } }
})

describe('isVerifiedCatalogueSeller', () => {
  it('exempts an official partner that is not a desk', async () => {
    expect(await isVerifiedCatalogueSeller('vietkite')).toBe(true)
  })

  it('NEVER exempts a services desk on the marketplace build', async () => {
    // The whole point of the exclusion: on eno.vn this function cannot answer a question about a
    // desk seller at all — not even the boolean, which reviewers correctly called an oracle.
    expect(await isVerifiedCatalogueSeller('desk-1')).toBe(false)
  })

  it('DOES exempt the desk on the services build, where it is the storefront posting', async () => {
    h.services = true
    expect(await isVerifiedCatalogueSeller('desk-1')).toBe(true)
    // Proves the id actually reached the query rather than a blanket fixture answering for it.
    expect(h.lastId).toBe('desk-1')
  })

  it('fails CLOSED when desk resolution THROWS', async () => {
    // The answer is unknown, so the exemption is withheld and the full guard applies. Returning
    // false rather than rethrowing is also what stops a database blip 500-ing a legitimate post:
    // both callers are publish-path gates and one has no try/catch of its own.
    h.deskThrows = new Error('connection reset')
    expect(await isVerifiedCatalogueSeller('vietkite')).toBe(false)
  })

  it('CARRIES ON when the desk list is legitimately empty', async () => {
    // ⚠️ THE OPPOSITE OF THE THROW, AND THE FIRST VERSION GOT IT WRONG. `deskSellerIds()` returns
    // [] when the query succeeded and matched nothing — a renamed desk row or a misconfigured
    // owner email. Failing closed there stripped the exemption from EVERY partner at once, and
    // they would have met the probation cap and the duplicate guard with a spam-shaped error and
    // no server-side signal. An empty list means there is nothing to exclude, not that the answer
    // is unknown; no desk CONTENT can surface through a boolean either way.
    h.deskIds = []
    expect(await isVerifiedCatalogueSeller('vietkite')).toBe(true)
  })

  it('does not exempt a seller that is neither a partner nor registry-verified', async () => {
    h.sellersById.someone = { ...partner, officialPartner: false }
    expect(await isVerifiedCatalogueSeller('someone')).toBe(false)
  })

  it('does not exempt an unknown seller id', async () => {
    expect(await isVerifiedCatalogueSeller('nobody')).toBe(false)
  })
})
