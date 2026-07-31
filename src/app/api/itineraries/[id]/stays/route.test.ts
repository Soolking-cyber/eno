import { beforeEach, describe, expect, it, vi } from 'vitest'

// The write boundary for a hotel swap. Everything here is about what reaches the database from a
// request that never went through the dialog — because the dialog is not the enforcement point and
// a caller can post whatever it likes.

const h = vi.hoisted(() => ({
  profile: { id: 'owner' } as { id: string } | null,
  limited: false,
  calls: [] as any[],
  result: { ok: true } as any,
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.profile }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: !h.limited }) }))
vi.mock('./replace', () => ({
  replaceStay: async (input: any) => { h.calls.push(input); return h.result },
}))

const { POST } = await import('./route.svc')

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/itineraries/trip1/stays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'trip1' }) },
  )

const VALID = { action: 'replace', stayId: 'stay1', replacement: { name: 'Hotel B', area: 'District 3', note: 'Quiet', estimatedNightlyVnd: 900_000 } }

beforeEach(() => {
  h.profile = { id: 'owner' }
  h.limited = false
  h.calls = []
  h.result = { ok: true }
})

describe('POST /api/itineraries/[id]/stays', () => {
  it('passes a real nightly price straight through', async () => {
    const res = await post(VALID)
    expect(res.status).toBe(200)
    expect(h.calls[0]).toMatchObject({ itineraryId: 'trip1', stayId: 'stay1', profileId: 'owner' })
    expect(h.calls[0].replacement.estimatedNightly).toBe(900_000)
  })

  // ⚠️ THE REASON THIS FILE EXISTS. 0 is the suggest route's "I could not estimate honestly"; storing
  // it literally records a hotel that costs nothing, and the trip page hides 0 as falsy so nobody
  // would ever SEE that it was wrong. The dialog already maps it, but the dialog is not the boundary.
  it('stores a zero estimate as null, not as a price of zero', async () => {
    await post({ ...VALID, replacement: { ...VALID.replacement, estimatedNightlyVnd: 0 } })
    expect(h.calls[0].replacement.estimatedNightly).toBeNull()
  })

  it('accepts an omitted price as null', async () => {
    await post({ action: 'replace', stayId: 'stay1', replacement: { name: 'Hotel B', area: 'District 3' } })
    expect(h.calls[0].replacement).toMatchObject({ note: null, estimatedNightly: null })
  })

  it('flattens markup out of the stored text', async () => {
    await post({ ...VALID, replacement: { ...VALID.replacement, name: 'Hotel **B**', note: 'See https://evil.example for details' } })
    expect(h.calls[0].replacement.name).toBe('Hotel B')
    expect(h.calls[0].replacement.note).not.toContain('evil.example')
  })

  it.each([
    ['a name that is only markup', { ...VALID.replacement, name: '**' }],
    ['an empty area', { ...VALID.replacement, area: '   ' }],
    ['a negative price', { ...VALID.replacement, estimatedNightlyVnd: -1 }],
  ])('rejects %s with 400 and never writes', async (_label, replacement) => {
    const res = await post({ ...VALID, replacement })
    expect(res.status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('rejects an unknown action, so this endpoint cannot grow a delete by accident', async () => {
    const res = await post({ ...VALID, action: 'delete' })
    expect(res.status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('rejects unknown fields rather than ignoring them', async () => {
    const res = await post({ ...VALID, replacement: { ...VALID.replacement, currency: 'USD' } })
    expect(res.status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('401s a signed-out caller before touching the limiter or the database', async () => {
    h.profile = null
    expect((await post(VALID)).status).toBe(401)
    expect(h.calls).toHaveLength(0)
  })

  it('429s when rate limited', async () => {
    h.limited = true
    expect((await post(VALID)).status).toBe(429)
    expect(h.calls).toHaveLength(0)
  })

  it.each([
    ['not_found', 404],
    ['stale', 409],
    ['update_failed', 500],
  ])('maps %s to %i', async (error, status) => {
    h.result = { ok: false, error }
    expect((await post(VALID)).status).toBe(status)
  })
})
