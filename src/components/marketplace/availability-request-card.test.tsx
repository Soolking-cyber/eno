// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import type { AvailabilityRequestMeta } from '@/lib/rental-check/shared'
import { AvailabilityRequestCard, parseAvailabilityRequestMeta } from './availability-request-card'

/**
 * THE AVAILABILITY-REQUEST CARD — one card, two readers, and the things a screenshot would not show:
 *
 *  1. WHO SEES WHAT. The operator gets the contact FIRST with a deep link to act on it; the requester
 *     gets the "only the eno team sees this" line and the free/no-markup promise, and no deep link to
 *     themselves.
 *  2. THE PROMISE, IN BOTH LANGUAGES, ON THE REQUESTER'S SIDE — the owner's copy requirement is one
 *     line at every step, and this card is the last step.
 *  3. THE REQUIREMENTS ARE INERT TEXT. A pasted URL or number must not become a link in the card.
 *  4. THE MONEY. Vietnamese groups with dots; a comma there is a different number.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
afterEach(cleanup)

const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastSpy }))

beforeEach(() => {
  toastSpy.success.mockReset()
  toastSpy.error.mockReset()
  // The currency provider asks /api/fx for rates; the card's prices are đồng-native, so no rates.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response)))
  try { window.localStorage?.removeItem?.('lang') } catch { /* no usable storage here */ }
})
afterEach(() => { vi.unstubAllGlobals() })

function LangSwitch({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => { if (lang !== to) setLang(to) }, [lang, to, setLang])
  return null
}

function meta(over: Partial<AvailabilityRequestMeta> = {}): AvailabilityRequestMeta {
  return {
    v: 1,
    requestId: 'req-00000001',
    items: [
      { id: 'L1', title: 'Studio in District 1', titleVi: 'Căn hộ Quận 1', image: null, price: 9_000_000, currency: '₫', priceUnit: 'VND/month' },
      { id: 'L2', title: 'Flat in Thao Dien', titleVi: null, image: null, price: 12_500_000, currency: '₫', priceUnit: 'VND/month' },
    ],
    requirements: 'Pets allowed?\nSee https://evil.example/x or call 0909999999',
    contact: { channel: 'zalo', value: '84901234567' },
    origin: 'vn',
    lang: 'en',
    ...over,
  }
}

async function renderCard(lang: Language, m: AvailabilityRequestMeta, mine: boolean) {
  const out = render(
    <LanguageProvider>
      <CurrencyProvider>
        <LangSwitch to={lang} />
        <AvailabilityRequestCard meta={m} mine={mine} />
      </CurrencyProvider>
    </LanguageProvider>,
  )
  // Let the language switch's effect land.
  await act(async () => {})
  return out
}

const FREE_EN = 'Free — the eno team checks for you at no charge, and adds no fee or markup to the rent.'
const FREE_VI = 'Miễn phí — đội ngũ eno kiểm tra giúp bạn, không thu phí và không cộng thêm vào giá thuê.'

describe('parseAvailabilityRequestMeta', () => {
  it('accepts a well-formed card', () => {
    expect(parseAvailabilityRequestMeta(meta())).toEqual(meta())
  })

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a wrong version', { ...meta(), v: 2 }],
    ['no items', { ...meta(), items: [] }],
    ['six items', { ...meta(), items: Array.from({ length: 6 }, (_, i) => ({ ...meta().items[1], id: `L${i}` })) }],
    ['an unknown channel', { ...meta(), contact: { channel: 'sms', value: '1' } }],
    ['an empty contact', { ...meta(), contact: { channel: 'zalo', value: '' } }],
    ['an item id with spaces', { ...meta(), items: [{ ...meta().items[0], id: 'a b' }] }],
    ['a non-numeric price', { ...meta(), items: [{ ...meta().items[0], price: '9000000' }] }],
    ['a bad origin', { ...meta(), origin: 'x' }],
  ])('refuses %s', (_label, m) => {
    expect(parseAvailabilityRequestMeta(m)).toBeNull()
  })
})

