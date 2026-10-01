import Link from 'next/link'
import Image from 'next/image'
import { scopedListingWhere } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { safeParse, serializeListing } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { isMockImageUrl } from '@/lib/listing-image'
import { categoryFor, subcategoryFor } from '@/lib/feed-taxonomy'
import { ArrowRight } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { ImageMark } from './image-mark'
import { LISTING_GRID } from './listing-grid'
import { Price } from './price'
import { seoLandingWhere, type SeoLandingTarget } from './seo-landing-where'
import { seoBrowseHref, type SeoBrowseTarget } from './seo-landing-href'

/**
 * THE LIVE LISTING RAIL OF THE SEO PAGES — one query and one markup for SeoLanding (the category
 * landing pages) and SeoArticle (the long-form guides), extracted from seo-landing.tsx (C-GUIDES-CTA,
 * 2026-09-29). A guide about renting ended on "Keep reading" with one inventory link in 6,455px; it now
 * ends on the homes it has just explained how to rent, from the same predicate the housing landing uses.
 *
 * ⚠️ ONE TARGET, SO THE RAIL AND ITS "BROWSE" LINK AGREE: `seoLandingWhere` builds the rows,
 * `seoBrowseHref` the destination, from the same target (see both modules' headers). ⚠️ ONE EXCEPTION,
 * DECIDED IN seo-landing-href.ts: a `subcategoryIn` of several kinds (the housing pages' homes) has no
 * feed param, so its link opens the category hub — a superset of the rail, until `homes=1` lands
 * (src/lib/rental-homes.ts). The query moved
 * here VERBATIM — the accessory guard for model pages, the photo-first partition for subcategory sets,
 * the price order for narrowed pages; only the hover zoom on the photo is gone (below).
 */

/** Shelves whose products are made FOR a device. A model page's rail must never show one. */
const ACCESSORY_SHELVES = new Set(['phone-cases', 'screen-protectors', 'cables-chargers', 'power-banks', 'accessories'])

export type SeoRailTarget = SeoLandingTarget & SeoBrowseTarget
type RailListing = ReturnType<typeof serializeListing>

/**
 * The rail's rows. `known` is false when the query did not return — an outage, or no database at
 * build time — which is NOT the same state as an empty result: SeoLanding's "nothing to browse yet"
 * branch must only ever show for the second (see its `hasNoInventory` note).
 */
export async function loadSeoRail(target: SeoRailTarget): Promise<{ listings: RailListing[]; known: boolean }> {
  try {
    const rows = await db.listing.findMany({
      // ⚠️ ONE INSERTION COVERS TEN LANDING PAGES AND THE GUIDES. This is a COMPONENT, so a route-level
      // audit never finds it — and these pages were built to surface the live visa listings by
      // attribute, which is exactly what must not happen on eno.vn.
      // ⛔ THE SAME PREDICATE `generateMetadata` COUNTS WITH — see seo-landing-where.ts. Built once,
      // in one place, so the rail and the page's own `robots` tag can never disagree about whether
      // the page has inventory.
      where: await scopedListingWhere(seoLandingWhere(target)),
      // Narrowed pages sort by price: these are products (one entry type × one speed), and the
      // question a visitor arrives with is what it costs. Category pages keep featured-then-newest.
      // Narrowed pages sort by price — and a brand/model page is the narrowest of them.
      orderBy: target.subcategorySlug || target.models?.length ? [{ price: 'asc' }] : [{ featured: 'desc' }, { postedAt: 'desc' }],
      // A model page over-fetches so the accessory guard below can drop rows and still fill the rail;
      // a subcategory-set page, so the photo partition below has rows to choose from.
      take: target.models?.length ? 64 : target.subcategoryIn?.length ? 24 : 8,
      include: { category: true, seller: true },
    })
    /**
     * ⚠️ THE RAIL, LIKE THE PRICE TABLE, MUST NOT DEPEND ON A REPAIR SCRIPT HAVING RUN. Both external
     * reviewers found that the table re-derives the shelf from the title and this rail did not, so a
     * case still stored on `phones-tablets` with a phone's model — the exact state 95 live rows were
     * in — would sort to the top of a price-ascending iPhone rail. Only model pages pay for it.
     */
    /**
     * ⚠️ A SUBCATEGORY-SET SHELF LEADS WITH ITS BEST-PHOTOGRAPHED ROWS — a STABLE partition, so each
     * half keeps the featured-then-newest order: three or more photos first, then the rest. Measured
     * 2026-09-29, the housing rail's newest rows were bulk imports with one blur-filled photo. Rows
     * with fewer photos still fill the shelf when nothing better exists; nothing is dropped.
     */
    const photos = (r: (typeof rows)[number]) => safeParse<string[]>(r.images, []).length
    const shown = target.models?.length
      ? rows.filter((r) => {
          const name = r.titleVi || r.title
          const shelf = subcategoryFor(categoryFor(name), name)
          return !(shelf && ACCESSORY_SHELVES.has(shelf))
        }).slice(0, 8)
      : target.subcategoryIn?.length && !target.subcategorySlug
        ? [...rows.filter((r) => photos(r) >= 3), ...rows.filter((r) => photos(r) < 3)].slice(0, 8)
        : rows
    return { listings: await localizeListingTitles(shown.map(serializeListing)), known: true }
  } catch {
    /* DB unreachable at build → render the content shell; ISR fills listings later */
    return { listings: [], known: false }
  }
}

