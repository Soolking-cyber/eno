import { describe, expect, it } from 'vitest'
import { THREAD_HEADER_CLASS, isConversationPath, threadStripGates, type StripThread } from './thread-chrome'

/**
 * THE THREAD'S CHROME (UX program 2, A7). Which pages drop the site header on a phone, the header that then
 * owns the status-bar inset, and the item strip's gates — the landmine invariants of messages/[id]/page.tsx:
 * an offer entry point only where an offer can be made (`negotiable !== false`, buyer side, live listing),
 * and "Đã bán" only where a sale is the right word.
 */

describe('isConversationPath — only a real conversation id drops the site header', () => {
  // Prisma cuid() — 'c' + 24 lowercase letters / digits (the shape of every production Conversation.id).
  const ID = 'cmg8x0abc123def456ghi789j'

  it('a conversation id (Prisma cuid)', () => {
    expect(ID).toHaveLength(25)
    expect(isConversationPath(`/messages/${ID}`)).toBe(true)
    expect(isConversationPath(`/messages/${ID}/`)).toBe(true)
  })

  it('⛔ every sibling route keeps the site header — today\'s and any future one', () => {
    // Today's siblings under src/app/[lang]/messages/: the eno AI chat and the composer's resolver.
    expect(isConversationPath('/messages/ai')).toBe(false)
    expect(isConversationPath('/messages/ai/')).toBe(false)
    expect(isConversationPath('/messages/pending')).toBe(false)
    // A route added tomorrow is not a conversation just because it is not on a deny-list.
    for (const s of ['new', 'archived', 'requests', 'settings', 'conversationsettingspage']) {
      expect(isConversationPath(`/messages/${s}`)).toBe(false)
    }
  })

  it('not a near-miss id: wrong length, upper case, or a non-cuid fixture id', () => {
    expect(isConversationPath(`/messages/${ID.slice(0, 24)}`)).toBe(false)
    expect(isConversationPath(`/messages/${ID}x`)).toBe(false)
    expect(isConversationPath(`/messages/${ID.toUpperCase()}`)).toBe(false)
    expect(isConversationPath('/messages/e2e-conv-1')).toBe(false)
  })

  it('not the inbox, and not before the pathname is known', () => {
    expect(isConversationPath('/messages')).toBe(false)
    expect(isConversationPath('/messages/')).toBe(false)
    expect(isConversationPath(null)).toBe(false)
    expect(isConversationPath(undefined)).toBe(false)
  })
})

