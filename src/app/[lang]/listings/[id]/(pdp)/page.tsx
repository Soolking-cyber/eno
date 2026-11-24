import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { localizedHref } from '@/lib/lang-pinned'
import { PdpBackButton } from '@/components/marketplace/pdp-back-button'
import { PdpActionBar } from '@/components/marketplace/pdp-action-bar'
import { categoryBrowsePath } from '@/lib/retired-categories'
import { pdpBreadcrumbLd, subcategoryCrumb } from '@/lib/pdp-breadcrumb'
import { FREE_TEXT_ATTRIBUTES, TEACHER_SEEKING_POST, detailRowLabel, isLicenceCheckSlot, isVisaProductSlot, salaryPriceFor } from '@/lib/taxonomy'
import { PROVIDER_LICENCE_KEYS, providerLicenceOf } from '@/lib/provider-licence'
import { ProviderLicenceRows } from './provider-licence-rows'
import { TeacherProfileView } from '@/components/teachers/teacher-profile-view'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { teacherSurfaceHref } from '@/lib/teachers/host'
import { getTeacherPageRow } from '@/lib/teachers/page-row'
import { teacherRobots, teacherSearchFacts, teacherSearchVerdict } from '@/lib/teachers/search-floor'
import { teacherTitleLine } from '@/lib/teachers/search-title'
import { PostJobLink, TeacherProfileLink } from '@/app/[lang]/c/[category]/teaching-links'
import { plainSnippet } from '@/lib/strip-md'
import { feedIdentifiers } from '@/lib/product-feed'
import { listingJsonLd } from '@/lib/listing-jsonld'
import { VisaDisclosure } from '@/components/marketplace/visa-disclosure'
import { EVisaSellerNote } from '@/components/marketplace/evisa-seller-note'
import { NOT_GOVERNMENT } from '@/lib/visa-provider'
import { scopedListingWhere } from '@/lib/edition-scope'
import { getListing } from './get-listing'
import { Fragment, type ElementType, type ReactNode } from 'react'
import { db } from '@/lib/db'
import { formatMoneyFull, dropPercent, rateCompactAbove } from '@/lib/vnd'
import { serializeListing, safeParse } from '@/lib/serialize'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { SHARE_CARD, SHARE_CARD_ALT } from '@/lib/site-identity'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { ListingGallery } from '@/components/marketplace/listing-gallery'
import { SECTION_TITLE } from '@/components/marketplace/section-title'
import { PdpShopLink } from '@/components/marketplace/pdp-shop-link'
import { Badge } from '@/components/ui/badge'
import { Footer } from '@/components/marketplace/footer'
import { CountValue, SavedCount } from '@/components/marketplace/rating-value'
import {
  MapPin,
  AlertTriangle,
  Clock,
  Heart,
  Eye,
  Zap,
} from '@/components/ui/icons'
import { RelatedListings } from '@/components/marketplace/related-listings'
import { RecentlyViewedRail } from '@/components/marketplace/recently-viewed-rail'
import { CATEGORY_COLOR_CLASSES } from '@/lib/types'
import { Price } from '@/components/marketplace/price'
import { Bilingual } from '@/components/marketplace/bilingual'
import { FacetValue, facetValueStartsRaw } from './facet-value'
import { RentalAmenities, RentalCosts, RentalFactRows } from '@/components/marketplace/rental-facts'
import { RENTAL_FACT_LABELS, amenityOptions, bedroomsOf, depositSummary, rentalCostRows, rentalFactHiddenKeys, rentalFactRows, rentalFactsApply, type FactRow } from '@/lib/rental-facts'
import { VndValue } from '@/components/marketplace/rating-value'
import { LocalizedNav } from '@/components/ui/localized-nav'
import { minPhotosFor } from '@/lib/publish-guard'
import { priceUnitSuffix } from '@/lib/price-unit'
import { Tr } from '@/context/language-context'
import { conditionChoice } from '@/lib/listing-condition'
import { LocalizedTitle, LocalizedTitleHeading, LocalizedText, ListingDescription, PostedAgo } from '@/components/marketplace/listing-content'
import { hideRepeatedFacts } from '@/components/marketplace/rich-text'
import { CalendarDay } from '@/components/marketplace/calendar-day'
import { cachedTranslations } from '@/lib/translate'
import { detectContentLang, mayBeVietnamese } from '@/lib/detect-lang'
import { cn } from '@/lib/utils'
import { pdpSafetyNoteKind } from '@/lib/pdp-safety-note'
import { ReviewsPreview } from '@/components/marketplace/reviews-preview'
import { SameSellerShelf } from '@/components/marketplace/same-seller-shelf'
import { SoldListing } from '@/components/marketplace/sold-listing'
import { GoneListing } from '@/components/marketplace/gone-listing'
import { goneListingView, goneMetadata, goneSearchQuery, isGoneListing } from '@/lib/gone-listing'
import { ProtectionsRow } from '@/components/marketplace/protections-row'
import { DropCountdown } from '@/components/marketplace/drop-countdown'
import { LiveUntil } from '@/components/marketplace/live-until'
import { sellerMetrics, topSellerReviews, sameSellerListings } from '@/lib/seller-metrics'
import { ListingDetailMap } from '@/components/marketplace/listing-detail-map'
import { ReportButton } from '@/components/marketplace/report-button'
import { BlockUserButton } from '@/components/marketplace/block-user-button'
import { BlockedSellerNotice } from '@/components/marketplace/blocked-seller-notice'
import { isShopOnlyBlock } from '@/lib/user-blocks'
import { ContactComposer } from '@/components/marketplace/contact-composer'
import { collapseRepeatedName, collapseRepeatedNames } from '@/lib/location-text'
import { RentalCheckToggle } from '@/components/marketplace/rental-check-toggle'
import { isChatOnlyPartner, rentalCheckApplies } from '@/lib/rental-check/shared'
import { AffiliateBooking, AffiliateCtaRepeat } from '@/components/marketplace/affiliate-booking'
import { ImportProvenance } from '@/components/marketplace/import-provenance'
import { GoplusRoomLink } from '@/components/marketplace/goplus-room-link'
import { isEnoRunPartner } from '@/lib/eno-run-partners'
import { goplusRoomPageUrl, goplusTitleNamesAptType, isGoplusTemplateDescription } from '@/lib/goplus-listing'
import { blvckIntroSentences } from '@/lib/blvck-listing'
import { factSeparators, headingNamesEmployer, periodRestatedByUnit, roleOnlyHeading } from '@/lib/pdp-repeat-rows'
import { hostOf, importProvenance } from '@/lib/import-provenance'
import { adminPlaceEn, bracketNamedIn, cardArea } from '@/lib/city-short'
import { PlaceName } from '@/components/marketplace/place-name'
import { JobApplyGuard } from '@/components/marketplace/job-apply-guard'
import { SchoolLinkForJob } from '@/components/schools/school-link-for-job'
import { safeAffiliateUrl } from '@/lib/affiliate-qr'
import { isBookingCategory } from '@/lib/affiliate-kind'
import { isImportSeller } from '@/lib/import-sellers'
import { isLinkedShop, isUnratedStorefront } from '@/lib/linked-seller'
import { SellerInfo } from '@/components/marketplace/seller-info'
import { buildSellerInfo } from '@/lib/seller-info'
import { approximateArea, hasRealCoords } from '@/lib/geo'
import { isVehicleHireReference } from '@/lib/rental-places'
import { isLinkedJobReference, JOB_BOARDS } from '@/lib/job-listing'
import { VisaInAppNote, VisaPartnerNote, VisaStart, VISA_START_AVAILABLE } from '@/components/marketplace/visa-start'
import { IosAppHidden } from '@/components/marketplace/ios-app-hidden'
import { appReviewGate } from '@/lib/app-review-gates'
import { isEVisaProductListing } from '@/lib/evisa-listing'
import { isVisaShopListing } from '@/lib/visa-shop'
// The one switch that means "this deployment runs the visa chat" — see the gate on isVisaProduct.
import { ITINERARY_THREADS_ENABLED, VISA_THREADS_ENABLED } from '@/lib/thread-kind'
import { getTripAssistanceListingId } from '@/lib/trips/dm-thread'
import { TrackView, TrackViewCount } from '@/components/marketplace/track-view'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { SaveListingButton } from '@/components/marketplace/save-listing-button'
import { OwnerEditButton } from '@/components/marketplace/owner-edit-button'
import { ShareButton } from '@/components/marketplace/share-button'
import { currencyCode } from '@/lib/analytics'
import { getEnforcement } from '@/lib/enforcement'
import { getPriceBand } from '@/lib/price-stat'
import { MarketPrice } from '@/components/marketplace/market-price'
import { AreaRent } from '@/components/marketplace/area-rent'
import { areaRentCell, areaRentFor, type AreaRent as AreaRentData, type AreaRentRow } from '@/lib/area-rent'
import { loadRentIndex, type RentIndexLookup } from '@/app/[lang]/hcmc-rent-index/load-rent-index'
import { rentIndexRetrySoon } from '@/lib/rent-index-retry'
import { modelPagePath, modelPageSlugFor } from '@/lib/model-pages'
import { SafetyStrip } from '@/components/marketplace/safety-strip'
import { isBusinessVerified } from '@/lib/business-verification'
import { COUNSEL_BLOCK, COUNSEL_INFO, COUNSEL_REPORT, COUNSEL_STRIP, COUNSEL_WELL_ALONE, COUNSEL_WELL_JOINED, GOODS_BAND, GOODS_DESC_SECTION, GOODS_DETAILS_ROWS, GOODS_DETAILS_TWIN, GOODS_FACT, GOODS_FACTS, GOODS_HEAD, GOODS_MAP_BOX, GOODS_NOTE, GOODS_PHOTO, GOODS_PLATES_GAP, GOODS_PRICE, GOODS_PRICE_ROW, GOODS_SECTION, GOODS_SECTION_TITLE, GOODS_SHELF_GAP, GOODS_TITLE, PIN_TIER, isGoodsSheet, pinsAction } from '@/lib/goods-sheet'
import { contactLine } from '@/lib/contact-line'
import { PinnedRegion, StickyActionBarSpacer } from '@/components/ui/sticky-action-bar'
import { isCommissionLink } from '@/lib/affiliate-commission'
import { embeddedProductUrl } from '@/lib/affiliate-deeplink'
import { JOB_COUNSEL, JOB_COUNSEL_INFO, JOB_COUNSEL_STRIP, JOB_EMPLOYER, JOB_HEADER, JOB_LINES, JOB_META, JOB_META_GLYPH, JOB_PRICE, JOB_PRICE_APPROX, JOB_PRICE_ROW, JOB_SALARY_TEXT, JOB_SHELF_GAP, JOB_TAGS, JOB_TAG_ROWS, JOB_TITLE, JOB_TITLE_ACTIONS, JOB_TITLE_CELL, JOB_TITLE_LINE } from '@/lib/job-sheet'
import { JobApplyRow } from '@/components/marketplace/job-apply-row'
import { HOST_BAND, HOST_CARD_SLOT, PAGE_TITLE, PAGE_WELL, SHEET_BAR_APPROX, SHEET_BAR_PRICE, SHEET_BAR_UNIT, SHEET_BLOCK, SHEET_CONTACT, SHEET_FACTS, SHEET_GRID_GAP, SHEET_HEAD_GAP, SHEET_PHOTO, SHEET_PLACE, SHEET_PRICE, SHEET_PRICE_APPROX, SHEET_PRICE_ROW, SHEET_PRICE_UNIT, SHEET_REPORT, SHEET_ROWS, SHEET_STAT, SHEET_STATS, SHEET_STAT_LABEL, SHEET_STAT_VALUE, SHEET_TIER_APPROX, SHEET_TIER_PRICE, SHEET_TIER_UNIT, SHEET_TITLE, SHEET_WELL, isRentalSheet, pinsRentalAction, sectionLine, sheetStatCols } from '@/lib/rental-sheet'
import { fillDescription, firstThatFits, titleWithPrice } from '@/lib/meta-description'
import { brandHref, dominantCategory } from '@/lib/brand-category'
import { isThinImport } from '@/lib/thin-import'
import { isDuplicateImport } from '@/lib/duplicate-import'
import { POSTING_IS_FREE } from '@/lib/site-identity'

type Props = {
  params: Promise<{ id: string; lang?: string }>
}

/** The facts line's separator (batch 89): a no-break space ties the dot to the fact before it, so the only break is after it —
 *  see the note at the line. A constant, not a JSX literal (jsx-no-literals). */
const FACT_SEP = '\u00a0· '
/** FACT_SEP without its breaking space: the goods sheet keeps the dot inside a fact's box and the space outside it. */
const FACT_DOT = '\u00a0·'

// ISR: render on-demand, then cache the HTML at the global edge (the #1 SEO page,
// served ~globally in tens of ms instead of a function+DB hit in Singapore per
// view). Self-heals hourly; mutation routes call revalidatePath('/listings/<id>')
// so an edit/sold/hidden/delete purges it immediately (sold → the sold page; hidden → 404, or the gone
// page for an import shop's row — src/lib/gone-listing.ts).
// Content renders in the visitor's language CLIENT-side (LocalizedTitle + <Tr>),
// same as the cards — so no per-request server translation forces it dynamic.
export const revalidate = 2592000 // 30d — HIGH-cardinality route (one page per listing). Real edits/status/sold/moderation revalidate ON-DEMAND, so the only time-based regen is for off-listing changes (e.g. a seller renaming their storefront). A long 30d window keeps eventual freshness while cutting ISR writes hugely.
export async function generateStaticParams() {
  return []
}

// Cached per-request so generateMetadata + the page share ONE DB query instead of
// each running its own findUnique for the same listing.
// The loader moved to ./get-listing so `layout.tsx` can share the same cache() memo — see there.

/**
 * THE TITLE THE VIETNAMESE H1 SHOWS IN THE SERVER HTML — localizedPlan's 'title' column for a Vietnamese reader
 * (listing-content.tsx, a client module, so not callable here): the authored `titleVi`, else the source when it is
 * already Vietnamese (detectContentLang), else its pre-warmed machine translation, else the source. The <title> and
 * the gallery's names use it, so neither says the English source under a Vietnamese H1 (i18n#1, pdp#3, 2026-10-22).
 * ⚠️ `||`, not `??`: an empty `titleVi` or cached row is no title, as localizedPlan reads it.
 */
function viTitle(title: string, titleVi: string | null | undefined, cached: Record<string, string> | null | undefined): string {
  return titleVi || (detectContentLang(title) === 'vi' ? title : cached?.vi || title)
}

/**
 * THE AREA RENT LINE'S DATA, OR NULL (owner, 2026-11-19; src/lib/area-rent.ts has the rules). Only a row the rent index would
 * count reads the snapshot at all, so no other PDP waits for it or has its 30-day ISR shortened by the snapshot's 1-day entry
 * (an `unstable_cache` read inside an ISR render lowers the render's revalidate to its own — rent-index-retry.ts): a rental
 * PDP that shows the line regenerates daily with the index, whose date it prints.
 * ⛔ NEVER THROWS, AND A MISS RETRIES IN MINUTES — the district page's rule (c/[category]/[district]/page.tsx districtRent):
 * a lost race or an unknown snapshot draws no line and lowers this render's revalidate to 300 s, never 30 days without it.
 * The wait is shorter than the district page's 10 s: a cold snapshot is 2–3 s, and a PDP is a page people land on.
 */
