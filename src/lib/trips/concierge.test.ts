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

describe('⚠️ the person/AI toggle must work in BOTH directions', () => {
  const read2 = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8')

  it('⚠️ does NOT pretend the trips read-then-write is atomic', () => {
    // An advisory lock was tried and removed: pg_advisory_xact_lock dies with its transaction, and
    // the marker is written afterwards by insertMessage, which cannot join it. A lock that does not
    // cover the write is worse than none because the next reader trusts it. The race is documented
    // instead, and the mode still resolves deterministically by (createdAt, id).
    // ⚠️ MATCHES CODE, NOT PROSE. The comment explaining the removal names the lock, so a bare
    // /pg_advisory_xact_lock/ fails on its own documentation — the third time this session a
    // source-level test tripped over the words it was written to justify.
    const route = read2('app/api/trips/help/route.ts')
    expect(route).not.toMatch(/\$executeRaw/)
    expect(route).not.toMatch(/SELECT pg_advisory/)
    expect(route).toMatch(/NOT ATOMIC/)
  })

  it('trip mode is the NEWEST marker, not "does a trip_help exist"', () => {
    // Presence alone was right only while it was a one-way door. A thread that asked for a person
    // and switched back holds BOTH markers, and only their order says which is live.
    const lib = read2('lib/trips/concierge.ts')
    expect(lib).toMatch(/kind: \{ in: \['trip_help', 'trip_ai'\] \}/)
    expect(lib).toMatch(/orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/)
    expect(lib).toMatch(/newest\?\.kind === 'trip_help'/)
  })

  it('trip_ai is a real kind and NOT a card', () => {
    expect(MESSAGE_KINDS).toContain('trip_ai')
    expect(isTripCardKind('trip_ai')).toBe(false)
  })

  it('⚠️ an applicant resuming the AI is NOT recorded as an admin ending a takeover', () => {
    // Both map to mode 'ai', but writing admin_takeover_ended for an applicant's tap would put a
    // takeover that never happened into the trail the admin queue reads.
    const thread = read2('lib/visa/dm-thread.ts')
    expect(thread).toMatch(/applicant_resumed_ai: 'ai'/)
    expect(thread).toMatch(/input\.mode === 'ai' && input\.actorType === 'applicant'/)
  })

  it("⚠️ an applicant cannot undo an OPERATOR's takeover", () => {
    // 'admin' means a human is mid-conversation; letting the applicant flip it back would drop the
    // bot into it. Only their own human_requested is reversible from the chip.
    // ⚠️ BOTH DIRECTIONS. The first cut guarded only the ai direction, which looked like protection
    // while leaving the other door open: mode is the NEWEST event, so POSTing human_requested
    // during a takeover writes a newer event and silently ends it. codex caught it.
    const route = read2('app/api/visa/applications/[id]/help/route.ts')
    expect(route).toMatch(/modeNow === 'admin'\) return NextResponse\.json\(\{ error: 'admin_takeover' \}/)
    // …and it must not be re-narrowed to one direction by a later edit.
    expect(route).not.toMatch(/!wantsHuman && .*=== 'admin'/)
    // A tap on the already-live side writes nothing — no duplicate event, message or notification.
    expect(route).toMatch(/modeNow === target\) return NextResponse\.json\(\{ mode: target, unchanged: true \}\)/)
  })

  it('⚠️ the composer disarms whenever the thread goes human, not only on the tap', () => {
    // conciergeAvailable now stays TRUE in human mode so the toggle keeps its seat, which silently
    // disabled the reset this guard exists for.
    const page = read2('app/messages/[id]/page.tsx')
    expect(page).toMatch(/if \(!conciergeAvailable \|\| visaHumanRequested\) setConciergeArmed\(false\)/)
  })
})

