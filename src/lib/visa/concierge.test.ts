import { beforeEach, describe, expect, it, vi } from 'vitest'

// Eno concierge — the e-Visa assistant in the thread. Two properties are asserted here
// rather than left to a live test, because both are things the owner said out loud and
// neither is visible in a screenshot:
//
//  1. THE MODE GATE. "ife person requested ai doesnt answer" — a thread in
//     'human_requested' or 'admin' gets a refusal, NO message and NO Gemini call. Every
//     gate test below asserts all three, so deleting the gate cannot leave the suite green:
//     the function would return ok:true, write two messages and call the model.
//  2. NO PII IN THE PROMPT. The prompt is built from a payload stuffed with distinctive
//     values (surname, passport number, address, phone, email) and the test proves none of
//     them appear in the string that would travel to Gemini.

const h = vi.hoisted(() => ({
  state: {
    /** visa_applications, as loadVisaDmCase would return it. null = no such case for this user. */
    kase: null as null | { application: { id: string; status: string; paid_at: string | null; user_id: string }; documents: Array<{ kind: string; validation_status?: string }>; payload: unknown },
    /** The Conversation row for the @unique binding lookup. */
    convo: null as null | { id: string; buyerProfileId: string; sellerProfileId: string | null; listingId: string },
    shop: { id: 'shop-1', ownerId: 'desk-profile' } as null | { id: string; ownerId: string | null },
    mode: 'ai' as 'ai' | 'human_requested' | 'admin',
    /** Simulates a Supabase hiccup on the strict mode read — must NOT mean 'carry on'. */
    modeReadFails: false,
    modeAfterAsk: null as null | 'ai' | 'human_requested' | 'admin',
    cryptoReady: true,
    selectedListingId: 'listing-1' as string | null,
    product: null as unknown,
    /** Gemini: null client = unconfigured; otherwise this text comes back. */
    geminiConfigured: true,
    geminiText: 'You are on step 1 of 5. Send the passport photo and the portrait photo next.',
    geminiThrows: false,
    budgetAllowed: true,
    // observations
    prompts: [] as string[],
    inserted: [] as Array<{ senderId: string; text: string }>,
    events: [] as Array<{ event: string; metadata: unknown }>,
  },
}))

vi.mock('../db', () => ({
  db: {
    conversation: {
      findUnique: vi.fn(async ({ where }: { where: { visaApplicationId?: string } }) =>
        // Honours the binding scope: a lookup for another application finds nothing.
        h.state.convo && where.visaApplicationId === 'app-1' ? h.state.convo : null),
    },
  },
}))

vi.mock('../gemini', () => ({
  GEMINI_MODEL: 'gemini-3.6-flash',
  getGemini: () => (h.state.geminiConfigured
    ? {
      models: {
        generateContent: async ({ contents }: { contents: string }) => {
          h.state.prompts.push(contents)
          if (h.state.geminiThrows) throw new Error('boom: ' + contents)
          return { text: h.state.geminiText }
        },
      },
    }
    : null),
}))

vi.mock('../messages', () => ({
  insertMessage: vi.fn(async (_convo: unknown, senderId: string, text: string) => {
    h.state.inserted.push({ senderId, text })
    return { id: `msg-${h.state.inserted.length}` }
  }),
}))

vi.mock('../ratelimit', () => ({
  rateLimit: vi.fn(async () => ({ success: h.state.budgetAllowed, remaining: 0 })),
}))

vi.mock('../visa-shop', () => ({
  getVisaShopSeller: async () => h.state.shop,
  resolveVisaProduct: async (listingId: string) => (listingId === h.state.selectedListingId ? h.state.product : null),
}))

vi.mock('./crypto', () => ({ visaCryptoReady: () => h.state.cryptoReady }))

vi.mock('./dm-flow', () => ({
  loadVisaDmCase: async (applicationId: string, userId: string) =>
    // Mirrors the real scope: `.eq('id').eq('user_id')` — another user's read finds nothing.
    (applicationId === 'app-1' && userId === h.state.kase?.application.user_id ? h.state.kase : null),
  // Phase 2: the concierge grounds on the CANONICAL selection (column-first read).
  canonicalVisaListingId: async () => h.state.selectedListingId,
}))

