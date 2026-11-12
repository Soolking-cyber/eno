// @vitest-environment jsdom
/**
 * A job page's rails on a phone are rows (batch 67), and since batch 78 (owner 2026-11-12: "continue the ui ux improvement
 * towards 10/10") they are a RULED list, as the Jobs page's are: a hairline under each job in place of the gap
 * (`JOB_ROWS_RULED`), in a list of their own inside the Shelf's `phoneRows` box, so shelf.tsx stays as it was. The loaded
 * rows and their placeholder share that list, and the placeholder is the job row's (no tile).
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
// The row is a split chunk; here a marker that records the listing it was handed.
vi.mock('next/dynamic', () => ({
  default: () => function Row({ listing }: { listing: SerializedListingCard }) { return <div data-row={listing.id} /> },
}))

import { JobRailRows, JobRailRowsSkeleton, JOB_RAIL_ROWS } from './job-rail-rows'
import { JOB_ROWS_RULED } from './compact-listing-row-skeleton'

afterEach(cleanup)

const jobs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `j${i}`, category: { slug: 'jobs' } })) as unknown as SerializedListingCard[]
const ruled = (el: Element) => expect(el.className.split(' ')).toEqual(expect.arrayContaining(JOB_ROWS_RULED.split(' ')))

describe('a job rail\'s rows', () => {
  it('sit, at most four, as the direct items of one ruled list', () => {
    const list = render(<JobRailRows listings={jobs(9)} />).container.querySelector('[data-job-rows]')!
    ruled(list)
    expect(list.className.split(' ')).not.toContain('gap-y-1.5')
    expect(Array.from(list.children).map((e) => e.getAttribute('data-row'))).toEqual(jobs(JOB_RAIL_ROWS).map((l) => l.id))
  })

  it('their placeholder is the same ruled list of job-row skeletons: no tile', () => {
    const list = render(<JobRailRowsSkeleton />).container.querySelector('[data-job-rows]')!
    ruled(list)
    expect(list.children).toHaveLength(JOB_RAIL_ROWS)
    for (const sk of Array.from(list.children)) {
      expect(sk.className.split(' ')).toEqual(expect.arrayContaining(['items-start', 'py-3']))
      expect(sk.querySelector('.h-14')).toBeNull()
    }
  })
})
