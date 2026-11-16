// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'

const opened = vi.hoisted(() => [] as string[])
vi.mock('@/lib/native-browser', () => ({ isNativeShell: () => false, openExternal: async (u: string) => { opened.push(u) } }))
vi.mock('@/lib/copy-text', () => ({ copyText: async () => true }))

import { ShareButton, ShareChannels } from './share-button'

afterEach(() => { cleanup(); opened.length = 0 })
const URL_ = 'https://eno.vn/listings/L1'
const wrap = (ui: React.ReactNode) => render(<LanguageProvider initialLang="en" initialViDict={{}}>{ui}</LanguageProvider>)

describe('sharing a teacher profile (owner, 2026-10-11: "easy to share on facebook and zalo or whatsapp")', () => {
  it('the inline row: Zalo, WhatsApp and Facebook buttons open their share pages for THIS link, then Copy link', async () => {
    const user = userEvent.setup()
    wrap(<ShareChannels url={URL_} text="Jane Doe — CELTA teacher" />)
    await user.click(screen.getByRole('button', { name: 'Zalo' }))
    await user.click(screen.getByRole('button', { name: 'WhatsApp' }))
    await user.click(screen.getByRole('button', { name: 'Facebook' }))
    expect(opened).toEqual([
      `https://sp.zalo.me/plugins/share?url=${encodeURIComponent(URL_)}`,
      `https://wa.me/?text=${encodeURIComponent('Jane Doe — CELTA teacher')}%20${encodeURIComponent(URL_)}`,
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(URL_)}`,
    ])
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy()
  })

  it('"More…" opens the system sheet where there is one — and when it cannot be shown, the link is copied: never a dead tap', async () => {
    const user = userEvent.setup()
    // a browser whose sheet refuses (not a dismissal: that is AbortError)
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(async () => { throw Object.assign(new Error('nope'), { name: 'NotAllowedError' }) }) })
    try {
      wrap(<ShareChannels url={URL_} text="Jane Doe" />)
      await user.click(await screen.findByRole('button', { name: 'More…' }))
      expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy()
    } finally { delete (navigator as { share?: unknown }).share }
  })

  it('the button says what is shared: a teacher profile, or the teacher\'s own ("Share my profile")', async () => {
    const user = userEvent.setup()
    wrap(<ShareButton url={URL_} title="Jane Doe" subject="teacher-profile" />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByText('Share this teacher profile')).toBeTruthy()
    cleanup()
    wrap(<ShareButton url={URL_} title="Jane Doe" subject="my-teacher-profile" />)
    expect(screen.getByRole('button', { name: 'Share my profile' })).toBeTruthy()
  })

  it('a listing keeps its own words', async () => {
    const user = userEvent.setup()
    wrap(<ShareButton url={URL_} title="Sofa" price={12_000_000} currency="₫" />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByText('Share this listing')).toBeTruthy()
  })

  it('a RATE is shared with its period ("150,000 ₫ / hour" — an hourly service, 2026-10-14); a flat price without one', async () => {
    const user = userEvent.setup()
    wrap(<ShareButton url={URL_} title="Dog walking" price={150_000} currency="₫" priceUnit="VND/hour" />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(await screen.findByRole('button', { name: 'WhatsApp' }))
    expect(decodeURIComponent(opened[0])).toMatch(/Dog walking — 150,000 .*\/ hour/)
    cleanup(); opened.length = 0
    wrap(<ShareButton url={URL_} title="Sofa" price={12_000_000} currency="₫" priceUnit="VND/service" />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(await screen.findByRole('button', { name: 'WhatsApp' }))
    expect(decodeURIComponent(opened[0])).not.toContain(' / ')
  })
  it('a FREE listing is shared by its title alone — never "— 0 đ" beside a page that says "Free" (sweep, 2026-10-22)', async () => {
    const user = userEvent.setup()
    wrap(<ShareButton url={URL_} title="Free eSIM" price={0} currency="₫" />)
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(await screen.findByRole('button', { name: 'WhatsApp' }))
    const text = decodeURIComponent(opened[0])
    expect(text).toContain('Free eSIM')
    expect(text).not.toMatch(/—\s*0\b/)
  })
})

/** `shape="round"` (owner-approved 2026-11-14, cook r06 jobs — on a linked job's role line below md): a 44px white plate. */
describe('ShareButton shape="round"', () => {
  it('icon-only, named "Share", a 44px plate with a line-strong ring, and it still opens the share card', async () => {
    const user = userEvent.setup()
    wrap(<ShareButton url={URL_} title="Teacher" shape="round" />)
    const btn = screen.getByRole('button', { name: 'Share' })
    expect(btn.className.split(' ')).toEqual(expect.arrayContaining(['size-11', 'rounded-full', 'border', 'border-line-strong', 'bg-background', 'text-foreground']))
    expect(btn.textContent).toBe('')
    await user.click(btn)
    expect(await screen.findByText('Share this listing')).toBeTruthy()
  })
})

/** `shape="pair"` (owner, 2026-11-16 — hub Q21; store-pair.ts): Chat now's equal on a storefront — or, alone, its own width. */
describe('ShareButton shape="pair"', () => {
  it('beside Chat: half the row (flex-1), 44px, its word at every width, its glyph 18px; a long word wraps inside 12px sides', () => {
    wrap(<ShareButton url={URL_} title="Shop" shape="pair" />)
    const btn = screen.getByRole('button', { name: 'Share' })
    expect(btn.className.split(' ')).toEqual(expect.arrayContaining(['flex-1', 'min-w-0', 'min-h-11', 'px-3', 'whitespace-normal', 'text-center']))
    expect(btn.querySelector('span')!.className).toBe('')
    expect(btn.querySelector('svg')!.getAttribute('class')).toContain('size-4.5')
  })

  it('⛔ alone (no Chat: an affiliate-only partner, the visa desk): its own width, never stretched across the row (review, 2026-11-16)', () => {
    wrap(<ShareButton url={URL_} title="Shop" shape="pair" alone />)
    const btn = screen.getByRole('button', { name: 'Share' })
    expect(btn.className.split(' ')).toEqual(expect.arrayContaining(['min-h-11', 'px-8', 'rounded-xl']))
    expect(btn.className.split(' ')).not.toContain('flex-1')
  })
})
