'use client'

import { createContext, useContext, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { cn } from '@/lib/utils'

// LEFT account/dashboard NAV RAIL — Gemini "collapsed-by-default, expand-on-hover" model
// (owner 2026-07-17). DESKTOP: a narrow 72px column of crisp icons on the LEFT edge; hovering
// expands it to 280px, FLOATING over the content (position:fixed + z-50 + a width transition) so
// the page never reflows — the content margin stays locked at --account-w (72px). MOBILE: unchanged
// — a full-screen launcher overlay (opaque, body-locked, focus-trapped); tapping a section navigates
// and closes the rail. The sections are their own /dashboard/* pages (they render in <main>); this
// rail only links to them. Borderless throughout: no divider line — collapsed is a whisper tint, the
// hover-expansion lifts off the canvas with a soft blur + diffuse shadow.

const Ctx = createContext<{
  open: boolean
  setOpen: (o: boolean) => void
  /** Desktop rail expanded (pinned via the toggle). Lifted to the shell so the content padding can
   *  push the feed clear of the WIDE (280px) rail when open — otherwise the expansion overlaps it. */
  expanded: boolean
  setExpanded: Dispatch<SetStateAction<boolean>>
}>({ open: false, setOpen: () => {}, expanded: false, setExpanded: () => {} })
export const useAccountPanel = () => useContext(Ctx)

export function AccountPanelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  // Desktop rail expanded (toggle-pinned). Lives HERE (not in AccountPanel) so the content padding
  // below can push the feed clear of the 280px expanded rail. Resets whenever the rail closes.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { if (!open) setExpanded(false) }, [open])
  // Lazy-mount: guests and users who never open the panel pay zero render cost.
  const [mounted, setMounted] = useState(false)
  if (open && !mounted) setMounted(true)

  // ⚠️ THIS IS NOW DESKTOP-ONLY (owner 2026-07-24, dashboard native-feel). There used to be a
  // MOBILE entry point here: the bottom-nav Account tab dispatched `eno:open-account` and this
  // shell opened the rail as a full-screen launcher, broadcasting `eno:account-open-change` back
  // so that tab could light itself. Account is a real page now (/dashboard/account), so both
  // events and the launcher are gone — `open` is decided solely by the media query below, which
  // means on a phone the rail never opens and its chunk is never even downloaded.
  //
  // Do not reintroduce a mobile launcher here: the whole point was that a route gives Android
  // hardware-back, browser-back, a shareable URL and route-driven tab state for free, none of
  // which an overlay can offer.

  // PERMANENT desktop rail (owner 2026-07-17). The collapsed 72px icon column is ALWAYS on the left
  // for a signed-in user on desktop — on every page, not just /dashboard/* — mirroring Gmail/Discord.
  // MOBILE has no room for a persistent sidebar, so it stays a LAUNCHER (closed by default; the
  // bottom-nav Account tab opens it full-screen via eno:open-account). `sync` re-runs on every route
  // change (which CLOSES the mobile launcher after a tap-navigate — desktop just stays open) and on
  // the viewport crossing the lg breakpoint (resize/orientation), so the rail is correct without a
  // reload. Guests get neither (user is null → open stays false → nothing mounts, no content margin).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 64rem)')
    const sync = () => setOpen(mq.matches && !!user)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [pathname, user])

  return (
    <Ctx.Provider value={{ open, setOpen, expanded, setExpanded }}>
      <div
        className={cn(
          // duration-200 matches the rail's own width transition, so the push and the widen move in
          // lockstep — the rail's right edge never runs ahead of the content clearing it.
          'transition-[padding] duration-200 motion-reduce:transition-none',
          // Clear the rail with padding so the content stays BALANCED (not shoved by a one-sided
          // margin, which put it ~72px off-centre). COLLAPSED: symmetric 72px both sides → content
          // centred in the viewport, rail in the left gutter. EXPANDED (toggle-pinned, 280px): push
          // the feed right to clear the wide rail (pl-280) while keeping the same 72px right gutter,
          // so it never overlaps and stays balanced beside the rail. Animates the push (transition
          // padding). Only when open (desktop, signed-in) — guests get nothing.
          // ⚠️ ALWAYS the 72px rail width, never 280px — the hover-expanded rail now OVERLAYS the
          // content instead of pushing it (owner 2026-07-23: "remove [the pin toggle] and open
          // dashboard on hover"). Reserving 280px on hover reflowed the whole feed every time the
          // pointer grazed the rail, which is exactly why the pin existed; overlaying keeps the
          // page still while the labels slide open on top.
          // ⚠️ THE EXPANDED RAIL PUSHES THE CONTENT AGAIN (owner, 2026-08-03: "when opened make
            // sure it doesnt overlap the marketplace"). This REVERSES the 2026-07-23 decision to
            // overlay, and the reason that decision existed still stands — so read this before
            // flipping it back a third time.
            //
            // Overlaying was chosen because reserving the expanded width on HOVER reflowed the whole
            // feed every time the pointer grazed the rail. That objection is now much smaller: the
            // expanded rail is 240px rather than 280px (--account-w-open), so the push is 168px
            // instead of 208px, and it animates on the same duration-200 spring as the width itself —
            // the rail's right edge and the content's left edge move in lockstep rather than one
            // running ahead of the other.
            //
            // The trade is deliberate: a little motion on hover, in exchange for never covering what
            // the visitor was reading. Covering content is the worse failure on a marketplace, where
            // the thing behind the rail is a listing someone is part-way through.
            open && (expanded ? 'lg:pl-[var(--account-w-open)] lg:pr-[var(--account-w)]' : 'lg:px-[var(--account-w)]'),
        )}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {children}
      </div>
      {mounted && <AccountPanel open={open} onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  )
}

// Split chunk (perf Phase 1) — see account-panel-body.tsx. ssr:false is safe: the
// shell only mounts it client-side (the `mounted` gate) in the first place.
const AccountPanel = dynamic(() => import('./account-panel-body').then((m) => m.AccountPanel), { ssr: false })
