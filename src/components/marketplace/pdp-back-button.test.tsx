// @vitest-environment jsdom
/**
 * BACK OVER THE LISTING'S PHOTO (owner, 2026-11-10: item 3 of the decision scorecard). The site header is not shown on a
 * phone's photo listing, so this control is the way back. Pinned here: it is a real link to the listing's category (it
 * works before the page hydrates and with script off, like the stylesheet rule that hides the header); once hydrated its
 * tap goes through the shared back brain; it is `hidden` until that same rule shows it (so the two can never both be
 * missing, or both be on screen); and it is named, in the over-media ink.
 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ back: vi.fn((e?: { preventDefault?: () => void }) => { e?.preventDefault?.() }), fallbacks: [] as string[] }))
vi.mock('@/lib/safe-back', () => ({ useSafeBack: (fallback: string) => { h.fallbacks.push(fallback); return h.back } }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'vi', tr: (_en: string, vi: string) => vi }) }))
vi.mock('@/components/ui/icons', () => ({ ChevronLeftIcon: (p: React.SVGProps<SVGSVGElement>) => <svg data-chevron="" {...p} /> }))
vi.mock('next/link', () => ({
  default: ({ href, prefetch, children, ...rest }: { href: string; prefetch?: boolean; children?: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>{children}</a>
  ),
}))

import { PdpBackButton } from './pdp-back-button'

afterEach(() => { cleanup(); h.back.mockClear(); h.fallbacks.length = 0 })

describe('PdpBackButton', () => {
  it('is a real link to the listing\'s category: it works before hydration and with script off', () => {
    const { container } = render(<PdpBackButton fallbackHref="/c/rentals" />)
    const a = container.querySelector('a[data-photo-back]') as HTMLAnchorElement
    expect(a).not.toBeNull()
    expect(a.getAttribute('href')).toBe('/c/rentals')
    // A link, announced as one: no button role put on it, and no <button> around or inside it.
    expect(a.getAttribute('role')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    // Not prefetched: most readers never follow it as a link.
    expect(a.getAttribute('data-prefetch')).toBe('false')
  })

  it('is named in the visitor\'s language, wears the icon button\'s shell, and is hidden until the stylesheet shows it', () => {
    const { container } = render(<PdpBackButton fallbackHref="/c/rentals" />)
    const a = container.querySelector('a[data-photo-back]')!
    expect(a.getAttribute('aria-label')).toBe('Quay lại')
    const cls = a.className.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['hidden', 'tap-44', 'h-9', 'w-9', 'rounded-full', 'plate-host', 'icon-own-ink']))
    // `flex` from the shell must not survive beside `hidden` (tailwind-merge keeps the later one), or the arrow would show everywhere.
    expect(cls).not.toContain('flex')
    const icon = a.querySelector('[data-chevron]')!
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.getAttribute('class')).toContain('size-5')
  })

  it('once hydrated, a tap pops through the shared back brain, with the category as the cold-start fallback', () => {
    const { container } = render(<PdpBackButton fallbackHref="/c/rentals" />)
    expect(h.fallbacks).toEqual(['/c/rentals'])
    const went = fireEvent.click(container.querySelector('a')!)
    expect(h.back).toHaveBeenCalledTimes(1)
    // The handler took the click (preventDefault), so the anchor itself does not also navigate.
    expect(went).toBe(false)
  })
})
