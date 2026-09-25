import { isSellerHiddenHere, scopedListingWhere } from '@/lib/edition-scope'
import { SITE_NAME } from '@/lib/edition'
import { VisaDisclosure } from '@/components/marketplace/visa-disclosure'
import { NOT_GOVERNMENT } from '@/lib/visa-provider'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { AlertTriangle, Star, ShieldCheck } from "@/components/ui/icons"
import { db } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { serializeListing, serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { diverseFeedWindow } from '@/lib/feed-window'
import { diversifyBySeller } from '@/lib/feed-diversity'
import { localizeListingTitles } from '@/lib/translate'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Tr } from '@/context/language-context'
import { RichText } from '@/components/marketplace/listing-content'
import { ReportButton } from '@/components/marketplace/report-button'
import { HandleChip } from '@/components/marketplace/handle-chip'
import { ShareButton } from '@/components/marketplace/share-button'
import { storefrontUrl } from '@/lib/storefront-host'
import { storefrontByHandle } from '@/lib/storefront'
import { IS_SERVICES } from '@/lib/edition'
import { Badge } from '@/components/ui/badge'
import { StorefrontSellerCard } from '@/components/marketplace/storefront-seller-card'
import { StorefrontBanner } from '@/components/marketplace/storefront-banner'
import { StorefrontChatButton } from '@/components/marketplace/storefront-chat-button'
import { getVisaShopSeller } from '@/lib/visa-shop'
import { sellerMetrics } from '@/lib/seller-metrics'
import { getEnforcement } from '@/lib/enforcement'
import { isBusinessVerified } from '@/lib/business-verification'

// Shared storefront body — rendered by BOTH the canonical clean-handle URL
// (src/app/[lang]/[handle]/page.tsx → eno.vn/<handle>) and the legacy /sellers/[id] route.
// The handle is the public destination people share, so it's the primary URL; the id
// route redirects to it when a handle exists.

// Single per-request DB read shared by generateMetadata + the page (React cache
// dedupes), so an SEO seller page makes ONE round-trip instead of two.
/**
 * How many listings a storefront renders inline. Enough to fill the grid and its sort tabs;
 * everything beyond it is reachable through search and the category pages, which paginate.
 */
const STOREFRONT_LISTINGS = 60
/**
 * The "More on <site>" grid below a shop's own listings renders a SMALLER first page than the shop
 * does. The shop's 60 are the reason the visitor is here; these are the continuation, so 24 keeps
 * the storefront's HTML from roughly doubling for rows most visitors never scroll to.
 * ⚠️ IT IS ALSO THE pageSize FOR THAT GRID, DELIBERATELY. `loadMore` uses the rendered row count as
 * its next offset, so a first page that does not match the page size leaves a gap or an overlap at
 * the seam — the dedupe would hide the overlap and nothing would hide the gap.
 */
export const OTHER_LISTINGS = 24

