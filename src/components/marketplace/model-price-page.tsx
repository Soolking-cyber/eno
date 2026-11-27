import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Bilingual } from '@/components/marketplace/bilingual'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Tr } from '@/context/language-context'
import { SITE_NAME } from '@/lib/edition'
import { MODEL_PAGE_SIZE, loadModelPage, modelPageMetadata, modelPagePath, modelProductLd, type ModelPageLang } from '@/lib/model-pages'
import { LANGUAGES } from '@/lib/languages'
import { LangPilotLink } from './lang-pilot-link'
import { compactVndRange, formatInteger } from '@/lib/vnd'
import { modelColours } from '@/lib/model-colours'
import { joinNames } from '@/lib/join-names'

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
  const other: ModelPageLang = lang === 'vi' ? 'en' : 'vi'
  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <h1 className="h-display text-foreground">
          <Bilingual en="{model} price in Vietnam" vi="Giá {model} tại Việt Nam" values={{ model: entry.name }} />
        </h1>
        {band && (
          <p className="mt-2 text-base text-body tabular-nums">
            <Bilingual en="Typical asking price {range} · {n} listings" vi="Giá rao phổ biến {range} · {n} tin" values={{ range: compactVndRange(band.p25, band.p75, lang), n: formatInteger(band.n, lang) }} />
          </p>
        )}
        <h2 className="sr-only"><Tr text="Listings" /></h2>
        <div className="mt-6">
          <SellerListings listings={listings} serverScope={{ params, total, pageSize: MODEL_PAGE_SIZE }} initialSort="price-low" look="goods" quietCount={band ? 'always' : undefined} />
        </div>
        {total > 0 && <ModelAbout model={entry.name} slug={entry.slug} total={total} band={band} lang={lang} />}
        {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />}
        {/* The other-language twin as a LINK (Seobility crawl 3: 25 /gia pages reached only through the sitemap — hreflang is not
            a link). Both addresses are pinned to their language (lang-pinned.ts), so each direction is right, unlike a family's
            negotiating URL (vi-twin-link.tsx). Hidden below sm, still in the HTML, like ViTwinLink. */}
        <div className="max-sm:sr-only max-sm:focus-within:not-sr-only">
          <div className="mt-8 flex justify-end">
            <LangPilotLink href={modelPagePath(slug, other)} target={other} hrefLang={other === 'vi' ? 'vi-VN' : 'en'} label={LANGUAGES.find((l) => l.code === other)!.native} name={entry.name} />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}

/**
 * ⛔ "ABOUT <MODEL> PRICES" UNDER THE GRID (owner, 2026-11-26: "Add below the cards" — shop-about.tsx has the why: Seobility counts
 * a paragraph at ~20+ words and wants three; these pages had the footer's one). The page's own facts — its count and the typical
 * band the line under the H1 already shows — then how to read a price here. Each paragraph is 20+ words in both languages.
 * The sentences are literals so the string harvest and the curated Vietnamese see them.
 */
function ModelAbout({ model, slug, total, band, lang }: { model: string; slug: string; total: number; band: { p25: number; p75: number; n: number } | null; lang: ModelPageLang }) {
  const colours = modelColours(slug)
  const values = { model, site: SITE_NAME, n: formatInteger(total, lang), bn: band ? formatInteger(band.n, lang) : '', range: band ? compactVndRange(band.p25, band.p75, lang) : '' }
  return (
    <section aria-labelledby="model-about" className="mt-10 max-w-2xl space-y-2">
      <h2 id="model-about" className="text-base font-semibold text-foreground">
        <Bilingual en="About {model} prices" vi="Về giá {model}" values={values} />
      </h2>
      <p className="text-sm text-body">
        {band
          ? <Bilingual en="Listings for the {model} on {site} right now: {n}, sorted cheapest first. The typical asking price is {range}, the middle half of {bn} prices; one far below that deserves a closer look." vi="Hiện có {n} tin đăng {model} trên {site}, xếp từ giá thấp nhất. Giá rao phổ biến là {range}, tức nửa giữa của {bn} mức giá; giá thấp hơn hẳn mức đó nên được xem kỹ hơn." values={values} />
          : <Bilingual en="Listings for the {model} on {site} right now: {n}, sorted cheapest first. There are too few comparable prices yet for a typical range, so judge each listing on its own details." vi="Hiện có {n} tin đăng {model} trên {site}, xếp từ giá thấp nhất. Chưa đủ mức giá để so sánh nên chưa có khoảng giá phổ biến; hãy xem kỹ từng tin." values={values} />}
      </p>
      <p className="text-sm text-body">
        <Bilingual
          en="Every price here is what its seller asks; {site} neither sets nor checks prices. Before you buy, compare condition, specs and warranty on each listing, and ask the seller about anything unclear."
          vi="Mỗi mức giá ở đây là giá người bán đưa ra; {site} không đặt giá và không kiểm tra giá. Trước khi mua, hãy so sánh tình trạng, thông số và bảo hành ở từng tin, và hỏi người bán về mọi điểm chưa rõ."
          values={values}
        />
      </p>
      {/* The third (owner, 2026-11-26: "Add a 3rd paragraph" — the short footer took the counted registration line, grid-about.tsx).
          ⚠️ Any goods shelf (modelShelfOk: fashion and furniture too), so nothing device-only — no serial numbers — except where
          the maker's colours are known (model-colours.ts, owner same day: "Official colours line"): the model's own words. */}
      <p className="text-sm text-body">
        {colours
          ? <Bilingual
              en="When you meet, compare the colour: the {model} was sold in {colours}, so any other colour usually means its back or frame was replaced. Test what matters to you before you pay."
              vi="Khi gặp, hãy đối chiếu màu máy: {model} được bán với các màu {colours}, nên màu khác thường có nghĩa là mặt lưng hoặc khung máy đã được thay. Hãy thử những gì bạn cần trước khi trả tiền."
              values={{ model, colours: joinNames(colours.en, 'en') }}
              valuesVi={{ model, colours: joinNames(colours.vi, 'vi') }}
            />
          : <Bilingual
              en="When you meet, check that the item matches its photos and description, and test what matters to you before you pay. Any listing that breaks the rules can be reported from its own page."
              vi="Khi gặp, hãy kiểm tra món đồ có đúng như ảnh và mô tả không, và thử những gì bạn cần trước khi trả tiền. Tin nào vi phạm quy định đều có thể được báo cáo ngay trên trang của tin."
            />}
      </p>
    </section>
  )
}
