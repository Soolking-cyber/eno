'use client'

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

  return (
    <div className="flex h-[100dvh] flex-col bg-background">
      <Header />
      <div className="mx-auto flex w-full max-w-6xl flex-1 overflow-hidden">
        {/* List pane — full width on mobile (hidden when a thread is open); fixed
            sidebar on desktop, always visible. */}
        <aside className={cn('w-full shrink-0 lg:w-[380px] lg:border-r lg:border-border', inThread && 'hidden lg:block')}>
          <ConversationList />
        </aside>
        {/* Thread / right pane — hidden on mobile unless a thread is open. */}
        <section className={cn('min-w-0 flex-1', !inThread && 'hidden lg:flex')}>
          {children}
        </section>
      </div>
    </div>
  )
}
