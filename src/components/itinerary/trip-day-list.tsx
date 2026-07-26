'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Clock, Footprints, Loader2, MapPinOff, Navigation, Route, Search, Trash2, Wallet, Info } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { formatTravel } from '@/lib/travel'
import { openExternal } from '@/lib/native-browser'
import { dayRouteLink, stopMapsLink } from '@/lib/itinerary-maps-links'
import { PIN_PATH, PIN_VIEWBOX, dayColor, type TripDay, type TripStop } from './trip-map'

// The list half of the trip view. List-LED on purpose: an itinerary is read as a sequence of
// days, and the map is the supporting reference — the opposite weighting to the marketplace
// explorer, where the map leads. T303 composes this at ~55% against a ~45% sticky map.


/**
 * "13 min" / "13 phút" from a bare minute count.
 *
 * Reuses the repo's own formatTravel rather than re-implementing the localised unit strings —
 * a second copy of "min"/"phút"/"h" is exactly how those drift apart. Only `.time` is read, and
 * that depends solely on `minutes`, so the distance fields are irrelevant here.
 */
const travelTime = (minutes: number, lang: string): string =>
  formatTravel({ straightKm: 0, roadKm: 0, minutes }, lang === 'vi' ? 'vi' : 'en').time

/**
 * The SAME teardrop as the map pin, small and inline.
 *
 * ⚠️ Geometry is imported from trip-map.tsx rather than copied, so the two cannot drift: a stop
 * numbered 2 in blue on the map must be visibly the same object as the ⑵ beside its list row.
 * That pairing is the whole navigational trick of this screen — without it the reader has to
 * match rows to pins by reading place names.
 */
