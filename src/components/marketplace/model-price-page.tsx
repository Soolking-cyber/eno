import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Bilingual } from '@/components/marketplace/bilingual'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Tr } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'
import { MODEL_PAGE_SIZE, loadModelPage, modelPageMetadata, modelProductLd, type ModelPageLang } from '@/lib/model-pages'
import { compactVndRange, formatInteger } from '@/lib/vnd'

/**
 * A model's price page — /price/<slug> in English, /gia/<slug> in Vietnamese (src/lib/model-pages.ts has the rules).
 * The H1, the typical-ask line when the band can claim a market, then the set cheapest first. ⚠️ No loading.tsx and no
 * Suspense in these segments: notFound() stays a real 404 and the grid is in the crawler's HTML.
 */
export async function modelPriceMetadata(slug: string, lang: ModelPageLang): Promise<Metadata> {
  const page = await loadModelPage(slug, lang)
  return page ? modelPageMetadata(page.entry, page, lang) : { title: `Not found | ${SITE_NAME}`, robots: { index: false } }
}

export async function ModelPricePage({ slug, lang }: { slug: string; lang: ModelPageLang }) {
  const page = await loadModelPage(slug, lang)
  if (!page) notFound()
  const { entry, params, total, listings } = page
  const band = page.band?.claim ? page.band : null
  const ld = modelProductLd(entry, page.band, listings, lang)
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <h1 className="h-display text-foreground">
          <Bilingual en="{model} price in Vietnam" vi="Giá {model} tại Việt Nam" values={{ model: entry.name }} />
        </h1>
        {band && (
          <p className="mt-2 text-base text-body tabular-nums">
            <Bilingual en="Typical ask {range} · {n} listings" vi="Giá rao phổ biến {range} · {n} tin" values={{ range: compactVndRange(band.p25, band.p75, lang), n: formatInteger(band.n, lang) }} />
          </p>
        )}
        <h2 className="sr-only"><Tr text="Listings" /></h2>
        <div className="mt-6">
          <SellerListings listings={listings} serverScope={{ params, total, pageSize: MODEL_PAGE_SIZE }} initialSort="price-low" look="goods" quietCount={band ? 'always' : undefined} />
        </div>
        {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />}
      </main>
      <Footer />
    </div>
  )
}
