import { scopedListingWhere } from '@/lib/edition-scope'
import { SITE_NAME } from '@/lib/edition'
import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { isMockImageUrl } from '@/lib/listing-image'
import { ArrowRight, MapPin } from 'lucide-react'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { Button } from '@/components/ui/button'
import { localizeListingTitles } from '@/lib/translate'
import { Header } from './header'
import { Footer } from './footer'
import { EnoSeal } from './eno-seal'
import { Price } from './price'
import { seoBrowseHref } from './seo-landing-href'
import { hasNoInventory } from './seo-landing-inventory'

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
  /**
   * Additional JSON-LD nodes, emitted verbatim beside the FAQPage block.
   *
   * ⚠️ IT EXISTS FOR ONE REASON: the e-visa pages must declare, in machine-readable form, that the
   * licensed partner is the `provider` of the service and this site only the `broker`. The visible
   * copy has said so since the provider-of-record model landed; structured data that stayed silent
   * would leave a search engine free to read the page as the site's own offering. The node itself is
   * built in src/app/vietnam-evisa/service-jsonld.ts, which never compiles on a marketplace build.
   *
   * Optional and unused by the four marketplace landing pages, so nothing about eno.vn changes.
   */
  jsonLd?: Record<string, unknown>[]
}

/** Keyword landing page (server-rendered, ISR). Pulls real verified listings for
 *  the target category (optionally narrowed to a subcategory + attributes) so the page is
 *  substantive + internally links to listings (crawlable <a>), then funnels to the matching
 *  browse view. Plain English — these target English expat search queries.
 *
 *  `after` is rendered at the END of <main>, below every section and above the footer.
 *
 *  ⚠️ A NODE PROP, NOT A FLAG, AND THAT IS WHAT KEEPS THIS FILE EDITION-NEUTRAL. The services
 *  edition passes <CrossSitePromo/> here; the marketplace's four landing pages pass nothing. An
 *  `IS_SERVICES && <CrossSitePromo/>` inside this component would have been the obvious version and
 *  the wrong one — this file compiles on BOTH editions, so the import alone would pull the promo's
 *  copy into eno.vn's chunks (the alias would stub it, but only because the alias exists; a node
 *  prop needs no alias to be correct). It also keeps the placement decision at the call site, where
 *  "which pages carry the promo" is a question somebody can answer by grepping for the component.
 */
