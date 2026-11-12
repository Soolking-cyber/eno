'use client'

import dynamic from 'next/dynamic'
import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/language-context'
import { hereVariant, localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'
import { CompactListingRowSkeleton, COMPACT_LIST_GRID, JOB_ROWS_RULED } from './compact-listing-row-skeleton'
import type { SerializedListingCard } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * A job page's rails on a phone are ROWS, like the Jobs list (batch 67, 2026-11-11; the owner's 2026-11-10 "Jobs as rows" — item 2
 * of the decision scorecard — reaching the two rails under a job: "More jobs from <employer>" and "More like this"). A job has no
 * photo: as a poster card its rail showed two text posters a screen, the title repeated under each.
 *
 * ⚠️ THE ROW IS A SPLIT CHUNK HERE, NOT A STATIC IMPORT. The listing page is one route for every listing type, and a client
 * component it references ships on every listing page (batch 60 measured +3.3 KB on every category page for the same row). So only
 * a page that draws a job rail asks for the row. It is server-rendered into the HTML (`ssr` is next/dynamic's default); if the
 * chunk is still on its way at hydration, the placeholder is the job row's skeleton (`job`: no tile, one role line). These rails
 * sit below the listing's own content, past the first screen.
 * ⛔ THE ROWS ARE RULED (batch 78, owner 2026-11-12): a hairline under each job, in place of the gap (`JOB_ROWS_RULED`). They
 * sit in their OWN list inside the Shelf's `phoneRows` box, so shelf.tsx, which draws other rails too, stays as it was.
 */
const CompactListingRow = dynamic(() => import('./compact-listing-row').then((m) => m.CompactListingRow), {
  loading: () => <CompactListingRowSkeleton job />,
})

/** The rail's list of job rows: the compact list's grid, ruled (one column here: the Shelf shows it below `sm` only). */
const JOB_RAIL_LIST = cn(COMPACT_LIST_GRID, JOB_ROWS_RULED)

/** At most this many rows on a phone; "See all" in the rail's header is the rest. */
export const JOB_RAIL_ROWS = 4

/** Every listing on the rail is a job (the rail is drawn as rows only then). */
export const allJobs = (listings: SerializedListingCard[]) => listings.length > 0 && listings.every((l) => l.category?.slug === 'jobs')

export function JobRailRows({ listings }: { listings: SerializedListingCard[] }) {
  const router = useRouter()
  const { lang } = useLanguage()
  const open = useCallback((l: SerializedListingCard) => router.push(`/listings/${l.id}`), [router])
  const prefetch = useCallback((id: string) => router.prefetch(`/listings/${id}`), [router])
  /** The row's "Show on map" is a `sm:` control and these rows are phone-only; it still goes where the card's does. */
  const locate = useCallback((id: string) => router.push(localizedHref(`/?focus=${id}`, hereVariant(variantOfLanguage(lang)))), [router, lang])
  return (
    <div data-job-rows="" className={JOB_RAIL_LIST}>
      {listings.slice(0, JOB_RAIL_ROWS).map((l, i) => (
        <CompactListingRow key={l.id} listing={l} index={i} onOpen={open} onPrefetch={prefetch} onLocate={locate} lazyThumb />
      ))}
    </div>
  )
}

/** The rows' placeholder while a client-fetched rail loads: the loaded rows' shape, in the same ruled list. */
export function JobRailRowsSkeleton() {
  return <div data-job-rows="" className={JOB_RAIL_LIST}>{Array.from({ length: JOB_RAIL_ROWS }, (_, i) => <CompactListingRowSkeleton key={i} job />)}</div>
}
