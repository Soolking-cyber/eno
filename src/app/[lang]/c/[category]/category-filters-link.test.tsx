// @vitest-environment jsdom
/**
 * /c's Filters link (category-filters-link.tsx). `iconOnly` (owner-approved 2026-11-14, cook r06 jobs — /c/jobs' phone heading
 * line): the glyph alone on screen, the word "Filters" still the link's text (sr-only), so its name is unchanged.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/components/ui/icons', () => ({ SlidersHorizontal: (p: React.SVGProps<SVGSVGElement>) => <svg {...p} /> }))

import { CategoryFiltersLink } from './category-filters-link'

afterEach(cleanup)

describe('CategoryFiltersLink', () => {
  it('labelled by default: the glyph and the word', () => {
    render(<CategoryFiltersLink slug="jobs" />)
    const a = screen.getByRole('link', { name: 'Filters' })
    expect(a.querySelector('.sr-only')).toBeNull()
    expect(a.getAttribute('rel')).toBe('nofollow')
  })
  it('iconOnly: the same name and href, the word visually hidden, the glyph sized by the caller', () => {
    render(<CategoryFiltersLink slug="jobs" iconOnly glyphClassName="size-5" className="size-11 justify-center p-0" />)
    const a = screen.getByRole('link', { name: 'Filters' })
    expect(a.getAttribute('href')).toBe('/?category=jobs')
    expect(a.querySelector('.sr-only')!.textContent).toBe('Filters')
    expect(a.querySelector('svg')!.getAttribute('class')).toContain('size-5')
    expect(a.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(a.className.split(' ')).toEqual(expect.arrayContaining(['size-11', 'justify-center', 'p-0']))
  })
})
