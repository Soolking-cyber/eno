import Link from 'next/link'
import { ArrowRight, BadgeCheck, MapPin } from 'lucide-react'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { Header } from './header'
import { Footer } from './footer'
import { Price } from './price'

export type SeoContent = {
  eyebrow: string
  h1: string
  intro: string
  categorySlug: string
  /** CTA label, e.g. "Browse verified housing". */
  cta: string
  sections: { title: string; body: string }[]
  faqs: { q: string; a: string }[]
}

/** Keyword landing page (server-rendered, ISR). Pulls real verified listings for
 *  the target category so the page is substantive + internally links to listings
 *  (crawlable <a>), then funnels to the /c/<slug> category page. Plain English —
 *  these target English expat search queries. */
export async function SeoLanding({ content }: { content: SeoContent }) {
  let listings: ReturnType<typeof serializeListing>[] = []
  try {
    const rows = await db.listing.findMany({
      where: { verified: true, status: 'active', category: { slug: content.categorySlug } },
      orderBy: [{ featured: 'desc' }, { postedAt: 'desc' }],
      take: 8,
      include: { category: true, seller: true },
    })
    listings = rows.map(serializeListing)
  } catch {
    /* DB unreachable at build → render the content shell; ISR fills listings later */
  }

  // FAQPage structured data for rich results.
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: content.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      {content.faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, '\\u003c') }}
        />
      )}
      <Header />
      <main className="flex-1 max-w-5xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        {/* Hero */}
        <p className="eyebrow text-[#0a66c2] mb-2">{content.eyebrow}</p>
        <h1 className="h-display text-[#1a202c]">{content.h1}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[#475569]">{content.intro}</p>
        <Link
          href={`/c/${content.categorySlug}`}
          className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#004182]"
        >
          {content.cta} <ArrowRight className="h-4 w-4" />
        </Link>

        {/* Real verified listings (crawlable internal links) */}
        {listings.length > 0 && (
          <section className="mt-12">
            <h2 className="h-section text-[#1a202c] mb-4">Verified listings</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {listings.map((l) => (
                <Link key={l.id} href={`/listings/${l.id}`} className="group flex flex-col">
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#f1f5f9]">
                    {l.images[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.images[0]}
                        alt={l.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-0.5 px-0.5 pt-2.5">
                    <span className="line-clamp-1 text-sm font-semibold text-[#1a202c] group-hover:text-[#0a66c2]">{l.title}</span>
                    <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} className="text-sm font-bold text-[#0a66c2]" />
                    <span className="flex items-center gap-1 text-xs text-[#64748b]">
                      <MapPin className="h-3 w-3 shrink-0 text-[#94a3b8]" />
                      <span className="truncate">{l.location}</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
            <Link
              href={`/c/${content.categorySlug}`}
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[#0a66c2] hover:underline"
            >
              {content.cta} <ArrowRight className="h-4 w-4" />
            </Link>
          </section>
        )}

        {/* Editorial / keyword sections */}
        <div className="mt-14 space-y-8">
          {content.sections.map((s, i) => (
            <section key={i}>
              <h2 className="h-section text-[#1a202c] mb-2">{s.title}</h2>
              <p className="text-[15px] leading-relaxed text-[#475569]">{s.body}</p>
            </section>
          ))}
        </div>

        {/* Verified-trust strip */}
        <div className="mt-12 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-pop">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-[#0a66c2]">
            <BadgeCheck className="h-5 w-5" />
          </span>
          <p className="text-sm leading-relaxed text-[#475569]">
            Every eno.vn listing is checked before it goes live — no fake photos, no bait prices, no wasted trips.{' '}
            <Link href="/about" className="font-semibold text-[#0a66c2] hover:underline">See how verification works</Link>.
          </p>
        </div>

        {/* FAQ */}
        {content.faqs.length > 0 && (
          <section className="mt-12">
            <h2 className="h-section text-[#1a202c] mb-4">Frequently asked questions</h2>
            <div className="space-y-5">
              {content.faqs.map((f, i) => (
                <div key={i}>
                  <h3 className="text-sm font-bold text-[#1a202c]">{f.q}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[#475569]">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Brand line */}
        <p className="mt-14 border-t border-slate-200 pt-6 text-sm leading-relaxed text-[#64748b]">
          <strong className="font-semibold text-[#1a202c]">eno.vn</strong> — a verified marketplace for Vietnam’s
          international community.
        </p>
      </main>
      <Footer />
    </div>
  )
}
