import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { SITE_NAME } from '@/lib/edition'
import { DeskResolutionError } from '@/lib/edition-scope'
import type { Metadata } from 'next'
import { langMetadata, type LangParams } from '@/lib/lang-metadata'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { FacebookImportLanding } from '@/components/marketplace/facebook-import-landing'
import { FacebookLandingListings } from '@/components/marketplace/facebook-landing-listings'
import { trendingRailListings } from '@/lib/core/trending-rail'
import { logError } from '@/lib/log'
import { localizeListingTitles } from '@/lib/translate'

// An ad's landing (src/lib/fb-import/landing.ts), not a page to find by search.
const METADATA: Metadata = { title: `Import from Facebook | ${SITE_NAME}`, robots: { index: false, follow: false } }
export async function generateMetadata({ params }: LangParams): Promise<Metadata> {
  return langMetadata(params, METADATA, { title: `Nhập tin từ Facebook | ${SITE_NAME}` })
}

/**
 * Static (ISR): no cookie or query read, so the server's HTML is the page — words, button and listings — before any script runs.
 * The listings are the home page's trending rail (owner 2026-11-22 "go": listings first, sign-in on the tap) — scoped and public
 * exactly as on the home page — eight of them (six below lg, two full rows of four from lg), their titles in the page's language as the home page does.
 * Every 5 minutes (commit gate, opus: a listing taken down must not stay on a paid ad's page for an hour; the read is the home
 * page's own, cheap). ⛔ A FAILED READ KEEPS THE LAST GOOD PAGE (commit gate, codex + opus): the home page's rule — only a build
 * may render it without listings; at runtime the error is thrown, so ISR serves the last good page and tries again, and a
 * DeskResolutionError always surfaces.
 */
export const revalidate = 300
const LISTINGS_SHOWN = 8

export default async function FacebookImportLandingPage({ params }: LangParams) {
  const { lang } = await params
  const listings = await trendingRailListings()
    .then((rows) => localizeListingTitles(rows.slice(0, LISTINGS_SHOWN), lang === 'vi' ? 'vi' : undefined))
    .catch((e: unknown) => {
      if (e instanceof DeskResolutionError || process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw e
      logError(e, { op: 'fb_landing_listings_build' })
      return []
    })
  return (
    <div className="flex min-h-page flex-col">
      <Header />
      {/* The site's page width (the header's max-w-7xl), so a desktop visitor gets a desktop page (owner 2026-11-22 "why desktop
          shows mobile ui"): the pitch stays a short column, the listings take the width in the site's own grid. A phone keeps two across. */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-6 pb-12 pt-8 lg:px-8">
        <div className="max-w-sm"><FacebookImportLanding /></div>
        <FacebookLandingListings listings={listings} />
      </main>
      <Footer />
    </div>
  )
}
