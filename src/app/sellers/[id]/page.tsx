import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { Star, BadgeCheck, ChevronLeft, MessageSquareText, Clock, CalendarDays } from 'lucide-react'
import { Tr } from '@/context/language-context'
import { TrustBadge } from '@/components/marketplace/trust-badge'
import { ReportButton } from '@/components/marketplace/report-button'

type Props = { params: Promise<{ id: string }> }

function Stat({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-[#0a66c2]">{icon}</span>
      <div className="leading-tight">
        <div className="text-sm font-bold text-[#1a202c]">{value}</div>
        <div className="text-[11px] text-[#94a3b8]">{label}</div>
      </div>
    </div>
  )
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const seller = await db.seller.findUnique({ where: { id } })
  if (!seller) return {}
  return { title: `${seller.name} | eno.vn`, description: `${seller.name} — ${seller.reviewCount} reviews · ${seller.rating.toFixed(1)}★` }
}

export default async function SellerPage({ params }: Props) {
  const { id } = await params
  const seller = await db.seller.findUnique({
    where: { id },
    include: {
      reviews: { orderBy: { createdAt: 'desc' } },
      listings: { where: { verified: true }, orderBy: { postedAt: 'desc' }, include: { category: true, seller: true } },
    },
  })
  if (!seller) notFound()

  const initials = seller.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const listings = seller.listings.map(serializeListing)
  const memberYear = new Date(seller.memberSince).getFullYear()

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-12">
        <div className="mb-5">
          <Link href="/" className="inline-flex items-center gap-1 text-sm font-medium text-[#64748b] hover:text-[#0a66c2] transition-colors">
            <ChevronLeft className="h-4 w-4" /> <span><Tr text="Back to Home" /></span>
          </Link>
        </div>

        {/* Seller header */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {seller.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={seller.avatarUrl} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-2xl font-bold text-[#0a66c2]">
              {initials}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="h-title text-[#1a202c]">{seller.name}</h1>
              <TrustBadge tier={seller.trustTier} size="md" />
              {seller.ownerId && (
                <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  <BadgeCheck className="h-4 w-4" /> <Tr text="Active account" />
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-[#475569]">
              <Star className="h-4 w-4 fill-[#1a202c] text-[#1a202c]" />
              <span className="font-semibold text-[#1a202c]">{seller.rating.toFixed(1)}</span>
              <span className="text-[#94a3b8]">· {seller.reviewCount} <Tr text="reviews" /></span>
            </div>
            {seller.bio && <p className="mt-2 max-w-2xl text-sm text-[#475569]"><Tr text={seller.bio} /></p>}
            <div className="mt-3">
              <ReportButton sellerId={seller.id} />
            </div>
          </div>
        </div>

        {/* Trust stats */}
        <div className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-4 shadow-pop">
          <Stat icon={<Star className="h-4 w-4" />} value={`${seller.rating.toFixed(1)}★`} label={<Tr text="Rating" />} />
          <Stat icon={<MessageSquareText className="h-4 w-4" />} value={`${seller.responseRate}%`} label={<Tr text="Response rate" />} />
          <Stat icon={<Clock className="h-4 w-4" />} value={<Tr text={seller.responseTime} />} label={<Tr text="Responds" />} />
          <Stat icon={<CalendarDays className="h-4 w-4" />} value={`${memberYear}`} label={<Tr text="Member since" />} />
        </div>

        {/* Reviews */}
        {seller.reviews.length > 0 && (
          <section className="mt-10 space-y-4">
            <h2 className="h-section text-[#1a202c]"><Tr text="Reviews" /> ({seller.reviewCount})</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {seller.reviews.map((r) => (
                <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f1f5f9] text-xs font-bold text-[#475569]">
                      {r.author.split(' ').map((w) => w[0]).join('').toUpperCase()}
                    </span>
                    <span className="text-sm font-semibold text-[#1a202c]">{r.author}</span>
                    <span className="ml-auto flex items-center gap-0.5 text-xs text-[#1a202c]">
                      <Star className="h-3 w-3 fill-[#1a202c] text-[#1a202c]" /> {r.rating.toFixed(1)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[#475569]"><Tr text={r.text} /></p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Listings by this seller */}
        {listings.length > 0 && (
          <section className="mt-10 space-y-4">
            <h2 className="h-section text-[#1a202c]"><Tr text="Listings by" /> {seller.name} ({listings.length})</h2>
            <SellerListings listings={listings} />
          </section>
        )}
      </main>
      <Footer />
    </div>
  )
}
