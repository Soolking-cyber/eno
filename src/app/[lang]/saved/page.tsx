'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Alert } from '@/components/ui/alert'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { ListingCard } from '@/components/marketplace/listing-card'
import { SavedSearches } from '@/components/marketplace/saved-searches'
import { SavedUnavailableSection } from '@/components/marketplace/saved-unavailable'
import { Mascot } from '@/components/marketplace/mascot'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'
import { ListingCardSkeleton, SAVED_SKELETON_COUNT } from '@/components/marketplace/listing-card-skeleton'
import { LISTING_GRID } from '@/components/marketplace/listing-grid'

export default function SavedPage() {
  const { count, saved, savedUnavailable, savedError, retrySaved } = useFavorites()
  const { tr, lang } = useLanguage()
  // A Vietnamese page goes to the `/vi` home twin, never the English-pinned `/` (A1-LANG).
  const variant = variantOfLanguage(lang)
  const router = useRouter()
  // Preloaded + cached in FavoritesContext — instant, no fetch-on-open.
  const list = saved ?? []
  const loading = saved === null

  return (
    <div className="flex min-h-page flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* ⚠️ "ON THIS DEVICE ONLY" IS TRUE FOR EVERYONE, SIGNED IN OR NOT, AND THAT IS WHY IT IS SAID.
            Saves live in this browser's storage (favorites-context.tsx); there is no server-side list,
            so signing in syncs nothing (price-drop.ts: "server-side favorites don't exist yet"). A
            reader who saves on a phone and looks on a laptop should not have to discover that. Do not
            add a "sign in to sync" nudge until a Favorite table exists — it would be false. */}
        <PageHeader
          className="mb-6"
          title={tr('Saved', 'Tin đã lưu')}
          meta={
            <>
              {count} {tr(count === 1 ? 'saved listing' : 'saved listings', 'tin đã lưu')}
              <span className="text-ink-4"> · {tr('on this device only', 'chỉ trên thiết bị này')}</span>
            </>
          }
        />

        {/* Saved searches (alerts on new matches) — hidden when signed out / none */}
        <SavedSearches />

        {/* A partial load must say so. With the saved set chunked across several requests, one
            failing chunk leaves a shorter grid that is indistinguishable from having unsaved
            things — the one reading a user acts on by re-saving what they already had.
            ⚠️ AN ALERT ROW, NOT THE FAULT BLOCK: the cards that DID load are right below it, so
            this is a caution over content (ui/alert warning, flat), not a page that failed. The
            hand-rolled row it replaces painted `bg-surface`, a colour no token defines — it drew
            nothing (D-STATES / D-TOKENS, 2026-09-29). */}
        {savedError && !loading ? (
          <Alert
            tone="warning"
            appearance="flat"
            className="mb-4"
            icon={<AlertTriangle className="h-4 w-4" />}
            action={
              <Button variant="cta" size="sm" onClick={retrySaved}>
                {tr('Try again', 'Thử lại')}
              </Button>
            }
          >
            {tr("Some saved listings couldn't be loaded.", 'Một số tin đã lưu không tải được.')}
          </Alert>
        ) : null}

        {loading && savedError ? (
          // Fetch failed with no cache — an error must NOT read as endless loading. The FAULT coin
          // (neutral disc, destructive ink), never the brand's warm "nothing here yet" one: the
          // product let the reader down here (icon-language §6). `bare`: the flat canon, no box.
          <EmptyState
            tone="bare"
            variant="fault"
            icon={AlertTriangle}
            title={<span role="alert">{tr("Couldn't load listings.", 'Không tải được tin đăng.')}</span>}
            action={
              <Button variant="cta" onClick={retrySaved}>
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
          <div className={LISTING_GRID}>
            {Array.from({ length: count > 0 ? Math.min(count, 24) : SAVED_SKELETON_COUNT }).map((_, i) => (
              <ListingCardSkeleton key={i} />
            ))}
          </div>
        ) : list.length === 0 && savedUnavailable.length === 0 ? (
          // ⚠️ BOTH lists, not the grid alone: with every save sold or expired the grid is empty while the
          // header still counts them, and "No saved listings yet" under "3 saved listings" contradicts
          // itself — they are listed under "No longer available" below instead.
          // The shared mascot-led empty state (tone="bare") — same treatment as the
          // messenger's placeholder, so the two quiet surfaces speak with one voice.
          <EmptyState
            tone="bare"
            size="lg"
            className="py-20"
            media={<Mascot name="saved" className="h-52 w-52" />}
            title={tr('No saved listings yet', 'Chưa có tin nào được lưu')}
            // Pointer-neutral ("Tap" is wrong on a desktop); the Vietnamese "Nhấn" already is.
            subtitle={tr(
              'Save a listing with the heart and it will wait for you here.',
              'Nhấn vào biểu tượng trái tim trên tin đăng để lưu lại xem sau.',
            )}
            action={
              <Button asChild variant="cta" size="none">
                <Link href={localizedHref('/', variant)} className="px-5 py-2.5">
                  {tr('Browse listings', 'Khám phá tin đăng')}
                </Link>
              </Button>
            }
          />
        ) : (
          <>
            {list.length > 0 && (
              <div className={LISTING_GRID}>
                {list.map((l, i) => (
                  <div key={l.id} onMouseEnter={() => router.prefetch(`/listings/${l.id}`)} onTouchStart={() => router.prefetch(`/listings/${l.id}`)}>
                    <ListingCard listing={l} onOpen={() => router.push(`/listings/${l.id}`)} onLocate={() => router.push(localizedHref(`/?focus=${l.id}`, variant))} priority={i < 4} />
                  </div>
                ))}
              </div>
            )}
            {/* Saves whose listing sold or expired: kept, apart from the grid (saved-unavailable.tsx). */}
            <SavedUnavailableSection items={savedUnavailable} />
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
