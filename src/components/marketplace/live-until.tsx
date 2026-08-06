'use client'

import { useEffect, useState } from 'react'

/**
 * Renders `children` only while `until` is still in the future, judged by a LIVE clock.
 *
 * ⚠️ WHY THIS EXISTS. The PDP is ISR-cached for 30 days (`revalidate = 2592000` in
 * app/listings/[id]/page.tsx — deliberate, it is a high-cardinality route and real edits
 * revalidate on demand). But two claims on that page are TIME-dependent and were resolved on the
 * server at generation time: the price-drop badge (a 3-day window, DROP.BADGE_MS) and the "Bán gấp"
 * urgent flag. `serialize.ts` computes both against `Date.now()` ONCE, so a page generated while a
 * drop was live keeps advertising it for up to 30 days after the badge expired — the same
 * false-reference-price shape the weekly digest had, on the page that actually sells the item.
 *
 * ⚠️ THE MOUNT DANCE IS DELIBERATE — DO NOT "SIMPLIFY" IT TO AN INLINE COMPARISON. Checking the
 * clock during render would return a different answer on the server (generation time, window open)
 * than on the client (now, window closed), which is a hydration mismatch on the busiest page in the
 * app. Instead both sides render the children, and the effect retracts them a frame later if the
 * window has in fact closed. The lapsed badge is visible for one frame on a stale page; the
 * alternative is a mismatch on every page for every visitor.
 *
 * The interval keeps a long-open tab honest — a buyer sitting on a PDP while the window closes sees
 * it go, rather than being told a discount is live because their page is an hour old.
 */
export function LiveUntil({ until, children }: { until: string | null; children: React.ReactNode }) {
  const [lapsed, setLapsed] = useState(false)

  useEffect(() => {
    if (!until) return
    const at = new Date(until).getTime()
    if (!Number.isFinite(at)) return
    const check = () => setLapsed(Date.now() >= at)
    check()
    // A minute is finer than either window needs (3 days / an urgent run) and costs nothing.
    const t = setInterval(check, 60_000)
    return () => clearInterval(t)
  }, [until])

  if (!until || lapsed) return null
  return <>{children}</>
}
