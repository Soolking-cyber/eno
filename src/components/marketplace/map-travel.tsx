'use client'

import { Navigation, Loader2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { estimateTravel, formatTravel, type LatLng } from '@/lib/travel'

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

  if (userLoc) {
    const est = estimateTravel(userLoc, to)
    if (!est) {
      return <span className="text-[11px] text-ink-4">{tr('Too far to estimate', 'Quá xa để ước tính')}</span>
    }
    const { dist, time } = formatTravel(est, l)
    return (
      <span className={`inline-flex items-center gap-1.5 ${compact ? 'text-[11px]' : 'text-xs'} text-muted-foreground`}>
        <Navigation className="h-3.5 w-3.5 shrink-0 text-accent-foreground" />
        <span className="font-bold text-foreground tabular-nums">~{time}</span>
        <span className="text-ink-4">·</span>
        <span className="tabular-nums">{dist} {tr('from you', 'từ bạn')}</span>
      </span>
    )
  }

  if (state === 'denied') {
    return <span className="text-[11px] text-ink-4">{tr('Enable location for travel time', 'Bật vị trí để xem thời gian đi')}</span>
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRequest() }}
      className={`inline-flex items-center gap-1.5 rounded-full ${compact ? 'text-[11px]' : 'text-xs'} font-semibold text-accent-foreground transition-colors hover:underline cursor-pointer`}
    >
      {state === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
      {tr('Travel time from me', 'Thời gian từ chỗ tôi')}
    </button>
  )
}
