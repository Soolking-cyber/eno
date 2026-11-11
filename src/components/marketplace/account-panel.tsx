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
  const { user, loading } = useAuth()
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
    // ⚠️ `pc`, NOT the bare 64rem width (break-ui decision, 2026-10-05; the owner's 2026-07-06 rule that touch
    // follows the mobile UI at any width). The rail's labels open on HOVER, which a touch tablet does not
    // have: a tap unfolded them over the feed and left them there, and the folded rail hid language, currency
    // and sign-out. A landscape iPad now gets the phone chrome — the tab bar and /dashboard/account.
    const mq = window.matchMedia('(min-width: 64rem) and (pointer: fine)')
    const sync = () => setOpen(mq.matches && !!user)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [pathname, user])

  // ⛔ THE CLOSED RAIL'S GUTTERS ARE RESERVED BEFORE FIRST PAINT FOR A SESSION THE CLIENT ALREADY HOLDS, FROM 73rem
  // (speed plan R21). `open` is known only after hydration AND the idle auth boot, so the padding below used to arrive
  // then and move the whole page 72px each side on every signed-in desktop full load. The pre-paint script in
  // [lang]/layout.tsx puts `rail-hint` on <html> only when the document starts with a session THIS build's browser
  // client returns from getSession() without a network call (its cookie — src/lib/supabase/session-cookie.ts — read and
  // decoded as @supabase/ssr reads it, with a user, at least 90 s from expiry), and the closed shell's `rail-hint:` class
  // holds the same 72px from the first frame — from 73rem (1168px) with a fine pointer only (globals.css). Measured
  // (local build, Chromium, signed in, production facet counts, viewport height 900, 3 runs each, medians): / 0.168 →
  // 0.042 at 1168px, 0.143 → 0.042 at 1350, 0.061 → 0.025 at 1920; a cold /?category=rentals 0.127 → 0.007, 0.082 →
  // 0.006, 0.039 → 0.003; the same with the session split in two chunks.
  // A session within 90 s of expiry or past it gets no class, so its first load shifts as before (nothing refreshes the
  // cookie on a page request; the client's refresh then writes a fresh one for the next load).
  // ⚠️ WHY 73rem AND NOT `pc`'s 64rem. Inside the gutters the server's facet row (FacetBarFallback's four home pills
  // beside the sort tabs: explorer-toolbar.tsx, the lg one-line rule) only fits from 1136px in the web font (Chromium,
  // WebKit; Firefox 1135; 1129 in Vietnamese), and from 1157-1166px in the fallback face Firefox and WebKit lay it out
  // in until the font arrives (`display: swap`). Narrower, it wraps there, then unwraps when a category's own pills
  // mount: reserved from 64rem, a cold /?category=rentals link at 1100x800 shifted 0.191-0.202 against 0.135-0.141
  // without (3 runs each). So from 64rem to 73rem the gutters arrive after auth, as without this: toggling html.rail-hint
  // there moves 0 of ~905 boxes in all three engines. (The site hides every scrollbar — globals.css, SCROLLBARS — so
  // none takes width from that row: a 17px scrollbar forced through ::-webkit-scrollbar measured 0px in Chromium.)
  // Drop the hint only when it has done its job:
  //   · `open` — this shell's own class now holds the padding, swapped in the SAME commit, so nothing moves;
  //   · auth settled with no user — the hint was WRONG, and the gutters animate away (a shift a guest never gets). The
  //     head script leaves out every case that was measured to land here: a revoked session (its refresh answered 400),
  //     a lone or broken chunk set the client cannot read, an expired session whose refresh keeps failing as a network
  //     error (auth settles ~26 s into the load and the cookie is kept, so every load would pay). Measured with the
  //     head script's rule (same setup, 1168/1350/1920 x / and rentals): no class and 0px in all 54 loads, CLS equal to
  //     the build without the patch in every cell (e.g. / at 1350: 0.0388 in all 18 loads of the three). Still
  //     possible, not measured, each needing the client's boot to fail or something to change after the head script
  //     ran: the Supabase chunk or getSession() rejecting (auth-context's fail()); an auth event setting the user null
  //     first (a SIGNED_OUT from another tab); the cookie changed or removed before the client reads it; or the 90 s
  //     margin crossed before that read AND the token expiring before its refresh gives up (auth-js keeps an unexpired
  //     session when a refresh fails). Another project's cookie never sets the hint (session-cookie.ts; measured: no
  //     class, 0px, same CLS as base).
  //   · never, if the head script ran but the app's own scripts never do (a failed bundle): the gutters stay with no
  //     rail in them (measured with the app's scripts blocked: 72px from the first frame to the end). With JavaScript
  //     off altogether nothing sets the class, so nothing is reserved.
  // Never on `user` alone: it lands one render before `open` (the effect above), so that would leave a commit with
  // neither class holding the padding (account-panel.rail-hint.test.tsx replays every commit and catches it). And
  // nothing for a guest: no session cookie, no class, nothing reserved.
  useEffect(() => {
    if (open || (!loading && !user)) document.documentElement.classList.remove('rail-hint')
  }, [open, loading, user])

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
            //
            // CLOSED: the same 72px, but only under html.rail-hint and only from 73rem (the note on the effect above) —
            // what the server renders, so a signed-in wide desktop's first frame already has the gutters a guest's
            // never gets.
            open ? (expanded ? 'pc:pl-[var(--account-w-open)] pc:pr-[var(--account-w)]' : 'pc:px-[var(--account-w)]') : 'rail-hint:px-[var(--account-w)]',
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
