import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { AvailabilityClient } from './availability-client'

const METADATA: Metadata = {
  title: `Availability review | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Xem lại tình trạng sẵn có | ${SITE_NAME}` })
}

export default function AvailabilityPage() {
  return <AvailabilityClient />
}
