import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MESSAGE_KINDS, isTripCardKind } from '@/lib/messages'
import { scrubTripConciergeQuestion, tripConciergePrompt, TRIP_CONCIERGE_QUESTION_MAX, type TripConciergeGrounding } from './concierge'

/**
 * The pure half of the trip concierge. askTripConcierge itself needs a database, so what is pinned
 * here is the part that decides WHAT LEAVES OUR SERVER and what the model is allowed to claim.
 */

const grounding = (over: Partial<TripConciergeGrounding> = {}): TripConciergeGrounding => ({
  hasTrip: true, title: 'Ten days north to south', days: 10, destination: 'vietnam',
  status: 'ready', stops: ['Hanoi', 'Hue', 'Hoi An'], caseStatus: null, ...over,
})

describe('⚠️ scrubTripConciergeQuestion — what the model must never receive', () => {
  it.each([
    ['my passport is C1234567 can I use it', 'C1234567'],
    ['call me on +84 90 123 4567', '4567'],
    ['email me at traveller@example.com', 'traveller@example.com'],
  ])('removes identifying text from %s', (question, secret) => {
    expect(scrubTripConciergeQuestion(question)).not.toContain(secret)
  })

  it('leaves an ordinary question completely alone', () => {
    const q = 'Is three days enough for Hoi An and can I get there by train?'
    expect(scrubTripConciergeQuestion(q)).toBe(q)
  })

  it('is bounded, so a pasted essay cannot become the prompt', () => {
    expect(scrubTripConciergeQuestion('a'.repeat(5_000))).toHaveLength(TRIP_CONCIERGE_QUESTION_MAX)
  })
})

describe('tripConciergePrompt', () => {
  it('grounds the answer in the traveller’s actual trip', () => {
    const prompt = tripConciergePrompt(grounding(), 'How long in Hue?', 'en')
    expect(prompt).toContain('Ten days north to south')
    expect(prompt).toContain('Hanoi → Hue → Hoi An')
    expect(prompt).toContain('How long in Hue?')
  })

  it('says plainly when there is no trip yet, rather than inventing one', () => {
    // The chip is available before anything is planned, so this is a normal state, not an edge.
    const prompt = tripConciergePrompt(grounding({ hasTrip: false }), 'Where should I go?', 'en')
    expect(prompt).toContain('has not built or saved a trip yet')
    expect(prompt).not.toContain('Ten days north to south')
  })

  it.each([
    ['NEVER invent a price'],
    ['NEVER claim to have booked'],
    ['not a visa adviser'],
  ])('always carries the "%s" rule', (rule) => {
    expect(tripConciergePrompt(grounding(), 'q', 'en')).toContain(rule)
  })

  it('asks for the traveller’s own language', () => {
    expect(tripConciergePrompt(grounding(), 'q', 'vi')).toContain('Answer in Vietnamese.')
    expect(tripConciergePrompt(grounding(), 'q', 'en')).toContain('Answer in English.')
  })
})

describe('⚠️ the shared-desk gate — SOURCE-LEVEL, because losing it is a cross-desk bug', () => {
  // Same idiom as sync-pairs.test.ts: assert something about the FILES, because what breaks here
  // is a missing predicate, not a wrong value — and it cannot be reached without a database.
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8')

  it.each([
    ['lib/trips/concierge.ts'],
    ['app/api/trips/help/route.ts'],
  ])('%s gates on the ANCHOR LISTING, not just the seller', (rel) => {
    // ⚠️ WHY THIS EXISTS. `Seller.ownerId` is @unique, so the e-Visa desk and the trip desk are ONE
    // storefront sharing one sellerProfileId. A `sellerProfileId === desk.ownerId` check therefore
    // passes on a VISA thread too, and the first cut of both files had only that — a traveller
    // could have pointed the trip assistant at their own government-form thread. The listingId is
    // the only thing that tells the two desks apart.
    const src = read(rel)
    expect(src).toContain('getTripAssistanceListingId')
    expect(src).toMatch(/convo\.listingId !== anchorListingId/)
  })
})

describe('⚠️ trip_help is the "a person was asked for" state', () => {
  it('is a real message kind, so insertMessage accepts it', () => {
    // insertMessage throws message_kind_invalid on anything outside this list.
    expect(MESSAGE_KINDS).toContain('trip_help')
  })

  it('is NOT a card kind — it carries no metaJson and renders as plain text', () => {
    // If it ever became a card, buildTripCardMeta would demand an assistance request, and the
    // no-itinerary branch of /api/trips/help — the whole reason the chip is always available —
    // would start failing.
    expect(isTripCardKind('trip_help')).toBe(false)
  })
})
