'use client'

import { useEffect, useState } from 'react'
import { Clock, Footprints, Wallet, Info } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { formatTravel } from '@/lib/travel'
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
}

export function TripDayList({ days, activeDay, onSelectDay, selectedStopId = null, onSelectStop }: Props) {
  const { tr, lang } = useLanguage()
  const listIsBeside = useListIsBesideMap()
  const shown = activeDay === null ? days : days.filter((d) => d.dayNumber === activeDay)

  return (
    <div className="space-y-4">
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
        return (
          <section key={day.dayNumber} aria-labelledby={`trip-day-${day.dayNumber}`} className="space-y-2">
            <header className="flex items-baseline gap-2">
              <h3 id={`trip-day-${day.dayNumber}`} className="text-base font-bold text-foreground">
                {tr(`Day ${day.dayNumber}`, `Ngày ${day.dayNumber}`)} · {day.title}
              </h3>
              <span className="text-xs text-ink-4">{day.area}</span>
            </header>

            <ol className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card">
              {[...day.stops].sort((a, b) => a.position - b.position).map((stop) => {
                const mapped = typeof stop.lat === 'number' && typeof stop.lng === 'number'
                if (mapped) pin += 1
                return (
                  <StopRow
                    key={stop.id}
                    stop={stop}
                    dayNumber={day.dayNumber}
                    pinIndex={mapped ? pin : null}
                    selected={selectedStopId === stop.id}
                    // Only wired when the map is actually beside the list: on a phone the map
                    // is behind a toggle, so "select" would pan something nobody can see while
                    // stealing the tap from the row itself.
                    onSelect={listIsBeside && mapped && onSelectStop ? () => onSelectStop(stop.id) : undefined}
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

function StopRow({ stop, dayNumber, pinIndex, selected, onSelect, lang, tr }: {
  stop: TripStop
  dayNumber: number
  pinIndex: number | null
  selected: boolean
  onSelect?: () => void
  lang: string
  tr: (en: string, vi: string) => string
}) {
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
      {/* A row with no pin still reserves the glyph's width, so every title starts on the same
          x — a ragged left edge reads as broken rather than as "this one isn't mapped". */}
      {pinIndex === null
        ? <span className="h-6 w-[1.15rem] shrink-0" aria-hidden="true" />
        : <StopGlyph index={pinIndex} dayNumber={dayNumber} active={selected} className="mt-0.5" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{stop.name}</p>
        <p className="truncate text-xs text-body">{stop.place}</p>
        {meta}
        {stop.bookingAdvice && (
          <p className="mt-1.5 inline-flex items-start gap-1 text-xs text-ink-4">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{stop.bookingAdvice}</span>
          </p>
        )}
      </div>
    </>
  )

  // A row is only a BUTTON when selecting it does something. A button that does nothing is a
  // promise to a screen reader that this repo's own audit notes get broken more often than kept.
  if (!onSelect) {
    return <li className={cn('flex gap-2.5 px-3 py-3', selected && 'bg-brand/5')}>{body}</li>
  }
  return (
    <li className={cn(selected && 'bg-brand/5')}>
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
