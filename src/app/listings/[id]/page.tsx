import { cache } from 'react'
import { db } from '@/lib/db'
import { formatMoneyFull } from '@/lib/vnd'
import { serializeListing } from '@/lib/serialize'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { ListingGallery } from '@/components/marketplace/listing-gallery'
import { Footer } from '@/components/marketplace/footer'
import { CategoryIcon } from '@/components/marketplace/category-icons'
import { BrandLogo } from '@/components/marketplace/brand-logo'
import { brandIconPath } from '@/lib/brand-icons'
import {
  MapPin,
  AlertTriangle,
  Building2,
  ShieldCheck,
  Heart,
  Eye,
} from 'lucide-react'
import { RelatedListings } from '@/components/marketplace/related-listings'
import { RecentlyViewedRail } from '@/components/marketplace/recently-viewed-rail'
import { CATEGORY_COLOR_CLASSES } from '@/lib/types'
import { TrustScore } from '@/components/marketplace/trust-score'
import { Price } from '@/components/marketplace/price'
import { Tr } from '@/context/language-context'
import { LocalizedTitle, PostedAgo } from '@/components/marketplace/listing-content'
import { cn } from '@/lib/utils'
import { ListingDetailMap } from '@/components/marketplace/listing-detail-map'
import { ReportButton } from '@/components/marketplace/report-button'
import { ContactComposer } from '@/components/marketplace/contact-composer'
import { TrackView } from '@/components/marketplace/track-view'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { SaveListingButton } from '@/components/marketplace/save-listing-button'
import { ShareButton } from '@/components/marketplace/share-button'
import { currencyCode } from '@/lib/analytics'

type Props = {
  params: Promise<{ id: string }>
}

