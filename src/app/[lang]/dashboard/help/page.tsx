import { SITE_NAME } from '@/lib/edition'
import { EnoLoader } from '@/components/ui/eno-loader'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { loadHelpCenter } from '@/lib/help-center-data'
import { HelpClient } from './help-client'

export const metadata: Metadata = {
  title: `Help | ${SITE_NAME}`,
  robots: { index: false, follow: false },
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
