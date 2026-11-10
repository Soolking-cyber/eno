'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent } from 'react'
import { preload } from 'react-dom'
import { Pause, Play } from '@/components/ui/icons'
import { Toggle } from '@/components/ui/toggle'
import { useLanguage } from '@/context/language-context'
import { stripPartners, type StripPartner } from '@/lib/partner-strip'

/**
 * How many times the roster repeats inside each HALF of the looping track. ⛔ A SEAMLESS LOOP NEEDS ONE HALF AT LEAST AS WIDE
 * AS THE BAND: the track slides by -50%, so a half narrower than the viewport shows blank space before the restart (review,
 * 2026-11-09: one eno.vn roster measured ~944 px against ~1,100 px of band on a 1,280 px desktop; eno.forum's four partners
 * are narrower still). Three rosters per half is ~2,800 px on eno.vn and ~2,100 px on eno.forum — wider than `max-w-7xl`.
 */
const REPEAT = 3
/** Seconds per item in one half: the drift speed (~40 px/s on eno.vn), whatever the roster's length. */
const SECONDS_PER_ITEM = 3.8
/** `sm` and up, in rem like the classes that show and hide the two placements (a larger default font moves all of them together). */
const SM_UP = '(min-width: 40rem)'

/**
 * The home page's partner band (owner, 2026-11-09): eno's official partners' own logos, each with one word for what they do,
 * drifting right to left. The roster, the logos' provenance and the edition rule live in src/lib/partner-strip.ts.
 *
 * ⛔ UNDER THE HEADER, NOT ABOVE IT. Above, it would take the iPhone notch inset the sticky header keeps (header.tsx's
 * page-at-top dance exists for the prelaunch bar alone) and push eno's own wordmark off the top of the page. As the first
 * band of the page it reads as eno introducing its partners, and it scrolls away with the content.
 *
 * ⛔ A CSS MARQUEE (globals.css `.partner-strip-*`): the track holds two equal halves and slides by exactly one half (-50%),
 * so the loop is seamless and the motion runs on the compositor. THE REPEATS ARE ADDED AFTER HYDRATION: this band sits in
 * the home page's first chunk, whose bytes are budgeted (crawler-visible-html-contract.test.ts, the 12.8 KB rule), and
 * crawlers have no use for every partner link six times — so the server sends ONE still row (complete and readable as it
 * is) and the loop starts once the repeats exist (`data-loop`). Every repeat is `aria-hidden` with its links out of the tab
 * order, so a screen reader and a keyboard meet each partner once. Keyboard focus stops the loop at its start so the focused
 * link is in view (`:focus-visible` only — a mouse click must not move the link it is clicking; globals.css).
 *
 * ⛔ IT CAN BE STOPPED (WCAG 2.2.2, review 2026-11-09): moving content that runs longer than five seconds needs a pause a
 * touch user can reach, not only hover or focus — the Pause toggle at the band's end (a real `<button aria-pressed>`,
 * ui/toggle). Paused, the band stops at its start and scrolls by hand, so a phone reaches every partner; Play resets the
 * scroll and resumes. Hover holds it in place. Under `prefers-reduced-motion` it never moves:
 * the repeats and the toggle are hidden and the row scrolls by hand.
 *
 * ⛔ NO LAYOUT SHIFT: every logo carries its intrinsic width/height and a fixed CSS height, and the band has a fixed height.
 *
 * ⛔ ON A PHONE IT IS IN THE FEED, NOT UNDER THE HEADER (owner, 2026-11-10: "1-6 1 by one go", item 5 of the decision
 * scorecard). Under the header it was the first thing on Home and on every search and category result, so a search for
 * "iphone" opened on Motorbikes and Moving, and it was one of five bands before the first listing. Blind A/B against that:
 * codex 6.85 to 7.03, Fable 7.09 to 7.34. Two placements of this one component, each shown at its own widths by a class:
 *   · `top`  (the home layout): from `sm` up, exactly as before; hidden below it;
 *   · `feed` (listings-explorer.tsx): below `sm` only, a full-width row after the second row of the undirected home feed.
 *     A search or a category result shows no band on a phone at all.
 * Both are in the server's HTML (a row inserted after hydration would push the feed down), so each sends its one still
 * row; only the copy that is on screen at this width runs the loop and grows the repeats.
 */
