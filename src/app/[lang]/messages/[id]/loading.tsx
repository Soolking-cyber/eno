import { Skeleton } from '@/components/ui/skeleton'
import { ThreadStripSkeleton } from '@/components/marketplace/thread-strip-skeleton'
import { THREAD_HEADER_CLASS } from '@/lib/thread-chrome'

// Thread right-pane skeleton. On desktop the layout provides the site header and the list beside it; below
// lg a conversation thread has NO site header (messages/layout.tsx → isConversationPath), so this header is
// the top of the screen and carries the real header's status-bar inset — the same THREAD_HEADER_CLASS, so
// the swap to the page never moves on native. Mirrors the thread page: back chevron (phone) · avatar · the
// counterpart's name + the one trust / presence line, the item strip, the same four staggered bubbles the
// page shows for an uncached thread, and the composer bar.
export default function ThreadLoading() {
  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* Thread header (no border — bg only, like the real one) */}
        <div className={THREAD_HEADER_CLASS}>
          <Skeleton className="h-6 w-6 lg:hidden" />
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1">
            {/* counterpart name (text-sm) + the trust / presence line (text-2xs) */}
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        </div>

        {/* The item strip — the page shows the same placeholder until its thread lands.
            ⚠️ ACCEPTED RESIDUAL: this route-level skeleton renders before any client state exists, so it
            cannot know a thread has no listing (support, the rental desk); there this 56px row goes when the
            thread arrives. The page's own loading state does know (the inbox list) and skips it. */}
        <ThreadStripSkeleton />

        {/* Messages — same staggered bubbles as the page's uncached state */}
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
          {[['start', 'w-40'], ['end', 'w-28'], ['start', 'w-52'], ['end', 'w-36']].map(([side, w], i) => (
            <div key={i} className={`flex ${side === 'end' ? 'justify-end' : 'justify-start'}`}>
              <Skeleton className={`h-9 ${w} rounded-2xl`} />
            </div>
          ))}
        </div>

        {/* Composer — offer toggle · input (py-2.5 text-sm rows=1 → 42px) · send */}
        <div className="flex items-end gap-2 bg-background px-4 py-3 lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <Skeleton className="h-[42px] flex-1 rounded-2xl" />
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        </div>
      </div>
    </div>
  )
}