export const loadSeller = cache(async (id: string) => {
  /**
   * ⚠️ THE WHOLE STOREFRONT IS REFUSED, NOT JUST ITS GRID. This component backs BOTH public routes —
   * /sellers/[id] and the vanity /[handle] — so /eno_visa on eno.vn served the desk's name, bio,
   * trust score, reviews and all 15 listings. The pre-existing `isVisaDesk` check further down only
   * suppresses the Chat CTA; the grid still rendered. Scoping just the nested `listings` include
   * would leave the desk's public presence on a licensed sàn TMĐT intact, minus the products.
   *
   * Keyed on the SELLER's own `id`, so this is deskSellerIds() and not marketplaceListingScope() —
   * that fragment keys on `sellerId` and would be a silent no-op here. It returns [] on the services
   * edition, so eno.forum still serves its own storefront.
   *
   * Returning null must reach a real 404: both routes notFound() on a null seller.
   */
  // ⚠️ `editionHiddenSellerIds()`, NOT `IS_MARKETPLACE && deskSellerIds()`. The old shape
  // existed because deskSellerIds() is edition-BLIND — it always answers "who may eno.vn not
  // surface" — so without the test eno.forum would have 404'd its OWN desk. The list is now
  // chosen per edition, which makes the guard unnecessary AND would have made the forum's own
  // exclusions (owner, 2026-08-17: hide VietKite and GMBR there) never apply. See
  // src/lib/edition-scope.ts.
  if (await isSellerHiddenHere(id)) return null
  return db.seller.findUnique({
    where: { id },
    include: {
      /**
       * ⛔ `take` IS LOAD-BEARING, NOT A TIDY-UP. Without it this loads EVERY active listing a
       * seller has, each with its category and seller relation, and renders them all into the HTML.
       * That was invisible while storefronts held a dozen items; the CellphoneS import gave one
       * seller 9,726, and the page became **117 MB of HTML taking 15.8 seconds** (VinWonders, for
       * comparison: 58 KB). A browser could not finish it — which is how this was found: the
       * owner reported that the partner's logo "still cant see", and the logo was fine; the page
       * simply never got there.
       * ⚠️ On Vietnamese mobile data a 117 MB page is not slow, it is unaffordable.
       * The true total comes from `_count` below, so nothing on screen reports the cap as the
       * inventory.
       */
      listings: { where: await scopedListingWhere({ verified: true, status: 'active' }), orderBy: [{ postedAt: 'desc' }, { id: 'desc' }], include: { category: true, seller: true }, take: STOREFRONT_LISTINGS },
      _count: { select: { listings: { where: await scopedListingWhere({ verified: true, status: 'active' }) } } },
      handle: { select: { handle: true } }, // public shopname → the shareable eno.vn/<name> link
      // accountType → SellerCard's Business chip; lastSeenAt → the presence bucket
      // (consumed server-side by sellerMetrics — only the day-coarse value escapes).
      owner: { select: { accountType: true, lastSeenAt: true } },
    },
  })
})

// Reviews are fetched with an EXPLICIT select (not include) so we can read the
// verified-buyer provenance columns — and stay resilient before they exist: the
// prod DB gains conversationId/authorProfileId only when scripts/add-review-cols.mjs
// runs, so a pre-migration deploy would 500 on the wider select. Catch that and
// fall back to the legacy column set (nothing shows the badge) — this page then
// works whichever of code/migration ships first.
const loadReviews = cache(async (sellerId: string) => {
  try {
    const rows = await db.review.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, author: true, rating: true, text: true, createdAt: true, conversationId: true, authorProfileId: true },
    })
    // "Verified buyer" is EARNED: only reviews born from a real conversation
    // (post-transaction, api/sellers/[id]/reviews) carry provenance. Seeded/legacy
    // rows have neither field → no badge.
    // createdAt is SELECTED and serialized: the review row shows when it was left, which
    // is half of what makes a rating credible.
    return rows.map((r) => ({ id: r.id, author: r.author, rating: r.rating, text: r.text, createdAt: r.createdAt.toISOString(), verified: !!(r.conversationId || r.authorProfileId) }))
  } catch {
    const rows = await db.review.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, author: true, rating: true, text: true, createdAt: true },
    })
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), verified: false }))
  }
})

