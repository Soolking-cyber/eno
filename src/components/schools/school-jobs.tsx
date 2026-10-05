'use client'

import { useRouter } from 'next/navigation'
import type { SerializedListingCard } from '@/lib/types'
import { ListingCard } from '@/components/marketplace/listing-card'
import { LISTING_GRID } from '@/components/marketplace/listing-grid'
import { useLanguage } from '@/context/language-context'

/**
 * Open jobs at one school: the house <ListingCard> (no bespoke job card), each captioned with the
 * employer name the ad was POSTED under — the match is by alias, so the teacher sees the evidence
 * (plan review 2026-10-04: "Posted as …").
 */
export function SchoolJobs({ jobs }: { jobs: { card: SerializedListingCard; employer: string | null }[] }) {
  const { tr } = useLanguage()
  const router = useRouter()
  return (
    <ul className={LISTING_GRID}>
      {jobs.map(({ card, employer }) => (
        <li key={card.id} className="min-w-0">
          <ListingCard listing={card} onOpen={(x) => router.push(`/listings/${x.id}`)} sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 220px" />
          {employer && (
            <p className="mt-1 truncate px-1 text-xs text-muted-foreground">
              {tr('Posted as {name}', 'Đăng với tên {name}').replace('{name}', employer)}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
