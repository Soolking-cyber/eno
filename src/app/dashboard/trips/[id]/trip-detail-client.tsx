'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CalendarDays, MapPin, Loader2, Sparkles, MessageSquare } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CITY_MAP, BUDGETS, type CityId } from '@/lib/itinerary-data'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { TripMap, TripMapDrawer, type TripDay } from '@/components/itinerary/trip-map'
import { TripDayList } from '@/components/itinerary/trip-day-list'
import type { SavedItinerary, SavedItineraryDay } from '../trip-card'

// "My Trips" — one saved itinerary, reopened in full. Deliberately a sibling of
// dashboard/visa/cases-client.tsx: same guest gate, same "your own records" framing, so the two
// dashboard services read as one family rather than two apps.
//
// ⚠️ AUTHORIZATION comes from the endpoint, not from this file. GET /api/itineraries is
// `where: { profileId: auth.profile.id }` and 401s a guest, so another traveller's trip is not
// merely hidden here — it never reaches the browser. The consequence is deliberate: an id that
// belongs to someone else is indistinguishable from one that does not exist, and both render
// "not found". Do not "improve" this by fetching a trip by id from an unscoped route.
//
// ⚠️ Known limit of having no by-id endpoint: the list route is `take: 50`, so a traveller with
// more than 50 saved trips cannot open the 51st. Recorded rather than worked around — the fix is
// a scoped GET /api/itineraries/[id], which is not in this task's file scope.

/** The API's day now carries stops (added when stops began persisting); the shared type predates them. */
type ApiStop = {
  id: string
  position: number
  place: string
  name: string
  time: string | null
  details: string | null
  lat: number | null
  lng: number | null
  travelMinutes: number | null
  estimatedCostVnd: number | null
  bookingAdvice: string | null
}
type ApiDay = SavedItineraryDay & { stops?: ApiStop[] }
type ApiTrip = Omit<SavedItinerary, 'dayPlans'> & { dayPlans: ApiDay[] }

