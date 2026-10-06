import { describe, expect, it, vi } from 'vitest'

// eno.vn hosts a PARTNER's e-Visa desk (2026-10-06): no Eno concierge there — its prompt speaks as eno, the provider,
// and it sends the question to Google AI. The chip is not rendered on eno.vn; this is the server's second lock.
const h = vi.hoisted(() => ({ isServices: false, ask: vi.fn(async () => ({ ok: true, messageId: 'm', step: 1 })), rateLimit: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => 'user-1' }))
vi.mock('@/lib/edition', () => ({ get IS_SERVICES() { return h.isServices } }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: h.rateLimit }))
vi.mock('@/lib/visa/concierge', () => ({ askVisaConcierge: h.ask, VISA_CONCIERGE_QUESTION_MAX: 500 }))
vi.mock('@/lib/visa/dm-flow', () => ({ visaDmFailureFor: () => ({ error: 'internal_error', status: 500 }) }))

const { POST } = await import('./route.svc')
const APP = '11111111-1111-4111-8111-111111111111'
const call = () => POST(new Request(`http://t/api/visa/applications/${APP}/concierge`, { method: 'POST', body: JSON.stringify({ question: 'How long?' }) }), { params: Promise.resolve({ id: APP }) })

describe('Eno concierge × edition', () => {
  it('eno.vn: 503 concierge_unavailable, before the limiter and before any AI call', async () => {
    h.isServices = false
    const res = await call()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'concierge_unavailable' })
    expect(h.rateLimit).not.toHaveBeenCalled()
    expect(h.ask).not.toHaveBeenCalled()
  })

  it('eno.forum: unchanged — the question reaches the concierge', async () => {
    h.isServices = true
    const res = await call()
    expect(res.status).toBe(200)
    expect(h.ask).toHaveBeenCalled()
  })
})