export function PartnerStrip({ placement = 'top' }: { placement?: 'top' | 'feed' }) {
  const { tr } = useLanguage()
  const partners = stripPartners()
  // From `sm` up only, and ahead of the stylesheets (why and what was measured: PartnerItem).
  // ⚠️ React keys an image preload by its href and the first one wins: a plain eager `<img>` of one of these files
  // rendered earlier on the page would preload it for every width. Today nothing else on the page draws them eagerly.
  if (placement === 'top') for (const p of partners) preload(p.logo.src, { as: 'image', media: SM_UP, fetchPriority: 'high' })
  const [looping, setLooping] = useState(false)
  const [paused, setPaused] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia(SM_UP) : null
    const sync = () => {
      const shown = mq ? (placement === 'feed') !== mq.matches : true
      // Back to 0 before the loop runs again, as after a pause: a scroll left behind by hand while this copy was the
      // still row would offset the resumed -50% loop (commit review).
      if (shown && viewport.current) viewport.current.scrollLeft = 0
      setLooping(shown)
    }
    sync()
    // `?.` on the method too: a media query list without addEventListener (WebKit before 14) keeps its first answer.
    mq?.addEventListener?.('change', sync)
    return () => mq?.removeEventListener?.('change', sync)
  }, [placement])
  // ⛔ BACK TO 0 BEFORE THE LOOP RUNS AGAIN. Keyboard focus and the paused state both stop the animation and let the row
  // scroll (globals.css); a scroll left behind would offset the resumed -50% loop and show a gap at its end (review).
  useEffect(() => { if (!paused && viewport.current) viewport.current.scrollLeft = 0 }, [paused])
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!paused && !e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.scrollLeft = 0
  }
  if (!partners.length) return null
  const label = (p: StripPartner) => tr(p.label.en, p.label.vi)
  // Server: the roster once. Browser: two halves of REPEAT rosters each; only the very first roster is the real one.
  const copies = looping ? REPEAT * 2 : 1
  const items = Array.from({ length: copies }, (_, copy) =>
    partners.map((p) => <PartnerItem key={`${copy}-${p.handle}`} partner={p} repeat={copy > 0} label={label(p)} />))
  const duration = { '--partner-strip-duration': `${Math.round(partners.length * REPEAT * SECONDS_PER_ITEM)}s` } as CSSProperties
  return (
    <section
      aria-label={tr('eno partners', 'Đối tác của eno')}
      data-partner-band={placement === 'feed' ? '' : undefined}
      className={placement === 'feed' ? 'partner-strip partner-strip-feed col-span-full sm:hidden' : 'partner-strip max-sm:hidden'}
    >
      {/* In the feed the grid already puts a full-width row's content on the page gutter (LISTING_GRID's `col-span-full` padding), so this row adds none. */}
      <div className={placement === 'feed' ? 'flex h-full w-full items-center gap-3' : 'mx-auto flex h-full w-full max-w-7xl items-center gap-3 px-3 sm:gap-4 sm:px-6 lg:px-8'}>
        <span className="shrink-0 text-2xs font-semibold uppercase tracking-wider text-ink-4">{tr('Partners', 'Đối tác')}</span>
        <div ref={viewport} className="partner-strip-viewport" onBlur={onBlur}>
          <ul className="partner-strip-track" data-loop={looping ? '' : undefined} data-paused={paused ? '' : undefined} style={duration}>
            {items}
          </ul>
        </div>
        {looping && (
          <Toggle
            pressed={paused}
            onPressedChange={setPaused}
            aria-label={paused ? tr('Play the partner logos', 'Chạy logo đối tác') : tr('Pause the partner logos', 'Dừng logo đối tác')}
            className="partner-strip-pause inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-tint hover:text-ink"
          >
            {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
          </Toggle>
        )}
      </div>
    </section>
  )
}