describe('⚠️ the wizard must never generate from an incomplete draft', () => {
  const readSrc = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8')

  it('checks firstIncompleteTripWizardStep BEFORE calling the paid endpoint', () => {
    // The dead end this closes: the STEP lives on the server, the ANSWERS live in sessionStorage.
    // A new tab restores "step 5" over a reset draft, so Build my plan posted cityIds:[] and
    // interests:[] — both min-1 — and "please try again" could never succeed. The helper existed
    // for exactly this and had no caller.
    const src = readSrc('components/marketplace/trip-cards.tsx')
    const build = src.slice(src.indexOf('const build = async ()'), src.indexOf("await fetch('/api/itineraries/generate'"))
    expect(build).toContain('firstIncompleteTripWizardStep(draft)')
    // ⚠️ The view moves only on a SUCCESSFUL goto, using the step the server reports. Setting it
    // unconditionally is what produced the 409 loop: a client believing a step the card never took.
    expect(build).toMatch(/action: 'goto', conversationId, step: missing, expectedStep: step/)
    expect(build).toMatch(/if \(typeof moved\.step === 'number'\) setStep\(moved\.step\)/)
  })

  it('⚠️ recovers by MOVING THE CARD, not by disagreeing with it', () => {
    // Deriving the rendered step from the draft swapped one dead end for another: Next then
    // answered step 1 while the card said 5, and advance refused it as step_mismatch (409 in
    // production). The card is what advance validates against, so the view must follow it and the
    // recovery must be a write.
    const src = readSrc('components/marketplace/trip-cards.tsx')
    expect(src).toMatch(/action: 'goto', conversationId, step: missing/)
    expect(src).toMatch(/useEffect\(\(\) => \{ setStep\(meta\.step\) \}, \[meta\.step\]\)/)
    expect(src).not.toMatch(/Math\.min\(firstIncompleteTripWizardStep/)
  })

  it('goto refuses a FORWARD jump — it must not be a way to skip validation', () => {
    const flow = readSrc('lib/trips/wizard-flow.ts')
    expect(flow).toMatch(/input\.step > card\.meta\.step\) return \{ ok: false, error: 'step_mismatch' \}/)
  })

  it('does not tell the traveller to retry something retrying cannot fix', () => {
    const src = readSrc('components/marketplace/trip-cards.tsx')
    expect(src).toMatch(/error === 'incomplete'/)
  })
})

describe('⚠️ the arrival repair must never rewind a wizard whose answers are present', () => {
  const readSrc = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8')
  const card = () => readSrc('components/marketplace/trip-cards.tsx')

  it('is gated on THIS card being hydrated, not on a global boolean', () => {
    // `draft` initialises to EMPTY_DRAFT and fills in an effect. A plain `hydrated` flag stays true
    // across a messageId change, and this effect is declared BEFORE the hydration one — so it would
    // read the previous card's answers and rewind a complete wizard. Both shapes caught by codex.
    expect(card()).toMatch(/hydratedCard !== messageId/)
    expect(card()).toMatch(/setHydratedCard\(messageId\)/)
    expect(card()).not.toMatch(/const \[hydrated, setHydrated\]/)
  })

  it('sends the CAS and only moves the view on the server’s answer', () => {
    expect(card()).toMatch(/expectedStep: meta\.step/)
    expect(card()).toMatch(/if \(typeof res\.step === 'number'\) setStep\(res\.step\)/)
  })

  it('the card write itself is a compare-and-set', () => {
    // The expectedStep check is an early refusal; the ATOMIC guarantee is writeCardMeta matching on
    // the exact stored blob, so a card that moved between read and write yields case_changed_reload.
    const flow = readSrc('lib/trips/wizard-flow.ts')
    expect(flow).toMatch(/where: \{ id: messageId, kind: 'trip_step', metaJson: expected \}/)
  })
})

describe('⚠️ a visa applicant can still get back to edit from checkout', () => {
  const readSrc = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8')

  it('review mode re-posts the last FORM step, not the empty one', () => {
    // VISA_STEP_FORM has empty field lists for 1 (the product picker) and 5, so re-posting 5 would
    // render a card with nothing on it. Four is the last step that carries fields, and the act
    // route's writable set is `1..meta.step`, so from there every earlier answer is reachable.
    const flow = readSrc('lib/visa/dm-flow.ts')
    expect(flow).toMatch(/input\.mode === 'review' && rawStep === null \? \(4 as VisaDmStep\) : rawStep/)
  })

  it('⚠️ review does not weaken any existing gate', () => {
    // The paid / cancelled / locked refusals all run BEFORE the branch that chooses a card, so
    // asking to review a finished-and-paid application is still already_paid.
    const flow = readSrc('lib/visa/dm-flow.ts')
    const paidAt = flow.indexOf("if (kase.application.paid_at) return fail('already_paid'")
    const branch = flow.indexOf("input.mode === 'review'")
    expect(paidAt).toBeGreaterThan(-1)
    expect(paidAt).toBeLessThan(branch)
    expect(flow.indexOf('EDITABLE_STATUSES.has(kase.application.status)')).toBeLessThan(branch)
  })

  it('only the applicant is offered it', () => {
    // The desk reads this card; it has no business escaping somebody else's checkout.
    expect(readSrc('app/messages/[id]/page.tsx')).toMatch(/onReview=\{iAmApplicant \? \(\) => resendVisaCard\('review'\) : undefined\}/)
  })
})
