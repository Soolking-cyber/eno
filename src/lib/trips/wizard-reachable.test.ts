import { describe, expect, it } from 'vitest'
import { tripWizardChip } from './itinerary-wizard'

/**
 * THE IN-CHAT PLANNER MUST ALWAYS HAVE A DOOR.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE WIZARD SHIPPED UNREACHABLE. `TripWizardLauncher` offered its chip
 * only while NO wizard was running — `canStart = eligible && step === null` — reasoning that a
 * running wizard renders its own card and a second entry point invites an accidental restart. Both
 * halves are true and the conclusion was still wrong, because a wizard card is updated IN PLACE:
 * it keeps the timeline position it was created at and never moves to the bottom.
 *
 * Measured on production 2026-07-28, the owner's trip thread cms2zz5zs:
 *   · 09:01:21Z  trip_step {"v":1,"step":1,"state":"active"}   ← first of thirteen messages
 *   · ten identical "Hi! I'd like to plan a trip to Vietnam." texts after it
 * The card was live, so the chip hid; the card was first, so it was far above the fold; and the
 * product page's CTA — the only visible way to "plan a trip" — posted a canned line and nothing
 * else. Ten taps, ten messages, no form: *"when i click plan my trip it just sends message instead
 * of giving me the form"*.
 *
 * The rule below is the fix stated as an invariant: a live wizard changes what the chip MEANS, never
 * whether it exists.
 */

describe('a traveller on a trip thread is never left without an entry point', () => {
  it('offers to START when no wizard is running', () => {
    expect(tripWizardChip({ eligible: true, liveWizardMessageId: null })).toBe('start')
  })

  it('THE REGRESSION: a running wizard offers to RESUME — it does not hide the chip', () => {
    // What production did: `eligible && step === null` was false, so nothing rendered.
    const oldPredicateWouldShowChip = (eligible: boolean, step: number | null) => eligible && step === null
    expect(oldPredicateWouldShowChip(true, 1)).toBe(false) // ← the bug
    expect(tripWizardChip({ eligible: true, liveWizardMessageId: 'cms2zz5zs-card' })).toBe('resume')
  })

  it.each([null, 'cms2zz5zs-card'])(
    'renders nothing on a thread that is not the trip desk’s, live card = %s',
    (liveWizardMessageId) => {
      // Eligibility is the ONLY thing that may silence the chip. It is `threadHostsWizard`, i.e.
      // threadKind(convo) === 'itinerary' — the anchor-listing test that keeps the planner out of
      // e-Visa threads, which share the desk's Seller row.
      expect(tripWizardChip({ eligible: false, liveWizardMessageId })).toBe('none')
    },
  )

  it('the answer depends on the live CARD, not on a separately-fetched step number', () => {
    // The launcher used to fetch "is a wizard running" on mount and never refresh it, so the chip
    // and the timeline could disagree about a card the user was looking at. The id now comes from
    // the same array the thread renders; passing one is the only way to get 'resume'.
    expect(tripWizardChip({ eligible: true, liveWizardMessageId: '' })).toBe('start')
    expect(tripWizardChip({ eligible: true, liveWizardMessageId: 'x' })).toBe('resume')
  })
})
