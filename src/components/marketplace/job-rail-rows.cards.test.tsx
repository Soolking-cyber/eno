// @vitest-environment jsdom
/**
 * A job page's rails on a phone are rows (batch 67), and since 2026-11-14 (owner-approved, cook r06 jobs; it reverses batch 78's
 * ruled list here) they are JOB CARDS 8px apart, as the Jobs page's are (`JOB_CARD_LIST`), in a list of their own inside the
 * Shelf's `phoneRows` box, so shelf.tsx stays as it was. The loaded cards and their placeholder share that list, and the
 * placeholder is the card's (no tile). The page's employer reaches every card (`hideEmployerNamed`).
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
// The card is a split chunk; here a marker that records the listing and the employer it was handed.
vi.mock('next/dynamic', () => ({
  default: () => function Row({ listing, hideEmployerNamed }: { listing: SerializedListingCard; hideEmployerNamed?: string }) {
    return <div data-row={listing.id} data-hide={hideEmployerNamed ?? ''} />
  },
}))

import { JobRailRows, JobRailRowsSkeleton, JOB_RAIL_ROWS } from './job-rail-rows'
import { JOB_CARD_LIST } from './job-card-row-skeleton'

afterEach(cleanup)

const jobs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `j${i}`, category: { slug: 'jobs' } })) as unknown as SerializedListingCard[]
const cards = (el: Element) => {
  const cls = el.className.split(' ')
  expect(cls).toEqual(expect.arrayContaining(JOB_CARD_LIST.split(' ')))
  expect(cls.some((c) => c.includes('border'))).toBe(false)
}

describe('a job rail\'s cards', () => {
  it('sit, at most four, as the direct items of one list, 8px apart', () => {
    const list = render(<JobRailRows listings={jobs(9)} />).container.querySelector('[data-job-rows]')!
    cards(list)
    expect(Array.from(list.children).map((e) => e.getAttribute('data-row'))).toEqual(jobs(JOB_RAIL_ROWS).map((l) => l.id))
  })

  it('hand every card the page\'s employer, and none without one', () => {
    const named = render(<JobRailRows listings={jobs(3)} hideEmployerNamed="Nord Anglia Education" />).container
    expect(Array.from(named.querySelectorAll('[data-row]')).map((e) => e.getAttribute('data-hide'))).toEqual(Array(3).fill('Nord Anglia Education'))
    cleanup()
    const plain = render(<JobRailRows listings={jobs(2)} />).container
    expect(Array.from(plain.querySelectorAll('[data-row]')).map((e) => e.getAttribute('data-hide'))).toEqual(['', ''])
  })

  it('their placeholder is the same list of the card\'s skeletons: the card\'s box, no tile', () => {
    const list = render(<JobRailRowsSkeleton />).container.querySelector('[data-job-rows]')!
    cards(list)
    expect(list.children).toHaveLength(JOB_RAIL_ROWS)
    for (const sk of Array.from(list.children)) {
      expect(sk.className.split(' ')).toEqual(expect.arrayContaining(['rounded-2xl', 'border', 'border-line-strong', 'py-4']))
      expect(sk.querySelector('.h-14')).toBeNull()
    }
  })
})
