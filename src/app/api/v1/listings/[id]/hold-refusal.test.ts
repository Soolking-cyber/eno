import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE HOLD LEAK ON THE PARTNER API (2026-09-24). setStatusCore and confirmCore refuse a held or
 * suspended shop's relist / confirm with `account_held` / `account_suspended` (src/lib/core/listings.ts;
 * the rule is proved in src/lib/core/identity-gate.test.ts). These routes must put that on the wire as
 * the 403 a blocked create already answers — not the status route's 422 "status must be one of…",
 * which would tell the partner their payload was malformed, and not the confirm route's 404, which
 * would tell them the listing does not exist.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  status: { ok: true, status: 'active' } as Row,
  confirm: { ok: true, bumped: false } as Row,
}))

vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: async () => ({ ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }, rate: { limit: 600, remaining: 599, resetSec: 60, windowSec: 60 } }),
  listingOwnedBy: async () => true,
}))
vi.mock('@/lib/core/listings', () => ({
  setStatusCore: async () => h.status,
  confirmCore: async () => h.confirm,
}))

const { POST: statusPOST } = await import('./status/route')
const { POST: confirmPOST } = await import('./confirm/route')

const params = { params: Promise.resolve({ id: 'L1' }) }
const req = (body?: unknown) => new Request('https://eno.vn/api/v1/listings/L1/x', { method: 'POST', headers: { authorization: 'Bearer k' }, ...(body ? { body: JSON.stringify(body) } : {}) })
async function json(res: Response) { return { status: res.status, body: (await res.json()) as Row } }

beforeEach(() => {
  h.status = { ok: true, status: 'active' }
  h.confirm = { ok: true, bumped: false }
})

describe('POST /api/v1/listings/{id}/status', () => {
  for (const code of ['account_held', 'account_suspended']) {
    it(`${code} → 403 with the code, never the 422 "malformed status"`, async () => {
      h.status = { ok: false, code: 403, error: code }
      const r = await json(await statusPOST(req({ status: 'active' }) as never, params))
      expect(r.status).toBe(403)
      expect(r.body.error).toMatchObject({ code, message: expect.stringMatching(/held or suspended/) })
    })
  }

  it('released_charge_listing_cap → 403 with the code and a sentence naming the limit, never the 422', async () => {
    h.status = { ok: false, code: 403, error: 'released_charge_listing_cap' }
    const r = await json(await statusPOST(req({ status: 'active' }) as never, params))
    expect(r.status).toBe(403)
    expect(r.body.error).toMatchObject({ code: 'released_charge_listing_cap', message: expect.stringContaining('at most 10 active listings') })
  })

  it('a bad status value still answers the 422', async () => {
    h.status = { ok: false, code: 400, error: 'invalid_status' }
    const r = await json(await statusPOST(req({ status: 'nope' }) as never, params))
    expect(r.status).toBe(422)
    expect(r.body.error).toMatchObject({ code: 'invalid_status' })
  })
})

describe('POST /api/v1/listings/{id}/confirm', () => {
  for (const code of ['account_held', 'account_suspended']) {
    it(`${code} → 403 with the code, never the 404 "not found"`, async () => {
      h.confirm = { ok: false, code: 403, error: code }
      const r = await json(await confirmPOST(req() as never, params))
      expect(r.status).toBe(403)
      expect(r.body.error).toMatchObject({ code, message: expect.stringMatching(/held or suspended/) })
    })
  }

  it('released_charge_listing_cap (a revive past the cap) → 403 with the code, never the 404', async () => {
    h.confirm = { ok: false, code: 403, error: 'released_charge_listing_cap' }
    const r = await json(await confirmPOST(req() as never, params))
    expect(r.status).toBe(403)
    expect(r.body.error).toMatchObject({ code: 'released_charge_listing_cap', message: expect.stringContaining('at most 10 active listings') })
  })

  it('a vanished row is still the 404', async () => {
    h.confirm = { ok: false, code: 404, error: 'not_found' }
    const r = await json(await confirmPOST(req() as never, params))
    expect(r.status).toBe(404)
  })
})
