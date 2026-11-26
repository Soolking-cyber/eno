// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * /dashboard/ads › "Create an ad", paid by VietQR bank transfer (src/lib/ads/bank.ts). Pinned: the three periods with their
 * prices; "Pay <amount>" makes the order and its QR is shown with the details to copy and the one sentence on when it starts;
 * every refusal is a plain sentence, never a code; "My own ad" only when the server offers it (the private test), with
 * the review's reasons in words. ⛔ The account here is the fake 0000000000.
 */
type Json = Record<string, unknown>
const h = vi.hoisted(() => ({
  options: { bank: true, shop: true, creative: false, listings: [{ id: 'l1', title: 'Honda Vision' }] } as Json,
  order: { status: 201, body: {} as Json },
  review: { status: 200, body: {} as Json },
  /** When set, the review's answer waits for it (an edit made while the review runs). */
  reviewGate: null as Promise<void> | null,
  posts: [] as { url: string; body: unknown }[],
}))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/normalize-image', () => ({ compressImageFile: async (f: File) => f, isUnsupportedPhoto: () => false, unsupportedPhotoCopy: () => 'x' }))

const ORDER = {
  id: 'ad1', reference: 'ENOAD 7K3F9Q', status: 'awaiting_transfer', kind: 'listing', period: 'month', amount_vnd: 349_000,
  created_at: '2026-11-25T03:00:00.000Z', expires_at: '2026-12-02T03:00:00.000Z',
  pay: { bank: 'ACB', account_name: 'CONG TY TNHH ENO', account_number: '0000000000', qr_svg: '<svg data-qr="1" aria-hidden="true"></svg>' },
  payer_paid_at: null as string | null,
}

const { AdOrderForm, AwaitingOrders, OrderPay, orderErrorText, fold } = await import('./ad-order')

