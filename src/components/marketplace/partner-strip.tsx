'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent } from 'react'
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
 */
export function PartnerStrip() {
  const { tr } = useLanguage()
  const partners = stripPartners()
  const [looping, setLooping] = useState(false)
  const [paused, setPaused] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => { setLooping(true) }, [])
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
    <section aria-label={tr('eno partners', 'Đối tác của eno')} className="partner-strip">
      <div className="mx-auto flex h-full w-full max-w-7xl items-center gap-3 px-3 sm:gap-4 sm:px-6 lg:px-8">
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

function PartnerItem({ partner: p, repeat, label }: { partner: StripPartner; repeat: boolean; label: string }) {
  return (
    <li className="partner-strip-item" aria-hidden={repeat || undefined} data-copy={repeat ? '1' : '0'}>
      {/* Accessible name = the logo's alt (the partner's name) + the visible word: "GoPlus Apartments". */}
      <Link href={`/${p.handle}`} prefetch={false} tabIndex={repeat ? -1 : undefined} className="partner-strip-link">
        <span className={p.dark ? 'partner-strip-tile partner-strip-tile-dark' : 'partner-strip-tile'}>
          <img src={p.logo.src} alt={p.name} width={p.logo.width} height={p.logo.height} className={p.size === 'wide' ? 'partner-strip-logo-wide' : 'partner-strip-logo'} />
        </span>
        <span className="text-xs font-medium text-ink-4">{label}</span>
      </Link>
    </li>
  )
}