/** The rail's markup: a heading, the grid of real listings (crawlable internal links), a browse link. */
export function SeoListingGrid({
  listings,
  title,
  cta,
  href,
  links,
  className,
  heading = 'h-section',
}: {
  listings: RailListing[]
  title: string
  /** The one CTA over `href`. Unused when `links` is given. */
  cta?: string
  href: string
  /**
   * A hub's child pages, linked INSTEAD of `href` (SeoContent.browseLinks): a narrowed browse link is
   * a query string on the self-canonical `/`, so a hub with real child pages links those.
   */
  links?: { href: string; label: string }[]
  className?: string
  /** The heading step of the page it sits in: the landing pages' h2s are h-section, a guide's h-title. */
  heading?: 'h-section' | 'h-title'
}) {
  return (
    <section className={cn('mt-12', className)}>
      <h2 className={cn(heading, 'text-foreground mb-4')}>{title}</h2>
      <div className={LISTING_GRID}>
        {listings.map((l) => (
          <Link key={l.id} href={`/listings/${l.id}`} className="group flex flex-col">
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-tint">
              {l.images[0] && (
                // ⛔ NO HOVER ZOOM. This photo carried `group-hover:scale-[1.03]`, against the owner's
                // rule that a listing photo never scales on hover — every other card obeys it; the
                // title's underline is the hover signal here, as on <ListingCard>.
                <Image
                  src={l.images[0]}
                  alt={l.title}
                  fill
                  unoptimized={isMockImageUrl(l.images[0]) || undefined}
                  sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                  quality={60}
                  className="object-cover"
                />
              )}
              <ImageMark src={l.images[0]} />
            </div>
            {/* Same shape as <ListingCard>: price → one-line title → location (owner, 2026-09-13). */}
            <div className="flex flex-1 flex-col gap-0.5 px-0.5 pt-2">
              <Price native price={l.price} currency={l.currency} priceUnit={l.priceUnit} listingType={l.listingType} linked={l.isPartnerBooking} className="text-base leading-tight sm:text-lg" />
              <span className="truncate text-sm leading-snug text-foreground group-hover:underline decoration-1 underline-offset-2">{l.title}</span>
              <span className="truncate text-xs text-muted-foreground">{l.location}</span>
            </div>
          </Link>
        ))}
      </div>
      {links ? (
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {links.map((b) => (
            <Link
              key={b.href}
              href={b.href}
              className="inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline"
            >
              {b.label} <ArrowRight className="h-4 w-4" />
            </Link>
          ))}
        </div>
      ) : cta ? (
        <Link
          href={href}
          className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline"
        >
          {cta} <ArrowRight className="h-4 w-4" />
        </Link>
      ) : null}
    </section>
  )
}

/**
 * The rail as a self-loading block, for a page whose content does not otherwise depend on it (a guide).
 *
 * ⚠️ `minCount`: A THIN RAIL IS WORSE THAN NONE ON AN ARTICLE. Two cards under "Homes for rent now"
 * reads as an empty marketplace, which is the opposite of the point; below the floor the article
 * simply ends as it did. SeoLanding does not use this — its "nothing to browse" branch needs the rows
 * itself (it calls loadSeoRail + SeoListingGrid).
 */
export async function SeoListingRail({
  target,
  title,
  cta,
  minCount = 4,
  className,
  heading,
}: {
  target: SeoRailTarget
  title: string
  cta: string
  minCount?: number
  className?: string
  heading?: 'h-section' | 'h-title'
}) {
  const { listings } = await loadSeoRail(target)
  if (listings.length < minCount) return null
  return <SeoListingGrid listings={listings} title={title} cta={cta} href={seoBrowseHref(target)} className={className} heading={heading} />
}
