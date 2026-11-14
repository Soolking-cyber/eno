// @vitest-environment jsdom
/**
 * The card skeleton's body (listing-card-skeleton.tsx): price, title and META bars by default and, for a cell its caller
 * KNOWS is a teacher's (`teacher`), name + rate bars and the proof line's 20px bar before the META bar, so a teacher
 * grid's placeholders match the cards' one proof-or-reserve line (owner, 2026-11-12, "build 2"; re-derived 2026-11-14).
 * Since 2026-11-14 (owner-approved, cook r05) the bars are the redesign's line boxes: price 22, title 20, meta 18 (20 from
 * lg) under a pt-2.5 body — 76px on a phone; card-text.test.ts ties them to the type roles.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ListingCardSkeleton } from './listing-card-skeleton'

afterEach(cleanup)

const bodyOf = (c: HTMLElement) => {
  const root = c.firstElementChild as HTMLElement
  // The photo, then the body.
  return root.children[1] as HTMLElement
}

describe('ListingCardSkeleton', () => {
  it('default: three bars (price, title, META) and no proof bar', () => {
    const c = render(<ListingCardSkeleton />).container
    const body = bodyOf(c)
    expect(body.children).toHaveLength(3)
    expect(c.querySelector('[data-skeleton-proof]')).toBeNull()
    expect(body.lastElementChild!.className.split(' ')).toEqual(expect.arrayContaining(['mt-0.5', 'h-[18px]', 'lg:h-5']))
    expect(body.className.split(' ')).toContain('pt-2.5')
    const [price, title] = [...body.children] as HTMLElement[]
    expect(price.className.split(' ')).toContain('h-[22px]')
    expect(title.className.split(' ')).toContain('h-5')
  })

  it('teacher={false} renders exactly the default', () => {
    const a = render(<ListingCardSkeleton className="x" />).container.innerHTML
    cleanup()
    const b = render(<ListingCardSkeleton className="x" teacher={false} />).container.innerHTML
    expect(b).toBe(a)
  })

  it('teacher: four bars — name, rate, the one 14/20 line (the proof or its reserve), the META bar still last (2026-11-14)', () => {
    const c = render(<ListingCardSkeleton teacher />).container
    const body = bodyOf(c)
    expect(body.children).toHaveLength(4)
    const [name, rate, third] = [...body.children] as HTMLElement[]
    // The name and rate line boxes (TEACHER_TITLE_LINE text-t-h3 24 / sm 18·1.375; TEACHER_RATE 20 at every width).
    expect(name.className.split(' ')).toEqual(expect.arrayContaining(['h-6', 'sm:h-[24.75px]']))
    expect(rate.className.split(' ')).toContain('h-5')
    expect(rate.className).not.toMatch(/sm:h-/)
    expect(third.hasAttribute('data-skeleton-proof')).toBe(true)
    expect(third.className.split(' ')).toContain('h-5')
    expect(third.className.split(' ')).not.toContain('mt-0.5')
    expect(c.querySelectorAll('[data-skeleton-proof]')).toHaveLength(1)
    // The teacher info line has no top padding (it is top-aligned), so neither has its bar: 10 + 24 + 2 + 20 + 2 + 20 + 2 + 18 = 98.
    const meta = body.lastElementChild!.className.split(' ')
    expect(meta).toEqual(expect.arrayContaining(['h-[18px]', 'lg:h-5']))
    expect(meta).not.toContain('mt-0.5')
  })
})