export function TripDetailClient({ id }: { id: string }) {
  const { tr, lang } = useLanguage()
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [trip, setTrip] = useState<ApiTrip | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  // Default to Day 1, not "all days": fitting every day at once on a trip that spans a city and
  // a delta zooms out far enough that same-city pins overlap into an unreadable cluster. One day
  // is the readable view; "All days" stays one tap away.
  const [activeDay, setActiveDay] = useState<number | null>(1)
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  /**
   * Bumped after a successful stop edit to re-run the loader below.
   *
   * ⚠️ A COUNTER, not a second fetch. The loader already handles abort, a 15s timeout, the
   * signed-out gap and the resolve-after-unmount race; a bespoke refetch beside it would be a
   * second, worse copy of all four. Re-reading also means the MAP follows the edit for free —
   * `days` is derived from `trip`, and the map is derived from `days`.
   */
  const [refresh, setRefresh] = useState(0)
  /** Stops with a write in flight, so their own row disables without freezing the others. */
  const [busyStopIds, setBusyStopIds] = useState<ReadonlySet<string>>(new Set())
  const [editError, setEditError] = useState<'stale' | 'failed' | null>(null)

  // Sibling dashboard sections' auth gate — signed-out users go to sign-in and back.
  useEffect(() => {
    if (!authLoading && !user) router.replace(`/signin?next=/dashboard/trips/${encodeURIComponent(id)}`)
  }, [authLoading, user, router, id])

  useEffect(() => {
    // ⚠️ Deliberately does NOT clear `loading` here. It used to, and that produced a one-frame
    // flash of "Trip not found" on the null → signed-in transition: the guest pass set loading
    // false, then `user` became truthy and React rendered once with trip still null BEFORE this
    // effect could re-run. Leaving loading true keeps the spinner across that gap; a real guest
    // never reaches the not-found branch because the render bails on `!user` first.
    if (!user) { setTrip(null); return }
    const req = new AbortController()
    // A fetch that never settles would otherwise spin forever — there is no other timeout on
    // this path. Aborting on our own initiative is distinguished from cleanup-abort by `timedOut`,
    // because the two need opposite handling: one is a failure to report, the other is a no-op.
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; req.abort() }, 15_000)
    setLoading(true)
    fetch('/api/itineraries', { signal: req.signal, cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { itineraries?: ApiTrip[] }) => {
        // Guard the SUCCESS path too: the promise can resolve in the same tick the effect is
        // cleaned up, and this would then write state for a request nobody is waiting for.
        if (req.signal.aborted) return
        const found = (d.itineraries || []).find((t) => t.id === id) ?? null
        setTrip(found)
        setFailed(false)
      })
      .catch((e) => { if (timedOut || (e as Error).name !== 'AbortError') setFailed(true) })
      .finally(() => {
        clearTimeout(timer)
        if (timedOut || !req.signal.aborted) setLoading(false)
      })
    return () => { clearTimeout(timer); req.abort() }
  }, [user, id, refresh])

  /**
   * Every stop edit, through the ONE endpoint that already implements them.
   *
   * ⚠️ NO OPTIMISTIC REORDER. The server owns the permutation because @@unique([dayId, position])
   * makes a swap a transaction rather than two writes, and it answers `stale` when a concurrent
   * edit moved anything. Guessing the new order locally would show an order the database refused.
   *
   * ⚠️ 409 IS "RELOAD", NOT "RETRY" — the route says so explicitly. A second tab moved this day, so
   * the fix is to re-read, which is exactly what the refresh counter does; retrying the same body
   * would interleave two reorders into an order neither person asked for.
   */
  const editStop = useCallback(async (body: Record<string, unknown>, stopId: string) => {
    setBusyStopIds((prev) => new Set(prev).add(stopId))
    setEditError(null)
    try {
      const res = await fetch(`/api/itineraries/${encodeURIComponent(id)}/stops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      if (res.status === 409) { setEditError('stale'); setRefresh((n) => n + 1); return }
      if (!res.ok) { setEditError('failed'); return }
      setRefresh((n) => n + 1)
    } catch {
      setEditError('failed')
    } finally {
      setBusyStopIds((prev) => { const next = new Set(prev); next.delete(stopId); return next })
    }
  }, [id])

  const moveStop = useCallback((dayId: string, stopId: string, toIndex: number) =>
    editStop({ action: 'reorder', dayId, stopId, toIndex }, stopId), [editStop])
  const deleteStop = useCallback((dayId: string, stopId: string) =>
    editStop({ action: 'delete', dayId, stopId }, stopId), [editStop])
  /**
   * Exchange two stops — the last of the route's three actions to get a caller.
   *
   * ⚠️ THROUGH THE SAME `editStop`, deliberately. It already owns the 409-reload, the busy set and
   * the refresh that makes the map follow; a second write path beside it would be a worse copy of
   * all three, and the reason this task exists is that one action had no caller — not that it needed
   * its own plumbing.
   *
   * ⚠️ NOT the same as a reorder. Moving A to C's index shifts everything between them; swapping A
   * and C leaves the rest alone. The server does it in one transaction because
   * @@unique([dayId, position]) makes two writes impossible, which is why the client must not try
   * to express it as two moves.
   */
  const swapStops = useCallback((dayId: string, stopIdA: string, stopIdB: string) =>
    editStop({ action: 'swap', dayId, stopIdA, stopIdB }, stopIdA), [editStop])

  const days: TripDay[] = useMemo(() => {
    if (!trip) return []
    return trip.dayPlans
      .slice()
      .sort((a, b) => a.dayNumber - b.dayNumber)
      .map((day) => ({
        id: day.id,
        dayNumber: day.dayNumber,
        area: (lang === 'vi' ? day.areaVi : null) ?? day.area,
        title: (lang === 'vi' ? day.titleVi : null) ?? day.title,
        stops: (day.stops ?? []).map((s) => ({
          id: s.id,
          position: s.position,
          place: s.place,
          name: s.name,
          time: s.time,
          details: s.details,
          lat: s.lat,
          lng: s.lng,
          travelMinutes: s.travelMinutes,
          estimatedCostVnd: s.estimatedCostVnd,
          bookingAdvice: s.bookingAdvice,
        })),
      }))
  }, [trip, lang])

  // A trip saved before stops began persisting has day prose but no stops. Say so plainly
  // instead of rendering an empty map beside an empty list.
  const hasStops = days.some((d) => d.stops.length > 0)

  // Guest check FIRST, before the spinner: `loading` now stays true for a signed-out visitor
  // (see the effect), so checking the spinner first would park them on a spinner instead of
  // rendering nothing while the redirect runs.
  if (!authLoading && !user) return null // the redirect above is in flight

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-4" />
      </div>
    )
  }

  if (failed || !trip) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <h1 className="text-xl font-bold text-foreground">
          {failed
            ? tr("We couldn't load this trip.", 'Không tải được chuyến đi này.')
            : tr('Trip not found', 'Không tìm thấy chuyến đi')}
        </h1>
        <p className="mt-2 text-sm text-body">
          {failed
            ? tr('Check your connection and try again.', 'Kiểm tra kết nối và thử lại.')
            : tr('It may have been deleted, or it belongs to another account.',
                 'Có thể tin đã bị xóa, hoặc thuộc về tài khoản khác.')}
        </p>
        <Button asChild variant="secondary" className="mt-5">
          <Link href="/dashboard/trips">{tr('Back to my trips', 'Về chuyến đi của tôi')}</Link>
        </Button>
      </div>
    )
  }

  // destinationId is a free string on the row (the forum's builder writes it too), so it is
  // NOT guaranteed to be a known CityId. Look it up defensively and fall back to the raw id
  // rather than asserting a type the database does not enforce.
  const city = CITY_MAP.get(trip.destinationId as CityId)
  const cityName = city ? (lang === 'vi' ? city.nameVi : city.name) : trip.destinationId
  const budget = BUDGETS.find((b) => b.id === trip.budgetId)

  return (
    <div className="pb-6">
      <Button asChild variant="bare" size="none" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-body hover:text-accent-foreground">
        <Link href="/dashboard/trips">
          <ArrowLeft className="h-4 w-4" />
          {tr('My trips', 'Chuyến đi của tôi')}
        </Link>
      </Button>

      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{trip.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-body">
          <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-ink-4" />{cityName}</span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-ink-4" />
            {trip.days === 1 ? tr('1 day', '1 ngày') : tr(`${trip.days} days`, `${trip.days} ngày`)}
          </span>
          {budget && <Badge size="md" className="bg-tint text-body">{lang === 'vi' ? budget.labelVi : budget.label}</Badge>}
          {typeof trip.estimatedBudget === 'number' && trip.estimatedBudget > 0 && (
            <span className="font-semibold text-foreground">
              ≈ {formatMoneyFull(trip.estimatedBudget, '₫', moneyLocale(lang))}
            </span>
          )}
        </div>
      </header>

      {!hasStops ? (
        <div className="rounded-2xl border border-border/70 bg-card p-5">
          <p className="text-sm font-semibold text-foreground">
            {tr('This trip has no mapped stops yet.', 'Chuyến đi này chưa có điểm dừng trên bản đồ.')}
          </p>
          <p className="mt-1.5 text-sm text-body">
            {tr('It was saved before we started keeping each stop separately. Generate it again to get the map and the day-by-day list.',
                'Lịch trình được lưu trước khi chúng tôi tách riêng từng điểm dừng. Hãy tạo lại để có bản đồ và danh sách theo ngày.')}
          </p>
          <Button asChild variant="secondary" className="mt-4">
            <Link href="/dashboard/trips/plan">{tr('Open the planner', 'Mở trình lập kế hoạch')}</Link>
          </Button>
        </div>
      ) : (
        // List-led, ~55/45 against a sticky full-height map (T302's intended composition).
        <div className="lg:grid lg:grid-cols-[55fr_45fr] lg:gap-6">
          <div className="min-w-0">
            {/* Mobile: the map is a MODE, never a squeezed column. */}
            <div className="mb-3 lg:hidden">
              <TripMapDrawer
                days={days}
                activeDay={activeDay}
                selectedStopId={selectedStopId}
                onSelectStop={setSelectedStopId}
              />
            </div>
            {editError && (
              <p role="alert" className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
                {editError === 'stale'
                  ? tr('This day changed somewhere else, so it has been reloaded. Try again.', 'Ngày này đã thay đổi ở nơi khác nên đã được tải lại. Vui lòng thử lại.')
                  : tr('That change could not be saved. Please try again.', 'Không thể lưu thay đổi. Vui lòng thử lại.')}
              </p>
            )}
            <TripDayList
              days={days}
              activeDay={activeDay}
              onSelectDay={setActiveDay}
              selectedStopId={selectedStopId}
              onSelectStop={setSelectedStopId}
              onMoveStop={moveStop}
              onDeleteStop={deleteStop}
              onSwapStops={swapStops}
              busyStopIds={busyStopIds}
            />
            <AssistancePanel itineraryId={trip.id} />
          </div>
          <aside className="hidden lg:block">
            <div className="sticky top-24 h-[calc(100vh-9rem)]">
              <TripMap
                days={days}
                activeDay={activeDay}
                selectedStopId={selectedStopId}
                onSelectStop={setSelectedStopId}
                className="relative h-full w-full overflow-hidden rounded-2xl border border-border/70"
              />
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

/**
 * "Want us to arrange this?" — the assistance offer, now live.
 *
 * ⚠️ NO payment surface here and there must never be one. eno arranges; the traveller pays each
 * supplier directly, and the 10% is quoted BY AN OPERATOR in the chat thread. The request body is
 * `{ itineraryId }` and nothing else — the endpoint's schema is `.strict()` precisely so a caller
 * cannot smuggle an amount, and this component must never grow a field that tries.
 *
 * Opening a case is IDEMPOTENT server-side ("open a case on the caller's OWN itinerary, or return
 * the one that is already open", guarded by an advisory lock), so a second tap re-enters the same
 * thread rather than creating a second case. That is why the button is not disabled after success.
 */
function AssistancePanel({ itineraryId }: { itineraryId: string }) {
  const { tr } = useLanguage()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the case was recorded but no thread could be bound. Deliberately NOT an error state:
  // the case exists, so inviting a retry would ask the traveller to re-request something already
  // on the desk's queue.
  const [recorded, setRecorded] = useState(false)

  const request = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/trips/assistance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ itineraryId }),
      })
      const data = (await res.json().catch(() => ({}))) as { conversationId?: string | null; error?: string }
      if (!res.ok) {
        setError(
          res.status === 429
            ? tr('Too many requests just now — try again in a minute.', 'Quá nhiều yêu cầu — thử lại sau một phút.')
            : res.status === 401
              ? tr('Please sign in again.', 'Vui lòng đăng nhập lại.')
              : tr("We couldn't start that request. Try again.", 'Không gửi được yêu cầu. Thử lại.'),
        )
        return
      }
      // The thread is where the conversation actually happens — go there rather than leaving the
      // traveller on a page that says "requested" with nothing to read.
      if (data.conversationId) { router.push(`/messages/${data.conversationId}`); return }
      setRecorded(true)
    } catch {
      setError(tr('Check your connection and try again.', 'Kiểm tra kết nối và thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="trip-assistance-title"
      className="mt-5 rounded-2xl border border-border/70 bg-card p-5"
    >
      <h2 id="trip-assistance-title" className="flex items-center gap-2 text-base font-bold text-foreground">
        <Sparkles className="h-4 w-4 text-brand" />
        {tr('Want us to arrange this?', 'Muốn chúng tôi lo phần đặt chỗ?')}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-body">
        {tr('Our team can book the stays, transport and tours on this itinerary for you, and be on the other end of a chat while you travel.',
            'Đội ngũ của chúng tôi có thể đặt chỗ ở, di chuyển và tour trong lịch trình này, và luôn sẵn sàng trò chuyện suốt chuyến đi.')}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-body">
        <span className="font-semibold text-foreground">{tr('Service fee: 10%', 'Phí dịch vụ: 10%')}</span>
        {' — '}
        {tr('you pay each hotel, driver and guide directly at their own price. We quote our 10% in the chat before anything is booked, and nothing is charged here.',
            'bạn trả trực tiếp cho từng khách sạn, tài xế và hướng dẫn viên theo giá của họ. Chúng tôi báo phí 10% trong phần trò chuyện trước khi đặt bất cứ thứ gì, và không thu tiền ở đây.')}
      </p>

      {recorded ? (
        <p className="mt-4 rounded-xl bg-tint p-3 text-sm text-body" role="status">
          {tr("Your request is with our trip desk — we'll message you here shortly.",
              'Yêu cầu của bạn đã đến bộ phận chuyến đi — chúng tôi sẽ nhắn cho bạn sớm.')}
        </p>
      ) : (
        <>
          <Button onClick={request} disabled={busy} className="mt-4 w-full gap-2 sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
            {tr('Request assistance', 'Yêu cầu hỗ trợ')}
          </Button>
          <p className="mt-2 text-xs text-ink-4">
            {tr('This opens a chat with our trip desk. Nothing is booked or charged until you say so.',
                'Thao tác này mở cuộc trò chuyện với bộ phận chuyến đi. Không đặt chỗ hay thu phí cho đến khi bạn đồng ý.')}
          </p>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-destructive">{error}</p>}
    </section>
  )
}