// readVisaThreadModeStrict mirrors the real module: it FAILS CLOSED, so the mock must be
// able to represent 'the read failed' ({ok:false}) as well as a mode — that distinction is
// the whole point of the second gate.
vi.mock('./dm-thread', () => ({
  getVisaThreadMode: async () => h.state.mode,
  // modeAfterAsk models the RACE: the applicant taps "Request a person" while Gemini is
  // still thinking, so the second (strict) read sees a different mode than the first.
  readVisaThreadModeStrict: async () =>
    (h.state.modeReadFails ? { ok: false } : { ok: true, mode: h.state.modeAfterAsk ?? h.state.mode }),
}))

vi.mock('./records', () => ({
  recordVisaEvent: vi.fn(async (_id: string, _actor: string, event: string, _ref: string, metadata: unknown) => {
    h.state.events.push({ event, metadata })
  }),
}))

import {
  askVisaConcierge,
  buildVisaConciergeGrounding,
  questionDisclosesIdentity,
  scrubVisaConciergeQuestion,
  visaConciergeModeRefusal,
  visaConciergePrompt,
  VISA_CONCIERGE_LABEL,
} from './concierge'
import { emptyVisaPayload, type VisaPayload } from './schema'
import type { VisaShopProduct } from '../visa-shop'

const APPLICANT = 'applicant-profile'

/** A payload carrying values a leak would be recognisable by. */
const stuffedPayload = (): VisaPayload => ({
  ...emptyVisaPayload('marie.dubois@example.com'),
  surname: 'DUBOIS',
  givenNames: 'MARIE CLAIRE',
  dateOfBirth: '1991-04-17',
  passportNumber: 'FR9911223',
  permanentAddress: '12 Rue Lafayette, Paris',
  phone: '+33612345678',
  temporaryAddress: 'Villa Song, Thao Dien',
})

const product = (): VisaShopProduct => ({
  listingId: 'listing-1',
  title: 'e-Visa 90 days single entry — 1 working day',
  entryType: 'single',
  speed: '1D',
  priceVnd: 2_500_000,
  currency: 'VND',
  window: { acceptingNow: true, nextCutoffIso: '2026-07-22T02:00:00.000Z', nextOpensIso: null },
})

beforeEach(() => {
  h.state.kase = {
    application: { id: 'app-1', status: 'draft', paid_at: null, user_id: APPLICANT },
    documents: [],
    payload: stuffedPayload(),
  }
  h.state.convo = { id: 'convo-1', buyerProfileId: APPLICANT, sellerProfileId: 'desk-profile', listingId: 'listing-1' }
  h.state.shop = { id: 'shop-1', ownerId: 'desk-profile' }
  h.state.mode = 'ai'
  h.state.cryptoReady = true
  h.state.selectedListingId = 'listing-1'
  h.state.product = product()
  h.state.geminiConfigured = true
  h.state.geminiText = 'You are on step 1 of 5. Send the passport photo and the portrait photo next.'
  h.state.geminiThrows = false
  h.state.budgetAllowed = true
  h.state.prompts = []
  h.state.inserted = []
  h.state.events = []
})

const ask = (question = 'what happens next?') =>
  askVisaConcierge({ applicationId: 'app-1', userId: APPLICANT, question, language: 'en' })

// ── THE MODE GATE ─────────────────────────────────────────────────────────────────
// ⚠️ Each case asserts the refusal AND the two side effects that would happen without the
// gate. Remove visaConciergeModeRefusal from askVisaConcierge and all three fail.

