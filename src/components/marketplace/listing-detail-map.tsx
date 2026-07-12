'use client'

import dynamic from 'next/dynamic'
import type { SerializedListingCard } from '@/lib/types'
import { Tr } from '@/context/language-context'
import { Spinner } from '@/components/ui/spinner'

const ListingsMap = dynamic(() => import('./listings-map').then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-tint flex flex-col items-center justify-center gap-2 select-none animate-pulse">
      <Spinner size="md" />
      <span className="text-3xs font-bold text-slate-700 uppercase tracking-wider">
        <Tr text="Loading map…" />
      </span>
    </div>
  )
})

type Props = {
  listings: SerializedListingCard[]
  activeDistrict: string
}

export function ListingDetailMap({ listings, activeDistrict }: Props) {
  return (
    <ListingsMap
      listings={listings}
      activeDistrict={activeDistrict}
      onOpenListing={() => {}}
      lang="vi"
    />
  )
}
