// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── The emailed code's length comes from the server (security review 2026-10-22, item 2) ───────────────────────────
// The code screen used to render a hardcoded six slots, so GoTrue's MAILER_OTP_LENGTH could not move without an app
// release in lockstep (it drifted 8 → 6 once and broke emailed-code sign-in for everyone). api/auth/email-link now
// answers every send with `codeLength`; the screen sizes its slots, its prompt and its Verify gate from it.

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))

import { SignInDialog } from './sign-in-dialog'

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

let sendAnswer: Record<string, unknown> = {}
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  // input-otp measures itself and probes for a password-manager badge; jsdom has neither API.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null })
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/auth/email-link') ? sendAnswer : {}),
  })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function reachCodeScreen() {
  render(
    <LanguageProvider initialLang="en">
      <SignInDialog open onOpenChange={() => {}} />
    </LanguageProvider>,
  )
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="email"]')!, { target: { value: 'lan@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use a code' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Send code$/ })) })
  await screen.findByRole('button', { name: /Verify/ })
}

describe('the email code screen follows the server\'s code length', () => {
  it('eight digits reported → eight slots, the 8-digit prompt, and Verify waits for all eight', async () => {
    sendAnswer = { ok: true, codeLength: 8 }
    await reachCodeScreen()
    expect(screen.getByText(/Enter the 8-digit code sent to/)).toBeTruthy()
    const input = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!
    expect(input.maxLength).toBe(8)
    fireEvent.change(input, { target: { value: '123456' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Verify/ }).disabled, 'six of eight is not complete').toBe(true)
  })

  it('six reported → today\'s six-slot screen, unchanged', async () => {
    sendAnswer = { ok: true, codeLength: 6 }
    await reachCodeScreen()
    expect(screen.getByText(/Enter the 6-digit code sent to/)).toBeTruthy()
    expect(document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!.maxLength).toBe(6)
  })

  it('an answer with no length (an older server), or a nonsense one, keeps the default six', async () => {
    for (const answer of [{ ok: true }, { ok: true, codeLength: 99 }, { ok: true, codeLength: 'eight' }]) {
      sendAnswer = answer
      await reachCodeScreen()
      expect(document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!.maxLength).toBe(6)
      cleanup()
    }
  })
})
