import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The UCP checkout for eno.vn's ads (checkout.ts) over an in-memory kv and a stand-in for the ads' bank order: the session
 * is a quote, the line is the order's once one exists, `completed` only when paid, one bank order per session, and the
 * session is frozen once its order exists. bank.ts's own status rules (orderStatus, payable) are the real ones.
 */
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  kv: new Map<string, { v: unknown; ex?: number }>(),
  orders: new Map<string, Row>(),
  create: vi.fn(),
  target: vi.fn(),
}))

vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => (h.kv.has(k) ? structuredClone(h.kv.get(k)!.v) : null),
    set: async (k: string, v: unknown, o?: { nx?: boolean; ex?: number }) => {
      if (o?.nx && h.kv.has(k)) return null
      h.kv.set(k, { v: structuredClone(v), ex: o?.ex })
      return 'OK'
    },
    del: async (k: string) => { h.kv.delete(k) },
  },
  rateLimit: async () => ({ success: true, resetSec: 1 }),
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock('@/lib/db', () => ({
  db: {
    listingAd: {
      findUnique: async ({ where }: { where: { id: string } }) => h.orders.get(where.id) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        [...h.orders.values()].filter((o) => ['sellerId', 'listingId', 'status', 'via'].every((k) => where[k] === undefined || o[k] === where[k])
          && (!where.payloadJson || (o.payloadJson as Record<string, unknown>)?.ucpCheckout === (where.payloadJson as { equals: string }).equals)),
    },
  },
}))
vi.mock('./ad-item', async (orig) => ({ ...(await orig<typeof import('./ad-item')>()), adTarget: h.target }))
vi.mock('@/lib/ads/bank', async (orig) => {
  const real = await orig<typeof import('@/lib/ads/bank')>()
  return {
    ...real,
    createBankOrder: h.create,
    getBankOrder: async (id: string, sellerId: string, now: Date) => {
      const ad = h.orders.get(id)
      return ad && ad.sellerId === sellerId ? real.orderView(ad as never, now, null) : null
    },
  }
})

const { createCheckout, getCheckout, updateCheckout, cancelCheckout, payCheckout, paySummary, CheckoutError } = await import('./checkout')
const { OAUTH_ISSUER: ORIGIN } = await import('@/lib/api/oauth')

const NOW = new Date('2026-11-28T03:00:00Z')
/** What the pay page shows for a session: its stored line. */
const shownOf = (id: string) => { const s = h.kv.get(`ucp:chk:${id}`)?.v as { listingId?: string; period?: string } | undefined; return { listingId: s?.listingId, period: s?.period } }
const P = 'https://agent.example/.well-known/ucp'
const line = (id: string, quantity = 1) => ({ line_items: [{ item: { id }, quantity }] })
const order = (id: string, extra: Row = {}): Row => ({
  id, sellerId: 's1', via: 'bank', status: 'awaiting_transfer', amount: '99000', createdAt: NOW, failReason: null,
  authNonce: 'ENOAB12', creativeId: null, payloadJson: { period: 'week', priceVnd: 99000 }, ...extra,
})

beforeEach(() => {
  h.kv.clear(); h.orders.clear(); h.create.mockReset(); h.target.mockReset()
  h.target.mockImplementation(async (id: string) => (id === 'L1' || id === 'L2' ? { listingId: id, title: `Flat ${id}`, image: null, url: `https://eno.vn/listings/${id}` } : null))
  h.create.mockImplementation(async (p: { sellerId: string; listingId: string; period: string; ucpCheckout?: string }) => {
    if (p.sellerId !== 's1') return { ok: false, status: 404, code: 'target_refused', reason: 'not_found' }
    const id = `ad${h.orders.size + 1}`
    const amount = p.period === 'month' ? '349000' : '99000'
    h.orders.set(id, order(id, { listingId: p.listingId, amount, payloadJson: { period: p.period, priceVnd: Number(amount), ...(p.ucpCheckout ? { ucpCheckout: p.ucpCheckout } : {}) } }))
    return { ok: true, order: { id, amount_vnd: Number(amount), status: 'awaiting_transfer' } }
  })
})

