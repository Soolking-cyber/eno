import { beforeEach, describe, expect, it, vi } from 'vitest'

// dm-thread is the ONLY file allowed to create a binding, so these tests are mostly about the
// ways a binding must REFUSE to come into existence. The three rules being pinned:
//   1. no function here takes a sender — the desk identity is resolved, never supplied
//   2. ownership is proven before the binding is written
//   3. mode is derived from the newest event, not stored

const h = vi.hoisted(() => ({
  state: {
    desk: { id: 'desk-seller', ownerId: 'desk-owner', name: 'eno trips' } as { id: string; ownerId: string | null; name: string } | null,
    deskThrows: false,
    listingId: 'listing-anchor' as string | null,
    requests: {} as Record<string, { id: string; profileId: string; conversationId: string | null }>,
    conversations: {} as Record<string, { id: string; listingId: string; buyerProfileId: string; sellerProfileId: string | null }>,
    // Simulates another tab winning the binding race: the CAS matches zero rows.
    casLoses: false,
    casWinnerConversationId: null as string | null,
    createThrowsP2002: false,
    created: [] as Array<Record<string, unknown>>,
    modeEvent: null as { event: string } | null,
    modeThrows: false,
    captureCasWhere: null as null | ((w: unknown) => void),
  },
}))

// React's cache() would memoise across tests and make desk-state changes invisible.
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))

vi.mock('../db', () => ({
  db: {
    seller: {
      findFirst: async () => {
        if (h.state.deskThrows) throw new Error('db down')
        return h.state.desk
      },
    },
    listing: { findFirst: async () => (h.state.listingId ? { id: h.state.listingId } : null) },
    tripAssistanceRequest: {
      findUnique: async (args: any) => {
        const row = h.state.requests[args.where.id]
        if (!row) return null
        // Honour the narrow selects the code makes.
        return row
      },
      updateMany: async (args: any) => {
        h.state.captureCasWhere?.(args.where)
        // The binding CAS: WHERE id AND conversationId IS null.
        if (h.state.casLoses) {
          // Model the race HONESTLY: the row looked unbound at the initial read and is bound by
          // the time the CAS runs. Setting it up front instead would send the code down the
          // "already bound" branch and never exercise the compare-and-set at all.
          const row = h.state.requests[args.where.id]
          if (row && h.state.casWinnerConversationId) row.conversationId = h.state.casWinnerConversationId
          return { count: 0 }
        }
        const row = h.state.requests[args.where.id]
        if (!row) return { count: 0 }
        if (args.where.conversationId === null && row.conversationId !== null) return { count: 0 }
        if (args.where.profileId !== undefined && args.where.profileId !== row.profileId) return { count: 0 }
        row.conversationId = args.data.conversationId
        return { count: 1 }
      },
    },
    conversation: {
      // Handles BOTH where-shapes the code uses: by id, and by the composite unique
      // (listingId, buyerProfileId) that identifies a trip thread.
      findUnique: async (args: any) => {
        if (args.where.id) return h.state.conversations[args.where.id] ?? null
        const key = args.where.listingId_buyerProfileId
        if (!key) return null
        return Object.values(h.state.conversations).find(
          (c) => c.listingId === key.listingId && c.buyerProfileId === key.buyerProfileId,
        ) ?? null
      },
      create: async (args: any) => {
        if (h.state.createThrowsP2002) {
          // The winner's thread EXISTS by the time we lose the unique race — that is what makes
          // the post-P2002 re-read by the SAME key find something.
          h.state.conversations['convo-raced'] = {
            id: 'convo-raced', listingId: args.data.listingId,
            buyerProfileId: args.data.buyerProfileId, sellerProfileId: args.data.sellerProfileId,
          }
          throw Object.assign(new Error('unique'), { code: 'P2002' })
        }
        h.state.created.push(args.data)
        const id = 'convo-new'
        h.state.conversations[id] = {
          id, listingId: args.data.listingId,
          buyerProfileId: args.data.buyerProfileId, sellerProfileId: args.data.sellerProfileId,
        }
        return { id }
      },
    },
    tripAssistanceEvent: {
      findFirst: async () => {
        if (h.state.modeThrows) throw new Error('db down')
        return h.state.modeEvent
      },
    },
  },
}))

import { bindTripThread, findTripThread, getTripDesk, TRIP_DESK_OWNER_EMAILS, tripDeskMode } from './dm-thread'

const REQ = 'ckreq0000000000000000001'

beforeEach(() => {
  h.state.desk = { id: 'desk-seller', ownerId: 'desk-owner', name: 'eno trips' }
  h.state.deskThrows = false
  h.state.listingId = 'listing-anchor'
  h.state.requests = { [REQ]: { id: REQ, profileId: 'traveller', conversationId: null } }
  h.state.conversations = {}
  h.state.casLoses = false
  h.state.casWinnerConversationId = null
  h.state.createThrowsP2002 = false
  h.state.created = []
  h.state.modeEvent = null
  h.state.modeThrows = false
  h.state.captureCasWhere = null
})

