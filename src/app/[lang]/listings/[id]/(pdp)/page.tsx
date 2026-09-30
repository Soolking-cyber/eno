import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { FREE_TEXT_ATTRIBUTES, JOB_TEXT_ATTRIBUTES, facetsFor, isVisaProductSlot } from '@/lib/taxonomy'
import { TeacherProfileView } from '@/components/teachers/teacher-profile-view'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { plainSnippet } from '@/lib/strip-md'
import { feedIdentifiers } from '@/lib/product-feed'
import { listingJsonLd } from '@/lib/listing-jsonld'
import { VisaDisclosure } from '@/components/marketplace/visa-disclosure'
import { NOT_GOVERNMENT } from '@/lib/visa-provider'
import { scopedListingWhere } from '@/lib/edition-scope'
import { getListing } from './get-listing'
import { type ReactNode } from 'react'
import { db } from '@/lib/db'
import { formatMoneyFull, dropPercent } from '@/lib/vnd'
import { serializeListing, safeParse } from '@/lib/serialize'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { SHARE_CARD, SHARE_CARD_ALT } from '@/lib/site-identity'
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
  Clock,
  Heart,
  Eye,
  Tag,
  Zap,
} from '@/components/ui/icons'
import { RelatedListings } from '@/components/marketplace/related-listings'
import { RecentlyViewedRail } from '@/components/marketplace/recently-viewed-rail'
import { CATEGORY_COLOR_CLASSES } from '@/lib/types'
import { Price } from '@/components/marketplace/price'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Tr } from '@/context/language-context'
import { LocalizedTitle, LocalizedText, ListingDescription, PostedAgo } from '@/components/marketplace/listing-content'
import { hideRepeatedFacts } from '@/components/marketplace/rich-text'
import { CalendarDay } from '@/components/marketplace/calendar-day'
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
import { RentalCheckToggle } from '@/components/marketplace/rental-check-toggle'
import { AffiliateBooking, AffiliateCtaRepeat } from '@/components/marketplace/affiliate-booking'
import { ImportProvenance } from '@/components/marketplace/import-provenance'
import { importProvenance } from '@/lib/import-provenance'
import { JobApplyGuard } from '@/components/marketplace/job-apply-guard'
import { safeAffiliateUrl } from '@/lib/affiliate-qr'
import { isBookingCategory } from '@/lib/affiliate-kind'
import { isImportSeller } from '@/lib/import-sellers'
import { approximateArea, hasRealCoords } from '@/lib/geo'
import { isVehicleHireReference } from '@/lib/rental-places'
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
  params: Promise<{ id: string; lang?: string }>
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
// The loader moved to ./get-listing so `layout.tsx` can share the same cache() memo — see there.

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const listing = await getListing(id)

  // ⚠️ THIS notFound() NEVER PRODUCED A 404 BY ITSELF. The comment here once claimed it did, for
  // months, while production answered 200 (measured 2026-09-07). generateMetadata renders as a
  // SIBLING of the page element (next/dist/server/app-render/create-component-tree.js), so under the
  // segment's old loading boundary it landed
  // INSIDE that Suspense boundary: React routed the error to Fizz's `onError` rather than
  // `onShellError`, only the latter rejects the render promise, and only a rejected render promise
  // sets `res.statusCode` (app-render.js, the `isHTTPAccessFallbackError` branch). The 200 was then
  // stored and re-served from cache for 30 days.
  // ⛔ THE 404 COMES FROM `./layout.tsx`, which decides it first with the same rule in three columns,
  // and since SEO wave B, H1a (2026-09-28) the page body's own guard is in the shell too: the segment
  // has no `loading.tsx` (`src/app/[lang]/crawler-visible-html-contract.test.ts`). Do not rely on this
  // call alone: metadata may still be streamed apart from the shell. It stays the authority on the
  // FULL policy below, which the layout deliberately does not duplicate.
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
  // A JOB's baked label is the pay AS THE POSTING STATES IT (attributes.salaryText): its stored price is
  // only the lower bound of a range, and "English Teacher — 10.000.000 đ" would misstate a 10–30 tr job.
  const isJobListing = listing.listingType === 'job'
  const jobAttrs = isJobListing ? safeParse<Record<string, unknown>>(listing.attributes ?? '{}', {}) : {}
  const jobSalary = typeof jobAttrs.salaryText === 'string' ? jobAttrs.salaryText : null
  const priceLabel = isJobListing ? (jobSalary ?? '') : listing.price > 0 ? formatMoneyFull(listing.price, listing.currency) : ''
  // A linked job closes on its apply-by date, but this page is ISR-cached for 30 days. `unavailable_after`
  // tells Google the date itself, from row data, so it is stable across regenerations.
  // safeAffiliateUrl, the page's own predicate: a link the page will not trust makes it an ordinary listing.
  const jobApplyByMeta = !!safeAffiliateUrl(listing.affiliateUrl) && typeof jobAttrs.applyBy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(jobAttrs.applyBy) ? jobAttrs.applyBy : null
  // Meta description: the listing body when the seller wrote one; otherwise a
  // composed fallback ("TITLE — PRICE, CATEGORY in LOCATION on eno.vn") so an
  // empty body never ships a junk description like "21,000,000 VND · ".
  // Flattened: a rich body's headings and bullets must not reach the meta tag as literal ** and - (plainSnippet).
  const bodyDesc = plainSnippet(listing.description)
  const facts = [priceLabel, listing.category.name].filter(Boolean).join(', ')
  const fallbackDesc = `${displayTitle}${facts ? ` — ${facts}` : ''}${listing.location ? ` in ${listing.location}` : ''} on eno.vn`
  const desc = (bodyDesc || fallbackDesc).slice(0, 160)
  // The fallback already carries the price — only prefix it onto a real body.
  const ogTitle = priceLabel ? `${displayTitle} — ${priceLabel}` : displayTitle
  const ogDesc = priceLabel && bodyDesc ? `${priceLabel} · ${desc}` : desc

  // A teacher is a person: the title says so, and no price label ever rides on it (2026-09-30).
  const isTeacher = listing.listingType === TEACHER_LISTING_TYPE
  return {
    title: isTeacher ? `${displayTitle} — ${(await params).lang === 'vi' ? 'Giáo viên tại Việt Nam' : 'Teacher in Vietnam'} | ${SITE_NAME}` : priceLabel ? `${displayTitle} — ${priceLabel} | ${SITE_NAME}` : `${displayTitle} | ${SITE_NAME}`,
    description: desc,
    // Only publicly-live listings (verified + active) are indexable; sold/hidden/held are not.
    // ⛔ An imported vehicle-hire reference is live but noindex — src/lib/rental-places.ts says why.
    robots: listing.verified && listing.status === 'active'
      ? (isVehicleHireReference({ affiliateUrl: listing.affiliateUrl, subcategorySlug: listing.subcategorySlug, categorySlug: listing.category.slug })
        ? { index: false, follow: true }
        : jobApplyByMeta ? { index: true, follow: true, unavailable_after: `${jobApplyByMeta}T23:59:59+07:00` } : undefined)
      : { index: false, follow: true },
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
      type: isTeacher ? 'profile' : 'website',
      // ⚠️ NO og:locale HERE, ON PURPOSE. The seller's words are in whatever language they wrote, and
      // a shape guess (site-identity.ts ogLocaleFor, fine for copy WE write) reads a Vietnamese listing
      // whose description names "Samsung Galaxy Tab Pro" as English — four unmarked words (review,
      // 2026-09-29). Saying nothing leaves the platform's default, which is what this page always sent.
      // ⚠️ A LISTING WITH NO PHOTO STILL UNFURLS WITH AN IMAGE — the site's card. This object REPLACES
      // the layout's, so an empty list here meant no og:image at all (pageOpenGraph, site-identity.ts).
      images: images.length ? images.map((img: string) => ({ url: img })) : [{ ...SHARE_CARD, alt: SHARE_CARD_ALT }],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: ogDesc,
      images: [images[0] ?? SHARE_CARD.url],
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
  // ⛔ A TEACHER IS A PERSON, NOT A PRODUCT (2026-09-30): its own page — no price, offers, map,
  // Product JSON-LD, seller-contact reveal or safety price copy. Only live rows reach here
  // (the guard above), so the page is indexable exactly when any listing is.
  if (rawListing.listingType === TEACHER_LISTING_TYPE) {
    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
    return (
      <TeacherProfileView
        listing={{ id: listing.id, title: listing.title, images: listing.images, video: listing.video ?? null, updatedAt: rawListing.updatedAt }}
        canonicalUrl={`${hostUrl}/listings/${listing.id}`}
        indexable={rawListing.status === 'active'}
        lang={(await params).lang === 'vi' ? 'vi' : 'en'}
      />
    )
  }
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
  // Book a park, buy a laptop — the words and the price treatment differ (owner, 2026-08-24).
  const isBooking = isBookingCategory(listing.category?.slug)
  // A JOB reference listing (imported from a job board, applied for on the original posting). Keyed on
  // listingType AND the link: an ordinary employer's own job post has no affiliateUrl and keeps chat.
  const isJob = !!affiliateUrl && listing.listingType === 'job'
  const jobApplyBy = isJob && typeof listing.attributes?.applyBy === 'string' ? (listing.attributes.applyBy as string) : null
  // A REFERENCE listing from an import storefront (a job board, or a rental portal such as Chợ Tốt):
  // eno.vn never rated the source, so the shop row shows "not vetted" instead of a trust chip — its
  // storefront's 100 is a ranking default, not the /trust Trusted tier. See PdpShopLink's `linked`.
  const linkedSeller = isJob ? 'job' as const : affiliateUrl && isImportSeller(listing.sellerId) ? 'listing' as const : null
  // Where an IMPORTED listing came from, and the date that is true for that source (SEO wave B, P1):
  // a rental portal's own post date, the day eno imported it, or — for a partner shop's item — no date.
  // ⚠️ The RAW columns: `listing.postedAt` is serialized as the later of postedAt and createdAt.
  const provenance = importProvenance({
    sellerId: listing.sellerId,
    sellerName: listing.seller.name,
    affiliateUrl,
    listingType: listing.listingType,
    postedAt: rawListing.postedAt,
    createdAt: rawListing.createdAt,
  })
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
  const [i18n, brand, ownerEnforcement, reviewsPreview, moreFromSeller, convoCount90, priceBand, partnerListingCount] = await Promise.all([
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
    // Market-price band for this brand+model on THIS shelf (null when there aren't enough comparables,
    // or the listing has no subcategory — a case is never judged against the phone it fits).
    getPriceBand({ brandSlug: listing.brandSlug, model: listing.model, categorySlug: rawListing.category.slug, subcategorySlug: rawListing.subcategorySlug, listingType: rawListing.listingType, condition: listing.condition, year: listing.year }),
    // An official partner's live listing count, for '{n} listings on eno.vn' in the shop row (owner,
    // 2026-09-30, K-TRUST-BADGE option D). Partners only: one indexed count, and only on ISR regen.
    // Edition-scoped exactly like the storefront's `_count` (seller-storefront.tsx), so the two agree.
    listing.seller.officialPartner
      ? scopedListingWhere({ sellerId: listing.sellerId, verified: true, status: 'active' }).then((where) => db.listing.count({ where }))
      : Promise.resolve(null),
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
  const attrFacets = facetsFor(rawListing.category.slug, rawListing.subcategorySlug)
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
  // A motorbike's displacement is stored in cc (the filterable `engineCc` range column), and was never
  // shown anywhere on the page it filters to. Only when there is no litre figure — one engine, one chip.
  if (listing.engineL == null && rawListing.engineCc != null && rawListing.engineCc > 0) numericSpecs.push({ label: 'Engine', value: <><CountValue value={rawListing.engineCc} /> cc</> })
  // Floor area (the `areaM2` range column, filterable on /c/rentals) — in Details ONLY, never as a meta
  // chip: the chips sit between the title and the CTA, and every one of them is spent from the phone fold.
  const detailOnlySpecs: { label: string; value: ReactNode }[] = []
  if (rawListing.areaM2 != null && rawListing.areaM2 > 0) detailOnlySpecs.push({ label: 'Area', value: <><CountValue value={rawListing.areaM2} /> m²</> })
  // Details rows that say nothing to a reader: an eSIM's "Service location: Online" (the facet is
  // excluded for eSIM, so it printed its raw key), a partner row's DERIVED "Provider: Business" facet
  // (taxonomy's providerType), and a Network row that repeats the Carrier beside it.
  const hiddenAttrs = new Set<string>()
  if (rawListing.subcategorySlug === 'esim') hiddenAttrs.add('serviceLocation')
  if (affiliateUrl) hiddenAttrs.add('providerType')
  if (listing.attributes?.network != null && listing.attributes.network === listing.attributes.carrier) hiddenAttrs.add('network')
  const detailAttrs = attrs.filter(([k]) => !hiddenAttrs.has(k))
  const showDetails = detailAttrs.length > 0 || numericSpecs.length > 0 || detailOnlySpecs.length > 0
  // The Details rows this page renders, by the name rich-text.tsx gives each (the spec label lower-cased,
  // the attribute key as stored): the description hides its own row for any of them, so an imported
  // rental's Area / Bedrooms / Bathrooms are not printed twice, one table above the other.
  const repeatedFacts = hideRepeatedFacts([...numericSpecs, ...detailOnlySpecs].map((s) => s.label.toLowerCase()).concat(detailAttrs.map(([k]) => k)))
  // ⚠️ A DESCRIPTION THAT ONLY REPEATS THE TITLE IS NOT SHOWN. Importers copy the title into the body
  // when the feed has none ('iPhone 18 Pro 256GB' under an H1 saying 'iPhone 18 Pro 256GB'), which
  // spent a section heading and a line on nothing. Compared on letters and digits only, so case,
  // punctuation and Unicode form do not decide it — and against BOTH title columns: a localized import
  // keeps its English title in `title` and the source's Vietnamese one in `titleVi`, while the copied
  // body is the Vietnamese ('Sofa Băng Cũ …' under 'Used Sofa Bench …'), which is still only the title.
  // Metadata and JSON-LD still use the description.
  const normText = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const descNorm = normText(listing.description)
  const showDescription = descNorm !== '' && descNorm !== normText(listing.title) && descNorm !== normText(listing.titleVi ?? '')
  // Brand chip (when the listing carries a canonical brand) — links into the
  // brand-filtered feed (resolved in the parallel batch above).
  const brandLogoPath = brand ? brandIconPath(brand) : null
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  const canonicalUrl = `${hostUrl}/listings/${listing.id}`

  // Structured data for Google rich results. Indexable listings only (verified +
  // active); sold/hidden never get rich-snippeted.
  const indexable = listing.verified && listing.status === 'active'

  /**
   * ⛔ THE SAME IDENTIFIERS THE MERCHANT FEED SUBMITS, DERIVED BY THE SAME FUNCTION. Google reads
   * the feed row and then crawls this page to check it; when the two disagree about a GTIN or an
   * MPN, it is the disagreement itself that disapproves the item. Two independent expressions of
   * "what identifies this product" is how that disagreement gets written, so there is one.
   */
  const productIds = feedIdentifiers({
    model: listing.model, attributes: listing.attributes,
    brandSlug: listing.brandSlug, condition: listing.condition,
  })

  /**
   * THE ONE ITEM THIS PAGE PUBLISHES, BY KIND (src/lib/listing-jsonld.ts, SEO wave B, S3): a Product
   * for goods, a RealEstateListing for a rental, a Service for a service, and nothing for a job, a
   * wanted post, an event, a short stay or vehicle hire. It replaced one Product+Offer on every
   * listing but a job, which said rentals were for sale, services were used products, an unset
   * condition was "used", every price expired after 90 days, and own listings shipped free with no
   * returns. The builder is pure; this page only hands it the row's fields.
   */
  const itemLd = indexable
    ? listingJsonLd({
        id: listing.id,
        url: canonicalUrl,
        title: displayTitle,
        description: displayDesc,
        images: listing.images,
        price: listing.price,
        currency: currencyCode(listing.currency),
        priceUnit: listing.priceUnit,
        listingType: listing.listingType,
        categorySlug: rawListing.category.slug,
        categoryName: listing.category.name,
        subcategorySlug: rawListing.subcategorySlug,
        condition: listing.condition,
        status: listing.status,
        sellerId: listing.sellerId,
        sellerName: listing.seller.name,
        sellerHasOwner: rawListing.seller.ownerId != null,
        sellerIsBusiness: listing.seller.isBusiness,
        sellerOfficialPartner: listing.seller.officialPartner,
        // The STORED column, not the checked link: a row an importer wrote is an import even if its
        // link fails safeAffiliateUrl, and its "Posted" date is still the day eno imported it.
        imported: !!listing.affiliateUrl,
        // The same condition that prints "from" beside the price.
        isBooking: !!affiliateUrl && isBooking,
        brandName: brand?.name ?? null,
        gtin: productIds.gtin,
        mpn: productIds.mpn,
        areaM2: rawListing.areaM2,
        attributes: listing.attributes,
        district: listing.district,
        city: listing.city,
        postedAt: listing.postedAt,
      })
    : null

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

  // The bottom safety note, per listing TYPE (see its render). A job keeps its fee-scam line even when
  // it is an employer's own post; any other partner row gets none (the SafetyStrip carries it).
  // ⚠️ Every sentence must stay true to the code: eno holds no money for any listing (no escrow).
  const catSlug = rawListing.category.slug
  // ⚠️ AN E-VISA PAGE KEEPS THE LINE IT HAD. Visa copy is held for the owner (2026-09-29, "no copy
  // change about visa"), and the services line would contradict the page's own flow: the visa desk
  // quotes in chat and, on eno.forum, takes the payment there (visa-cards.tsx pay card) — so "never
  // send a deposit through a link" is not advice this page can give. Keyed on the visa SLOT as well
  // as the desk check, because on eno.vn the same e-visa listings (14 live in services/visa-legal,
  // 2026-09-29) render with ContactComposer — isVisaProduct is false there — and would switch lines too.
  const visaCopyHeld = isVisaProduct || isVisaProductSlot(catSlug, rawListing.subcategorySlug)
  /**
   * ⚠️ THE SITE THAT "NEVER ASKS" IS THE ONE THE READER IS ON. These lines said "eno.vn" on both
   * editions, so eno.forum's PDP named the other site (review, 2026-09-29). Two literal copies behind
   * the edition ternary, never `${SITE_NAME}` inside the copy: gen-ui-strings harvests LITERALS only
   * (footer.tsx and sign-in-card.tsx spell out the same trap). eno.vn keeps its <Tr> lines and their
   * curated vi-overrides word for word; the eno.forum lines are authored pairs through `tr` below — a
   * literal-pair builder named `tr` so the harvest sees them (the dashboard-nav.tsx precedent).
   * ⛔ An e-visa page keeps the line it had on BOTH editions — visa copy is held for the owner (above).
   */
  const tr = (en: string, vi: string) => <Bilingual en={en} vi={vi} />
  const safetyNote = listing.listingType === 'job'
    ? <Tr text="Never pay a fee, a deposit or for training to get a job, and don't send copies of your ID documents before you have checked the employer." />
    : affiliateUrl ? null
    : (catSlug === 'rentals' || catSlug === 'property' || listing.listingType === 'rent')
      ? (IS_SERVICES
        ? tr("Visit in person and check the owner's papers before paying any deposit. eno.forum never asks for a deposit via a link.", 'Hãy đến xem tận nơi và kiểm tra giấy tờ của chủ sở hữu trước khi đặt cọc. eno.forum không bao giờ yêu cầu đặt cọc qua đường link.')
        : <Tr text="Visit in person and check the owner's papers before paying any deposit. eno.vn never asks for a deposit via a link." />)
    : (catSlug === 'services' || listing.listingType === 'service') && !visaCopyHeld
      ? (IS_SERVICES
        ? tr('Agree what is included and the price in chat before paying, and never send a deposit through a link. eno.forum never asks for one.', 'Thống nhất nội dung và giá dịch vụ trong khung chat trước khi thanh toán, và đừng bao giờ chuyển tiền cọc qua đường link. eno.forum không bao giờ yêu cầu điều đó.')
        : <Tr text="Agree what is included and the price in chat before paying, and never send a deposit through a link. eno.vn never asks for one." />)
    : IS_SERVICES && !visaCopyHeld
      ? tr('Meet in a public place and inspect the item before paying. eno.forum never asks for a deposit via a link.', 'Hãy gặp ở nơi công cộng và kiểm tra món hàng trước khi trả tiền. eno.forum không bao giờ yêu cầu đặt cọc qua đường link.')
    : <Tr text="Meet in a public place and inspect the item before paying. eno.vn never asks for a deposit via a link." />

  // Quiet social proof — only above a credibility floor so a fresh listing never
  // advertises "0 saved" (saves ≥3 / views ≥20). Rendered twice: under the title
  // on mobile and in the contact column on desktop (each hidden on the other).
  const showProof = listing.savedCount >= 3 || listing.views >= 20
  // 'Posted 1mo ago' on a partner's evergreen catalogue row (a park ticket, an eSIM plan, a shop's
  // phone) is the IMPORT date, which says nothing about the item. A linked job keeps it: there it is
  // the board's own posting date, and freshness is the point.
  // ⚠️ AN IMPORTED RENTAL LOST IT TO THE PROVENANCE LINE (decision P-c). "Posted 3d ago" printed the
  // serialized date, the LATER of the source's post and eno's import (stale.ts listedAt), so a Chợ Tốt
  // ad re-imported this week read as fresh; the line under the CTA now says which date it is and whose.
  // A partner rental with no line (an affiliate rent row from a seller outside the rental importers)
  // keeps the row as before.
  const showPosted = !affiliateUrl || isJob || (listing.listingType === 'rent' && !provenance)
  // ⚠️ A SELLER'S OWN LISTING WITH NO STORED COORDINATE SHOWS ITS AREA, NOT A PIN (owner, 2026-09-30,
  // P-MAP). The pin was the city/district centroid plus a ±1km jitter (geo.ts getListingCoordinates):
  // a precise-looking point that is not the item's place. approximateArea is null when the city is not
  // recognised — the old pin then sat in Saigon by default, so that case now shows no map at all.
  const realCoords = hasRealCoords(listing.lat, listing.lng)
  const approxArea = !realCoords && !affiliateUrl ? approximateArea(listing) : null
  const showMap = !isJob && (realCoords || approxArea !== null)
  // P-CTA part B (owner, 2026-09-30): repeat the partner CTA once, after the description, on a LONG
  // partner PDP — one where the buy box is well out of sight by the end of the text. "Long" = a
  // description of 600+ characters or 8+ Details rows (the eSIM and rental imports carry both).
  const detailRowCount = numericSpecs.length + detailOnlySpecs.length + detailAttrs.length
  const repeatCta = !!affiliateUrl && ((showDescription && descNorm.length >= 600) || detailRowCount >= 8)
  const socialProof = (
    <>
      {listing.savedCount >= 3 && (
        <span className="inline-flex items-center gap-1">
          <Heart className="h-3.5 w-3.5" /> <SavedCount base={listing.savedCount} id={listing.id} /> <Tr text="saved" />
        </span>
      )}
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
          {/* ⛔ NO ITEM ON A JOB — an employer's own post included: a salary is not a price and a job is
              not a product, and Google reads Product markup on one as misrepresentation. The same
              holds for a wanted post, an event, a short stay and vehicle hire: listingJsonLd returns
              null for each, and the breadcrumb stays. */}
          {itemLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(itemLd) }} />}
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
        {/* ONE responsive tree, TWO layouts. On a phone it is a single flex column and the
            `order-*` on each block sequences the whole page — the LEFT/RIGHT column wrappers are
            `display:contents` there, so their children flatten into this one shared order space:
            gallery → price/title/meta → contact → market price → breadcrumb/shop → description/
            details → safety → reviews → map → safety note. From md (768px) the wrappers snap into a
            12-col grid: a media + detail column beside a "buy box" (price/title/meta → contact →
            safety → reviews), 6/6 at md and 7/5 at lg; the market price sits under the contact block
            at md and beside the title at lg (see its wrapper). The buy box turns STICKY only at lg.
            Exactly ONE <h1>, ONE <ContactComposer> and ONE map mount across every layout → no
            duplicate H1, no hydration variance, and no double `eno:chat-now` listener.
            ⚠️ WHY md AND NOT lg FOR THE COLUMNS (2026-09-29): the media already switched to its
            desktop mount at md, so a tablet got the stacked phone order under a ~770px square
            gallery — at 820x1180 the H1 at y=1123 and 'Buy on …' below the fold, behind the tab bar
            (which shows up to 1023px). Side by side, both sit in the first screen. */}
        <div className="flex flex-col gap-6 md:grid md:grid-cols-12 md:gap-x-6 md:gap-y-6 lg:gap-x-10 lg:gap-y-8">

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
          {/* ⚠️ `-my-3 py-3`: the crumbs below were 39x17 and 49x17 with no press state, and their
              `tap-44` hit areas need 44px of room — but `truncate` makes this nav `overflow:hidden`,
              which would clip them back to the 20px line. The padding gives the clip box its 44px and
              the negative margin hands the space straight back, so nothing on the page moves. */}
          <nav aria-label="Breadcrumb" className="order-7 -my-3 truncate py-3 text-sm text-muted-foreground md:order-1 md:col-span-12">
            {/* prefetch={false} on both crumbs: they sit above the fold on every PDP, so auto
                prefetch fires two extra RSC requests per listing view for links most visitors
                never take (the way back is the tab bar or the browser's back button). */}
            <Link href="/" prefetch={false} className="relative tap-44 transition-colors hover:text-accent-foreground active:opacity-60"><Tr text="Home" /></Link>
            <span className="mx-1.5 text-line-strong">/</span>
            <Link href={`/c/${rawListing.category.slug}`} prefetch={false} className="relative tap-44 transition-colors hover:text-accent-foreground active:opacity-60"><Bilingual en={listing.category.name} vi={listing.category.nameVi || listing.category.name} /></Link>
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
            <PdpShopLink name={listing.seller.name} avatarColor={listing.seller.avatarColor} avatarUrl={listing.seller.avatarUrl} isBusiness={listing.seller.isBusiness} businessVerified={sellerBusinessVerified} officialPartner={listing.seller.officialPartner} href={sellerHref} metrics={sellerMetricsBundle} linked={linkedSeller} partnerListingCount={partnerListingCount} />
          </div>

          {/* 2 — Gallery, MOBILE mount: edge-to-edge (negative gutter cancels <main>'s padding),
              md:hidden. Its desktop twin lives in the left column below; the variant gates stop
              the hidden one from fetching images. Share/Save overlay the media (Shopee pattern);
              z-10 stays under the lightbox (z-[100]). */}
          {/* ⛔ NO GALLERY ON A LINKED JOB (owner, 2026-09-30, P-JOB): its one image is the importer's
              generated poster (scripts/import-jobs.ts), which on a PDP spent a full-width square — the
              whole phone fold — on a picture of the words printed below it. Cards keep the poster; the
              PDP opens on the compact job header in the buy box instead (see `isJob` there). */}
          {!isJob && (
          <div className="relative order-2 -mx-3 sm:-mx-6 md:hidden">
            <ListingGallery variant="mobile" images={listing.images} title={displayTitle} video={listing.video} showAllLabel="View all photos" />
            <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
              <ShareButton url={canonicalUrl} title={displayTitle} price={listing.listingType === 'job' ? undefined : listing.price} currency={listing.currency} compact />
              <SaveListingButton id={listing.id} compact />
              {/* Owner-only, and it renders nothing for everyone else — see owner-edit-button.tsx.
                  Sits AFTER Save so the control order is identical for every viewer and the shared
                  actions never move because a third one appeared. */}
              <OwnerEditButton listingId={listing.id} sellerId={listing.seller.id} compact />
            </div>
          </div>
          )}

          {/* RIGHT COLUMN (md col-6, lg col-5): the "buy box", sticky at lg. It comes FIRST in the DOM
              (so the H1, price, seller and contact controls lead the reading / tab order — the media +
              copy column follows); `md:order-3` still paints it on the RIGHT from md, and `md:order-2`
              on the LEFT column below paints the media on the left. `contents` on phones so its
              children join the single order flow. */}
          <div className="contents md:order-3 md:col-span-6 md:block lg:col-span-5">
            {/* ⚠️ STICKY STAYS lg-ONLY. At 768-1023 and in landscape the buy box (strip, reviews) is
                taller than the viewport, and a sticky column would park its lower half out of reach. */}
            <div className="contents md:flex md:flex-col md:gap-4 md:border-l md:border-border/70 md:pl-6 lg:sticky lg:top-24 lg:pl-10">

              {/* 3 — HEADER BLOCK: price (the anchor) → title → metadata, kept tight (gap-2) so the
                  three read as one cohesive unit. Price is the largest, boldest text on the page. */}
              <div className="order-3 flex flex-col gap-2">
                {/* THE COMPACT JOB HEADER (owner, 2026-09-30, P-JOB): with no poster gallery on a linked
                    job, Share / Save / Edit lose the photo they were overlaid on, so they sit here in
                    their labelled (non-overlay) form, beside a plain 'Job posting' kicker. The overlay
                    variants are white ink for photos and would vanish on the page ground. */}
                {isJob && (
                  <div data-job-header className="flex items-center justify-between gap-2">
                    <Badge size="md" className="font-semibold text-body">{tr('Job posting', 'Tin tuyển dụng')}</Badge>
                    <div className="flex items-center gap-1">
                      {/* The border matches the labelled Save beside it (its own base has one; Share's does not). */}
                      <ShareButton url={canonicalUrl} title={displayTitle} className="border border-border" />
                      <SaveListingButton id={listing.id} />
                      <OwnerEditButton listingId={listing.id} sellerId={listing.seller.id} />
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  {/* The ≈ slot is reserved before /api/fx answers — price.tsx's invisible FX stand-in —
                      so this row does not grow when the rate lands (CLS measured 0, 2026-09-29). */}
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    {/*
                      * "from" ON A PARTNER LISTING — the number is the LOWEST adult ticket, and the
                      * partner sets the real price at checkout per date. Without the qualifier the
                      * page reads as a fixed quote we cannot honour, which is both a consumer-law
                      * problem and the structured-data/visible-price mismatch Google penalises.
                      */}
                    {/* ⚠️ "from" ONLY ON A BOOKING. A ticket's stored price is the lowest adult
                        fare and the real amount is set at the partner's checkout; a retail
                        product's price is simply its price, and prefixing that with "from" would
                        state something untrue about it. See isBookingCategory. */}
                    {affiliateUrl && isBooking ? (
                      <span className="text-base font-medium text-body"><Tr text="from" /></span>
                    ) : null}
                    {/* A JOB AT PRICE 0 WITH A STATED PAY shows the posting's own words (a range, per hour, USD) as the
                        headline — plain wrapping text, because <Price>'s digit runs never break and a range overflowed
                        the phone width. Verbatim, no FX (ND 340/2025). */}
                    {/* ⚠️ AND WITHOUT A STATED PAY, A NEUTRAL LINE — NOT <Price>. Price prints its
                        'Salary: see details' in the 30px orange headline tier, which made the loudest thing
                        on the page a sentence saying there is nothing to show. Body ink at 16px says the
                        same without pretending to be a figure; a linked job points at the posting. */}
                    {listing.listingType === 'job' && listing.price === 0
                      ? (typeof listing.attributes?.salaryText === 'string'
                          ? <span className="text-2xl font-bold tracking-tight text-price [overflow-wrap:anywhere]">{listing.attributes.salaryText}</span>
                          : <span className="text-base font-semibold text-body">{isJob
                              ? <Bilingual en="Salary: see the original posting" vi="Mức lương: xem tin tuyển dụng gốc" />
                              : <Bilingual en="Salary not stated" vi="Chưa nêu mức lương" />}</span>)
                      : <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} className="text-3xl tracking-tight" approxClassName="text-base" listingType={listing.listingType} />}
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
                    {/* "Fixed price" is a P2P seller's statement that they won't haggle, so it is shown only
                        where one could: a seller's own sale (retail or wholesale) or rental with a real
                        price. Not on a job (a salary line is not an offer), not on a partner row (the
                        partner prices it at its own checkout, and on a ticket the figure is only "from"),
                        not on a service (in the services category the server forces every price to fixed,
                        so there the chip says nothing),
                        and not on a Free (0) item, where it read "Free · Fixed price".
                        ⚠️ WHOLESALE IS A SALE: the post wizard offers its seller the same Negotiable/Fixed
                        choice (fixedPriceOnly is services + wanted only), and 16 live wholesale posts
                        chose Fixed (2026-09-29) — dropping the chip there would lose their answer. */}
                    {!listing.negotiable && !affiliateUrl && listing.price > 0 && (listing.listingType === 'sell' || listing.listingType === 'rent' || listing.listingType === 'wholesale') && (
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
                </div>

                {/* Title — the single H1, 18px/700 (owner, 2026-09-30, P-HIER). At font-medium it read as
                    body copy under the price and the page had no heading. Bold at 18px it is a heading
                    and still sits far below the 30px price, so price-first holds. */}
                <h1 className="text-lg font-bold leading-snug text-foreground"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={i18n[listing.title]} /></h1>

                {/* Metadata — ONE tightly-packed subdued row: brand · condition · specs · location ·
                    posted · social proof; flex-wrap spills to a second row only when it must.
                    ⚠️ NO LITERAL '·' SEPARATORS. They were flex items of their own, so a wrap could strand
                    one at the end of a line ('Apple · New · Hồ Chí Minh ·') or the start of the next.
                    Every item now leads with its own glyph (MapPin, Clock, Heart, Eye) or is a chip, and
                    the column gap is what separates them — nothing is left to strand. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
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
                  {showPosted && (
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <Clock className="h-4 w-4 shrink-0 text-ink-4" />
                      <span><Tr text="Posted" /> <PostedAgo iso={listing.postedAt} /></span>
                    </span>
                  )}
                  {showProof && <span className="flex shrink-0 items-center gap-3 text-xs">{socialProof}</span>}
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
                  ? <JobApplyGuard applyBy={jobApplyBy}>
                      <AffiliateBooking
                        url={affiliateUrl}
                        partnerName={listing.seller.name}
                        listingId={listing.id}
                        discountCode={listing.affiliateDiscountCode}
                        discountPercent={listing.affiliateDiscountPercent}
                        booking={isBooking}
                        /* A tenancy is neither a purchase nor a ticket — see the prop's comment. */
                        rental={listing.listingType === 'rent'}
                        /* A job is applied for on the posting — see the prop's comment. */
                        job={isJob}
                        applyBy={jobApplyBy}
                        provenance={provenance ? <ImportProvenance kind={provenance.kind} site={provenance.site} iso={provenance.iso} href={affiliateUrl} /> : null}
                      />
                    </JobApplyGuard>
                  : isVisaProduct
                  ? <>
                      {/*
                        ⛔ THE PAGE THAT TAKES THE ORDER MUST SAY WHO WE ARE NOT. Before this, an
                        e-visa PDP was a price, a speed tier and "Apply in chat" — no disclaimer, no
                        official link, and `SafetyStrip` has no visa branch. That is the surface a
                        Play reviewer reaches from the store listing, and it is where they found the
                        Misleading Claims violation (2026-09-10).
                      */}
                      <VisaDisclosure
                        text={NOT_GOVERNMENT.en}
                        textVi={NOT_GOVERNMENT.vi}
                        linkLabel="Official Vietnam e-Visa portal (Immigration Department)"
                      />
                      {/*
                        ⛔ THE CTA COMES AFTER THE DISCLAIMER, NOT BEFORE IT. Rendered first, "Apply
                        in chat" sat above the fold with the disclosure below it — a mobile buyer
                        could start the order without the disclaimer ever being on screen, which is
                        the same failure as hiding it (codex, on the diff, 2026-09-10).
                      */}
                      <VisaStart listingId={listing.id} className="mt-4 w-full" />
                    </>
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
                {/* The availability check (owner, 2026-09-25): add this rental to the basket the eno team
                    checks for free. Under whichever contact block rendered above — a partner rental still
                    gets the check. `status === 'active'` is already true here (sold returned early), and
                    it is repeated so this line does not depend on that. ⚠️ A NARROW PROP, NOT `listing`:
                    this is a client component, so whatever it is handed is serialised into the page's
                    RSC payload a second time, description and all. */}
                {rawListing.category.slug === 'rentals' && listing.status === 'active' && (
                  <RentalCheckToggle
                    variant="pdp"
                    listing={{
                      id: listing.id,
                      sellerId: listing.sellerId,
                      title: listing.title,
                      titleVi: listing.titleVi,
                      images: listing.images.slice(0, 1),
                      price: listing.price,
                      currency: listing.currency,
                      priceUnit: listing.priceUnit,
                      category: { slug: rawListing.category.slug },
                    }}
                  />
                )}
              </div>

              {/* Market price: BELOW the CTA on phones (`order-6` ties with #contact, and DOM order then
                  paints it after), beside the title on desktop (`lg:order-3` ties with the header block,
                  and DOM order paints it after the meta row). It used to sit between the price and the
                  H1, and its ~81px were all spent above the CTA: on a 390x844 phone 'Buy on …' landed
                  26 of its 44px under the floating tab bar (measured on prod, 2026-09-29), and at 360x740
                  entirely under it. The verdict is one short scroll below the button now.
                  ⚠️ KEEP `lg:`, NOT `md:`, even though the two-column grid starts at md: at 768-1023 and
                  in landscape the buy box is not sticky, so a band above the CTA pushes it below the
                  fold there too (844x390 has 390px of height for everything). */}
              {priceBand && (
                <div data-market-price className="order-6 lg:order-3">
                  <MarketPrice price={listing.price} band={priceBand} />
                </div>
              )}

              {/* 9 — ONE trust block: the scam warning, with the reports-and-disputes row folded in
                  as its second line (owner, 2026-08-11). The separate order-7 protections row is GONE —
                  the two were adjacent boxes circling the same subject, and the warning is the
                  half that can stop someone losing money, so it keeps the container and the ink.
                  See the notes in safety-strip.tsx and protections-row.tsx for why the merge went
                  in this direction rather than the other. */}
              <div className="order-9">
                {/*
                  * ⛔ NO REPORTS-AND-DISPUTES ROW ON A PARTNER LISTING. ProtectionsRow explains eno's
                  * report process and tells the buyer to pay the seller directly after meeting, and
                  * the default category line says "Meet, inspect, then pay" — both describe a sale
                  * between an eno buyer and an eno seller. Here the buyer pays the partner on the
                  * partner's site: eno holds no money, runs no dispute over that sale and cannot
                  * refund. The row's old wording ("ENO protects you") was live on production for the
                  * seeded listings, exactly the kind of claim that has to be true. The Report
                  * affordance stays either way. Tests count `[data-protections-row]`, not its words.
                  */}
                <SafetyStrip
                  categorySlug={rawListing.category.slug}
                  variant={affiliateUrl ? (isJob ? 'affiliate-job' : isBooking ? 'affiliate' : listing.listingType === 'rent' ? 'affiliate-rental' : 'affiliate-purchase') : undefined}
                  protections={affiliateUrl ? undefined : <ProtectionsRow inline />}
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

          {/* LEFT COLUMN (md col-6, lg col-7): gallery → description/details → map → safety note. It
              follows the buy box in the DOM (reading order) but `md:order-2` paints it on the LEFT from
              md; `contents` on phones flattens these into the shared order space. */}
          <div className="contents md:order-2 md:col-span-6 md:flex md:flex-col md:gap-6 lg:col-span-7 lg:gap-8">
            {/* Shop-on-top (Shopee): storefront link above the media, DESKTOP/TABLET. order-1 so it
                leads the left column from md (above the gallery); hidden below md (mobile twin above). */}
            <div className="order-1 hidden md:block">
              <PdpShopLink name={listing.seller.name} avatarColor={listing.seller.avatarColor} avatarUrl={listing.seller.avatarUrl} isBusiness={listing.seller.isBusiness} businessVerified={sellerBusinessVerified} officialPartner={listing.seller.officialPartner} href={sellerHref} metrics={sellerMetricsBundle} linked={linkedSeller} partnerListingCount={partnerListingCount} />
            </div>

            {/* Gallery, DESKTOP mount (hidden below md; the mobile mount handles small screens). None on a
                linked job — see the mobile mount. */}
            {!isJob && (
            <div className="relative order-2 hidden md:block">
              <ListingGallery variant="desktop" images={listing.images} title={displayTitle} video={listing.video} showAllLabel="View all photos" />
              <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                <ShareButton url={canonicalUrl} title={displayTitle} price={listing.listingType === 'job' ? undefined : listing.price} currency={listing.currency} compact />
                <SaveListingButton id={listing.id} compact />
                {/* Owner-only, and it renders nothing for everyone else — see owner-edit-button.tsx.
                    Sits AFTER Save so the control order is identical for every viewer and the shared
                    actions never move because a third one appeared. */}
                <OwnerEditButton listingId={listing.id} sellerId={listing.seller.id} compact />
              </div>
            </div>
            )}

            {/* 8 — Description + Details. The wrapper renders only when one of them does: an empty
                flex item in this gapped column would still earn a gap. */}
            {(showDescription || showDetails) && (
            <div className="order-8 flex flex-col gap-8">
              {/* Section headers on this page share ONE treatment (text-lg font-semibold, matching
                  the shelf + reviews headers below) with more space above (section gap) than below. */}
              {showDescription && (
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground"><Tr text="Description" /></h2>
                {/* max-w-prose caps the reading measure at ~65ch — the col-7 body otherwise runs wide. */}
                <ListingDescription text={listing.description} vi={listing.descriptionVi} i18n={i18n[listing.description]} className={`max-w-prose space-y-3 text-base leading-relaxed text-body ${repeatedFacts}`} />
              </div>
              )}

              {showDetails && (
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-foreground"><Tr text="Details" /></h2>
                  {/* Spec table: hairline row dividers, muted label / strong value, even row height.
                      `data-fab-avoid` on every value: the floating support mark yields (fades) when it
                      would sit over one — these right-aligned values run into the corner it rests in,
                      and plain text is otherwise never an obstacle (back-to-top.tsx OBSTACLES). */}
                  <dl className="divide-y divide-border text-sm">
                    {[...numericSpecs, ...detailOnlySpecs].map((s) => (
                      <div key={s.label} className="flex items-start justify-between gap-4 py-2.5">
                        <dt className="text-muted-foreground"><Tr text={s.label} /></dt>
                        <dd data-fab-avoid className="text-right font-medium text-foreground">{s.value}</dd>
                      </div>
                    ))}
                    {detailAttrs.map(([k, v]) => {
                      // A job's text facts carry their own label and are shown verbatim (JOB_TEXT_ATTRIBUTES).
                      const jobText = listing.listingType === 'job' ? JOB_TEXT_ATTRIBUTES[k] : undefined
                      // On a job, a facet key/value gets the taxonomy's own words ("Type: Full-time", not "Jobtype:
                      // Fulltime"). Scoped to jobs on purpose: every other category keeps its Details exactly as before.
                      // ⚠️ And to Services › eSIM: its values are SLUGS ("validity: 30-days", "dailyData:
                      // 1-5gb") that only read right through their option label ("Validity: 30 days").
                      const labelled = listing.listingType === 'job' || rawListing.subcategorySlug === 'esim'
                      // ⚠️ THE LABEL, THOUGH, IS THE TAXONOMY'S FOR EVERY CATEGORY, IN BOTH LANGUAGES — the
                      // facet row carries its own labelVi ("Phòng ngủ"), and a raw key through <Tr> found
                      // Vietnamese only where the UI dictionary held that exact casing: it has "Bedrooms", not
                      // "bedrooms", so a vi rental PDP printed "bedrooms", "bathrooms" (prod, 2026-09-29).
                      // VALUES stay scoped as above (./details-labels.test.tsx).
                      const labelFacet = !jobText ? attrFacets.find((f) => f.key === k) : undefined
                      const facet = labelled ? labelFacet : undefined
                      const option = facet?.options?.find((o) => o.value === String(v))
                      const value = String(v)
                      // ⚠️ SENTENCE CASE, NOT CSS `capitalize`. Taxonomy and job labels are already written in
                      // sentence case ('Apply by', 'eSIM', 'Full-time'), and `capitalize` title-cased every
                      // word of them into 'Apply By', 'ESIM', 'Full-Time'. Only a RAW key or value (stored
                      // lowercase, no label to borrow) gets its first letter raised — `first-letter:` works
                      // here because dt/dd are flex items, which are blockified.
                      const rawKey = k.replace(/([A-Z])/g, ' $1').toLowerCase()
                      return (
                      <div key={k} className="flex items-start justify-between gap-4 py-2.5">
                        <dt className="text-muted-foreground first-letter:uppercase">
                          {jobText ? <Bilingual en={jobText.label} vi={jobText.labelVi} />
                            : labelFacet ? <Bilingual en={labelFacet.label} vi={labelFacet.labelVi} />
                            : <Tr text={rawKey} />}
                        </dt>
                        {/* A stored DATE ('2026-10-08' — a job's posted/apply-by) reads as the reader writes a
                            date: '8 Oct 2026' / '8/10/2026'. ⚠️ A NAME (author, publisher) is stored as written
                            and must never go through machine translation, which would "translate" a person. */}
                        {/^\d{4}-\d{2}-\d{2}$/.test(value)
                          ? <dd data-fab-avoid className="text-right font-medium text-foreground"><CalendarDay value={value} /></dd>
                          : jobText || (FREE_TEXT_ATTRIBUTES as readonly string[]).includes(k)
                          ? <dd data-fab-avoid className="text-right font-medium text-foreground">{value}</dd>
                          : option
                          ? <dd data-fab-avoid className="text-right font-medium text-foreground"><Bilingual en={option.label} vi={option.labelVi} /></dd>
                          : <dd data-fab-avoid className="text-right font-medium text-foreground first-letter:uppercase"><Tr text={value} /></dd>}
                      </div>
                      )
                    })}
                  </dl>
                </div>
              )}
              {/* P-CTA part B — the partner CTA once more, after the text (see repeatCta). A closed job
                  repeats nothing: the buy box already says so. */}
              {repeatCta && affiliateUrl && (
                <JobApplyGuard applyBy={jobApplyBy} closed={null}>
                  <AffiliateCtaRepeat url={affiliateUrl} partnerName={listing.seller.name} booking={isBooking} rental={listing.listingType === 'rent'} job={isJob} />
                </JobApplyGuard>
              )}
            </div>
            )}

            {/* 11 — Map. Not on a linked job or a partner row without a stored coordinate: the map would
                pin a city centroid (±1km jitter, geo.ts getListingCoordinates) that is not the item's
                place — an eSIM or a shop's phone 'in District 1'. When there is no map, render NOTHING:
                the meta row under the title already shows the location beside its pin glyph, so a
                text-only Location section would only repeat it. A seller's own listing keeps its map
                as before, district-level or not. */}
            {showMap && (
            <div id="location-on-map" className="order-11 space-y-2 scroll-mt-20">
              <h2 className="text-lg font-semibold text-foreground"><Tr text="Location" /></h2>
              {approxArea && (
                <p data-map-approximate className="text-xs text-muted-foreground">
                  {tr('Approximate area — the exact address is not on the map.', 'Khu vực gần đúng — bản đồ không hiển thị địa chỉ chính xác.')}
                </p>
              )}
              {/* ⛔ THE RING IS ON THIS WRAPPER, KEYED OFF THE CHILD'S FOCUS. The focusable is
                  Leaflet's own `.leaflet-container` (tabIndex=0), which sits flush inside this
                  `overflow-hidden` box — so the global `outline-offset: 2px` ring was clipped
                  entirely: tabbing to the map changed 0 pixels. `has-[:focus-visible]` puts the
                  indicator on the clipper itself, where nothing can crop it.
                  ⚠️ `:focus-visible`, not `focus-within` — a mouse click inside a map should not
                  draw a keyboard ring, and Leaflet focuses its container on click. */}
              <div className="relative h-[260px] overflow-hidden rounded-2xl after:pointer-events-none after:absolute after:inset-0 after:z-[500] after:rounded-[inherit] after:border-2 after:border-ring after:opacity-0 after:content-[''] has-[:focus-visible]:after:opacity-100">
                <ListingDetailMap listings={[listing]} activeDistrict={listing.district || 'all'} approximate={approxArea} />
              </div>
            </div>
            )}

            {/* 12 — Safety note, in the words that are true for THIS kind of listing. "Meet in a public
                place and inspect the item" was written for P2P goods and was printed on a flat, a
                ticket, an eSIM and a partner's phone alike. None on a partner row: the SafetyStrip's
                partner variant above already states the only true advice there (buy/book/rent on the
                partner's own site), and there is nobody to meet. */}
            {safetyNote && (
              <p className="order-12 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {safetyNote}
              </p>
            )}
          </div>
        </div>

        {/* More from THIS seller (server-fetched cards) — renders nothing when the
            seller has fewer than two other active listings. Sits above the broader
            same-category shelf so a buyer sees the seller's own range first. */}
        <SameSellerShelf listings={moreFromSeller} sellerHref={sellerHref} sellerName={listing.seller.name} />

        {/* More like this — same-category listings (client-fetched, ISR-safe). Without the seller's own
            rows whenever the seller rail above is showing (it needs two), so the two never repeat a card. */}
        <RelatedListings
          listingId={listing.id}
          categorySlug={rawListing.category.slug}
          subcategorySlug={rawListing.subcategorySlug}
          brandSlug={rawListing.brandSlug}
          excludeSellerId={moreFromSeller.length >= 2 ? listing.sellerId : undefined}
        />

        {/* The buyer's own recently-viewed trail (excludes this listing). mt-12 matches the
            two shelves above — the three are bare siblings in main, each owning its own top gap. */}
        <RecentlyViewedRail excludeId={listing.id} sectionClassName="mt-12" />
      </main>

      <Footer />

    </div>
  )
}