describe("the requester's side", () => {
  it('shows the count, the rentals, the contact, who sees it and the free promise', async () => {
    const { container } = await renderCard('en', meta(), true)
    expect(screen.getByText('Availability check · 2 rentals')).toBeTruthy()
    expect(screen.getByText(FREE_EN)).toBeTruthy()
    expect(screen.getByText('Only the eno team sees your contact.')).toBeTruthy()
    expect(screen.getByTestId('rental-contact').textContent).toBe('+84901234567')
    expect(screen.getByText('Studio in District 1')).toBeTruthy()
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/listings/L1', '/listings/L2'])
  })

  it('offers the requester NO deep link to their own contact', async () => {
    await renderCard('en', meta(), true)
    expect(screen.queryByText(/Open in Zalo/)).toBeNull()
  })

  it('speaks Vietnamese: heading, promise, the Vietnamese title, and dotted money', async () => {
    const { container } = await renderCard('vi', meta(), true)
    expect(screen.getByText('Kiểm tra phòng trống · 2 căn')).toBeTruthy()
    expect(screen.getByText(FREE_VI)).toBeTruthy()
    expect(screen.getByText('Căn hộ Quận 1')).toBeTruthy()
    // No Vietnamese title stored → the original title, never a blank row.
    expect(screen.getByText('Flat in Thao Dien')).toBeTruthy()
    expect(container.textContent).toContain('9.000.000')
    expect(container.textContent).not.toContain('9,000,000')
  })

  it('says "1 rental", not "1 rentals"', async () => {
    await renderCard('en', meta({ items: [meta().items[0]] }), true)
    expect(screen.getByText('Availability check · 1 rental')).toBeTruthy()
  })
})

describe("the operator's side", () => {
  it('puts the contact FIRST, with a deep link into Zalo that opens outside the app', async () => {
    const { container } = await renderCard('en', meta(), false)
    const link = screen.getByText(/Open in Zalo/).closest('a')!
    expect(link.getAttribute('href')).toBe('https://zalo.me/84901234567')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    // Document order: contact before the first rental row.
    const text = container.textContent ?? ''
    expect(text.indexOf('+84901234567')).toBeLessThan(text.indexOf('Studio in District 1'))
  })

  it('names the edition and language the request came from', async () => {
    await renderCard('en', meta({ origin: 'forum', lang: 'vi' }), false)
    expect(screen.getByText('eno.forum · VI')).toBeTruthy()
  })

  it('carries none of the requester-facing lines', async () => {
    await renderCard('en', meta(), false)
    expect(screen.queryByText(FREE_EN)).toBeNull()
    expect(screen.queryByText('Only the eno team sees your contact.')).toBeNull()
  })

  it('WhatsApp and email get their own links; mailto stays in the page', async () => {
    let r = await renderCard('en', meta({ contact: { channel: 'whatsapp', value: '14155550100' } }), false)
    expect(screen.getByText(/Open in WhatsApp/).closest('a')!.getAttribute('href')).toBe('https://wa.me/14155550100')
    r.unmount()
    r = await renderCard('en', meta({ contact: { channel: 'email', value: 'anna@example.com' } }), false)
    const mail = screen.getByText(/Write an email/).closest('a')!
    expect(mail.getAttribute('href')).toBe('mailto:anna@example.com')
    expect(mail.getAttribute('target')).toBeNull()
    expect(screen.getByTestId('rental-contact').textContent).toBe('anna@example.com')
  })
})

describe('both sides', () => {
  it.each([true, false])('mine=%s: the requirements are inert pre-wrapped text, never a link', async (mine) => {
    const { container } = await renderCard('en', meta(), mine)
    const req = [...container.querySelectorAll('p')].find((p) => p.textContent?.includes('Pets allowed?'))!
    expect(req.className).toContain('whitespace-pre-wrap')
    expect(req.textContent).toContain('\n')
    expect(req.querySelector('a')).toBeNull()
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.some((h) => h.includes('evil.example') || h.includes('0909999999'))).toBe(false)
  })

  it('omits the requirements block when there are none', async () => {
    await renderCard('en', meta({ requirements: '' }), true)
    expect(screen.queryByText('Your requirements')).toBeNull()
  })

  it('tap-to-copy writes the dialable contact and confirms with a toast', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderCard('en', meta(), false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy contact' })) })
    expect(writeText).toHaveBeenCalledWith('+84901234567')
    expect(toastSpy.success).toHaveBeenCalledWith('Copied')
  })

  it('a copy that the browser refuses says so instead of failing silently', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await renderCard('en', meta(), true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy contact' })) })
    expect(toastSpy.error).toHaveBeenCalled()
  })

  it('draws a placeholder, never a broken image, for a rental with no photo', async () => {
    const { container } = await renderCard('en', meta(), true)
    expect(container.querySelector('img')).toBeNull()
  })
})