describe('create', () => {
  it('one ad line → a quote awaiting the shop on eno.vn: requires_escalation, continue_url, a buyer-input message, whole-đồng totals', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as Record<string, any>
    expect(c.status).toBe('requires_escalation')
    expect(c.continue_url).toBe(`${ORIGIN}/dashboard/ads/pay/${c.id}`)
    expect(c.id).toMatch(/^chk_[A-Za-z0-9_-]{22}$/)
    expect(c.messages[0]).toMatchObject({ type: 'error', severity: 'requires_buyer_input' })
    expect(c.ucp).toEqual({ version: '2026-08-25', capabilities: { 'dev.ucp.shopping.checkout': [{ version: '2026-08-25' }] }, payment_handlers: {} })
    expect(c.currency).toBe('VND')
    expect(c.totals).toEqual([{ type: 'subtotal', amount: 99000 }, { type: 'total', amount: 99000 }])
    expect(c.line_items[0]).toMatchObject({ item: { id: 'ad:L1:week', price: 99000 }, quantity: 1, totals: c.totals })
    expect(c.links.map((l: { type: string }) => l.type)).toEqual(['terms_of_service', 'privacy_policy', 'refund_policy'])
    // A quote only: no order was made, and the session lives a day.
    expect(h.create).not.toHaveBeenCalled()
    expect(h.kv.get(`ucp:chk:${c.id}`)?.ex).toBe(86400)
  })

  it('refuses goods, two lines, a quantity, a period left out, and a listing eno.vn may not advertise', async () => {
    await expect(createCheckout(line('cmwxgbu8b000dkcq41duojjhf'), P, NOW)).rejects.toMatchObject({ code: 'item_unavailable' })
    await expect(createCheckout({ line_items: [{ item: { id: 'ad:L1:week' } }, { item: { id: 'ad:L2:week' } }] }, P, NOW)).rejects.toMatchObject({ code: 'invalid_line_items' })
    await expect(createCheckout(line('ad:L1:week', 2), P, NOW)).rejects.toMatchObject({ code: 'invalid_quantity' })
    await expect(createCheckout(line('ad:L1'), P, NOW)).rejects.toBeInstanceOf(CheckoutError)
    await expect(createCheckout(line('ad:HIDDEN:week'), P, NOW)).rejects.toMatchObject({ code: 'item_unavailable' })
  })

  it('another platform cannot read a session', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    expect(await getCheckout(c.id, 'https://other.example/.well-known/ucp', NOW)).toBeNull()
    expect(await getCheckout('chk_nope', P, NOW)).toBeNull()
  })
})

