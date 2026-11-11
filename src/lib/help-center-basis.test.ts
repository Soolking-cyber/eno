import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Help Center's business-review cards carry Review.basis (spec v3 A1, 2026-11-11): a review of a seller-confirmed
 * rental / lesson / service is badged "Confirmed …" (help-center.tsx), never "Verified buyer". The read uses the
 * storefront's missing-column fallback: before scripts/deal-confirmation-ddl.mjs adds the column, the same read without
 * it answers, and every card reads as before.
 */
type Row = Record<string, any>
const h = vi.hoisted(() => ({ rows: [] as Row[], basisMissing: false, selects: [] as Row[] }))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => null, getCurrentProfileId: async () => null }))
vi.mock('@/lib/db', () => ({
  db: {
    forumPost: { findMany: async () => [] },
    review: {
      findMany: async ({ select }: { select: Row }) => {
        h.selects.push(select)
        if (select.basis && h.basisMissing) throw Object.assign(new Error('column Review.basis does not exist'), { code: 'P2022' })
        return h.rows.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k] ?? null])))
      },
    },
  },
}))

import { loadHelpCenter } from './help-center-data'

const seller = { name: 'Shop', avatarUrl: null, avatarColor: '#111', verified: false, verifiedSeller: false, owner: null }
const at = new Date('2026-11-01T00:00:00.000Z')
beforeEach(() => {
  h.basisMissing = false; h.selects = []
  h.rows = [
    { id: 'r1', sellerId: 's1', rating: 5, text: 'Great room', author: 'An', authorProfileId: 'p1', conversationId: 'c1', createdAt: at, basis: 'rental', seller },
    { id: 'r2', sellerId: 's1', rating: 4, text: 'Good bike', author: 'Dung', authorProfileId: 'p2', conversationId: 'c2', createdAt: at, basis: null, seller },
    { id: 'r3', sellerId: 's1', rating: 3, text: 'Seeded', author: 'Seed', authorProfileId: null, conversationId: null, createdAt: at, basis: 'lesson', seller },
  ]
})

describe('loadHelpCenter — review basis', () => {
  it('a conversation-backed basis review carries its kind; a goods review and an unverified row carry none', async () => {
    const { reviews } = await loadHelpCenter()
    expect(reviews.map((r) => [r.id, r.verifiedBuyer, r.basis])).toEqual([['r1', true, 'rental'], ['r2', true, null], ['r3', false, null]])
    expect(h.selects).toHaveLength(1)
    expect(h.selects[0]!.basis).toBe(true)
  })

  it('⛔ no Review.basis column yet: the same read without it — every badge as before, no failure', async () => {
    h.basisMissing = true
    const { reviews } = await loadHelpCenter()
    expect(reviews.map((r) => [r.id, r.verifiedBuyer, r.basis])).toEqual([['r1', true, null], ['r2', true, null], ['r3', false, null]])
    expect(h.selects).toHaveLength(2)
    expect(h.selects[1]).not.toHaveProperty('basis')
  })
})