/**
 * ⛔ A PHONE NEVER FETCHES THE TOP COPY'S LOGOS, AND A DESKTOP HAS THEM IN ITS FIRST PAINTED FRAME (speed plan R26,
 * 2026-11-10; third version 2026-11-11, each one measured in real browsers against the live build).
 * React puts a `<link rel="preload" as="image">` in `<head>` for every plain eager `<img>` it server-renders, so all
 * five logos were fetched with the CSS and fonts on every phone home view, ahead of the first paint, though the top
 * copy is hidden there (FCP −132 ms without them on the 1.6 Mbps phone profile).
 *   · `top`, the server's row: `<img loading="lazy">`. React preloads no lazy image, and a lazy image in a
 *     `display: none` band (below `sm`) is never fetched (a browser with no lazy loading, iOS before 15.4, or with
 *     scripting off fetches them, as every phone did before). From `sm` up a lazy image alone is late (requests at 140 ms,
 *     0 of 5 logos in the first painted frame), so PartnerStrip preloads each logo itself, with the band's own media
 *     query and ⛔ `fetchPriority: 'high'`: that is what makes React write the link AHEAD of the stylesheets, where the
 *     old automatic preloads sat. Without it the link lands after the CSS and ~47 script tags and the logos still miss
 *     the first frame (0 of 5 in 21 of 21 loads); with it 5 of 5, at full speed and at 1.6 Mbps (the live build: 5 and
 *     3 of 5). A preload whose media does not match is not fetched (Firefox notes each one in the console).
 *     ⚠️ THE PRICE, MEASURED: high priority puts 35 KB of logos ahead of the CSS, so a desktop's first paint is a
 *     little later than the live build's (median +8 ms unthrottled, +24 ms at 10 Mbps, +84 ms at 1.6 Mbps, n=3 each);
 *     with the logos left to arrive late it was 140 ms EARLIER at 1.6 Mbps but the band painted empty. Chosen: a
 *     complete first frame on desktop. On a phone at 1.6 Mbps first paint is 100–190 ms earlier than the live build's.
 *     WebKit: each logo reaches the server once per view (checked with a persistent profile and production's
 *     Cache-Control; a throwaway profile shows a second, cache-less fetch that visitors do not make).
 *     ⛔ NOT A `<picture>` over a blank image (the first version): WebKit then downloaded every logo twice.
 *   · `top`, the repeats: they exist only while this copy loops, which is only from `sm` up: plain eager `<img>`s.
 *   · `feed` (phones only, display:none from `sm` up so a desktop never fetches it): `loading="lazy"` on the server's
 *     row, loaded once it is laid out, and never preloaded. Its repeats, which exist only after hydration, stay
 *     eager: they put every logo in the cache before the loop slides a clipped one in from the right, where a browser
 *     that lazy-loads with no margin would show it empty until its own request came back.
 */
function PartnerItem({ partner: p, repeat, label }: { partner: StripPartner; repeat: boolean; label: string }) {
  const fit = p.size === 'wide' ? 'partner-strip-logo-wide' : 'partner-strip-logo'
  return (
    <li className="partner-strip-item" aria-hidden={repeat || undefined} data-copy={repeat ? '1' : '0'}>
      {/* Accessible name = the logo's alt (the partner's name) + the visible word: "GoPlus Apartments". */}
      <Link href={`/${p.handle}`} prefetch={false} tabIndex={repeat ? -1 : undefined} className="partner-strip-link">
        <span className={p.dark ? 'partner-strip-tile partner-strip-tile-dark' : 'partner-strip-tile'}>
          <img src={p.logo.src} loading={repeat ? undefined : 'lazy'} alt={p.name} width={p.logo.width} height={p.logo.height} className={fit} />
        </span>
        <span className="text-xs font-medium text-ink-4">{label}</span>
      </Link>
    </li>
  )
}
