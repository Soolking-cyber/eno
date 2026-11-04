// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

vi.mock('@/lib/google-identity', () => ({ googleFirstPartyEnabled: () => true }))

import { SignInDialog } from './sign-in-dialog'

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

const open = async (prompt?: React.ComponentProps<typeof SignInDialog>['prompt']) => {
  render(
    <LanguageProvider initialLang="en" initialViDict={{}}>
      <SignInDialog open onOpenChange={vi.fn()} prompt={prompt} />
    </LanguageProvider>,
  )
  await act(async () => { await Promise.resolve() })
}
const tagOn = (name: RegExp) => screen.getByRole('button', { name }).textContent?.includes('Last used')

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, href: 'https://eno.vn/', pathname: '/', search: '', hash: '', origin: 'https://eno.vn', assign: vi.fn() } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

describe('the sign-in window marks the way this device last signed in', () => {
  it('a first-time visitor sees no mark', async () => {
    await open()
    expect(screen.queryByText('Last used')).toBeNull()
  })

  it('the mark sits on that method\'s button, and the button keeps its name for a screen reader', async () => {
    localStorage.setItem('eno:signin-last', 'google')
    await open()
    expect(tagOn(/continue with google/i)).toBe(true)
    expect(screen.getAllByText('Last used')).toHaveLength(1)
  })

  it('email in the join presentation: on the quiet "Use email instead" button, as the field is folded away', async () => {
    localStorage.setItem('eno:signin-last', 'email')
    await open({ onMethod: vi.fn(), onDismiss: vi.fn() })
    expect(tagOn(/use email instead/i)).toBe(true)
  })

  it('a method this window does not offer shows nothing rather than a mark on the wrong button', async () => {
    localStorage.setItem('eno:signin-last', 'apple')
    await open()
    expect(screen.queryByRole('button', { name: /continue with apple/i })).toBeNull()
    expect(screen.queryByText('Last used')).toBeNull()
  })

  it('tapping a method marks nothing: only a session the server issued does (a cancelled Google is not a sign-in)', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(localStorage.getItem('eno:signin-last')).toBeNull()
  })
})
