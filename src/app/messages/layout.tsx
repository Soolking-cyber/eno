'use client'

import { useEffect, useState } from 'react'
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

  // Keyboard-aware height. iOS Safari OVERLAYS the on-screen keyboard without
  // shrinking dvh/innerHeight, so a dvh-tall chat becomes taller than the visible
  // area → the page scrolls, the header slides off the top, and the composer floats
  // over a gap. We instead size the shell to visualViewport.height while the
  // keyboard is up: the page can no longer scroll, the header stays pinned at top,
  // and the composer sits flush above the keyboard. null = keyboard closed (use the
  // normal dvh height). Desktop has no virtual keyboard, so this never engages.
  const [kbHeight, setKbHeight] = useState<number | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const apply = () => {
      const overlap = window.innerHeight - vv.height - vv.offsetTop
      setKbHeight(overlap > 120 ? vv.height : null) // >120px overlap ⇒ a keyboard, not the URL bar
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply) }
  }, [])

  return (
    // On mobile, leave room for the fixed bottom nav (4rem) so the chat composer
    // pins right above it and only the message list scrolls. Full height on desktop.
    // When the keyboard is up, an inline height (= visible viewport) overrides both.
    <div
      style={kbHeight ? { height: kbHeight } : undefined}
      className="flex h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] flex-col overflow-hidden bg-background lg:h-[100dvh]"
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
