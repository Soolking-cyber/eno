'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { ChevronUp } from '@/components/ui/icons'
import { STROKE_FLOAT } from '@/lib/icon-tokens'
import { useAccountPanel } from './account-panel'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { SupportButton } from '@/components/marketplace/support-button'
import { RentalCheckPill } from '@/components/marketplace/rental-check-pill'
import { scrollBehavior } from '@/lib/reduced-motion'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { MAX_OBSTACLE_HEIGHT, nextScrollDirection, planClearance, tapBox, YIELDED, type Box, type ClearancePlan, type ScrollDir } from '@/lib/fab-clearance'

/** The chevron stays away until the reader is this far down — near the top there is nothing to go back to. */
const CHEVRON_AFTER_Y = 700
/** "At rest": this long after the last scroll event, where `scrollend` is missing. Momentum scrolling
 *  keeps firing events, so this waits out a fling as well as a drag; `scrollend` short-cuts it. */
const REST_MS = 120
/** The most the cluster may rise above a bar, as a share of the viewport; past it, it stands down. */
const MAX_LIFT_SHARE = 0.4
/** The controls the cluster must never sit on. Scoped to <main>: the header, the tab bar and every
 *  overlay are chrome with their own stacking rules, and the cluster already stands down under a modal. */
const OBSTACLES = 'main button, main a[href], main [role="button"], main input, main select, main textarea'

type Plan = { rise: number; standDown: boolean; chevron: boolean; support: boolean }
const AT_REST: Plan = { rise: 0, standDown: false, chevron: false, support: false }

// ⚠️ `lg` (64rem) — the breakpoint below which the tab bar exists and the support bubble rides with it.
const DESKTOP = '(min-width: 64rem)'
const subscribeDesktop = (cb: () => void) => {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(DESKTOP) : undefined
  mq?.addEventListener?.('change', cb)
  return () => mq?.removeEventListener?.('change', cb)
}
const isDesktop = () => window.matchMedia?.(DESKTOP).matches ?? false

/** Floating bottom-right controls, portaled to <body> (no ancestor can offset them),
 *  above the mobile bottom-nav. A plated chevron "back to top" and the support mark. The floating
 *  Help "?" was removed (duplicate of the rail's Help row). */
