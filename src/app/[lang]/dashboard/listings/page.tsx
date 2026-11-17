import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { Suspense } from 'react'
import { DashboardTabPanelSkeleton } from '@/components/marketplace/dashboard-tabs'
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
    // The server's HTML can't read ?tab= on this static page, so it paints a loading shape rather than nothing (owner 2026-11-17,
    // "No blank import screen"); the import tab's intro follows as soon as the page runs (facebook-import-panel.tsx).
    <Suspense fallback={<DashboardTabPanelSkeleton />}>
      <ListingsTabs />
    </Suspense>
  )
}
