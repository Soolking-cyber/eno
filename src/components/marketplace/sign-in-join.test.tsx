// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'

// ── THE sign-in popup in its join presentation — what the "Join eno" prompt opens ─────────────────
// ⛔ It is the one popup (owner, 2026-08-28: "only 1 popup"), so the Google button under test is
// SignInForm's own: the first-party round-trip to /auth/google/start with `next` = the page the visitor
// is on. These tests hold that it is THAT call, not a copy of it.

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))

import { SignInDialog } from './sign-in-dialog'

const assign = vi.fn()
const realLocation = window.location

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

const onOpenChange = vi.fn()
const onMethod = vi.fn()
const onDismiss = vi.fn()

/**
 * The curated Vietnamese the server seeds (vi-overrides), so ui/dialog's <Tr text="Close" /> reads "Đóng".
 * ⚠️ Passed on EVERY render: the dictionary is module state and the first seed wins for the whole file.
 */
const VI_DICT = { Close: VI_OVERRIDES.Close }

function join(lang: 'en' | 'vi' = 'en') {
  return render(
    <LanguageProvider initialLang={lang} initialViDict={VI_DICT}>
      <SignInDialog open onOpenChange={onOpenChange} prompt={{ onMethod, onDismiss }} />
    </LanguageProvider>,
  )
}
const arm = () => act(async () => { vi.advanceTimersByTime(400) })
const btn = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/listings/abc-123', search: '?ref=feed', hash: '', origin: 'http://localhost:3000', href: 'http://localhost:3000/listings/abc-123?ref=feed', assign, reload: vi.fn() },
  })
  assign.mockReset()
  onOpenChange.mockReset()
  onMethod.mockReset()
  onDismiss.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('Join eno — what it says', () => {
  it('is a labelled dialog: "Join eno — it’s free", three real account features, Google first, email folded, a × to close', async () => {
    join()
    const dialog = screen.getByRole('dialog', { name: 'Join eno — it’s free' })
    const text = dialog.textContent ?? ''
    expect(text).toContain('Message sellers directly, and get price-drop alerts on what you ask about')
    expect(text).toContain('Get alerts when new listings match a search you save')
    expect(text).toContain('Post your own listings for free')
    expect(btn(/^Continue with Google$/)).toBeTruthy()
    expect(btn(/^Use email instead$/)).toBeTruthy()
    // ⛔ No "Maybe later" button (owner, 2026-10-01): the only way out is the × (plus Esc / backdrop).
    expect(screen.queryByRole('button', { name: /maybe later/i })).toBeNull()
    expect(btn(/^Close$/)).toBeTruthy()
    // The email form is folded: no field until it is asked for.
    expect(dialog.querySelector('input[type="email"]')).toBeNull()
    // The 18+ / Terms line still sits under the Google button — tapping it makes an account.
    expect(text).toMatch(/By continuing you confirm you are 18 or older and agree to our/)
  })

  it('⛔ an honest soft ask: it never says browsing is blocked, and never promises what saves already do for guests', async () => {
    join()
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).not.toMatch(/to continue|keep browsing|continue browsing|blocked|required|must sign/i)
    expect(text).not.toMatch(/save listings|saved on all|across devices/i)
  })

  it('in Vietnamese', async () => {
    join('vi')
    expect(screen.getByRole('dialog', { name: 'Tham gia eno — miễn phí' })).toBeTruthy()
    expect(btn(/^Dùng email$/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Để sau$/ })).toBeNull()
    expect(btn(/^Đóng$/)).toBeTruthy()
    expect(btn(/^Tiếp tục với Google$/)).toBeTruthy()
  })
})

describe('Join eno — Continue with Google is the sign-in form’s own action', () => {
  it('⛔ the first-party Google round-trip, returning to the CURRENT page (path + query)', async () => {
    join()
    await arm()
    fireEvent.click(btn(/^Continue with Google$/))
    expect(assign).toHaveBeenCalledWith('/auth/google/start?next=%2Flistings%2Fabc-123%3Fref%3Dfeed')
    expect(onMethod).toHaveBeenCalledWith('google')
  })

  it('⛔ a press in its first 400ms is ignored — it appeared on its own, under a thumb already moving', async () => {
    join()
    fireEvent.click(btn(/^Continue with Google$/))
    expect(assign).not.toHaveBeenCalled()
    expect(onMethod).not.toHaveBeenCalled()
    await arm()
    fireEvent.click(btn(/^Continue with Google$/))
    expect(assign).toHaveBeenCalledTimes(1)
  })
})

describe('Join eno — email, in place', () => {
  it('⛔ "Use email instead" opens the email form IN THIS CARD (no navigation) and moves focus into it', async () => {
    join()
    await arm()
    fireEvent.click(btn(/^Use email instead$/))
    await act(async () => { vi.advanceTimersByTime(0) })
    const field = screen.getByRole('textbox', { name: 'Email' })
    expect(document.activeElement).toBe(field)
    expect(onMethod).toHaveBeenCalledWith('email')
    expect(assign).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^Use email instead$/ })).toBeNull()
    // Google stays above it.
    expect(btn(/^Continue with Google$/)).toBeTruthy()
  })
})

describe('Join eno — closing it', () => {
  it('⛔ the × is the dialog’s own close: top-right, a 44px hit area, named "Close" — and it closes (the same path as Esc and the backdrop)', async () => {
    join()
    await arm()
    const x = btn(/^Close$/)
    const cls = (x.getAttribute('class') ?? '').split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining(['tap-44', 'absolute', 'top-3.5', 'right-3.5']))
    fireEvent.click(x)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('a press on the × in its first 400ms is ignored like any other', async () => {
    join()
    fireEvent.click(btn(/^Close$/))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('Esc closes it', async () => {
    join()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('focus moves into the dialog when it opens', async () => {
    join()
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })
})

describe('Join eno — the frame', () => {
  it('a bottom sheet on a phone that rides the keyboard, the centred card from sm up', async () => {
    join()
    const cls = (screen.getByRole('dialog').getAttribute('class') ?? '').split(/\s+/)
    expect(cls).toEqual(expect.arrayContaining([
      'top-auto', 'bottom-[var(--kb-h,0px)]', 'w-full', 'rounded-b-none',
      'sm:top-[calc(50%+var(--vvt,0px)/2-var(--kb-h,0px)/2)]', 'sm:bottom-auto', 'sm:rounded-2xl',
    ]))
    // tailwind-merge dropped the base's centring on the phone.
    expect(cls).not.toContain('top-[calc(50%+var(--vvt,0px)/2-var(--kb-h,0px)/2)]')
    expect(cls).not.toContain('-translate-y-1/2')
  })

  it('every action is a real 44px target', async () => {
    join()
    for (const n of [/^Continue with Google$/, /^Use email instead$/]) {
      expect((btn(n).getAttribute('class') ?? '').split(/\s+/)).toContain('min-h-11')
    }
    // The × is 24px drawn and 44px to the finger (ui/dialog's tap-44 pseudo-element).
    expect((btn(/^Close$/).getAttribute('class') ?? '').split(/\s+/)).toContain('tap-44')
  })
})

describe('the ordinary sign-in popup is unchanged', () => {
  it('no prompt: the site title, the email form at once, no fold', async () => {
    render(
      <LanguageProvider initialLang="en" initialViDict={VI_DICT}>
        <SignInDialog open onOpenChange={onOpenChange} />
      </LanguageProvider>,
    )
    expect(screen.getByRole('dialog', { name: /^Sign in to eno\./ })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Use email instead$/ })).toBeNull()
  })
})