describe('the desk identity', () => {
  it('is a LIST, lowercased and trimmed — pinning one address took the visa surface down', () => {
    expect(Array.isArray(TRIP_DESK_OWNER_EMAILS)).toBe(true)
    expect(TRIP_DESK_OWNER_EMAILS.length).toBeGreaterThan(0)
    for (const email of TRIP_DESK_OWNER_EMAILS) {
      expect(email).toBe(email.trim().toLowerCase())
      expect(email).not.toBe('')
    }
  })

  it('parses a comma-separated env into several addresses', async () => {
    vi.resetModules()
    vi.stubEnv('TRIP_DESK_OWNER_EMAIL', ' Support@ENO.forum , ops@eno.vn ,, ')
    const fresh = await import('./dm-thread')
    expect(fresh.TRIP_DESK_OWNER_EMAILS).toEqual(['support@eno.forum', 'ops@eno.vn'])
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is NOT a desk when the storefront is unclaimed — Seller.ownerId is nullable', async () => {
    h.state.desk = { id: 'desk-seller', ownerId: null, name: 'eno trips' }
    expect(await getTripDesk()).toBeNull()
  })

  it('fails soft on a lookup error rather than throwing into the caller', async () => {
    h.state.deskThrows = true
    expect(await getTripDesk()).toBeNull()
  })
})

