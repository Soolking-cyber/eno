// @vitest-environment jsdom
/**
 * The route error page ([lang]/error.tsx). ⛔ Its Try again called `reset`, which only cleared the boundary:
 * a page that threw while rendering on the server re-rendered the same failed payload and threw again at once,
 * so the button did nothing. It calls `retry` now (Next 16.3: refresh + reset in one transition).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
// The chrome is not under test and drags in auth, search and notifications.
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

const { default: RouteError } = await import('@/app/[lang]/error')

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('[lang]/error Try again', () => {
  it('⛔ RETRIES instead of only resetting into the same failed payload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const retry = vi.fn()
    const reset = vi.fn()
    render(<RouteError error={new Error('boom')} reset={reset} retry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
  })

  it('falls back to reset should a Next ever stop passing retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reset = vi.fn()
    render(<RouteError error={new Error('boom')} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
