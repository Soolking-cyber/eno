'use client'

import dynamic from 'next/dynamic'
import type { SerializedListing } from '@/lib/types'

const ListingsMap = dynamic(() => import('./listings-map').then((m) => m.ListingsMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-100 flex flex-col items-center justify-center gap-2 select-none animate-pulse">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0a66c2] border-t-transparent" />
      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
        Loading Map...
      </span>
    </div>
  )
})

type Props = {
  listings: SerializedListing[]
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
