import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { ListingGallery } from '@/components/marketplace/listing-gallery'
import { Footer } from '@/components/marketplace/footer'
import { CategoryIcon } from '@/components/marketplace/category-icons'
import {
  MapPin,
  Star,
  BadgeCheck,
  AlertTriangle,
  ChevronLeft,
} from 'lucide-react'
import { CATEGORY_COLOR_CLASSES, timeAgo } from '@/lib/types'
import { TrustBadge } from '@/components/marketplace/trust-badge'
import { Price } from '@/components/marketplace/price'
import { Tr } from '@/context/language-context'
import { getServerLang, getDict } from '@/lib/translate-server'
import { cn } from '@/lib/utils'
import { ListingDetailMap } from '@/components/marketplace/listing-detail-map'
import { ReportButton } from '@/components/marketplace/report-button'
import { ContactComposer } from '@/components/marketplace/contact-composer'
import { TrackView } from '@/components/marketplace/track-view'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { SaveListingButton } from '@/components/marketplace/save-listing-button'
import { currencyCode } from '@/lib/analytics'

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const listing = await db.listing.findUnique({
    where: { id },
    include: { category: true },
  })

  if (!listing) return {}

  const displayTitle = listing.titleVi || listing.title
  const desc = listing.description.slice(0, 160)
  const images = JSON.parse(listing.images || '[]')
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

  return {
    title: `${displayTitle} | eno.vn`,
    description: desc,
    // Only publicly-live listings (verified + active) are indexable; sold/hidden/held are not.
    robots: listing.verified && listing.status === 'active' ? undefined : { index: false, follow: true },
    alternates: {
      canonical: `${hostUrl}/listings/${id}`,
    },
    openGraph: {
      title: `${displayTitle} | eno.vn`,
      description: desc,
      url: `${hostUrl}/listings/${id}`,
      siteName: 'eno.vn',
      type: 'website',
      images: images.map((img: string) => ({ url: img })),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${displayTitle} | eno.vn`,
      description: desc,
      images: images[0] ? [images[0]] : undefined,
    },
  }
}

export default async function ListingPage({ params }: Props) {
  const { id } = await params
  const rawListing = await db.listing.findUnique({
    where: { id },
    include: { category: true, seller: true },
  })

  // Only publicly-live listings are viewable by direct URL; sold/hidden/held are
  // pulled from public view (sellers manage them in their dashboard).
  if (!rawListing || !rawListing.verified || rawListing.status !== 'active') {
    notFound()
  }

  const listing = serializeListing(rawListing)
  const displayTitle = listing.titleVi || listing.title
  const displayDesc = listing.description
  const color = CATEGORY_COLOR_CLASSES[listing.category.color] ?? CATEGORY_COLOR_CLASSES.brand

  const initials = listing.seller.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const attrs = listing.attributes ? Object.entries(listing.attributes) : []
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  const canonicalUrl = `${hostUrl}/listings/${listing.id}`

  // Server-resolve the listing CONTENT into the visitor's language (from the warm
  // Postgres cache, via the `lang` cookie) so it renders in-language on the FIRST
  // paint — no client translation swap. This page is already dynamic (ƒ), so the
  // cookie read carries no ISR cost. UI labels stay as <Tr> (instant client swap).
  const lang = await getServerLang()
  const contentDict = await getDict(lang, [
    listing.title,
    listing.description,
    listing.location,
    listing.category.name,
    ...attrs.flatMap(([k, v]) => [k.replace(/([A-Z])/g, ' $1'), String(v)]),
  ])
  const tx = (s: string) => contentDict[s] ?? s
  // vi has a hand-authored title; everything else uses the resolved translation.
  const resolvedTitle = lang === 'vi' ? (listing.titleVi || listing.title) : tx(listing.title)

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
      />

      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-12">
        {/* Back Link */}
        <div className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-accent-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span><Tr text="Back to marketplace" /></span>
          </Link>
        </div>

        {/* Title header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <span className={cn('inline-flex w-fit items-center gap-1 text-xs font-semibold', color.text)}>
              <CategoryIcon name={listing.category.icon} className="h-3.5 w-3.5" />
              {tx(listing.category.name)}
            </span>
            <h1 className="h-title text-foreground">{resolvedTitle}</h1>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 text-ink-4 shrink-0" />
              <span className="truncate">{tx(listing.location)}</span>
            </div>
          </div>
          <SaveListingButton id={listing.id} className="mt-0.5 shrink-0" />
        </div>

        {/* Gallery mosaic */}
        <ListingGallery images={listing.images} title={displayTitle} showAllLabel="View all photos" />

        {/* Content + sticky contact */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
          {/* LEFT: details */}
          <div className="lg:col-span-7 flex flex-col gap-8">
            <div className="space-y-2">
              <h2 className="h-section text-foreground"><Tr text="Description" /></h2>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-body">{tx(listing.description)}</p>
            </div>

            {attrs.length > 0 && (
              <div className="space-y-1">
                <h2 className="h-section text-foreground mb-2"><Tr text="Details" /></h2>
                <dl className="divide-y divide-border text-sm">
                  {attrs.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 py-2.5">
                      <dt className="capitalize text-muted-foreground">{tx(k.replace(/([A-Z])/g, ' $1'))}</dt>
                      <dd className="font-medium text-foreground text-right">{tx(String(v))}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className="space-y-2">
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
                {listing.negotiable && <span className="text-sm text-muted-foreground">· <Tr text="Negotiable" /></span>}
              </div>

              {(listing.seller.trustTier === 'trusted' || listing.seller.trustTier === 'exceptional') && (
                <div className="flex items-center gap-2">
                  <TrustBadge tier={listing.seller.trustTier} size="md" />
                  <span className="text-xs text-muted-foreground">
                    <Tr text="Earned on eno.vn from a clean track record" />
                  </span>
                </div>
              )}

              {/* Unified contact + offer (auth-gated; number never in this payload).
                  Type a message or tap "Make an offer", then send → opens the thread. */}
              <ContactComposer listingId={listing.id} listingTitle={displayTitle} listingImage={listing.images[0] ?? null} price={listing.price} currency={listing.currency} />

              <Link href={`/sellers/${listing.sellerId}`} className="group flex items-center gap-3 border-t border-border pt-4 cursor-pointer">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                  {initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-foreground group-hover:underline">{listing.seller.name}</span>
                    {listing.seller.verifiedSeller && <BadgeCheck className="h-4 w-4 shrink-0 text-accent-foreground" />}
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Star className="h-3 w-3 fill-foreground text-foreground shrink-0" />
                    {listing.seller.rating.toFixed(1)} ({listing.seller.reviewCount}) · <Tr text="View profile" />
                  </span>
                </div>
              </Link>

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground"><Tr text="Posted" /> {timeAgo(listing.postedAt, lang)}</p>
                <ReportButton listingId={listing.id} />
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
