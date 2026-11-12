// @vitest-environment jsdom
/**
 * The card skeleton's body (listing-card-skeleton.tsx): price, title and META bars by default — byte for byte what every
 * surface drew before batch 80 — and, for a cell its caller KNOWS is a teacher's (`teacher`), the proof line's 16px bar
 * between the title and META bars, so a teacher grid's placeholders match the cards' reserved proof line (owner,
 * 2026-11-12, "build 2").
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
    expect(body.lastElementChild!.className.split(' ')).toEqual(expect.arrayContaining(['mt-1', 'h-4', 'lg:h-5']))
  })

  it('teacher={false} renders exactly the default', () => {
    const a = render(<ListingCardSkeleton className="x" />).container.innerHTML
    cleanup()
    const b = render(<ListingCardSkeleton className="x" teacher={false} />).container.innerHTML
    expect(b).toBe(a)
  })

  it('teacher: four bars, the third the proof line\'s 16px bar, the META bar still last', () => {
    const c = render(<ListingCardSkeleton teacher />).container
    const body = bodyOf(c)
    expect(body.children).toHaveLength(4)
    const third = body.children[2] as HTMLElement
    expect(third.hasAttribute('data-skeleton-proof')).toBe(true)
    expect(third.className.split(' ')).toContain('h-4')
    expect(third.className.split(' ')).not.toContain('mt-1')
    expect(c.querySelectorAll('[data-skeleton-proof]')).toHaveLength(1)
    expect(body.lastElementChild!.className.split(' ')).toEqual(expect.arrayContaining(['mt-1', 'h-4', 'lg:h-5']))
  })
})