const AREA_RENT_WAIT_MS = 3_000
async function areaRentOf(row: AreaRentRow): Promise<AreaRentData | null> {
  if (!areaRentCell(row)) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), AREA_RENT_WAIT_MS) })
  const lookup: RentIndexLookup | null = await Promise.race([loadRentIndex(), timeout]).catch(() => null)
  clearTimeout(timer)
  // Only a SLOW snapshot (the wait ran out) asks for an early regeneration; a snapshot that is simply not built yet does not,
  // or thousands of rental pages would re-render every few minutes until it is.
  if (!lookup) {
    await rentIndexRetrySoon().catch(() => {})
    return null
  }
  if (!lookup.known) return null
  return areaRentFor(row, lookup.index)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, lang } = await params
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
  // SOLD is one exception: it renders a dedicated "this item has been sold" page
  // (not a 404), so here we return noindex metadata for it rather than notFound() — a
  // sold URL shouldn't stay in search, but it's still a real, on-brand page.
  // ⛔ The GONE page is the other, and the only one for a non-live row: a hidden import-shop row
  // (src/lib/gone-listing.ts) — noindex,follow like sold. Every other non-live row still 404s.
  if (!listing || !listing.verified || (listing.status !== 'active' && listing.status !== 'sold')) {
    if (listing && isGoneListing(listing)) return goneMetadata(listing, lang)
    notFound()
  }
  /**
   * ⛔ THE <title> AND THE SHARE TITLES FOLLOW THE `[lang]` VARIANT (SEO wave B, V2b; copy sheet CS-3,
   * approved 2026-10-01). This page renders once per variant since `[lang]` (src/proxy.ts) — the old note
   * here said "static HTML shared across users, so it can't vary by language", which stopped being true
   * then. The Vietnamese variant names the listing by the text its H1 already shows that reader (viTitle
   * above): `titleVi` when it has one, else — since i18n#1, 2026-10-22 — the pre-warmed machine translation the
   * H1 renders (a vi job PDP's tab read "Part-time English Teacher …" over "Giáo viên tiếng Anh …"); and it
   * formats the price the Vietnamese way ("12.000.000 đ"). The meta description, the JSON-LD and the share text
   * keep the source title.
   * The translation is read only when the H1 could show one — no titleVi, a source not already Vietnamese — and
   * never for a teacher: that title is a person's name, which the profile shows as written. One indexed read.
   */
  const vi = lang === 'vi'
  const titleI18n = vi && !listing.titleVi && listing.listingType !== TEACHER_LISTING_TYPE && detectContentLang(listing.title) !== 'vi'
    // A failed read is no reason to fail the page's metadata: the <title> then falls back to the source, as before.
    ? (await cachedTranslations([listing.title]).catch(() => ({} as Record<string, Record<string, string>>)))[listing.title]
    : undefined
  const titleFor = vi ? viTitle(listing.title, listing.titleVi, titleI18n) : listing.title
  if (listing.status === 'sold') {
    return { title: `${titleFor} — ${vi ? 'Đã bán' : 'Sold'} | ${SITE_NAME}`, robots: { index: false, follow: true } }
  }

  // The listing's SOURCE title (as posted) for the description and share text; the titles take
  // `titleFor` above.
  const displayTitle = listing.title
  // Guard against corrupt/legacy image rows (a known reality here — see the mock
  // self-heal in serialize.ts): a single bad row must not 500 the top SEO page.
  const parsedImages = safeParse<unknown>(listing.images, [])
  const images: string[] = Array.isArray(parsedImages) ? parsedImages.filter((u): u is string => typeof u === 'string') : []
  const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

  // Bake the price into the social title/description so it shows in every link
  // unfurl (Facebook/Zalo/Telegram scrape OG tags, not our share text). Skip when
  // there's no meaningful price (e.g. some job posts).
  // A JOB's baked label is the pay AS THE POSTING STATES IT (attributes.salaryText) when a linked job
  // carries one: a stated RANGE is stored at price 0 (job-listing.ts parseJobPay), so the price alone
  // would say nothing, and "English Teacher — 10.000.000 đ" would misstate a 10–30 tr job. Otherwise the
  // stored price IS the monthly salary (an employer's own job: salaryM × 1,000,000 — taxonomy.ts
  // paysSalary; a linked job that states one figure: that figure), so it is baked like any price.
  const isJobListing = listing.listingType === 'job'
  // A teacher is a person: no price label ever rides on the title (2026-09-30) — NOR on the link preview Facebook and
  // Zalo show when the profile is shared (2026-10-11: the card now states a salary or an hourly rate, profile.ts
  // teacherCardPrice, which must not read as a sale price in an unfurl).
  const isTeacher = listing.listingType === TEACHER_LISTING_TYPE
  const jobAttrs = isJobListing ? safeParse<Record<string, unknown>>(listing.attributes ?? '{}', {}) : {}
  const jobSalary = typeof jobAttrs.salaryText === 'string' ? jobAttrs.salaryText : null
  // ⚠️ A SALARY CARRIES ITS PERIOD: "English teacher — 45,000,000 đ" in a tab title or an unfurl reads
  // as a sale price, so a job's figure is baked with " / month" (" / tháng" on the Vietnamese render)
  // — the unit <Price> prints after it on the page (review, 2026-10-01). A job's salary is monthly by
  // construction (salaryPriceFor); a stored 'VND/hour' (an imported hourly job) keeps its own unit.
  // The same for an HOURLY SERVICE (services › Pricing, 2026-10-14): "Dog walking — 150,000 đ" in an unfurl reads as a
  // flat price, so its stored 'VND/hour' is baked as " / hour". A rent's title is unchanged (no unit), as before.
  const rateUnit = isJobListing ? (priceUnitSuffix(listing.priceUnit) ?? 'month')
    : listing.listingType === 'service' || listing.listingType === 'wanted' ? priceUnitSuffix(listing.priceUnit) : null
  // Every unit the code stores, named; an unknown one is printed as stored, never guessed as a month (gate, 2026-10-14).
  const rateUnitLabel = rateUnit ? ` / ${vi ? ({ hour: 'giờ', day: 'ngày', week: 'tuần', month: 'tháng' } as Record<string, string>)[rateUnit] ?? rateUnit : rateUnit}` : ''
  const priceLabel = isTeacher ? '' : isJobListing && jobSalary ? jobSalary : listing.price > 0 ? `${formatMoneyFull(listing.price, listing.currency)}${rateUnitLabel}` : ''
  // The titles' price: the Vietnamese variant groups it the Vietnamese way (CS-3 V2b-1); a stated salary
  // stays as the posting wrote it.
  const titlePrice = isTeacher ? '' : isJobListing && jobSalary ? jobSalary : listing.price > 0 && vi ? `${formatMoneyFull(listing.price, listing.currency, 'vi')}${rateUnitLabel}` : priceLabel
  // Meta description: the listing body when the seller wrote one; otherwise a
  // composed fallback ("TITLE — PRICE, CATEGORY in LOCATION on eno.vn") so an
  // empty body never ships a junk description like "21,000,000 VND · ".
  // Flattened: a rich body's headings and bullets must not reach the meta tag as literal ** and - (plainSnippet).
  const bodyDesc = plainSnippet(listing.description)
  const facts = [priceLabel, listing.category.name].filter(Boolean).join(', ')
  // SITE_NAME, not "eno.vn": this page renders on eno.forum too (CS-3 claim 8).
  const fallbackDesc = `${displayTitle}${facts ? ` — ${facts}` : ''}${listing.location ? ` in ${listing.location}` : ''} on ${SITE_NAME}`
  // ⛔ A SHORT BODY IS FILLED, NOT LEFT SHORT (Bing, 2026-11-20: "iPhone 17 Pro Max 512GB - Used, with scratches and dents." was the
  // whole 57-character description): after the seller's words come the page's own facts — price, category, place — then the
  // site line, until it says enough (src/lib/meta-description.ts). A long body is only cut at a word.
  // In the page's language: the variant's price grouping (titlePrice) and category name — a Vietnamese description never
  // reads "12,000,000 đ, Furniture". ⛔ "Free" only while POSTING_IS_FREE (site-identity.ts) says so.
  const place = [vi ? listing.category.nameVi || listing.category.name : listing.category.name, listing.location].filter(Boolean).join(', ')
  // ~40 characters, so a ~100-character body still reaches Bing's 120 under the 155 cap (Seobility, 2026-11-23): the old 60-character
  // line was skipped whole there and the description stayed short. It keeps the site's name, which a long <title> drops (titleWithPrice).
  const siteLine = !POSTING_IS_FREE ? '' : vi ? `Rao vặt miễn phí tại Việt Nam trên ${SITE_NAME}.` : `Free classifieds in Vietnam on ${SITE_NAME}.`
  const desc = bodyDesc
    ? fillDescription(bodyDesc, [[titlePrice, place].filter(Boolean).join(', ') && `${[titlePrice, place].filter(Boolean).join(', ')}.`, siteLine])
    // The composed fallback is English on both variants (above), so its closing line is too.
    : fillDescription(fallbackDesc, [POSTING_IS_FREE && 'Free classifieds for expats and locals in Vietnam.'])
  // The fallback already carries the price — only prefix it onto a real body.
  const ogTitle = titlePrice ? `${titleFor} — ${titlePrice}` : titleFor
  // The card's price matches its title's (review: dots in og:title, commas in og:description on vi). The
  // composed fallback sentence is English, so it keeps the English price with it.
  // ⛔ The card leads with the price, so its body is filled WITHOUT it (review, 2026-11-20: the price twice, two formats on vi).
  const ogDesc = titlePrice && bodyDesc ? `${titlePrice} · ${fillDescription(bodyDesc, [place && `${place}.`, siteLine], { max: 157 - titlePrice.length })}` : desc

  /**
   * ⛔ A TEACHER PROFILE'S <title> AND ROBOTS COME FROM ITS PROFILE ROW (SEO plan P1 items 14 and 15, owner 2026-10-20) —
   * the ONE row the page renders (src/lib/teachers/page-row.ts, cache()d: this read IS the view's read).
   *   · <title>: "<Name> — IELTS & English teacher, Ho Chi Minh City | eno.vn" (search-title.ts) — the h1's name, then what
   *     they teach and the city they live in, each only when the profile says it. ⛔ No place for a teacher abroad or one
   *     who has not said (the old "Teacher in Vietnam" rule — never a city they do not live in), and never a price.
   *   · robots: `noindex, follow` while the search verdict leaves the profile out (search-floor.ts) — under the quality
   *     floor (About under 30 words and no intro video), a masked name, or the teacher's own "Hide my profile from search
   *     engines". The sitemaps leave out exactly these (src/lib/sitemap.ts). ⚠️ The page is ISR: every input of the
   *     verdict is written by a path that purges it — a profile save (saveTeacherProfile), the video's own moves, and
   *     the switch (search-visibility.ts).
   * A broken row (a listing without its profile) is titled by the listing and left out of search.
   */
  const teacherRow = isTeacher ? await getTeacherPageRow(listing.id) : null
  const teacherSearch = isTeacher ? teacherSearchVerdict(teacherSearchFacts(teacherRow, listing)) : null
  // The site's name only within 60 characters (Seobility, 2026-11-23: "<name> — IELTS & English teacher, Ho Chi Minh City | eno.vn"
  // measured 637 px against ~580); the teacher's own words are never cut.
  const teacherHead = isTeacher ? `${teacherRow?.fullName ?? listing.title} — ${teacherTitleLine(teacherRow ?? {}, vi ? 'vi' : 'en')}` : null
  const teacherTitle = teacherHead ? firstThatFits([`${teacherHead} | ${SITE_NAME}`, teacherHead]) : null
  // A live import an older one of the same seller repeats (src/lib/duplicate-import.ts) — one read, imports only.
  const duplicateImport = listing.status === 'active' && !isTeacher && await isDuplicateImport(listing)
  return {
    title: teacherTitle ?? titleWithPrice(titleFor, titlePrice, SITE_NAME),
    description: desc,
    // Only publicly-live listings (verified + active) are indexable; sold/hidden/held are not.
    // ⛔ An imported vehicle-hire reference is live but noindex — src/lib/rental-places.ts says why — and so, since
    // 2026-10-20, is a LINKED job (job-listing.ts isLinkedJobReference; until then it was indexed with `unavailable_after`
    // set to its apply-by date, which a page that is not indexed no longer needs). listing-robots.test.ts beside this file.
    // ⛔ A teacher profile: its search verdict (above).
    // ⛔ A THIN IMPORT (an import under 200 characters, src/lib/thin-import.ts) is live but noindex, follow since 2026-11-22:
    // the sitemap already left it out; the district and category pages that list it stay indexed.
    // ⛔ A REPEATED IMPORT (an older live listing of the same seller has its title at its price, or its description —
    // src/lib/duplicate-import.ts) is noindex, follow since 2026-11-24, and out of the sitemap with it; the oldest copy stays.
    // A teacher profile is judged by its own search verdict above (its own quality floor), never by this length rule.
    // ⚠️ A change here reaches every page with the deploy that ships it: the ISR cache is keyed by BUILD_ID
    // (cache-handler.cjs), so each page's first request after a deploy renders anew, and the deploy's own `eno-html` tag
    // purge (infra/vn-node/eno-deploy.sh) drops the edge copy — nothing to purge by hand, unless it ran --skip-purge.
    robots: listing.verified && listing.status === 'active'
      ? (teacherSearch ? teacherRobots(teacherSearch)
        : isVehicleHireReference({ affiliateUrl: listing.affiliateUrl, subcategorySlug: listing.subcategorySlug, categorySlug: listing.category.slug })
          || isLinkedJobReference({ affiliateUrl: listing.affiliateUrl, listingType: listing.listingType })
          || isThinImport(listing)
          || duplicateImport
          ? { index: false, follow: true }
          : undefined)
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
  const { id, lang } = await params
  const pageVariant = lang === 'vi' ? 'vi' : 'en'
  const rawListing = await getListing(id)

  // Only publicly-live listings get the full detail page; hidden/held/unverified are
  // pulled from public view entirely (sellers manage them in their dashboard → 404) —
  // except a hidden import-shop row, which gets the gone page (src/lib/gone-listing.ts).
  if (!rawListing || !rawListing.verified || (rawListing.status !== 'active' && rawListing.status !== 'sold')) {
    if (rawListing && isGoneListing(rawListing)) {
      // ⛔ THE PROJECTION, NEVER THE ROW: the gone page gets the title and the slugs it matches on, so no
      // photo, price, seller or contact can reach its HTML or RSC payload (goneListingView).
      const gone = goneListingView(rawListing)
      const [brand, goneI18n] = await Promise.all([
        gone.brandSlug ? db.brand.findUnique({ where: { slug: gone.brandSlug }, select: { name: true } }) : Promise.resolve(null),
        cachedTranslations([gone.title]),
      ])
      return <GoneListing listing={gone} searchQuery={goneSearchQuery(gone, brand?.name ?? null, pageVariant)} lang={pageVariant} titleI18n={goneI18n[gone.title] ?? null} />
    }
    notFound()
  }

  // Sold → a dedicated, on-brand "this item has been sold" page (not a dead 404):
  // it names what sold and keeps the shopper moving (seller's other stock + category).
  if (rawListing.status === 'sold') {
    const sold = serializeListing(rawListing)
    // The title's pre-warmed translations ride along, as on the live PDP below: the sold item is named in
    // the reader's language in the server HTML (A10-SOLD), not machine-translated after paint.
    const [moreFromSeller, soldI18n] = await Promise.all([
      sameSellerListings(sold.sellerId, sold.id, 10),
      cachedTranslations([sold.title]),
    ])
    return (
      <SoldListing
        listing={sold}
        moreFromSeller={moreFromSeller}
        sellerName={rawListing.seller.name}
        sellerHref={`/sellers/${sold.sellerId}`}
        lang={pageVariant}
        titleI18n={soldI18n[sold.title] ?? null}
      />
    )
  }

  const listing = serializeListing(rawListing)
  // ⛔ A TEACHER IS A PERSON, NOT A PRODUCT (2026-09-30): its own page — no price, offers, map,
  // Product JSON-LD, seller-contact reveal or safety price copy. Only live rows reach here (the guard
  // above); whether search engines are asked to index it is the profile's search verdict (2026-10-20 —
  // generateMetadata's robots tag, and the view's JSON-LD from the same cache()d row).
  if (rawListing.listingType === TEACHER_LISTING_TYPE) {
    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
    return (
      <>
        <TeacherProfileView
          listing={{ id: listing.id, title: listing.title, images: listing.images, video: listing.video ?? null, createdAt: rawListing.createdAt, updatedAt: rawListing.updatedAt }}
          hostUrl={hostUrl}
          live={rawListing.status === 'active'}
          lang={(await params).lang === 'vi' ? 'vi' : 'en'}
        />
        {/* The view COUNTER only — never <TrackView>, whose ad-platform item would carry the teacher's name
            (track-view.tsx TrackViewCount says why). Without it every teacher profile read 0 views. */}
        <TrackViewCount id={listing.id} />
      </>
    )
  }
  // The listing's SOURCE title (as posted) for the JSON-LD and the share text. The <title> and the share
  // cards follow the variant (generateMetadata, V2b); the visible H1 localizes via <LocalizedTitleHeading>.
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
  // The pin line's place, spelled — never machine-translated — when it is wholly administrative (the rental importers' shape).
  const locationEn = adminPlaceEn(listing.location)
  // …in the card's form (no ward bracket) only where the title already names that ward — the importers' titles do; a seller's
  // "Studio for rent" over "Quận 7 (Phường Tân Phong)" keeps it (review).
  // Decided per language, against the title that language shows (review): the English line only against an English title
  // the seller or importer wrote — a Vietnamese source title reaches an English reader machine-translated, where the ward may
  // not survive legibly, so there the line keeps it — and the Vietnamese against the Vietnamese one.
  const pinShortEn = !!locationEn && !mayBeVietnamese(listing.title) && bracketNamedIn(listing.location, [listing.title])
  const pinShortVi = !!locationEn && bracketNamedIn(listing.location, [listing.titleVi || listing.title])
  // ⚠️ NO GALLERY ON A PHOTO-LESS JOB EITHER. A job needs no photo to publish (publish-guard.ts
  // minPhotosFor('jobs') = 0, owner 2026-10-01), and an empty gallery is a blank 300px tint box with
  // Share/Save painted in white ink on it — so it opens on the same compact header a linked job uses.
  // Scoped to the photo-optional category through the same function, so every other listing's PDP is
  // exactly as it was (the gallery's own empty state never showed a clip either: hasVideo needs a photo).
  const noGallery = isJob || (minPhotosFor(rawListing.category.slug) === 0 && listing.images.length === 0)
  /**
   * ⛔ THE RENTAL SHEET (owner-approved 2026-11-14, cook r05 "rental-c": "after this cook round build all best options and
   * deploy"; reworked owner-approved 2026-11-15 (build 7), cook r07 "rental"; src/lib/rental-sheet.ts has the whole page): a home
   * to rent, on a phone — the price as its display element, the key facts as figures, a flat host row, Costs then Location.
   * Decided here, from the listing alone, so the server HTML and the first client render agree. Below md only; from md the
   * page paints as before (each call site below says how).
   */
  const rentalSheet = isRentalSheet({ noGallery, categorySlug: rawListing.category.slug, subcategorySlug: rawListing.subcategorySlug, listingType: listing.listingType })
  const jobApplyBy = isJob && typeof listing.attributes?.applyBy === 'string' ? (listing.attributes.applyBy as string) : null
  // No owner account and not an official partner (owner, 2026-10-01 — src/lib/linked-seller.ts): the
  // storefront's trustScore describes nobody, so no trust chip on ANY of its listings; and when this row
  // links out, the storefront is a LINKED SHOP (the neutral chip, and "Source" in Seller information).
  // ⚠️ The STORED column for "links out", like `imported` below: the row is an import even if its link
  // fails safeAffiliateUrl.
  // ⛔ Asked of the partner flag AS SHOWN (`listing.seller.officialPartner` — serialize.ts partnerShown),
  // never the raw column: a storefront still FLAGGED but whose row links out (a stale import-shop grant)
  // must read as the unrated linked shop it is, not fall through to its default-100 trust chip.
  const shownSeller = { id: rawListing.seller.id, ownerId: rawListing.seller.ownerId, officialPartner: listing.seller.officialPartner }
  const sellerUnrated = isUnratedStorefront(shownSeller)
  const sellerLinkedShop = isLinkedShop(shownSeller, !!listing.affiliateUrl)
  // A REFERENCE listing from an import storefront (a job board, or a rental portal such as Chợ Tốt) — and
  // since 2026-10-01 from ANY unrated storefront (a shop's affiliate catalogue included): eno.vn never
  // rated the source, so the shop row shows "not verified by eno.vn" instead of a trust chip. See
  // PdpShopLink's `linked`.
  const linkedSeller = isJob ? 'job' as const : affiliateUrl && (isImportSeller(listing.sellerId) || sellerUnrated) ? 'listing' as const : null
  // "Seller information" (Decree 248 Art 18.1.c — name and address of the seller; owner, 2026-10-01): a
  // linked shop names its SOURCE; a business seller's legal rows are SWITCHED OFF until owner + counsel
  // sign off (buildSellerInfo, src/lib/seller-info.ts — they were typed under a "never shown" notice).
  // Never the phone, never `idNumber` (SellerInfo takes neither). Read off the RAW row: the serialized
  // seller carries none of these columns, on purpose. ⚠️ ISR: an identity edit purges this page
  // (refreshSellerPdps, src/lib/seller-pdp-refresh.ts), or a removed address would stay up for 30 days.
  // The caption's verb follows THIS row's listingType: apply for a job, contact/book for a rental (sourceActionFor).
  const sellerInfo = buildSellerInfo({ linkedShop: sellerLinkedShop, isBusiness: listing.seller.isBusiness, storefrontName: listing.seller.name, identity: rawListing.seller, linkedListingTypes: [rawListing.listingType] })
  // Where an IMPORTED listing came from, and the date that is true for that source (SEO wave B, P1):
  // a rental portal's own post date, the day eno imported it, or — for a partner shop's item — no date.
  // ⚠️ The RAW columns: `listing.postedAt` is serialized as the later of postedAt and createdAt.
  // A GoPlus room: an OFFICIAL PARTNER's storefront (a flag eno's staff set, never the seller) and a `goplus:<id>`
  // externalId the GoPlus importer writes. ⛔ ONLY THIS YES/NO reaches the page (owner, 2026-10-30: the room's page on
  // goplus.com.vn is for the GoPlus account and eno's admins, "user shouldnt see the links"). This render is cached for
  // every visitor, so the URL itself comes from api/listings/[id]/goplus-link, which answers it to those accounts only.
  const goplusRoom = rawListing.seller.officialPartner === true && goplusRoomPageUrl(rawListing.externalId) !== null
  // An eno-run partner's listing (a pinned pair, src/lib/eno-run-partners.ts — owner 2026-11-14) mounts the same staff-only
  // link: its purchase link is asked for by the signed-in viewer, never carried by this cached page.
  const staffPurchaseLink = isEnoRunPartner({ id: rawListing.sellerId, ownerId: rawListing.seller.ownerId, officialPartner: rawListing.seller.officialPartner })
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
  const [i18n, brand, ownerEnforcement, reviewsPreview, moreFromSeller, convoCount90, priceBand, partnerListingCount, modelSlug, areaRent, brandCategory] = await Promise.all([
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
    // `attributes` (the stored JSON text) feeds the no-model fallback's facet — src/lib/price-fallback.ts.
    getPriceBand({ brandSlug: listing.brandSlug, model: listing.model, categorySlug: rawListing.category.slug, subcategorySlug: rawListing.subcategorySlug, listingType: rawListing.listingType, condition: listing.condition, year: listing.year, attributes: rawListing.attributes }),
    // An official partner's live listing count, for '{n} listings on eno.vn' in the shop row (owner,
    // 2026-09-30, K-TRUST-BADGE option D). Partners only: one indexed count, and only on ISR regen.
    // Edition-scoped exactly like the storefront's `_count` (seller-storefront.tsx), so the two agree.
    listing.seller.officialPartner
      ? scopedListingWhere({ sellerId: listing.sellerId, verified: true, status: 'active' }).then((where) => db.listing.count({ where }))
      : Promise.resolve(null),
    // The model's price page, for the "Market price" label's link (src/lib/model-pages.ts): live sale on its home shelf only,
    // so a sold PDP (ISR for 30 days) never links to a page that may 404. A failed read is no link, never a broken PDP.
    modelPageSlugFor({ brandSlug: listing.brandSlug, model: listing.model, categorySlug: rawListing.category.slug, subcategorySlug: rawListing.subcategorySlug, listingType: rawListing.listingType, status: rawListing.status }).catch(() => null),
    // The area rent line (areaRentOf above): the rent index's cell for this home to rent, null for every other row.
    areaRentOf({ ...rawListing, categorySlug: rawListing.category.slug }).catch(() => null),
    // The brand link's category (brand-category.ts): a failed read is the bare ?brand= link, as before.
    listing.brandSlug ? dominantCategory(listing.brandSlug).catch(() => null) : Promise.resolve(null),
  ])
  /**
   * The gallery's photo names and its lightbox's name follow the variant too (viTitle above): on the Vietnamese page a
   * screen reader heard every photo as the English source title under a Vietnamese H1 (sweep, 2026-10-22). A teacher's
   * title is a person's name, shown as written.
   */
  const galleryTitle = lang === 'vi' && listing.listingType !== TEACHER_LISTING_TYPE ? viTitle(listing.title, listing.titleVi, i18n[listing.title]) : displayTitle
  // ⛔ THE JOB PAGE SAYS IT ONCE (UI climb batch 95, owner-approved 2026-11-14, decision 3; mock variants13/d2c3): a linked job
  // whose storefront IS its employer (Nord Anglia, Inspired, FPT…) prints the ROLE as its H1, because the employer link under
  // the buy box names the employer. The rule and its gates are pdp-repeat-rows.ts roleOnlyHeading (unit-tested there); null =
  // the title as stored, as on every aggregator board (LinkedIn, TEAST, CareerLink…), where the H1 is the one place the employer
  // is named. ⛔ The H1 only: the <title>, og and share titles, the md+ crumb leaf, BreadcrumbList and the Details rows below all
  // read the full `listing.title`.
  const roleHeading = isJob ? roleOnlyHeading({ title: listing.title, titleVi: listing.titleVi, i18n: i18n[listing.title], employer: listing.attributes?.employer, storefront: listing.seller.name }) : null
  const h1Text = roleHeading ?? { title: listing.title, titleVi: listing.titleVi, i18n: i18n[listing.title] ?? null }
  // The apply-by day's year (JobApplyLine), decided from the DATA, never the clock (the page is ISR-cached for 30 days): only
  // when the posting's own day is in another year, so a job posted in December that closes on 5 January says "5 Jan 2027".
  const jobPostedOn = typeof listing.attributes?.postedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(listing.attributes.postedOn) ? listing.attributes.postedOn : null
  const applyByYear = !(jobPostedOn && jobApplyBy && jobPostedOn.slice(0, 4) === jobApplyBy.slice(0, 4))
  // ⛔ NO "Salary: see the original posting" (batch 95, owner-approved 2026-11-14, decision 3 — it reverses batch 63's quiet
  // line): a linked job with no figure and no stated pay renders NO price block at all, so no empty gapped flex item opens
  // between the job header and the H1. Only while nothing else would stand in that block (an urgent flag, a price drop —
  // importers set neither). An employer's own job keeps "Salary: negotiable" (owner 2026-10-01).
  // A salaryText that is empty or only spaces states no pay either (codex, batch 95 review): no empty price block for it.
  const noPayLine = isJob && listing.price === 0 && !(typeof listing.attributes?.salaryText === 'string' && listing.attributes.salaryText.trim())
  const priceBlock = !(noPayLine && !listing.urgent && !(listing.prevPrice != null && dropPercent(listing.prevPrice, listing.price)))
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
  /**
   * A partner that answers availability in its OWN chat (GoPlus partnership, owner 2026-10-19: "users should message
   * that account to ask for availability") — rental-check/shared.ts isChatOnlyPartner: the partner flag AS THIS PAGE
   * SHOWS IT (serialize.ts partnerShown — a row that links out never counts) and an owner account to read the chat. Such
   * a listing offers no eno availability check (below); the basket and the route refuse one as well.
   */
  // Who a Block on this page reaches: the shop itself when nobody blockable runs it (no owner, or the eno team) — only the
  // dialog's words depend on it (src/lib/user-blocks.ts isShopOnlyBlock). No query while ugc-safety is off.
  const blockShopOnly = appReviewGate('ugc-safety') ? await isShopOnlyBlock(rawListing.seller.ownerId) : false
  const chatOnlyPartner = isChatOnlyPartner({ officialPartner: listing.seller.officialPartner, hasOwner: rawListing.seller.ownerId != null })
  // The storefront's own address when it has one: /sellers/<id> redirects there (sellers/[id]/page.tsx).
  const sellerHref = rawListing.seller.handle ? `/${rawListing.seller.handle.handle}` : `/sellers/${listing.sellerId}`
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
  // Mileage only where it is a fact about a VEHICLE (pdp-08): a helmet or a tyre in Vehicles › Parts
  // printed "Mileage 0 km" as a chip under its title, and a 0 says nothing on any listing.
  if (listing.mileageKm != null && listing.mileageKm > 0 && rawListing.subcategorySlug !== 'parts-gear') numericSpecs.push({ label: 'Mileage', value: <><CountValue value={listing.mileageKm} /> km</> })
  if (listing.engineL != null) numericSpecs.push({ label: 'Engine', value: `${listing.engineL} L` })
  // A motorbike's displacement is stored in cc (the filterable `engineCc` range column), and was never
  // shown anywhere on the page it filters to. Only when there is no litre figure — one engine, one chip.
  if (listing.engineL == null && rawListing.engineCc != null && rawListing.engineCc > 0) numericSpecs.push({ label: 'Engine', value: <><CountValue value={rawListing.engineCc} /> cc</> })
  // Floor area (the `areaM2` range column, filterable on /c/rentals) — in Details ONLY, never as a meta
  // chip: the chips sit between the title and the CTA, and every one of them is spent from the phone fold.
  const detailOnlySpecs: { label: string; value: ReactNode }[] = []
  if (rawListing.areaM2 != null && rawListing.areaM2 > 0) detailOnlySpecs.push({ label: 'Area', value: <><CountValue value={rawListing.areaM2} /> m²</> })
  // ⛔ THE PROVIDER'S LICENCE ON AN e-VISA OR LEGAL & PERMITS LISTING (owner, 2026-10-14): its registered name and licence
  // no., as the first Details rows (provider-licence-rows.tsx) — only inside the two aisles, and only when both are there
  // (VietKite's grandfathered rows have none yet, and print nothing).
  const licenceAisle = isLicenceCheckSlot(rawListing.category.slug, rawListing.subcategorySlug)
  const providerValues = licenceAisle ? providerLicenceOf(rawListing.attributes) : null
  // Details rows that say nothing to a reader: an eSIM's "Service location: Online" (the facet is
  // excluded for eSIM, so it printed its raw key), a partner row's DERIVED "Provider: Business" facet
  // (taxonomy's providerType), and a Network row that repeats the Carrier beside it.
  // + the two licence keys EVERYWHERE — they have their own rows above, and a stray pair outside the aisles is never
  // printed under its raw camelCase key — and, in the aisles, providerType (the licensed provider row says who) and
  // serviceLocation (excluded there, so it printed its raw key — taxonomy.ts).
  const hiddenAttrs = new Set<string>(PROVIDER_LICENCE_KEYS)
  if (licenceAisle) { hiddenAttrs.add('providerType'); hiddenAttrs.add('serviceLocation') }
  if (rawListing.subcategorySlug === 'esim') hiddenAttrs.add('serviceLocation')
  if (affiliateUrl) hiddenAttrs.add('providerType')
  if (listing.attributes?.network != null && listing.attributes.network === listing.attributes.carrier) hiddenAttrs.add('network')
  // A linked job's "Source" fact (JOB_TEXT_ATTRIBUTES.source) when Seller information below already has a
  // Source row (pdp-09): the same "Nguồn" twice, one section above the other. SellerInfo's row stays —
  // it is the Decree 248 statement of who the reader deals with.
  if (sellerInfo?.kind === 'source' && sellerInfo.source.trim()) hiddenAttrs.add('source')
  // A LinkedIn job's day is the ALERT's, not a posting day: the Details table never prints it as "Posted" (nor the header —
  // showPosted below; opus review 2026-11-11). The attribute stays (the job-ad history reads it).
  if (listing.sellerId === JOB_BOARDS.linkedin.sellerId) hiddenAttrs.add('postedOn')
  // ⛔ A LINKED JOB'S DETAILS DO NOT REPEAT ITS HEADER (UI climb batch 84, 2026-11-13; blind A/B, Opus 7.16 → 7.33). A row goes
  // only where the header states the same fact: "Employer" when the h1 this variant prints (the importer's "<role> —
  // <employer>"; on the Vietnamese page the title viTitle picks, as the gallery does) names it in full, as whole words
  // (pdp-repeat-rows.ts); "Posted" because the header prints "Posted <ago>" on every linked job (showPosted; LinkedIn's day is
  // already hidden above); and "Apply by" when the buy box prints the deadline (JobApplyLine's "closes <day>" takes a YYYY-MM-DD
  // date only). The attributes stay (the job-ad history and the job-text screen read them), and an employer's own job (isJob
  // needs an affiliateUrl) keeps every row. ⚠️ The nine machine-translated languages translate the h1 on the client; a company
  // name survives that as a rule, and the "More jobs from <employer>" rail names it too.
  // ⚠️ Since batch 95 the H1 may print the role only (`roleHeading` above), and only where the storefront link names that same
  // employer, so "Employer" is still decided on the FULL heading: wherever it goes, the H1 or the link right under the buy box
  // names the employer.
  if (isJob) {
    const heading = lang === 'vi' ? viTitle(listing.title, listing.titleVi, i18n[listing.title]) : listing.title
    if (headingNamesEmployer(heading, listing.attributes?.employer)) hiddenAttrs.add('employer')
    hiddenAttrs.add('postedOn')
    if (jobApplyBy && /^\d{4}-\d{2}-\d{2}$/.test(jobApplyBy)) hiddenAttrs.add('applyBy')
  }
  /**
   * A RENTAL'S STRUCTURED FACTS (GoPlus partnership, owner 2026-10-19 — src/lib/rental-facts.ts): its monthly costs
   * (deposit, electricity, water, service/management fee, parking), its occupancy rows (max occupants, floor, available
   * from) and its amenities (the `amenities:*` tokens — the filter chips' own words). Each has its own section or row
   * with an authored label; a WELL-FORMED raw key never reaches the generic table below, where it would print as
   * machine-translated camelCase with an ungrouped number. ⚠️ Only on a place rental priced in đồng (rentalFactsApply),
   * and only the well-formed keys (rentalFactHiddenKeys): any other listing, and a malformed value, keep their generic
   * rows exactly as before.
   */
  const factsApply = rentalFactsApply({ categorySlug: rawListing.category.slug, subcategorySlug: rawListing.subcategorySlug, listingType: listing.listingType, currency: listing.currency })
  if (factsApply) for (const k of rentalFactHiddenKeys(listing.attributes)) hiddenAttrs.add(k)
  const costRows = factsApply ? rentalCostRows(listing.attributes) : []
  const factRows = factsApply ? rentalFactRows(listing.attributes) : []
  const amenities = factsApply ? amenityOptions(rawListing.facetTokens, rawListing.category.slug, rawListing.subcategorySlug) : []
  // The rent row of "Costs" only for a price quoted per month — a figure without its period would be a guess.
  const monthlyRent = factsApply && listing.price > 0 && priceUnitSuffix(listing.priceUnit) === 'month' ? listing.price : null
  // The deposit chip beside the price (depositSummary): months when exact, else the amount. A place rental in đồng only:
  // factsApply is rentalFactsApply, which requires the listing's currency to be ₫/VND, so rent and deposit share a unit.
  const deposit = factsApply ? depositSummary(costRows, monthlyRent) : null
  /**
   * ⛔ ONE FACTS LINE UNDER THE TITLE, AND NOTHING SAID TWICE BELOW IT (UI climb batch 89, 2026-11-13; blind A/B on live eno.vn,
   * Opus +0.24, trust −0.1; owner: "reduce lines … super clean, minimal wording, only what's necessary"). On every listing but
   * a job (a teacher's page returned above), the price row's chips and the meta row under the H1 are one grey line — its
   * render says what it holds. Below it, Details drops the rows that line or the price's unit already state, BY KEY
   * through hiddenAttrs, like batch 84's job rows (the attributes stay for every other reader), and Costs drops its Rent row
   * (rental-facts.tsx) and, below md only, its Deposit row when the line prints the deposit. An emptied section renders
   * nothing: showDetails and the Costs wrapper read the rows that REMAIN. The dropped keys still name the description's
   * repeats (restatedAttrs → repeatedFacts), so its own fact rows stay hidden as before.
   *   · bedrooms and floor go to the line only where the rental facts apply (a place rental in đồng), from the attribute keys;
   *   · "Rental period" goes when the headline price's unit is that period (pdp-repeat-rows.ts periodRestatedByUnit).
   * The numeric specs (Year, Mileage, Engine) are printed in the line, so there Details renders none of them (detailSpecs).
   * ⛔ NO ROW GOES BECAUSE THE TITLE CONTAINS ITS VALUE (the A/B mock's rule, built and withdrawn the same night — codex and
   * Opus both refuted it): a word in a title is not the fact. "Not automatic" hid "Transmission: Automatic", "Phòng không chung
   * chủ" hid every row answered "Không", "Studio · Nha Be" hid "Apartment type: Studio" — and a heading the browser translates
   * cannot be read here at all. Only rows the facts line or the price's unit print, by key, are dropped.
   * ⚠️ ONE EXCEPTION, BY CONSTRUCTION AND BELOW md ONLY (owner-approved 2026-11-15 (build 7), cook r07 "rental": "Details is hidden
   * when it only repeats the title"): on the rental sheet a GoPlus room's Details is not DRAWN on a phone when its one row is the
   * apartment type the importer built that title from (`detailsPhoneHidden` below; goplus-listing.ts goplusTitleNamesAptType —
   * the stored type looked up in the importer's own label table, never a word searched in a title). No row is dropped: the
   * table is whole from md, and any second row draws it whole on a phone too.
   */
  const factsLine = listing.listingType !== 'job' && rawListing.category.slug !== 'jobs'
  const bedrooms = factsLine && factsApply ? bedroomsOf(listing.attributes) : null
  const floorFact = factsLine ? factRows.find((r): r is Extract<FactRow, { key: 'floor' }> => r.key === 'floor') ?? null : null
  const restatedAttrs: string[] = []
  let attrRowsBefore89: number | null = null
  if (factsLine) {
    if (bedrooms) restatedAttrs.push('bedrooms')
    if (periodRestatedByUnit(listing.attributes?.rentalPeriod, listing.price > 0 ? listing.priceUnit : null)) restatedAttrs.push('rentalPeriod')
    // The partner repeat-CTA's "8+ Details rows" (below) keeps counting what Details held before this batch: it is a money
    // surface, and a rental whose rows moved into the facts line is no shorter for the buyer deciding to follow the link.
    attrRowsBefore89 = attrs.filter(([k]) => !hiddenAttrs.has(k)).length
    for (const k of restatedAttrs) hiddenAttrs.add(k)
  }
  const detailAttrs = attrs.filter(([k]) => !hiddenAttrs.has(k))
  const detailSpecs = factsLine ? [] : numericSpecs
  const detailFactRows = floorFact ? factRows.filter((r) => r !== floorFact) : factRows
  // Costs' rows hidden below md: the deposit, which the facts line prints on a phone (its `deposit` fact is phone-only).
  const costsPhoneHidden = factsLine && deposit ? ['deposit'] : []
  const showDetails = !!providerValues || detailAttrs.length > 0 || detailSpecs.length > 0 || detailOnlySpecs.length > 0 || detailFactRows.length > 0
  // The rental sheet's phone Details, not drawn when its one row is the type a GoPlus title was built from (the ⚠️ above). Judged
  // against the title this variant's H1 prints (the Vietnamese page shows titleVi; a rental is never a job, so it is the full title).
  const detailsPhoneHidden = rentalSheet && goplusRoom && showDetails && !providerValues && detailSpecs.length === 0 && detailOnlySpecs.length === 0
    && detailFactRows.length === 0 && detailAttrs.length === 1 && detailAttrs[0][0] === 'aptType'
    && goplusTitleNamesAptType(detailAttrs[0][1], lang === 'vi' ? (listing.titleVi || listing.title) : listing.title)
  // The Details rows this page renders, by the name rich-text.tsx gives each (the spec label lower-cased,
  // the attribute key as stored): the description hides its own row for any of them, so an imported
  // rental's Area / Bedrooms / Bathrooms are not printed twice, one table above the other. ⚠️ From the FULL spec list and with
  // the keys batch 89 moved to the facts line or the price's unit states (restatedAttrs): it is a hide-in-description list, and
  // those facts are still on the page.
  const repeatedFacts = hideRepeatedFacts([...numericSpecs, ...detailOnlySpecs].map((s) => s.label.toLowerCase()).concat(detailAttrs.map(([k]) => k), restatedAttrs))
  // ⚠️ A DESCRIPTION THAT ONLY REPEATS THE TITLE IS NOT SHOWN. Importers copy the title into the body
  // when the feed has none ('iPhone 18 Pro 256GB' under an H1 saying 'iPhone 18 Pro 256GB'), which
  // spent a section heading and a line on nothing. Compared on letters and digits only, so case,
  // punctuation and Unicode form do not decide it — and against BOTH title columns: a localized import
  // keeps its English title in `title` and the source's Vietnamese one in `titleVi`, while the copied
  // body is the Vietnamese ('Sofa Băng Cũ …' under 'Used Sofa Bench …'), which is still only the title.
  // Metadata and JSON-LD still use the description.
  const normText = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const descNorm = normText(listing.description)
  // ⛔ AND NOT ON A LINKED JOB (2026-11-06 audit). Its description is eno's importer template, never the source's words
  // (job-listing.ts mapStagedJob). The first sentence repeats what Details, the meta row and the buy box already print:
  // employer, place, board, posted, apply-by and pay. The second paragraph repeats what the shop row, the SafetyStrip and
  // Seller information say: it links to the posting, eno has not verified the employer, never pay a fee. It opened a desktop's
  // left column ahead of the role and said the strip's "never pay" a second time; Details now leads. The page is noindex
  // (isLinkedJobReference), metadata still reads the text, and an employer's own job (no affiliateUrl) keeps its words.
  // ⛔ NOR A GOPLUS ROOM'S TEMPLATE (batch 83, 2026-11-13 — goplus-listing.ts isGoplusTemplateDescription): "Studio in Nha Be
  // Commune, … Message GoPlus to check availability" repeats the title, the pin line and Chat now. Decided per server variant,
  // on the column that variant shows: the English page (and the nine languages translated from its text) tests the English
  // column, which never carries the staff extras; the Vietnamese page also requires its own column to have none ("Tiện ích
  // khác:" appears nowhere else). The metadata still reads the text.
  // ⛔ AND A BLVCK BIKE'S DESCRIPTION OPENS ON ITS PRICE TABLE, NOT ON ENO'S INTRO (UI climb batch 90, 2026-11-14; owner
  // 2026-11-13: "reduce lines … super clean, minimal wording, only what's necessary"; blind A/B on live eno.vn, Opus
  // +0.14/+0.12, GPT +0.17, trust ±0). Not batch 83's whole-section rule: Blvck's text holds the tiers, "To rent", Included
  // and Delivery, which stay as written (blvck-listing.ts, owner 2026-11-04). Only its first paragraph goes, and only when it
  // is EXACTLY the intro rebuilt from this listing's own titles (blvckIntroSentences: by construction, never a text match);
  // ListingDescription applies it to whichever language it shows. Every width (it repeats the first screen everywhere).
  // Same gate shape as goplusRoom: an official partner's storefront and the importer's `blvck:` externalId. The metadata and
  // JSON-LD still read the full stored text.
  const blvckIntros = rawListing.seller.officialPartner === true && (rawListing.externalId ?? '').startsWith('blvck:')
    ? blvckIntroSentences({ title: listing.title, titleVi: listing.titleVi })
    : []
  const showDescription = !isJob && descNorm !== '' && descNorm !== normText(listing.title) && descNorm !== normText(listing.titleVi ?? '')
    && !(goplusRoom && isGoplusTemplateDescription({ description: listing.description, title: listing.title, ...(lang === 'vi' ? { descriptionVi: listing.descriptionVi ?? '', titleVi: listing.titleVi } : {}) }))
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

  // The trail — site › category › subcategory › listing — and its rich result, from ONE model so the two
  // stay in step (NAV-10; src/lib/pdp-breadcrumb.ts). The subcategory crumb is a vehicle hire listing's
  // hub (marketplace only, like every hub link) or the explorer filtered to category + subcategory.
  const subcategory = subcategoryCrumb(
    { categorySlug: rawListing.category.slug, subcategorySlug: rawListing.subcategorySlug, city: listing.city },
    pageVariant,
    !IS_SERVICES,
  )
  /**
   * ⛔ A RETIRED SHELF HAS NO CATEGORY CRUMB IN THE MARKUP (review, 2026-10-03): its browse link is the
   * explorer filtered to it (`/?category=…`, retired-categories.ts), which canonicalises to `/` — a
   * BreadcrumbList item whose canonical is another page. The visible crumb still links it for people. The
   * same holds for an explorer subcategory crumb; a hub crumb is a real page and is kept (pdpBreadcrumbLd).
   * The root is SITE_NAME, not a literal "eno.vn" — this page renders on eno.forum too.
   */
  const breadcrumbLd = pdpBreadcrumbLd({
    hostUrl,
    siteName: SITE_NAME,
    lang: pageVariant,
    category: { slug: rawListing.category.slug, name: listing.category.name, nameVi: listing.category.nameVi },
    subcategory,
    title: displayTitle,
    canonicalUrl,
  })

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
   * ⚠️ APP STORE GATE `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts) — off by default, and then `false` here and the
   * page is byte-identical. On, an e-Visa product — the desk's, or any seller's (isEVisaProductListing: the e-Visa
   * subcategory, which since 2026-10-14 holds e-visa listings only) — offers no way to apply in the iOS app:
   * the start button or the chat that takes the order is wrapped in `ios-app-hidden`, and an `ios-app-only` line says
   * where applying happens. CSS, not the user agent, because this page is ISR and the edge cache shares its HTML between
   * the app and the web; the disclosure above it (who we are not, the official portal) stays on both.
   */
  const iosHideContact = appReviewGate('ios-hide-visa') && (isVisaProduct || isEVisaProductListing({ categorySlug: catSlug, subcategorySlug: rawListing.subcategorySlug, attributes: listing.attributes }))
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
  // ⛔ A JOB HAS NO BOTTOM NOTE (2026-11-06 audit). A linked job kept one after pdp-09 proposed dropping it as a repeat of
  // the SafetyStrip above (review, 2026-10-04), because its training-fee and ID-documents advice appeared nowhere else on
  // the page. Both are now the strip's own quiet line on every job, beside Apply (safety-strip.tsx `data-job-id-line`);
  // the rest (never pay a fee or a deposit) repeated the strip's first line a screen further down, and the linked
  // job page said "never pay" four times. Only the Details 'Nguồn' row was a true repeat, and it is gone.
  // ⛔ NOR, SINCE BATCH 62 (2026-11-11), WHERE THE STRIP ON THIS PAGE ALREADY SAYS IT: a rental (its one extra fact, the owner's
  // papers, is now in the strip's housing line) and, on eno.vn, plain goods. Which listing gets which note is decided in one
  // pure, tested place, keyed on the same category facts the strip picks its line by (src/lib/pdp-safety-note.ts).
  const safetyNoteKind = pdpSafetyNoteKind({ listingType: listing.listingType, categorySlug: catSlug, subcategorySlug: rawListing.subcategorySlug, linked: !!affiliateUrl, visaCopyHeld, forum: IS_SERVICES })
  const safetyNote = safetyNoteKind === 'rent'
      ? (IS_SERVICES
        ? tr("Visit in person and check the owner's papers before paying any deposit. eno.forum never asks for a deposit via a link.", 'Hãy đến xem tận nơi và kiểm tra giấy tờ của chủ sở hữu trước khi đặt cọc. eno.forum không bao giờ yêu cầu đặt cọc qua đường link.')
        : <Tr text="Visit in person and check the owner's papers before paying any deposit. eno.vn never asks for a deposit via a link." />)
    : safetyNoteKind === 'service'
      // + who answers for the service itself (owner, 2026-10-14: providers can be "local businesses, individuals … or
      // foreign workers"): the provider holds any licence or work permit THEY need — not the marketplace. Each edition
      // words it the way its neighbour sentence is worded (eno.vn: <Tr> with a curated vi-override, so the nine MT
      // languages translate both sentences; eno.forum: an authored pair).
      ? (IS_SERVICES
        ? <>{tr('Agree what is included and the price in chat before paying, and never send a deposit through a link. eno.forum never asks for one.', 'Thống nhất nội dung và giá dịch vụ trong khung chat trước khi thanh toán, và đừng bao giờ chuyển tiền cọc qua đường link. eno.forum không bao giờ yêu cầu điều đó.')}{' '}{tr('Each provider is responsible for holding any licence or work permit they need to offer their service.', 'Mỗi nhà cung cấp tự chịu trách nhiệm có đủ giấy phép hoặc giấy phép lao động cần thiết để cung cấp dịch vụ của mình.')}</>
        : <><Tr text="Agree what is included and the price in chat before paying, and never send a deposit through a link. eno.vn never asks for one." />{' '}<Tr text="Each provider is responsible for holding any licence or work permit they need to offer their service." /></>)
    : safetyNoteKind !== 'goods'
      ? null
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
  // A LinkedIn job's day is the day of the alert that carried it, never a posting day: no "Posted" row (opus review 2026-11-11).
  const showPosted = (!affiliateUrl || isJob || (listing.listingType === 'rent' && !provenance)) && listing.sellerId !== JOB_BOARDS.linkedin.sellerId
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
  // ⚠️ Counted as before batch 89 (codex/Opus, 2026-11-13: an unannounced change to a money surface): the full spec list and
  // the attribute rows before the facts-line de-dup, so the repeat CTA appears on exactly the pages it did.
  const detailRowCount = numericSpecs.length + detailOnlySpecs.length + (attrRowsBefore89 ?? detailAttrs.length)
  const repeatCta = !!affiliateUrl && ((showDescription && descNorm.length >= 600) || detailRowCount >= 8)
  /**
   * ⛔ THE GOODS SHEET (owner-approved 2026-11-14, cook r06 "item": "after this cook round build all best options and deploy";
   * src/lib/goods-sheet.ts has the whole page): a goods or vehicle listing, on a phone. Every listing with a gallery that is
   * not a job (`factsLine`) and not a home to rent (`rentalSheet`). Decided here from the listing alone, so the server HTML
   * and the first client render agree. Below md only; from md the page paints as before (each call site says how).
   */
  const goodsSheet = isGoodsSheet({ noGallery, rentalSheet, factsLine })
  /**
   * ⛔ …AND ITS ACTION PINNED FROM THE FIRST PAINT, WITH THE TAB BAR RETRACTED (owner-approved 2026-11-14, cook r06 "item"),
   * only where `#contact` is one control and one line (pinsAction has the list; every other page keeps the in-flow block and
   * PdpActionBar's mirror). The same facts the blocks below are rendered from.
   * ⛔ …AND ON THE RENTAL SHEET WHERE THE ACTION IS CHAT NOW ALONE (owner-approved 2026-11-15 (build 7), cook r07 "rental";
   * src/lib/rental-sheet.ts pinsRentalAction): the same tier, with the price beside Chat now (ContactComposer `barPrice`).
   */
  const pinned = pinsAction({
    goodsSheet,
    affiliate: !!affiliateUrl,
    job: isJob,
    booking: isBooking,
    commission: !!affiliateUrl && isCommissionLink(affiliateUrl),
    discountCode: !!listing.affiliateDiscountCode,
    productStep: !!affiliateUrl && embeddedProductUrl(affiliateUrl) !== null,
    price: listing.price,
    negotiable: listing.negotiable !== false,
    visa: isVisaProduct || isVisaProductSlot(catSlug, rawListing.subcategorySlug),
    iosHide: iosHideContact,
    tripDesk: isTripProduct,
    rentalCheck: rentalCheckApplies(rawListing.category.slug, rawListing.subcategorySlug, chatOnlyPartner) && listing.status === 'active',
  }) || pinsRentalAction({
    rentalSheet,
    affiliate: !!affiliateUrl,
    price: listing.price,
    negotiable: listing.negotiable !== false,
    visa: isVisaProduct || isVisaProductSlot(catSlug, rawListing.subcategorySlug),
    iosHide: iosHideContact,
    tripDesk: isTripProduct,
    rentalCheck: rentalCheckApplies(rawListing.category.slug, rawListing.subcategorySlug, chatOnlyPartner) && listing.status === 'active',
  })
  // Whether Seller information draws anything (it renders nothing with no row): the counsel panel joins it only then.
  const sellerInfoShown = !!sellerInfo && (sellerInfo.kind === 'business'
    ? [sellerInfo.legalName, sellerInfo.legalAddress, sellerInfo.taxCode].some((v) => !!v?.trim())
    : sellerInfo.source.trim() !== '')
  // The slot-8 wrapper below md on the goods sheet holds Description, and the partner CTA repeat where it is not pinned; Details
  // shows under the head there instead. With nothing left to show below md it is hidden whole (no empty item, no gap).
  const order8PhoneEmpty = goodsSheet && !showDescription && amenities.length === 0 && !(repeatCta && !!affiliateUrl && !pinned)
  /**
   * ⛔ THE PINNED TIER IS THE BUTTON ALONE; ITS LINE IS SAID ONCE, IN THE PAGE (owner-approved 2026-11-15 (build 7), cook r07 "item";
   * it reverses there r06's "the box is the button and its one line" — goods-sheet.ts pinsAction, ContactComposer and
   * AffiliateBooking `pinned`): below md the tier draws only its control, and the one line that qualified it is rendered by the
   * server where it belongs, from the same facts the tier's copy is (so the two never disagree, and nothing is cloned):
   *   · a linked listing's source line ("Source: <shop>'s website · original page", ImportProvenance `look="counsel"`) in
   *     Seller information in place of its "Source: <shop>" row — only where that row names the same shop (`provenanceInInfo`);
   *     otherwise as the seller band's last line;
   *   · Chat now's line (a partner's "No phone number is shared", src/lib/contact-line.ts) as the seller band's last line.
   * Every copy outside the tier is `md:hidden` (the band is); from md the tier is the in-flow block with its line, as before.
   */
  const tierLineInPage = pinned && goodsSheet
  const counselProvenance = (className: string) => tierLineInPage && affiliateUrl && provenance
    ? <ImportProvenance kind={provenance.kind} site={provenance.site} iso={provenance.iso} href={affiliateUrl} look="counsel" className={className} />
    : null
  const provenanceInInfo = tierLineInPage && !!affiliateUrl && !!provenance && sellerInfoShown && sellerInfo?.kind === 'source'
    && sellerInfo.source.trim().normalize('NFC') === provenance.site.trim().normalize('NFC')
  const tierLine = !tierLineInPage ? null
    : affiliateUrl ? (provenanceInInfo ? null : counselProvenance(''))
    : contactLine(listing.seller.officialPartner ? 'partner' : 'person', tr)
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
  // ⛔ The place, in ONE expression for both of its homes (the facts line; a job's meta row). A wholly administrative location
  // is never machine-translated (city-short.ts adminPlaceEn): "Huyện Nhà Bè (Xã Nhà Bè)" printed "The House of Bee" here for
  // every English reader. Anything else keeps its translation. In the card's form where the title already names the ward
  // (cardArea: the bracket off), so the line still fits beside "Posted": the full "Nha Be District (Nha Be Commune)" wrapped it
  // and pushed the seller off the first screen (judge, 2026-11-10). ⛔ Never split on its commas (the A/B mock did, in the
  // browser): that cuts a translated or bracketed name.
  const placeName = locationEn ? <PlaceName en={collapseRepeatedName(pinShortEn ? cardArea(locationEn) : locationEn)} vi={collapseRepeatedName(pinShortVi ? cardArea(listing.location) : listing.location)} /> : <LocalizedText text={collapseRepeatedName(listing.location)} vi={mayBeVietnamese(listing.location) ? collapseRepeatedName(listing.location) : null} i18n={collapseRepeatedNames(i18n[listing.location])} />
  /**
   * THE FACTS LINE (batch 89 — the note at `factsLine` above has the record). In the A/B winner's order: Fixed price,
   * condition, brand, the numeric specs, bedrooms, floor, the place, the deposit — then the social proof and "Posted <ago>"
   * LAST, which the mock dropped and this keeps (freshness and the saved/views proof were functions of the old meta row).
   * Every fact keeps the gate it had as a chip or a meta item; only where it prints moved. Nothing on a job (`factsLine`).
   */
  const facts: { key: string; node: ReactNode; phoneOnly?: boolean }[] = []
  if (factsLine) {
    // "Fixed price" is a P2P seller's statement that they won't haggle, so it is shown only where one could: a seller's own
    // sale (retail or wholesale) or rental with a real price. Not on a job (a salary line is not an offer), not on a partner
    // row (the partner prices it at its own checkout, and on a ticket the figure is only "from"), not on a service (in the
    // services category the server forces every price to fixed, so there it says nothing), and not on a Free (0) item,
    // where it read "Free · Fixed price".
    // ⚠️ WHOLESALE IS A SALE: the post wizard offers its seller the same Negotiable/Fixed choice (fixedPriceOnly is services +
    // wanted only), and 16 live wholesale posts chose Fixed (2026-09-29) — dropping it there would lose their answer.
    if (!listing.negotiable && !affiliateUrl && listing.price > 0 && (listing.listingType === 'sell' || listing.listingType === 'rent' || listing.listingType === 'wholesale')) {
      facts.push({ key: 'fixed', node: <Tr text="Fixed price" /> })
    }
    // The condition is free text up to 60 characters (core/listings.ts) — the seller's own words, with the warranty in them, so
    // they are never truncated: the line WRAPS (break-ui, 2026-10-05: "Như mới 99%, đã thay pin chính hãng, còn bảo hành 6
    // tháng" was 369px wide as a nowrap pill on a 320px phone). ⛔ NEVER ON A JOB (2026-10-19): a job has no condition —
    // every write path stores null for Jobs (taxonomy.ts storesCondition) — and free text printed here would be words the
    // job-text screen never read; a row written before that rule prints none either. (The line itself is never on a job; the
    // gate stays, so moving the line can never print one.)
    if (listing.condition && rawListing.category.slug !== 'jobs') {
      const word = conditionChoice(listing.condition)
      facts.push({ key: 'condition', node: word ? tr(word.label, word.labelVi) : <Tr text={listing.condition} /> })
    }
    // The brand links into the brand-filtered feed (resolved in the parallel batch above), in the reader's language
    // (localizedHref, disc-missed) — an inline link now, in ink and ⛔ ALWAYS UNDERLINED: a link inside a run of text must not
    // be told apart by colour alone (WCAG 1.4.1, axe link-in-text-block — ink on the line's grey is under 3:1). Weight did not
    // count: the live prod a11y e2e failed on every branded listing with font-medium + hover:underline (2026-11-14, b89). ⛔ NO tap-44: a link inside a line of
    // text is the target-size rule's inline exception (WCAG 2.5.8), and its 44px ::before reached ~10px above the line, over
    // the "See original" button of the machine-translation note right above it — later in the DOM, so it took those taps
    // (review, 2026-11-13; globals.css tap-44's tap-stealing note). The chip it replaces had no tap floor either.
    if (brand) {
      // The goods sheet below md: the link in the line's own grey, still underlined (owner-approved 2026-11-14, cook r06 "item").
      // With the brand's category, the URL the explorer would end on (brand-category.ts): a bare ?brand= is rewritten after load.
      // nofollow: brandHref is always the home filtered (`/?…brand=…`), canonical `/` (filter-link-rel.ts).
      facts.push({ key: 'brand', node: <Link href={localizedHref(brandHref(listing.brandSlug!, brandCategory), pageVariant)} rel="nofollow" prefetch={false} className={cn('text-foreground underline underline-offset-4', goodsSheet && 'max-md:text-muted-foreground')}>{brand.name}</Link> })
    }
    for (const s of numericSpecs) facts.push({ key: `spec-${s.label}`, node: <><Tr text={s.label} /> {s.value}</> })
    if (bedrooms) {
      facts.push({ key: 'bedrooms', node: 'studio' in bedrooms
        ? <Bilingual en={RENTAL_FACT_LABELS.studio.label} vi={RENTAL_FACT_LABELS.studio.labelVi} />
        : bedrooms.n === '1'
          ? <Bilingual en={RENTAL_FACT_LABELS.bedroomOne.label} vi={RENTAL_FACT_LABELS.bedroomOne.labelVi} />
          : <Bilingual en={RENTAL_FACT_LABELS.bedroomsN.label} vi={RENTAL_FACT_LABELS.bedroomsN.labelVi} values={{ n: bedrooms.n }} /> })
    }
    if (floorFact) {
      facts.push({ key: 'floor', node: typeof floorFact.floor === 'number'
        ? <><Bilingual en={RENTAL_FACT_LABELS.floor.label} vi={RENTAL_FACT_LABELS.floor.labelVi} /> <CountValue value={floorFact.floor} /></>
        : <Bilingual en={floorFact.floor.label} vi={floorFact.floor.labelVi} /> })
    }
    // The place, always — ⛔ never left out because the title mentions it (built and withdrawn 2026-11-13: codex refuted it —
    // "Phòng gần Quận 7", a room NEAR District 7, would have hidden "District 7"; and the English HTML is also what the nine
    // machine-translated languages read, whose H1 the browser translates while the place is never translated).
    if (listing.location?.trim()) facts.push({ key: 'place', node: placeName })
    // The deposit beside the rent (best-practice gap 2026-11-10; rental-facts.ts depositSummary): on a phone it sat in Costs a
    // scroll below. ⚠️ PHONES ONLY: from md the buy box shows Costs beside the price, with its Deposit row — which below md
    // is hidden instead (the Costs wrapper). The service fee stays in Costs. Server-rendered in the page's language.
    if (deposit) {
      facts.push({ key: 'deposit', phoneOnly: true, node: 'months' in deposit
        ? (deposit.months === 1
          ? <Bilingual en={RENTAL_FACT_LABELS.depositMonth.label} vi={RENTAL_FACT_LABELS.depositMonth.labelVi} />
          : <Bilingual en={RENTAL_FACT_LABELS.depositMonths.label} vi={RENTAL_FACT_LABELS.depositMonths.labelVi} values={{ n: String(deposit.months) }} />)
        : <><Bilingual en={RENTAL_FACT_LABELS.depositAmount.label} vi={RENTAL_FACT_LABELS.depositAmount.labelVi} />&nbsp;<VndValue value={deposit.amount} /></> })
    }
    // Quiet social proof, above the same credibility floor as `showProof`.
    // Behind showProof itself (codex, 2026-11-13), and each count above its own floor — exactly the old socialProof element.
    if (showProof) {
      if (listing.savedCount >= 3) facts.push({ key: 'saved', node: <><SavedCount base={listing.savedCount} id={listing.id} /> <Tr text="saved" /></> })
      if (listing.views >= 20) facts.push({ key: 'views', node: <><CountValue value={listing.views} /> <Tr text="views" /></> })
    }
    // Freshness, last (showPosted says where it is true).
    if (showPosted) facts.push({ key: 'posted', node: <><Tr text="Posted" /> <PostedAgo iso={listing.postedAt} /></> })
  }
  const factSeps = factSeparators(facts.map((f) => !!f.phoneOnly))
  /**
   * ⛔ THE RENTAL SHEET'S HEAD FACTS BELOW md (owner-approved 2026-11-15 (build 7), cook r07 "rental"; it reverses there batch 89's
   * ONE facts line — src/lib/rental-sheet.ts SHEET_FACTS has the whole rule): the SAME `facts`, each printed once, split three
   * ways — the bedroom count, a numbered floor and a deposit in whole months as a row of figures (`sheetStats`, at least two of
   * them, or none), the place on the Location line over the map (`placeOnMap`, wherever a map is drawn), the rest as one quiet
   * line under the price (`sheetQuiet`). A studio, a ground or mezzanine floor and a deposit stated as an amount are words, not
   * figures: they stay in the quiet line. From md the facts line is the one it was (display:none below md on the sheet).
   */
  const sheetStats: { key: string; value: ReactNode; label: ReactNode }[] = []
  if (rentalSheet) {
    if (bedrooms && 'n' in bedrooms) sheetStats.push({ key: 'bedrooms', value: bedrooms.n, label: bedrooms.n === '1'
      ? <Bilingual en={RENTAL_FACT_LABELS.statBedroom.label} vi={RENTAL_FACT_LABELS.statBedroom.labelVi} />
      : <Bilingual en={RENTAL_FACT_LABELS.statBedrooms.label} vi={RENTAL_FACT_LABELS.statBedrooms.labelVi} /> })
    if (floorFact && typeof floorFact.floor === 'number') sheetStats.push({ key: 'floor', value: <CountValue value={floorFact.floor} />, label: <Bilingual en={RENTAL_FACT_LABELS.floor.label} vi={RENTAL_FACT_LABELS.floor.labelVi} /> })
    if (deposit && 'months' in deposit) sheetStats.push({ key: 'deposit', label: <Bilingual en={RENTAL_FACT_LABELS.depositAmount.label} vi={RENTAL_FACT_LABELS.depositAmount.labelVi} />, value: deposit.months === 1
      ? <Bilingual en={RENTAL_FACT_LABELS.statMonth.label} vi={RENTAL_FACT_LABELS.statMonth.labelVi} />
      : <Bilingual en={RENTAL_FACT_LABELS.statMonths.label} vi={RENTAL_FACT_LABELS.statMonths.labelVi} values={{ n: String(deposit.months) }} /> })
    // Never a row of one: a lone figure stays a fact in the quiet line.
    if (sheetStats.length < 2) sheetStats.length = 0
  }
  const sheetStatKeys = new Set(sheetStats.map((st) => st.key))
  const placeOnMap = rentalSheet && showMap && facts.some((f) => f.key === 'place')
  const sheetQuiet = rentalSheet ? facts.filter((f) => !sheetStatKeys.has(f.key) && !(placeOnMap && f.key === 'place')) : []

  /**
   * THE H1 AND THE FACTS LINE, rendered in ONE of two places in the header block below: after the price (every listing page,
   * P-HIER's price → title → metadata) or, on the rental sheet, BEFORE it — there the DOM order is the phone's paint order
   * (title, facts, price), and the price row's `md:order-first` paints it first again from md. Nothing in the price row is
   * focusable, so the focus order is the same either way; only a desktop screen reader hears the title before the price.
   */
  // ⛔ A LINKED JOB (owner-approved 2026-11-14, cook r06 jobs; src/lib/job-sheet.ts): the H1 is the display line below sm and
  // rides one line with Share (`jobTitleLine`); its facts follow the employer and the pay (the header block below).
  const headH1 = (
    <>
      {/* Title — the single H1, 18px/700 (owner, 2026-09-30, P-HIER). At font-medium it read as
          body copy under the price and the page had no heading. Bold at 18px it is a heading
          and still sits far below the 30px price, so price-first holds.
          ⛔ …EXCEPT ON THE RENTAL SHEET BELOW md (owner-approved 2026-11-14, cook r05 "rental-c"; it reverses P-HIER there):
          the TITLE leads, then the price — since build 7 (owner-approved 2026-11-15 (build 7), cook r07 "rental") the title in
          the section role (`text-t-h2` 22/28) and the PRICE the page's one display element (`text-t-figure` 32/40) — then the
          head's phone facts (SHEET_TITLE / SHEET_PRICE, src/lib/rental-sheet.ts). From md: PAGE_TITLE's own 24px, the 30px
          price first.
          `data-fab-avoid` on the H1 (inside LocalizedTitleHeading) and on the facts line below: the
          support bubble rests over the end of the title and the posted time on first paint (si-11,
          real iOS) — it now yields there (back-to-top.tsx OBSTACLES; a wide value is yielded to,
          never risen above). A machine-translated title gets "Translated · See original" under it. */}
      {/* `[overflow-wrap:anywhere]` (break-ui, 2026-10-05): a title with no spaces in it must not widen the page. */}
      {/* ⛔ …AND ON THE GOODS SHEET BELOW md (owner-approved 2026-11-14, cook r06 "item"; it reverses P-HIER's 18px there): the H1
          is the sub-section role (`text-t-h3`, 17/24) under the 32px price, which stays the largest text (GOODS_TITLE,
          src/lib/goods-sheet.ts); from md PAGE_TITLE's 24px. */}
      <LocalizedTitleHeading className={rentalSheet ? SHEET_TITLE : goodsSheet ? GOODS_TITLE : isJob ? JOB_TITLE : PAGE_TITLE} title={h1Text.title} titleVi={h1Text.titleVi} i18n={h1Text.i18n} goods={goodsSheet} />
    </>
  )
  const headFacts = (
    <>
      {/* THE FACTS LINE (UI climb batch 89, 2026-11-13; blind A/B on live eno.vn, Opus +0.24, trust −0.1; owner: "reduce
          lines … super clean, minimal wording, only what's necessary"): ONE grey 16px line under the H1 — "Fixed price ·
          1 bedroom · Floor 2 · Deposit 1 month" — in place of the price row's chips and the meta row of chips and glyphs.
          What it holds and each fact's gate: `facts` above. Server-rendered, nothing measured in the browser.
          ⛔ IT WRAPS, NEVER TRUNCATES (`[overflow-wrap:anywhere]`, no `truncate`): the seller's condition text and the
          phone's deposit must never be cut off its end, as the mock's one-line ellipsis did.
          ⚠️ THE '·' SEPARATORS COME FROM THE DATA, IN ONE TEXT RUN (factSeparators). The old meta row banned literal
          separators because they were FLEX ITEMS of their own, so a wrap could strand one alone at a line's end
          ('Apple · New · Hồ Chí Minh ·') or start. Here the facts and their dots are one run of inline text: a no-break
          space ties each dot to the fact before it (FACT_SEP — the H1's own rule, LocalizedTitleHeading, 2026-11-06
          audit), so a line can end on "fact ·" but never open on a dot, and no dot is ever alone; a dot is only ever
          printed BETWEEN two facts the reader sees, at every width — the phone-only deposit carries its own, and the
          fact before it loses its dot from md when nothing visible follows.
          `data-fab-avoid`: the support bubble yields over it (back-to-top.tsx — a wide value is yielded to, never
          risen above; si-11). Not on a job: its meta row below is as it was.
          ⛔ ON THE GOODS SHEET BELOW md (owner-approved 2026-11-14, cook r06 "item"; it reverses "ONE grey 16px line" there): 14px,
          and each fact but the seller's free-text condition is one box with its dot (GOODS_FACT), so the line breaks BETWEEN facts,
          never inside a short one ("Ho Chi / Minh"); the space after the dot stays outside the box, where the break is. It still
          wraps and is never cut (the ⛔ above holds: no nowrap, no truncate).
          ⛔ NOT DRAWN BELOW md ON THE RENTAL SHEET (owner-approved 2026-11-15 (build 7), cook r07 "rental"): there the same facts are
          split into the quiet line, the row of figures and the Location line (`sheetStats` above); from md this is the line. */}
      {factsLine ? facts.length > 0 && (
        <div data-facts-line="" data-fab-avoid className={cn('text-base text-muted-foreground [overflow-wrap:anywhere]', facts.every((f) => f.phoneOnly) && 'md:hidden', rentalSheet && 'max-md:hidden', goodsSheet && GOODS_FACTS)}>
          {facts.map((f, i) => {
            const tail = factSeps[i] === 'all' ? FACT_SEP : factSeps[i] === 'phone' ? <span className="md:hidden">{FACT_SEP}</span> : null
            if (goodsSheet && f.key !== 'condition') {
              // The dot (no-break space + '·') inside the box, the breaking space after it outside.
              const dot = factSeps[i] === 'all' ? FACT_DOT : factSeps[i] === 'phone' ? <span className="md:hidden">{FACT_DOT}</span> : null
              return <Fragment key={f.key}><span className={cn(GOODS_FACT, f.phoneOnly && 'md:hidden')}>{f.node}{dot}</span>{dot ? ' ' : null}</Fragment>
            }
            return f.phoneOnly
              ? <span key={f.key} className="md:hidden">{f.node}{tail}</span>
              : <Fragment key={f.key}>{f.node}{tail}</Fragment>
          })}
        </div>
      ) : (
        /* A JOB'S META ROW, as it was before batch 89 (the facts line is not the job page's): its place, "Posted" and the
           social proof, each with its glyph — the column gap separates them, no literal '·' (a wrap would strand one).
           A job never had a brand, a condition (⛔ 2026-10-19) or a vehicle spec to print here. */
        /* A linked job below md: 12px under the pay or the employer, 14px in body ink, 18px muted glyphs (JOB_META). */
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground', isJob && JOB_META)}>
          <span data-fab-avoid className="inline-flex min-w-0 items-center gap-1">
            <MapPin className={cn('h-4 w-4 shrink-0 text-ink-4', isJob && JOB_META_GLYPH)} />
            <span className="truncate">{placeName}</span>
          </span>
          {showPosted && (
            <span data-fab-avoid className="inline-flex shrink-0 items-center gap-1">
              <Clock className={cn('h-4 w-4 shrink-0 text-ink-4', isJob && JOB_META_GLYPH)} />
              <span><Tr text="Posted" /> <PostedAgo iso={listing.postedAt} /></span>
            </span>
          )}
          {showProof && <span data-fab-avoid className="flex shrink-0 items-center gap-3 text-xs">{socialProof}</span>}
        </div>
      )}
    </>
  )
  const headTitle = <>{headH1}{headFacts}</>

  /** The Details rows, for the section's table and, on the goods sheet, its phone twin (`detailsTwin`). */
  const detailsRows = (
          <>
            {/* First: who holds the licence (e-Visa, Legal & permits) — verbatim, never translated. */}
            {providerValues && <ProviderLicenceRows subcategorySlug={rawListing.subcategorySlug} values={providerValues} />}
            {[...detailSpecs, ...detailOnlySpecs].map((s) => (
              <div key={s.label} className="flex items-start justify-between gap-4 py-2.5">
                <dt className="text-muted-foreground"><Tr text={s.label} /></dt>
                <dd data-fab-avoid className="text-right font-medium text-foreground">{s.value}</dd>
              </div>
            ))}
            {/* A rental's occupancy rows — max occupants, floor, available from (rental-facts.tsx). */}
            {detailFactRows.length > 0 && <RentalFactRows rows={detailFactRows} />}
            {detailAttrs.map(([k, v]) => {
              // ⛔ ONE LABEL FUNCTION (taxonomy.ts detailRowLabel): this row's label is what the job-text screen reads
              // beside a hiring post's value ("label: value"), so the two cannot drift. A job's text facts carry their
              // own label and are shown verbatim (JOB_TEXT_ATTRIBUTES).
              // ⚠️ THE LABEL AND THE VALUE ARE THE TAXONOMY'S FOR EVERY CATEGORY, IN BOTH LANGUAGES — the
              // facet row carries its own labelVi ("Phòng ngủ"), and a raw key through <Tr> found
              // Vietnamese only where the UI dictionary held that exact casing: it has "Bedrooms", not
              // "bedrooms", so a vi rental PDP printed "bedrooms", "bathrooms" (prod, 2026-09-29).
              // VALUES followed on 2026-10-04 (pdp-02): a vi car hire said "Daily", "Delivered to you",
              // "Automatic" in the server HTML, because only jobs and eSIM went through the option pair.
              // <FacetValue> maps each stored value through the facet (./details-labels.test.tsx).
              // ⚠️ SENTENCE CASE, NOT CSS `capitalize`. Taxonomy and job labels are already written in
              // sentence case ('Apply by', 'eSIM', 'Full-time'), and `capitalize` title-cased every
              // word of them into 'Apply By', 'ESIM', 'Full-Time'. Only a RAW key or value (stored
              // lowercase, no label to borrow) gets its first letter raised — `first-letter:` works
              // here because dt/dd are flex items, which are blockified.
              const { jobText, facet: labelFacet, rawKey } = detailRowLabel(k, { categorySlug: rawListing.category.slug, subcategorySlug: rawListing.subcategorySlug, listingType: listing.listingType })
              const value = Array.isArray(v) ? v.map(String).join(', ') : String(v)
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
                  : labelFacet
                  ? <dd data-fab-avoid className={cn('text-right font-medium text-foreground', facetValueStartsRaw(labelFacet, v) && 'first-letter:uppercase')}><FacetValue facet={labelFacet} value={v} pageLang={pageVariant} /></dd>
                  : <dd data-fab-avoid className="text-right font-medium text-foreground first-letter:uppercase"><Tr text={value} /></dd>}
              </div>
              )
            })}
          </>
  )

  /**
   * DETAILS, rendered in ONE of two places in the description wrapper (slot 8) below: after Description and Amenities (every
   * listing page) or, on the rental sheet, FIRST — Costs, Details, then the words and the amenity grid, the mock's reading
   * order (owner-approved 2026-11-14, cook r05 "rental-c") — with Description and Amenities `md:-order-1` there, so from md
   * the column paints Description, Amenities, Details as before. Details holds nothing focusable; the focus order is the same.
   */
  const detailsSection = (
    <>
      {/* Details: the section hairline below md (batch 79; owner, 2026-11-12: "continue … towards 10/10"; A/B GPT +0.15,
          Opus +0.13; canon §3b, owner 2026-07-24: "lines between elements … almost no boxes"): the note at Description. */}
      {/* ⛔ On the goods sheet this section is not drawn below md: its phone twin (`detailsTwin`) stands under the head there. Nor on
          the rental sheet when its one row is the type a GoPlus title was built from (`detailsPhoneHidden`, build 7). */}
      {showDetails && (
        <div className={cn('space-y-2', goodsSheet || isJob || detailsPhoneHidden ? 'max-md:hidden' : sectionLine(rentalSheet), rentalSheet && SHEET_HEAD_GAP)}>
          <h2 className={SECTION_TITLE}><Tr text="Details" /></h2>
          {/* ⛔ Not below md on a linked job either: its tags (`jobTags`) stand under the head there (owner-approved 2026-11-14, cook r06 jobs). */}
          {/* Spec table: hairline row dividers, muted label / strong value, even row height.
              `data-fab-avoid` on every value: the floating support mark yields (fades) when it
              would sit over one — these right-aligned values run into the corner it rests in,
              and plain text is otherwise never an obstacle (back-to-top.tsx OBSTACLES). */}
          {/* `[overflow-wrap:anywhere]` + a shrinkable VALUE (break-ui, 2026-10-05) — on the dd only: inherited by the
              dt it would lower the label's min-content and split "Dung lượng" mid-word (opus). An imported attribute
              with no spaces ("256GB-ChínhHãngVN/A-KhôngLock") pushed the row past a 320px screen;
              the Seller-information block below already does this (seller-info.tsx). */}
          <dl className={cn('divide-y divide-border text-sm [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]', rentalSheet && SHEET_ROWS)}>
            {detailsRows}
          </dl>
        </div>
      )}
    </>
  )
  /**
   * ⛔ DETAILS ON THE GOODS SHEET, BELOW md (owner-approved 2026-11-14, cook r06 "item"): the listing's key facts right under
   * the head, as label/value rows on hairlines (Wallapop's attribute rows) — the same rows (`detailsRows`), a second <dl>
   * that is display:none from md while the section above is display:none below it, so one table is ever shown and read.
   * Its heading is screen-reader only (the rows name themselves). No ids in it. Rendered in the phone band's slot (`md:hidden`).
   */
  const detailsTwin = goodsSheet && showDetails ? (
    <div className={GOODS_DETAILS_TWIN}>
      {/* Its own words, not "Details" again (Seobility, 2026-11-23: two h2 "Details" in one page's HTML, one always display:none). */}
      <h2 className="sr-only"><Bilingual en="Item details" vi="Chi tiết sản phẩm" /></h2>
      <dl className={cn('[&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]', GOODS_DETAILS_ROWS)}>{detailsRows}</dl>
    </div>
  ) : null

  /**
   * ⛔ A LINKED JOB'S DETAILS AS TAGS, BELOW md (owner-approved 2026-11-14, cook r06 jobs; it reverses there batch 79's hairline
   * section): the same rows (`detailsRows`, so the table and the tags cannot drift), restyled as field-grey "Label: value" tags
   * under the place line (JOB_TAG_ROWS). display:none from md, where the table is shown; the table is display:none below md.
   */
  const jobTags = isJob && showDetails ? (
    <div className={JOB_TAGS}>
      <h2 className="sr-only"><Bilingual en="Job details" vi="Chi tiết công việc" /></h2>
      <dl className={JOB_TAG_ROWS}>{detailsRows}</dl>
    </div>
  ) : null
  /**
   * ⛔ A LINKED JOB'S HEAD BELOW md (owner-approved 2026-11-14, cook r06 jobs; src/lib/job-sheet.ts): the role with Share (and the
   * owner's Edit) on its first line — both wrappers `md:contents`, so from md the H1 and its note are the header block's flex items
   * they are today — then the employer, once, as a link with the kept counsel line under it (the phone band is not drawn for a
   * job). The md+ storefront row in the buy box is unchanged.
   */
  const jobTitleLine = isJob ? (
    <>
      <div className={JOB_TITLE_LINE}>
        <div className={JOB_TITLE_CELL}>{headH1}</div>
        <div className={JOB_TITLE_ACTIONS}>
          <ShareButton url={canonicalUrl} title={displayTitle} shape="round" />
          <OwnerEditButton listingId={listing.id} sellerId={listing.seller.id} />
        </div>
      </div>
      <PdpShopLink name={listing.seller.name} avatarColor={listing.seller.avatarColor} avatarUrl={listing.seller.avatarUrl} isBusiness={listing.seller.isBusiness} businessVerified={sellerBusinessVerified} officialPartner={listing.seller.officialPartner} href={sellerHref} metrics={sellerMetricsBundle} linked={linkedSeller} partnerListingCount={partnerListingCount} unrated={sellerUnrated} linkedShop={sellerLinkedShop} head className={JOB_EMPLOYER} />
    </>
  ) : null

  /** The Location section (slot 11; slot 8 on the rental sheet): rendered in ONE of two DOM places below — the notes inside. */
  const locationSection = showMap ? (
    <>
      {/* 11 — Map. Not on a linked job or a partner row without a stored coordinate: the map would
          pin a city centroid (±1km jitter, geo.ts getListingCoordinates) that is not the item's
          place — an eSIM or a shop's phone 'in District 1'. When there is no map, render NOTHING:
          the facts line under the title already names the place (or the title does), so a
          text-only Location section would only repeat it. A seller's own listing keeps its map
          as before, district-level or not. Below md it opens on the section hairline (batch 79; owner, 2026-11-12:
          "continue … towards 10/10"; A/B GPT +0.15, Opus +0.13; canon §3b, owner 2026-07-24: "lines between elements …
          almost no boxes"; the note at Description). */}
      {/* ⛔ ON THE RENTAL SHEET, SLOT 8 (owner-approved 2026-11-14, cook r05 "rental-c"; it reverses there the 2026-11-10 "slot 9
          … before the reviews (10) and the map (11)"): below md the map comes BEFORE the safety well — and since build 7
          (owner-approved 2026-11-15 (build 7), cook r07 "rental"; it reverses r05's "Costs, Details, Amenities and Location") right
          after Costs: its DOM is the left column's first section on the sheet (`{rentalSheet && locationSection}`, before the
          Description wrapper), so a phone's DOM order is its paint order there. From md it paints exactly as before (`md:order-11`:
          after the Description wrapper and Seller information, before the `order-12` notes); a keyboard there now meets the map
          before the description's controls. ⚠️ The safety block still lives in the buy box (it must exist once — the note there),
          so below md "Open map" paints above the safety links it follows in the focus order, as before. Heading → content 16px;
          under the heading the listing's place (`placeOnMap`, moved from the head's facts), 8 over the map; the box a 384px card
          with "Open map" as its footer row — until 2026-11-24, when the owner asked for one map look everywhere (below). */}
      {/* The goods sheet: no line, 32px over it, the 17px heading, the map on the media edge (GOODS_MAP_BOX). */}
      <div id="location-on-map" className={cn(rentalSheet ? 'order-8 md:order-11' : 'order-11', 'space-y-2 scroll-mt-20', goodsSheet ? GOODS_SECTION : sectionLine(rentalSheet), rentalSheet && SHEET_HEAD_GAP, goodsSheet && 'max-md:space-y-3')}>
        <h2 className={goodsSheet ? GOODS_SECTION_TITLE : SECTION_TITLE}><Tr text="Location" /></h2>
        {placeOnMap && <p data-sheet-place="" className={SHEET_PLACE}>{placeName}</p>}
        {approxArea && (
          <p data-map-approximate className={cn('text-xs text-muted-foreground', rentalSheet && 'max-md:text-sm', goodsSheet && GOODS_NOTE)}>
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
        <div className={cn("relative h-[260px] overflow-hidden rounded-2xl after:pointer-events-none after:absolute after:inset-0 after:z-[500] after:rounded-[inherit] after:border-2 after:border-ring after:opacity-0 after:content-[''] has-[:focus-visible]:after:opacity-100", goodsSheet && GOODS_MAP_BOX)}>
          {/* ⛔ ONE MAP LOOK ON EVERY LISTING PAGE (owner, 2026-11-24, of the rental page's phone map: "why some pages have this
              kinda map make it consistent all across the app our style"): the rental sheet no longer draws its own map card
              (Voyager tiles, ink pin, "Open map" footer — `look="sheet"`, builds 5–7); it gets the app's light map, brand pin
              and area, as every other listing does. */}
          <ListingDetailMap listings={[listing]} activeDistrict={listing.district || 'all'} approximate={approxArea} />
        </div>
      </div>
    </>
  ) : null

  // `#contact`'s element: the pinned tier (a client PinnedRegion, which publishes its height) or the plain block.
  const ContactBlock: ElementType = pinned ? PinnedRegion : 'div'

  return (
    <div className="flex min-h-page flex-col blob-bg">
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

      {/* The first paint waits for the buy box, the last of the first screen: see the note in (home)/layout.tsx. On a phone the page's parts arrived a packet at a time and slid under each other. */}
      <link rel="expect" href="#contact" blocking="render" />
      <Header />

      {/* No bottom clearance here on purpose. This page used to reserve 4rem on the ROOT for
          a fixed mobile action bar; that bar is gone, and <BottomNavSpacer/> already reserves
          the tab bar's 4.5rem globally — so the old padding just left a dead band above it. */}
      {/* ⛔ A SELLER THE VIEWER BLOCKED IS NOT SHOWN (App Store 1.2; src/lib/hidden-sellers.ts): the hidden-shops
          stylesheet hides <main> by its `data-sid` and shows this notice in its place — before first paint on a reload,
          the moment Block answers on a tap. The page itself stays one cached render for everyone. */}
      {appReviewGate('ugc-safety') && <BlockedSellerNotice sellerId={listing.sellerId} kind="listing" className="flex-1" />}
      <main id="main" tabIndex={-1} data-sid={listing.sellerId} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-8 lg:pb-12">
        {/* ⛔ THE LISTING'S ACTION, PINNED ONCE ITS BUTTON HAS SCROLLED AWAY (owner, 2026-11-10: item 1 of the decision scorecard;
            pdp-action-bar.tsx has the record and the terms). Inside <main data-sid>, so a blocked shop's page hides it with
            everything else. It mirrors whatever control `#contact` holds for this reader and renders nothing when there is
            none. The price is the buy box's figure in the tiles' short form ("12M đ / month"), with the buy box's "from" on a
            partner booking; a job with no figure has none to show — its bar reads "Apply ↗" beside "Source: <board>" (batch 95,
            owner-approved 2026-11-14, decision 3; it took the whole row before), pdp-action-bar.tsx.
            ⛔ `rateCompactAbove`, NOT the cards' `cardCompactAbove` (batch 94, owner-approved 2026-11-14): cards and rows now
            print a sale price in millions; this page keeps every digit of one, the bar included. Its price is not `native`,
            so <Price>'s sr-only full figure never renders here: the bar's DOM is what it was. */}
        <PdpActionBar price={listing.listingType === 'job' && listing.price === 0 ? undefined : (
          <>
            {affiliateUrl && isBooking ? <span className="text-sm font-medium text-body"><Tr text="from" /> </span> : null}
            {/* ⛔ The rental sheet's bar (owner-approved 2026-11-14, cook r05 "rental-c"): below md "≈ $" stands on its own line under
                the figure, where the title caption is hidden (`titleCaption="md"`); from md it is the same inline ≈ `dual="sm"` prints
                (SHEET_BAR_*, src/lib/rental-sheet.ts). Since build 7 (owner-approved 2026-11-15 (build 7)) a rental whose action is
                pinned never shows this bar below md (`pinned`): its tier carries the full price beside Chat now instead. */}
            <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} listingType={listing.listingType} compact compactAbove={rateCompactAbove(listing)} dual={rentalSheet ? true : 'sm'} className={rentalSheet ? SHEET_BAR_PRICE : 'text-lg leading-6'} unitClassName={rentalSheet ? SHEET_BAR_UNIT : undefined} approxClassName={rentalSheet ? SHEET_BAR_APPROX : undefined} />
          </>
        )} titleCaption={rentalSheet ? 'md' : 'always'} pinned={pinned} />
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
        {/* The rental sheet: 32px block to block below md (SHEET_GRID_GAP; src/lib/rental-sheet.ts). */}
        <div className={cn('flex flex-col gap-6 md:grid md:grid-cols-12 md:gap-x-6 md:gap-y-6 lg:gap-x-10 lg:gap-y-8', rentalSheet && SHEET_GRID_GAP)}>

          {/* The compact storefront link, MOBILE, is in the buy box since 2026-11-14 — right after the market price, in the DOM
              where it paints (the note there). */}

          {/* 1 — Breadcrumb (subdued, full width): site / category / subcategory / title. Leaf crumb
              hidden on mobile (it duplicates the H1); the BreadcrumbList JSON-LD still carries it. */}
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
              shop link, the costs and the safety note: equal `order` falls back to DOM order, so they
              stack in source order with no further number to find. ⛔ Not lower (tried 2026-11-05): with
              the costs and the note in the buy box that sent focus a screen down and back.
              ⚠️ `lg:order-1` keeps it FIRST on desktop, where it sits full-width above the grid and
              the fold problem does not exist. And the BreadcrumbList JSON-LD is emitted separately, so
              the position here is presentation only — Google still gets every level. */}
          {/* ⚠️ `-my-3 py-3`: the crumbs below were 39x17 and 49x17 with no press state, and their
              `tap-44` hit areas need 44px of room — but `truncate` makes this nav `overflow:hidden`,
              which would clip them back to the 20px line. The padding gives the clip box its 44px and
              the negative margin hands the space straight back, so nothing on the page moves. */}
          {/* The landmark's name follows the visitor's language (ui/localized-nav); `data-crumb-trail` is what
              globals.css hides in the native app — never the label, which is no longer English everywhere. */}
          {/* ⛔ NOT BELOW md AT ALL SINCE UI CLIMB BATCH 90 (2026-11-14; owner 2026-11-13: "reduce lines … super clean, minimal
              wording, only what's necessary"; blind A/B on live eno.vn, Opus +0.14/+0.12, GPT +0.17, trust ±0). On a phone it
              painted mid-page, under the seller and over Costs/Description ("nobody navigates a phone by breadcrumb", above; the
              judge: "the breadcrumb sits in odd places"). `max-md:hidden`, as batch 64 hid /c's crumb (`max-sm:hidden`) and the
              native app already hides this one. What it served stays: the BreadcrumbList JSON-LD (Google gets every level), Back's
              category fallback (pdp-back-button.tsx, which never read this nav), and md and up, where it is row 1 as before. Hidden,
              it is out of the phone's tab order too, so the `order-7` focus-order note above has nothing left to protect there;
              `order-7` stays only so md+ markup is byte-for-byte what it was. */}
          <LocalizedNav label="Breadcrumb" labelVi="Đường dẫn" data-crumb-trail="" className="order-7 -my-3 truncate py-3 text-sm text-muted-foreground max-md:hidden md:order-1 md:col-span-12">
            {/* prefetch={false} on every crumb: they sit above the fold on every PDP, so auto
                prefetch fires extra RSC requests per listing view for links most visitors
                never take (the way back is the tab bar or the browser's back button). */}
            {/* ⛔ THE ROOT IS SITE_NAME (NAV-10): "Home" collided with the category named Home ("Home / Home /
                …" on every English furniture listing), and a literal would name eno.vn on eno.forum. */}
            <Link href={localizedHref('/', pageVariant)} prefetch={false} className="relative tap-44 transition-colors hover:text-accent-foreground active:opacity-60">{SITE_NAME}</Link>
            <span className="mx-1.5 text-line-strong">/</span>
            <Link href={localizedHref(categoryBrowsePath(rawListing.category.slug), pageVariant)} prefetch={false} className="relative tap-44 transition-colors hover:text-accent-foreground active:opacity-60"><Bilingual en={listing.category.name} vi={listing.category.nameVi || listing.category.name} /></Link>
            {/* The subcategory (NAV-10): a car or motorbike hire listing in HCMC goes up to its hub, anything
                else to the explorer filtered to category + subcategory — `nofollow` there, like every explorer
                link on /c (it canonicalises to `/`); the hub is a page to rank, so it is followed. */}
            {subcategory && (
              <>
                <span className="mx-1.5 text-line-strong">/</span>
                <Link href={localizedHref(subcategory.href, pageVariant)} prefetch={false} rel={subcategory.hub ? undefined : 'nofollow'} className="relative tap-44 transition-colors hover:text-accent-foreground active:opacity-60"><Bilingual en={subcategory.name} vi={subcategory.nameVi || subcategory.name} /></Link>
              </>
            )}
            <span className="mx-1.5 hidden text-line-strong md:inline">/</span>
            <span className="hidden font-medium text-foreground md:inline"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={i18n[listing.title]} /></span>
          </LocalizedNav>

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
              from the same 772px budget. (`PdpMobileBar`, which hid the tab bar on this page, was deleted deliberately
              and must not come back; since 2026-11-10 <PdpActionBar> pins the action only in the slot the tab bar has
              already left, on the owner's word. A reader still at the top of the page has neither.
              ⛔ …EXCEPT ON A GOODS PAGE WHOSE ACTION IS ONE CONTROL AND ONE LINE (owner-approved 2026-11-14, cook r06 "item";
              `pinned`, src/lib/goods-sheet.ts pinsAction): there `#contact` itself is the bottom tier from the first paint and the
              tab bar starts retracted until the first scroll up — no second bar, nothing hidden for good.)
              ⚠️ THE ROW ITSELF RENDERS ABOVE THE BREADCRUMB NOW (2026-11-06 audit) — the note there says why. */}

          {/* 2 — Gallery, MOBILE mount: edge-to-edge (negative gutter cancels <main>'s padding),
              md:hidden. Its desktop twin lives in the left column below; the variant gates stop
              the hidden one from fetching images. Share/Save overlay the media (Shopee pattern);
              z-10 stays under the lightbox (z-[100]). */}
          {/* ⛔ NO GALLERY ON A LINKED JOB (owner, 2026-09-30, P-JOB): its one image is the importer's
              generated poster (scripts/import-jobs.ts), which on a PDP spent a full-width square — the
              whole phone fold — on a picture of the words printed below it. Cards keep the poster; the
              PDP opens on the compact job header in the buy box instead (see `isJob` there). */}
          {/* ⛔ FLUSH UNDER THE HEADER (owner, 2026-10-18 — the first screen's photo, like FB Marketplace and Carousell):
              `-mt-4` takes back <main>'s `pt-4`, the 16px strip of page colour that sat between the header and this
              full-bleed square. It is the first block of the phone's order (order-2; nothing above it shows below md),
              and only it pulls up: a page without a gallery (`noGallery`) keeps the padding over its buy box. This one
              wrapper covers both gallery branches — the single photo and the carousel render inside it. */}
          {/* ⛔ ON A PHONE THE PAGE OPENS ON THIS PHOTO, WITH NO SITE HEADER ABOVE IT (owner, 2026-11-10: item 3 of the decision
              scorecard; blind A/B against the header-on-top page: codex 7.32 to 7.55, Fable 7.60 to 7.92). `data-photo-first`
              is the one hook: globals.css hides `#app-header` below md on a page that carries it and shows the Back control
              below, which stands in for the way back the header gave (pdp-back-button.tsx). Only a page with a gallery has
              the hook, so a linked job and a teacher's profile, which have no photo to open on, keep the header. */}
          {/* ⛔ ON THE RENTAL SHEET (owner-approved 2026-11-14, cook r05 "rental-c"): the photo fills its square (ListingGallery
              `sheet`) and a 16px white sheet edge rides over its bottom, the title 24px under it (SHEET_PHOTO,
              src/lib/rental-sheet.ts). The photo stays square-cornered (owner 2026-07-24, kept): only the sheet is rounded. */}
          {/* ⛔ ON THE GOODS SHEET (owner-approved 2026-11-14, cook r06 "item"): the whole photo (ListingGallery `plain`) under the same
              16px sheet edge, the price 16px under it (GOODS_PHOTO, src/lib/goods-sheet.ts) — since build 7 on the field grey, not
              a plain white ground (owner-approved 2026-11-15 (build 7), cook r07 "item"; the note at `plain`). */}
          {!noGallery && (
          <div data-photo-first="" className={cn('relative order-2 -mx-3 -mt-4 sm:-mx-6 md:hidden', rentalSheet && SHEET_PHOTO, goodsSheet && GOODS_PHOTO)}>
            <ListingGallery variant="mobile" images={listing.images} title={galleryTitle} video={listing.video} showAllLabel="View all photos" sheet={rentalSheet} plain={goodsSheet} />
            {/* Back: opposite Share and Save, the same offsets. Its fallback is the listing's category, for a visitor who opened the listing cold.
                `plate-lg` (owner-approved 2026-11-14, cook r05: the white photo plates): Back, Share, Save and Edit pad their
                20px glyphs 6px a side — a 32px white plate inside each 36px button (globals.css, the plate block). */}
            <div className="plate-lg absolute left-3 top-3 z-10 flex items-center">
              <PdpBackButton fallbackHref={localizedHref(categoryBrowsePath(rawListing.category.slug), pageVariant)} />
            </div>
            <div className={cn('plate-lg absolute right-3 top-3 z-10 flex items-center gap-2', goodsSheet && GOODS_PLATES_GAP)}>
              <ShareButton url={canonicalUrl} title={displayTitle} price={listing.listingType === 'job' ? undefined : listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact />
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
              copy column follows); it paints on the RIGHT from md, the LEFT column below on the left.
              `contents` on phones so its children join the single order flow.
              ⛔ ITS CELL IS NAMED, NOT LEFT TO `order` (FAST-10, 2026-10-05). With only `md:order-3`
              the cell was decided by auto-placement, and auto-placement only sees what the parser has
              reached: while the HTML streams, the buy box is the one column in the grid, so it took
              the first free cell — the LEFT one (x≈112 at 1440px) — and jumped to the right (x≈845)
              the moment the media column below was parsed. CLS 0.19–0.24 on 7 of 8 desktop cold loads,
              the cause of the site's one failing field metric (desktop CLS p75 0.23). `col-start` +
              `row-start` (row 2: the breadcrumb owns row 1) put it in its final cell on the first
              paint, wherever the parser is. The `order-*` classes stay — DOM order, and therefore
              reading and tab order, is unchanged. */}
          {/* ⚠️ NO GALLERY (a job, `noGallery`): THIS IS THE LEFT CELL FROM md (2026-11-06 audit). The left column opened on
              "Details" while the job's title and Apply stood to its right, so a desktop reader met the facts before the job. With no
              photo to lead, the box the DOM already puts first paints first, its hairline on its right edge; Details and Seller
              information take the right cell. Both cells stay named (FAST-10). A page with a gallery is exactly as it was. */}
          <div className={cn('contents md:order-3 md:col-span-6 md:row-start-2 md:block lg:col-span-5', noGallery ? 'md:col-start-1' : 'md:col-start-7 lg:col-start-8')}>
            {/* ⚠️ STICKY STAYS lg-ONLY. At 768-1023 and in landscape the buy box (strip, reviews) is
                taller than the viewport, and a sticky column would park its lower half out of reach. */}
            <div className={cn('contents md:flex md:flex-col md:gap-4 md:border-border/70 lg:sticky lg:top-24', noGallery ? 'md:border-r md:pr-6 lg:pr-10' : 'md:border-l md:pl-6 lg:pl-10')}>

              {/* 3 — HEADER BLOCK: price (the anchor) → title → metadata, kept tight (gap-2) so the
                  three read as one cohesive unit. Price is the largest, boldest text on the page.
                  ⛔ On a linked job below md: role (+ Share) → employer → pay → place → tags (owner-approved 2026-11-14, cook r06
                  jobs; it reverses P-HIER there — the role is the page's one display line, a pay follows at 22; job-sheet.ts).
                  ⛔ On the rental sheet below md: title → metadata → price (owner-approved 2026-11-14, cook r05 "rental-c"; the
                  note at `headTitle`). */}
              {/* The goods sheet: 4px between the head's lines below md (GOODS_HEAD). */}
              <div className={cn('order-3 flex flex-col gap-2', goodsSheet && GOODS_HEAD)}>
                {/* THE COMPACT JOB HEADER (owner, 2026-09-30, P-JOB): with no poster gallery on a linked
                    job, Share / Save / Edit lose the photo they were overlaid on, so they sit here in
                    their labelled (non-overlay) form, beside a plain 'Job posting' kicker. The overlay
                    variants are white ink for photos and would vanish on the page ground. */}
                {/* ⛔ md+ ONLY ON A LINKED JOB (owner-approved 2026-11-14, cook r06 jobs; it reverses P-JOB's kicker row there): below md
                    Share rides the role's line and Save stands beside Apply (JOB_HEADER); from md, first, as before. */}
                {noGallery && (
                  <div data-job-header className={cn('flex items-center justify-between gap-2', isJob && JOB_HEADER)}>
                    {listing.listingType === 'job' ? <Badge size="md" className="font-semibold text-body">{tr('Job posting', 'Tin tuyển dụng')}</Badge> : <span />}
                    <div className="flex items-center gap-1">
                      {/* The border matches the labelled Save beside it (its own base has one; Share's does not). */}
                      <ShareButton url={canonicalUrl} title={displayTitle} className="border border-border" />
                      <SaveListingButton id={listing.id} />
                      <OwnerEditButton listingId={listing.id} sellerId={listing.seller.id} />
                    </div>
                  </div>
                )}
                {/* The rental sheet's title and facts lead the block (`headTitle`, above `return`); the price row follows them. */}
                {rentalSheet && headTitle}
                {/* A linked job: the role's line and the employer lead the block below md (`jobTitleLine`); its pay row follows them
                    and is `md:order-first` (JOB_PRICE_ROW), so from md the block paints job header → price → title → facts as before. */}
                {jobTitleLine}
                {/* Not rendered at all for a linked job with nothing to show in it (`priceBlock`, batch 95). */}
                {priceBlock && (
                <div className={cn('flex flex-col gap-1.5', rentalSheet && SHEET_PRICE_ROW, goodsSheet && GOODS_PRICE_ROW, isJob && JOB_PRICE_ROW)}>
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
                        same without pretending to be a figure. ⛔ A LINKED job says nothing here since batch 95
                        (owner-approved 2026-11-14): its Apply button already points at the posting, and the block
                        is not rendered at all unless an urgent flag or a drop stands in it (`priceBlock`). */}
                    {/* ⚠️ AN EMPLOYER'S OWN JOB AT PRICE 0 WITH A SALARY is a row stored before the salary rule
                        (taxonomy.ts paysSalary derives price = salaryM × 1,000,000 on every write since):
                        its salaryM IS the salary (unlike a linked job's, which is a range's floor), so it is
                        shown as one rather than called negotiable. */}
                    {listing.listingType === 'job' && listing.price === 0 && !isJob && (rawListing.salaryM ?? 0) > 0
                      ? <Price price={salaryPriceFor(rawListing.salaryM)} currency={listing.currency} priceUnit="VND/month" className="text-3xl tracking-tight" approxClassName="text-base" listingType={listing.listingType} />
                      : listing.listingType === 'job' && listing.price === 0
                      ? (typeof listing.attributes?.salaryText === 'string' && listing.attributes.salaryText.trim()
                          ? <span className={isJob ? JOB_SALARY_TEXT : 'text-2xl font-bold tracking-tight text-price [overflow-wrap:anywhere]'}>{listing.attributes.salaryText}</span>
                          : isJob
                            ? null
                            // An employer's own job with no salary: the post wizard frames an empty
                            // Salary as "Negotiable / Thỏa thuận" (owner, 2026-10-01), so that is
                            // what the employer chose — said in the job boards' own word.
                            : <span className="text-base font-semibold text-body"><Bilingual en="Salary: negotiable" vi="Lương: thỏa thuận" /></span>)
                      // The rental sheet's price: 22/28, its unit and "≈ $" at body size below md; today's 30px from md.
                      // The goods sheet's: the page's one display element, 32/40 (`text-t-figure`), the same unit and "≈ $" (owner-approved
                      // 2026-11-14, cook r06 "item"); today's 30px from md.
                      // A linked job's stated pay: the section role (22/28) below md, today's 30px from md (JOB_PRICE).
                      : <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} className={rentalSheet ? SHEET_PRICE : goodsSheet ? GOODS_PRICE : isJob ? JOB_PRICE : 'text-3xl tracking-tight'} approxClassName={rentalSheet || goodsSheet ? SHEET_PRICE_APPROX : isJob ? JOB_PRICE_APPROX : 'text-base'} unitClassName={rentalSheet || goodsSheet ? SHEET_PRICE_UNIT : undefined} listingType={listing.listingType} />}
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
                          {/* A job is HIRING: the same flag reads "Tuyển gấp", never "Bán gấp" (card-badges.tsx). */}
                          <Zap className="h-3 w-3 fill-current" /> {listing.listingType === 'job' ? tr('Urgent hiring', 'Tuyển gấp') : <Tr text="Urgent" />}
                        </Badge>
                      </LiveUntil>
                    )}
                    {/* "Fixed price" and the phone's deposit are facts in the line under the title now (batch 89 — `facts`). */}
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
                )}

                {/* The rental sheet's phone facts (build 7; `sheetStats` above, SHEET_FACTS in src/lib/rental-sheet.ts): the quiet line
                    4px under the price, then the row of figures between hairlines. Each figure and its label are the picture of one
                    fact; a screen reader hears that fact in the facts line's own words (the sr-only node). Display:none from md. */}
                {sheetQuiet.length > 0 && (
                  <p data-sheet-facts="" data-fab-avoid className={SHEET_FACTS}>
                    {sheetQuiet.map((f, i) => <Fragment key={f.key}>{f.node}{i < sheetQuiet.length - 1 ? FACT_SEP : null}</Fragment>)}
                  </p>
                )}
                {sheetStats.length > 0 && (
                  <ul data-sheet-stats="" className={cn(SHEET_STATS, sheetStatCols(sheetStats.length))}>
                    {sheetStats.map((st) => (
                      <li key={st.key} className={SHEET_STAT}>
                        <span aria-hidden className={SHEET_STAT_VALUE}>{st.value}</span>
                        <span aria-hidden className={SHEET_STAT_LABEL}>{st.label}</span>
                        <span className="sr-only">{facts.find((f) => f.key === st.key)?.node}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {!rentalSheet && !isJob && headTitle}
                {/* A linked job: place and posted, then the Details' phone tags (`jobTags`). */}
                {isJob && headFacts}
                {jobTags}
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
              {/* `data-no-pin`: an e-visa listing's action follows its disclaimer and is never mirrored by the pinned bar (pdp-action-bar.tsx). */}
              {/* The rental sheet: Chat now 16px under the head below md (SHEET_CONTACT) — in flow only; pinned, it is the tier. */}
              {/* ⛔ THE GOODS SHEET'S PINNED TIER (owner-approved 2026-11-14, cook r06 "item"; `pinned`): the same block, the same DOM
                  place (after the facts line, before the seller — the reading and Tab order), rendered by PinnedRegion with
                  `data-pin-action` and PIN_TIER's classes, which fix it at the bottom edge below md outside the store apps; it
                  publishes its height for the spacer after the footer. Every other page: the in-flow block, as before.
                  ⛔ Since build 7 (owner-approved 2026-11-15 (build 7), cook r07 "item") the goods tier below md is the control ALONE —
                  its line is said once in the page (`tierLine`); no fade over it (owner, 2026-11-15: "without weird haze"). */}
              <ContactBlock id="contact" data-pin-action={pinned ? '' : undefined} data-no-pin={isVisaProduct || isVisaProductSlot(catSlug, rawListing.subcategorySlug) ? '' : undefined} className={cn('order-6 scroll-mt-24', rentalSheet && !pinned && SHEET_CONTACT, pinned && PIN_TIER)}>
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
                  // ⛔ A linked job: Save beside Apply below md (owner-approved 2026-11-14, cook r06 jobs; JobApplyRow — outside the guard).
                  ? <JobApplyRow job={isJob} save={<SaveListingButton id={listing.id} shape="square" className="md:hidden" />}><JobApplyGuard applyBy={jobApplyBy}>
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
                        applyByYear={applyByYear}
                        /* The site Apply opens, under the button (best-practice gap 2026-11-10), on the deadline's line (batch 95). */
                        host={isJob && affiliateUrl ? hostOf(affiliateUrl) : null}
                        /* The goods tier's own copy of the line is not drawn below md: the page says it once (`tierLine`, build 7). */
                        provenance={provenance ? <ImportProvenance kind={provenance.kind} site={provenance.site} iso={provenance.iso} href={affiliateUrl} className={tierLineInPage ? 'max-md:hidden' : undefined} /> : null}
                        lang={pageVariant}
                        pinned={pinned}
                      />
                    </JobApplyGuard></JobApplyRow>
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
                      {/* eno.vn: @/lib/visa-provider is stubbed (next.config.ts), so the block above renders null there —
                          this one names the seller, says who eno.vn is not, and links the official portal. */}
                      {!IS_SERVICES && <VisaPartnerNote partner={listing.seller.name} />}
                      {/*
                        ⛔ THE CTA COMES AFTER THE DISCLAIMER, NOT BEFORE IT. Rendered first, "Apply
                        in chat" sat above the fold with the disclosure below it — a mobile buyer
                        could start the order without the disclaimer ever being on screen, which is
                        the same failure as hiding it (codex, on the diff, 2026-09-10).
                      */}
                      <IosAppHidden when={iosHideContact}><VisaStart listingId={listing.id} className="mt-4 w-full" /></IosAppHidden>
                    </>
                  : <>
                    {/* Any other seller's e-Visa listing (owner, 2026-10-14: the subcategory is open to every poster, live
                        after a licence check): who the site is not, and the official portal. The desk's page carries its
                        own disclosure in the branch above, so this never doubles it. */}
                    {isVisaProductSlot(catSlug, rawListing.subcategorySlug) && <EVisaSellerNote seller={listing.seller.name} className="mb-4" />}
                    <IosAppHidden when={iosHideContact}><ContactComposer
                      listingId={listing.id}
                      listingTitle={displayTitle}
                      listingTitleVi={listing.titleVi}
                      listingTitleI18n={i18n[listing.title]}
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
                      /* A partner shares no number (phoneForSeller) — the footnote must not offer one. */
                      sellerIsPartner={listing.seller.officialPartner}
                      pinned={pinned}
                      /* The goods tier is the button alone below md; its line is the seller band's last line (`tierLine`, build 7). */
                      lineInPage={tierLineInPage}
                      /* ⛔ The rental sheet's tier (owner-approved 2026-11-15 (build 7), cook r07 "rental"): the head's price beside Chat now,
                         every digit, its unit and "≈ $" under it (SHEET_TIER_*, src/lib/rental-sheet.ts). */
                      barPrice={pinned && rentalSheet ? <Price price={listing.price} currency={listing.currency} priceUnit={listing.priceUnit} listingType={listing.listingType} className={SHEET_TIER_PRICE} unitClassName={SHEET_TIER_UNIT} approxClassName={SHEET_TIER_APPROX} /> : undefined}
                    /></IosAppHidden>
                    </>}
                {iosHideContact && <VisaInAppNote kind="apply" className="ios-app-only mt-4" />}
                {/* The availability check (owner, 2026-09-25): add this rental to the basket the eno team
                    checks for free. Under whichever contact block rendered above — a partner rental still
                    gets the check. `status === 'active'` is already true here (sold returned early), and
                    it is repeated so this line does not depend on that. ⚠️ A NARROW PROP, NOT `listing`:
                    this is a client component, so whatever it is handed is serialised into the page's
                    RSC payload a second time, description and all. */}
                {/* ⚠️ NOT ON VEHICLE HIRE (2026-10-01): a car or motorbike PDP showed this housing check —
                    rentalCheckApplies is the one gate (src/lib/rental-check/shared.ts). ⛔ NOR ON A CHAT-ONLY
                    PARTNER'S LISTING (2026-10-19, `chatOnlyPartner` above): the button AND its "Free service" line
                    go — the partner answers availability in its own chat, the CTA above. */}
                {rentalCheckApplies(rawListing.category.slug, rawListing.subcategorySlug, chatOnlyPartner) && listing.status === 'active' && (
                  <RentalCheckToggle
                    variant="pdp"
                    listing={{
                      id: listing.id,
                      sellerId: listing.sellerId,
                      subcategorySlug: rawListing.subcategorySlug,
                      seller: { chatOnlyPartner },
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
              </ContactBlock>

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
                  <MarketPrice price={listing.price} band={priceBand} href={priceBand.basis === 'model' && modelSlug ? modelPagePath(modelSlug, pageVariant) : undefined} />
                </div>
              )}

              {/* The compact storefront link, MOBILE (its history is the note under the breadcrumb). Slot 7, below `#contact`.
                  ⚠️ IN THE DOM WHERE IT PAINTS, SINCE 2026-11-14 (cook r05; owner-approved "after this cook round build all best
                  options and deploy"): it stood at the top of the grid only to beat the breadcrumb's order-7 tie (2026-11-06 audit),
                  and the crumb has not been drawn below md since batch 90. Here, after `#contact` and the market price, a phone's
                  DOM order is its paint order — Chat now, the seller it answers for, the costs. It is display:none from md, so the
                  grid's named cells (FAST-10) and md+ are untouched; the paint slot is the same `order-7`. */}
              {/* THE "HOSTED BY" BAND ON A PHONE (UI climb batch 79; owner, 2026-11-12: "continue the ui ux improvement towards
                  10/10"; blind A/B on live eno.vn, GPT 7.56 → 7.71, Opus 7.61 → 7.74, trust ±0): one hairline over the row and 16px
                  to it, the canon's §3b section line (owner, 2026-07-24: "lines between elements … almost no boxes"), as Airbnb
                  frames its host row. ⛔ ONE LINE, OVER IT ONLY: the band closes on the next section's own line (Costs or
                  Description) — a second line under the row put the breadcrumb between two hairlines ~60px apart, which read as noise
                  (the mock's first round). Since batch 90 the crumb is not drawn below md, so the band holds the host row alone; the
                  rule stands: still no line under it. Below md only (`max-md:`); nothing moves.
                  ⛔ …EXCEPT ON THE RENTAL SHEET (owner-approved 2026-11-14, cook r05 "rental-c"; it reverses this band there): no line
                  over the seller — since build 7 (owner-approved 2026-11-15 (build 7), cook r07 "rental"; it reverses there the r05
                  bordered, raised HOST CARD) a FLAT HOST ROW (PdpShopLink `variant="card"`) 32px under the head's row of figures,
                  whose hairline closes the head; Costs opens on its own hairline under it (HOST_CARD_SLOT; src/lib/rental-sheet.ts). */}
              {/* ⛔ …AND ON THE GOODS SHEET (owner-approved 2026-11-14, cook r06 "item"): Details' phone twin first (`detailsTwin`, rows on
                  hairlines under the head), then the seller as ONE compact band (PdpShopLink `variant="band"`) under a hairline — the
                  table's own bottom line, or the band's when there is no table (GOODS_BAND; src/lib/goods-sheet.ts).
                  Since build 7 (owner-approved 2026-11-15 (build 7), cook r07 "item") the pinned tier's line is the band's last line
                  where Seller information does not hold it (`tierLine`, PdpShopLink `caption`). */}
              {/* ⛔ Not on a linked job (owner-approved 2026-11-14, cook r06 jobs): its employer line is under the role (`jobTitleLine`). */}
              {!isJob && (
              <div className={rentalSheet ? HOST_CARD_SLOT : goodsSheet ? GOODS_BAND : HOST_BAND}>
                {detailsTwin}
                <PdpShopLink name={listing.seller.name} avatarColor={listing.seller.avatarColor} avatarUrl={listing.seller.avatarUrl} isBusiness={listing.seller.isBusiness} businessVerified={sellerBusinessVerified} officialPartner={listing.seller.officialPartner} href={sellerHref} metrics={sellerMetricsBundle} linked={linkedSeller} partnerListingCount={partnerListingCount} unrated={sellerUnrated} linkedShop={sellerLinkedShop} variant={rentalSheet ? 'card' : goodsSheet ? 'band' : 'row'} className={goodsSheet ? (detailsTwin ? 'pt-4' : 'border-t border-border pt-4') : undefined} caption={tierLine} />
              </div>
              )}

              {/* 9 — ONE trust block: the scam warning, with the reports-and-disputes row folded in
                  as its second line (owner, 2026-08-11). The separate order-7 protections row is GONE —
                  the two were adjacent boxes circling the same subject, and the warning is the
                  half that can stop someone losing money, so it keeps the container and the ink.
                  See the notes in safety-strip.tsx and protections-row.tsx for why the merge went
                  in this direction rather than the other.
                  `order-7` (2026-11-05): after the seller and the costs, before the description (slot 8), so a buyer meets the warning
                  while deciding to contact, instead of after the whole listing.
                  ⛔ ON A PHONE IT NOW FOLLOWS THE LISTING'S OWN FACTS: `order-9` below md (owner, 2026-11-10: "also 8 Safety notes
                  after the description do it", item 8 of the decision scorecard). There the page is one column, and this block
                  stood between the costs and the description: a third of the second screen was cautions and a red Report link
                  before the item had been described. Blind A/B: codex 7.25 to 7.47, Fable 7.20 to 7.31, and both took trust
                  down by 0.2 because the deposit warning is met a screen later; the owner was shown that and chose it. Slot 9
                  is after the description, the details and the Decree's seller information (all slot 8) and before the
                  reviews (10) and the map (11). From md the buy box is its own column and nothing moves (`md:order-7`).
                  ⛔ On the rental sheet the map is slot 8 too, so it comes BEFORE this block below md (owner-approved 2026-11-14,
                  cook r05 "rental-c"; the note at the map).
                  ⚠️ ONE STRIP, MOVED BY `order`, NOT A PHONE TWIN: the reports row inside it must exist once on the page
                  (e2e/ci/protections-row.spec.ts counts it, and a second copy once made strict locators throw). The DOM
                  order, which a screen reader follows, is unchanged: costs, this block, then the description. */}
              {/* The storefront link, DESKTOP/TABLET: in the buy box, right under the action it answers for (who am I contacting?),
                    which also lets the photo start level with the price; hidden below md (mobile twin above). */}
              <div className="order-7 hidden md:block">
                <PdpShopLink name={listing.seller.name} avatarColor={listing.seller.avatarColor} avatarUrl={listing.seller.avatarUrl} isBusiness={listing.seller.isBusiness} businessVerified={sellerBusinessVerified} officialPartner={listing.seller.officialPartner} href={sellerHref} metrics={sellerMetricsBundle} linked={linkedSeller} partnerListingCount={partnerListingCount} unrated={sellerUnrated} linkedShop={sellerLinkedShop} />
              </div>

              {/* A RENTAL'S COSTS SIT WITH THE ACTION, as a booking card's fee lines do (Airbnb; 2026-11-05): the deposit and the monthly
                  fees decide a rental, and they were a screen below Chat now while the column beside it stood empty.
                  Batch 89: no Rent row (the headline price says it) and, below md only, no Deposit row when the facts line prints
                  the deposit (`phoneHidden`); a block left with no row below md is hidden there whole — no heading, no hairline. */}
              {/* Below md it opens on the section hairline (batch 79; owner, 2026-11-12: "continue … towards 10/10"; A/B GPT +0.15,
                  Opus +0.13; canon §3b, owner 2026-07-24: "lines between elements … almost no boxes"): the note at Description. */}
              {/* On the rental sheet the sheet's line (a hairline, 32, the heading) and its rows (`sheet`: 44px each). ⛔ It no longer opens
                  on the host card's edge with no line (owner-approved 2026-11-15 (build 7), cook r07 "rental"; reverses r05). */}
              {costRows.length > 0 && <div className={cn('order-7', sectionLine(rentalSheet), costsPhoneHidden.length === costRows.length && 'max-md:hidden')}><RentalCosts rows={costRows} phoneHidden={costsPhoneHidden} sheet={rentalSheet} /></div>}
              {/* THE AREA'S TYPICAL RENT (owner, 2026-11-19: "Add area rent context"; src/lib/area-rent.ts): the rent index's middle
                  half for this home's district, type and band, and where this rent sits — under the costs it is weighed beside. A
                  rental's twin of the goods' Market price (getPriceBand is null for a rental, so a page never shows both). Server HTML. */}
              {areaRent && <div data-area-rent="" className="order-7"><AreaRent rent={areaRent} /></div>}
              {/* ⛔ THE GOODS SHEET'S COUNSEL (owner-approved 2026-11-14, cook r06 "item"; it reverses there batch 70's "Report kept
                  red"): Report and Block quiet muted labels (COUNSEL_*, src/lib/goods-sheet.ts). ⛔ WITHOUT THE BOX SINCE BUILD 7
                  (owner-approved 2026-11-15 (build 7), cook r07 "item"; it reverses r06's "one quiet tint panel on the media edge" the
                  well closed, and batch 70's tint well there): an ordinary section on the 12px text edge, 16px under Seller information
                  (`-mt-2` over the column's `gap-6`) or 32 under whatever precedes it alone; the shield hangs on the edge, the words
                  run 28 in, "Reports & disputes" and the guide / Report / Block row hang back to the edge (SafetyStrip `flow`,
                  ProtectionsRow `accent`). Every word stays. Its DOM place is unchanged: one strip, moved by order (owner 2026-11-10). */}
              {/* ⛔ A LINKED JOB'S COUNSEL PANEL (owner-approved 2026-11-14, cook r06 jobs; it reverses there batch 70's well and batch 79's
                  Seller-information hairline): below md this block IS the panel (JOB_COUNSEL) — Seller information's phone copy first
                  (its left-column copy is `max-md:hidden` on a job), then the advice in the quiet voice. DOM order = the order on screen. */}
              <div data-safety-block="" className={cn('order-9 md:order-7', goodsSheet && (sellerInfoShown ? COUNSEL_WELL_JOINED : COUNSEL_WELL_ALONE), isJob && JOB_COUNSEL)}>
                {isJob && sellerInfo && <SellerInfo info={sellerInfo} labelId="seller-info-job" panel className={JOB_COUNSEL_INFO} />}
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
                {/* ONE SAFETY CARD ON A PHONE (UI climb batch 70, 2026-11-12; blind A/B on live pages, Report kept red: +0.10 GPT /
                    +0.15 Opus, trust +0.2 / +0.3): below md the warning, the reports-and-disputes row, the guide link and Report /
                    Block sit in one `tint` well (canon §3b allows a tint well for content that must sit apart) instead of loose
                    lines; its PLACE is unchanged — after the details, above the map (order-9). md and up keep the flat buy-box line
                    (the 2026-11-05 rule beside the CTA). Block reads in ink-4 there, chosen when muted-foreground was 4.35:1 on tint;
                    since 2026-11-12 muted is #595959, 6.42:1 on tint, and ink-4 (5.68:1) stays as the quieter of the two.
                    Measured in a browser (2026-11-12): on the well, light — line 16.4, guide 5.2, Report 5.9, Block 5.7:1; dark —
                    13.3, 6.8, 5.5, 5.8:1.
                    ⛔ Not on the goods sheet (owner-approved 2026-11-14, cook r06 "item"; and with no well at all since build 7,
                    owner-approved 2026-11-15 (build 7), cook r07 "item"): its unboxed counsel, the note on the wrapper. */}
                {/* ⛔ THE RENTAL SHEET'S WELL (owner-approved 2026-11-14, cook r05 "rental-c"): the panel recipe (SHEET_WELL) in the
                    quietest voice (`quiet`): the warning regular in body ink — still first, every word — "Reports & disputes" with
                    " — how they work" screen-reader-only (`shortLabel`), and Report and Block as quiet body-ink labels: it reverses
                    "Report kept red" (batch 70; owner 2026-07-08) there only. Every class is max-md:. */}
                <SafetyStrip
                  className={rentalSheet ? SHEET_WELL : goodsSheet ? COUNSEL_STRIP : isJob ? JOB_COUNSEL_STRIP : PAGE_WELL}
                  quiet={rentalSheet || goodsSheet || isJob}
                  flow={goodsSheet}
                  categorySlug={rawListing.category.slug}
                  subcategorySlug={rawListing.subcategorySlug}
                  job={listing.listingType === 'job'}
                  variant={affiliateUrl ? (isJob ? 'affiliate-job' : isBooking ? 'affiliate' : listing.listingType === 'rent' ? 'affiliate-rental' : 'affiliate-purchase') : undefined}
                  protections={affiliateUrl ? undefined : <ProtectionsRow inline shortLabel={rentalSheet || goodsSheet} accent={goodsSheet} />}
                  action={
                    // REPORT AND BLOCK, side by side, on every listing (App Store 1.2 — Apple's 2026-10-28 rejection found
                    // Report without Block). Block names the SHOP and this listing; a shop nobody blockable runs (imported,
                    // partner, eno's own) is blocked as a shop (src/lib/user-blocks.ts). Renders nothing without `ugc-safety`.
                    <span className="flex items-center">
                      {/* 14px from lg, with the strip's text (2026-11-06 audit). The storefront and the chat keep their 12px pair. */}
                      <ReportButton listingId={listing.id} className={rentalSheet ? SHEET_REPORT : goodsSheet ? COUNSEL_REPORT : 'lg:text-sm'} />
                      <BlockUserButton sellerId={listing.sellerId} listingId={listing.id} shopOnly={blockShopOnly} name={listing.seller.name} className={rentalSheet ? SHEET_BLOCK : goodsSheet ? COUNSEL_BLOCK : 'max-md:text-ink-4 lg:text-sm'} />
                    </span>
                  }
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
              follows the buy box in the DOM (reading order) but paints on the LEFT from md, in the cell
              it names (`md:col-start-1 md:row-start-2` — FAST-10, see the buy box above); `contents` on
              phones flattens these into the shared order space. */}
          {/* No gallery (a job): the RIGHT cell from md, beside the buy box (2026-11-06 audit; the note on the buy box). */}
          <div className={cn('contents md:order-2 md:col-span-6 md:row-start-2 md:flex md:flex-col md:gap-6 lg:col-span-7 lg:gap-8', noGallery ? 'md:col-start-7 lg:col-start-6' : 'md:col-start-1')}>
            {/* Gallery, DESKTOP mount (hidden below md; the mobile mount handles small screens). None on a
                linked job — see the mobile mount. */}
            {!noGallery && (
            <div className="relative order-2 hidden md:block">
              <ListingGallery variant="desktop" images={listing.images} title={galleryTitle} video={listing.video} showAllLabel="View all photos" />
              {/* `plate-lg`: the same 32px white plates as the phone's (2026-11-14, owner-approved). */}
              <div className="plate-lg absolute right-3 top-3 z-10 flex items-center gap-2">
                <ShareButton url={canonicalUrl} title={displayTitle} price={listing.listingType === 'job' ? undefined : listing.price} currency={listing.currency} priceUnit={listing.priceUnit} compact />
                <SaveListingButton id={listing.id} compact />
                {/* Owner-only, and it renders nothing for everyone else — see owner-edit-button.tsx.
                    Sits AFTER Save so the control order is identical for every viewer and the shared
                    actions never move because a third one appeared. */}
                <OwnerEditButton listingId={listing.id} sellerId={listing.seller.id} compact />
              </div>
            </div>
            )}

            {/* The rental sheet: Location first (build 7; the note at `locationSection`). */}
            {rentalSheet && locationSection}

            {/* 8 — Description + Details (+ a rental's Costs and Amenities between them). The wrapper renders
                only when one of them does: an empty flex item in this gapped column would still earn a gap. */}
            {/* A linked job below md: its Details are tags under the head, so this holds only the repeat Apply (painted after the
                counsel panel, where its DOM is: `max-md:order-10`) or nothing (`max-md:hidden`). */}
            {/* On the rental sheet, hidden whole below md when the only thing in it is the Details a phone does not draw. */}
            {(showDescription || showDetails || amenities.length > 0) && (
            <div className={cn('order-8 flex flex-col gap-8', goodsSheet && GOODS_SECTION, (order8PhoneEmpty || (detailsPhoneHidden && !showDescription && amenities.length === 0 && !(repeatCta && affiliateUrl))) && 'max-md:hidden', isJob && (repeatCta ? 'max-md:order-10' : 'max-md:hidden'))}>
              {/* Section headers on this page share ONE treatment, SECTION_TITLE (section-title.ts) — the shelves' and
                  the reviews header's below — with more space above (section gap) than below. */}
              {/* …AND, BELOW md, ONE FRAME: A HAIRLINE OVER EVERY SECTION (UI climb batch 79; owner, 2026-11-12: "continue the ui ux
                  improvement towards 10/10"; blind A/B on live eno.vn, GPT 7.56 → 7.71, Opus 7.61 → 7.74, trust ±0). Each section
                  that opens on the SECTION_TITLE h2 — Costs, Description, Amenities, Details, Seller information, Location — wears
                  `max-md:border-t max-md:border-border max-md:pt-6`: the canon's §3b section rule (owner, 2026-07-24: "minimal boxes
                  as much as open borders with lines between elements … almost no boxes"; "Sections → a single border-t
                  border-border + vertical rhythm"), the idiom Reviews already wears (order-10). On the phone's one column they
                  carried spacing only and read as one dense run. No box, no fill, no new element, nothing moves (orders untouched);
                  md and up are unchanged. The shelves below <main>'s grid ('More from this seller', 'More like this') get none:
                  the safety well above them is their boundary. ./section-hairline.test.tsx pins the set.
                  On the rental sheet the line is the same and the step is 32px, heading to content 16 (`sectionLine(true)`,
                  SHEET_HEAD_GAP; owner-approved 2026-11-14, cook r05 "rental-c") — Costs too since build 7 (owner-approved 2026-11-15
                  (build 7)), which no longer opens on a host card.
                  ⛔ ON THE GOODS SHEET, NO LINES (owner-approved 2026-11-14, cook r06 "item"; it reverses batch 79 there): the sections
                  stand 32px apart (this wrapper's, Seller information's and the map's `max-md:mt-2` over the column's 24) under 17px
                  headings (GOODS_SECTION / GOODS_SECTION_TITLE); the seller band keeps its one hairline. */}
              {/* On the rental sheet Details comes first in this wrapper (`detailsSection`): it leads the DOM and the phone's paint. */}
              {rentalSheet && detailsSection}
              {showDescription && (
              <div className={cn('space-y-2', goodsSheet ? GOODS_DESC_SECTION : sectionLine(rentalSheet), rentalSheet && `${SHEET_HEAD_GAP} md:-order-1`)}>
                <h2 className={goodsSheet ? GOODS_SECTION_TITLE : SECTION_TITLE}><Tr text="Description" /></h2>
                {/* max-w-prose caps the reading measure at ~65ch — the col-7 body otherwise runs wide. The sheet reads it 16/24. */}
                <ListingDescription text={listing.description} vi={listing.descriptionVi} i18n={i18n[listing.description]} dropLead={blvckIntros} goods={goodsSheet} className={`max-w-prose space-y-3 text-base leading-relaxed text-body ${rentalSheet ? 'max-md:leading-6 ' : ''}${repeatedFacts}`} />
              </div>
              )}

              {/* A rental's amenities (rental-facts.tsx), right after the words and before the reference table; rendered only when
                  the listing states them. Its monthly bill is in the buy box above. Its section hairline (batch 79; owner,
                  2026-11-12: "continue … towards 10/10"; A/B GPT +0.15, Opus +0.13; canon §3b) is on a wrapper here, as the
                  Costs' is in the buy box: the component stays the bare section. */}
              {/* The rental sheet: two columns of a glyph beside its name (`sheet`, build 7), and back before Details from md (`md:-order-1`). */}
              {amenities.length > 0 && <div className={cn(sectionLine(rentalSheet), rentalSheet && 'md:-order-1')}><RentalAmenities items={amenities} sheet={rentalSheet} /></div>}

              {!rentalSheet && detailsSection}
              {/* P-CTA part B — the partner CTA once more, after the text (see repeatCta). A closed job
                  repeats nothing: the buy box already says so. */}
              {repeatCta && affiliateUrl && (
                <JobApplyGuard applyBy={jobApplyBy} closed={null}>
                  {/* ⛔ Not below md where the action is pinned (owner-approved 2026-11-14, cook r06 "item"; it reverses there P-CTA part B,
                      whose reason — "on a phone there is no sticky bar to fall back on" — no longer holds): two identical buttons. */}
                  <AffiliateCtaRepeat url={affiliateUrl} partnerName={listing.seller.name} booking={isBooking} rental={listing.listingType === 'rent'} job={isJob} className={pinned ? 'max-md:hidden' : undefined} />
                </JobApplyGuard>
              )}
            </div>
            )}

            {/* 8a — A GoPlus room's page on goplus.com.vn, for the GoPlus account and eno's admins only (api/listings/[id]/
                goplus-link decides; owner, 2026-10-30). Its own `order-8` item, like 8b below: it renders nothing for
                everyone else, so it never holds open the section above or earns a gap (commit review, codex + opus). */}
            {(goplusRoom || staffPurchaseLink || rawListing.seller.officialPartner === true) && <GoplusRoomLink listingId={listing.id} className="order-8" />}

            {/* 8b — Seller information (owner, 2026-10-01): right after Description/Details, sharing their
                `order-8` slot so DOM order places it below them on phones too. Renders nothing when there is
                nothing to state (an individual seller, or a business that entered no legal details). Below md its <section> opens
                on the section hairline (batch 79; owner, 2026-11-12: "continue … towards 10/10"; A/B GPT +0.15, Opus +0.13;
                canon §3b, owner 2026-07-24: "lines between elements … almost no boxes"; the note at Description), passed as a
                class so a seller with nothing to state still leaves no stray line. */}
            {/* The goods sheet: the counsel's first section, unboxed since build 7 (COUNSEL_INFO; the safety block's note) — with the
                pinned tier's source line in place of its "Source" row below md where they name the same shop (`provenanceInInfo`). */}
            {/* A linked job: not below md, where its copy opens the counsel panel (the safety block). */}
            {sellerInfo && <SellerInfo info={sellerInfo} className={cn('order-8', goodsSheet ? COUNSEL_INFO : sectionLine(rentalSheet), isJob && 'max-md:hidden')} sheet={rentalSheet} panel={goodsSheet} sourceLine={provenanceInInfo ? counselProvenance('text-sm md:hidden') : undefined} />}

            {!rentalSheet && locationSection}

            {/* 12 — Safety note, in the words that are true for THIS kind of listing. "Meet in a public
                place and inspect the item" was written for P2P goods and was printed on a flat, a
                ticket, an eSIM and a partner's phone alike. None on a partner row: the SafetyStrip's
                partner variant above already states the only true advice there (buy/book/rent on the
                partner's own site), and there is nobody to meet. */}
            {/* A job at a school in the teacher-ranked directory links to what teachers say about it
                (2026-10-04). Renders nothing without a match, and never throws (schoolForJob).
                MARKETPLACE ONLY, like the footer link and the sitemap: on eno.forum it would promote
                the forum's duplicate copy of the directory. */}
            {!IS_SERVICES && listing.listingType === 'job' && (
              <SchoolLinkForJob employer={listing.attributes?.employer} sellerId={listing.sellerId} city={listing.city} className={cn('order-12 flex items-start gap-2 text-sm', isJob && 'max-md:hidden')} />
            )}
            {/* A TEACHING job's reader may be a teacher who would rather be found (owner, 2026-10-12): the profile form's
                door, the line /c/jobs carries (teaching-links.tsx). Both editions — on eno.forum the form is eno.vn's, linked
                directly like /c/jobs' (teacherSurfaceHref): the forum 308s /teachers/* there since 2026-10-20
                (src/lib/teachers/surface.ts), and this <Link> prefetches, so a forum path would cost every view a failed
                cross-origin payload fetch.
                …or a school that is hiring (teacher visibility plan §4 channel 6; copy approved in the plan, 2026-10-18): the
                post form's door, Jobs picked — /c/jobs carries it after the teacher lines too. ONE `order-12` item, so the
                page's gap (24px, 32px from lg) falls around the pair, not between its lines: the two sit 12px apart, the
                rhythm of these lines on /c/jobs (each mt-3), the teacher's first; equal order then paints the safety note
                after it. Both editions — the post form is on both. */}
            {listing.listingType === 'job' && rawListing.category.slug === TEACHER_SEEKING_POST.category && rawListing.subcategorySlug === TEACHER_SEEKING_POST.subcategory && (
              <div className={cn('order-12 space-y-3', isJob && 'max-md:hidden')}>
                <TeacherProfileLink href={teacherSurfaceHref(localizedHref('/teachers/join', pageVariant))} className="mt-0" />
                <PostJobLink href={localizedHref('/post?category=jobs', pageVariant)} className="mt-0" />
              </div>
            )}
            {safetyNote && (
              <p className={cn('order-12 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground', goodsSheet && GOODS_NOTE)}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {safetyNote}
              </p>
            )}
          </div>
        </div>

        {/* More from THIS seller (server-fetched cards) — renders nothing when the
            seller has fewer than two other active listings. Sits above the broader
            same-category shelf so a buyer sees the seller's own range first. */}
        {/* ⛔ ON THE GOODS SHEET (owner-approved 2026-11-14, cook r06 "item"): below sm both shelves are two-column grids at the feed's
            card size (Shelf `phoneGrid`), 32px apart below md — each card on the field tile with "Ad" a plain label since build 7
            (ListingCard `look="tile"`). ⛔ THE SELLER'S OWN ROW FIRST AGAIN, ON EVERY WIDTH (owner-approved 2026-11-15 (build 7),
            cook r07 "item"; it reverses r06's "a seller with exactly two other items closes the page on a phone; their row follows
            More like this", and with it that row's phone twin): one copy, here, in the DOM where it paints. */}
        {/* A linked job (owner-approved 2026-11-14, cook r06 jobs): 32px over each rail below md, and a card naming the page's own
            employer does not repeat it (`hideEmployerNamed`, per card — a job board's rail keeps every other employer). */}
        <SameSellerShelf listings={moreFromSeller} sellerHref={sellerHref} sellerName={listing.seller.name} phoneGrid={goodsSheet} sectionClassName={goodsSheet ? GOODS_SHELF_GAP : isJob ? JOB_SHELF_GAP : undefined} hideEmployerNamed={isJob ? listing.seller.name : undefined} />

        {/* More like this — same-category listings (client-fetched, ISR-safe). Without the seller's own
            rows whenever the seller rail above is showing (it needs two), so the two never repeat a card. */}
        <RelatedListings
          listingId={listing.id}
          categorySlug={rawListing.category.slug}
          subcategorySlug={rawListing.subcategorySlug}
          brandSlug={rawListing.brandSlug}
          excludeSellerId={moreFromSeller.length >= 2 ? listing.sellerId : undefined}
          phoneGrid={goodsSheet}
          sectionClassName={isJob ? JOB_SHELF_GAP : undefined}
        />

        {/* The buyer's own recently-viewed trail (excludes this listing). mt-12 matches the
            two shelves above — the three are bare siblings in main, each owning its own top gap. */}
        <RecentlyViewedRail excludeId={listing.id} sectionClassName="mt-12" />
        {/* ⛔ A LINKED JOB'S QUESTION LINES, LAST ON A PHONE (owner-approved 2026-11-14, cook r06 jobs; /c/jobs and /c/teachers do the
            same after their lists): the `order-12` items above are `max-md:hidden` on a job and this copy is `md:hidden`, so one is
            ever displayed. The school line reads once per render (school-link-for-job.tsx caches it); an empty copy is hidden. */}
        {isJob && (
          <div className={JOB_LINES}>
            {!IS_SERVICES && <SchoolLinkForJob employer={listing.attributes?.employer} sellerId={listing.sellerId} city={listing.city} className="flex items-start gap-2 text-sm" />}
            {rawListing.category.slug === TEACHER_SEEKING_POST.category && rawListing.subcategorySlug === TEACHER_SEEKING_POST.subcategory && (
              <>
                <TeacherProfileLink href={teacherSurfaceHref(localizedHref('/teachers/join', pageVariant))} className="mt-0" />
                <PostJobLink href={localizedHref('/post?category=jobs', pageVariant)} className="mt-0" />
              </>
            )}
          </div>
        )}
      </main>

      <Footer />
      {/* The pinned tier's room at the end of the page (its measured height; PinnedRegion publishes it). Below md outside the
          apps only, where the tier is fixed. */}
      {pinned && <StickyActionBarSpacer className="md:hidden [html.native_&]:hidden" />}

    </div>
  )
}
