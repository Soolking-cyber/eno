import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { FacebookImportLanding } from '@/components/marketplace/facebook-import-landing'

// An ad's landing (src/lib/fb-import/landing.ts), not a page to find by search.
const METADATA: Metadata = { title: `Import from Facebook | ${SITE_NAME}`, robots: { index: false, follow: false } }
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Nhập tin từ Facebook | ${SITE_NAME}` })
}

/** Static: no cookie or query read, so the server's HTML is the page — words and form — before any script runs. */
export default function FacebookImportLandingPage() {
  return (
    <div className="flex min-h-page flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-sm flex-1 px-6 pb-12 pt-8">
        <FacebookImportLanding />
      </main>
      <Footer />
    </div>
  )
}
