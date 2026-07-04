import { cache } from 'react'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ScrollTop } from '@/components/marketplace/scroll-top'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { BadgeCheck, ChevronLeft, Star, CalendarDays } from 'lucide-react'
import { Tr } from '@/context/language-context'
import { TrustScore } from '@/components/marketplace/trust-score'
import { ReportButton } from '@/components/marketplace/report-button'

type Props = { params: Promise<{ id: string }> }

// Single per-request DB read shared by generateMetadata + the page (React cache
// dedupes), so an SEO seller page makes ONE round-trip instead of two.
const getSeller = cache((id: string) =>
  db.seller.findUnique({
    where: { id },
    include: {
      listings: { where: { verified: true, status: 'active' }, orderBy: { postedAt: 'desc' }, include: { category: true, seller: true } },
    },
  }),
)

// Reviews are fetched with an EXPLICIT select (not include) so we can read the
// verified-buyer provenance columns — and stay resilient before they exist: the
// prod DB gains conversationId/authorProfileId only when scripts/add-review-cols.mjs
// runs, so a pre-migration deploy would 500 on the wider select. Catch that and
// fall back to the legacy column set (nothing shows the badge) — this page then
// works whichever of code/migration ships first.
const getReviews = cache(async (sellerId: string) => {
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

function Stat({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      {icon && <span className="shrink-0 text-accent-foreground">{icon}</span>}
      <div className="leading-tight">
        <div className="text-sm font-bold text-foreground">{value}</div>
        <div className="text-[11px] text-ink-4">{label}</div>
      </div>
    </div>
  )
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const seller = await getSeller(id)
  if (!seller) return {}
  return { title: `${seller.name} | eno.vn`, description: `${seller.name} — ${seller.reviewCount} reviews · ${seller.rating.toFixed(1)}★` }
}

export default async function SellerPage({ params }: Props) {
  const { id } = await params
  const [seller, reviews] = await Promise.all([getSeller(id), getReviews(id)])
  if (!seller) notFound()

  const initials = seller.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const listings = await localizeListingTitles(seller.listings.map(serializeListing))
  const memberYear = new Date(seller.memberSince).getFullYear()

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <ScrollTop />
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-12">
        <div className="mb-5">
          <Link href="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-accent-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" /> <span><Tr text="Back to Home" /></span>
          </Link>
        </div>

        {/* Seller header */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {seller.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={seller.avatarUrl} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent text-2xl font-bold text-accent-foreground">
              {initials}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="h-title text-foreground">{seller.name}</h1>
              {seller.ownerId && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                  <BadgeCheck className="h-4 w-4" /> <Tr text="Active account" />
                </span>
              )}
            </div>
            {seller.reviewCount > 0 && (
              <div className="mt-1 text-sm text-ink-4">
                {seller.reviewCount} <Tr text="completed reviews" />
              </div>
            )}
            {seller.bio && <p className="mt-2 max-w-2xl text-sm text-body"><Tr text={seller.bio} /></p>}
            <div className="mt-3">
              <ReportButton sellerId={seller.id} />
            </div>
          </div>
        </div>

        {/* Trust stats — flat (monolith): no box, separation by spacing. Only
            real signals (response rate/time were placeholder values → removed
            until computed from actual conversations). Rating shows once earned. */}
        <div className={`mt-6 grid gap-x-4 gap-y-5 ${seller.reviewCount > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <Stat icon={null} value={<TrustScore score={seller.trustScore} size="md" />} label={<Tr text="Trust score" />} />
          {seller.reviewCount > 0 && (
            <Stat icon={<Star className="h-4 w-4" />} value={`${seller.rating.toFixed(1)}★`} label={<Tr text="Rating" />} />
          )}
          <Stat icon={<CalendarDays className="h-4 w-4" />} value={`${memberYear}`} label={<Tr text="Member since" />} />
        </div>

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
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-success"><BadgeCheck className="h-3.5 w-3.5" /> <Tr text="Verified buyer" /></span>
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
            <SellerListings listings={listings} searchable />
          </section>
        )}
      </main>
      <Footer />
    </div>
  )
}