export function BackToTop() {
  /**
   * ⛔ THE CHEVRON SHOWS ONLY WHILE THE READER IS SCROLLING UP — owner, 2026-09-25: "back-to-top arrow
   * shows ONLY while the user scrolls UP (hidden while scrolling down and near the top)". It used to
   * appear at scrollY > 700 whatever the direction, so it rode over the feed for the whole of every
   * scroll DOWN — exactly when a reader is looking at cards and tapping their hearts. Wanting to go
   * back up is what scrolling up signals; that is the only time it earns the space. It is hidden on
   * first load until a real upward scroll, and it stays after the finger lifts (a tap during momentum
   * only stops the scroll, so the reader needs it there when the page comes to rest).
   */
  const [up, setUp] = useState(false)
  const [deep, setDeep] = useState(false)
  const [mounted, setMounted] = useState(false)
  // This button has NO visible text — its aria-label is the only name a screen reader
  // gets, so it has to follow the viewer's language like any other copy. eslint's i18n
  // rule runs with ignoreProps/noAttributeStrings off and cannot see attribute copy.
  const { tr } = useLanguage()
  // Mounted inside AccountPanelShell (see layout.tsx) purely to read this.
  const { open: panelOpen } = useAccountPanel()
  // Extra clearance when a page renders a sticky bottom bar (listing contact bar,
  // post-wizard publish bar, availability bar — all marked data-fab-clear): the
  // controls must sit ABOVE the bar, never over its CTA.
  const [lift, setLift] = useState(0)
  /**
   * What the VISIBLE controls do at rest about the page's own controls (src/lib/fab-clearance.ts): the
   * rise above a bar, whether the cluster stands down (no clear place within MAX_LIFT_SHARE of the
   * screen), and whether the chevron / the support mark yields to a small control under it. Every part
   * of it lasts until the page moves again.
   */
  const [plan, setPlan] = useState<Plan>(AT_REST)
  const pathname = usePathname()
  /**
   * ⚠️ THE SUPPORT BUBBLE'S SCROLL SIGNAL LIVES HERE NOW, NOT IN support-button.tsx. It is the SAME hook
   * (the tab bar's), so the bubble still rides down and back with the bar; it moved because this cluster
   * has to know what is VISIBLE to keep it off the page's controls. And it is gated on `!desktop` here,
   * which fixes a real bug it carried: the hide CLASSES were `max-lg:` but `inert` was not, so on a
   * desktop the visible support mark went dead (inert swallows clicks) after any scroll down.
   */
  const scrolledAway = useHideOnScroll()
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false)
  const supportAway = scrolledAway && !desktop
  const show = up && deep
  const { rise, standDown } = plan
  const chevronYields = standDown || plan.chevron
  const supportYields = standDown || plan.support
  const column = useRef<HTMLDivElement>(null)
  // Whether anything is currently yielded or stood down — read by the scroll listener, which must
  // hand the controls back the moment the page moves without re-subscribing on every plan.
  const holding = useRef(false)
  const kick = useRef<() => void>(() => {})
  useEffect(() => { holding.current = standDown || plan.chevron || plan.support }, [standDown, plan])

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const measure = () => {
      let extra = 0
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-fab-clear]'))) {
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.top < window.innerHeight) extra = Math.max(extra, window.innerHeight - r.top)
      }
      setLift((p) => (Math.abs(p - extra) > 1 ? extra : p))
    }
    // ⚠️ rAF-THROTTLED, because `measure()` is expensive and this used to run on EVERY scroll
    // event. It does a `querySelectorAll` plus a `getBoundingClientRect()` per match, which forces
    // a synchronous layout, and it then feeds `setLift` → React render → style write → another read
    // on the next tick. Unthrottled that is a layout thrash on the one interaction that must stay
    // smooth. This is the same pattern use-hide-on-scroll.ts already uses; the coalescing is what
    // makes it correct, not the passive flag (passive only promises not to preventDefault).
    let ticking = false
    let dir: ScrollDir = { anchor: null, height: 0, up: false }
    const update = () => {
      ticking = false
      const y = window.scrollY
      dir = nextScrollDirection(dir, y, document.documentElement.scrollHeight)
      setUp(dir.up)
      setDeep(y > CHEVRON_AFTER_Y)
      measure()
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  /**
   * ⛔ CLEARANCE, MEASURED AT REST — the half of the owner's rule that is about WHERE, not WHEN:
   * "never overlap the right column's save hearts and lift above the product page's sticky buy/CTA
   * bar". Every card's heart sits at its top-right, so a right-edge cluster over a 2-column grid meets
   * one every row; the PDP's CTA is in-flow and passes right under the bubble. So: once the page is
   * still, look at the page controls in the column of the VISIBLE floating controls. Over a BAR (a
   * full-width CTA) the cluster rises just above it; over a SMALL control (a heart, a "See all") the one
   * floating control on it yields — fades out, goes inert — and nothing moves. fab-clearance.ts has the
   * arithmetic and the measurement behind the split: moving for every control hopped the cluster on
   * 47 of 70 stops.
   * ⚠️ AT REST, NOT PER FRAME, ON PURPOSE. Mid-scroll a card row passes the cluster every ~300px; a
   * per-frame rule would make it bob or blink on every row, and a tap that lands during momentum only
   * stops the scroll — it never reaches a heart. What the reader can actually tap is the page at
   * rest, and that is what this guarantees. Measuring only then also keeps a querySelectorAll plus a
   * rect per control out of the scroll frames.
   * ⚠️ `translate`, NOT `bottom`: the rise is compositor-only. `bottom` stays the fixed-bar lift above,
   * which is measured per frame and must track a bar that is itself moving.
   */
  useEffect(() => {
    if (!mounted) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let raf = 0
    const solve = () => {
      const col = column.current
      if (!col) return
      // What is meant to be on screen: the chevron only while shown (its box is 0 where native iOS
      // hides it), the support mark unless it rode away with the tab bar.
      const parts: HTMLElement[] = []
      const chevron = col.querySelector<HTMLElement>('.back-to-top-chevron')
      const support = col.querySelector<HTMLElement>('.support-mark')
      if (show && chevron) parts.push(chevron)
      if (!supportAway && support) parts.push(support)
      const shown = parts.filter((p) => p.offsetWidth > 0 && p.offsetHeight > 0)
      if (!shown.length) { setPlan(AT_REST); return }
      // The box at its RESTING place, from LAYOUT offsets, which no transform touches: not the
      // column's own rise (read back from the computed style, so a rise still mid-transition is
      // undone by exactly what is painted — answers must not compound across rests), and not a
      // control's reveal/ride-down translate (a stood-down bubble is translated off its slot).
      const c = col.getBoundingClientRect()
      const rise = Number.parseFloat((getComputedStyle(col).translate || '').split(' ')[1] ?? '0') || 0
      const top0 = c.top - rise
      const boxes: Box[] = shown.map((p) => ({ top: top0 + p.offsetTop, bottom: top0 + p.offsetTop + p.offsetHeight, left: c.left + p.offsetLeft, right: c.left + p.offsetLeft + p.offsetWidth }))
      const box: Box = {
        top: Math.min(...boxes.map((b) => b.top)),
        bottom: Math.max(...boxes.map((b) => b.bottom)),
        left: Math.min(...boxes.map((b) => b.left)),
        right: Math.max(...boxes.map((b) => b.right)),
      }
      const vh = window.innerHeight
      const obstacles: Box[] = []
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(OBSTACLES))) {
        const r = el.getBoundingClientRect()
        // < 4px is an `sr-only` control (1x1, clipped) — nothing a finger can see or mean.
        if (r.width < 4 || r.height < 4 || r.height > MAX_OBSTACLE_HEIGHT) continue
        if (r.right < box.left - 22 || r.left > box.right + 22 || r.bottom < -22 || r.top > vh + 22) continue
        // Only now, for the handful left in the column: a control that is hidden, inert, transparent or
        // takes no pointer is not something the cluster can steal a tap from, and yielding to it would
        // hide the mark for no visible reason.
        if (el.closest('[inert]')) continue
        // `checkVisibility` sees an ANCESTOR's opacity-0 / visibility:hidden, which the element's own
        // computed style does not (opacity is not inherited): a button inside a fading wrapper is not
        // there for a finger (codex, opus). The own-style read stays as the fallback and for pointer.
        const cv = (el as HTMLElement & { checkVisibility?: (o?: Record<string, boolean>) => boolean }).checkVisibility
        if (cv && !cv.call(el, { opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.pointerEvents === 'none') continue
        obstacles.push(tapBox(r))
      }
      const next: ClearancePlan = planClearance(boxes, obstacles, window.innerWidth, vh * MAX_LIFT_SHARE)
      const at = (el: HTMLElement | null) => (el ? shown.indexOf(el) : -1)
      const yielded = (el: HTMLElement | null) => at(el) >= 0 && next.yielded[at(el)]
      const want: Plan = { rise: Math.round(next.rise), standDown: next.standDown, chevron: yielded(chevron), support: yielded(support) }
      // ⚠️ NO FOCUS GUARD, AND THAT IS NOW SAFE: a yield and a stand-down are visual and pointer-only
      // (YIELDED), so neither can drop focus. The earlier guard un-yielded a FOCUSED control — which put
      // a pointer-taking mark back on the heart after Escape returned focus from the support sheet (opus).
      setPlan((p) => (p.rise === want.rise && p.standDown === want.standDown && p.chevron === want.chevron && p.support === want.support ? p : want))
    }
    const atRest = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(solve) }, REST_MS)
    }
    // A yield or a stand-down lasts until the page MOVES, not until the next rest: a reader scrolling up
    // to find the chevron must see it come back as they scroll, exactly as it would anywhere else.
    const onScroll = () => {
      if (holding.current) { holding.current = false; setPlan((p) => ({ ...p, standDown: false, chevron: false, support: false })) }
      atRest()
    }
    // ⚠️ `scrollend` ANSWERS AT ONCE where it exists: the gap between a fling stopping and the plan
    // landing is the only moment a tap could still reach a control that is about to yield.
    const onScrollEnd = () => { clearTimeout(timer); cancelAnimationFrame(raf); raf = requestAnimationFrame(solve) }
    kick.current = atRest
    atRest()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scrollend', onScrollEnd, { passive: true })
    window.addEventListener('resize', atRest, { passive: true })
    // Late layout that changes no size the observer below would see: the page's own load, and fonts.
    window.addEventListener('load', atRest)
    let live = true
    void document.fonts?.ready.then(() => { if (live) atRest() })
    // Content that grows or shrinks under a resting cluster (the feed rendering in, a price row
    // wrapping when the exchange rate lands) moves controls without a scroll event.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(atRest) : undefined
    ro?.observe(document.body)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      ro?.disconnect()
      live = false
      kick.current = () => {}
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('scrollend', onScrollEnd)
      window.removeEventListener('resize', atRest)
      window.removeEventListener('load', atRest)
    }
  }, [mounted, show, supportAway, pathname, panelOpen])
  // A fixed bar sliding in or out moves the cluster's resting place (`bottom`) — re-plan at rest. Not
  // a dependency of the effect above: `lift` changes on every frame of that slide, and re-subscribing
  // every listener per frame is churn for nothing (opus).
  useEffect(() => { kick.current() }, [lift])

  // Nothing visible → nothing to clear; drop the rise while hidden so the next reveal starts from the
  // resting place instead of a stale height.
  useEffect(() => { if (!show && supportAway) setPlan(AT_REST) }, [show, supportAway])

  if (!mounted) return null
  // The messenger owns the bottom-right corner (its composer's Send button + the AI
  // "Ask" bar), and its panes don't page-scroll — so the floating "?" / back-to-top
  // would only overlay the composer. Suppress the whole cluster there.
  if (pathname?.startsWith('/messages')) return null

  return createPortal(
    <>
      <div
        ref={column}
        className={cn(
          // ⛔ `pointer-events-none` ON THE COLUMN, `pointer-events-auto` ON EACH VISIBLE CONTROL.
          // The column is a 44px-wide box that spans BOTH slots whatever is showing — including the
          // chevron's slot while the chevron is opacity-0 at the top of the page. That invisible box
          // took taps: on 4 of 7 phone PDPs a touch 20px inside the primary CTA's right edge hit-tested
          // to this div (x330–374, y666–764 on a 390pt screen), so "Book"/"Chat" silently did nothing,
          // or opened Contact support on the laptop and rental pages. An invisible layer must not take
          // input; the controls opt back in individually (the chevron only while shown, the support
          // mark via its className). The 10px gap between the two stops being a dead strip too.
          // ⚠️ `items-end`, NOT `items-center`, SINCE THE RENTAL-CHECK PILL JOINED (2026-09-25). The pill is
          // wider than the 44px column the two glyphs define, and centring it would push it past the
          // right edge. Right-aligning changes nothing for the chevron and the support mark: both are
          // exactly 44px wide, so their boxes land where they did.
          'pointer-events-none fixed z-[60] flex flex-col items-end gap-2.5',
          // ⚠️ NEVER OVER A MODAL. At z-[60] this cluster floated ON TOP of the report
          // dialog's "Gửi báo cáo" submit and over the protections sheet's copy — a tap on
          // the CTA's right edge scrolled the page instead of filing a fraud report (blind
          // critic, 2026-08-07; same family as the fixed-overlay traps in globals.css).
          // A modal owns the screen while open, so the affordance goes away — no state to
          // wire, nothing to keep in sync.
          // ⚠️ MATCH THE POPUP SLOTS, NOT role=dialog. The cookie-consent banner is a
          // permanently-mounted role=dialog, so `body:has([role=dialog])` hides this button
          // on every page forever (measured — it is a worse bug than the one being fixed).
          // These three data-slots exist ONLY while a real popup is mounted (verified open →
          // Escape → gone), and they cover every modal primitive in ui/*.
          '[body:has([data-slot=dialog-content])_&]:hidden',
          '[body:has([data-slot=sheet-content])_&]:hidden',
          '[body:has([data-slot=alert-dialog-content])_&]:hidden',
          // Clear the mobile bottom-nav. The max(env, var) pairing covers Android
          // WebView < 140, where Capacitor injects --safe-area-inset-* vars instead
          // of env() passthrough (see the Android safe-area note in globals.css);
          // everywhere else the var is undefined → 0px, so this equals plain env().
          'bottom-[calc(5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] lg:bottom-6',
          // The account rail now lives on the LEFT (a 72px collapsed column, owner 2026-07-17), so
          // the bottom-RIGHT controls no longer overlap it and need no --account-w offset — they
          // stay pinned to the right edge. Below lg the panel owns the whole screen when open, so
          // they stand down (max-lg:hidden). Same spring for a calm settle.
          // ⚠️ `translate` and `opacity` JOINED THE LIST for the at-rest clearance: the rise above a
          // heart or a CTA is a `translate` (compositor-only) and standing down is a fade. Named, not
          // `transition-all` — `bottom` (the fixed-bar lift) must keep tracking its bar frame by frame.
          'right-4 transition-[right,translate,opacity] duration-300 motion-reduce:transition-none lg:right-6',
          panelOpen && 'max-lg:hidden',
        )}
        // Inline bottom (beats the classes) only while a bottom bar is on screen; the at-rest rise
        // rides on top of it as a translate.
        style={{ ...(lift ? { bottom: lift + 12 } : {}), translate: rise ? `0 ${-rise}px` : undefined, transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {/* The availability-check basket's pill — FIRST, so it stacks above the chevron's reserved slot
            and inherits every rule this column carries (nav clearance, the data-fab-clear lift, the
            modal and panel stand-downs, the /messages exit). Renders nothing while the basket is empty.
            It carries its own `pointer-events-auto`. */}
        <RentalCheckPill />

        {/* Back to top — bare glyph, no circle: same treatment as the search-bar
            icons (quiet ink → brand blue on hover) with a subtle drop-shadow so it
            stays distinct over card imagery. Fades in once scrolled (slot reserved
            so the ? never shifts); transform/opacity only. */}
        <Button
          variant="bare"
          size="none"
          type="button"
          aria-label={tr('Back to top', 'Lên đầu trang')}
          // opacity-0 + pointer-events-none hides this from the MOUSE only: none of the
          // three classes below removes the button from the TAB ORDER or the accessibility
          // tree, so a keyboard user used to tab into an invisible "Back to top". `inert`
          // is the one lever that removes all three (focus, pointer, a11y tree);
          // aria-hidden + tabIndex=-1 are the fallback for browsers without it.
          // NOT `hidden`/display:none — the slot must keep its size so the "?" below never
          // shifts as this fades in.
          // ⚠️ `inert` only while SCROLLED AWAY. A yield is visual and pointer-only: it keeps a
          // finger off a heart, and it must not take the control from a keyboard or a screen reader
          // (see YIELDED in src/lib/fab-clearance.ts).
          inert={!show}
          aria-hidden={!show || undefined}
          tabIndex={show ? undefined : -1}
          onClick={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}
          // back-to-top-chevron is a stable hook for globals.css: native iOS hides
          // ONLY this button (status-bar tap already scrolls to top there); Android keeps the chevron.
          // (The floating Help "?" was removed 2026-07-18 — the rail's Help row owns it.)
          className={cn(
            // Hover = colour only (icon-language §8 — scale-on-hover is a tile-glyph move,
            // not chrome); press keeps the standard settle.
            // ⚠️ HOVER MOVED FROM THE INK TO THE PLATE. The ink is now fixed white (neutral-900 in
            // dark) because it sits on a disc, so `hover:text-accent-foreground` would have put
            // brand blue on black — legible, but no longer the same control as every other plated
            // glyph. Deepening the disc reads as the same affordance and keeps the mark constant.
            // ⚠️ NO HOVER CLASS HERE — `.icon-plate` OWNS IT. It was written inline first and a
            // reviewer caught that only the arrows got it while ~100 plated IconButtons did not.
            // The deepening now lives with the plate in globals.css, so every plated glyph in the
            // app hovers the same way and this line cannot drift from them.
            // ⚠️ NAMED PROPERTIES, NOT `transition-all`: what moves here is opacity, the `translate-y-*`
            // reveal (Tailwind v4's standalone `translate`) and the press `scale`.
            'back-to-top-chevron relative flex h-11 w-11 items-center justify-center transition-[opacity,translate,scale] duration-200 active:scale-[0.96] tap-44',
            // Scrolled away it sinks 8px as it fades (the reveal's own motion); YIELDED it fades where it is
            // — a control that twitches whenever the page stops over a heart is motion with no meaning.
            show && !chevronYields ? 'pointer-events-auto opacity-100 translate-y-0' : show ? cn(YIELDED, 'translate-y-0') : 'pointer-events-none opacity-0 translate-y-2',
          )}
        >
          {/* STROKE_FLOAT (§2): a chevron floating over card imagery — heavier than chrome so it
              survives busy photos.
              ⚠️ `.icon-plate` REPLACED THE DROP-SHADOW AS THE BACKING. Owner, 2026-08-29: "put back
              plates to all arrows around app", pointing at this button. A shadow only works when
              the thing behind it is lighter than the mark; over a dark photo the chevron and its
              shadow disappeared together. The disc is the same one every plated control wears —
              one definition, in globals.css.
              ⚠️ 28px GLYPH + 3px EACH SIDE = A 34px DISC inside a 44px button. The shadow stays,
              but it now falls from the plate rather than from the strokes, which is why it can be
              lighter than it was. */}
          <ChevronUp className="icon-plate h-7 w-7 text-white dark:text-neutral-900 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.22))]" strokeWidth={STROKE_FLOAT} />
        </Button>

        {/* ⛔ SUPPORT SITS BELOW THE CHEVRON, CLOSEST TO THE BOTTOM NAV — owner, 2026-08-26, swapping
            the original order. It is the element that moves WITH the bar on scroll, so it belongs
            nearest to it; putting the chevron between them would have the nav's motion jump a gap.
            Neither position shifts the other: both are always in the DOM (the chevron fades with
            `opacity`, never `display`), so the column's geometry is fixed whatever either is doing. */}
        {/* `pointer-events-auto` re-enables the mark inside the column's `pointer-events-none`. Its own
            scrolled-away state still wins below lg: `max-lg:pointer-events-none` is a variant rule and
            sorts after this plain utility, and `inert` removes it regardless. `hidden` is decided
            HERE (the tab bar's scroll signal, phones only, or the cluster standing down) because this
            cluster has to know what is visible to keep it off the page's controls. */}
        <SupportButton className="pointer-events-auto" hidden={supportAway} yielded={supportYields} />

      </div>

    </>,
    document.body,
  )
}