describe('THREAD_HEADER_CLASS — the inset the site header used to pad, below lg only', () => {
  it('0.75rem + max(0, inset − banner), both the env() and the old-Android-WebView paths', () => {
    expect(THREAD_HEADER_CLASS).toContain('py-3')
    expect(THREAD_HEADER_CLASS).toContain(
      'max-lg:pt-[calc(0.75rem+max(0px,calc(env(safe-area-inset-top)-var(--banner-h,0px)),calc(var(--safe-area-inset-top,0px)-var(--banner-h,0px))))]',
    )
  })

  it('⛔ never a document-level :has() (design-lint bans it)', () => {
    expect(THREAD_HEADER_CLASS).not.toMatch(/:has\(/)
  })
})

const listing = (over: Partial<NonNullable<StripThread['listing']>> = {}) => ({ negotiable: true, status: 'active', listingType: 'sell', ...over })
const buyer = (over: Partial<StripThread> = {}): StripThread => ({
  iAmSeller: false, kind: 'listing', teacher: null, sellerIsPartner: false, listing: listing(), messages: [{ mine: true }, { mine: false }], ...over,
})
const seller = (over: Partial<StripThread> = {}): StripThread => buyer({ iAmSeller: true, ...over })
// The marketplace edition by default (`productThreadStrip: false`) — the stricter of the two.
const gates = (t: StripThread | null, o: Partial<{ contactRevealed: boolean; showOffer: boolean; productThreadStrip: boolean }> = {}) =>
  threadStripGates(t, { contactRevealed: false, showOffer: false, productThreadStrip: false, ...o })

describe('the strip itself — ⛔ on the marketplace, ordinary listing threads only (legal boundary)', () => {
  it('an ordinary listing thread gets the strip on both editions', () => {
    expect(gates(buyer()).strip).toBe(true)
    expect(gates(buyer(), { productThreadStrip: true }).strip).toBe(true)
  })

  it('⛔ a visa or itinerary thread on the marketplace: no strip — and so no offer, contact or sold action from it', () => {
    for (const kind of ['visa', 'itinerary']) {
      const g = gates(buyer({ kind }))
      expect(g.strip).toBe(false)
      expect(g.offer).toBe(false)
      expect(g.contact).toBe(false)
      expect(gates(seller({ kind })).sold).toBe(false)
    }
  })

  it('the services edition, where the desks are legitimate, keeps the strip on a desk thread', () => {
    expect(gates(buyer({ kind: 'visa' }), { productThreadStrip: true }).strip).toBe(true)
  })

  it('no listing, no strip — on either edition', () => {
    expect(gates(buyer({ listing: null }), { productThreadStrip: true }).strip).toBe(false)
  })
})

describe('"Trả giá" in the strip — only where an offer can be made', () => {
  it('a buyer on a live listing that takes offers', () => {
    expect(gates(buyer()).offer).toBe(true)
    // An older cached payload with no `negotiable` is allowed — the server still refuses a fixed price.
    expect(gates(buyer({ listing: listing({ negotiable: undefined }) })).offer).toBe(true)
  })

  it('⛔ never on a fixed-price listing (the server 409s and docks the buyer\'s trust)', () => {
    expect(gates(buyer({ listing: listing({ negotiable: false }) })).offer).toBe(false)
  })

  it('⛔ never on the seller\'s side', () => {
    expect(gates(seller()).offer).toBe(false)
  })

  it('⛔ never on a listing that is no longer live (409 listing_unavailable)', () => {
    for (const status of ['sold', 'hidden', 'expired', 'stale']) {
      expect(gates(buyer({ listing: listing({ status }) })).offer).toBe(false)
    }
  })

  it('never without a listing (support, the rental desk)', () => {
    expect(gates(buyer({ listing: null })).offer).toBe(false)
    expect(gates(null).offer).toBe(false)
  })
})

describe('the composer tag — hidden only while the strip offers (or the listing cannot take one)', () => {
  it('while the strip carries "Trả giá", the tag is only the way back OUT of offer mode', () => {
    expect(gates(buyer()).composerTag).toBe(false)
    expect(gates(buyer(), { showOffer: true }).composerTag).toBe(true)
  })

  it('the seller keeps it on a live listing that takes offers, as before the strip', () => {
    expect(gates(seller()).composerTag).toBe(true)
  })

  it('⛔ not on a listing that is no longer live — only to leave offer mode', () => {
    expect(gates(buyer({ listing: listing({ status: 'sold' }) })).composerTag).toBe(false)
    expect(gates(seller({ listing: listing({ status: 'hidden' }) })).composerTag).toBe(false)
    expect(gates(buyer({ listing: listing({ status: 'sold' }) }), { showOffer: true }).composerTag).toBe(true)
  })

  it('⛔ never on a fixed-price listing, and never without a listing (`undefined !== false` is TRUE)', () => {
    expect(gates(buyer({ listing: listing({ negotiable: false }) })).composerTag).toBe(false)
    expect(gates(seller({ listing: listing({ negotiable: false }) })).composerTag).toBe(false)
    expect(gates(buyer({ listing: null }), { showOffer: true }).composerTag).toBe(false)
  })
})

describe('"Đã bán" in the strip — only where a sale is the right word', () => {
  it('the seller, on an ordinary listing thread, while it is on sale', () => {
    expect(gates(seller()).sold).toBe(true)
  })

  it('⛔ never the buyer', () => {
    expect(gates(buyer()).sold).toBe(false)
  })

  it('⛔ only `kind === \'listing\'` — never a desk, never a cached payload with no kind', () => {
    for (const kind of ['visa', 'itinerary', 'support', null, undefined]) {
      expect(gates(seller({ kind })).sold).toBe(false)
    }
  })

  it('⛔ never a job or a teacher profile (a job is not a sale)', () => {
    expect(gates(seller({ listing: listing({ listingType: 'job' }) })).sold).toBe(false)
    expect(gates(seller({ listing: listing({ listingType: 'teacher' }) })).sold).toBe(false)
  })

  it('only while active — and not when the status is unknown', () => {
    expect(gates(seller({ listing: listing({ status: 'sold' }) })).sold).toBe(false)
    expect(gates(seller({ listing: listing({ status: undefined }) })).sold).toBe(false)
  })
})

describe('the contact chip — the reveal while it is still a button', () => {
  it('a buyer whose seller has replied, nothing revealed yet', () => {
    expect(gates(buyer()).contact).toBe(true)
  })

  it('not before the seller replies, not once revealed, not for the seller', () => {
    expect(gates(buyer({ messages: [{ mine: true }] })).contact).toBe(false)
    expect(gates(buyer(), { contactRevealed: true }).contact).toBe(false)
    expect(gates(seller()).contact).toBe(false)
  })

  it('never to an official partner (chat-only by agreement), on a teacher thread, or a payload that predates `teacher`', () => {
    expect(gates(buyer({ sellerIsPartner: true })).contact).toBe(false)
    expect(gates(buyer({ teacher: { shared: false } })).contact).toBe(false)
    expect(gates(buyer({ teacher: undefined })).contact).toBe(false)
  })
})
