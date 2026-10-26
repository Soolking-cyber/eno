import type { Metadata } from 'next'
import { ClassroomHeader } from '@/components/classroom/classroom-header'
import { BARS_IN_COLUMN, COLUMN } from '@/components/classroom/column'
import { cn } from '@/lib/utils'

// eno Classroom (owner, 2026-10-25) — its own app inside eno.vn; classroom.<base> 302s here (src/lib/classroom/host.ts).
// Private by nature: every page is signed-in or an invite, so nothing here is indexed.
export const metadata: Metadata = {
  title: { default: 'eno Classroom', template: '%s | eno Classroom' },
  robots: { index: false, follow: false },
}

/**
 * ⛔ `data-classroom` IS THE CHROME SWITCH: globals.css hides the marketplace's phone tab bar, its spacer and the floating
 * support mark on any page carrying it — from the first paint, server-rendered (the data-teacher-host pattern). The
 * classroom is its own app (owner: "super clean", Praktika-like); nothing of the marketplace sits over a practice session.
 * MOBILE FIRST (owner, 2026-10-26): one phone-width column at every size (column.ts). The page's bottom padding clears the
 * home indicator; a page with one primary action pins it to the bottom edge (page-actions.tsx), which reserves its own room.
 */
export default function ClassroomLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-classroom="" className={cn('flex min-h-page flex-col bg-background', BARS_IN_COLUMN)}>
      <ClassroomHeader />
      <main id="main" tabIndex={-1} className={cn(COLUMN, 'flex flex-1 flex-col pb-[max(3rem,calc(env(safe-area-inset-bottom)+1.5rem))] pt-4')}>
        {children}
      </main>
    </div>
  )
}
