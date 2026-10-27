import { SITE_NAME } from '@/lib/edition'
import { EnoLoader } from '@/components/ui/eno-loader'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { Suspense } from 'react'
import { loadHelpCenter } from '@/lib/help-center-data'
import { HelpClient } from './help-client'

const METADATA: Metadata = {
  title: `Help | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Trợ giúp | ${SITE_NAME}` })
}

// Viewer-scoped vote/save flags come off the request cookie — never prerender.
export const dynamic = 'force-dynamic'

async function HelpBody() {
  return <HelpClient data={await loadHelpCenter()} />
}

export default function HelpPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <EnoLoader size="lg" />
        </div>
      }
    >
      <HelpBody />
    </Suspense>
  )
}
