'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Store, Heart, ChevronRight, ShieldCheck } from 'lucide-react'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SellerListings } from '@/components/marketplace/seller-listings'
import { SignInPrompt, SignOutButton } from '@/components/marketplace/account-actions'
import { LanguagePref } from '@/components/marketplace/language-pref'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'

const ACCOUNT_KEY = 'eno-account' // { userId, account } — instant paint on revisit

type Account = {
  profile: { displayName: string | null; email: string | null; avatarUrl: string | null; avatarColor: string }
  seller: { id: string; verifiedSeller: boolean } | null
  listings: SerializedListing[]
}

/** Cache-first account page. Paints instantly from the user's cached account
 *  (localStorage, userId-scoped) — businesses hit this a lot — then revalidates. */
export function AccountClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const [account, setAccount] = useState<Account | null>(null)

  useEffect(() => {
    if (!user) { setAccount(null); return }
    try {
      const c = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null')
      if (c && c.userId === user.id) setAccount(c.account) // instant paint
    } catch {}
    let cancelled = false
    fetch('/api/account')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.account) return
        setAccount(d.account)
        try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ userId: user.id, account: d.account })) } catch {}
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user])

  // Logged out
  if (!loading && !user) {
    return (
      <div className="flex min-h-screen flex-col bg-[#fafafa]">
        <Header />
        <main className="mx-auto w-full max-w-md flex-1 space-y-8 px-3 py-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-pop">
            <h1 className="text-lg font-bold text-[#1a202c]">{tr('Your account', 'Tài khoản của bạn')}</h1>
            <p className="mt-2 text-sm text-[#64748b]">{tr('Sign in to manage your profile, listings and saved items.', 'Đăng nhập để quản lý hồ sơ, tin đăng và mục đã lưu.')}</p>
            <div className="mt-5"><SignInPrompt /></div>
          </div>
          {/* Language is a device preference — available even before sign-in. */}
          <LanguagePref />
        </main>
      </div>
    )
  }

  // Header identity falls back to the auth user until the cached/fresh account loads.
  const displayName = account?.profile.displayName || account?.profile.email || user?.email || ''
  const email = account?.profile.email || user?.email || ''
  const avatarUrl = account?.profile.avatarUrl ?? null
  const avatarColor = account?.profile.avatarColor || '#0a66c2'
  const initials = (displayName || email || '?').slice(0, 2).toUpperCase()
  const seller = account?.seller ?? null
  const listings = account?.listings ?? []

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-8 sm:px-6">
        {/* Identity header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white" style={{ backgroundColor: avatarColor }}>
                {initials}
              </span>
            )}
            <div>
              <h1 className="h-title text-[#1a202c]">{displayName}</h1>
              {email && <p className="text-sm text-[#64748b]">{email}</p>}
            </div>
          </div>
          <SignOutButton />
        </div>

        {/* Quick links */}
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Link href="/saved" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-pop hover:border-[#0a66c2]/30 transition-colors">
            <Heart className="h-5 w-5 text-[#0a66c2]" />
            <span className="text-sm font-semibold text-[#1a202c]">{tr('Saved listings', 'Tin đã lưu')}</span>
            <ChevronRight className="ml-auto h-4 w-4 text-[#cbd5e1]" />
          </Link>
          {seller && (
            <Link href={`/sellers/${seller.id}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-pop hover:border-[#0a66c2]/30 transition-colors">
              <Store className="h-5 w-5 text-[#0a66c2]" />
              <span className="text-sm font-semibold text-[#1a202c]">{tr('My business profile', 'Hồ sơ doanh nghiệp')}</span>
              <ChevronRight className="ml-auto h-4 w-4 text-[#cbd5e1]" />
            </Link>
          )}
        </div>

        {/* My listings */}
        {seller ? (
          <section className="mt-10">
            <div className="flex items-center gap-2">
              <h2 className="h-section text-[#1a202c]">{tr('My listings', 'Tin của tôi')}</h2>
              {seller.verifiedSeller && (
                <span className="inline-flex items-center gap-1 rounded-xl bg-[#e8f1fb] px-2 py-0.5 text-[11px] font-semibold text-[#0a66c2]">
                  <ShieldCheck className="h-3 w-3" /> {tr('Verified business', 'Doanh nghiệp đã xác minh')}
                </span>
              )}
            </div>
            {listings.length > 0 ? (
              <div className="mt-4"><SellerListings listings={listings} /></div>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-[#cbd5e1] py-10 text-center text-sm text-[#64748b]">
                {tr('No live listings yet — post one to get started.', 'Chưa có tin nào — đăng tin để bắt đầu.')}
              </p>
            )}
          </section>
        ) : account ? (
          <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-pop">
            <h2 className="text-sm font-bold text-[#1a202c]">{tr('Selling on ENO?', 'Bán hàng trên ENO?')}</h2>
            <p className="mt-1 text-sm text-[#64748b]">
              {tr("Post a listing to create your business profile. If you've posted before with your phone number, sign in with that number to claim it.", 'Đăng tin để tạo hồ sơ doanh nghiệp. Nếu bạn đã từng đăng tin bằng số điện thoại, hãy đăng nhập bằng số đó để nhận lại.')}
            </p>
          </section>
        ) : (
          // First load with no cache yet — light skeleton for the listings area.
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-[4/3] w-full rounded-xl shimmer" />
                <div className="h-4 w-2/3 rounded shimmer" />
              </div>
            ))}
          </div>
        )}

        {/* Preferences — mobile only; on desktop the language picker lives in the
            account dropdown (top-right), so it's removed from this page there. */}
        <section className="mt-10 lg:hidden"><LanguagePref /></section>
      </main>
      <Footer />
    </div>
  )
}
