import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { AdsClient } from './ads-client'

const METADATA: Metadata = {
  title: `Ads | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Quảng cáo | ${SITE_NAME}` })
}

/** /dashboard/ads — the shop's ads and their live figures (owner 2026-11-25: "realtime stats … to industry standard"). */
export default function AdsPage() {
  return <AdsClient />
}
