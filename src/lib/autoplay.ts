import { inAppHost } from '@/lib/in-app-browser'

// Whether this visitor/device should get muted video autoplay at all. Respects reduced-motion
// users and metered/slow connections (Save-Data, 2g) — they get posters + an explicit play
// affordance instead. Shared by the PDP gallery video and the card autoplay.
//
// ⛔ NOT INSIDE ANOTHER APP'S IN-APP BROWSER (owner, 2026-11-25: "in zalo videos auto full screen and play on scroll
// annoying"). An iOS in-app WebView often does not allow inline playback (WKWebView's allowsInlineMediaPlayback is false by
// default), so any play(), even muted with playsinline, takes over the whole screen: in Zalo every card that settled in view
// went fullscreen as the reader scrolled. A clip starting by itself is unwanted there in any case. Such a visitor gets the
// cover and the explicit play affordance, like Save-Data. Google's app ('google', GSA) browses like a browser and keeps it;
// eno's own app is never an in-app browser here (inAppHost returns null inside it).
export function autoplayAllowed(): boolean {
  if (typeof window === 'undefined') return false
  const host = inAppHost()
  if (host && host !== 'google') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  type NetInfo = { saveData?: boolean; effectiveType?: string }
  const conn = (navigator as Navigator & { connection?: NetInfo }).connection
  if (conn?.saveData) return false
  if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return false
  return true
}
