import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { HelpCenter } from '@/components/marketplace/help-center'
import { loadHelpCenter } from '@/lib/help-center-data'

export const metadata: Metadata = {
  title: `Help center | ${SITE_NAME}`,
  description: 'Answers about buying, selling, trust, messaging, offers and safe trading on eno.vn — plus practical guides for travelling in Vietnam.',
  alternates: { canonical: '/help' },
}

// The payload carries the VIEWER's own votes and saved flags, read from the request
// cookie — so this page must never be served from a prerendered shell shared between
// accounts. (Same reason /dashboard/forum is force-dynamic.)
export const dynamic = 'force-dynamic'

export default async function HelpPage() {
  const data = await loadHelpCenter()
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-16">
        <HelpCenter data={data} />
      </main>
      <Footer />
    </div>
  )
}
