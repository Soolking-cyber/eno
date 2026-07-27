import Link from 'next/link'
import Image from 'next/image'
import { isMockImageUrl } from '@/lib/listing-image'
import { ArrowRight, BadgeCheck, MapPin } from 'lucide-react'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { Button } from '@/components/ui/button'
import { localizeListingTitles } from '@/lib/translate'
import { Header } from './header'
import { Footer } from './footer'
import { Price } from './price'
import { seoBrowseHref } from './seo-landing-href'

export type SeoContent = {
  eyebrow: string
  h1: string
  intro: string
  categorySlug: string
  /**
   * Narrow the page to ONE subcategory of `categorySlug`.
   *
   * ⚠️ WITHOUT THIS, A LANDING PAGE IS ONLY AS PRECISE AS ITS CATEGORY, and for e-visa that was
   * true by luck rather than by design: 14 of the 15 live `services` listings are e-visa products,
   * so a category-only query LOOKED like a visa rail. The moment somebody posts a cleaning listing
   * it stops being one, silently — the rail just starts showing the wrong thing, exactly the kind
   * of failure seo-landing-slugs.test.ts exists to catch a sibling of.
   */
  subcategorySlug?: string
  /**
   * Narrow further by listing ATTRIBUTES (facet key → value), e.g. `{ visaSpeed: '1H' }`.
   *
   * ⚠️ SUBSTRING MATCH ON A JSON STRING, and deliberately the same one the live feed uses:
   * `Listing.attributes` is a String column holding serialized JSON, and
   * `src/app/api/listings/feed-query.ts` filters it with `contains: '"key":"value"'`. Restating
   * that convention here rather than inventing a second one is the point — a landing page and the
   * browse URL it links to must select the same rows, or the page advertises products the filtered
   * view then fails to show. Keys/values are authored in this repo, never user input.
   */
  attributes?: Record<string, string>
  /** CTA label, e.g. "Browse verified housing". */
  cta: string
  sections: { title: string; body: string }[]
  /**
   * Crawlable sibling/child links — how a hub page reaches its long-tail children and how each
   * child gets back. Editorial prose alone leaves the children orphaned: a page nothing links to
   * is a page Google discovers only from the sitemap and treats accordingly.
   */
  related?: { href: string; label: string; blurb: string }[]
  faqs: { q: string; a: string }[]
}

/** Keyword landing page (server-rendered, ISR). Pulls real verified listings for
 *  the target category (optionally narrowed to a subcategory + attributes) so the page is
 *  substantive + internally links to listings (crawlable <a>), then funnels to the matching
 *  browse view. Plain English — these target English expat search queries. */
