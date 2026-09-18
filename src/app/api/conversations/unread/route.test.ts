import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE BADGE COUNTS WHAT THE INBOX SHOWS — NOTHING ELSE.
 *
 * Owner, 2026-09-18, signed in to eno.vn as the support account: "has 1 message but when clicked no
 * new messages there is an error somewhere". The inbox hides a conversation the viewer deleted (until
 * a newer message arrives) and the badge did not, so a deleted-but-unread thread was a permanent
 * phantom: a number with nothing behind it.
 *
 * ⚠️ THESE ASSERT THE `where` THE ROUTE SENDS, not a database's behaviour. The predicate is a
 * field-to-field comparison Prisma runs in SQL (`lastMessageAt > …DeletedAt`), which a hand-rolled
 * mock cannot evaluate honestly — so the test pins the QUESTION asked, per role, which is the half
 * that regressed. The inbox's own filter is JS and is covered by its own suite.
 */
const h = { admin: false as boolean, calls: [] as { where: Record<string, unknown> }[] }

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: () => Promise.resolve('me'),
  /* ⚠️ THE CLAIMS ORACLE, NOT `getAdmin()` — the two endpoints that must agree now ask the same
     question the same way. This route used the auth-server call and the 45s poll used the JWT, so a
     just-promoted operator saw one badge count the desk and the other not. */
  isCurrentUserAdminByClaims: () => Promise.resolve(h.admin),
}))
/** A recognisable stand-in for the real fragment, so a test can prove it reached the `where`. */
const SCOPE = { sellerId: { notIn: ['desk-seller'] } }
vi.mock('@/lib/edition-scope', () => ({ editionSellerScope: async () => SCOPE }))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support-seller' }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      aggregate: (args: { where: Record<string, unknown> }) => {
        h.calls.push(args)
        return Promise.resolve({ _sum: { buyerUnread: 1, sellerUnread: 1 } })
      },
      // Prisma exposes field references here; the route uses them for the delete comparison.
      fields: { buyerDeletedAt: { _ref: 'buyerDeletedAt' }, sellerDeletedAt: { _ref: 'sellerDeletedAt' } },
    },
  },
}))

const run = async () => {
  const { GET } = await import('./route')
  const res = await GET()
  return res.json() as Promise<{ unread: number }>
}

/**
 * ⚠️ THE VIEWER'S OWN BRANCHES COMPOSE WITH `AND`, THE DESK BRANCH DOES NOT — so the predicate is
 * read out of whichever shape the branch uses. That is not incidental tidying: a spread would let
 * the delete filter's `OR` key silently swallow an `OR` returned by `editionSellerScope()`, which is
 * the same collision the desk branch's `sellerId` documents. These helpers look through the `AND` so
 * the assertions below pin the predicate rather than the nesting.
 */
const conj = (where: Record<string, unknown>): Record<string, unknown>[] =>
  (where.AND as Record<string, unknown>[] | undefined) ?? [where]

const deletedClause = (where: Record<string, unknown>) => {
  const holder = conj(where).find((c) => Array.isArray(c.OR))
  return (holder?.OR as { buyerDeletedAt?: null; sellerDeletedAt?: null; lastMessageAt?: unknown }[] | undefined) ?? []
}

/** Flatten a branch's conjuncts into one object, for assertions that only care about a key. */
const flat = (where: Record<string, unknown>) => Object.assign({}, ...conj(where)) as Record<string, unknown>

describe('the unread badge', () => {
  beforeEach(() => { h.calls = []; h.admin = false; vi.resetModules() })

  it('asks only for threads the viewer has not deleted — per role', async () => {
    await run()
    const [buyer, seller] = h.calls
    // The buyer's side is judged by the BUYER's delete, the seller's by the seller's.
    expect(deletedClause(buyer.where)[0]).toHaveProperty('buyerDeletedAt', null)
    expect(deletedClause(seller.where)[0]).toHaveProperty('sellerDeletedAt', null)
    // …and a message newer than the delete brings the thread (and its count) back.
    expect(deletedClause(buyer.where)[1]).toHaveProperty('lastMessageAt')
    expect(deletedClause(seller.where)[1]).toHaveProperty('lastMessageAt')
  })

  it('applies the same rule to the support desk an operator reads', async () => {
    h.admin = true
    await run()
    expect(h.calls).toHaveLength(3)
    const support = h.calls[2]
    expect(flat(support.where)).toHaveProperty('sellerId', 'support-seller')
    expect(deletedClause(support.where)[0]).toHaveProperty('sellerDeletedAt', null)
  })

  it('leaves the desk out entirely for a non-operator', async () => {
    await run()
    expect(h.calls).toHaveLength(2)
    expect(h.calls.some((c) => flat(c.where).sellerId === 'support-seller')).toBe(false)
  })

  /**
   * ⛔ THE HALF THAT ACTUALLY REACHED THE OWNER. eno.vn hides the visa/trip desk by law, so a count
   * that skips `editionSellerScope()` counts threads the inbox is forbidden to show — badge 1, inbox
   * empty, unclearable. `/api/notifications` shipped exactly that for months while THIS route was
   * correct, which is why the sum now lives in one module both routes call.
   */
  it("applies the edition's hide-list to both of the viewer's own roles", async () => {
    await run()
    const [buyer, seller] = h.calls
    expect(conj(buyer.where)).toContainEqual(SCOPE)
    expect(conj(seller.where)).toContainEqual(SCOPE)
  })

  /**
   * ⚠️ AND NOT TO THE DESK BRANCH — naming `SUPPORT_SELLER_ID` IS the edition scope there, and a
   * spread would silently overwrite it on the `sellerId` key (the trap edition-scope.ts documents).
   */
  it('does not let the hide-list overwrite the desk branch', async () => {
    h.admin = true
    await run()
    expect(flat(h.calls[2].where).sellerId).toBe('support-seller')
  })

  /**
   * ⛔ THE THREE AGGREGATES ARE SUMMED, SO THEY MUST NOT OVERLAP. Two independent reviewers, twice,
   * reported the support operator's badge doubling — the desk branch matching `sellerId` and the
   * seller branch matching `sellerProfileId` on the SAME row. support-thread.ts says a desk thread's
   * `sellerProfileId` is always null, which would make the overlap impossible; this pins the
   * belt-and-braces clause instead, because the day that invariant breaks nothing else would notice.
   */
  it('never counts a desk thread through the viewer\'s own seller role', async () => {
    h.admin = true
    await run()
    /* ⚠️ `conj`, NOT `flat` — the seller branch carries TWO `sellerId` conjuncts (the edition's
       `notIn` and this `not`), and flattening drops one of them on the shared key. That the helper
       loses it is the same hazard, in a test, that `AND` exists to avoid in the query. */
    expect(conj(h.calls[1].where)).toContainEqual({ sellerId: { not: 'support-seller' } })
  })
})
