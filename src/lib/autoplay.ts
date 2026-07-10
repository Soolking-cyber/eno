// Whether this visitor/device should get muted video autoplay at all. Respects reduced-motion
// users and metered/slow connections (Save-Data, 2g) — they get posters + an explicit play
// affordance instead. Shared by the PDP gallery video, the card autoplay, and the video feed.
export function autoplayAllowed(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  type NetInfo = { saveData?: boolean; effectiveType?: string }
  const conn = (navigator as Navigator & { connection?: NetInfo }).connection
  if (conn?.saveData) return false
  if (conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return false
  return true
}
