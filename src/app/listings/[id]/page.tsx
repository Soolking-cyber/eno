import { SITE_NAME } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
import { cache, type ReactNode } from 'react'
import { db } from '@/lib/db'
import { formatMoneyFull, dropPercent } from '@/lib/vnd'
import { serializeListing, safeParse } from '@/lib/serialize'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { ListingGallery } from '@/components/marketplace/listing-gallery'
import { PdpShopLink } from '@/components/marketplace/pdp-shop-link'
import { Badge } from '@/components/ui/badge'
import { Footer } from '@/components/marketplace/footer'
import { BrandLogo } from '@/components/marketplace/brand-logo'
import { CountValue, SavedCount } from '@/components/marketplace/rating-value'
import { brandIconPath } from '@/lib/brand-icons'
import {
  MapPin,
  AlertTriangle,
  Heart,
  Eye,
  Tag,
  Zap,
} from '@/components/ui/icons'
import { RelatedListings } from '@/components/marketplace/related-listings'
import { RecentlyViewedRail } from '@/components/marketplace/recently-viewed-rail'
import { CATEGORY_COLOR_CLASSES } from '@/lib/types'
import { Price } from '@/components/marketplace/price'
import { Tr } from '@/context/language-context'
import { LocalizedTitle, LocalizedText, ListingDescription, PostedAgo } from '@/components/marketplace/listing-content'
import { cachedTranslations } from '@/lib/translate'
import { cn } from '@/lib/utils'
import { ReviewsPreview } from '@/components/marketplace/reviews-preview'
import { SameSellerShelf } from '@/components/marketplace/same-seller-shelf'
import { SoldListing } from '@/components/marketplace/sold-listing'
import { ProtectionsRow } from '@/components/marketplace/protections-row'
import { DropCountdown } from '@/components/marketplace/drop-countdown'
import { LiveUntil } from '@/components/marketplace/live-until'
import { sellerMetrics, topSellerReviews, sameSellerListings } from '@/lib/seller-metrics'
import { ListingDetailMap } from '@/components/marketplace/listing-detail-map'
import { ReportButton } from '@/components/marketplace/report-button'
import { ContactComposer } from '@/components/marketplace/contact-composer'
import { AffiliateBooking } from '@/components/marketplace/affiliate-booking'
import { safeAffiliateUrl } from '@/lib/affiliate-qr'
import { VisaStart, VISA_START_AVAILABLE } from '@/components/marketplace/visa-start'
import { isVisaShopListing } from '@/lib/visa-shop'
// The one switch that means "this deployment runs the visa chat" — see the gate on isVisaProduct.
import { ITINERARY_THREADS_ENABLED, VISA_THREADS_ENABLED } from '@/lib/thread-kind'
import { getTripAssistanceListingId } from '@/lib/trips/dm-thread'
import { TrackView } from '@/components/marketplace/track-view'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { SaveListingButton } from '@/components/marketplace/save-listing-button'
import { OwnerEditButton } from '@/components/marketplace/owner-edit-button'
import { ShareButton } from '@/components/marketplace/share-button'
import { currencyCode } from '@/lib/analytics'
import { getEnforcement } from '@/lib/enforcement'
import { getPriceBand } from '@/lib/price-stat'
import { MarketPrice } from '@/components/marketplace/market-price'
import { SafetyStrip } from '@/components/marketplace/safety-strip'
import { isBusinessVerified } from '@/lib/business-verification'

type Props = {
  params: Promise<{ id: string }>
}

// ISR: render on-demand, then cache the HTML at the global edge (the #1 SEO page,
// served ~globally in tens of ms instead of a function+DB hit in Singapore per
// view). Self-heals hourly; mutation routes call revalidatePath('/listings/<id>')
// so an edit/sold/hidden/delete purges it immediately (sold → the sold page, hidden → 404).
// Content renders in the visitor's language CLIENT-side (LocalizedTitle + <Tr>),
// same as the cards — so no per-request server translation forces it dynamic.
export const revalidate = 2592000 // 30d — HIGH-cardinality route (one page per listing). Real edits/status/sold/moderation revalidate ON-DEMAND, so the only time-based regen is for off-listing changes (e.g. a seller renaming their storefront). A long 30d window keeps eventual freshness while cutting ISR writes hugely.
export async function generateStaticParams() {
  return []
}

// Cached per-request so generateMetadata + the page share ONE DB query instead of
// each running its own findUnique for the same listing.
/**
 * ⚠️ findFirst, NOT findUnique, AND THAT IS FORCED. `scopedListingWhere` returns an
 * `{ AND: [...] }` wrapper, which `ListingWhereUniqueInput` rejects outright. Both callers —
 * generateMetadata and the page body — already notFound() on null, so a desk listing simply becomes
 * a 404 on eno.vn instead of an ISR-cached PDP shipping Product JSON-LD (offers, priceCurrency,
 * seller) for a government e-Visa service from a licensed sàn TMĐT.
 */
