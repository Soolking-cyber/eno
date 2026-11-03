// @vitest-environment jsdom
/** A VISITOR WITH NO SESSION HAS THE ROW IN THE FIRST PAINT, SO NOTHING UNDER IT MOVES WHEN AUTH SETTLES (speed audit, 2026-11-03). A signed-in reader never meets it. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const auth = vi.hoisted(() => ({ value: { user: null as unknown, loading: true, openSignIn: () => {} } }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth.value, preloadSignIn: () => {} }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))

const { CaptureCard } = await import('./capture-card')
const row = (c: HTMLElement) => c.firstElementChild as HTMLElement | null

afterEach(cleanup)

describe('CaptureCard', () => {
  it('while auth loads it is in the HTML, shown only by html.no-session', () => {
    auth.value = { user: null, loading: true, openSignIn: () => {} }
    const { container } = render(<CaptureCard />)
    expect(row(container)?.className).toContain('hidden')
    expect(row(container)?.className).toContain('no-session:flex')
  })
  it('a guest keeps the same row, shown', () => {
    auth.value = { user: null, loading: false, openSignIn: () => {} }
    const { container } = render(<CaptureCard />)
    expect(row(container)?.className).not.toContain('hidden')
    expect(row(container)?.className).toContain('flex')
  })
  it('a signed-in reader has none', () => {
    auth.value = { user: { id: 'u' }, loading: false, openSignIn: () => {} }
    const { container } = render(<CaptureCard />)
    expect(row(container)).toBeNull()
  })
})
