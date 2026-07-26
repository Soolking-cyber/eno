import { test, expect } from '../helpers'

// Trip assistance as a logged-out guest. READ-ONLY in effect: every request here is expected to be
// REFUSED, so nothing is created and nothing is mutated. The point is to prove the refusal happens
// at the door — before any domain logic, and in particular before anything that writes money.
//
// Why this suite exists in the guest runner rather than the authed one: the properties being
// checked are all absences. An authed test can show that an operator CAN quote; only a guest test
// can show that the quote path is shut to everyone who is not one, including for a case id that
// does not exist (a 404 leaking ahead of a 401 would be a disclosure in itself).

const CASE = 'ckguest0000000000000000001'

test.describe('Guest · trip assistance', () => {
  test('a case cannot be opened without a session', async ({ request }) => {
    const res = await request.post('/api/trips/assistance', { data: { itineraryId: 'ckguest-itinerary-1' } })
    expect([401, 403]).toContain(res.status())
  })

  test('THE QUOTE PATH — the only writer of money — is closed to guests', async ({ request }) => {
    // The single most important assertion in this file. supplierTotalVnd/feeVnd are the two
    // monetary columns in the whole feature; a guest reaching them would be the worst outcome the
    // design guards against.
    const res = await request.post(`/api/trips/assistance/${CASE}`, {
      data: { action: 'quote', supplierTotalVnd: 1, feeVnd: 1 },
    })
    expect([401, 403]).toContain(res.status())
  })

  test('the operator review action is closed to guests', async ({ request }) => {
    const res = await request.post(`/api/trips/assistance/${CASE}`, { data: { action: 'review' } })
    expect([401, 403]).toContain(res.status())
  })

  for (const action of ['accept', 'decline', 'cancel'] as const) {
    test(`the traveller action "${action}" is closed to guests`, async ({ request }) => {
      const res = await request.post(`/api/trips/assistance/${CASE}`, { data: { action } })
      expect([401, 403]).toContain(res.status())
    })
  }

  test('refusal comes BEFORE the case is looked up — no 404 for a guest', async ({ request }) => {
    // A guest must not be able to tell a real case id from a fake one. Both are 401.
    const real = await request.post(`/api/trips/assistance/${CASE}`, { data: { action: 'accept' } })
    const fake = await request.post('/api/trips/assistance/definitely-not-a-case', { data: { action: 'accept' } })
    expect(real.status()).toBe(fake.status())
    expect([401, 403]).toContain(real.status())
  })

  test('a malformed body is still refused, not 400 — identity is checked first', async ({ request }) => {
    // Ordering matters: validating the payload before the session would tell an anonymous caller
    // which fields the endpoint accepts.
    const res = await request.post(`/api/trips/assistance/${CASE}`, { data: { action: 'not-an-action' } })
    expect([401, 403]).toContain(res.status())
  })

  test('GET is not a way in either — these routes are POST-only', async ({ request }) => {
    const res = await request.get(`/api/trips/assistance/${CASE}`)
    // 405 from the framework, or a redirect/401 — anything but a 200 with a case in it.
    expect(res.status()).not.toBe(200)
  })
})

// ── The in-chat itinerary wizard ────────────────────────────────────────────────────────────
// The wizard itself never generates — the client posts to /api/itineraries/generate, which has its
// own guards. What must be shut here is the wizard's own surface, because a guest who could drive
// it would be writing cards into somebody else's thread.

test.describe('Guest · trip wizard', () => {
  const THREAD = 'ckguestthread000000000001'

  for (const body of [
    { action: 'start', conversationId: THREAD },
    { action: 'advance', conversationId: THREAD, step: 1, answers: { cityIds: ['hanoi'], cityDays: [], days: 7 } },
    { action: 'complete', conversationId: THREAD, itineraryId: 'ckguestitin0000000000001' },
  ]) {
    test(`the "${body.action}" action is closed to guests`, async ({ request }) => {
      const res = await request.post('/api/trips/wizard', { data: body })
      expect([401, 403]).toContain(res.status())
    })
  }

  test('refusal comes before the thread is looked up — a real and a fake id answer alike', async ({ request }) => {
    const real = await request.post('/api/trips/wizard', { data: { action: 'start', conversationId: THREAD } })
    const fake = await request.post('/api/trips/wizard', { data: { action: 'start', conversationId: 'nope' } })
    expect(real.status()).toBe(fake.status())
    expect([401, 403]).toContain(real.status())
  })

  test('a malformed body is still refused, not 400 — identity is checked first', async ({ request }) => {
    const res = await request.post('/api/trips/wizard', { data: { action: 'not-a-thing' } })
    expect([401, 403]).toContain(res.status())
  })

  test('GET is not a way in', async ({ request }) => {
    const res = await request.get('/api/trips/wizard')
    expect(res.status()).not.toBe(200)
  })
})

test.describe('Guest · trip wizard eligibility', () => {
  test('the eligibility read is closed to guests', async ({ request }) => {
    // It answers "does this thread belong to the trip desk" — a guest must not be able to ask.
    const res = await request.get('/api/trips/wizard?conversationId=ckguestthread000000000001')
    expect([401, 403]).toContain(res.status())
  })
})
