'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { ConversationList } from '@/components/marketplace/conversation-list'
import { cn } from '@/lib/utils'

// Desktop messenger shell: a persistent two-pane layout (conversation list left,
// thread right) — not a stretched mobile card. On mobile it's single-pane: the
// list IS /messages, and a thread takes over the screen. The list lives in the
// layout so it never refetches/remounts when switching threads.
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const inThread = /^\/messages\/.+/.test(pathname || '') // viewing a specific conversation

  // Lock the document while a thread is open so nothing scrolls behind the pinned shell
  // (and iOS has nothing to scroll on focus → the composer stays flush). CSS in
  // globals.css does the work; we just toggle the class. Removed on leave/unmount.
  useEffect(() => {
    const root = document.documentElement
    if (inThread) root.classList.add('chat-locked')
    else root.classList.remove('chat-locked')
    return () => root.classList.remove('chat-locked')
  }, [inThread])

  return (
    // The chat shell. Normally sized to the viewport minus the bottom nav (mobile) or
    // full height (desktop). While the on-screen keyboard is up, `html.kb-open .chat-shell`
    // (globals.css) pins this as a fixed overlay EXACTLY over the visual viewport — height
    // var(--vvh), translateY(var(--vvt)) — so the composer sits flush on the keyboard with
    // zero gap and the header stays pinned. iOS overlays (doesn't resize) the keyboard, so
    // this JS-driven pin is the only thing that tracks it. Desktop never engages (no kb).
    <div
      className="chat-shell flex h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] flex-col overflow-hidden bg-background lg:h-[100dvh]"
    >
      <Header />
      {/* Same max-width + gutter as the header navbar so the two-pane edges line up
          with the logo (left) and Post button (right). Mobile stays edge-to-edge. */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 overflow-hidden px-0 sm:px-6 lg:px-8">
        {/* List pane — full width on mobile (hidden when a thread is open); fixed
            sidebar on desktop, always visible. */}
        <aside className={cn('w-full shrink-0 lg:w-[380px] lg:border-r lg:border-border', inThread && 'hidden lg:block')}>
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
