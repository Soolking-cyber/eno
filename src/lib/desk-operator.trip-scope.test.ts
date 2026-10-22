import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE PER-REQUEST TRIP DESK GATE — `tripDeskOperatorFor` (security review 2026-10-22, item 31).
 *
 * desk-operator.test.ts pins WHO runs a desk. This pins the second half: that a desk operator acts only on the
 * requests its own desk answers. A request belongs to the desk whose Profile is the seller side of the request's
 * conversation; an admin keeps every request; everything unresolvable is refused.
 */

const h = vi.hoisted(() => ({
  email: null as string | null,
  adminList: ['boss@eno.vn'] as string[],
  /** The trip desk storefront's owner Profile id — null when the desk does not resolve. */
  deskProfileId: 'desk-gmbr' as string | null,
  /** requestId → its conversation id (null = never bound to a thread). */
  requests: {} as Record<string, string | null>,
  /** conversation id → the seller-side Profile id. */
  conversations: {} as Record<string, string>,
  lookups: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: h.email ? { email: h.email } : null } }) },
  }),
}))
vi.mock('@/lib/admin', () => ({
  isAdminEmail: (e: string | null | undefined) => !!e && h.adminList.includes(e.toLowerCase()),
}))
vi.mock('@/lib/visa-shop', () => ({ VISA_SHOP_OWNER_EMAILS: ['info@vietkite.com.vn'] }))
vi.mock('@/lib/trips/dm-thread', () => ({
  TRIP_DESK_OWNER_EMAILS: ['info@giacmobayre.com'],
  getTripDesk: async () => (h.deskProfileId ? { ownerId: h.deskProfileId } : null),
}))
vi.mock('@/lib/db', () => ({
  db: {
    tripAssistanceRequest: {
      findFirst: async (args: { where: { id: string } }) => {
        h.lookups++
        const conversationId = h.requests[args.where.id]
        return conversationId ? { conversationId } : null
      },
    },
    conversation: {
      findFirst: async (args: { where: { id: string; sellerProfileId: string } }) =>
        h.conversations[args.where.id] === args.where.sellerProfileId ? { id: args.where.id } : null,
    },
  },
}))

const { tripDeskOperatorFor } = await import('./desk-operator')

beforeEach(() => {
  h.email = null
  h.deskProfileId = 'desk-gmbr'
  h.requests = { 'ours': 'convo-ours', 'theirs': 'convo-theirs', 'unbound': null }
  h.conversations = { 'convo-ours': 'desk-gmbr', 'convo-theirs': 'desk-eno-support' }
  h.lookups = 0
})

describe('tripDeskOperatorFor', () => {
  it('the trip desk operator acts on a request its desk answers', async () => {
    h.email = 'info@giacmobayre.com'
    await expect(tripDeskOperatorFor('ours')).resolves.toBe('info@giacmobayre.com')
  })

  it('⛔ but not on one another desk answers — the hole item 31 closes', async () => {
    h.email = 'info@giacmobayre.com'
    await expect(tripDeskOperatorFor('theirs')).resolves.toBeNull()
  })

  it('⛔ nor on a request never bound to a thread, nor on an id that does not exist', async () => {
    h.email = 'info@giacmobayre.com'
    await expect(tripDeskOperatorFor('unbound')).resolves.toBeNull()
    await expect(tripDeskOperatorFor('no-such-request')).resolves.toBeNull()
  })

  it('an admin keeps every request, bound or not, without a lookup', async () => {
    h.email = 'boss@eno.vn'
    for (const id of ['ours', 'theirs', 'unbound']) await expect(tripDeskOperatorFor(id)).resolves.toBe('boss@eno.vn')
    expect(h.lookups).toBe(0)
  })

  it('⛔ a desk whose storefront does not resolve grants nothing — never an unscoped fallback', async () => {
    h.email = 'info@giacmobayre.com'
    h.deskProfileId = null
    await expect(tripDeskOperatorFor('ours')).resolves.toBeNull()
  })

  it('⛔ the visa desk, an ordinary user and a signed-out session get nothing', async () => {
    for (const email of ['info@vietkite.com.vn', 'someone@example.com', null]) {
      h.email = email
      await expect(tripDeskOperatorFor('ours')).resolves.toBeNull()
    }
  })
})
