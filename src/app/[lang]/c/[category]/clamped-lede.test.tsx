// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { ClampedLede } from './clamped-lede'

/**
 * ⛔ THE CATEGORY LEDE IS ONE LINE ON A PHONE (owner, 2026-10-18: products first on a phone's first screen). Closed, the
 * paragraph clamps to one line and "Show more" sits at the end of that same line (a baseline row); opened, the row lets
 * go — the whole paragraph, "Show less" under it. The words are always all in the DOM (crawlers, screen readers, sm up).
 * jsdom has no media queries: the `max-sm:` classes are the contract.
 */
afterEach(cleanup)
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

const TEXT = 'Phones, laptops and cameras from shops and people across Vietnam, with prices in dong first and dollars beside them.'
const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

describe('<ClampedLede>', () => {
  it('closed: one clamped line with "Show more" beside it — the whole text still in the paragraph', () => {
    render(<LanguageProvider><ClampedLede className="mt-3 text-base">{TEXT}</ClampedLede></LanguageProvider>)
    const p = document.querySelector('[data-category-lede]')!
    expect(p.textContent).toBe(TEXT)
    expect(tokens(p)).toEqual(expect.arrayContaining(['max-sm:line-clamp-1', 'max-sm:min-w-0', 'max-sm:flex-1', 'mt-3']))
    expect(tokens(p)).not.toContain('max-sm:line-clamp-2')
    expect(tokens(p.parentElement)).toEqual(expect.arrayContaining(['max-sm:flex', 'max-sm:items-baseline']))
    const more = screen.getByRole('button', { name: 'Show more' })
    expect(more.parentElement).toBe(p.parentElement) // the same row
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(tokens(more)).toEqual(expect.arrayContaining(['max-sm:-mt-1', '-mb-1', 'py-1', 'max-sm:shrink-0', 'sm:hidden']))
    // ⛔ No hidden 44px extender: the rentals "Check availability" row sits 10px below and the later extender won the overlap.
    expect(tokens(more)).not.toContain('tap-44')
  })

  it('open: the whole paragraph, the row let go, and "Show less" under it', () => {
    render(<LanguageProvider><ClampedLede>{TEXT}</ClampedLede></LanguageProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    const p = document.querySelector('[data-category-lede]')!
    expect(tokens(p).some((c) => c.includes('line-clamp'))).toBe(false)
    expect(tokens(p.parentElement)).not.toContain('max-sm:flex')
    const less = screen.getByRole('button', { name: 'Show less' })
    expect(less.getAttribute('aria-expanded')).toBe('true')
    expect(tokens(less)).not.toContain('max-sm:mt-0')
  })
})
