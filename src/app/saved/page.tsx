'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ListingCard } from '@/components/marketplace/listing-card'
import { SavedSearches } from '@/components/marketplace/saved-searches'
import { Mascot } from '@/components/marketplace/mascot'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { ListingCardSkeleton, SAVED_SKELETON_COUNT } from '@/components/marketplace/listing-card-skeleton'

export default function SavedPage() {
  const { count, saved, savedError, retrySaved } = useFavorites()
  const { tr } = useLanguage()
  const router = useRouter()
  // Preloaded + cached in FavoritesContext — instant, no fetch-on-open.
  const list = saved ?? []
  const loading = saved === null

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        <h1 className="h-title text-foreground mb-1">{tr('Saved', 'Tin đã lưu')}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {count} {tr(count === 1 ? 'saved listing' : 'saved listings', 'tin đã lưu')}
        </p>

        {/* Saved searches (alerts on new matches) — hidden when signed out / none */}
        <SavedSearches />

        {loading && savedError ? (
          // Fetch failed with no cache — an error must NOT read as endless loading.
          <EmptyState
            icon={AlertTriangle}
            title={tr("Couldn't load listings.", 'Không tải được tin đăng.')}
            action={
              <Button variant="cta" size="none" onClick={retrySaved} className="rounded-xl px-4 py-2 text-xs transition-colors cursor-pointer">
                {tr('Try again', 'Thử lại')}
              </Button>
            }
          />
        ) : loading ? (
          // Reserve the REAL grid height while loading: one placeholder per saved item
          // (count is known from the device-local favorites set, which loads before the
          // listings fetch), each matching a card's height — so no layout shift (CLS)
          // when the actual cards swap in.
          // ⚠️ THE FLOOR IS SAVED_SKELETON_COUNT, NOT 2, AND IT IS SHARED WITH
          // saved/loading.tsx. FavoritesContext fills `ids` in an effect, so on a HARD load
          // of this route `count` is 0 for the first client render — the old floor of 2 made
          // that paint two cards directly under the route skeleton's eight, then grow to the
          // real number. Three stages, two jumps, from two hand-typed literals. Reading the
          // same constant means the pre-hydration paint is identical to the route skeleton
          // and only the real count moves anything.
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: count > 0 ? Math.min(count, 24) : SAVED_SKELETON_COUNT }).map((_, i) => (
              <ListingCardSkeleton key={i} />
            ))}
          </div>
        ) : list.length === 0 ? (
          // The shared mascot-led empty state (tone="bare") — same treatment as the
          // messenger's placeholder, so the two quiet surfaces speak with one voice.
          <EmptyState
            tone="bare"
            size="lg"
            className="py-20"
            media={<Mascot name="saved" className="h-52 w-52" />}
            title={tr('No saved listings yet', 'Chưa có tin nào được lưu')}
            subtitle={tr(
              'Tap the heart on any listing to save it here for later.',
              'Nhấn vào biểu tượng trái tim trên tin đăng để lưu lại xem sau.',
            )}
            action={
              <Button asChild variant="cta" size="none">
                <Link href="/" className="px-5 py-2.5">
                  {tr('Browse listings', 'Khám phá tin đăng')}
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((l, i) => (
              <div key={l.id} onMouseEnter={() => router.prefetch(`/listings/${l.id}`)} onTouchStart={() => router.prefetch(`/listings/${l.id}`)}>
                <ListingCard listing={l} onOpen={() => router.push(`/listings/${l.id}`)} onLocate={() => router.push(`/?focus=${l.id}`)} priority={i < 4} />
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
