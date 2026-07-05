'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Shared header for ALL admin pages — rendered once by src/app/admin/layout.tsx so
// every page gets it (and its section nav) for free. Container matches the app-wide
// canonical width/gutter (max-w-7xl px-3 sm:px-6 lg:px-8 — same as Header/Footer) so
// admin lines up with the rest of the site. No consumer search bar / area picker.
const SECTIONS = [
  { href: '/admin', label: 'Reports' },
  { href: '/admin/enforcement', label: 'Enforcement' },
  { href: '/admin/listings', label: 'Listings' },
  { href: '/admin/brands', label: 'Brands' },
  { href: '/admin/feedback', label: 'Feedback' },
]

export function AdminHeader() {
  const pathname = usePathname()
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3">
          <Link href="/" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="eno.vn" width={36} height={36} className="h-9 w-9" />
            <span className="text-sm font-bold text-foreground">Admin</span>
          </Link>
          <Link href="/" className="text-sm font-semibold text-accent-foreground hover:underline">Back to site</Link>
        </div>
        <nav aria-label="Admin sections" className="scrollbar-none -mx-3 flex gap-1 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
          {SECTIONS.map((s) => {
            const active = s.href === '/admin' ? pathname === '/admin' : pathname.startsWith(s.href)
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                  active ? 'bg-[#0a66c2] text-white' : 'text-body hover:bg-muted',
                )}
              >
                {s.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