describe('the mode gate — "ife person requested ai doesnt answer"', () => {
  it('refuses in human_requested: no answer, no message, no AI call', async () => {
    h.state.mode = 'human_requested'
    const res = await ask()
    expect(res).toEqual({ ok: false, error: 'human_help_pending', status: 409 })
    expect(h.state.inserted).toEqual([])
    expect(h.state.prompts).toEqual([])
  })

  it('refuses during an admin takeover: no answer, no message, no AI call', async () => {
    h.state.mode = 'admin'
    const res = await ask()
    expect(res).toEqual({ ok: false, error: 'admin_takeover', status: 409 })
    expect(h.state.inserted).toEqual([])
    expect(h.state.prompts).toEqual([])
  })

  it('answers in ai mode — so the gate is what refuses, not something else', async () => {
    const res = await ask()
    expect(res.ok).toBe(true)
    expect(h.state.prompts).toHaveLength(1)
  })

  it('names the refusal per mode', () => {
    expect(visaConciergeModeRefusal('ai')).toBeNull()
    expect(visaConciergeModeRefusal('human_requested')).toBe('human_help_pending')
    expect(visaConciergeModeRefusal('admin')).toBe('admin_takeover')
  })
})

// ── NO PII ────────────────────────────────────────────────────────────────────────

describe('the prompt carries names and state, never values', () => {
  it('contains no payload value from a fully stuffed case', async () => {
    await ask('is my passport ok?')
    const prompt = h.state.prompts[0]
    for (const value of ['DUBOIS', 'MARIE CLAIRE', '1991-04-17', 'FR9911223', 'Rue Lafayette', '+33612345678', 'marie.dubois@example.com', 'Villa Song']) {
      expect(prompt).not.toContain(value)
    }
  })

  it('does contain the step, the outstanding FIELD CODES and the product facts', async () => {
    await ask()
    const prompt = h.state.prompts[0]
    expect(prompt).toContain('current step: 1 of 5')
    expect(prompt).toContain('passport_image_required')
    expect(prompt).toContain('portrait_required')
    expect(prompt).toContain('entry type: single')
    expect(prompt).toContain('1 working day')
    expect(prompt).toContain('09:00, 13:00')
  })

  it('never carries the application id or the user id', async () => {
    await ask()
    expect(h.state.prompts[0]).not.toContain('app-1')
    expect(h.state.prompts[0]).not.toContain(APPLICANT)
  })

  it('scrubs identifiers out of the question before it is prompted', async () => {
    await ask('my passport is FR9911223, email marie.dubois@example.com, phone +33 6 12 34 56 78, id 123456789')
    const prompt = h.state.prompts[0]
    expect(prompt).not.toContain('FR9911223')
    expect(prompt).not.toContain('marie.dubois@example.com')
    expect(prompt).not.toContain('123456789')
    // …while the question itself is stored VERBATIM: it is the applicant's own message in
    // their own thread, and rewriting somebody's words in their chat is its own bug.
    expect(h.state.inserted[0].text).toContain('FR9911223')
  })

  it('scrubVisaConciergeQuestion keeps ordinary dates and words', () => {
    expect(scrubVisaConciergeQuestion('can I enter on 23/07/2026?')).toBe('can I enter on 23/07/2026?')
    expect(scrubVisaConciergeQuestion('  how   long does this take?  ')).toBe('how long does this take?')
    expect(scrubVisaConciergeQuestion('number 20260723')).toBe('number [removed]')
  })

  it('the audit event records the step and the mode, never the text', async () => {
    await ask('is my passport FR9911223 ok?')
    expect(h.state.events).toEqual([{ event: 'dm_concierge_answered', metadata: { step: 1, mode: 'ai' } }])
  })
})

// ── FAIL CLOSED ───────────────────────────────────────────────────────────────────

describe('no answer beats a wrong answer', () => {
  it('refuses when Gemini is not configured — and never invents visa guidance', async () => {
    h.state.geminiConfigured = false
    const res = await ask()
    expect(res).toEqual({ ok: false, error: 'concierge_unavailable', status: 503, questionPosted: true })
    // The question survived (a human can still answer it); no desk-authored message exists.
    expect(h.state.inserted.map((m) => m.senderId)).toEqual([APPLICANT])
  })

  it('refuses when the daily Gemini budget is spent', async () => {
    h.state.budgetAllowed = false
    const res = await ask()
    expect(res).toEqual({ ok: false, error: 'concierge_unavailable', status: 503, questionPosted: true })
  })

  it('refuses when generation throws', async () => {
    h.state.geminiThrows = true
    const res = await ask()
    expect((res as { error: string }).error).toBe('concierge_unavailable')
  })

  it('refuses when the model answers with nothing', async () => {
    h.state.geminiText = '   '
    const res = await ask()
    expect((res as { error: string }).error).toBe('concierge_unavailable')
  })
})

