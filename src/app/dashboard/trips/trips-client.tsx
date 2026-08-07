'use client'

import { useCallback, useEffect, useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw, Route, Sparkles } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Rows, Row } from '@/components/ui/rows'
import { useLatestRequest } from '@/hooks/use-latest-request'
import { SectionHeader } from '@/components/marketplace/section-header'
import { TripCard, type SavedItinerary } from './trip-card'
import { TripPriceDisclaimer } from '@/components/itinerary/trip-price-disclaimer'

/** /dashboard/trips — the Itineraries section opens straight into the planner (owner
 *  2026-07-18: no list-first hop, no /plan sub-page), with the user's saved-itinerary
 *  HISTORY as a feed beneath the builder. Each saved item can be re-downloaded as a
 *  styled Word file. Data is eno.vn's own (Itinerary tables via /api/itineraries); a new
 *  build auto-saves and the feed refreshes in place via the builder's onSaved callback. */
export function TripsClient({ planListingId }: { planListingId: string | null }) {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  // Server-rendered (or previously fetched) data belongs to the account that loaded it.
  // A cross-tab sign-in can swap the session to ANOTHER user while this page sits open
  // (Supabase broadcasts auth changes across tabs). Refresh inside a transition and
  // HIDE the stale payload for its duration — account A's data must never render
  // under account B, not even while the refresh is in flight.
  const [switching, startSwitch] = useTransition()
  const lastUid = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (user?.id && lastUid.current && user.id !== lastUid.current) startSwitch(() => router.refresh())
    if (user?.id) lastUid.current = user.id
  }, [user?.id, router])

  const [trips, setTrips] = useState<SavedItinerary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [opening, setOpening] = useState(false)

  /**
   * "Plan a trip in chat" — go to the CHAT, not to the product page.
   *
   * ⚠️ THIS USED TO LINK TO /listings/<anchor>, WHICH IS THE WRONG DESTINATION and the owner said so
   * (2026-07-27: "clicking plan a trip leads to product page instead of chat"). The button promises
   * a conversation; a listing page is a shop window with its own contact step in the way. This page
   * is auth-gated, so the traveller is definitely signed in and the thread can simply be opened.
   *
   * ⚠️ THROUGH POST /api/conversations, the canonical chokepoint — NOT a bespoke route. It already
   * resolves-or-creates, and since today's fix it reuses only a thread of the SAME kind, so a
   * traveller who also has a visa thread with this desk (visa and trips share one Seller row) lands
   * in their TRIP thread rather than having a visa conversation retargeted underneath them.
   *
   * `message` is deliberately omitted: opening the planner should not post anything on the
   * traveller's behalf. The wizard's own launcher chip is what starts the form.
   */
  const openTripChat = useCallback(async () => {
    if (!planListingId || opening) return
    setOpening(true)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ listingId: planListingId }),
      })
      const data = (await res.json().catch(() => null)) as { id?: string } | null
      if (!res.ok || !data?.id) {
        // Falling back to the listing is honest rather than silent: it is where the desk can still
        // be reached, and it is exactly where this button used to go.
        router.push(`/listings/${planListingId}`)
        return
      }
      router.push(`/messages/${data.id}`)
    } catch {
      router.push(`/listings/${planListingId}`)
    } finally {
      setOpening(false)
    }
  }, [planListingId, opening, router])

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/trips')
  }, [loading, user, router])

  // Stale-async guard via the shared hook (audit Phase 2): the old per-call alive
  // flag handled unmount but not ORDER — a slow first load resolving after a fast
  // onSaved refresh would clobber the fresh feed with stale rows.
  const latest = useLatestRequest()
  const load = useCallback(() => {
    setTrips(null)
    setFailed(false)
    const req = latest.begin()
    fetch('/api/itineraries', { signal: req.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!req.isCurrent()) return
        if (Array.isArray(d.itineraries)) setTrips(d.itineraries)
        else setFailed(true)
      })
      .catch(() => {
        if (req.isCurrent()) setFailed(true)
      })
  }, [latest])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  if (loading || switching || !user) {
    // Content-shaped first paint: the stack title bar + the saved-trips section, not a spinner.
    //
    // ⚠️ NO "BUILDER-SHAPED BLOCK". The `h-56 w-full rounded-2xl` slab that opened this gate
    // stood in for the trip builder, and PLANNING LEFT THIS PAGE on 2026-07-26 (owner: "this
    // should be in chat experience only") — the real page opens straight into "Your saved
    // trips". 224px of skeleton for something that no longer renders.
    //
    // The wrapper is `mt-4 border-t pt-8` (the real <section>), not mt-8/pt-8; the heading is
    // text-xl (28) with a 2-line text-sm lede under it, and the rows are <Row> (py-3) around
    // an h-11 body — the exact shape the in-body skeleton below uses, so the two agree.
    return (
      <div role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        <SectionHeader title={tr('My Trips', 'Chuyến đi của tôi')} />
        <section className="mt-4 border-t border-border pt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <Skeleton className="h-7 w-56 max-w-full rounded-lg" />
              <Skeleton className="mt-1 h-5 w-80 max-w-full rounded-lg" />
              <Skeleton className="mt-1 h-5 w-64 max-w-full rounded-lg lg:hidden" />
            </div>
          </div>
          <div className="mt-5">
            <Rows>
              {Array.from({ length: 2 }).map((_, i) => (
                <Row key={i}><Skeleton className="h-11 rounded-lg" /></Row>
              ))}
            </Rows>
          </div>
        </section>
      </div>
    )
  }

  // ⚠️ PLANNING HAS LEFT THIS PAGE (owner, 2026-07-26: "this should be in chat experience only to
  // plan a trip, and my trips page we have to have saved trips where they can manage"). So the
  // saved feed is no longer conditional on there being something to show — it IS the page, and its
  // empty state has to invite the first plan itself, because the builder that used to do that is
  // gone from here.
  const showFeed = true

  return (
    <>
      {/* Native stack-nav title bar (mobile only) — same established title string. */}
      <SectionHeader title={tr('My Trips', 'Chuyến đi của tôi')} />

      {showFeed && (
        <section aria-labelledby="saved-itineraries-title" className="mt-4 border-t border-border pt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="saved-itineraries-title" className="text-xl font-bold text-foreground">
                {tr('Your saved trips', 'Chuyến đi đã lưu')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {/* ⚠️ "expand one to review it" stopped being true on 2026-07-29 when the rows
                    stopped expanding; it told people to do something the page no longer does. */}
                {tr('Every plan you build is saved here — open one to see it on the map and edit it, or download the Word file.', 'Mỗi kế hoạch bạn tạo được lưu tại đây — mở để xem trên bản đồ và chỉnh sửa, hoặc tải tệp Word.')}
              </p>
            </div>
            {/* ⚠️ THIS LIVED ONLY IN THE EMPTY STATE, WHICH STRANDED EVERY RETURNING TRAVELLER. Once
                planning moved into chat, the empty state's invitation became the ONLY way to reach
                the planner — so the moment a traveller saved their first trip, the door closed
                behind them: the list has no builder, /dashboard/trips/plan redirects back to this
                page, and nothing else here links out. Someone with three saved trips could not start
                a fourth. It belongs beside the heading, where it is reachable in both states. */}
            {planListingId && (
              <Button variant="cta" type="button" disabled={opening} onClick={() => void openTripChat()}>
                {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {tr('Plan a trip in chat', 'Lên kế hoạch qua chat')}
              </Button>
            )}
          </div>

          <div className="mt-5">
            {failed ? (
              <EmptyState
                icon={Route}
                title={tr('Trips could not be loaded.', 'Không thể tải chuyến đi.')}
                action={
                  <Button variant="outline" onClick={load}>
                    <RefreshCw className="h-4 w-4" />
                    {tr('Try again', 'Thử lại')}
                  </Button>
                }
              />
            ) : trips === null ? (
              <Rows>
                {Array.from({ length: 2 }).map((_, i) => (
                  <Row key={i}><Skeleton className="h-11 rounded-lg" /></Row>
                ))}
              </Rows>
            ) : (
              // Flat divided list of expandable itineraries (§3b) — hairlines between rows, no
              // per-item box. TripCard renders each <li>.
              trips.length === 0 ? (
                // ⚠️ THIS REPLACES SOMETHING THAT WAS TAKEN AWAY. The builder used to sit above this
                // list and its own empty state invited the first plan; with planning moved to chat,
                // removing it without this would have left a signed-in traveller staring at a blank
                // page with no way forward.
                <EmptyState
                  icon={Route}
                  title={tr('No saved trips yet', 'Chưa có chuyến đi nào')}
                  subtitle={tr(
                    'Plan a trip in chat with our team, and it will be saved here to manage.',
                    'Lên kế hoạch chuyến đi qua chat với đội ngũ của chúng tôi, và nó sẽ được lưu tại đây để quản lý.',
                  )}
                  action={planListingId ? (
                    <Button variant="cta" type="button" disabled={opening} onClick={() => void openTripChat()}>
                      {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {tr('Plan a trip in chat', 'Lên kế hoạch qua chat')}
                    </Button>
                  ) : undefined}
                />
              ) : (
                <>
                  <Rows>
                    {trips.map((trip) => (
                      <TripCard
                        key={trip.id}
                        trip={trip}
                        // Drop the row locally rather than refetching: the server has already
                        // archived it, and a reload here would flash the whole list for one removal.
                        onDeleted={(id) => setTrips((current) => (current ?? []).filter((t) => t.id !== id))}
                      />
                    ))}
                  </Rows>
                  {/* Under the list, not above it: it qualifies the figures in those rows, and a
                      disclaimer read before there is anything to qualify is just noise. Deliberately
                      NOT rendered on the empty state for the same reason. */}
                  <TripPriceDisclaimer className="mt-4" />
                </>
              )
            )}
          </div>
        </section>
      )}
    </>
  )
}