const getListing = cache(async (id: string) =>
  db.listing.findFirst({
    where: await scopedListingWhere({ id }),
    // owner.lastSeenAt: presence for the seller strip — consumed server-side into a
    // day-coarse bucket input (sellerMetrics), the raw timestamp never serializes.
    include: { category: true, seller: { include: { owner: { select: { accountType: true, lastSeenAt: true } } } } },
  }),
)

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const listing = await getListing(id)

  // notFound() in generateMetadata (before any streaming/Suspense boundary) makes a
  // missing/hidden/held/unverified listing a REAL 404 instead of a soft-404 (200 +
  // not-found UI) — the root loading.tsx boundary otherwise flushes 200 before the
  // page's own notFound(). Mirrors the page's viewability guard exactly.
  // SOLD is the ONE exception: it renders a dedicated "this item has been sold" page
  // (not a 404), so here we return noindex metadata for it rather than notFound() — a
  // sold URL shouldn't stay in search, but it's still a real, on-brand page.
  if (!listing || !listing.verified || (listing.status !== 'active' && listing.status !== 'sold')) notFound()
  if (listing.status === 'sold') {
    return { title: `${listing.title} — Sold | ${SITE_NAME}`, robots: { index: false, follow: true } }
  }

  // Use the listing's SOURCE title (as posted) for all BAKED, shared output — the
  // <title> tab, OG tags, JSON-LD, share text. This page is static HTML shared across
  // users, so it can't vary by language; forcing titleVi made an English app show a
  // Vietnamese tab. The visible H1 still localizes per-user via <LocalizedTitle>.
  const displayTitle = listing.title
  // Guard against corrupt/legacy image rows (a known reality here — see the mock
  // self-heal in serialize.ts): a single bad row must not 500 the top SEO page.
  const parsedImages = safeParse<unknown>(listing.images, [])
  const images: string[] = Array.isArray(parsedImages) ? parsedImages.filter((u): u is string => typeof u === 'string') : []
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

  // Bake the price into the social title/description so it shows in every link
  // unfurl (Facebook/Zalo/Telegram scrape OG tags, not our share text). Skip when
  // there's no meaningful price (e.g. some job posts).
  const priceLabel = listing.price > 0 ? formatMoneyFull(listing.price, listing.currency) : ''
  // Meta description: the listing body when the seller wrote one; otherwise a
  // composed fallback ("TITLE — PRICE, CATEGORY in LOCATION on eno.vn") so an
  // empty body never ships a junk description like "21,000,000 VND · ".
  const bodyDesc = listing.description.trim()
  const facts = [priceLabel, listing.category.name].filter(Boolean).join(', ')
  const fallbackDesc = `${displayTitle}${facts ? ` — ${facts}` : ''}${listing.location ? ` in ${listing.location}` : ''} on eno.vn`
  const desc = (bodyDesc || fallbackDesc).slice(0, 160)
  // The fallback already carries the price — only prefix it onto a real body.
  const ogTitle = priceLabel ? `${displayTitle} — ${priceLabel}` : displayTitle
  const ogDesc = priceLabel && bodyDesc ? `${priceLabel} · ${desc}` : desc

  return {
    title: priceLabel ? `${displayTitle} — ${priceLabel} | ${SITE_NAME}` : `${displayTitle} | ${SITE_NAME}`,
    description: desc,
    // Only publicly-live listings (verified + active) are indexable; sold/hidden/held are not.
    robots: listing.verified && listing.status === 'active' ? undefined : { index: false, follow: true },
    alternates: {
      canonical: `${hostUrl}/listings/${id}`,
    },
    openGraph: {
      title: ogTitle,
      description: ogDesc,
      url: `${hostUrl}/listings/${id}`,
      // SITE_NAME, not a literal: this file already uses it for every <title> above, and the
      // hardcoded value made eno.forum's listing shares announce eno.vn as the publishing site.
      siteName: SITE_NAME,
      type: 'website',
      images: images.map((img: string) => ({ url: img })),
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDesc,
      images: images[0] ? [images[0]] : undefined,
    },
  }
}