// ── ENTITLEMENT ───────────────────────────────────────────────────────────────────

describe('entitlement', () => {
  it('404s a case that is not this user’s', async () => {
    const res = await askVisaConcierge({ applicationId: 'app-1', userId: 'someone-else', question: 'hi', language: 'en' })
    expect(res).toEqual({ ok: false, error: 'not_found', status: 404 })
    expect(h.state.inserted).toEqual([])
  })

  it('409s when the thread is not bound', async () => {
    h.state.convo = null
    expect(await ask()).toEqual({ ok: false, error: 'thread_not_bound', status: 409 })
  })

  it('409s when the bound thread belongs to another buyer', async () => {
    h.state.convo = { id: 'convo-1', buyerProfileId: 'other-buyer', sellerProfileId: 'desk-profile', listingId: 'listing-1' }
    expect(await ask()).toEqual({ ok: false, error: 'thread_conflict', status: 409 })
  })

  it('503s when the thread’s seller is not the visa desk', async () => {
    h.state.convo = { id: 'convo-1', buyerProfileId: APPLICANT, sellerProfileId: 'a-stranger', listingId: 'listing-1' }
    expect(await ask()).toEqual({ ok: false, error: 'shop_unavailable', status: 503 })
    expect(h.state.inserted).toEqual([])
  })

  it('503s when visa encryption is not configured', async () => {
    h.state.cryptoReady = false
    expect(await ask()).toEqual({ ok: false, error: 'visa_encryption_not_configured', status: 503 })
  })

  it('400s an empty question', async () => {
    expect(await ask('   ')).toEqual({ ok: false, error: 'question_required', status: 400 })
  })
})

// ── THE TWO MESSAGES ──────────────────────────────────────────────────────────────

describe('the exchange lands in the thread', () => {
  it('writes the question as the applicant and the answer as the desk, labelled', async () => {
    const res = await ask('what happens next?')
    expect(res).toEqual({ ok: true, messageId: 'msg-2', step: 1 })
    expect(h.state.inserted).toEqual([
      { senderId: APPLICANT, text: 'what happens next?' },
      { senderId: 'desk-profile', text: `${VISA_CONCIERGE_LABEL}\nYou are on step 1 of 5. Send the passport photo and the portrait photo next.` },
    ])
  })

  it('strips a self-introduction so the label is never doubled', async () => {
    h.state.geminiText = 'Eno concierge: you still need the portrait photo.'
    await ask()
    expect(h.state.inserted[1].text).toBe(`${VISA_CONCIERGE_LABEL}\nyou still need the portrait photo.`)
  })
})

// ── GROUNDING ─────────────────────────────────────────────────────────────────────

describe('grounding', () => {
  it('partitions outstanding codes by step and reports the current one', () => {
    const g = buildVisaConciergeGrounding({
      payload: stuffedPayload(), documents: [], status: 'draft', paid: false, product: product(),
    })
    expect(g.step).toBe(1)
    expect(g.complete).toBe(false)
    expect(g.outstanding.find((row) => row.step === 1)?.codes).toEqual(
      expect.arrayContaining(['portrait_required', 'passport_image_required']),
    )
    // Step 1's codes never appear under another step — the partition is disjoint.
    expect(g.outstanding.filter((row) => row.step !== 1).flatMap((row) => row.codes))
      .not.toContain('portrait_required')
    expect(g.maxValidityDays).toBe(90)
  })

  it('survives a case with no product picked', () => {
    const g = buildVisaConciergeGrounding({
      payload: stuffedPayload(), documents: [], status: 'draft', paid: false, product: null,
    })
    expect(g.product).toBeNull()
    const prompt = visaConciergePrompt(g, 'how long does this take?', 'en')
    expect(prompt).toContain('no product chosen yet')
    expect(prompt).toContain('how long does this take?')
  })

  it('asks for Vietnamese when the applicant is on Vietnamese', () => {
    const g = buildVisaConciergeGrounding({
      payload: stuffedPayload(), documents: [], status: 'draft', paid: false, product: product(),
    })
    expect(visaConciergePrompt(g, 'bao lâu?', 'vi')).toContain('Vietnamese')
    expect(visaConciergePrompt(g, 'how long?', 'en')).toContain('English')
  })
})

