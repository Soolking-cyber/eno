// @vitest-environment jsdom
/**
 * The row's placeholder carries the row's numbers ("change both or neither", the module's header). Batch 78 (owner
 * 2026-11-12: "continue the ui ux improvement towards 10/10") took the thumbnail off a JOB row, so the placeholder gained a
 * `job` variant with no tile and the job row's own lines; the plain one is untouched. jsdom lays nothing out, so what is
 * pinned is the class each box carries, which is where the heights come from (the header has the sums).
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import { CompactListingRowSkeleton, COMPACT_LIST_GRID, JOB_ROWS_RULED } from './compact-listing-row-skeleton'

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)

describe('CompactListingRowSkeleton', () => {
  it('the plain placeholder keeps its 56px square tile and its two title lines, as before', () => {
    const root = render(<CompactListingRowSkeleton />).container.firstElementChild!
    expect(classes(root)).toEqual(expect.arrayContaining(['items-center', 'gap-3', 'p-1.5', 'pr-1']))
    expect(root.querySelector('.h-14.w-14')).not.toBeNull()
    expect(root.querySelector('.h-\\[38\\.5px\\]')).not.toBeNull()
  })

  it('`job`: no thumbnail, and the job row\'s own numbers (py-3 around one 22px role line, a 20px employer line, the phone line)', () => {
    const root = render(<CompactListingRowSkeleton job />).container.firstElementChild!
    expect(root.querySelector('.h-14')).toBeNull()
    expect(root.querySelector('.w-14')).toBeNull()
    // The real job row's box classes (compact-listing-row.tsx, `job ? …`), copied, not re-derived.
    expect(classes(root)).toEqual(expect.arrayContaining(['flex', 'items-start', 'gap-2', 'py-3', 'sm:pl-1.5', 'sm:pr-1']))
    expect(classes(root)).not.toContain('p-1.5')
    const column = root.firstElementChild!
    expect(root.children).toHaveLength(1)
    const [role, employer, place] = Array.from(column.children)
    expect(classes(role)).toEqual(expect.arrayContaining(['h-5.5']))
    expect(classes(employer)).toEqual(expect.arrayContaining(['mt-0.5', 'h-5']))
    expect(classes(place)).toEqual(expect.arrayContaining(['mt-0.5', 'h-4', 'sm:hidden']))
    expect(column.children).toHaveLength(3)
  })
})

describe('JOB_ROWS_RULED', () => {
  it('over the list grid: a hairline under every item in place of the gap, and no doubled line over a band that draws its own', () => {
    const list = cn(COMPACT_LIST_GRID, JOB_ROWS_RULED).split(' ')
    expect(list).toEqual(expect.arrayContaining(['grid', 'grid-cols-1', 'lg:grid-cols-2', 'gap-x-6', 'gap-y-0', '*:border-b', '*:border-border', '[&>.border-t]:border-t-0']))
    // tailwind-merge drops the list's own row gap, so 12px of the row's padding is all there is either side of a line.
    expect(list).not.toContain('gap-y-1.5')
  })

  it('names tokens only, and no :has() (design-lint: a non-subject :has() restyles the document on every insertion)', () => {
    expect(JOB_ROWS_RULED).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(JOB_ROWS_RULED).not.toMatch(/:has\(/)
  })
})