export async function SeoLanding({ content }: { content: SeoContent }) {
  let listings: ReturnType<typeof serializeListing>[] = []
  const browseHref = seoBrowseHref(content)
  try {
    const rows = await db.listing.findMany({
      where: {
        verified: true,
        status: 'active',
        category: { slug: content.categorySlug },
        ...(content.subcategorySlug ? { subcategorySlug: content.subcategorySlug } : {}),
        // One `contains` per attribute rather than one over the whole object: key order inside
        // the stored JSON is whatever the wizard happened to write, so a multi-key substring
        // would match nothing on most rows. Measured — the live visa listings carry
        // visaEntryType/visaSpeed in three different orders.
        ...(content.attributes
          ? { AND: Object.entries(content.attributes).map(([k, v]) => ({ attributes: { contains: `"${k}":"${v}"` } })) }
          : {}),
      },
      // Narrowed pages sort by price: these are products (one entry type × one speed), and the
      // question a visitor arrives with is what it costs. Category pages keep featured-then-newest.
      orderBy: content.subcategorySlug ? [{ price: 'asc' }] : [{ featured: 'desc' }, { postedAt: 'desc' }],
      take: 8,
      include: { category: true, seller: true },
    })
    listings = await localizeListingTitles(rows.map(serializeListing))
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
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        {/* Hero */}
        <p className="eyebrow text-accent-foreground mb-2">{content.eyebrow}</p>
        <h1 className="h-display text-foreground">{content.h1}</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-body">{content.intro}</p>
        {/* gap/weight on the BUTTON — see header.tsx: asChild concatenates the child's
            className instead of twMerging it, so overrides there are settled by
            stylesheet order rather than by intent. */}
        <Button asChild variant="cta" size="none" className="gap-1.5 font-semibold">
          <Link
            href={browseHref}
            className="mt-6 px-5 py-2.5 text-sm"
          >
            {content.cta} <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>

        {/* Real verified listings (crawlable internal links) */}
        {listings.length > 0 && (
          <section className="mt-12">
            <h2 className="h-section text-foreground mb-4">Trusted listings</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {listings.map((l) => (
                <Link key={l.id} href={`/listings/${l.id}`} className="group flex flex-col">
                  <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-tint">
                    {l.images[0] && (
                      <Image
                        src={l.images[0]}
                        alt={l.title}
                        fill
                        unoptimized={isMockImageUrl(l.images[0]) || undefined}
                        sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                        quality={60}
                        className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-0.5 px-0.5 pt-2.5">
                    <span className="line-clamp-1 text-sm font-semibold text-foreground group-hover:text-accent-foreground">{l.title}</span>
                    <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} className="text-sm font-bold text-accent-foreground" />
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0 text-ink-4" />
                      <span className="truncate">{l.location}</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
            <Link
              href={browseHref}
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline"
            >
              {content.cta} <ArrowRight className="h-4 w-4" />
            </Link>
          </section>
        )}

        {/* Editorial / keyword sections — wide container, readable measure.
            web-only: long-form SEO prose for Google, hidden in the native apps
            (html.native .web-only in globals.css); the listings grid stays. */}
        <div className="web-only mt-14 max-w-3xl space-y-8">
          {content.sections.map((s, i) => (
            <section key={i}>
              <h2 className="h-section text-foreground mb-2">{s.title}</h2>
              <p className="text-base leading-relaxed text-body">{s.body}</p>
            </section>
          ))}
        </div>

        {/* Related pages — real <a> links, and NOT inside `web-only`: unlike the editorial prose
            above these are navigation, useful in the native shell too, and they are the only thing
            connecting a hub to its long-tail children. */}
        {content.related && content.related.length > 0 && (
          <section className="mt-14 max-w-3xl">
            <h2 className="h-section text-foreground mb-4">Keep reading</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {content.related.map((r) => (
                <li key={r.href}>
                  <Link href={r.href} className="group flex flex-col rounded-xl border border-border p-4 hover:border-accent-foreground/40">
                    <span className="flex items-center gap-1 text-sm font-semibold text-foreground group-hover:text-accent-foreground">
                      {r.label} <ArrowRight className="h-4 w-4 shrink-0" />
                    </span>
                    <span className="mt-1 text-sm leading-relaxed text-body">{r.blurb}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Trust strip */}
        <div className="mt-12 flex max-w-3xl items-start gap-3">
          <span className="flex h-5 w-5 shrink-0 text-accent-foreground">
            <BadgeCheck className="h-5 w-5" />
          </span>
          <p className="text-sm leading-relaxed text-body">
            Every eno.vn seller has a public trust score, and buyers can report bad listings — so fakes and bait prices get caught fast.{' '}
            <Link href="/trust" className="font-semibold text-accent-foreground hover:underline">See how trust works</Link>.
          </p>
        </div>

        {/* FAQ — web-only, same reasoning as the editorial sections (the FAQPage
            JSON-LD above is what Google reads either way). */}
        {content.faqs.length > 0 && (
          <section className="web-only mt-12">
            <h2 className="h-section text-foreground mb-4">Frequently asked questions</h2>
            <div className="grid gap-x-14 gap-y-5 lg:grid-cols-2">
              {content.faqs.map((f, i) => (
                <div key={i}>
                  <h3 className="text-sm font-bold text-foreground">{f.q}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-body">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Brand line */}
        <p className="mt-14 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">eno.vn</strong> — the trusted marketplace for Vietnam’s
          international community.
        </p>
      </main>
      <Footer />
    </div>
  )
}
