import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { serializeListing } from '@/lib/serialize'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { SignInPrompt, SignOutButton } from '@/components/marketplace/account-actions'
import { Tr } from '@/context/language-context'
import { Store, Heart, Plus, ChevronRight, ShieldCheck } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'My account — ENO', robots: { index: false, follow: false } }

export default async function AccountPage() {
  const profile = await getCurrentProfile()

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col bg-[#fafafa]">
        <Header />
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-pop">
            <h1 className="text-lg font-bold text-[#1a202c]"><Tr text="Your account" /></h1>
            <p className="mt-2 text-sm text-[#64748b]"><Tr text="Sign in to manage your profile, listings and saved items." /></p>
            <div className="mt-5"><SignInPrompt /></div>
          </div>
        </main>
      </div>
    )
  }

  // Their business profile (storefront), if they own one.
  const seller = await db.seller.findUnique({
    where: { ownerId: profile.id },
    include: { listings: { orderBy: { postedAt: 'desc' }, include: { category: true, seller: true } } },
  })
  const myListings = seller ? seller.listings.map(serializeListing) : []
  const initials = (profile.displayName || profile.email || '?').slice(0, 2).toUpperCase()

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        {/* Identity header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white" style={{ backgroundColor: profile.avatarColor }}>
                {initials}
              </span>
            )}
            <div>
              <h1 className="h-title text-[#1a202c]">{profile.displayName || profile.email}</h1>
              {profile.email && <p className="text-sm text-[#64748b]">{profile.email}</p>}
            </div>
          </div>
          <SignOutButton />
        </div>

        {/* Quick links */}
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Link href="/saved" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-pop hover:border-[#0a66c2]/30 transition-colors">
            <Heart className="h-5 w-5 text-[#0a66c2]" />
            <span className="text-sm font-semibold text-[#1a202c]"><Tr text="Saved listings" /></span>
            <ChevronRight className="ml-auto h-4 w-4 text-[#cbd5e1]" />
          </Link>
          <Link href="/post" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-pop hover:border-[#0a66c2]/30 transition-colors">
            <Plus className="h-5 w-5 text-[#0a66c2]" />
            <span className="text-sm font-semibold text-[#1a202c]"><Tr text="Post a listing" /></span>
            <ChevronRight className="ml-auto h-4 w-4 text-[#cbd5e1]" />
          </Link>
          {seller && (
            <Link href={`/sellers/${seller.id}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-pop hover:border-[#0a66c2]/30 transition-colors">
              <Store className="h-5 w-5 text-[#0a66c2]" />
              <span className="text-sm font-semibold text-[#1a202c]"><Tr text="My business profile" /></span>
              <ChevronRight className="ml-auto h-4 w-4 text-[#cbd5e1]" />
            </Link>
          )}
        </div>

        {/* Business profile / listings */}
        {seller ? (
          <section className="mt-10">
            <div className="flex items-center gap-2">
              <h2 className="h-section text-[#1a202c]"><Tr text="My listings" /></h2>
              {seller.verifiedSeller && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f1fb] px-2 py-0.5 text-[11px] font-semibold text-[#0a66c2]">
                  <ShieldCheck className="h-3 w-3" /> <Tr text="Verified business" />
                </span>
              )}
            </div>
            {myListings.length > 0 ? (
              <div className="mt-4"><SellerListings listings={myListings} /></div>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-[#cbd5e1] py-10 text-center text-sm text-[#64748b]">
                <Tr text="No live listings yet — post one to get started." />
              </p>
            )}
          </section>
        ) : (
          <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-pop">
            <h2 className="text-sm font-bold text-[#1a202c]"><Tr text="Selling on ENO?" /></h2>
            <p className="mt-1 text-sm text-[#64748b]">
              <Tr text="Post a listing to create your business profile. If you've posted before with your phone number, sign in with that number to claim it." />
            </p>
          </section>
        )}
      </main>
      <Footer />
    </div>
  )
}
