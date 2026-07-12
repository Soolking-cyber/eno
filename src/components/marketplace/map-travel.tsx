'use client'

import { Navigation, Loader2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { estimateTravel, formatTravel, type LatLng } from '@/lib/travel'

// The Google Maps pin mark — a small inline SVG (lucide has no brand logos). Recognisable
// "open in Google Maps" cue; the brand red is fine here, same as we show the Zalo blue.
function GoogleMapsPin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <path d="M12 2.5c-3.9 0-7 3.02-7 6.75 0 4.9 7 12.25 7 12.25s7-7.35 7-12.25c0-3.73-3.1-6.75-7-6.75z" fill="#EA4335" />
      <circle cx="12" cy="9.25" r="2.6" fill="#fff" />
    </svg>
  )
}

/** Google Maps "directions" deep link to the listing. Destination-only on purpose:
 *  Google Maps auto-fills the ORIGIN with the device's live location (trip ready, tap &
 *  go) and the user's coordinates never touch the URL. */
function directionsUrl(to: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=driving`
}

/** Standalone Google Maps directions FAB — positioned by the caller (e.g. absolute in the
 *  map popup card's bottom-right corner). Tap opens directions to the listing, ready to go. */
export function MapsDirectionsButton({ to, className = '' }: { to: LatLng; className?: string }) {
  const { tr } = useLanguage()
  return (
    <a
      href={directionsUrl(to)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={tr('Get directions in Google Maps', 'Chỉ đường trong Google Maps')}
      title={tr('Directions in Google Maps', 'Chỉ đường trong Google Maps')}
      className={`press inline-flex items-center justify-center rounded-full bg-card shadow-pop ring-1 ring-border transition-transform hover:scale-105 active:scale-90 ${className}`}
    >
      <GoogleMapsPin className="h-[18px] w-[18px]" />
    </a>
  )
}

// Shown inside the map popup card: a rough "how far is this from me" — travel time +
// road distance from the viewer's location to the listing. Reuses the "search near you"
// location when it's already known (no re-prompt); otherwise a small button asks for it.
export function MapTravel({
  to, userLoc, state, onRequest, compact = false,
}: {
  to: LatLng
  userLoc: LatLng | null
  state: 'idle' | 'loading' | 'denied'
  onRequest: () => void
  compact?: boolean
}) {
  const { lang, tr } = useLanguage()
  const l = lang === 'vi' ? 'vi' : 'en'

  // Estimate text only — the Google Maps directions button is a separate FAB
  // (<MapsDirectionsButton>) the caller floats in the card's bottom-right corner.
  if (userLoc) {
    const est = estimateTravel(userLoc, to)
    if (!est) {
      return <span className="text-2xs text-ink-4">{tr('Too far to estimate', 'Quá xa để ước tính')}</span>
    }
    const { dist, time } = formatTravel(est, l)
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${compact ? 'text-2xs' : 'text-xs'} text-muted-foreground`}>
        <Navigation className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />
        <span className="font-bold text-foreground tabular-nums">~{time}</span>
        <span className="text-ink-4">·</span>
        <span className="tabular-nums">{dist} {tr('from you', 'từ bạn')}</span>
      </span>
    )
  }

  if (state === 'denied') {
    return <span className="text-2xs text-ink-4">{tr('Enable location for travel time', 'Bật vị trí để xem thời gian đi')}</span>
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRequest() }}
      className={`inline-flex items-center gap-1.5 rounded-full ${compact ? 'text-2xs' : 'text-xs'} font-semibold text-accent-foreground transition-colors hover:underline cursor-pointer`}
    >
      {state === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
      {tr('Travel time from me', 'Thời gian từ chỗ tôi')}
    </button>
  )
}
