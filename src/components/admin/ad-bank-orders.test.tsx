// @vitest-environment jsdom
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ADMIN › CATALOGUE › ADS › AWAITING TRANSFER (src/components/admin/ad-bank-orders.tsx) against a mocked order list
 * (src/lib/ads/bank.ts adminBankOrders, tested there). Pinned: each order shows what an admin matches on the bank
 * statement — the reference and the amount — with the kind and target, the shop, the period and when it was made, and the
 * Mark paid / Cancel actions; a lapsed one says Expired.
 */
const h = vi.hoisted(() => ({ orders: [] as Array<Record<string, unknown>>, fail: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/ads/bank', () => ({ adminBankOrders: async () => { if (h.fail) throw new Error('db'); return h.orders } }))
vi.mock('@/components/admin/ad-bank-order-actions', () => ({
  AdBankOrderActions: ({ adId, reference }: { adId: string; reference: string }) => <button data-actions={`${adId}:${reference}`} />,
}))

const { AdBankOrders } = await import('./ad-bank-orders')
const render = async () => new DOMParser().parseFromString(renderToStaticMarkup(await AdBankOrders()), 'text/html')
const at = new Date('2026-11-25T03:00:00Z')

beforeEach(() => {
  h.fail = false
  h.orders = [
    { id: 'ad2', reference: 'ENOAD 7K3F9Q', status: 'awaiting_transfer', kind: 'creative', target: 'Fresh coffee', targetId: 'cr1', sellerId: 's1', shop: 'Saigon Bean', period: 'month', amountVnd: 349_000, createdAt: at, expiresAt: new Date('2026-12-02T03:00:00Z') },
    { id: 'ad1', reference: 'ENOAD ABCDEF', status: 'expired', kind: 'listing', target: 'Honda Vision', targetId: 'l1', sellerId: 's1', shop: 'Saigon Bean', period: 'week', amountVnd: 99_000, createdAt: new Date('2026-11-10T03:00:00Z'), expiresAt: new Date('2026-11-17T03:00:00Z') },
  ]
})

describe('Admin › Ads › Awaiting transfer', () => {
  it('one card per order: reference, amount, kind and target, shop, period, created time, and its actions', async () => {
    const doc = await render()
    expect(doc.querySelector('h2')?.textContent).toBe('Awaiting transfer')
    const [own, listing] = [...doc.querySelectorAll('li')]
    expect(own!.textContent).toContain('ENOAD 7K3F9Q')
    expect(own!.textContent).toContain('349,000 đ')
    expect(own!.textContent).toContain('Own ad: Fresh coffee · Month')
    expect(own!.textContent).toContain('Saigon Bean (s1)')
    expect(own!.textContent).toContain('ordered 2026-11-25 03:00 UTC')
    expect(own!.textContent).not.toContain('Expired')
    expect(listing!.textContent).toContain('Listing: Honda Vision · Week')
    expect(listing!.textContent).toContain('99,000 đ')
    expect(listing!.textContent).toContain('Expired')
    expect([...doc.querySelectorAll('[data-actions]')].map((b) => b.getAttribute('data-actions'))).toEqual(['ad2:ENOAD 7K3F9Q', 'ad1:ENOAD ABCDEF'])
  })

  it('none: says so; a failed read: says so, never a crash', async () => {
    h.orders = []
    expect((await render()).body.textContent).toContain('No order is awaiting a transfer.')
    h.fail = true
    expect((await render()).body.textContent).toContain('could not be read')
  })
})
