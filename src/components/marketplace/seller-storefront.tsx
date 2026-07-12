import { cache } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, BadgeCheck, ChevronLeft } from 'lucide-react'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ScrollToTop } from '@/components/marketplace/scroll-to-top'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Tr } from '@/context/language-context'
import { ReportButton } from '@/components/marketplace/report-button'
import { HandleChip } from '@/components/marketplace/handle-chip'
import { StorefrontSellerCard } from '@/components/marketplace/storefront-seller-card'
import { StorefrontRails } from '@/components/marketplace/storefront-rails'
import { sellerMetrics } from '@/lib/seller-metrics'
import { getEnforcement } from '@/lib/enforcement'

// Shared storefront body — rendered by BOTH the canonical clean-handle URL
// (src/app/[handle]/page.tsx → eno.vn/<handle>) and the legacy /sellers/[id] route.
// The handle is the public destination people share, so it's the primary URL; the id
// route redirects to it when a handle exists.

// Single per-request DB read shared by generateMetadata + the page (React cache
// dedupes), so an SEO seller page makes ONE round-trip instead of two.
export const loadSeller = cache((id: string) =>
  db.seller.findUnique({
    where: { id },
    include: {
      listings: { where: { verified: true, status: 'active' }, orderBy: { postedAt: 'desc' }, include: { category: true, seller: true } },
      handle: { select: { handle: true } }, // public shopname → the shareable eno.vn/<name> link
      owner: { select: { accountType: true } }, // → SellerCard's Business chip
    },
  }),
)

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
      select: { id: true, author: true, rating: true, text: true, conversationId: true, authorProfileId: true },
    })
    // "Verified buyer" is EARNED: only reviews born from a real conversation
    // (post-transaction, api/sellers/[id]/reviews) carry provenance. Seeded/legacy
    // rows have neither field → no badge.
    return rows.map((r) => ({ id: r.id, author: r.author, rating: r.rating, text: r.text, verified: !!(r.conversationId || r.authorProfileId) }))
  } catch {
    const rows = await db.review.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, author: true, rating: true, text: true },
    })
    return rows.map((r) => ({ ...r, verified: false }))
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
  const metrics = sellerMetrics(seller, convoCount)
  const cardSeller = {
    id: seller.id,
    name: seller.name,
    avatarColor: seller.avatarColor,
    avatarUrl: seller.avatarUrl,
    isBusiness: seller.owner?.accountType === 'business',
  }
  // Anchor "Chat" to the newest active listing (listings already ordered postedAt
  // desc). Null when there's nothing active to talk about → button self-omits.
  const chatListingId = seller.listings[0]?.id ?? null

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <ScrollToTop />
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-12">
        <div className="mb-5">
          <Link href="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-accent-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" /> <span><Tr text="Back to Home" /></span>
          </Link>
        </div>

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
                chatListingId={chatListingId}
                listingCount={listings.length}
              />
            </div>
            {(seller.handle || seller.ownerId) && (
              <div className="flex flex-wrap items-center gap-2">
                {seller.handle && <HandleChip handle={seller.handle.handle} />}
                {seller.ownerId && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                    <BadgeCheck className="h-4 w-4" /> <Tr text="Active account" />
                  </span>
                )}
              </div>
            )}
            {seller.bio && <p className="max-w-2xl text-sm text-body"><Tr text={seller.bio} /></p>}
          </div>
          <div className="shrink-0">
            <ReportButton sellerId={seller.id} />
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

        {/* Auto-curated showcase rails (Shopee-style). Self-omit at ≤8 active
            listings; above that, two ListingCard rails ("Mới đăng" postedAt-desc /
            "Được quan tâm nhất" contactCount-desc) merchandise the shop above the
            full grid. Derived from the already-loaded set — no extra query. */}
        <StorefrontRails listings={listings} />

        {/* Reviews */}
        {reviews.length > 0 && (
          <section className="mt-10 space-y-4">
            <h2 className="h-section text-foreground"><Tr text="Reviews" /> ({seller.reviewCount})</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {reviews.map((r) => (
                <div key={r.id}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                      {r.author.split(' ').map((w) => w[0]).join('').toUpperCase()}
                    </span>
                    <span className="text-sm font-semibold text-foreground">{r.author}</span>
                    {/* Earned badge: only reviews with real conversation provenance. */}
                    {r.verified && (
                      <span className="ml-auto inline-flex items-center gap-1 text-2xs font-semibold text-success"><BadgeCheck className="h-3.5 w-3.5" /> <Tr text="Verified buyer" /></span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-body"><Tr text={r.text} /></p>
                </div>
              ))}
            </div>
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
