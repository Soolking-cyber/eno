'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { HEARTBEAT_MS, hasAnyStat } from '@/lib/site-stats-shared'
import type { SiteStats } from '@/lib/site-stats-shared'

/**
 * The four live numbers at the foot of every page: total visitors, who is here now, members, and
 * sellers. Inspired by the here/now visitor counter, extended with the two community counts.
 *
 * ⛔ IT RESERVES ITS HEIGHT AND RENDERS NOTHING UNTIL IT HAS DATA. This sits at the bottom of every
 * page on the site, so a row that appears when a fetch resolves would shift the footer under
 * whatever the reader is reaching for — the same tap-target-moves failure the sign-in switches
 * reserve space to prevent. `min-h` holds the row from first paint; the contents fade in.
 *
 * ⚠️ A ZERO IS RENDERED AS ABSENT, not as "0". The endpoint fails open to zeros on a database
 * hiccup or a throttle, so a zero means "no answer", not "nobody" — printing it would state
 * something false about the site with total confidence.
 */
export function FooterStats() {
  const { tr, lang } = useLanguage()
  const [stats, setStats] = useState<SiteStats | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    const ac = new AbortController()

    const ping = () => {
      // ⚠️ Never while hidden. A backgrounded tab that keeps heartbeating reports itself as a
      // person in the room, so "here now" would count everyone's abandoned tabs as an audience.
      if (document.visibilityState !== 'visible') return
      fetch('/api/site-stats', { method: 'POST', signal: ac.signal, cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: SiteStats | null) => {
          // ⛔ AN ALL-ZERO REPLY IS "NO ANSWER", NOT "NOBODY" — AND THIS LINE IS THE ONE THAT MAKES
          // THE COMMENT BELOW TRUE. The route answers 200 with zeros when it is throttled or the
          // database is unhappy, precisely so the browser console stays clean; a zeros object is
          // truthy, so accepting it overwrote good numbers and `.filter(v > 0)` then unmounted the
          // whole row. One tab past the per-IP limit, or one slow query, and a footer that had been
          // showing real figures went blank. A reviewer found it; my own comment claimed otherwise.
          if (alive && hasAnyStat(d)) setStats(d)
        })
        .catch(() => { /* decoration: a failed heartbeat leaves the last numbers up */ })
    }

    ping()
    timer.current = setInterval(ping, HEARTBEAT_MS)
    // Coming back to the tab should refresh immediately rather than waiting out the interval.
    const onVisible = () => { if (document.visibilityState === 'visible') ping() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      ac.abort()
      if (timer.current) clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // vi groups thousands with dots (12.480), en with commas — the same split the money formatter
  // makes, and the reason this is not a bare toLocaleString().
  const fmt = (n: number) => new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US').format(n)

  const items: Array<{ key: string; value: number; label: string; live?: boolean }> = [
    // 'visits', not 'visitors' — see SiteStats: the daily-rotating salt makes unique-people
    // unknowable by design, so this is daily uniques summed.
    { key: 'visits', value: stats?.visits ?? 0, label: tr('visits', 'lượt truy cập') },
    { key: 'now', value: stats?.now ?? 0, label: tr('here now', 'đang truy cập'), live: true },
    { key: 'members', value: stats?.members ?? 0, label: tr('members', 'thành viên') },
    { key: 'sellers', value: stats?.sellers ?? 0, label: tr('sellers', 'người bán') },
  ].filter((i) => i.value > 0)

  return (
    /* ⚠️ THE RESERVATION IS TWO LINES ON NARROW SCREENS AND ONE FROM sm UP, because that is where
       the counters actually wrap. A row that appears only when the fetch resolves pushes the legal
       links down under a thumb already reaching for them.
       ⛔ MEASURED, AFTER RESERVING ONE LINE EVERYWHERE WAS WRONG. Method: hold the /api/site-stats
       response until the page has settled, then release it, and watch the /terms link — otherwise
       the whole page's own load swamps the reading (measuring it naively gave CLS 0.96, none of
       which was this widget).
         one line everywhere:  320px 24px · 768px 2px · 1024px 2px · 390px 0 · 1280px 0
         two lines under sm:   320px  0px · 768px 2px · 1024px 2px · 390px 0 · 1280px 0
       So the 24px — a full line, on the narrowest phone people still use — is gone, and the 2px on
       the horizontal row is sub-pixel rounding. Three reviewers predicted the wrap from the code;
       isolating it is what showed WHICH width actually paid for it.
       ⚠️ Reviewers also predicted horizontal overflow between 640 and 1024px. Measured at 640, 768,
       820, 900 and 1024 in both languages: no child is squashed (scrollWidth == clientWidth) and the
       page never scrolls horizontally. The `<ul>` wraps and the row's children wrap with it. */
    <div className="min-h-[2.75rem] sm:min-h-[1.25rem]">
      {items.length > 0 && (
        /* ⚠️ A LIST, NOT A <dl>. The first version paired an `sr-only` <dt> with the visible
           label so the markup would be a proper description list — and that announced every stat
           TWICE ("visitors 2 VISITORS"), because the visible label was still in the accessibility
           tree. A <dl> here would need the term before the description, which is the opposite of
           the reading order the design wants; a list item that simply reads "2 visitors" is both
           correct and what a person actually hears. */
        <ul className="flex flex-wrap items-baseline justify-center gap-x-5 gap-y-1">
          {items.map((i) => (
            <li key={i.key} className="flex items-baseline gap-1.5">
              <span className="flex items-baseline gap-1.5">
                {i.live && (
                  /* ⚠️ NOT `animate-pulse`: it fades the whole subtree to 50% opacity, which drops
                     the number and its label below contrast — the repo has this warning in three
                     other files. `live-dot` animates the DOT's own ring and nothing else, and is
                     opt-in under prefers-reduced-motion: no-preference. */
                  <span aria-hidden className="live-dot mb-px inline-block h-1.5 w-1.5 shrink-0 self-center rounded-full bg-success" />
                )}
                <span className="text-sm font-bold tabular-nums text-foreground">{fmt(i.value)}</span>
                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{i.label}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