export async function SeoLanding({ content, after }: { content: SeoContent; after?: ReactNode }) {
  let listings: ReturnType<typeof serializeListing>[] = []
  // ⚠️ NOT `listings.length === 0` — the catch below ALSO leaves the array empty when the
  // database is unreachable at build time, and those two states must not share a UI. Treating a
  // transient build failure as "nobody has listed one" would put "Be the first to list one" on a
  // page with a hundred listings until the next ISR regen, a week later. This flag is set only
  // after the query genuinely returns, so an outage falls back to today's behaviour.
  let inventoryKnown = false
  const browseHref = seoBrowseHref(content)
  try {
    const rows = await db.listing.findMany({
      // ⚠️ ONE INSERTION COVERS TEN LANDING PAGES. This is a COMPONENT, so a route-level audit never
      // finds it — and the comment below is the tell: these pages were built to surface the live
      // visa listings by attribute, which is exactly what must not happen on eno.vn.
      where: await scopedListingWhere({
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
      }),
      // Narrowed pages sort by price: these are products (one entry type × one speed), and the
      // question a visitor arrives with is what it costs. Category pages keep featured-then-newest.
      orderBy: content.subcategorySlug ? [{ price: 'asc' }] : [{ featured: 'desc' }, { postedAt: 'desc' }],
      take: 8,
      include: { category: true, seller: true },
    })
    listings = await localizeListingTitles(rows.map(serializeListing))
    inventoryKnown = true
  } catch {
    /* DB unreachable at build → render the content shell; ISR fills listings later */
  }

  // Nothing to browse, and we know it rather than merely failing to look. The predicate lives in
  // its own module so it can be unit-tested — this file imports Prisma, so a test cannot.
  const noInventory = hasNoInventory(inventoryKnown, listings.length)

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
      {content.jsonLd?.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node).replace(/</g, '\\u003c') }}
        />
      ))}
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        {/* Hero */}
        <p className="eyebrow text-accent-foreground mb-2">{content.eyebrow}</p>
        <h1 className="h-display text-foreground">{content.h1}</h1>
        <p className="mt-4 max-w-prose text-base leading-relaxed text-body">{content.intro}</p>
        {/* gap/weight on the BUTTON — see header.tsx: asChild concatenates the child's
            className instead of twMerging it, so overrides there are settled by
            stylesheet order rather than by intent. */}
        {/* ⚠️ AN EMPTY CATEGORY MUST NOT ADVERTISE STOCK. Measured 2026-07-28: `vehicles` had
            ZERO live listings while `honda` was the single most-searched term on the site, and
            this page still led with "Browse motorbikes" over prose promising "You'll find both
            here". A visitor arriving from Google got a confident promise, tapped the CTA, and
            landed on an empty grid — the worst possible first impression on a marketplace whose
            entire pitch is that its listings are real.

            The prose stays (it is about the category, and it is what ranks — these pages are
            substantial original content, not thin doorways, so they keep their index). What
            changes is the promise: the primary action becomes supplying the thing, and browse
            drops to a secondary link. Browse still WORKS, and lands on the explorer's
            zero-results recovery — remove-filters / create an alert / post a Wanted / jump to
            another category — which is already built and good, so this deliberately does not
            duplicate it here. */}
        {noInventory ? (
          <>
            {/* ⚠️ DELIBERATELY NOT INTERPOLATED FROM THE EYEBROW. The obvious version —
                `No {eyebrow.split('·')[0].toLowerCase()} are listed yet` — reads correctly for
                Motorbikes/Jobs/Services and ungrammatically for the other half of the pages
                that use this component: "No housing ARE listed yet", "No e-visa are listed yet".
                A neutral sentence is right on all six; the keyword is already in the h1 directly
                above it. Add an optional per-page override the day one is actually wanted.

                ⚠️ AND IT MUST STAY TRUE WHEN IT GOES STALE, which is why this says "just getting
                started" rather than "nothing is listed here". These pages are ISR at
                `revalidate = 604800` and NOTHING invalidates them on publish — revalidatePath is
                only ever called for `/listings/<id>` — so the first seller in a category would
                otherwise be greeted by a page insisting the category is empty, for up to a WEEK.
                A hard assertion about inventory is exactly the wrong shape of sentence to cache
                for seven days; this one survives a listing appearing an hour later.

                The stronger fix is on-demand revalidation of the landing paths on publish, which
                needs a categorySlug→path registry. Not built: seo-landing-slugs.test.ts scans the
                directory rather than importing a list precisely BECAUSE a registry is the thing
                people forget to update, and these pages have near-zero traffic today. If they ever
                start ranking, build it — and extend that scan to assert the registry is complete,
                so the forgetting is caught by CI. */}
            <p className="mt-6 max-w-3xl text-sm font-semibold text-body">
              This part of the marketplace is just getting started, so there is not much to browse
              here yet.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button asChild variant="cta" size="none" className="gap-1.5 font-semibold">
                <Link href="/post" className="px-5 py-2.5 text-sm">
                  Be the first to list one <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              {/* ⚠️ THE ANCHOR DESCRIBES WHAT THE LINK DOES, NOT WHAT HAPPENS TWO TAPS LATER.
                  An earlier draft read "Or set an alert for when one appears" while pointing at
                  the browse URL — the alert button lives in the explorer's zero-results state, so
                  the link promised an action its destination does not perform. Naming both steps
                  is honest and still routes to the recovery UI that is already built. */}
              <Link
                href={browseHref}
                className="text-sm font-semibold text-accent-foreground hover:underline"
              >
                Or browse the category — you can set an alert there
              </Link>
            </div>
          </>
        ) : (
          <Button asChild variant="cta" size="none" className="gap-1.5 font-semibold">
            <Link
              href={browseHref}
              className="mt-6 px-5 py-2.5 text-sm"
            >
              {content.cta} <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}

        {/* Full-bleed masthead hairline — same negative-margin coupling the category pages use,
            so the SEO-landing family shares their statement-header close. */}
        <div className="mt-8 -mx-3 border-t border-border sm:-mx-6 lg:-mx-8" aria-hidden />

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
                    <Price price={l.price} currency={l.currency} priceUnit={l.priceUnit} className="text-sm font-extrabold text-accent-foreground" />
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
        <div className="web-only mt-12 max-w-3xl space-y-8">
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
          <section className="mt-12 max-w-3xl">
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
          {/* The eno seal, not a lucide badge (icon-language §0b): this strip claims the
              first-party trust score, and that moment is reserved for the signature mark. */}
          <span className="flex h-5 w-5 shrink-0 text-accent-foreground">
            <EnoSeal className="h-5 w-5" />
          </span>
          {/* ⚠️ SITE_NAME, NOT "eno.vn". This component renders on BOTH deployments, so the literal
              had eno.forum's e-visa pages attributing their trust model to the licensed marketplace
              — the same defect class as the Organization JSON-LD and the sitewide meta description,
              in visible copy this time. The trust score is a per-deployment claim about the site the
              reader is on. */}
          <p className="text-sm leading-relaxed text-body">
            Every {SITE_NAME} seller has a public trust score, and buyers can report bad listings — so fakes and bait prices get caught fast.{' '}
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

        {/* Brand line — the site signing its own page, so it names THIS deployment. */}
        <p className="mt-12 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">{SITE_NAME}</strong> — for Vietnam’s
          international community.
        </p>

        {/* Caller-supplied tail block — see the `after` note on the props above. Last inside
            <main> so it can never push the page's own content below the fold. */}
        {after}
      </main>
      <Footer />
    </div>
  )
}
