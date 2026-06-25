'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ListingCard } from '@/components/marketplace/listing-card'
import { SavedSearches } from '@/components/marketplace/saved-searches'
import { Mascot } from '@/components/marketplace/mascot'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'

export default function SavedPage() {
  const { count, saved } = useFavorites()
  const { tr } = useLanguage()
  const router = useRouter()
  // Preloaded + cached in FavoritesContext — instant, no fetch-on-open.
  const list = saved ?? []
  const loading = saved === null

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <h1 className="h-title text-foreground mb-1">{tr('Saved', 'Tin đã lưu')}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {count} {tr(count === 1 ? 'saved listing' : 'saved listings', 'tin đã lưu')}
        </p>

        {/* Saved searches (alerts on new matches) — hidden when signed out / none */}
        <SavedSearches />

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-[4/3] w-full rounded-xl shimmer" />
                <div className="h-4 w-2/3 rounded shimmer" />
                <div className="h-3 w-1/2 rounded shimmer" />
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <Mascot name="saved" className="h-52 w-52" />
            <p className="text-base font-semibold text-foreground">
              {tr('No saved listings yet', 'Chưa có tin nào được lưu')}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {tr(
                'Tap the heart on any listing to save it here for later.',
                'Nhấn vào biểu tượng trái tim trên tin đăng để lưu lại xem sau.',
              )}
            </p>
            <Link
              href="/"
              className="mt-2 rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182]"
            >
              {tr('Browse listings', 'Khám phá tin đăng')}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((l, i) => (
              <div key={l.id} onMouseEnter={() => router.prefetch(`/listings/${l.id}`)} onTouchStart={() => router.prefetch(`/listings/${l.id}`)}>
                <ListingCard listing={l} onOpen={() => router.push(`/listings/${l.id}`)} onLocate={() => router.push(`/listings/${l.id}#location-on-map`)} priority={i < 4} />
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