export async function SellerStorefront({ id }: { id: string }) {
  // The share address: the subdomain where `/s/<handle>` will actually serve this shop, otherwise the
  // path — this component is also the fallback for handles the subdomain rejects (brand-slug collisions),
  // and sharing a subdomain that 404s would be worse than the path. The origin falls back to THIS
  // edition's own domain, so a forum build missing its env can never hand out an eno.vn address.
  const shareOrigin = process.env.NEXT_PUBLIC_APP_URL || (IS_SERVICES ? 'https://www.eno.forum' : 'https://eno.vn')
  const shareUrlFor = async (handle: string | null | undefined) =>
    !handle ? null : (await storefrontByHandle(handle)) ? storefrontUrl(handle, shareOrigin) : `${shareOrigin.replace(/\/$/, '')}/${handle}`
  // 90d conversation count → the responsiveness bucket's honesty gate (suppressed
  // below RESPONSE_MIN_CONVOS so a fresh seller never shows a fake "100%"). Same
  // window + query shape the trust engine uses; one cheap indexed count, batched.
  const [seller, reviews, convoCount, marketplaceTotal, otherRows] = await Promise.all([
    loadSeller(id),
    loadReviews(id),
    db.conversation.count({ where: { sellerId: id, createdAt: { gte: new Date(Date.now() - 90 * 86400000) } } }),
    /**
     * How much of the rest of the marketplace there is to show UNDER this shop's own grid. Owner,
     * 2026-09-15: a seller page should "show all shops products first then other products" —
     * eno.vn/vinwonders ended at its 17th card (measured: 17 active listings, all 17 rendered) with
     * nothing beneath it.
     *
     * ⛔ THE EXCLUSION GOES INSIDE scopedListingWhere, NOT BESIDE IT. That helper's own note is
     * explicit: spreading its result next to another top-level `sellerId` is a silent leak. On the
     * MARKETPLACE edition it wraps the caller as `{ AND: [where, { sellerId: { notIn: [desk ids] } }] }`
     * — a sibling key of the same name would overwrite that and put the e-Visa SKUs back into a
     * licensed marketplace grid; on the services edition it is a no-op, since eno.forum's reader
     * may see the desk. Passed in, the two land as independent AND conditions and both apply.
     */
    /**
     * ⚠️ THE REMAINDER IS A SUBTRACTION, NOT A `sellerId <> x` COUNT, AND THAT IS A MEASURED 4x.
     * `count(... and "sellerId" <> $1)` cannot use the covering index and falls to a Seq Scan:
     * EXPLAIN ANALYZE on the box, 76,178 rows, 244ms — paid on EVERY storefront render, which are
     * force-dynamic. Counting the whole scoped catalogue is an Index Only Scan at 62ms and the
     * shop's own count is an Index Scan at 0.6ms, so the same exact number costs ~63ms.
     * ⚠️ THE TWO COUNTS ARE NOT ONE SNAPSHOT, AND THE DRIFT IS BOUNDED TO ONE CLICK. A listing
     * published by this shop between the two reads makes the remainder one too high. It cannot
     * mislead for long: `loadMore` overwrites the seeded total with the API's own `d.total`, which
     * is computed from the same `excludeSeller` predicate, so the first Show-more corrects it and
     * the button then disappears on schedule. A `$transaction` would buy exactness that nothing
     * downstream can observe.
     * ⚠️ EXACT, NOT APPROXIMATE, AND IT HAS TO BE: this total terminates the grid's Show-more
     * (`rows.length < total`). Both counts carry the SAME edition-scoped predicate and the shop is
     * never the desk, so the difference is the remainder with no drift to accumulate.
     */
    db.listing.count({ where: await scopedListingWhere({ verified: true, status: 'active' }) }),
    /**
     * ⛔ SERVER-RENDER THE FIRST PAGE. SellerListings does NOT fetch on mount: its effect returns
     * early while `isInitialView` holds, by design, so that returning to the untouched view cancels
     * an abandoned request instead of re-running one. Handing it an empty array therefore produces a
     * heading over a permanently empty grid — no request, no error, nothing to notice. The shop's
     * own grid is server-rendered for the same reason; this one has to be too.
     */
    /**
     * ⛔ THE DIVERSE WINDOW, NOT RECENCY, AND THE RECENCY VERSION WAS MEASURED FIRST: fifty rows of
     * "everything except this shop" came back from TWO sellers, fourteen and ten, because Tiki
     * alone holds 52,399 of the 76,177 and newest-first is its bulk import. The blend returns the
     * same twenty-four across twelve sellers.
     * ⚠️ MIRRORS `/api/listings` AT offset 0. The API interleaves only under DEFAULT_FEED_SORT and
     * orders `[{ rankScore: desc }, { id: desc }]`; both are reproduced here so Show-more continues
     * the list instead of re-serving its head.
     */
    diverseFeedWindow(
      await scopedListingWhere({ verified: true, status: 'active', sellerId: { not: id } }),
      [{ rankScore: 'desc' }, { id: 'desc' }],
      { ...LISTING_CARD_SELECT, listingType: true },
      // Same seat rule as /api/listings for an unfiltered feed (sharedSeatsFor(null)).
      { sharedSeats: true },
    ),
  ])
  if (!seller) notFound()
  const shareUrl = await shareUrlFor(seller.handle?.handle)

  // Owner enforcement state (Phase 2 caution line). The columns are @ignore'd in
  // Prisma (deploy-order safety) so they can't ride the seller join — getEnforcement
  // is the guarded single indexed PK read of the denormalized Profile column
  // (good_standing pre-migration ⇒ no line). Guest storefronts have no owner.
  const enforcement = seller.ownerId ? await getEnforcement(seller.ownerId) : null
  const caution =
    enforcement && (enforcement.state === 'throttled' || enforcement.state === 'held' || enforcement.state === 'suspended')
      ? enforcement.state
      : null

  // The remainder, from the two indexed counts — see the note beside marketplaceTotal.
  const otherCount = Math.max(0, marketplaceTotal - seller._count.listings)
  const listings = await localizeListingTitles(seller.listings.map(serializeListing))
  // ⚠️ `diversifyBySeller` on top of the window, and sliced AFTER the reorder — see the home feed's
  // note: the window picks WHICH rows, this interleaves them, and the window's fallback paths (a
  // groupBy failure, one seller, an under-filled fan-out) return a plain top-N nobody interleaved.
  const otherListings = await localizeListingTitles(
    diversifyBySeller(otherRows, { sharedSeats: true }).slice(0, OTHER_LISTINGS).map(serializeListingCard),
  )

  // Honest, decomposed display metrics for the shared SellerCard (raw responseRate
  // stays server-side; only the bucketed label escapes). Trust score / rating /
  // member-year now ride in the card's metrics strip, so the old flat Stat grid is
  // retired to avoid duplicating the same three signals.
  const metrics = sellerMetrics({ ...seller, lastSeenAt: seller.owner?.lastSeenAt ?? null }, convoCount)
  const cardSeller = {
    id: seller.id,
    name: seller.name,
    avatarColor: seller.avatarColor,
    avatarUrl: seller.avatarUrl,
    isBusiness: seller.owner?.accountType === 'business',
    // The verified-business badge — the identity-hash-derived gate (>=2 channels).
    // seller has every scalar column (loadSeller uses include, no explicit select).
    businessVerified: seller.owner?.accountType === 'business' && isBusinessVerified(seller),
    officialPartner: seller.officialPartner,
  }
  // Anchor "Chat" to the newest active listing (listings already ordered postedAt
  // desc). Null when there's nothing active to talk about → button self-omits.
  // ⚠️ THE NEWEST listing THAT CHAT ACTUALLY WORKS FOR. A partner ticket is booked on the
  // partner's site and has no chat gate on its own PDP, so anchoring here to `listings[0]` would
  // send a reader to a page with nothing to answer them — which is what happens the moment a
  // partner posts one ordinary item and stops being caught by `isAffiliatePartner` below.
  /**
   * ⚠️ QUERIED, NOT SEARCHED IN THE LOADED PAGE. With a `take` on the grid, a seller whose first 60
   * listings are all affiliate ones would look as though they had no chattable listing at all —
   * silently removing the Chat CTA from a storefront that has one on item 61.
   */
  /**
   * ⛔ `scopedListingWhere` IS NOT OPTIONAL HERE — IT IS THE LICENSING BOUNDARY. The grid and the
   * `_count` above are both scoped; a bare `sellerId + verified + status` lookup is not, so it
   * could anchor the Chat CTA on a listing THIS EDITION REFUSES TO SERVE (a visa/itinerary row on
   * eno.vn), open a thread on it, and flip `isAffiliatePartner` false against a scoped count that
   * says every listing is affiliate. Three reviewers found this independently, and they were right:
   * the array `.find()` this replaced could never do it, because the array was already scoped.
   */
  const chatListingId = (await db.listing.findFirst({
    where: await scopedListingWhere({ sellerId: seller.id, verified: true, status: 'active', affiliateUrl: null }),
    orderBy: { postedAt: 'desc' }, select: { id: true },
  }))?.id ?? null
  // Identity, not name/handle: the desk is whichever storefront getVisaShopSeller resolves.
  const isVisaDesk = seller.id === (await getVisaShopSeller())?.id
  /**
   * A partner storefront whose every product is booked and paid for on the partner's own site.
   *
   * ⛔ NO GENERIC "Chat now" HERE (owner, 2026-08-24). It is the same rule the visa desk already
   * follows one line up, for the same reason: the CTA promises a conversation that leads somewhere,
   * and on this storefront it does not. eno never takes the payment, sets the price, or holds the
   * booking — every product page sends the reader to the partner's checkout instead.
   *
   * ⚠️ DERIVED FROM THE LISTINGS, NOT FROM A NAME OR AN ID. `every` and not `some`, and the
   * non-empty guard is load-bearing: a storefront with zero active listings would otherwise satisfy
   * `every` vacuously and silently lose its chat button. A partner that also sells something
   * ordinary keeps the CTA, because for that product a chat IS the right next step.
   */
  // ⚠️ "EVERY listing is affiliate" now means "there is no non-affiliate one", which is the same
  // statement without depending on having loaded them all — `every` over a capped page would call
  // a mixed seller a pure affiliate partner.
  const isAffiliatePartner = seller._count.listings > 0 && chatListingId === null

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <ScrollToTop />
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-12">
        {/* Optional cover. Renders nothing for the storefronts that have not set one, which is
            almost all of them — see StorefrontBanner for why the box is sized before the image. */}
        <StorefrontBanner url={seller.bannerUrl} mobileUrl={seller.bannerMobileUrl} />
        {/* Seller header — shared SellerCard (identity + trust + honest metrics
            strip + the primary "Chat" CTA that was previously ABSENT here). The
            storefront variant omits the "View shop" link back to itself. Storefront-
            only bits SellerCard doesn't carry (public @handle, active-account pill,
            bio, the "report a business" control) sit alongside it. */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="max-w-md">
              <StorefrontSellerCard
                seller={cardSeller}
                metrics={metrics}
                // The visa desk does not take an ordinary "Chat" about its newest listing —
                // its threads ARE applications. Suppress the generic CTA: the buyer picks a
                // product from the grid below and its PDP "Apply" starts the case with that
                // product pre-chosen (the inline speed-tier picker that used to sit here was
                // removed on owner direction 2026-07-23 — the sortable grid is the chooser).
                // ⚠️ ALWAYS null NOW — the CTA moved OUT of the card so it can share the chip
                // row below (owner, 2026-08-11). SellerCard hides its primary button when it
                // gets no onChat, and that is precisely how this suppression works; if you ever
                // restore a value here the page will render TWO "Chat now" buttons.
                // The visa-desk rule is unchanged, it just moved to the button below: that desk
                // does not take a generic chat, its threads ARE applications.
                chatListingId={null}
                listingCount={seller._count.listings}
              />
            </div>
            {/* ONE LINE: the identity chips and the (rare) Report action share a row instead of
                stacking into two more blocks under the card. Owner 2026-07-24: "what can be put
                in one line put, small chips" — the header was five stacked blocks on a phone
                (identity · metrics · Chat · chips · Report) before any content. */}
            {/*
              ⛔ THE VISA DESK'S OWN STOREFRONT NEEDS THE DISCLAIMER TOO. The services footer links
              here as "Vietnam e-Visa help" from every page, and the page rendered the desk's
              identity, its e-visa listings and their prices with no statement of who we are not and
              no link to the official portal — one of the surfaces the Play Misleading Claims
              rejection covered (2026-09-10).
            */}
            {isVisaDesk && (
              <VisaDisclosure
                className="mb-4"
                text={NOT_GOVERNMENT.en}
                textVi={NOT_GOVERNMENT.vi}
                linkLabel="Official Vietnam e-Visa portal (Immigration Department)"
              />
            )}
            {/* ⚠️ THE CTA NOW LIVES ON THIS ROW, so the guard has to admit it. The row used to
                render only when there was a handle or an owner; a seller with a chat target but
                neither would have lost their "Chat now" entirely when it moved here. */}
            {(seller.handle || seller.ownerId || (!isVisaDesk && !isAffiliatePartner && chatListingId)) && (
              <div className="flex flex-wrap items-center gap-2">
                {/* One line, mobile and desktop (owner, 2026-08-11). `flex-wrap` is deliberate
                    and is NOT a second row in disguise: at 320px the chips + CTA + Report cannot
                    fit, and forcing them to would either overflow the viewport or shrink the
                    primary action below a 44px target. Wrapping degrades to two lines only where
                    one is physically impossible; everywhere else it is the single row asked for. */}
                {!isVisaDesk && !isAffiliatePartner && <StorefrontChatButton chatListingId={chatListingId} />}
                {seller.handle && <HandleChip handle={seller.handle.handle} />}
                {/* Share hands out the SUBDOMAIN (owner, 2026-09-13: "when user selects to share storefront
                    use slug like vietkite.eno.vn or vietkite.eno.forum") — this edition's own domain. */}
                {shareUrl && <ShareButton url={shareUrl} title={seller.name} compact />}
                {/* ONE badge only (owner 2026-07-23: "only 1 badge, no 2 badge system").
                    A business that passed the >=2-channel verification shows "Business
                    verified"; everyone else shows just "Active account". The standalone
                    "Tax code verified" chip was REMOVED — the tax registry check is now an
                    INPUT to the single badge (isBusinessVerified requires it), never a
                    public badge on its own, so a business that passed only the automatic
                    tax check (a copyable public MST) can no longer flash a partial
                    "verified" signal to buyers. */}
                {/* Glyphs are RANKED, not interchangeable: the EnoSeal is the mark for
                    signals eno actually VERIFIED ("Business verified", "Verified buyer") —
                    §0b routes every first-party verification moment to the seal, and a
                    stock BadgeCheck beside the authored seal chip diluted the signature
                    (blind-critic catch, R2). The weaker "Active account" status takes the
                    plain CheckCircle2 — stamping the verification mark on mere activity
                    would devalue the real one.
                    size="md" (text-xs + h-3.5 glyph) matches the HandleChip beside it,
                    so the identity row reads as ONE height of chip. */}
                {/* ⚠️ "Active account" WAS REMOVED (owner, 2026-08-11) — do not restore it.
                    It was the else-branch of this badge: a verified business showed "Business
                    verified", everyone else showed "Active account". The second one asserted
                    nothing a reader could act on — every storefront that renders at all belongs
                    to an active account — while the card's metrics strip directly above already
                    carries the honest version of that signal, a real last-seen bucket computed
                    from lastSeenAt. A green tick claiming "active" beside a line saying when
                    they were actually last online is the weaker of two claims about the same
                    thing, and it borrowed the success colour to say it.
                    What remains is a badge only where something was genuinely VERIFIED, which
                    is what the one-badge rule (owner 2026-07-23) was protecting in the first
                    place: a storefront now shows a badge or it shows nothing, and the badge
                    means eno checked a document. */}
                {cardSeller.businessVerified && (
                  <Badge variant="success" size="md"><ShieldCheck aria-hidden className="h-3.5 w-3.5" /> <Tr text="Business verified" /></Badge>
                )}
                {/* Report rides the END of this line. It is a rare, secondary action — as its
                    own red block under the CTA it read as loud as "Chat now". */}
                <span className="ml-auto"><ReportButton sellerId={seller.id} /></span>
              </div>
            )}
            {/* ⚠️ A <div>, NOT THE <p> THIS WAS. RichText emits <p>/<ul> blocks, and a block inside
                a <p> is invalid HTML the browser silently re-parents — the server tree and the
                client tree then differ and React logs a hydration mismatch. The className moves
                across unchanged; `space-y-2` is what gives the paragraphs air now that there is
                more than one of them. */}
            {seller.bio && <RichText text={seller.bio} className="max-w-2xl space-y-2 text-sm text-body" />}
          </div>
        </div>

        {/* Enforcement caution (Phase 2) — one line under the header, before any
            listing/contact surface. throttled = caution; held/suspended = stronger. */}
        {caution && (
          <p
            className={`mt-5 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
              caution === 'throttled' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'
            }`}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {caution === 'throttled'
              ? <Tr text="This seller is under review — trade with extra care" />
              : <Tr text="This seller's account is on hold — don't send money or deposits" />}
          </p>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <section className="mt-10 space-y-4">
            {/* ⚠️ The RATING and the DATE were already in the data (topSellerReviews returns
                both) and neither was rendered — a review read as an unattributed sentence with
                a green badge. Showing them is the difference between "someone said this" and
                "a verified buyer rated this 5/5 in July". */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="h-section text-foreground"><Tr text="Reviews" /> ({seller.reviewCount})</h2>
              {seller.reviewCount > 0 && (
                <span className="inline-flex items-center gap-1 text-sm text-body">
                  <Star className="h-4 w-4 fill-rating text-rating" aria-hidden />
                  <span className="font-bold text-foreground">{seller.rating.toFixed(1)}</span>
                  <Tr text="average" />
                </span>
              )}
            </div>
            {/* Flat list, one review per row (canon §3b) — a two-up grid of naked blocks made
                two reviews read as one paragraph. */}
            <ul className="divide-y divide-border border-t border-border">
              {reviews.map((r) => (
                <li key={r.id} className="py-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                      {r.author.split(' ').map((w) => w[0]).join('').toUpperCase()}
                    </span>
                    <span className="text-sm font-semibold text-foreground">{r.author}</span>
                    {/* Earned badge: only reviews with real conversation provenance.
                        Same treatment as the PDP's ReviewsPreview rows (neutral chip,
                        accent ink, h-3 BadgeCheck inside 2xs text) — the two review
                        surfaces are one click apart and must read as one hand. */}
                    {r.verified && (
                      <Badge variant="neutral" size="sm" className="gap-0.5 px-1.5 font-medium text-accent-foreground">
                        <ShieldCheck aria-hidden className="h-3 w-3" /> <Tr text="Verified buyer" />
                      </Badge>
                    )}
                    {/* Rating + date: pushed right when the row fits, but a plain LEFT-aligned
                        second line once it wraps on a phone — `ml-auto` alone left it as a
                        right-aligned orphan under the name. */}
                    <span className="inline-flex w-full items-center gap-1.5 text-xs text-ink-4 sm:ml-auto sm:w-auto">
                      <span className="inline-flex items-center gap-0.5" aria-label={`${r.rating}/5`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} className={n <= Math.round(r.rating) ? 'h-3.5 w-3.5 fill-rating text-rating' : 'h-3.5 w-3.5 text-line-strong'} aria-hidden />
                        ))}
                      </span>
                      <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleDateString()}</time>
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-body"><Tr text={r.text} /></p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Listings by this seller */}
        {listings.length > 0 && (
          <section className="mt-10 space-y-4">
            <h2 className="h-section text-foreground"><Tr text="Listings by" /> {seller.name} ({seller._count.listings})</h2>
            {/* ⛔ SEARCH AND SORT RUN AGAINST THE WHOLE SHOP, NOT AGAINST THIS PAGE'S 60 ROWS. The
                heading above has always shown the true count; the grid below it used to be the 60
                NEWEST, searched and re-sorted in the browser. On the CellphoneS storefront that is
                60 of 9,726 — "Price ↑" could not reach the cheapest phone in the shop and typing a
                model name searched 0.6% of it. `serverScope` keeps the 60 as the server-rendered
                first page and makes every interaction a scoped /api/listings query. */}
            <SellerListings
              listings={listings}
              searchable
              sortable
              initialSort="recent"
              serverScope={{ params: { seller: seller.id }, total: seller._count.listings, pageSize: STOREFRONT_LISTINGS }}
            />
          </section>
        )}

        {/* The rest of the marketplace, BELOW this shop's own grid.
            ⛔ ITS OWN SECTION AND ITS OWN HEADING, NEVER APPENDED TO THE GRID ABOVE. That heading
            reads "Listings by <seller> (<count>)", so continuing it with other shops' products
            would state, in the page's own words, that those products are this seller's. On a
            marketplace carrying a partner badge that is a misattribution, not a layout choice —
            and the badge is exactly what makes a visitor trust the claim.
            ⚠️ EMPTY IS A REAL STATE AND RENDERS NOTHING. SellerListings returns null when it has no
            rows and no server total, which is what a hidden-list edition produces (eno.forum hides
            partners wholesale — an empty marketplace there is correct, not a bug to paper over). */}
        {otherCount > 0 && (
          <section className="mt-10 space-y-4">
            <h2 className="h-section text-foreground"><Tr text="More on" /> {SITE_NAME}</h2>
            {/* Server-rendered like the grid above, and see OTHER_LISTINGS for why it is 24 rather
                than 60: this is the continuation, not the reason the visitor came. */}
            <SellerListings
              listings={otherListings}
              /* ⛔ NO SEARCH BOX AND NO SORT TABS ON THIS GRID. The shop's own grid above already has both,
                 labelled "Search this seller" — a second copy here said the same words while searching
                 the REST of the marketplace, and gave the page two identical controls (CI caught it:
                 getByLabel('Search this seller') and the price tab each resolved to 2 elements).
                 Searching and sorting the whole catalogue is /search's job; this is a continuation. */
              /* 'relevance' is this component's name for DEFAULT_FEED_SORT ('newest' on the wire —
                 the balanced blend, NOT most-recent), which is the only sort the API interleaves
                 under. 'recent' here would disable the interleave on every Show-more. */
              initialSort="relevance"
              serverScope={{ params: { excludeSeller: seller.id }, total: otherCount, pageSize: OTHER_LISTINGS }}
            />
          </section>
        )}
      </main>
      <Footer />
    </div>
  )
}
