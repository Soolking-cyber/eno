'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { ConversationList } from '@/components/marketplace/conversation-list'
import { useVirtualKeyboard } from '@/hooks/use-virtual-keyboard'
import { KbDebug } from '@/components/marketplace/kb-debug'
import { cn } from '@/lib/utils'

// Desktop messenger shell: a persistent two-pane layout (conversation list left,
// thread right) — not a stretched mobile card. On mobile it's single-pane: the
// list IS /messages, and a thread takes over the screen. The list lives in the
// layout so it never refetches/remounts when switching threads.
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const inThread = /^\/messages\/.+/.test(pathname || '') // viewing a specific conversation

  // Size the shell to the visible viewport height while the keyboard is up (iOS overlays
  // the keyboard without shrinking dvh). Composer is the bottom flex row. The shell is
  // NEVER position:fixed — that collapses the flex height chain. Only the composer FOOTER
  // lifts to fixed (see globals.css .chat-footer + the page's chat-footer wrapper).
  const { height: kbHeight } = useVirtualKeyboard()

  // Lock the DOCUMENT the whole time a thread is open (stable signal — NOT the keyboard
  // threshold). `touch-action:none` on <body> (globals.css html.chat-locked) is what
  // actually stops iOS scrolling the layout viewport on focus, keeping
  // visualViewport.offsetTop ~0 → the fixed footer sits FLUSH with no gap and no jitter.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('chat-locked', inThread)
    return () => root.classList.remove('chat-locked')
  }, [inThread])

  return (
    <div
      style={kbHeight ? { height: kbHeight } : undefined}
      /**
       * ⛔ NO `bg-background` HERE — IT PAINTED A FLAT PANEL OVER THE WASH (owner, 2026-09-19: "also
       * fix dashboard pages background mismatch"). This shell is full-bleed and the height of the
       * viewport, so an opaque fill covers `body`'s gradient for the whole middle of the screen while
       * the strip beside it still shows it. Down at the tail the two agree; up where the wash is
       * strongest they do not, and the messages column read as a lighter slab with a hard edge.
       * ⚠️ THIS IS THE GENERAL RULE FOR FULL-BLEED SHELLS NOW THAT THE CANVAS IS THE WASH: let the
       * page's own gradient through instead of repainting the floor. `--background` is the wash's
       * TAIL, so `bg-background` is only ever correct where the gradient has already reached it.
       * Something that must be opaque over content (a drawer, a sheet) should say so with the wash
       * itself — `.wash-surface` — not with the flat token.
       */
      /**
       * ⚠️ 4.5rem IS THE TAB BAR'S FOOTPRINT (72px: since 2026-09-26 a 56px floating pill + its
       * 12px gap, 4px of air over it) — the same number <BottomNavSpacer/> and
       * account-panel-body.tsx reserve. It said 4rem, so the shell ran 8px UNDER the bar at 390×844
       * (shell bottom 780, nav top 772): the composer kept 4px of clearance and the last inbox row
       * never cleared the bar. Change the three together.
       */
      className="flex h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom)-var(--banner-h,0px))] flex-col overflow-hidden lg:h-[calc(100dvh-var(--banner-h,0px))]"
    >
      <Header />
      <KbDebug />
      {/* Same max-width + gutter as the header navbar so the two-pane edges line up
          with the logo (left) and Post button (right). Mobile stays edge-to-edge. */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 overflow-hidden px-0 sm:px-6 lg:px-8">
        {/* List pane — full width on mobile (hidden when a thread is open); fixed
            sidebar on desktop, always visible. */}
        <aside className={cn('w-full shrink-0 lg:w-[380px]', inThread && 'hidden lg:block')}>
          <ConversationList />
        </aside>
        {/* Thread / right pane — hidden on mobile unless a thread is open. Carries
            id="main" so the skip-link works on the messenger (no <main> here — the
            panes ARE the page). */}
        <section id="main" tabIndex={-1} className={cn('min-w-0 flex-1', !inThread && 'hidden lg:flex')}>
          {children}
        </section>
      </div>
    </div>
  )
}
