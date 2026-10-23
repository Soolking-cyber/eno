import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Webhook delivery does not follow redirects (refute review, 2026-10-23). Standard Webhooks counts a 3xx as a failed
 * delivery ("update the webhook URL instead"), and following one re-sent the signed body to wherever Location pointed.
 * The 3xx is recorded against the endpoint like any other non-2xx.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ calls: [] as Array<{ url: string; opts: Row }>, status: 200, updates: [] as Row[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ssrf', () => ({
  safeFetch: async (url: string, opts: Row) => { h.calls.push({ url, opts }); return new Response(null, { status: h.status }) },
}))
vi.mock('@/lib/db', () => ({
  db: {
    webhookEndpoint: {
      findMany: async () => [{ id: 'w1', url: 'https://hooks.example/in', secret: 'whsec_c2VjcmV0', events: '*' }],
      update: async (a: Row) => { h.updates.push(a.data); return { failureCount: 1 } },
    },
  },
}))

const { dispatchListingEvent } = await import('./webhooks')

beforeEach(() => { h.calls = []; h.status = 200; h.updates = [] })

describe('webhook delivery and redirects', () => {
  it('⛔ asks safeFetch not to follow redirects', async () => {
    await dispatchListingEvent('listing.created', 'L1', 'shop-1')
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].opts).toMatchObject({ method: 'POST', followRedirects: false })
  })

  it('a 302 is a failed delivery, recorded as such', async () => {
    h.status = 302
    await dispatchListingEvent('listing.created', 'L1', 'shop-1')
    expect(h.updates).toEqual([{ failureCount: { increment: 1 }, lastError: 'HTTP 302' }])
  })
})
