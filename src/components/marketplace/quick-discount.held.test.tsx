// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * <QuickDiscount> — the dashboard's price cut, when the edit it sends is HELD for eno's licence check (owner,
 * 2026-10-14). The cut goes through PATCH /api/listings/[id] (updateListingCore), and an e-Visa or Legal & permits
 * listing eno has not approved yet is unpublished by ANY edit there — VietKite's grandfathered rows, live until the
 * /prohibited in-force date, included. The route answers `{ ok: true, held: true }`; a plain "Price lowered" would hide
 * that the listing just left the site, so the toast says it waits for the check instead.
 *
 * ⚠️ EXPLICIT `cleanup` — no vitest globals, so Testing Library registers no afterEach of its own.
 * ⚠️ No tr()/t() call with literal copy in here: the string harvester (scripts/gen-ui-strings.mjs) scans test files too.
 */

const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[], subtle: [] as string[] }))
vi.mock('sonner', () => ({
  toast: { success: (m: string) => { toasts.success.push(m) }, error: (m: string) => { toasts.error.push(m) } },
}))
vi.mock('@/lib/subtle-toast', () => ({ subtleToast: (m: string) => { toasts.subtle.push(m) } }))
const lang = vi.hoisted(() => ({ lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => lang, useTr: () => lang.tr, Tr: ({ text }: { text: string }) => text }))

import { QuickDiscount } from './quick-discount'

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
  Element.prototype.getAnimations ??= () => []
  Element.prototype.scrollIntoView ??= () => {}
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
  }
})

/** What PATCH /api/listings/[id] answers this test. */
let reply: { ok: boolean; body: unknown } = { ok: true, body: { ok: true } }
let sent: Array<{ url: string; init: RequestInit }> = []

beforeEach(() => {
  toasts.success.length = 0
  toasts.error.length = 0
  toasts.subtle.length = 0
  sent = []
  reply = { ok: true, body: { ok: true } }
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    sent.push({ url: String(url), init })
    return Promise.resolve({ ok: reply.ok, json: () => Promise.resolve(reply.body) } as Response)
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Open the dialog, type a lower price, apply. */
async function cutTo(price: string) {
  const onChanged = vi.fn()
  render(<QuickDiscount listing={{ id: 'L1', price: 1_000_000, currency: 'VND' }} onChanged={onChanged} trigger={false} open onOpenChange={() => {}} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: price } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply discount' })) })
  return { onChanged }
}

describe('QuickDiscount — a price cut the server holds for the licence check', () => {
  it('a plain cut says "Price lowered", as before', async () => {
    const { onChanged } = await cutTo('900000')
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('/api/listings/L1')
    expect(JSON.parse(String(sent[0].init.body))).toEqual({ price: 900_000 })
    expect(toasts.success).toEqual(['Price lowered'])
    expect(toasts.subtle).toEqual([])
    expect(onChanged).toHaveBeenCalled()
  })

  it('⛔ `held` → the toast says the listing waits for eno’s licence check, never a bare "Price lowered"', async () => {
    reply = { ok: true, body: { ok: true, held: true } }
    const { onChanged } = await cutTo('900000')
    expect(toasts.success).toEqual([])
    expect(toasts.subtle).toEqual(['Price lowered. This listing stays unpublished until eno’s team has checked the provider’s licence.'])
    // The row is refetched as usual — its chip then reads the generic "Held".
    expect(onChanged).toHaveBeenCalled()
  })

  it('a refusal (409 listing_changed, a licence race) keeps the old "try again" error', async () => {
    reply = { ok: false, body: { error: 'listing_changed' } }
    await cutTo('900000')
    expect(toasts.error).toEqual(['Could not update the price — try again.'])
    expect(toasts.success).toEqual([])
    expect(toasts.subtle).toEqual([])
  })
})
