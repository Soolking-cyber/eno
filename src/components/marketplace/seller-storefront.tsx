import { IS_MARKETPLACE } from '@/lib/edition'
import { deskSellerIds, scopedListingWhere } from '@/lib/edition-scope'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { AlertTriangle, BadgeCheck, Star } from 'lucide-react'
import { db } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { serializeListing } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Tr } from '@/context/language-context'
import { ReportButton } from '@/components/marketplace/report-button'
import { HandleChip } from '@/components/marketplace/handle-chip'
import { Badge } from '@/components/ui/badge'
import { StorefrontSellerCard } from '@/components/marketplace/storefront-seller-card'
import { getVisaShopSeller } from '@/lib/visa-shop'
import { sellerMetrics } from '@/lib/seller-metrics'
import { getEnforcement } from '@/lib/enforcement'
import { isBusinessVerified } from '@/lib/business-verification'

// Shared storefront body — rendered by BOTH the canonical clean-handle URL
// (src/app/[handle]/page.tsx → eno.vn/<handle>) and the legacy /sellers/[id] route.
// The handle is the public destination people share, so it's the primary URL; the id
// route redirects to it when a handle exists.

// Single per-request DB read shared by generateMetadata + the page (React cache
// dedupes), so an SEO seller page makes ONE round-trip instead of two.
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
  if (IS_MARKETPLACE && (await deskSellerIds()).includes(id)) return null
  return db.seller.findUnique({
    where: { id },
    include: {
      listings: { where: await scopedListingWhere({ verified: true, status: 'active' }), orderBy: { postedAt: 'desc' }, include: { category: true, seller: true } },
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
  // 90d conversation count → the responsiveness bucket's honesty gate (suppressed
  // below RESPONSE_MIN_CONVOS so a fresh seller never shows a fake "100%"). Same
  // window + query shape the trust engine uses; one cheap indexed count, batched.
  const [seller, reviews, convoCount] = await Promise.all([
    loadSeller(id),
    loadReviews(id),
    db.conversation.count({ where: { sellerId: id, createdAt: { gte: new Date(Date.now() - 90 * 86400000) } } }),
  ])
  if (!seller) notFound()

  // Owner enforcement state (Phase 2 caution line). The columns are @ignore'd in
  // Prisma (deploy-order safety) so they can't ride the seller join — getEnforcement
  // is the guarded single indexed PK read of the denormalized Profile column
  // (good_standing pre-migration ⇒ no line). Guest storefronts have no owner.
  const enforcement = seller.ownerId ? await getEnforcement(seller.ownerId) : null
  const caution =
    enforcement && (enforcement.state === 'throttled' || enforcement.state === 'held' || enforcement.state === 'suspended')
      ? enforcement.state
      : null

  const listings = await localizeListingTitles(seller.listings.map(serializeListing))

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
  }
  // Anchor "Chat" to the newest active listing (listings already ordered postedAt
  // desc). Null when there's nothing active to talk about → button self-omits.
  const chatListingId = seller.listings[0]?.id ?? null
  // Identity, not name/handle: the desk is whichever storefront getVisaShopSeller resolves.
  const isVisaDesk = seller.id === (await getVisaShopSeller())?.id

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <ScrollToTop />
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-12">
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
                chatListingId={isVisaDesk ? null : chatListingId}
                listingCount={listings.length}
              />
            </div>
            {/* ONE LINE: the identity chips and the (rare) Report action share a row instead of
                stacking into two more blocks under the card. Owner 2026-07-24: "what can be put
                in one line put, small chips" — the header was five stacked blocks on a phone
                (identity · metrics · Chat · chips · Report) before any content. */}
            {(seller.handle || seller.ownerId) && (
              <div className="flex flex-wrap items-center gap-2">
                {seller.handle && <HandleChip handle={seller.handle.handle} />}
                {/* ONE badge only (owner 2026-07-23: "only 1 badge, no 2 badge system").
                    A business that passed the >=2-channel verification shows "Business
                    verified"; everyone else shows just "Active account". The standalone
                    "Tax code verified" chip was REMOVED — the tax registry check is now an
                    INPUT to the single badge (isBusinessVerified requires it), never a
                    public badge on its own, so a business that passed only the automatic
                    tax check (a copyable public MST) can no longer flash a partial
                    "verified" signal to buyers. */}
                {cardSeller.businessVerified ? (
                  <Badge variant="success"><BadgeCheck className="h-3.5 w-3.5" /> <Tr text="Business verified" /></Badge>
                ) : (
                  seller.ownerId && (
                    <Badge variant="success"><BadgeCheck className="h-3.5 w-3.5" /> <Tr text="Active account" /></Badge>
                  )
                )}
                {/* Report rides the END of this line. It is a rare, secondary action — as its
                    own red block under the CTA it read as loud as "Chat now". */}
                <span className="ml-auto"><ReportButton sellerId={seller.id} /></span>
              </div>
            )}
            {seller.bio && <p className="max-w-2xl text-sm text-body"><Tr text={seller.bio} /></p>}
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
            <AlertTriangle className="h-4 w-4 shrink-0" />
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
                    {/* Earned badge: only reviews with real conversation provenance. */}
                    {r.verified && (
                      <Badge variant="success"><BadgeCheck className="h-3.5 w-3.5" /> <Tr text="Verified buyer" /></Badge>
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
            <h2 className="h-section text-foreground"><Tr text="Listings by" /> {seller.name} ({listings.length})</h2>
            <SellerListings listings={listings} searchable sortable />
          </section>
        )}
      </main>
      <Footer />
    </div>
  )
}
