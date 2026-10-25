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