describe('pay (eno.vn, signed in) and the status it drives', () => {
  it('one bank order per session; the owner sees it again; another shop is refused and frees the session', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    const other = await payCheckout(c.id, { sellerId: 's2', profileId: 'p2' }, shownOf(c.id), NOW)
    expect(other).toMatchObject({ ok: false, code: 'target_refused' })
    expect(h.kv.has(`ucp:chk:${c.id}:order`)).toBe(false)
    // …and the quote keeps its own day, not the stretched life of a linked checkout.
    expect(h.kv.get(`ucp:chk:${c.id}`)!.ex).toBeLessThanOrEqual(86400)
    const first = await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)
    expect(first).toMatchObject({ ok: true, order: { id: 'ad1' } })
    const again = await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)
    expect(again).toMatchObject({ ok: true, order: { id: 'ad1' } })
    expect(h.create).toHaveBeenCalledTimes(2) // the refused shop's try and the owner's one order — never a second order
    // The session now outlives the order's admin window and the longest ad.
    expect(h.kv.get(`ucp:chk:${c.id}`)!.ex).toBeGreaterThan((37 + 90) * 86400)
  })

  it('⛔ a press that made its order and lost the link (a crash) never leads to a second order: the next press adopts it', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)
    h.kv.delete(`ucp:chk:${c.id}:order`)
    const again = await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)
    expect(again).toMatchObject({ ok: true, order: { id: 'ad1' } })
    expect(h.create).toHaveBeenCalledTimes(1)
    expect(h.create.mock.calls[0][0]).toMatchObject({ ucpCheckout: c.id })
  })

  it('adoption is only of this checkout\'s own order: never another checkout\'s, nor one made on the dashboard', async () => {
    const a = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    const b = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    h.orders.set('dash', order('dash', { listingId: 'L1' }))
    await payCheckout(a.id, { sellerId: 's1', profileId: 'p1' }, shownOf(a.id), NOW)
    const onB = await payCheckout(b.id, { sellerId: 's1', profileId: 'p1' }, shownOf(b.id), NOW)
    expect(onB.ok && onB.order.id).not.toBe('dash')
    expect(onB.ok && onB.order.id).not.toBe((await paySummary(a.id, 's1', NOW))!.order!.id)
    expect(h.create).toHaveBeenCalledTimes(2)
  })

  it('once linked, the checkout outlives its own session record (the link carries it)', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)
    h.kv.delete(`ucp:chk:${c.id}`)
    const view = await getCheckout(c.id, P, NOW) as Record<string, any>
    expect(view).toMatchObject({ id: c.id, status: 'requires_escalation' })
    expect(Date.parse(view.expires_at) - NOW.getTime()).toBeGreaterThan(37 * 86_400_000)
    expect(await paySummary(c.id, 's1', NOW)).toMatchObject({ order: { id: 'ad1' } })
  })

  it('the order is made only for the line the page showed: a change since → `changed`, no order, the claim released', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    const out = await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, { listingId: 'L1', period: 'quarter' }, NOW)
    expect(out).toMatchObject({ ok: false, code: 'changed' })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.kv.has(`ucp:chk:${c.id}:order`)).toBe(false)
  })

  it('two presses at once make one order', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    const [a, b] = await Promise.all([payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW), payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)])
    expect(h.create).toHaveBeenCalledTimes(1)
    expect([a.ok, b.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1)
    expect([a, b].some((r) => !r.ok && r.code === 'busy') || (a.ok && b.ok)).toBe(true)
  })

  it('status is the order\'s: awaiting → escalation; paid → completed + order; paid but listing gone → review; lapsed → still escalation; closed by eno → canceled', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)
    const st = async () => (await getCheckout(c.id, P, NOW)) as Record<string, any>
    expect((await st()).status).toBe('requires_escalation')
    h.orders.get('ad1')!.status = 'active'
    const paid = await st()
    expect(paid.status).toBe('completed')
    expect(paid.order).toEqual({ id: 'ad1', permalink_url: `${ORIGIN}/dashboard/ads` })
    expect(paid).not.toHaveProperty('continue_url')
    h.orders.get('ad1')!.status = 'review'
    expect((await st()).messages[0]).toMatchObject({ severity: 'requires_buyer_review' })
    Object.assign(h.orders.get('ad1')!, { status: 'cancelled', failReason: 'expired' })
    expect((await st()).status).toBe('requires_escalation')
    // Past the admin's window to match a late transfer, a lapsed order is final.
    const late = new Date(NOW.getTime() + 38 * 86_400_000)
    expect(((await getCheckout(c.id, P, late)) as Record<string, any>).status).toBe('canceled')
    Object.assign(h.orders.get('ad1')!, { status: 'cancelled', failReason: 'cancelled_by_admin' })
    expect((await st()).status).toBe('canceled')
  })

  it('the pay page: the line, and the order only for the shop that made it', async () => {
    const c = await createCheckout(line('ad:L1:month'), P, NOW) as { id: string }
    expect(await paySummary(c.id, 's1', NOW)).toMatchObject({ title: 'Flat L1', period: 'month', amountVnd: 349000, order: null, claimed: false })
    await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)
    expect(await paySummary(c.id, 's1', NOW)).toMatchObject({ order: { id: 'ad1' }, ownOrder: true })
    expect(await paySummary(c.id, 's2', NOW)).toMatchObject({ order: null, ownOrder: false, claimed: true })
    // This shop's own claim never reads as someone else's.
    expect(await paySummary(c.id, 's1', NOW)).toMatchObject({ claimed: false })
  })
})