export function StopGlyph({ index, dayNumber, active = false, className }: {
  index: number
  dayNumber: number
  active?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox={PIN_VIEWBOX}
      className={cn('h-6 w-[1.15rem] shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* design-lint-allow: raw hex — this glyph MIRRORS the map pin exactly, so it must use the
          pin's theme-independent colours; a token here would break the match it exists to make. */}
      <path d={PIN_PATH} fill={dayColor(dayNumber)} stroke={active ? '#ffffff' : 'rgba(255,255,255,.9)'} strokeWidth={active ? 3 : 2} /> {/* design-lint-allow: raw hex — mirrors the theme-independent map pin */}
      <text x="13" y="17.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#ffffff"> {/* design-lint-allow: raw hex — matches the pin numeral */}
        {index}
      </text>
    </svg>
  )
}

/**
 * True when the map sits BESIDE this list rather than behind a "Map view" toggle.
 *
 * ⚠️ Gated on LAYOUT (min-width:1024px), never on `hover:hover`. listings-map.tsx records
 * getting this exact thing wrong in BOTH directions: a touchscreen laptop took the desktop
 * branch on a finger tap, and a narrow desktop window took it while the list sat below the map.
 * What matters is whether the map is on screen next to the row you just tapped — that is a
 * layout question. Read live (not captured once) so a resize is honoured.
 */
function useListIsBesideMap() {
  const [beside, setBeside] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const sync = () => setBeside(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return beside
}

type Props = {
  days: TripDay[]
  activeDay: number | null
  onSelectDay: (dayNumber: number | null) => void
  selectedStopId?: string | null
  /** Called only when the map is beside the list — see useListIsBesideMap. */
  onSelectStop?: (stopId: string) => void
  /**
   * Stop editing. BOTH optional and passed together — the controls render only when the surface
   * can actually perform them, so the read-only embeds (the landing page, a shared plan) get the
   * list they have today with no edit chrome.
   *
   * `toIndex` is the target position WITHIN the day; the server owns the permutation, because
   * @@unique([dayId, position]) makes "swap two rows" a transaction, not two writes.
   */
  onMoveStop?: (dayId: string, stopId: string, toIndex: number) => void | Promise<void>
  onDeleteStop?: (dayId: string, stopId: string) => void | Promise<void>
  /** Ids currently being written, so a row can disable itself without the parent re-rendering all. */
  busyStopIds?: ReadonlySet<string>
}

export function TripDayList({ days, activeDay, onSelectDay, selectedStopId = null, onSelectStop, onMoveStop, onDeleteStop, busyStopIds }: Props) {
  const { tr, lang } = useLanguage()
  const listIsBeside = useListIsBesideMap()
  const shown = activeDay === null ? days : days.filter((d) => d.dayNumber === activeDay)

  const rootRef = useRef<HTMLDivElement>(null)
  // Mirrors the map's guard, for the same reason: selection is shared state, so a row click comes
  // back down as a changed `selectedStopId`. Scrolling on that would yank the list under the
  // finger that just tapped it.
  const selfSelectRef = useRef<string | null>(null)

  // A pin tapped on the map reveals its row here. `block: 'nearest'` scrolls the minimum needed,
  // so a row already on screen does not move at all.
  useEffect(() => {
    const cameFromThisList = selfSelectRef.current === selectedStopId
    selfSelectRef.current = null
    if (!selectedStopId || cameFromThisList || !rootRef.current) return
    const row = rootRef.current.querySelector(`[data-stop-id="${CSS.escape(selectedStopId)}"]`)
    // ⚠️ Honour reduced-motion. A programmatic smooth scroll is exactly the involuntary movement
    // that setting exists to suppress, and `behavior: 'smooth'` overrides it unless asked. (codex.)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [selectedStopId])

  return (
    <div ref={rootRef} className="space-y-4">
      {/* Day navigation. "All days" first so the default view is the whole trip. */}
      {/* A GROUP of toggles, not a tablist. `role="tab"` promises a `tabpanel` with
          `aria-controls`, and there is none — "All days" renders several sections at once, so no
          single panel exists to point at. A lying role is worse than a plain one, and the pages
          the a11y suite audits do not include this screen, so nothing would have caught it. */}
      <div
        role="group"
        aria-label={tr('Filter by day', 'Lọc theo ngày')}
        className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1"
      >
        <DayTab active={activeDay === null} onClick={() => onSelectDay(null)}>
          {tr('All days', 'Tất cả')}
        </DayTab>
        {days.map((day) => (
          <DayTab key={day.dayNumber} active={activeDay === day.dayNumber} onClick={() => onSelectDay(day.dayNumber)}>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: dayColor(day.dayNumber) }} aria-hidden="true" />
              {tr(`Day ${day.dayNumber}`, `Ngày ${day.dayNumber}`)}
            </span>
          </DayTab>
        ))}
      </div>

      {shown.map((day) => {
        // Numbering counts only MAPPED stops so the list's ⑵ is the map's pin 2. An unmapped
        // stop still gets a row — it is a real part of the itinerary — but no number, because a
        // number that matches no pin is worse than none.
        let pin = 0
        // Sorted ONCE per day: the rows need it, and so does each row's "can I move down?" test.
        const ordered = [...day.stops].sort((a, b) => a.position - b.position)
        return (
          <section key={day.dayNumber} aria-labelledby={`trip-day-${day.dayNumber}`} className="space-y-2">
            <header className="flex items-baseline gap-2">
              <h3 id={`trip-day-${day.dayNumber}`} className="text-base font-bold text-foreground">
                {tr(`Day ${day.dayNumber}`, `Ngày ${day.dayNumber}`)} · {day.title}
              </h3>
              <span className="text-xs text-ink-4">{day.area}</span>
              <DayRouteButton day={day} />
            </header>

            <ol className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card">
              {ordered.map((stop, index) => {
                const mapped = typeof stop.lat === 'number' && typeof stop.lng === 'number'
                if (mapped) pin += 1
                return (
                  <StopRow
                    cityName={day.area}
                    key={stop.id}
                    stop={stop}
                    dayNumber={day.dayNumber}
                    // Edit wiring. `index` is the row's position among the day's SORTED stops,
                    // which is what the server's toIndex means — not stop.position, which can be
                    // sparse after a delete.
                    canMoveUp={index > 0}
                    canMoveDown={index < ordered.length - 1}
                    busy={busyStopIds?.has(stop.id) ?? false}
                    onMoveUp={onMoveStop ? () => onMoveStop(day.id, stop.id, index - 1) : undefined}
                    onMoveDown={onMoveStop ? () => onMoveStop(day.id, stop.id, index + 1) : undefined}
                    onDelete={onDeleteStop ? () => onDeleteStop(day.id, stop.id) : undefined}
                    pinIndex={mapped ? pin : null}
                    selected={selectedStopId === stop.id}
                    // Only wired when the map is actually beside the list: on a phone the map
                    // is behind a toggle, so "select" would pan something nobody can see while
                    // stealing the tap from the row itself.
                    // ⚠️ Sentinel armed ONLY when the selection will change — re-tapping the row
                    // that is already selected sets state to the value it already holds, React
                    // bails out, and the effect that clears the sentinel never runs. See the map's
                    // matching note. (Found by agy.)
                    //
                    // ⚠️ KNOWN, and it needs the PARENT: because that re-tap is a no-op all the way
                    // through, tapping an already-selected row does not re-centre a map the reader
                    // has since panned away. Fixing it means the parent holding something that
                    // changes on every pick (an {id, nonce}) instead of a bare id —
                    // trip-detail-client.tsx, which is not this task's file.
                    onSelect={listIsBeside && mapped && onSelectStop
                      ? () => {
                        if (selectedStopId !== stop.id) selfSelectRef.current = stop.id
                        onSelectStop(stop.id)
                      }
                      : undefined}
                    lang={lang}
                    tr={tr}
                  />
                )
              })}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function DayTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      aria-pressed={active}
      variant="bare"
      size="none"
      onClick={onClick}
      className={cn(
        'shrink-0 snap-start rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors',
        active ? 'bg-primary text-white' : 'bg-tint text-body hover:bg-line-strong',
      )}
    >
      {children}
    </Button>
  )
}

function StopRow({
  stop, cityName, dayNumber, pinIndex, selected, onSelect, lang, tr,
  canMoveUp, canMoveDown, busy, onMoveUp, onMoveDown, onDelete,
}: {
  stop: TripStop
  cityName: string
  dayNumber: number
  pinIndex: number | null
  selected: boolean
  onSelect?: () => void
  lang: string
  tr: (en: string, vi: string) => string
  canMoveUp?: boolean
  canMoveDown?: boolean
  busy?: boolean
  onMoveUp?: () => void | Promise<void>
  onMoveDown?: () => void | Promise<void>
  onDelete?: () => void | Promise<void>
}) {
  // Editing is offered only when the surface passed handlers for it.
  const editable = Boolean(onMoveUp || onMoveDown || onDelete)
  const meta = (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-4">
      {stop.time && (
        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{stop.time}</span>
      )}
      {typeof stop.travelMinutes === 'number' && stop.travelMinutes > 0 && (
        <span className="inline-flex items-center gap-1"><Footprints className="h-3 w-3" />{travelTime(stop.travelMinutes, lang)}</span>
      )}
      {typeof stop.estimatedCostVnd === 'number' && stop.estimatedCostVnd > 0 && (
        <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" />{formatMoneyFull(stop.estimatedCostVnd, '₫', moneyLocale(lang))}</span>
      )}
    </div>
  )

  const body = (
    <>
      {/* A row with no pin still occupies the glyph's width, so every title starts on the same
          x — a ragged left edge reads as broken rather than as "this one isn't mapped". */}
      {pinIndex === null
        ? <MapPinOff className="mt-1 h-4 w-[1.15rem] shrink-0 text-ink-4" aria-hidden="true" />
        : <StopGlyph index={pinIndex} dayNumber={dayNumber} active={selected} className="mt-0.5" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{stop.name}</p>
        <p className="truncate text-xs text-body">{stop.place}</p>
        {/* ⚠️ SAY IT, do not just draw fewer pins. An unmapped stop used to differ from a mapped
            one by a blank space, so a trip whose coordinates had not been resolved looked like a
            map that had lost half the itinerary. It is a real stop; what is missing is a location
            we could resolve, and that is a sentence, not an absence. */}
        {pinIndex === null && (
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-tint px-1.5 py-0.5 text-3xs font-bold text-ink-4">
            <MapPinOff className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            {tr('Not on the map yet', 'Chưa có trên bản đồ')}
          </p>
        )}
        {/* ⚠️ SHOWN FOR AN UNMAPPED STOP TOO — that is the point of the feature, not an oversight.
            Refusing to draw a false pin on OUR map is not a reason to withhold the tool that might
            actually find the place, so an unmapped row shows both: "not on the map yet", and a way
            to go there anyway. */}
        <div className="mt-1.5 -ml-2">
          <StopMapsButton stop={stop} cityName={cityName} />
        </div>
        {meta}
        {stop.bookingAdvice && (
          <p className="mt-1.5 inline-flex items-start gap-1 text-xs text-ink-4">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{stop.bookingAdvice}</span>
          </p>
        )}
        {/* ⚠️ EDIT CONTROLS, and they are the reason this whole task exists: the server has had
            reorder/swap/delete with tests since T316 and NOTHING called it (owner, 2026-07-26:
            "how do we edit here activities we want to swap").

            ⚠️ `stopPropagation` on every one. When the map sits beside the list the row itself is a
            button that selects the stop, so a bare click here would both reorder AND pan the map —
            two outcomes from one tap, one of them unasked for.

            ⚠️ Move is expressed as up/down rather than drag: a drag needs pointer capture inside a
            row that is already a button and already scroll-sensitive, and the server's contract is
            an INDEX, which up/down expresses exactly. Delete is destructive and last, separated. */}
        {editable && (
          <div className="mt-2 -ml-1 flex items-center gap-0.5">
            <IconButton
              aria-label={tr('Move earlier in the day', 'Chuyển lên sớm hơn')}
              disabled={busy || !canMoveUp}
              onClick={(e) => { e.stopPropagation(); void onMoveUp?.() }}
              className="tap-44 h-7 w-7 text-ink-4"
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </IconButton>
            <IconButton
              aria-label={tr('Move later in the day', 'Chuyển xuống muộn hơn')}
              disabled={busy || !canMoveDown}
              onClick={(e) => { e.stopPropagation(); void onMoveDown?.() }}
              className="tap-44 h-7 w-7 text-ink-4"
            >
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </IconButton>
            <IconButton
              aria-label={tr('Remove this activity', 'Xóa hoạt động này')}
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); void onDelete?.() }}
              className="tap-44 ml-1 h-7 w-7 text-ink-4 hover:text-destructive"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
            </IconButton>
          </div>
        )}
      </div>
    </>
  )

  // A row is only a BUTTON when selecting it does something. A button that does nothing is a
  // promise to a screen reader that this repo's own audit notes get broken more often than kept.
  // ⚠️ `data-stop-id` is on the <li> in BOTH branches — the map→list scroll must find the row for
  // a stop the map can show, and that is unrelated to whether this row happens to be clickable.
  if (!onSelect) {
    return <li data-stop-id={stop.id} className={cn('flex gap-2.5 px-3 py-3', selected && 'bg-brand/5')}>{body}</li>
  }
  return (
    <li data-stop-id={stop.id} className={cn(selected && 'bg-brand/5')}>
      <Button
        type="button"
        variant="bare"
        size="none"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={tr(`Show ${stop.place} on the map`, `Xem ${stop.place} trên bản đồ`)}
        className="flex w-full gap-2.5 px-3 py-3 text-left transition-colors hover:bg-tint/60"
      >
        {body}
      </Button>
    </li>
  )
}

/**
 * "Directions" for a whole day, and for one stop.
 *
 * ⚠️ EVERY LINK GOES THROUGH openExternal(). A bare target="_blank" opens INSIDE the Capacitor
 * WebView and traps the traveller in the app with no way back — which is the worst possible outcome
 * for a button whose entire job is to hand them off to their phone's navigation.
 *
 * These are buttons, not anchors, for that reason: an anchor invites the browser to navigate before
 * the handler can route it. (Same reason the Share popover uses buttons.)
 */
function DayRouteButton({ day }: { day: TripDay }) {
  const { tr } = useLanguage()
  // day.area is the city label the generator wrote ("Ho Chi Minh City") — the qualifier a name
  // needs so Google's resolver has something to narrow on.
  const route = dayRouteLink(day.stops, day.area)
  if (!route) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      className="ml-auto shrink-0 text-xs"
      onClick={() => void openExternal(route.url)}
      // Truncation is SAID, never silent: a long day routes its first stops and the label admits it,
      // rather than emitting a URL Google rejects or quietly dropping the middle of someone's day.
      title={route.truncated
        ? tr(`Route covers the first ${route.includedCount} stops`, `Tuyến đi gồm ${route.includedCount} điểm đầu tiên`)
        : undefined}
    >
      <Route className="h-3.5 w-3.5" />
      {route.truncated
        ? tr(`Route (first ${route.includedCount})`, `Tuyến (${route.includedCount} điểm đầu)`)
        : tr('Route this day', 'Chỉ đường cả ngày')}
    </Button>
  )
}

function StopMapsButton({ stop, cityName }: { stop: TripStop; cityName: string }) {
  const { tr } = useLanguage()
  const link = stopMapsLink(stop, cityName)
  if (!link) return null
  const isSearch = link.kind === 'search'
  return (
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0 text-xs"
      onClick={(event) => { event.stopPropagation(); void openExternal(link.url) }}
      // An ambiguous name gets SEARCH, and the label says so: "Directions" on a name Google would
      // pick for us would promise a certainty this stop does not have.
      title={isSearch
        ? tr('This stop names more than one place — search instead', 'Điểm này nêu nhiều địa điểm — hãy tìm kiếm')
        : undefined}
    >
      {isSearch ? <Search className="h-3.5 w-3.5" /> : <Navigation className="h-3.5 w-3.5" />}
      {isSearch ? tr('Find', 'Tìm') : tr('Directions', 'Chỉ đường')}
    </Button>
  )
}
