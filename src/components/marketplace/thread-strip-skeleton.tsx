import { Skeleton } from '@/components/ui/skeleton'

/**
 * The thread's item strip (inbox-03) while the thread loads — the real strip's box (`py-2` around a 40px
 * cover: 56px), shared by the route's loading.tsx and the page's own uncached state so the two paint the
 * same rows and nothing moves when the listing lands. A listing-less thread (support, the rental desk) has
 * no strip: the page skips this placeholder when the inbox list already knows that; only a COLD route-level
 * render (loading.tsx, before any client state exists) cannot know, and there the row goes when the thread
 * arrives.
 */
export function ThreadStripSkeleton() {
  return (
    <div aria-hidden data-strip-skeleton="" className="flex items-center gap-2 border-t border-border bg-background px-4 py-2">
      <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* title (text-xs) + price (text-xs bold) */}
        <Skeleton className="h-3 w-40 max-w-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  )
}