function mount(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  h.options = { bank: true, shop: true, creative: false, listings: [{ id: 'l1', title: 'Honda Vision' }] }
  h.order = { status: 201, body: { order: ORDER } }
  h.posts = []
  h.reviewGate = null
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/ads/options') return new Response(JSON.stringify(h.options), { status: 200 })
    h.posts.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body })
    if (url === '/api/ads/orders') return new Response(JSON.stringify(h.order.body), { status: h.order.status })
    if (url === '/api/ads/orders/ad1/paid') return new Response(JSON.stringify({ order: { ...ORDER, payer_paid_at: '2026-11-25T03:05:00.000Z' } }), { status: 200 })
    if (url === '/api/ads/review') { if (h.reviewGate) await h.reviewGate; return new Response(JSON.stringify(h.review.body), { status: h.review.status }) }
    if (url === '/api/upload') return new Response(JSON.stringify({ urls: ['https://sb.example/storage/v1/object/public/listings/a.webp'] }), { status: 200 })
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Create an ad', () => {
  it('the three periods with their prices: a week 99,000 đ, a month 349,000 đ, a quarter 899,000 đ', async () => {
    mount(<AdOrderForm onOrdered={() => {}} />)
    await flush()
    const group = screen.getByRole('radiogroup', { name: 'How long' })
    expect(group.textContent).toContain('Week99,000 đ')
    expect(group.textContent).toContain('Month349,000 đ')
    expect(group.textContent).toContain('Quarter899,000 đ')
    // While creative ads are in their private test and this is no admin, no "My own ad".
    expect(screen.queryByText('My own ad')).toBeNull()
  })

  it('Pay orders the chosen listing and period, and hands the order on', async () => {
    const onOrdered = vi.fn()
    mount(<AdOrderForm onOrdered={onOrdered} />)
    await flush()
    fireEvent.click(screen.getByRole('radio', { name: /Month/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
    await flush()
    expect(h.posts).toEqual([{ url: '/api/ads/orders', body: { kind: 'listing', listingId: 'l1', period: 'month' } }])
    expect(onOrdered).toHaveBeenCalledWith(ORDER)
  })

  it('the listing is picked by its photo and title, the first preselected; the button names the amount of the period chosen', async () => {
    h.options = { ...h.options, listings: [{ id: 'l1', title: 'Honda Vision', photo: 'https://sb.example/storage/v1/object/public/listings/v.webp' }, { id: 'l2', title: 'Yamaha Janus', photo: null }] }
    const onCancel = vi.fn()
    mount(<AdOrderForm onOrdered={() => {}} onCancel={onCancel} />)
    await flush()
    const listing = screen.getByRole('radiogroup', { name: 'Listing' })
    expect(listing.querySelectorAll('img')).toHaveLength(1)
    expect(screen.getByRole('radio', { name: 'Honda Vision' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'Pay 99,000 đ' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Quarter/ }))
    expect(screen.getByRole('button', { name: 'Pay 899,000 đ' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Yamaha Janus' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pay 899,000 đ' }))
    await flush()
    expect(h.posts).toEqual([{ url: '/api/ads/orders', body: { kind: 'listing', listingId: 'l2', period: 'quarter' } }])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('a shop with many listings gets a search; the chosen one never drops out of the list', async () => {
    h.options = { ...h.options, listings: Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, title: i === 7 ? 'Blue sofa' : `Bike ${i}`, photo: null })) }
    mount(<AdOrderForm onOrdered={() => {}} />)
    await flush()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your listings' }), { target: { value: 'sofa' } })
    expect(screen.getAllByRole('radio', { name: /Bike|sofa/ }).map((r) => r.textContent)).toEqual(['Bike 0', 'Blue sofa'])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your listings' }), { target: { value: 'zzz' } })
    expect(screen.getAllByRole('radio', { name: /Bike|sofa/ }).map((r) => r.textContent)).toEqual(['Bike 0'])
  })

  it('the search ignores accents and case: "xe may" finds "Xe máy", "dien thoai" finds "Điện thoại"', () => {
    expect(fold('Xe máy Honda')).toContain(fold('xe may'))
    expect(fold('Điện thoại')).toBe('dien thoai')
  })

  it('the advertising policy is one tap from Pay', async () => {
    mount(<AdOrderForm onOrdered={() => {}} />)
    await flush()
    expect(screen.getByRole('link', { name: 'Advertising policy' }).getAttribute('href')).toBe('/advertising-policy')
  })

  it('a shop with a few listings gets no search box', async () => {
    mount(<AdOrderForm onOrdered={() => {}} />)
    await flush()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('⛔ a refusal is a sentence, never its code', async () => {
    h.order = { status: 403, body: { error: 'target_refused', reason: 'not_public' } }
    mount(<AdOrderForm onOrdered={() => {}} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
    await flush()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Only a live, public listing can be advertised.')
    expect(alert.textContent).not.toMatch(/target_refused|not_public/)
    const tr = (en: string) => en
    for (const [code, reason] of [['bank_unavailable'], ['rate_limited'], ['creative_ads_not_open'], ['no_shop'], ['target_refused', 'creative_review_stale'], ['target_refused', 'ads_not_allowed'], ['whatever']] as [string, string?][]) {
      expect(orderErrorText(tr, code, reason)).toMatch(/^[A-Z][^_]*\.$/)
    }
  })

  it('⛔ no bank account configured: it says so, and there is nothing to press', async () => {
    h.options = { ...h.options, bank: false }
    mount(<AdOrderForm onOrdered={() => {}} />)
    await flush()
    expect(screen.getByText('Bank transfer isn\'t available yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Pay / })).toBeNull()
  })

  it('"My own ad" when offered: the review is free and its refusal reads as the review\'s own sentences', async () => {
    h.options = { ...h.options, creative: true }
    h.review = { status: 200, body: { review: { status: 'refused', creative_id: null, reasons: [{ code: 'banned_gambling', en: 'Gambling, betting and lotteries cannot be advertised.', vi: 'x' }], permit_classes: [], reused: false, reviewed_at: null } } }
    mount(<AdOrderForm onOrdered={() => {}} />)
    await flush()
    fireEvent.click(screen.getByRole('radio', { name: 'My own ad' }))
    // No picture yet: nothing to review, nothing to pay.
    expect((screen.getByRole('button', { name: 'Review (free)' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true)
    // The picture by upload (no URL to paste): eno's storage answers its https address, which the review gets.
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'ad.png', { type: 'image/png' })] } })
    await flush()
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Win big tonight' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review (free)' }))
    await flush()
    // The listing Post form's upload, unwatermarked ('avatar'): the advertiser's own artwork.
    expect((h.posts.find((p) => p.url === '/api/upload')!.body as FormData).get('kind')).toBe('avatar')
    const review = h.posts.find((p) => p.url === '/api/ads/review')!.body as { creative: Record<string, unknown> }
    expect(review.creative).toMatchObject({ headline: 'Win big tonight', imageUrl: 'https://sb.example/storage/v1/object/public/listings/a.webp' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Gambling, betting and lotteries cannot be advertised.')
    expect(alert.textContent).not.toContain('banned_gambling')
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('an approved own ad orders by its creative id', async () => {
    h.options = { ...h.options, creative: true }
    h.review = { status: 200, body: { review: { status: 'approved', creative_id: 'cr9', reasons: [], permit_classes: [], reused: false, reviewed_at: '2026-11-25T03:00:00.000Z' } } }
    mount(<AdOrderForm onOrdered={() => {}} />)
    await flush()
    fireEvent.click(screen.getByRole('radio', { name: 'My own ad' }))
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'ad.png', { type: 'image/png' })] } })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Review (free)' }))
    await flush()
    expect(screen.getByText('Approved. You can pay now.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
    await flush()
    expect(h.posts.at(-1)).toEqual({ url: '/api/ads/orders', body: { kind: 'creative', creativeId: 'cr9', period: 'week' } })
  })

  it('⛔ an approval that comes back after the ad was edited is dropped: what is paid for is what was reviewed', async () => {
    h.options = { ...h.options, creative: true }
    h.review = { status: 200, body: { review: { status: 'approved', creative_id: 'cr9', reasons: [], permit_classes: [], reused: false, reviewed_at: '2026-11-25T03:00:00.000Z' } } }
    let release = () => {}
    h.reviewGate = new Promise<void>((r) => { release = r })
    mount(<AdOrderForm onOrdered={() => {}} />)
    await flush()
    fireEvent.click(screen.getByRole('radio', { name: 'My own ad' }))
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['x'], 'ad.png', { type: 'image/png' })] } })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Review (free)' }))
    await flush()
    // The fields are locked while the review runs; a new picture (the one change still possible by script) bumps the ad.
    expect((screen.getByLabelText('Headline') as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['y'], 'ad2.png', { type: 'image/png' })] } })
    await flush()
    release()
    await flush()
    expect(screen.queryByText('Approved. You can pay now.')).toBeNull()
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the orders awaiting their transfer', () => {
  const LISTED = { id: 'ad1', reference: 'ENOAD 7K3F9Q', status: 'awaiting_transfer', kind: 'listing', period: 'month', amount_vnd: 349_000, created_at: ORDER.created_at, expires_at: ORDER.expires_at, target: 'Honda Vision' }

  it('each shows what it advertises, the period, the amount and the reference, with Show QR', () => {
    const onShow = vi.fn()
    mount(<AwaitingOrders orders={[LISTED as never]} onShow={onShow} />)
    expect(screen.getByRole('heading', { name: 'Awaiting transfer' })).toBeTruthy()
    expect(document.body.textContent).toContain('Honda Vision')
    expect(document.body.textContent).toContain('Month · 349,000 đ · ENOAD 7K3F9Q')
    expect(screen.queryByText('Checking your transfer')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }))
    expect(onShow).toHaveBeenCalledWith('ad1')
  })

  it('⛔ Cancel asks first (a shop that already paid keeps the order), then cancels', async () => {
    mount(<AwaitingOrders orders={[LISTED as never]} onShow={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flush()
    expect(screen.getByRole('alertdialog').textContent).toContain('Already sent the money? Keep the order')
    expect(h.posts).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    await flush()
    expect(h.posts).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
    await flush()
    expect(h.posts.map((p) => p.url)).toEqual(['/api/ads/orders/ad1/cancel'])
  })
})