// ── Identity never reaches the model (adversarial review, 2026-07-22) ───────────────
// A reviewer typed each of these and watched them travel verbatim to Vertex. The scrubber
// now handles separated document numbers, and anything that ANNOUNCES identity is refused
// outright rather than scrubbed — no regex knows a human name.
describe('the applicant question never carries identity to Gemini', () => {
  it('redacts a passport number even when it is typed with spaces', () => {
    // The exact string from the review. The old pattern only matched the compact form.
    expect(scrubVisaConciergeQuestion('my passport is C 0123 4567 - valid?')).not.toContain('0123')
    expect(scrubVisaConciergeQuestion('passport C01234567 ok?')).not.toContain('C01234567')
  })

  it('redacts a grouped ID number', () => {
    expect(scrubVisaConciergeQuestion('my id number is 123 456 789 012 is that fine')).not.toMatch(/\d{3}\s\d{3}/)
  })

  it('REFUSES to send a question that announces name, birth date or home address', () => {
    for (const q of [
      'My name is John Michael Smith, born 1990-03-12, I live at 42 Nguyen Hue, District 1. Is my visa ok?',
      'I am Nguyen Thi Hoa, DOB 12/03/1990, address 88 Le Loi, Hanoi — is this right?',
      'my address is 12 Tran Hung Dao, is that ok for the form?',
    ]) {
      expect(questionDisclosesIdentity(q), q).toBe(true)
    }
  })

  it('still answers ordinary questions — the gate must not swallow the feature', () => {
    for (const q of [
      'can I enter on 23/07?',
      'how long does 2 business days take?',
      'what do I still need for this step?',
      'when does the desk close today?',
      'do I need a hotel booking?',
    ]) {
      expect(questionDisclosesIdentity(q), q).toBe(false)
    }
  })
})

// ── The gate is re-checked at the moment the bot SPEAKS ─────────────────────────────
// "ife person requested ai doesnt answer" (owner, stated twice). A review found the mode was
// read once, BEFORE a multi-second model call, and never again — and the race is reachable
// from the UI because the two chips have independent busy flags.
describe('handing off to a human mid-answer', () => {
  it('drops the answer when a person is requested while the model is thinking', async () => {
    h.state.mode = 'ai'
    h.state.modeAfterAsk = 'human_requested'
    const res = await ask('what do I still need?')

    expect(res.ok).toBe(false)
    if (res.ok === false) {
      expect(res.error).toBe('human_help_pending')
      // The applicant's own question stays — it is their message, and the desk should see it.
      expect(res.questionPosted).toBe(true)
    }
    // The bot said NOTHING into a thread where a human was asked for.
    expect(h.state.inserted.some((m) => m.text.includes('Eno concierge'))).toBe(false)
  })

  it('drops the answer when an admin takes over mid-answer', async () => {
    h.state.mode = 'ai'
    h.state.modeAfterAsk = 'admin'
    const res = await ask('what do I still need?')
    expect(res.ok).toBe(false)
    expect(h.state.inserted.some((m) => m.text.includes('Eno concierge'))).toBe(false)
  })

  it('FAILS CLOSED when the mode read itself fails — "could not tell" is not "carry on"', async () => {
    h.state.mode = 'ai'
    h.state.modeReadFails = true
    const res = await ask('what do I still need?')
    expect(res.ok).toBe(false)
    if (res.ok === false) expect(res.error).toBe('concierge_unavailable')
    expect(h.state.inserted.some((m) => m.text.includes('Eno concierge'))).toBe(false)
  })
})
