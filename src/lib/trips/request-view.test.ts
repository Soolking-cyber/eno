import { beforeEach, describe, expect, it, vi } from 'vitest'

// viewTripRequest — the itinerary behind a booking request: where a traveller will be, and when. Visible to the
// traveller and to the operator of the desk that answers the request, and to nobody else (security review
// 2026-10-22, item 31: the desk check used to be "runs A desk", not "runs THIS request's desk"). Missing and
// forbidden stay one answer.

const h = vi.hoisted(() => ({
  profile: { id: 'traveller' } as { id: string } | null,
  /** What the per-request desk gate answers for each request id (absent = null: not this desk's). */
  operatorFor: {} as Record<string, string>,
  requests: {} as Record<string, { id: string; profileId: string; status: string; itineraryId: string }>,
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.profile }))
vi.mock('@/lib/desk-operator', () => ({ tripDeskOperatorFor: async (id: string) => h.operatorFor[id] ?? null }))
vi.mock('@/lib/db', () => ({
  db: {
    tripAssistanceRequest: { findUnique: async (args: { where: { id: string } }) => h.requests[args.where.id] ?? null },
    itinerary: {
      findUnique: async () => ({ title: 'Đà Nẵng, 5 days', days: 5, destinationId: 'danang', estimatedBudget: null, currency: 'VND', dayPlans: [] }),
    },
  },
}))

const { viewTripRequest } = await import('./request-view')

beforeEach(() => {
  h.profile = { id: 'traveller' }
  h.operatorFor = {}
  h.requests = {
    'case-1': { id: 'case-1', profileId: 'traveller', status: 'requested', itineraryId: 'itin-1' },
    'case-2': { id: 'case-2', profileId: 'someone-else', status: 'requested', itineraryId: 'itin-2' },
  }
})

describe('viewTripRequest', () => {
  it('shows the traveller their own trip', async () => {
    const r = await viewTripRequest({ requestId: 'case-1' })
    expect(r.ok && r.data.mine).toBe(true)
  })

  it('shows the operator of the desk that answers the request, with mine=false', async () => {
    h.profile = { id: 'desk-profile' }
    h.operatorFor['case-2'] = 'info@giacmobayre.com'
    const r = await viewTripRequest({ requestId: 'case-2' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.mine).toBe(false)
  })

  it('⛔ refuses a desk operator on another desk\'s request — and answers exactly as for a missing one', async () => {
    h.profile = { id: 'desk-profile' }
    h.operatorFor['case-1'] = 'info@giacmobayre.com' // their desk answers case-1 only
    expect(await viewTripRequest({ requestId: 'case-2' })).toEqual({ ok: false, error: 'forbidden' })
    expect(await viewTripRequest({ requestId: 'no-such-case' })).toEqual({ ok: false, error: 'forbidden' })
  })

  it('refuses an ordinary signed-in stranger, and a signed-out reader before any lookup', async () => {
    h.profile = { id: 'stranger' }
    expect(await viewTripRequest({ requestId: 'case-1' })).toEqual({ ok: false, error: 'forbidden' })
    h.profile = null
    expect(await viewTripRequest({ requestId: 'case-1' })).toEqual({ ok: false, error: 'not_signed_in' })
  })
})
