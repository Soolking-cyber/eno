import { SITE_NAME } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
import { cache } from 'react'
import { db } from '@/lib/db'
import { formatMoneyFull, dropPercent } from '@/lib/vnd'
import { serializeListing, safeParse } from '@/lib/serialize'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { ListingGallery } from '@/components/marketplace/listing-gallery'
import { PdpShopLink } from '@/components/marketplace/pdp-shop-link'
import { Separator } from '@/components/ui/separator'
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
} from 'lucide-react'
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
import { sellerMetrics, topSellerReviews, sameSellerListings } from '@/lib/seller-metrics'
import { ListingDetailMap } from '@/components/marketplace/listing-detail-map'
import { ReportButton } from '@/components/marketplace/report-button'
import { ContactComposer } from '@/components/marketplace/contact-composer'
import { VisaStart } from '@/components/marketplace/visa-start'
import { isVisaShopListing } from '@/lib/visa-shop'
import { getTripAssistanceListingId } from '@/lib/trips/dm-thread'
import { TrackView } from '@/components/marketplace/track-view'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { SaveListingButton } from '@/components/marketplace/save-listing-button'
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
      siteName: 'eno.vn',
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
  const isVisaProduct = await isVisaShopListing(listing.id)
  // Is this the trip desk's own listing? Same trust shape as the visa check above — resolved
  // server-side from (seller, externalId) on the desk that owns the row, never from the title or
  // the category, which another seller could imitate. `cache()`d, so this costs one query per
  // render at most and returns null (→ false) whenever the desk or its listing is not seeded.
  const tripListingId = await getTripAssistanceListingId()
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
  const numericSpecs: { label: string; value: string }[] = []
  if (listing.year != null) numericSpecs.push({ label: 'Year', value: String(listing.year) })
  if (listing.mileageKm != null) numericSpecs.push({ label: 'Mileage', value: `${new Intl.NumberFormat('en-US').format(listing.mileageKm)} km` })
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
      'itemCondition': schemaCondition,
      'availability': availability,
      'seller': { '@type': 'Organization', 'name': listing.seller.name },
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
          <nav aria-label="Breadcrumb" className="order-1 truncate text-sm text-muted-foreground lg:col-span-12">
            {/* prefetch={false} on both crumbs: they sit above the fold on every PDP, so auto
                prefetch fires two extra RSC requests per listing view for links most visitors
                never take (the way back is the tab bar or the browser's back button). */}
            <Link href="/" prefetch={false} className="transition-colors hover:text-accent-foreground"><Tr text="Home" /></Link>
            <span className="mx-1.5 text-line-strong">/</span>
            <Link href={`/c/${rawListing.category.slug}`} prefetch={false} className="transition-colors hover:text-accent-foreground"><Tr text={listing.category.name} /></Link>
            <span className="mx-1.5 hidden text-line-strong md:inline">/</span>
            <span className="hidden font-medium text-foreground md:inline"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={i18n[listing.title]} /></span>
          </nav>

          {/* Shop-on-top (Shopee): compact storefront link directly above the media, MOBILE.
              order-2 (same slot as the gallery) + placed first in source so it sits just above it;
              md:hidden — the desktop twin lives in the left column. */}
          <div className="order-2 md:hidden">
            <PdpShopLink name={listing.seller.name} avatarColor={listing.seller.avatarColor} avatarUrl={listing.seller.avatarUrl} isBusiness={listing.seller.isBusiness} businessVerified={sellerBusinessVerified} href={sellerHref} metrics={sellerMetricsBundle} />
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
                    <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} className="text-3xl font-bold tracking-tight text-accent-foreground" />
                    {/* Server-computed drop anchor (30-day-min reference) — never a seller "was". */}
                    {listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price) && (
                      <>
                        <Price price={listing.prevPrice} currency={listing.currency} priceUnit="VND" className="text-base text-ink-4 line-through" />
                        <Badge variant="counter" size="sm" className="tabular-nums">
                          {dropPercent(listing.prevPrice, listing.price)}
                        </Badge>
                        <DropCountdown expiresAt={listing.dropExpiresAt} />
                      </>
                    )}
                    {listing.urgent && (
                      <Zap aria-label="Urgent sale" className="h-7 w-7 self-center fill-destructive stroke-none" />
                    )}
                    {!listing.negotiable && (
                      <Badge size="md" className="text-2xs text-body">
                        <Tag className="h-3 w-3" /><Tr text="Fixed price" />
                      </Badge>
                    )}
                  </div>
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
                {isVisaProduct
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

              {/* 7 — Buyer protections */}
              <div className="order-7"><ProtectionsRow /></div>

              {/* 9 — Safety strip + report */}
              <div className="order-9">
                <SafetyStrip categorySlug={rawListing.category.slug} action={<ReportButton listingId={listing.id} />} />
              </div>

              {/* 10 — Reviews */}
              <div className="order-10">
                {reviewsPreview.total > 0 && <Separator className="mb-4" />}
                <ReviewsPreview reviews={reviewsPreview.reviews} total={reviewsPreview.total} avg={reviewsPreview.avg} sellerHref={sellerHref} />
              </div>
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
              <PdpShopLink name={listing.seller.name} avatarColor={listing.seller.avatarColor} avatarUrl={listing.seller.avatarUrl} isBusiness={listing.seller.isBusiness} businessVerified={sellerBusinessVerified} href={sellerHref} metrics={sellerMetricsBundle} />
            </div>

            {/* Gallery, DESKTOP mount (hidden below md; the mobile mount handles small screens) */}
            <div className="relative order-2 hidden md:block">
              <ListingGallery variant="desktop" images={listing.images} title={displayTitle} video={listing.video} showAllLabel="View all photos" />
              <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                <ShareButton url={canonicalUrl} title={displayTitle} price={listing.price} currency={listing.currency} compact />
                <SaveListingButton id={listing.id} compact />
              </div>
            </div>

            {/* 8 — Description + Details */}
            <div className="order-8 flex flex-col gap-8">
              <div className="space-y-2">
                <h2 className="h-section text-foreground"><Tr text="Description" /></h2>
                <ListingDescription text={listing.description} i18n={i18n[listing.description]} className="space-y-3 text-base leading-relaxed text-body" />
              </div>

              {(attrs.length > 0 || numericSpecs.length > 0) && (
                <div className="space-y-1">
                  <h2 className="h-section mb-2 text-foreground"><Tr text="Details" /></h2>
                  <dl className="text-sm">
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
              <h2 className="h-section text-foreground"><Tr text="Location" /></h2>
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

        {/* The buyer's own recently-viewed trail (excludes this listing). */}
        <RecentlyViewedRail excludeId={listing.id} />
      </main>

      <Footer />

    </div>
  )
}
