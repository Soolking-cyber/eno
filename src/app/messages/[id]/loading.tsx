import { Skeleton } from '@/components/ui/skeleton'

// Thread right-pane skeleton (the layout already provides Header + the list).
// Mirrors the thread page: flat bg-card header (mobile back chevron · avatar ·
// name + listing-title lines), the same four staggered bubble placeholders the
// page itself shows for an uncached thread, and the composer bar.
export default function ThreadLoading() {
  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* Thread header (no border — bg-card only, like the real one) */}
        <div className="flex items-center gap-3 bg-background px-4 py-3">
          <Skeleton className="h-5 w-5 lg:hidden" />
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1">
            {/* counterpart name (text-sm) + listing title (text-xs) */}
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>

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