describe('bindTripThread — ownership before binding', () => {
  it('REFUSES a case that is not the callers own', async () => {
    // Rule (2). The caller's identity comes from the session; this is the gate that stops one
    // traveller binding another's case to their own thread.
    const result = await bindTripThread({ requestId: REQ, buyerProfileId: 'somebody-else' })
    expect(result).toEqual({ ok: false, error: 'not_your_request' })
    expect(h.state.requests[REQ].conversationId).toBeNull()
  })

  it('REFUSES an unknown case', async () => {
    expect(await bindTripThread({ requestId: 'ckmissing', buyerProfileId: 'traveller' }))
      .toEqual({ ok: false, error: 'request_not_found' })
  })

  it('creates the thread and binds it, with the desk owner as the author identity', async () => {
    const result = await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' })
    expect(result).toEqual({ ok: true, conversationId: 'convo-new', created: true })
    // Rule (1): sellerProfileId comes from the resolved desk, never from an argument.
    expect(h.state.created[0]).toMatchObject({
      listingId: 'listing-anchor', buyerProfileId: 'traveller',
      sellerId: 'desk-seller', sellerProfileId: 'desk-owner',
    })
    expect(h.state.requests[REQ].conversationId).toBe('convo-new')
  })

  it('reuses the thread on the ANCHOR listing instead of creating a second one', async () => {
    h.state.conversations['convo-old'] = { id: 'convo-old', listingId: 'listing-anchor', buyerProfileId: 'traveller', sellerProfileId: 'desk-owner' }
    const result = await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' })
    expect(result).toEqual({ ok: true, conversationId: 'convo-old', created: false })
    expect(h.state.created).toHaveLength(0)
  })

  it('does NOT reuse the traveller’s VISA thread with the same desk account', async () => {
    // THE BUG BOTH REVIEWERS FOUND. The trip desk and the visa desk are one account, so a
    // lookup keyed on seller matched the traveller's newest visa thread and would have bound a
    // trip case to it — trip quote cards posted into a visa conversation, on a visa listing.
    // Keying on the anchor listing is what makes that impossible.
    h.state.conversations['convo-visa'] = { id: 'convo-visa', listingId: 'visa-product-listing', buyerProfileId: 'traveller', sellerProfileId: 'desk-owner' }
    const result = await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' })
    expect(result).toEqual({ ok: true, conversationId: 'convo-new', created: true })
    expect(h.state.created[0]).toMatchObject({ listingId: 'listing-anchor' })
  })

  it('REFUSES to reuse a thread the CURRENT desk does not own', async () => {
    // A reused thread keeps the sellerProfileId it was created with; if the desk account moved,
    // nobody the current desk controls can author in it.
    h.state.conversations['convo-stale'] = { id: 'convo-stale', listingId: 'listing-anchor', buyerProfileId: 'traveller', sellerProfileId: 'former-desk-owner' }
    expect(await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' }))
      .toEqual({ ok: false, error: 'thread_conflict' })
  })

  it('is DORMANT with no anchor listing — a Conversation cannot exist without one', async () => {
    h.state.listingId = null
    expect(await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' }))
      .toEqual({ ok: false, error: 'listing_unavailable' })
  })

  it('reports the desk unavailable rather than binding to nothing', async () => {
    h.state.desk = null
    expect(await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' }))
      .toEqual({ ok: false, error: 'desk_unavailable' })
  })
})

describe('bindTripThread — an existing binding is re-verified, not trusted', () => {
  it('returns the bound thread when its buyer really is the traveller', async () => {
    h.state.requests[REQ].conversationId = 'convo-bound'
    h.state.conversations['convo-bound'] = { id: 'convo-bound', listingId: 'listing-anchor', buyerProfileId: 'traveller', sellerProfileId: 'desk-owner' }
    expect(await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' }))
      .toEqual({ ok: true, conversationId: 'convo-bound', created: false })
  })

  it('REFUSES a stored binding whose thread belongs to someone else', async () => {
    // A corrupt pointer must not be honoured: answering it would hand this case to another
    // traveller's thread.
    h.state.requests[REQ].conversationId = 'convo-theirs'
    h.state.conversations['convo-theirs'] = { id: 'convo-theirs', listingId: 'listing-anchor', buyerProfileId: 'another-traveller', sellerProfileId: 'desk-owner' }
    expect(await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' }))
      .toEqual({ ok: false, error: 'thread_conflict' })
  })

  it('REFUSES a binding pointing at a thread that no longer exists', async () => {
    h.state.requests[REQ].conversationId = 'convo-gone'
    expect(await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' }))
      .toEqual({ ok: false, error: 'thread_conflict' })
  })
})

describe('bindTripThread — races', () => {
  it('adopts the winner when a concurrent bind got there first', async () => {
    // The CAS (WHERE conversationId IS NULL) matches zero rows; the loser must not overwrite.
    h.state.casLoses = true
    h.state.casWinnerConversationId = 'convo-winner'
    h.state.conversations['convo-winner'] = { id: 'convo-winner', listingId: 'listing-anchor', buyerProfileId: 'traveller', sellerProfileId: 'desk-owner' }
    const result = await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' })
    expect(result).toEqual({ ok: true, conversationId: 'convo-winner', created: false })
  })

  it('re-asserts OWNERSHIP in the bind compare-and-set, not just the null binding', async () => {
    // The ownership check is a read; without profileId in the WHERE a concurrent change between
    // it and the write could bind a case the caller no longer owns (codex).
    let seen: any = null
    h.state.captureCasWhere = (w: any) => { seen = w }
    await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' })
    expect(seen).toEqual({ id: REQ, conversationId: null, profileId: 'traveller' })
  })

  it('REFUSES an adopted winner binding that is not a valid desk thread', async () => {
    // The loser used to return winner.conversationId unverified. A zero-row CAS can also mean
    // the ownership predicate failed, so the adopted value is not trustworthy by itself.
    h.state.casLoses = true
    h.state.casWinnerConversationId = 'convo-someone-else'
    h.state.conversations['convo-someone-else'] = { id: 'convo-someone-else', listingId: 'listing-anchor', buyerProfileId: 'another-traveller', sellerProfileId: 'desk-owner' }
    expect(await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' }))
      .toEqual({ ok: false, error: 'thread_conflict' })
  })

  it('reports a conflict when the CAS loses and no winner is readable', async () => {
    h.state.casLoses = true
    expect(await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' }))
      .toEqual({ ok: false, error: 'thread_conflict' })
  })

  it('adopts the winner thread on a P2002 double-tap', async () => {
    // @@unique([listingId, buyerProfileId]) — two clicks, one thread.
    h.state.createThrowsP2002 = true
    const result = await bindTripThread({ requestId: REQ, buyerProfileId: 'traveller' })
    expect(result).toEqual({ ok: true, conversationId: 'convo-raced', created: false })
    expect(h.state.requests[REQ].conversationId).toBe('convo-raced')
  })
})

describe('findTripThread', () => {
  it('is null for an unbound case', async () => {
    expect(await findTripThread(REQ)).toBeNull()
  })

  it('is null when the thread has no seller profile — nobody could author a card in it', async () => {
    h.state.requests[REQ].conversationId = 'convo-unclaimed'
    h.state.conversations['convo-unclaimed'] = { id: 'convo-unclaimed', listingId: 'listing-anchor', buyerProfileId: 'traveller', sellerProfileId: null }
    expect(await findTripThread(REQ)).toBeNull()
  })

  it('returns both identities a card write needs', async () => {
    h.state.requests[REQ].conversationId = 'convo-bound'
    h.state.conversations['convo-bound'] = { id: 'convo-bound', listingId: 'listing-anchor', buyerProfileId: 'traveller', sellerProfileId: 'desk-owner' }
    expect(await findTripThread(REQ)).toEqual({
      conversationId: 'convo-bound', buyerProfileId: 'traveller', deskProfileId: 'desk-owner',
    })
  })
})

describe('tripDeskMode — derived, never stored', () => {
  it('is auto with no takeover event', async () => {
    expect(await tripDeskMode(REQ)).toBe('auto')
  })

  it('is human after a takeover started', async () => {
    h.state.modeEvent = { event: 'desk_takeover_started' }
    expect(await tripDeskMode(REQ)).toBe('human')
  })

  it('is auto again after the takeover ended', async () => {
    h.state.modeEvent = { event: 'desk_takeover_ended' }
    expect(await tripDeskMode(REQ)).toBe('auto')
  })

  it('falls back to auto for an event it does not recognise', async () => {
    // ?? 'auto', not a bare lookup — an unmapped event must not yield undefined.
    h.state.modeEvent = { event: 'something_new' }
    expect(await tripDeskMode(REQ)).toBe('auto')
  })

  it('falls back to auto on a lookup error', async () => {
    // The automated flow continuing beats the whole surface going silent.
    h.state.modeThrows = true
    expect(await tripDeskMode(REQ)).toBe('auto')
  })
})
