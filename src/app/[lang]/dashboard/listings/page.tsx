import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { Suspense } from 'react'
import { ListingsTabs } from './listings-tabs'

const METADATA: Metadata = {
  title: `Listings | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Tin đăng | ${SITE_NAME}` })
}

export default function ListingsPage() {
  return (
    <Suspense>
      <ListingsTabs />
    </Suspense>
  )
}
