/**
 * Warm a listing's page before the click, so it opens without waiting on the server (a mouse over the card, or keyboard
 * focus on it). Owner, 2026-11-07: listings "open almost instantly on desktop".
 * · ONCE PER ROUTE PER FIVE MINUTES, wherever its card is drawn — the feed grid, a rail on the listing page, a shelf:
 *   `onFocus` bubbles once per focusable descendant and a fast mouse sweep crosses many cards, and `router.prefetch`
 *   caches too, but not before paying the call (listings-explorer.tsx's prefetchListing note). Five minutes is Next's
 *   own lifetime for a prefetched page, so a card hovered again after that is warmed again rather than never.
 * · NOT ON TOUCH (the callers' rule): a finger that lands on a card is usually starting a scroll, and warming every card
 *   a thumb crosses would render a listing page on the box per card. The feed grid keeps its own touchstart warm-up.
 */
const WARM_MS = 5 * 60_000
const warmed = new Map<string, number>()

export function warmListing(router: { prefetch: (href: string) => void }, id: string, now: number = Date.now()): void {
  const at = warmed.get(id)
  if (at !== undefined && now - at < WARM_MS) return
  warmed.set(id, now)
  if (warmed.size > 500) for (const [k, t] of warmed) if (now - t >= WARM_MS) warmed.delete(k)
  router.prefetch(`/listings/${id}`)
}
