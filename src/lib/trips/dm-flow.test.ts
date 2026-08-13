import { beforeEach, describe, expect, it, vi } from 'vitest'

// Card posting. The properties worth pinning are all about what this layer CANNOT do: nominate an
// author, carry an amount, create a binding, or post an announcement over a human operator.

const h = vi.hoisted(() => ({
  state: {
    admin: null as string | null,
    thread: null as { conversationId: string; buyerProfileId: string; deskProfileId: string } | null,
    convo: null as Record<string, unknown> | null,
    mode: 'auto' as 'auto' | 'human',
    sent: [] as Array<{ convo: any; senderId: string; text: string; opts: any }>,
    insertThrows: null as string | null,
  },
}))

// The gate moved to the SCOPED desk operator (see src/lib/desk-operator.ts) so a partner running
// the trip desk does not need ADMIN_EMAILS. Same flag, same assertions.
vi.mock('../desk-operator', () => ({
  getTripDeskOperator: async () => h.state.admin,
  getVisaDeskOperator: async () => h.state.admin,
}))
vi.mock('../admin', () => ({ getAdmin: async () => h.state.admin }))
vi.mock('./dm-thread', () => ({
  findTripThread: async () => h.state.thread,
  tripDeskMode: async () => h.state.mode,
}))
vi.mock('../messages', () => ({
  insertMessage: async (convo: any, senderId: string, text: string, opts: any) => {
    if (h.state.insertThrows) throw new Error(h.state.insertThrows)
    h.state.sent.push({ convo, senderId, text, opts })
    return { id: 'msg-1' }
  },
}))
vi.mock('../db', () => ({
  db: { conversation: { findUnique: async () => h.state.convo } },
}))

import { announceTripStatus, sendTripQuoteCard } from './dm-flow'
// Derived from the ONE transition map, not re-listed: a status added there with no inbox line
// must fail these tests rather than silently announce nothing.
import { TRIP_TRANSITIONS } from './status'

const ALL_STATUSES = Object.keys(TRIP_TRANSITIONS)

const REQ = 'ckreq0000000000000000001'

beforeEach(() => {
  h.state.admin = 'ops@eno.vn'
  h.state.thread = { conversationId: 'convo-1', buyerProfileId: 'traveller', deskProfileId: 'desk-owner' }
  h.state.convo = { id: 'convo-1', buyerProfileId: 'traveller', sellerProfileId: 'desk-owner', listingId: 'L', visaApplicationId: null }
  h.state.mode = 'auto'
  h.state.sent = []
  h.state.insertThrows = null
})

describe('sendTripQuoteCard', () => {
  it('posts as the DESK, with no amount anywhere in the payload', async () => {
    expect(await sendTripQuoteCard({ requestId: REQ })).toEqual({ messageId: 'msg-1' })
    const call = h.state.sent[0]
    // The author is the thread's own sellerProfileId — never an argument.
    expect(call.senderId).toBe('desk-owner')
    expect(call.opts.kind).toBe('trip_quote')
    expect(call.opts.meta).toEqual({ v: 1, requestId: REQ })
    // Body empty (the card hydrates on refetch); the inbox line is the bilingual constant.
    expect(call.text).toBe('')
    expect(call.opts.preview).toBe('Báo giá chuyến đi của bạn · Your trip quote')
  })

  it('REFUSES without an admin session, even though its only caller already proved one', async () => {
    // Defence in depth, and the reason there is no forgeable `byAdmin` flag.
    h.state.admin = null
    expect(await sendTripQuoteCard({ requestId: REQ })).toBeNull()
    expect(h.state.sent).toHaveLength(0)
  })

  it('is NOT gated on desk mode — the operator IS the human', async () => {
    h.state.mode = 'human'
    expect(await sendTripQuoteCard({ requestId: REQ })).toEqual({ messageId: 'msg-1' })
  })
})

describe('announceTripStatus', () => {
  it('posts the announcement with its status and the matching inbox line', async () => {
    expect(await announceTripStatus({ requestId: REQ, status: 'arranging' })).toEqual({ messageId: 'msg-1' })
    const call = h.state.sent[0]
    expect(call.senderId).toBe('desk-owner')
    expect(call.opts.kind).toBe('trip_status')
    expect(call.opts.meta).toEqual({ v: 1, requestId: REQ, status: 'arranging' })
    expect(call.opts.preview).toBe('Đang sắp xếp · Arranging your trip')
  })

  it('SKIPS the automated card when a human has taken the case over', async () => {
    // The whole reason tripDeskMode exists: a generated card must not land underneath somebody
    // mid-conversation.
    h.state.mode = 'human'
    expect(await announceTripStatus({ requestId: REQ, status: 'arranging' })).toBeNull()
    expect(h.state.sent).toHaveLength(0)
  })

  it('needs no admin session — its safety comes from the card write re-asserting the status', async () => {
    // A traveller's own accept/decline should announce itself.
    h.state.admin = null
    expect(await announceTripStatus({ requestId: REQ, status: 'declined' })).toEqual({ messageId: 'msg-1' })
  })

  it('REFUSES a status with no reviewed inbox line rather than inventing one', async () => {
    // lastMessageText is plaintext and read by both parties; an interpolated or unreviewed string
    // must never reach it.
    expect(await announceTripStatus({ requestId: REQ, status: 'refunded' })).toBeNull()
    expect(h.state.sent).toHaveLength(0)
  })

  it('has a preview for every status the machine can reach', async () => {
    expect(ALL_STATUSES).toHaveLength(8)
    for (const status of ALL_STATUSES) {
      h.state.sent = []
      expect(await announceTripStatus({ requestId: REQ, status })).not.toBeNull()
    }
  })

  it('never interpolates — no preview carries a digit or an id', async () => {
    // A cheap structural proof that no itinerary title, city, name or amount can reach the column.
    for (const status of ALL_STATUSES) {
      h.state.sent = []
      await announceTripStatus({ requestId: REQ, status })
      const preview = h.state.sent[0].opts.preview as string
      expect(preview).not.toMatch(/\d/)
      expect(preview).not.toContain(REQ)
    }
  })
})

describe('what this layer refuses to do', () => {
  it('does NOT bind — an unbound case yields null instead of a thread appearing', async () => {
    h.state.thread = null
    expect(await sendTripQuoteCard({ requestId: REQ })).toBeNull()
    expect(await announceTripStatus({ requestId: REQ, status: 'quoted' })).toBeNull()
    expect(h.state.sent).toHaveLength(0)
  })

  it('refuses a thread with no desk profile', async () => {
    h.state.convo = { id: 'convo-1', buyerProfileId: 'traveller', sellerProfileId: null, listingId: 'L', visaApplicationId: null }
    expect(await sendTripQuoteCard({ requestId: REQ })).toBeNull()
  })

  it('refuses a vanished conversation', async () => {
    h.state.convo = null
    expect(await sendTripQuoteCard({ requestId: REQ })).toBeNull()
  })

  it('returns null — NOT a throw — when a card gate refuses the write', async () => {
    // The state change being announced has already committed. Throwing here would report a
    // completed transition as a failure and bait the operator into re-clicking.
    h.state.insertThrows = 'trip_card_conversation_mismatch'
    expect(await sendTripQuoteCard({ requestId: REQ })).toBeNull()
    expect(await announceTripStatus({ requestId: REQ, status: 'quoted' })).toBeNull()
  })
})
