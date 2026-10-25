import type { Metadata } from 'next'
import { ClassroomHeader } from '@/components/classroom/classroom-header'

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
 */
export default function ClassroomLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-classroom="" className="flex min-h-page flex-col bg-background">
      <ClassroomHeader />
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-12 pt-4 sm:px-6">
        {children}
      </main>
    </div>
  )
}