export default async function ListingPage({ params }: Props) {
  const { id } = await params
  const rawListing = await getListing(id)

  // Only publicly-live listings get the full detail page; hidden/held/unverified are
  // pulled from public view entirely (sellers manage them in their dashboard → 404).
  if (!rawListing || !rawListing.verified || (rawListing.status !== 'active' && rawListing.status !== 'sold')) {
    notFound()
  }

  // Sold → a dedicated, on-brand "this item has been sold" page (not a dead 404):
  // it names what sold and keeps the shopper moving (seller's other stock + category).
  if (rawListing.status === 'sold') {
    const sold = serializeListing(rawListing)
    const moreFromSeller = await sameSellerListings(sold.sellerId, sold.id, 10)
    return (
      <SoldListing
        listing={sold}
        moreFromSeller={moreFromSeller}
        sellerName={rawListing.seller.name}
        sellerHref={`/sellers/${sold.sellerId}`}
      />
    )
  }

  const listing = serializeListing(rawListing)
  // Use the listing's SOURCE title (as posted) for all BAKED, shared output — the
  // <title> tab, OG tags, JSON-LD, share text. This page is static HTML shared across
  // users, so it can't vary by language; forcing titleVi made an English app show a
  // Vietnamese tab. The visible H1 still localizes per-user via <LocalizedTitle>.
  const displayTitle = listing.title
  const displayDesc = listing.description
  // Is this one of the visa desk's products? Decides whether "contact the seller" opens an
  // ordinary chat or STARTS the e-Visa case (see the #contact block). Resolved server-side
  // from the storefront that owns the row — not from the title, the category or the
  // externalId marker, any of which another seller could imitate.
  /**
   * ⛔ `VISA_THREADS_ENABLED &&` IS WHAT MAKES THE DESK ENV SAFE TO SET IN ANY ORDER — and without
   * it, repointing VISA_SHOP_OWNER_EMAIL AT ALL would have blanked the Chat button on 14 live
   * listings.
   *
   * The branch below is `isVisaProduct ? <VisaStart/> : <ContactComposer/>`, and on a deployment
   * that does not host the visa chat `VisaStart` resolves to the STUB, which renders null. So the
   * moment that env named VietKite, all 14 of their e-visa PDPs would answer "this is a visa
   * product" and then draw NOTHING where the contact control belongs — no error, no fallback, a
   * dead product page on the busiest listings on the site. The ordering rule that was supposed to
   * prevent it ("repoint the desk only in the same breath as the build") is exactly the kind of
   * rule that gets followed four times and forgotten once.
   *
   * `VISA_THREADS_ENABLED` already means "this deployment runs the visa chat" — the same switch
   * thread-kind.ts keys on — so gating here makes the two agree by construction: no chat, no visa
   * entry point, ordinary ContactComposer. It also collapses four order-sensitive env vars into
   * one: the desk addresses become inert until this flag is on.
   */
  /**
   * ⚠️ `VISA_START_AVAILABLE &&` closes the gate's other direction. VISA_THREADS_ENABLED is a
   * RUNTIME secret and the module below is chosen by a BUILD flag, so the two can disagree — and one
   * disagreement is silent: a stub build under a live runtime flag answers "visa product" and then
   * draws nothing where the contact control belongs. A rollback does exactly that. The constant is a
   * build-time literal on both sides of the alias, so this folds away and cannot cost a render.
   */
  const isVisaProduct = VISA_THREADS_ENABLED && VISA_START_AVAILABLE && (await isVisaShopListing(listing.id))

  /**
   * A PARTNER LISTING WHOSE CHECKOUT IS ON THE PARTNER'S OWN SITE (VinWonders attraction tickets).
   *
   * ⚠️ ONE NULLABLE COLUMN IS THE WHOLE FEATURE FLAG. `affiliateUrl` is null on every ordinary
   * listing, so nothing below changes for them — no env var, no allowlist, no deploy coupling.
   * ⚠️ IT IS CHECKED BEFORE isVisaProduct because it is the more specific case; the two are
   * mutually exclusive in practice (the visa desk sells its own services, not a partner's).
   */
  /**
   * ⛔ VALIDATE HERE, NOT ONLY IN THE COMPONENT. This flag SUPPRESSES ContactComposer, and
   * AffiliateBooking renders null on a URL it will not trust — so branching on the raw column
   * meant one bad row produced a product page with NO call to action whatsoever: no booking
   * button, no chat, no phone. Deciding with the same predicate the component uses makes the
   * fallback automatic: an untrusted link is simply not an affiliate listing, and the ordinary
   * contact path comes back.
   */
  const affiliateUrl = safeAffiliateUrl(listing.affiliateUrl)
  // Is this the trip desk's own listing? Same trust shape as the visa check above — resolved
  // server-side from (seller, externalId) on the desk that owns the row, never from the title or
  // the category, which another seller could imitate. `cache()`d, so this costs one query per
  // render at most and returns null (→ false) whenever the desk or its listing is not seeded.
  /**
   * ⛔ GATED ON `ITINERARY_THREADS_ENABLED` FOR THE SAME REASON THE VISA BRANCH IS GATED ON
   * `VISA_THREADS_ENABLED` — repointing the desk env must be inert until a build that can actually
   * serve the flow is live.
   *
   * `isTripProduct` flips ContactComposer into `intent='plan'`, which offers to build an itinerary
   * in chat. That flow needs the `.svc.` trip routes compiled (MARKETPLACE_HOSTS_SERVICES) — and
   * TRIP_DESK_OWNER_EMAIL is a RUNTIME variable while the routes are a BUILD flag, so the two can
   * drift. Without this gate, pointing the env at GMBR before the build lands would put a planner
   * CTA on their listing whose endpoints answer 404.
   * ⚠️ Ungated, this also fires on eno's OWN legacy anchor, which is still hidden on the support
   * account and still resolvable — so the branch could turn on for a listing nobody meant to enable.
   */
  const tripListingId = ITINERARY_THREADS_ENABLED ? await getTripAssistanceListingId() : null
  const isTripProduct = tripListingId !== null && tripListingId === listing.id
  // Embed the PRE-WARMED translations of the user-authored content so the H1/description/
  // location render in the visitor's language instantly (no flash, no per-request translate).
  // Runs only on ISR regen (page revalidates every 30d) → effectively free; falls back to
  // the client machine-translate for any missing language.
  // Batched alongside: the brand chip lookup and the seller's enforcement state
  // (Phase 2 caution line). getEnforcement is a single indexed PK read of the
  // DENORMALIZED Profile column — it can't ride the seller join because the
  // enforcement columns are @ignore'd in Prisma until the migration runs (it
  // returns good_standing pre-migration). One parallel batch → no added latency,
  // and it only runs on ISR regen; enforcement transitions revalidate this path.
  // Same batch also warms three CHEAP, ISR-cached seller reads for the enriched
  // seller area (all single-seller, indexed): top-2 verified-first reviews + denorm
  // avg/count, up to 10 other active listings from this seller (card projection),
  // and the seller's 90d conversation count — the honest denominator behind the
  // responsiveness bucket (Seller.responseRate defaults to 100 and lies without it).
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
  const [i18n, brand, ownerEnforcement, reviewsPreview, moreFromSeller, convoCount90, priceBand] = await Promise.all([
    cachedTranslations([listing.title, listing.description, listing.location]),
    listing.brandSlug
      ? db.brand.findUnique({ where: { slug: listing.brandSlug }, select: { name: true, iconSlug: true, logoPath: true } })
      : Promise.resolve(null),
    rawListing.seller.ownerId ? getEnforcement(rawListing.seller.ownerId) : Promise.resolve(null),
    topSellerReviews(listing.sellerId, 2, { total: listing.seller.reviewCount, avg: listing.seller.rating }),
    sameSellerListings(listing.sellerId, listing.id, 10),
    db.conversation.count({
      where: { sellerId: listing.sellerId, createdAt: { gte: new Date(Date.now() - NINETY_DAYS_MS) } },
    }),
    // Market-price band for this brand+model+segment (null when there aren't enough comparables).
    getPriceBand({ brandSlug: listing.brandSlug, model: listing.model, condition: listing.condition, year: listing.year }),
  ])
  // Honest, decomposed seller display bundle (raw responseRate never leaves here —
  // only the suppressed/bucketed label rides into the client SellerCard). The two
  // fields the SERIALIZED seller deliberately doesn't carry — the compute receipt
  // responseMetricAt and the owner's presence heartbeat — thread in from rawListing,
  // so neither raw value ever touches a client-visible shape.
  const sellerMetricsBundle = sellerMetrics(
    {
      ...listing.seller,
      responseMetricAt: rawListing.seller.responseMetricAt,
      lastSeenAt: rawListing.seller.owner?.lastSeenAt ?? null,
    },
    convoCount90,
  )
  // The verified-business badge (>=2-channel identity-hash gate). Computed off the RAW
  // seller — it has every scalar column, unlike the serialized shape — and passed to the
  // shop link; the serialized seller deliberately doesn't carry the identity fields.
  const sellerBusinessVerified = listing.seller.isBusiness && isBusinessVerified(rawListing.seller)
  const sellerHref = `/sellers/${listing.sellerId}`
  // Caution line for throttled/held/suspended sellers (warned is notice-only, never
  // public). Held/suspended pages are usually pulled (404) — direct-link stragglers
  // still get the stronger wording.
  const sellerCaution =
    ownerEnforcement && (ownerEnforcement.state === 'throttled' || ownerEnforcement.state === 'held' || ownerEnforcement.state === 'suspended')
      ? ownerEnforcement.state
      : null

  const attrs = listing.attributes ? Object.entries(listing.attributes) : []
  // Structured numeric specs (vehicles) — rendered first in Details, with units.
  // `value` is a ReactNode, not a string, so a grouped number can be a client leaf:
  // mileage used to be formatted here with a hardcoded 'en-US' and a vi buyer read
  // "125,000 km" — comma thousands, which is the DECIMAL mark in Vietnamese. This page is
  // a server component and has no language context, so the only way to follow the viewer
  // is <CountValue> (rating-value.tsx), the same SSR-en-then-swap leaf <Tr> uses.
  // ⚠️ Year stays a bare String(): a year is an identifier, never grouped ("2015", not
  // "2,015"), which is exactly what a grouping formatter would do to it.
  const numericSpecs: { label: string; value: ReactNode }[] = []
  if (listing.year != null) numericSpecs.push({ label: 'Year', value: String(listing.year) })
  if (listing.mileageKm != null) numericSpecs.push({ label: 'Mileage', value: <><CountValue value={listing.mileageKm} /> km</> })
  if (listing.engineL != null) numericSpecs.push({ label: 'Engine', value: `${listing.engineL} L` })
  // Brand chip (when the listing carries a canonical brand) — links into the
  // brand-filtered feed (resolved in the parallel batch above).
  const brandLogoPath = brand ? brandIconPath(brand) : null
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  const canonicalUrl = `${hostUrl}/listings/${listing.id}`

  // Determine standard schema condition
  let schemaCondition = 'https://schema.org/UsedCondition'
  if (listing.condition === 'new' || listing.condition?.toLowerCase().includes('mới')) {
    schemaCondition = 'https://schema.org/NewCondition'
  }

  // Structured data for Google rich results. Indexable listings only (verified +
  // active); sold/hidden never get rich-snippeted.
  const indexable = listing.verified && listing.status === 'active'
  const availability = listing.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'

  // One currency expression shared by the offer and its shippingDetails — a USD
  // listing must not advertise a VND shipping rate.
  const offerCurrency = listing.currency === '₫' ? 'VND' : 'USD'

  const productLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    'name': displayTitle,
    'image': listing.images,
    'description': displayDesc,
    'sku': listing.id,
    // Real product brand (drives Google free product listings + matching). Only
    // emitted when the listing carries a canonical brand.
    ...(brand ? { 'brand': { '@type': 'Brand', 'name': brand.name } } : {}),
    'category': listing.category.name,
    'offers': {
      '@type': 'Offer',
      'url': canonicalUrl,
      'priceCurrency': offerCurrency,
      'price': listing.price,
      'priceValidUntil': new Date(new Date(listing.postedAt).getTime() + 1000 * 60 * 60 * 24 * 90).toISOString().split('T')[0], // postedAt + 90d — deterministic across ISR regens (Date.now() made every regen unique, defeating Vercel's unchanged-output write dedup)
      // A partner ticket is issued fresh at checkout — the used/refurbished vocabulary the rest of
      // the marketplace uses does not apply, and an unset condition suppresses the rich result.
      'itemCondition': affiliateUrl ? 'https://schema.org/NewCondition' : schemaCondition,
      'availability': availability,
      'seller': { '@type': 'Organization', 'name': listing.seller.name },
      /**
       * ⛔ RETURN AND SHIPPING TERMS ARE OMITTED ON A PARTNER LISTING, DELIBERATELY. Both blocks
       * below describe how *eno* fulfils a sale: meet locally, inspect, no returns, no shipping
       * fee. None of that is true of an attraction ticket bought on the partner's own site under
       * the partner's own refund rules — publishing "returns not permitted" for a product we do
       * not sell is a claim we have no standing to make, and Google reads structured data as the
       * merchant's own statement of terms. Absent is correct; wrong is not.
       */
      ...(affiliateUrl ? {} : {
        // Return policy — eno is a meet-and-inspect-before-paying marketplace for
        // (mostly used) goods, so sales are final / no returns. Satisfies Google
        // Merchant "Improve item appearance" (hasMerchantReturnPolicy).
        'hasMerchantReturnPolicy': {
          '@type': 'MerchantReturnPolicy',
          'applicableCountry': 'VN',
          'returnPolicyCategory': 'https://schema.org/MerchantReturnNotPermitted',
        },
        // Fulfillment — buyer and seller meet locally, so there's no shipping fee
        // (free local handover). Satisfies the shippingDetails recommendation.
        'shippingDetails': {
          '@type': 'OfferShippingDetails',
          'shippingRate': { '@type': 'MonetaryAmount', 'value': '0', 'currency': offerCurrency },
          'shippingDestination': { '@type': 'DefinedRegion', 'addressCountry': 'VN' },
          'deliveryTime': {
            '@type': 'ShippingDeliveryTime',
            'handlingTime': { '@type': 'QuantitativeValue', 'minValue': 0, 'maxValue': 1, 'unitCode': 'DAY' },
            'transitTime': { '@type': 'QuantitativeValue', 'minValue': 0, 'maxValue': 2, 'unitCode': 'DAY' },
          },
        },
      }),
    },
  }

  // Breadcrumb rich result: Home › Category › Listing.
  const breadcrumbLd = {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': 'eno.vn', 'item': hostUrl },
      { '@type': 'ListItem', 'position': 2, 'name': listing.category.name, 'item': `${hostUrl}/c/${rawListing.category.slug}` },
      { '@type': 'ListItem', 'position': 3, 'name': displayTitle, 'item': canonicalUrl },
    ],
  }

  const ldJson = (o: object) => JSON.stringify(o).replace(/</g, '\\u003c')

  // Quiet social proof — only above a credibility floor so a fresh listing never
  // advertises "0 saved" (saves ≥3 / views ≥20). Rendered twice: under the title
  // on mobile and in the contact column on desktop (each hidden on the other).
  const showProof = listing.savedCount >= 3 || listing.views >= 20
  const socialProof = (
    <>
      {listing.savedCount >= 3 && (
        <span className="inline-flex items-center gap-1">
          <Heart className="h-3.5 w-3.5" /> <SavedCount base={listing.savedCount} id={listing.id} /> <Tr text="saved" />
        </span>
      )}
      {listing.savedCount >= 3 && listing.views >= 20 && <span aria-hidden>·</span>}
      {listing.views >= 20 && (
        <span className="inline-flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" /> <CountValue value={listing.views} /> <Tr text="views" />
        </span>
      )}
    </>
  )

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      {/* JSON-LD — indexable listings only (no rich snippets for hidden/sold/pending) */}
      {indexable && (
        <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(productLd) }} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd) }} />
        </>
      )}

      {/* Open the detail page at the top, not at the feed's stale scroll position */}
      <ScrollToTop id={listing.id} />

      {/* Fires GA4 view_item / Meta ViewContent once per listing view (client, renders null) */}
      <TrackView
        id={listing.id}
        title={displayTitle}
        price={listing.price}
        currency={currencyCode(listing.currency)}
        category={listing.category.name}
        categorySlug={listing.category.slug}
        brandSlug={listing.brandSlug}
      />

      <Header />

      {/* No bottom clearance here on purpose. This page used to reserve 4rem on the ROOT for
          a fixed mobile action bar; that bar is gone, and <BottomNavSpacer/> already reserves
          the tab bar's 4.5rem globally — so the old padding just left a dead band above it. */}
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-8 lg:pb-12">
        {/* ONE responsive tree, TWO layouts. On mobile it is a single flex column and the
            `order-*` on each block sequences the whole page — the LEFT/RIGHT column wrappers are
            `display:contents` there, so their children flatten into this one shared order space:
            breadcrumb → gallery → price/title/meta → seller → contact → protections → description
            → safety → reviews → map. On lg the wrappers snap into a 12-col grid: a col-7 media +
            detail column and a STICKY col-5 "buy box" (price/title/meta → seller → contact →
            protections → safety → reviews). Exactly ONE <h1>, ONE <ContactComposer> and ONE map
            mount across both layouts → no duplicate H1, no hydration variance, and no double
            `eno:chat-now` listener. */}
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:gap-x-10 lg:gap-y-8">

          {/* 1 — Breadcrumb (subdued, full width). Leaf crumb hidden on mobile (it duplicates
              the H1); the BreadcrumbList JSON-LD still carries all 3 levels. */}
          {/* ⚠️ `order-7` ON MOBILE — BELOW THE CTA, NOT ABOVE THE PHOTO. MEASURED, NOT PREFERRED.
              On a 390x844 phone the fixed tab bar takes the bottom 72px, so the usable fold is 772px.
              Everything above the gallery used to cost 270px of that — 35% of the fold spent before a
              single product pixel — and `#contact` landed at y=808: 36px BELOW the top of the tab bar,
              i.e. the "Chat now" CTA was never once visible without scrolling. The breadcrumb is 20px
              of subdued nav text plus a 24px gap, and nobody navigates a phone by breadcrumb; moving
              it under the CTA buys 44px of that back at no cost to the reader.
              ⚠️ `order-7` — IMMEDIATELY AFTER THE CTA, NOT `order-last`, AND THAT IS A FOCUS-ORDER FIX
              BOTH EXTERNAL REVIEWERS RAISED INDEPENDENTLY. `order-*` moves the PAINTED position and
              leaves DOM order alone, so this nav stays first in the tab sequence however it looks.
              With `order-last` it painted ~1,100px down the page: a sighted keyboard user tabbing out
              of the header would send the viewport to the bottom of the document and then back up —
              a WCAG 2.4.3 focus-order failure that no typecheck, unit test or e2e run can see. One
              slot below `#contact` it lands just under the fold, so focus moves a little instead of
              teleporting, and the 44px is still recovered. It deliberately SHARES slot 7 with the
              shop link below: equal `order` falls back to DOM order, so the two stack in source
              order with no third number to find.
              ⚠️ `lg:order-1` keeps it FIRST on desktop, where it sits full-width above the grid and
              the fold problem does not exist. And the BreadcrumbList JSON-LD is emitted separately, so
              the position here is presentation only — Google still gets all three levels. */}
          <nav aria-label="Breadcrumb" className="order-7 truncate text-sm text-muted-foreground md:order-1 lg:col-span-12">
            {/* prefetch={false} on both crumbs: they sit above the fold on every PDP, so auto
                prefetch fires two extra RSC requests per listing view for links most visitors
                never take (the way back is the tab bar or the browser's back button). */}
            <Link href="/" prefetch={false} className="transition-colors hover:text-accent-foreground"><Tr text="Home" /></Link>
            <span className="mx-1.5 text-line-strong">/</span>
            <Link href={`/c/${rawListing.category.slug}`} prefetch={false} className="transition-colors hover:text-accent-foreground"><Tr text={listing.category.name} /></Link>
            <span className="mx-1.5 hidden text-line-strong md:inline">/</span>
            <span className="hidden font-medium text-foreground md:inline"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={i18n[listing.title]} /></span>
          </nav>

          {/* The compact storefront link, MOBILE. `md:hidden` — the desktop twin lives in the left
              column, above the media, and is unchanged.
              ⚠️ IT MOVED OUT FROM ABOVE THE MEDIA (`order-2`) TO JUST ABOVE THE CTA (`order-5`), AND
              THE CITED REFERENCE IS THE REASON, NOT AN ARGUMENT AGAINST IT. This block was labelled
              "Shop-on-top (Shopee)" — but Shopee's phone PDP opens on the image carousel at the very
              top of the page and puts the shop row well below the price. What was here was the
              opposite: 58px of seller identity plus a 24px gap between the header and the first
              product pixel.
              Measured on a 390x844 phone: that stack cost 82px of a 772px usable fold (the tab bar
              owns the bottom 72), and it was the single largest reason `#contact` rendered at y=808 —
              below the fold entirely.
              ⚠️ `order-7`, i.e. AFTER `#contact` (order-6), NOT BEFORE IT — AND THE FIRST ATTEMPT AT
              THIS GOT IT WRONG IN A WAY THE PIXELS CAUGHT AND THE REASONING DID NOT. Moving it to
              order-5 put it between the price block and the CTA: still ahead of `#contact`, so it
              still pushed the CTA down by its own 82px and the button landed at y=764 against a tab
              bar at 772 — eight visible pixels. Only the breadcrumb's 44px had actually been
              recovered. A block "moved down" only buys the CTA anything if it moves BELOW it.
              Seller identity under the Chat button is also the marketplace convention (Shopee, Chợ
              Tốt): the buy action leads, provenance supports it.
              ⛔ DO NOT "RESTORE" THIS ABOVE THE GALLERY. The gallery is square and full-bleed by the
              owner's decision (2026-07-23/24) and is the hero; anything stacked on top of it is spent
              from the same 772px budget, and this page has no sticky mobile CTA to fall back on —
              `PdpMobileBar` was deleted deliberately and must not come back. */}
          <div className="order-7 md:hidden">
            <PdpShopLink name={listing.seller.name} avatarColor={listing.seller.avatarColor} avatarUrl={listing.seller.avatarUrl} isBusiness={listing.seller.isBusiness} businessVerified={sellerBusinessVerified} officialPartner={listing.seller.officialPartner} href={sellerHref} metrics={sellerMetricsBundle} />
          </div>

          {/* 2 — Gallery, MOBILE mount: edge-to-edge (negative gutter cancels <main>'s padding),
              md:hidden. Its desktop twin lives in the left column below; the variant gates stop
              the hidden one from fetching images. Share/Save overlay the media (Shopee pattern);
              z-10 stays under the lightbox (z-[100]). */}
          <div className="relative order-2 -mx-3 sm:-mx-6 md:hidden">
            <ListingGallery variant="mobile" images={listing.images} title={displayTitle} video={listing.video} showAllLabel="View all photos" />
            <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
              <ShareButton url={canonicalUrl} title={displayTitle} price={listing.price} currency={listing.currency} compact />
              <SaveListingButton id={listing.id} compact />
              {/* Owner-only, and it renders nothing for everyone else — see owner-edit-button.tsx.
                  Sits AFTER Save so the control order is identical for every viewer and the shared
                  actions never move because a third one appeared. */}
              <OwnerEditButton listingId={listing.id} sellerId={listing.seller.id} compact />
            </div>
          </div>

          {/* RIGHT COLUMN (lg col-5): the sticky "buy box". It comes FIRST in the DOM (so the H1,
              price, seller and contact controls lead the reading / tab order — the media + copy
              column follows); `lg:order-3` still paints it on the RIGHT at lg, and `lg:order-2` on
              the LEFT column below paints the media on the left. `contents` on mobile so its
              children join the single order flow. */}
          <div className="contents lg:order-3 lg:col-span-5 lg:block">
            <div className="contents lg:sticky lg:top-24 lg:flex lg:flex-col lg:gap-4 lg:border-l lg:border-border/70 lg:pl-10">

              {/* 3 — HEADER BLOCK: price (the anchor) → title → metadata, kept tight (gap-2) so the
                  three read as one cohesive unit. Price is the largest, boldest text on the page. */}
              <div className="order-3 flex flex-col gap-2">
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} className="text-3xl tracking-tight text-accent-foreground" />
                    {/* Server-computed drop anchor (30-day-min reference) — never a seller "was". */}
                    {/* ⚠️ BOTH CLAIMS ARE WRAPPED IN <LiveUntil> BECAUSE THIS PAGE IS ISR-CACHED
                        FOR 30 DAYS. `prevPrice` and `urgent` are resolved by serialize.ts against
                        Date.now() at GENERATION time, so without a live clock a page generated
                        during a 3-day drop window kept showing the struck-through price and the
                        −% badge for up to a month after the discount ended — a stale reference
                        price on the page that actually sells the item. Do not unwrap these to
                        save a client component; the staleness is in the CACHE, not the serializer. */}
                    {listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price) && (
                      <LiveUntil until={listing.dropExpiresAt}>
                        <Price price={listing.prevPrice} currency={listing.currency} priceUnit="VND" /* ⚠️ EXPLICIT font-medium — Price now defaults to font-black, and a heavy strikethrough
                       fights the price that actually applies. The old price must read as background. */
                    className="text-base font-medium text-ink-4 line-through" />
                        <Badge variant="counter" size="sm" className="tabular-nums">
                          {dropPercent(listing.prevPrice, listing.price)}
                        </Badge>
                        <DropCountdown expiresAt={listing.dropExpiresAt} />
                      </LiveUntil>
                    )}
                    {listing.urgent && (
                      <LiveUntil until={listing.urgentUntil}>
                        {/* Same "Bán gấp" vocabulary as the card badge (card-badges.tsx): a solid
                            slate chip with a filled 12px bolt + the word. The old treatment — a
                            bare 28px solid-red Zap — broke the icon language twice over (solid
                            fills are reserved for user-state per §5, and an unlabeled glyph is a
                            guess); the labelled chip reads instantly and matches the feed. */}
                        <Badge size="md" className="gap-1 self-center bg-foreground text-2xs text-background">
                          <Zap className="h-3 w-3 fill-current" /> <Tr text="Urgent" />
                        </Badge>
                      </LiveUntil>
                    )}
                    {!listing.negotiable && (
                      <Badge size="md" className="text-2xs text-body">
                        <Tag className="h-3 w-3" /><Tr text="Fixed price" />
                      </Badge>
                    )}
                  </div>
                  {/* ⛔ NO INLINE SEAL LINE HERE (owner, 2026-08-08: "remove this line excessive").
                      A "Trust scores you can check" echo sat under the price from the 2026-08-06
                      foundation handoff. It was redundant on this page three times over: the
                      seller's actual TrustScore badge renders in the shop link below, ProtectionsRow
                      tells the full safety story, and a generic claim under a specific price adds
                      nothing the buyer can act on. ⚠️ If a trust line is ever restored here, the COPY
                      is still load-bearing — eno holds no money and offers no buyer protection, so it
                      must never promise one (three diff reviewers flagged the original "protections
                      apply" as a false consumer claim on a licensed sàn TMĐT). */}
                  {/* The market-price gauge travels with the price — it's a benchmark OF this number. */}
                  {priceBand && <MarketPrice price={listing.price} band={priceBand} />}
                </div>

                {/* Title — clean + medium weight so it never out-shouts the price. The single H1. */}
                <h1 className="text-lg font-medium leading-snug text-foreground"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={i18n[listing.title]} /></h1>

                {/* Metadata — ONE tightly-packed subdued row: brand · condition · specs · location ·
                    posted · social proof; flex-wrap spills to a second row only when it must. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
                  {brand && (
                    <Badge size="md" interactive render={<Link href={`/?brand=${encodeURIComponent(listing.brandSlug!)}`} prefetch={false} />} className="w-fit gap-1.5 font-semibold text-foreground">
                      <BrandLogo name={brand.name} iconPath={brandLogoPath} size={16} />
                      {brand.name}
                    </Badge>
                  )}
                  {listing.condition && (
                    <Badge size="md" className="font-semibold text-foreground">
                      <Tr text={listing.condition === 'new' ? 'New' : listing.condition === 'used' ? 'Used' : listing.condition} />
                    </Badge>
                  )}
                  {numericSpecs.map((s) => (
                    <Badge key={s.label} size="md" className="font-semibold text-foreground">
                      <span className="text-ink-4"><Tr text={s.label} /></span> {s.value}
                    </Badge>
                  ))}
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <MapPin className="h-4 w-4 shrink-0 text-ink-4" />
                    <span className="truncate"><LocalizedText text={listing.location} i18n={i18n[listing.location]} /></span>
                  </span>
                  <span aria-hidden className="text-line-strong">·</span>
                  <span className="shrink-0"><Tr text="Posted" /> <PostedAgo iso={listing.postedAt} /></span>
                  {showProof && (
                    <>
                      <span aria-hidden className="text-line-strong">·</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs">{socialProof}</span>
                    </>
                  )}
                </div>
              </div>

              {/* 4 — Enforcement caution (rare: throttled/held sellers) — before any contact action */}
              {sellerCaution && (
                <p className={cn('order-4 inline-flex items-center gap-2 self-start rounded-xl px-3 py-2 text-sm font-semibold', sellerCaution === 'throttled' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive')}>
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {sellerCaution === 'throttled'
                    ? <Tr text="This seller is under review — trade with extra care" />
                    : <Tr text="This seller's account is on hold — don't send money or deposits" />}
                </p>
              )}

              {/* Seller trust snippet REMOVED (owner 2026-07-17): it duplicated the shop-on-top link
                  above the media, which now carries the full identity + trust (name, Business, trust
                  score, Joined · rating · reviews) + the Shop jump. "Chat now" lives in ContactComposer. */}

              {/* 6 — Contact + offer (auth-gated; number never in this payload). The mobile action
                  bar mirrors these CTAs and scrolls here (#contact) for "Make offer". */}
              <div id="contact" className="order-6 scroll-mt-24">
                {/* ⚠️ A VISA PRODUCT DOES NOT OPEN AN EMPTY CHAT. The whole application happens
                    inside the thread (owner: "user click chat then selects available product from
                    admin shop and continues uploading images and filling up the form lastly checks
                    out inside chat"), so contacting the desk must START the case: <VisaStart>
                    POSTs /api/visa/applications/start, which binds a thread to the application and
                    posts step 1. <ContactComposer> would open a blank conversation and the wizard
                    would never begin — the flow is server-driven and nothing else emits a card.
                    isVisaShopListing is deliberately WIDER than resolveVisaProduct: a half-built
                    product (missing entry type or speed) still gets visa chrome rather than
                    silently falling back to an empty chat. */}
                {affiliateUrl
                  // ⛔ THE PRODUCT'S OWN CODE, WITH NO FALL BACK TO THE PARTNER-WIDE ONE. The codes
                  // differ per attraction (MEMBER10, MEMBER3, MEMBER2, SHOW5) and three products
                  // have none at all. An earlier draft fell back to Seller.affiliateDiscountCode
                  // for those three, which means printing a code the partner may reject at
                  // checkout — the visitor follows our link, types what we told them, and it fails.
                  // A missing code shows NO discount block; silence is recoverable, a broken promise
                  // at the payment step is not. Set the code per listing to offer one.
                  ? <AffiliateBooking
                      url={affiliateUrl}
                      partnerName={listing.seller.name}
                      discountCode={listing.affiliateDiscountCode}
                      discountPercent={listing.affiliateDiscountPercent}
                    />
                  : isVisaProduct
                  ? <VisaStart listingId={listing.id} className="w-full" />
                  : <ContactComposer
                      listingId={listing.id}
                      listingTitle={displayTitle}
                      listingImage={listing.images[0] ?? null}
                      sellerName={listing.seller.name}
                      price={listing.price}
                      currency={listing.currency}
                      negotiable={listing.negotiable}
                      /* ⚠️ ONE button, and it goes to CHAT (owner, 2026-07-26). This block briefly
                         held two CTAs: a "Plan my trip — free" link to the dashboard builder, above
                         "Chat now". Both are wrong now — planning is a chat experience, and the
                         builder page it pointed at is being retired. The single remaining CTA opens
                         the thread on THIS listing, which is the anchor the wizard is gated to, so
                         the traveller lands exactly where the planner runs. */
                      intent={isTripProduct ? 'plan' : 'buy'}
                    />}
              </div>

              {/* 9 — ONE trust block: the scam warning, with "ENO protects you" folded in as its
                  second line (owner, 2026-08-11). The separate order-7 protections row is GONE —
                  the two were adjacent boxes circling the same subject, and the warning is the
                  half that can stop someone losing money, so it keeps the container and the ink.
                  See the notes in safety-strip.tsx and protections-row.tsx for why the merge went
                  in this direction rather than the other. */}
              <div className="order-9">
                <SafetyStrip
                  categorySlug={rawListing.category.slug}
                  protections={<ProtectionsRow inline />}
                  action={<ReportButton listingId={listing.id} />}
                />
              </div>

              {/* 10 — Reviews. Rendered CONDITIONALLY: an always-present wrapper around a
                  component that returns null left an empty div in this gapped flex column,
                  which earned a full gap unit and doubled the spacing after the safety strip
                  whenever the seller had no reviews. The hairline replaces the old <Separator>
                  (same rule, one idiom: border-t + rhythm, per the flat-surface canon). */}
              {reviewsPreview.total > 0 && reviewsPreview.reviews.length > 0 && (
                <div className="order-10 border-t border-border pt-4">
                  <ReviewsPreview reviews={reviewsPreview.reviews} total={reviewsPreview.total} avg={reviewsPreview.avg} sellerHref={sellerHref} />
                </div>
              )}
            </div>
          </div>

          {/* LEFT COLUMN (lg col-7): gallery → description/details → map → safety note. It follows
              the buy box in the DOM (reading order) but `lg:order-2` paints it on the LEFT at lg;
              `contents` on mobile flattens these into the shared order space. */}
          <div className="contents lg:order-2 lg:col-span-7 lg:flex lg:flex-col lg:gap-8">
            {/* Shop-on-top (Shopee): storefront link above the media, DESKTOP/TABLET. order-1 so it
                leads the left column at lg (above the gallery) and follows only the breadcrumb when
                the layout is a single flattened column at md; hidden below md (mobile twin above). */}
            <div className="order-1 hidden md:block">
              <PdpShopLink name={listing.seller.name} avatarColor={listing.seller.avatarColor} avatarUrl={listing.seller.avatarUrl} isBusiness={listing.seller.isBusiness} businessVerified={sellerBusinessVerified} officialPartner={listing.seller.officialPartner} href={sellerHref} metrics={sellerMetricsBundle} />
            </div>

            {/* Gallery, DESKTOP mount (hidden below md; the mobile mount handles small screens) */}
            <div className="relative order-2 hidden md:block">
              <ListingGallery variant="desktop" images={listing.images} title={displayTitle} video={listing.video} showAllLabel="View all photos" />
              <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                <ShareButton url={canonicalUrl} title={displayTitle} price={listing.price} currency={listing.currency} compact />
                <SaveListingButton id={listing.id} compact />
                {/* Owner-only, and it renders nothing for everyone else — see owner-edit-button.tsx.
                    Sits AFTER Save so the control order is identical for every viewer and the shared
                    actions never move because a third one appeared. */}
                <OwnerEditButton listingId={listing.id} sellerId={listing.seller.id} compact />
              </div>
            </div>

            {/* 8 — Description + Details */}
            <div className="order-8 flex flex-col gap-8">
              {/* Section headers on this page share ONE treatment (text-lg font-semibold, matching
                  the shelf + reviews headers below) with more space above (section gap) than below. */}
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground"><Tr text="Description" /></h2>
                {/* max-w-prose caps the reading measure at ~65ch — the col-7 body otherwise runs wide. */}
                <ListingDescription text={listing.description} i18n={i18n[listing.description]} className="max-w-prose space-y-3 text-base leading-relaxed text-body" />
              </div>

              {(attrs.length > 0 || numericSpecs.length > 0) && (
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-foreground"><Tr text="Details" /></h2>
                  {/* Spec table: hairline row dividers, muted label / strong value, even row height. */}
                  <dl className="divide-y divide-border text-sm">
                    {numericSpecs.map((s) => (
                      <div key={s.label} className="flex items-start justify-between gap-4 py-2.5">
                        <dt className="text-muted-foreground"><Tr text={s.label} /></dt>
                        <dd className="text-right font-medium text-foreground">{s.value}</dd>
                      </div>
                    ))}
                    {attrs.map(([k, v]) => (
                      <div key={k} className="flex items-start justify-between gap-4 py-2.5">
                        <dt className="capitalize text-muted-foreground"><Tr text={k.replace(/([A-Z])/g, ' $1')} /></dt>
                        {/* Attribute values are stored lowercase — capitalize like the keys. */}
                        <dd className="text-right font-medium capitalize text-foreground"><Tr text={String(v)} /></dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>

            {/* 11 — Map */}
            <div id="location-on-map" className="order-11 space-y-2 scroll-mt-20">
              <h2 className="text-lg font-semibold text-foreground"><Tr text="Location" /></h2>
              <div className="relative h-[260px] overflow-hidden rounded-2xl">
                <ListingDetailMap listings={[listing]} activeDistrict={listing.district || 'all'} />
              </div>
            </div>

            {/* 12 — Safety note */}
            <p className="order-12 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <Tr text="Meet in a public place and inspect the item before paying. eno.vn never asks for a deposit via a link." />
            </p>
          </div>
        </div>

        {/* More from THIS seller (server-fetched cards) — renders nothing when the
            seller has fewer than two other active listings. Sits above the broader
            same-category shelf so a buyer sees the seller's own range first. */}
        <SameSellerShelf listings={moreFromSeller} sellerHref={sellerHref} sellerName={listing.seller.name} />

        {/* More like this — same-category listings (client-fetched, ISR-safe) */}
        <RelatedListings listingId={listing.id} categorySlug={rawListing.category.slug} />

        {/* The buyer's own recently-viewed trail (excludes this listing). mt-12 matches the
            two shelves above — the three are bare siblings in main, each owning its own top gap. */}
        <RecentlyViewedRail excludeId={listing.id} sectionClassName="mt-12" />
      </main>

      <Footer />

    </div>
  )
}