describe('frozen once its order exists', () => {
  it('update changes the line before an order, never after; the line shown is the order\'s', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    const month = await updateCheckout(c.id, line('ad:L1:month'), P, NOW) as Record<string, any>
    expect(month.totals).toEqual([{ type: 'subtotal', amount: 349000 }, { type: 'total', amount: 349000 }])
    await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)
    const locked = await updateCheckout(c.id, line('ad:L2:quarter'), P, NOW) as Record<string, any>
    expect(locked.messages.at(-1)).toMatchObject({ code: 'checkout_locked' })
    expect(locked.line_items[0].item.id).toBe('ad:L1:month')
    // Even if the session record were changed under it, the line is the order's.
    const raw = h.kv.get(`ucp:chk:${c.id}`)!.v as Record<string, unknown>
    h.kv.set(`ucp:chk:${c.id}`, { v: { ...raw, period: 'quarter', listingId: 'L2' } })
    const view = await getCheckout(c.id, P, NOW) as Record<string, any>
    expect(view.line_items[0].item).toMatchObject({ id: 'ad:L1:month', price: 349000 })
  })

  it('⛔ a crash after the order was made, before it was linked: Cancel is refused and GET shows the order (found by its tag)', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    await payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)
    h.kv.delete(`ucp:chk:${c.id}:order`)
    const refused = await cancelCheckout(c.id, P, NOW) as Record<string, any>
    expect(refused.messages.at(-1)).toMatchObject({ code: 'cancel_not_allowed' })
    h.orders.get('ad1')!.status = 'active'
    expect(((await getCheckout(c.id, P, NOW)) as Record<string, any>).status).toBe('completed')
  })

  it('cancel and Pay take one slot: whichever lands first wins, never both', async () => {
    const c = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    const [cancel, pay] = await Promise.all([cancelCheckout(c.id, P, NOW), payCheckout(c.id, { sellerId: 's1', profileId: 'p1' }, shownOf(c.id), NOW)])
    const canceled = (cancel as Record<string, any>).status === 'canceled'
    expect(canceled).toBe(!pay.ok)
    const view = await getCheckout(c.id, P, NOW) as Record<string, any>
    expect(view.status).toBe(canceled ? 'canceled' : 'requires_escalation')
    expect(h.create).toHaveBeenCalledTimes(canceled ? 0 : 1)
  })

  it('cancel: before an order → canceled (and then final); after an order → refused (the shop cancels on eno.vn)', async () => {
    const a = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    expect(((await cancelCheckout(a.id, P, NOW)) as Record<string, any>).status).toBe('canceled')
    expect(((await cancelCheckout(a.id, P, NOW)) as Record<string, any>).messages.at(-1)).toMatchObject({ code: 'cancel_not_allowed' })
    expect(await payCheckout(a.id, { sellerId: 's1', profileId: 'p1' }, shownOf(a.id), NOW)).toMatchObject({ ok: false, code: 'canceled' })
    const b = await createCheckout(line('ad:L1:week'), P, NOW) as { id: string }
    await payCheckout(b.id, { sellerId: 's1', profileId: 'p1' }, shownOf(b.id), NOW)
    const refused = await cancelCheckout(b.id, P, NOW) as Record<string, any>
    expect(refused.status).toBe('requires_escalation')
    expect(refused.messages.at(-1)).toMatchObject({ code: 'cancel_not_allowed' })
    expect(h.orders.get('ad1')!.status).toBe('awaiting_transfer')
  })
})