describe('the QR', () => {
  it('shows the VietQR and the details to copy, and when the ad starts', () => {
    mount(<OrderPay order={ORDER as never} />)
    expect(document.querySelector('[data-qr="1"]')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'VietQR code to pay 349,000 đ' })).toBeTruthy()
    const text = document.body.textContent ?? ''
    for (const v of ['ACB', 'CONG TY TNHH ENO', '0000000000', '349000', 'ENOAD 7K3F9Q']) expect(text).toContain(v)
    expect(screen.getAllByRole('button', { name: /^Copy / })).toHaveLength(5)
    expect(text).toContain('Your ad starts as soon as eno confirms the transfer, usually within a few hours. Unpaid orders expire after 7 days.')
  })

  it('"I\'ve paid" tells eno, then thanks the shop in place of the button (owner 2026-11-26)', async () => {
    mount(<OrderPay order={ORDER as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'I\'ve paid' }))
    await flush()
    expect(h.posts.map((p) => p.url)).toEqual(['/api/ads/orders/ad1/paid'])
    expect(screen.getByRole('status').textContent).toBe('Thanks. We\'ll check the transfer and start your ad, usually within a few hours.')
    expect(screen.queryByRole('button', { name: 'I\'ve paid' })).toBeNull()
    // The QR stays, for a shop that pressed it before paying.
    expect(document.querySelector('[data-qr="1"]')).toBeTruthy()
  })

  it('closed while open (an admin\'s Mark paid, or it lapsed): "I\'ve paid" says so, and the QR goes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'order_closed' }), { status: 409 })))
    mount(<OrderPay order={ORDER as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'I\'ve paid' }))
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('This order is already closed.')
    expect(document.querySelector('[data-qr="1"]')).toBeNull()
  })

  it('an order the shop already said it paid opens on the thanks, with no button', () => {
    mount(<OrderPay order={{ ...ORDER, payer_paid_at: '2026-11-25T03:05:00.000Z' } as never} />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'I\'ve paid' })).toBeNull()
  })

  it('an expired or cancelled order shows no QR', () => {
    mount(<OrderPay order={{ ...ORDER, status: 'expired', pay: null } as never} />)
    expect(screen.getByText('This order expired.')).toBeTruthy()
    expect(document.querySelector('[data-qr="1"]')).toBeNull()
  })
})
