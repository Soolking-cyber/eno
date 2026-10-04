// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { EMAIL_TYPO_PAUSE_MS } from '@/lib/email-typo'

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
  it('no prompt: "Log in or sign up", the email form at once, no fold', async () => {
    render(
      <LanguageProvider initialLang="en" initialViDict={VI_DICT}>
        <SignInDialog open onOpenChange={onOpenChange} />
      </LanguageProvider>,
    )
    // The generic title names no site since auth-04 (2026-10-04): one form both signs in and signs up.
    expect(screen.getByRole('dialog', { name: 'Log in or sign up' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Use email instead$/ })).toBeNull()
  })
})

/**
 * auth-06 (2026-10-04): the email field's checks, in the real form (src/lib/email-typo.ts holds the pure
 * rules). ⚠️ The typo fix waits for a pause in typing — every Gmail address is 'gmail.co' one keystroke
 * before it is done, so a per-keystroke check flashed "@gmail.com?" at nearly everyone.
 */
describe('the email checks', () => {
  function popup() {
    render(
      <LanguageProvider initialLang="en" initialViDict={VI_DICT}>
        <SignInDialog open onOpenChange={onOpenChange} />
      </LanguageProvider>,
    )
    return {
      field: screen.getByRole('textbox', { name: 'Email' }) as HTMLInputElement,
      send: screen.getByRole('button', { name: /Send magic link/ }) as HTMLButtonElement,
    }
  }
  const type = (field: HTMLInputElement, value: string) => fireEvent.change(field, { target: { value } })
  const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms) })

  it('Send waits for a complete address — a "." after the "@", not just the "@"', async () => {
    const { field, send } = popup()
    await arm()
    type(field, 'an@gmail')
    expect(send.disabled).toBe(true)
    type(field, 'an@gmail.com')
    expect(send.disabled).toBe(false)
  })

  const suggestion = () => document.querySelector<HTMLElement>('[data-email-suggestion]')
  const status = () => document.querySelector<HTMLElement>('[data-email-suggestion-status]')!

  it('a domain typo is offered only once typing pauses, a tap takes it, and an address on its way to gmail.com never sees it', async () => {
    const { field } = popup()
    await arm()
    type(field, 'an@gmail.co')
    await wait(150) // a typist's next keystroke
    expect(suggestion()).toBeNull()
    type(field, 'an@gmail.com')
    await wait(EMAIL_TYPO_PAUSE_MS + 50)
    expect(suggestion()).toBeNull()

    type(field, 'an@gmial.com')
    expect(suggestion()).toBeNull()
    await wait(EMAIL_TYPO_PAUSE_MS + 50)
    expect(suggestion()!.textContent).toMatch(/^Did you mean\s*@gmail\.com\s*\?$/)
    fireEvent.click(screen.getByRole('button', { name: '@gmail.com' }))
    expect(field.value).toBe('an@gmail.com')
    expect(suggestion()).toBeNull()
  })

  /**
   * ⛔ NO LAYOUT MOVEMENT (review, 2026-10-04): the suggestion takes the switch row's already-reserved line
   * — it replaces the switches inside the SAME element and adds no sibling — and it is announced through
   * an always-mounted polite live region, not by appearing.
   */
  it('takes the reserved switch row’s line instead of adding one, and is announced by a live region mounted beforehand', async () => {
    const { field } = popup()
    await arm()
    type(field, 'an@gmial.co') // complete, with an "@": the row is shown, the switches in it
    const row = screen.getByRole('button', { name: 'Use a password' }).parentElement!
    const container = row.parentElement!
    const siblings = container.children.length
    expect(status()).toBeTruthy()
    expect(status().getAttribute('role')).toBe('status')
    expect(status().getAttribute('aria-live')).toBe('polite')
    expect(status().textContent).toBe('')
    expect(row.contains(status())).toBe(true)

    type(field, 'an@gmial.com')
    await wait(EMAIL_TYPO_PAUSE_MS + 50)
    expect(row.contains(suggestion())).toBe(true)
    expect(container.children.length).toBe(siblings)
    expect(screen.queryByRole('button', { name: 'Use a password' })).toBeNull()
    expect(status().textContent).toBe('Did you mean @gmail.com?')
  })

  it('"Dismiss" brings the switches back and stops asking for that address — a real domain is never a dead end', async () => {
    const { field } = popup()
    await arm()
    type(field, 'an@gmial.com')
    await wait(EMAIL_TYPO_PAUSE_MS + 50)
    expect(suggestion()).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(suggestion()).toBeNull()
    expect(screen.getByRole('button', { name: 'Use a password' })).toBeTruthy()
    expect(status().textContent).toBe('')
    await wait(EMAIL_TYPO_PAUSE_MS + 50)
    expect(suggestion()).toBeNull()
    expect(field.value).toBe('an@gmial.com')
  })
})