// ISR: render on-demand, then cache the HTML at the global edge (the #1 SEO page,
// served ~globally in tens of ms instead of a function+DB hit in Singapore per
// view). Self-heals hourly; mutation routes call revalidatePath('/listings/<id>')
// so an edit/sold/hidden/delete purges it immediately (a sold listing must 404).
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

  if (!listing) return {}

  // Use the listing's SOURCE title (as posted) for all BAKED, shared output — the
  // <title> tab, OG tags, JSON-LD, share text. This page is static HTML shared across
  // users, so it can't vary by language; forcing titleVi made an English app show a
  // Vietnamese tab. The visible H1 still localizes per-user via <LocalizedTitle>.
  const displayTitle = listing.title
  const desc = listing.description.slice(0, 160)
  const images = JSON.parse(listing.images || '[]')
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

  // Only publicly-live listings are viewable by direct URL; sold/hidden/held are
  // pulled from public view (sellers manage them in their dashboard).
  if (!rawListing || !rawListing.verified || rawListing.status !== 'active') {
    notFound()
  }

  const listing = serializeListing(rawListing)
  // Use the listing's SOURCE title (as posted) for all BAKED, shared output — the
  // <title> tab, OG tags, JSON-LD, share text. This page is static HTML shared across
  // users, so it can't vary by language; forcing titleVi made an English app show a
  // Vietnamese tab. The visible H1 still localizes per-user via <LocalizedTitle>.
  const displayTitle = listing.title
  const displayDesc = listing.description
  const color = CATEGORY_COLOR_CLASSES[listing.category.color] ?? CATEGORY_COLOR_CLASSES.brand

  const initials = listing.seller.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const attrs = listing.attributes ? Object.entries(listing.attributes) : []
  // Structured numeric specs (vehicles) — rendered first in Details, with units.
  const numericSpecs: { label: string; value: string }[] = []
  if (listing.year != null) numericSpecs.push({ label: 'Year', value: String(listing.year) })
  if (listing.mileageKm != null) numericSpecs.push({ label: 'Mileage', value: `${new Intl.NumberFormat('en-US').format(listing.mileageKm)} km` })
  if (listing.engineL != null) numericSpecs.push({ label: 'Engine', value: `${listing.engineL} L` })
  // Brand chip (when the listing carries a canonical brand) — links into the
  // brand-filtered feed. Resolve name + monotone logo server-side.
  const brand = listing.brandSlug
    ? await db.brand.findUnique({ where: { slug: listing.brandSlug }, select: { name: true, iconSlug: true, logoPath: true } })
    : null
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
      'priceValidUntil': new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString().split('T')[0], // 90 days
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

      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-12">
        {/* Breadcrumb — Home / Category / Title */}
        <nav aria-label="Breadcrumb" className="mb-4 truncate text-sm text-muted-foreground">
          <Link href="/" className="hover:text-accent-foreground transition-colors"><Tr text="Home" /></Link>
          <span className="mx-1.5 text-line-strong">/</span>
          <Link href={`/c/${rawListing.category.slug}`} className="hover:text-accent-foreground transition-colors"><Tr text={listing.category.name} /></Link>
          <span className="mx-1.5 text-line-strong">/</span>
          <span className="font-medium text-foreground"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} /></span>
        </nav>

        {/* Title header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <span className={cn('inline-flex w-fit items-center gap-1 text-xs font-semibold', color.text)}>
              <CategoryIcon name={listing.category.icon} className="h-3.5 w-3.5" />
              <Tr text={listing.category.name} />
            </span>
            <h1 className="h-title text-foreground"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} /></h1>
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
              <span className="truncate"><Tr text={listing.location} /></span>
            </div>
          </div>
          <div className="mt-0.5 flex shrink-0 items-center gap-2">
            <ShareButton url={canonicalUrl} title={displayTitle} price={listing.price} currency={listing.currency} />
            <SaveListingButton id={listing.id} />
          </div>
        </div>

        {/* Gallery mosaic */}
        <ListingGallery images={listing.images} title={displayTitle} showAllLabel="View all photos" />

        {/* Highlights — scannable item facts up front (buyers scan before they read).
            Trust is just the color-coded score number, kept low-key (no second shield). */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
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
          <span className="inline-flex items-center gap-1.5 rounded-full bg-tint px-3 py-1.5 text-xs font-semibold">
            <span className="text-ink-4"><Tr text="Trust" /></span>
            <TrustScore score={listing.seller.trustScore} variant="number" size="sm" />
          </span>
        </div>

        {/* Content + sticky contact */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
          {/* LEFT: details */}
          <div className="lg:col-span-7 flex flex-col gap-8">
            <div className="space-y-2">
              <h2 className="h-section text-foreground"><Tr text="Description" /></h2>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-body"><Tr text={listing.description} /></p>
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

          {/* RIGHT: flat sticky contact column — no floating card, cohesive with
              the single-canvas page; a subtle left rule separates it on desktop. */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-24 space-y-5 lg:border-l lg:border-border/70 lg:pl-10">
              <div className="flex items-baseline gap-2">
                <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} className="text-3xl font-bold text-foreground tracking-tight" />
              </div>

              {/* Quiet social proof — only above a credibility floor so a fresh
                  listing never advertises "0 saved" (saves ≥3 / views ≥20). */}
              {(listing.savedCount >= 3 || listing.views >= 20) && (
                <p className="-mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                  {listing.savedCount >= 3 && (
                    <span className="inline-flex items-center gap-1">
                      <Heart className="h-3.5 w-3.5" /> {new Intl.NumberFormat('en-US').format(listing.savedCount)} <Tr text="saved" />
                    </span>
                  )}
                  {listing.savedCount >= 3 && listing.views >= 20 && <span aria-hidden>·</span>}
                  {listing.views >= 20 && (
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" /> {new Intl.NumberFormat('en-US').format(listing.views)} <Tr text="views" />
                    </span>
                  )}
                </p>
              )}

              {/* Seller identity + trust in ONE cohesive block right under the price
                  (single trust badge — no duplicate shields). The block links to the
                  storefront; "How trust works" is a quiet secondary link. */}
              <div className="space-y-1.5">
                <Link href={`/sellers/${listing.sellerId}`} className="group flex items-center gap-3 cursor-pointer">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-foreground group-hover:underline">{listing.seller.name}</span>
                      {listing.seller.isBusiness && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-accent-foreground">
                          <Building2 className="h-3 w-3" /> <Tr text="Business" />
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
                <Link href="/trust" className="inline-block pl-14 text-[11px] text-muted-foreground underline-offset-2 hover:underline">
                  <Tr text="How trust works" />
                </Link>
              </div>

              {/* Escrow purchase — placeholder until payment/escrow licensing lands.
                  Non-interactive; signals the upcoming protected-buy flow so the
                  affordance is visible pre-launch. Wired with AddToCart/Purchase
                  events when escrow goes live. */}
              <div className="space-y-1.5">
                <div
                  role="button"
                  aria-disabled
                  className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-line-strong bg-muted px-5 py-3 text-sm font-bold text-muted-foreground"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <Tr text="Buy with escrow" />
                  <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                    <Tr text="Coming soon" />
                  </span>
                </div>
                <p className="text-center text-[11px] text-muted-foreground">
                  <Tr text="Protected payment held until you confirm — launching soon." />
                </p>
              </div>

              {/* Unified contact + offer (auth-gated; number never in this payload).
                  Type a message or tap "Make an offer", then send → opens the thread. */}
              <div id="contact" className="scroll-mt-24">
                <ContactComposer listingId={listing.id} listingTitle={displayTitle} listingImage={listing.images[0] ?? null} price={listing.price} currency={listing.currency} />
              </div>

              {/* Safety link by the contact action (buyers look for it before reaching out) */}
              <Link href="/safety" className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground hover:underline">
                <ShieldCheck className="h-3.5 w-3.5" /> <Tr text="Safe trading tips" />
              </Link>

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground"><Tr text="Posted" /> <PostedAgo iso={listing.postedAt} /></p>
                <ReportButton listingId={listing.id} />
              </div>
            </div>
          </div>
        </div>

        {/* More like this — same-category listings (client-fetched, ISR-safe) */}
        <RelatedListings listingId={listing.id} categorySlug={rawListing.category.slug} />

        {/* The buyer's own recently-viewed trail (excludes this listing). */}
        <RecentlyViewedRail excludeId={listing.id} />
      </main>

      <Footer />
    </div>
  )
}
