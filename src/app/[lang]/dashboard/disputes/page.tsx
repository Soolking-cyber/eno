import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { Suspense } from 'react'
import { DisputesClient } from './disputes-client'

const METADATA: Metadata = {
  title: `Disputes | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Khiếu nại | ${SITE_NAME}` })
}

export default function DisputesPage() {
  return (
    <Suspense>
      <DisputesClient />
    </Suspense>
  )
}
