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
import { CATEGORY_COLOR_CLASSES, VERIFICATION_METHOD_LABELS, timeAgo } from '@/lib/types'
import { Price } from '@/components/marketplace/price'
import { Tr } from '@/context/language-context'
import { getServerLang, getDict } from '@/lib/translate-server'
import { cn } from '@/lib/utils'
import { ListingDetailMap } from '@/components/marketplace/listing-detail-map'
import { ReportButton } from '@/components/marketplace/report-button'
import { RevealContact } from '@/components/marketplace/reveal-contact'

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
    title: `${displayTitle} | ENO`,
    description: desc,
    // Pending (unverified) listings are hidden from the feed — don't let Google index them either.
    robots: listing.verified ? undefined : { index: false, follow: true },
    alternates: {
      canonical: `${hostUrl}/listings/${id}`,
    },
    openGraph: {
      title: `${displayTitle} | ENO`,
      description: desc,
      url: `${hostUrl}/listings/${id}`,
      siteName: 'ENO',
      type: 'website',
      images: images.map((img: string) => ({ url: img })),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${displayTitle} | ENO`,
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

  if (!rawListing) {
    notFound()
  }

  const listing = serializeListing(rawListing)
  const displayTitle = listing.titleVi || listing.title
  const displayDesc = listing.description
  const color = CATEGORY_COLOR_CLASSES[listing.category.color] ?? CATEGORY_COLOR_CLASSES.brand
  const methodLabel = listing.verificationMethod
    ? VERIFICATION_METHOD_LABELS[listing.verificationMethod]
    : null

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
    ...(methodLabel ? [methodLabel.label] : []),
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

  // Inject structured JSON-LD data for Google search compatibility
  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    'name': displayTitle,
    'image': listing.images,
    'description': displayDesc,
    'sku': listing.id,
    'mpn': listing.id,
    'offers': {
      '@type': 'Offer',
      'url': canonicalUrl,
      'priceCurrency': listing.currency === '₫' ? 'VND' : 'USD',
      'price': listing.price,
      'priceValidUntil': new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString().split('T')[0], // 90 days
      'itemCondition': schemaCondition,
      'availability': 'https://schema.org/InStock',
      'seller': {
        '@type': 'Person',
        'name': listing.seller.name,
      },
    },
  }

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      {/* JSON-LD — only for verified listings (don't rich-snippet hidden/pending ones) */}
      {listing.verified && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}

      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4 pb-12">
        {/* Back Link */}
        <div className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#64748b] hover:text-[#0a66c2] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span><Tr text="Back to marketplace" /></span>
          </Link>
        </div>

        {/* Title header */}
        <div className="mb-4 space-y-1.5">
          <span className={cn('inline-flex w-fit items-center gap-1 text-xs font-semibold', color.text)}>
            <CategoryIcon name={listing.category.icon} className="h-3.5 w-3.5" />
            {tx(listing.category.name)}
          </span>
          <h1 className="h-title text-[#1a202c]">{resolvedTitle}</h1>
          <div className="flex items-center gap-1 text-sm text-[#64748b]">
            <MapPin className="h-4 w-4 text-[#94a3b8] shrink-0" />
            <span className="truncate">{tx(listing.location)}</span>
          </div>
        </div>

        {/* Gallery mosaic */}
        <ListingGallery images={listing.images} title={displayTitle} showAllLabel="View all photos" />

        {/* Content + sticky contact */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {/* LEFT: details */}
          <div className="lg:col-span-7 flex flex-col gap-8">
            <div className="space-y-2">
              <h2 className="h-section text-[#1a202c]"><Tr text="Description" /></h2>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-[#475569]">{tx(listing.description)}</p>
            </div>

            {attrs.length > 0 && (
              <div className="space-y-1">
                <h2 className="h-section text-[#1a202c] mb-2"><Tr text="Details" /></h2>
                <dl className="divide-y divide-slate-100 text-sm">
                  {attrs.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 py-2.5">
                      <dt className="capitalize text-[#64748b]">{tx(k.replace(/([A-Z])/g, ' $1'))}</dt>
                      <dd className="font-medium text-[#1a202c] text-right">{tx(String(v))}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className="space-y-2">
              <h2 className="h-section text-[#1a202c]"><Tr text="Location" /></h2>
              <div className="h-[260px] rounded-2xl overflow-hidden relative">
                <ListingDetailMap listings={[listing]} activeDistrict={listing.district || 'all'} />
              </div>
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-[#64748b]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <Tr text="Meet in a public place and inspect the item before paying. ENO never asks for a deposit via a link." />
            </p>
          </div>

          {/* RIGHT: sticky contact card */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-24 rounded-2xl border border-slate-200 bg-white shadow-pop p-5 space-y-4">
              <div className="flex items-baseline gap-2">
                <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} className="text-3xl font-bold text-[#1a202c] tracking-tight" />
                {listing.negotiable && <span className="text-sm text-[#64748b]">· <Tr text="Negotiable" /></span>}
              </div>

              {listing.verified ? (
                <div className="rounded-lg bg-[#e8f1fb] px-3 py-2 text-xs text-[#0a66c2]">
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 shrink-0" />
                    <span className="font-semibold"><Tr text="Verified by ENO" /></span>
                    {methodLabel && <span>· {tx(methodLabel.label)}</span>}
                  </div>
                  {(listing.verifiedBy || listing.verifiedAt || listing.verificationNotes) && (
                    <div className="mt-1.5 pl-6 text-[11px] leading-relaxed text-[#0052cc]">
                      {listing.verifiedBy}
                      {listing.verifiedBy && listing.verifiedAt && ' · '}
                      {listing.verifiedAt && new Date(listing.verifiedAt).toLocaleDateString('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {listing.verificationNotes && <div className="italic text-[#0a66c2]">“<Tr text={listing.verificationNotes} />”</div>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span><Tr text="Pending review — this listing is hidden until verified by ENO." /></span>
                </div>
              )}

              {/* Contact is auth-gated; the number is never in this payload */}
              <RevealContact listingId={listing.id} />

              <Link href={`/sellers/${listing.sellerId}`} className="group flex items-center gap-3 border-t border-slate-100 pt-4 cursor-pointer">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-sm font-bold text-[#0a66c2]">
                  {initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-[#1a202c] group-hover:underline">{listing.seller.name}</span>
                    {listing.seller.verifiedSeller && <BadgeCheck className="h-4 w-4 shrink-0 text-[#0a66c2]" />}
                  </div>
                  <span className="flex items-center gap-1 text-xs text-[#64748b]">
                    <Star className="h-3 w-3 fill-[#1a202c] text-[#1a202c] shrink-0" />
                    {listing.seller.rating.toFixed(1)} ({listing.seller.reviewCount}) · <Tr text="View profile" />
                  </span>
                </div>
              </Link>

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-[#64748b]"><Tr text="Posted" /> {timeAgo(listing.postedAt, 'vi')}</p>
                <ReportButton listingId={listing.id} />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile sticky contact bar */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md">
        <div className="min-w-0 flex-1">
          <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} className="truncate text-base font-bold text-[#1a202c]" />
          {listing.verified && <div className="text-[11px] font-semibold text-[#0a66c2]"><Tr text="Verified" /></div>}
        </div>
        <RevealContact listingId={listing.id} compact />
      </div>

      <Footer />
    </div>
  )
}
