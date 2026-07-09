import { cache } from 'react'
import { db } from '@/lib/db'
import { formatMoneyFull, dropPercent } from '@/lib/vnd'
import { serializeListing, safeParse } from '@/lib/serialize'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { ListingGallery } from '@/components/marketplace/listing-gallery'
import { Footer } from '@/components/marketplace/footer'
import { BrandLogo } from '@/components/marketplace/brand-logo'
import { CountValue, SavedCount } from '@/components/marketplace/rating-value'
import { brandIconPath } from '@/lib/brand-icons'
import {
  MapPin,
  AlertTriangle,
  ShieldCheck,
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
import { PdpSellerCard } from '@/components/marketplace/pdp-seller-card'
import { ReviewsPreview } from '@/components/marketplace/reviews-preview'
import { SameSellerShelf } from '@/components/marketplace/same-seller-shelf'
import { SoldListing } from '@/components/marketplace/sold-listing'
import { ProtectionsRow } from '@/components/marketplace/protections-row'
import { DropCountdown } from '@/components/marketplace/drop-countdown'
import { sellerMetrics, topSellerReviews, sameSellerListings } from '@/lib/seller-metrics'
import { ListingDetailMap } from '@/components/marketplace/listing-detail-map'
import { ReportButton } from '@/components/marketplace/report-button'
import { ContactComposer } from '@/components/marketplace/contact-composer'
import { TrackView } from '@/components/marketplace/track-view'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { SaveListingButton } from '@/components/marketplace/save-listing-button'
import { ShareButton } from '@/components/marketplace/share-button'
import { currencyCode } from '@/lib/analytics'
import { getEnforcement } from '@/lib/enforcement'
import { getPriceBand } from '@/lib/price-stat'
import { MarketPrice } from '@/components/marketplace/market-price'

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
const getListing = cache((id: string) =>
  db.listing.findUnique({
    where: { id },
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
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
    return { title: `${listing.title} — Sold | eno.vn`, robots: { index: false, follow: true } }
  }

  // Use the listing's SOURCE title (as posted) for all BAKED, shared output — the
  // <title> tab, OG tags, JSON-LD, share text. This page is static HTML shared across
  // users, so it can't vary by language; forcing titleVi made an English app show a
  // Vietnamese tab. The visible H1 still localizes per-user via <LocalizedTitle>.
  const displayTitle = listing.title
  const desc = listing.description.slice(0, 160)
  // Guard against corrupt/legacy image rows (a known reality here — see the mock
  // self-heal in serialize.ts): a single bad row must not 500 the top SEO page.
  const parsedImages = safeParse<unknown>(listing.images, [])
  const images: string[] = Array.isArray(parsedImages) ? parsedImages.filter((u): u is string => typeof u === 'string') : []
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

  // Bake the price into the social title/description so it shows in every link
  // unfurl (Facebook/Zalo/Telegram scrape OG tags, not our share text). Skip when
  // there's no meaningful price (e.g. some job posts).
  const priceLabel = listing.price > 0 ? formatMoneyFull(listing.price, listing.currency) : ''
  const ogTitle = priceLabel ? `${displayTitle} — ${priceLabel}` : displayTitle
  const ogDesc = priceLabel ? `${priceLabel} · ${desc}` : desc

  return {
    title: `${displayTitle} | eno.vn`,
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
  // only the suppressed/bucketed label rides into the client SellerCard).
  const sellerMetricsBundle = sellerMetrics(listing.seller, convoCount90)
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

  const productLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    'name': displayTitle,
    'image': listing.images,
    'description': displayDesc,
    'sku': listing.id,
    'mpn': listing.id,
    // Real product brand (drives Google free product listings + matching). Only
    // emitted when the listing carries a canonical brand.
    ...(brand ? { 'brand': { '@type': 'Brand', 'name': brand.name } } : {}),
    'category': listing.category.name,
    'offers': {
      '@type': 'Offer',
      'url': canonicalUrl,
      'priceCurrency': listing.currency === '₫' ? 'VND' : 'USD',
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
        'shippingRate': { '@type': 'MonetaryAmount', 'value': '0', 'currency': 'VND' },
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

      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-12">
        {/* Header block — ONE set of DOM nodes, two visual orders. DOM order
            (breadcrumb → title → caution → price → gallery → highlights) IS the
            ≥lg layout and keeps the single H1 early for SEO; <lg, flex `order-*`
            re-sequences it deal-first (breadcrumb → gallery → price → title →
            highlights) — price is the headline on a deal marketplace. Pure CSS,
            no duplicated blocks → no hydration variance, no CLS. */}
        <div className="flex flex-col">
        {/* Breadcrumb — Home / Category / Title */}
        <nav aria-label="Breadcrumb" className="order-1 mb-4 truncate text-sm text-muted-foreground lg:order-none">
          <Link href="/" className="hover:text-accent-foreground transition-colors"><Tr text="Home" /></Link>
          <span className="mx-1.5 text-line-strong">/</span>
          <Link href={`/c/${rawListing.category.slug}`} className="hover:text-accent-foreground transition-colors"><Tr text={listing.category.name} /></Link>
          {/* Leaf crumb hidden on mobile — it duplicates the H1 directly below and
              wraps a full row; the BreadcrumbList JSON-LD keeps all 3 levels. */}
          <span className="mx-1.5 hidden text-line-strong md:inline">/</span>
          <span className="hidden font-medium text-foreground md:inline"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={i18n[listing.title]} /></span>
        </nav>

        {/* Title header — on mobile it follows the price block; share/save live
            on the gallery overlay there, so the right-side pair is desktop-only. */}
        <div className="order-4 mb-4 flex items-start justify-between gap-3 lg:order-none">
          <div className="min-w-0 space-y-1.5">
            <h1 className="h-title text-foreground"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={i18n[listing.title]} /></h1>
            {brand && (
              <Link
                href={`/?brand=${encodeURIComponent(listing.brandSlug!)}`}
                className="inline-flex w-fit items-center gap-1.5 rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <BrandLogo name={brand.name} iconPath={brandLogoPath} size={16} />
                {brand.name}
              </Link>
            )}
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 text-ink-4 shrink-0" />
              <span className="truncate"><LocalizedText text={listing.location} i18n={i18n[listing.location]} /></span>
              <span aria-hidden className="text-line-strong">·</span>
              <span className="shrink-0"><Tr text="Posted" /> <PostedAgo iso={listing.postedAt} /></span>
            </div>
          </div>
          <div className="mt-0.5 hidden shrink-0 items-center gap-2 lg:flex">
            <ShareButton url={canonicalUrl} title={displayTitle} price={listing.price} currency={listing.currency} />
            <SaveListingButton id={listing.id} />
          </div>
        </div>

        {/* Enforcement caution (Phase 2) — one line, before any contact action.
            throttled = caution tint; held/suspended = stronger destructive wording. */}
        {sellerCaution && (
          <p
            className={cn(
              // self-start: as a flex child it would otherwise stretch full-width.
              'order-5 mb-4 inline-flex items-center gap-2 self-start rounded-xl px-3 py-2 text-[13px] font-semibold lg:order-none',
              sellerCaution === 'throttled' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive',
            )}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {sellerCaution === 'throttled'
              ? <Tr text="This seller is under review — trade with extra care" />
              : <Tr text="This seller's account is on hold — don't send money or deposits" />}
          </p>
        )}

        {/* Price directly under the GALLERY on MOBILE (headline of the page) —
            when the two-column layout stacks, the contact column's price lands
            ~4 viewports down (ux-24). Server-rendered duplicate (zero JS); the
            desktop column keeps its own copy, hidden <lg there / ≥lg here. */}
        <div className="order-3 mt-4 mb-4 space-y-1 lg:hidden">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} className="block text-2xl font-bold text-accent-foreground tracking-tight" />
            {/* Server-computed drop anchor (30-day-min reference) — never a seller-entered "was". */}
            {listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price) && (
              <>
                <Price price={listing.prevPrice} currency={listing.currency} priceUnit="VND" className="text-sm text-ink-4 line-through" />
                <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">
                  {dropPercent(listing.prevPrice, listing.price)}
                </span>
                <DropCountdown expiresAt={listing.dropExpiresAt} />
              </>
            )}
            {listing.urgent && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-700 px-2.5 py-1 text-[11px] font-bold text-white">
                <Zap className="h-3 w-3 fill-current" /><Tr text="Urgent sale" />
              </span>
            )}
            {!listing.negotiable && (
              <span className="inline-flex items-center rounded-full bg-tint px-2.5 py-1 text-[11px] font-bold text-body">
                <Tag className="mr-1 h-3 w-3" /><Tr text="Fixed price" />
              </span>
            )}
          </div>
          {showProof && <p className="flex items-center gap-2 text-xs text-muted-foreground">{socialProof}</p>}
          {priceBand && <div className="pt-2"><MarketPrice price={listing.price} band={priceBand} /></div>}
        </div>

        {/* Gallery mosaic */}
        <div className="relative order-2 lg:order-none">
          <ListingGallery images={listing.images} title={displayTitle} video={listing.video} showAllLabel="View all photos" />
          {/* Mobile/tablet: share + save overlay the media header (Shopee pattern) —
              the title-row pair above is desktop-only. Absolutely positioned (zero
              layout cost, no CLS) at top-right, clear of the carousel's n/N counter
              (bottom-right); z-10 stays under the lightbox (z-[100]). */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2 lg:hidden">
            <ShareButton url={canonicalUrl} title={displayTitle} price={listing.price} currency={listing.currency} compact />
            <SaveListingButton id={listing.id} compact className="h-9 w-9 border-0 bg-card/80 backdrop-blur" />
          </div>
        </div>

        {/* Highlights — scannable item facts up front (buyers scan before they read).
            Trust is just the color-coded score number, kept low-key (no second shield).
            Flex margins don't collapse, so <lg the title/caution mb-4 above already
            provides the gap (mt-0); ≥lg it follows the gallery with the original mt-5. */}
        <div className="order-6 flex flex-wrap items-center gap-2 lg:order-none lg:mt-5">
          {listing.condition && (
            <span className="inline-flex items-center rounded-full bg-tint px-3 py-1.5 text-xs font-semibold text-foreground">
              <Tr text={listing.condition === 'new' ? 'New' : listing.condition === 'used' ? 'Used' : listing.condition} />
            </span>
          )}
          {numericSpecs.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1 rounded-full bg-tint px-3 py-1.5 text-xs font-semibold text-foreground">
              <span className="text-ink-4"><Tr text={s.label} /></span> {s.value}
            </span>
          ))}
        </div>
        </div>

        {/* Content + sticky contact. The left column is split into two grid rows
            (description/details, then map) so DOM order puts the map AFTER the
            contact column — on mobile the stack reads price → seller → contact →
            map (ux-24) while ≥lg the grid restores map under the description. */}
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-x-10">
          {/* LEFT (row 1): protections strip + description + details. The strip is
              the first left-column child so on MOBILE (single column) it lands right
              after the header's price/highlights and immediately before the
              Description; ≥lg it sits under the gallery at the head of the copy. */}
          <div className="lg:col-span-7 flex flex-col gap-8">
            <ProtectionsRow />
            <div className="space-y-2">
              <h2 className="h-section text-foreground"><Tr text="Description" /></h2>
              <ListingDescription text={listing.description} i18n={i18n[listing.description]} className="space-y-3 text-[15px] leading-relaxed text-body" />
            </div>

            {(attrs.length > 0 || numericSpecs.length > 0) && (
              <div className="space-y-1">
                <h2 className="h-section text-foreground mb-2"><Tr text="Details" /></h2>
                <dl className="text-sm">
                  {numericSpecs.map((s) => (
                    <div key={s.label} className="flex items-start justify-between gap-4 py-2.5">
                      <dt className="text-muted-foreground"><Tr text={s.label} /></dt>
                      <dd className="font-medium text-foreground text-right">{s.value}</dd>
                    </div>
                  ))}
                  {attrs.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 py-2.5">
                      <dt className="capitalize text-muted-foreground"><Tr text={k.replace(/([A-Z])/g, ' $1')} /></dt>
                      <dd className="font-medium text-foreground text-right"><Tr text={String(v)} /></dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

          </div>

          {/* RIGHT: flat sticky contact column — no floating card, cohesive with
              the single-canvas page; a subtle left rule separates it on desktop.
              Spans both left rows so the map block below stays beside it ≥lg. */}
          <div className="lg:col-span-5 lg:row-span-2">
            <div className="lg:sticky lg:top-24 space-y-5 lg:border-l lg:border-border/70 lg:pl-10">
              {/* Price + social proof — desktop copy (the mobile copy sits under the title) */}
              <div className="hidden flex-wrap items-baseline gap-2 lg:flex">
                <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} className="text-3xl font-bold text-accent-foreground tracking-tight" />
                {listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price) && (
                  <>
                    <Price price={listing.prevPrice} currency={listing.currency} priceUnit="VND" className="text-base text-ink-4 line-through" />
                    <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">
                      {dropPercent(listing.prevPrice, listing.price)}
                    </span>
                    <DropCountdown expiresAt={listing.dropExpiresAt} />
                  </>
                )}
                {listing.urgent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-700 px-2.5 py-1 text-[11px] font-bold text-white">
                    <Zap className="h-3 w-3 fill-current" /><Tr text="Urgent sale" />
                  </span>
                )}
                {!listing.negotiable && (
                  <span className="inline-flex items-center rounded-full bg-tint px-2.5 py-1 text-[11px] font-bold text-body">
                    <Tag className="mr-1 h-3 w-3" /><Tr text="Fixed price" />
                  </span>
                )}
              </div>
              {showProof && (
                <p className="-mt-2.5 hidden items-center gap-2 text-xs text-muted-foreground lg:flex">{socialProof}</p>
              )}
              {priceBand && <div className="hidden lg:block"><MarketPrice price={listing.price} band={priceBand} /></div>}

              {/* Seller identity + honest trust metrics (shared SellerCard). "Chat now"
                  scrolls to the composer below; "View shop" opens the storefront.
                  Directly beneath: up to two verified-first reviews + the seller avg
                  (renders nothing when the seller has no reviews yet). */}
              <div className="space-y-4">
                <PdpSellerCard
                  seller={{
                    id: listing.seller.id,
                    name: listing.seller.name,
                    avatarColor: listing.seller.avatarColor,
                    isBusiness: listing.seller.isBusiness,
                  }}
                  metrics={sellerMetricsBundle}
                  storefrontHref={sellerHref}
                />
                <ReviewsPreview
                  reviews={reviewsPreview.reviews}
                  total={reviewsPreview.total}
                  avg={reviewsPreview.avg}
                  sellerHref={sellerHref}
                />
              </div>

              {/* Unified contact + offer (auth-gated; number never in this payload).
                  Type a message or tap "Make an offer", then send → opens the thread.
                  No escrow mention anywhere on the money path — unmet promises cost
                  trust (user decision 2026-07-05). */}
              <div id="contact" className="scroll-mt-24">
                <ContactComposer listingId={listing.id} listingTitle={displayTitle} listingImage={listing.images[0] ?? null} sellerName={listing.seller.name} price={listing.price} currency={listing.currency} negotiable={listing.negotiable} />
              </div>

              {/* Safety + report share one balanced row: the blue "Safe trading tips"
                  link on the left and its red safety sibling, the Report chip, on the
                  right — reads as a paired footer, not a stranded lone button. */}
              <div className="flex items-center justify-between gap-3">
                <Link href="/safety" className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground hover:underline">
                  <ShieldCheck className="h-3.5 w-3.5" /> <Tr text="Safe trading tips" />
                </Link>
                <ReportButton listingId={listing.id} />
              </div>
            </div>
          </div>

          {/* LEFT (row 2): map + safety note — after the contact column in the DOM
              so it stacks below the CTA on mobile; ≥lg the grid places it back
              under the description (cols 1–7, row 2). */}
          <div className="lg:col-span-7 flex flex-col gap-8">
            <div id="location-on-map" className="space-y-2 scroll-mt-20">
              <h2 className="h-section text-foreground"><Tr text="Location" /></h2>
              <div className="h-[260px] rounded-2xl overflow-hidden relative">
                <ListingDetailMap listings={[listing]} activeDistrict={listing.district || 'all'} />
              </div>
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
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
