import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * THE ONE SHELL EVERY ADMIN SECTION RENDERS IN (console v2, owner 2026-09-05: "combine, fewer pages,
 * easy to manage"). Seven sections instead of eleven top-level pages; the queues that used to be
 * pages are TABS inside a section, addressed by `?tab=` so every tab stays a bookmarkable URL and
 * the old URLs redirect into it.
 *
 * ⚠️ TABS ARE LINKS, NOT ARIA TABS. Switching a tab is a navigation (a different server render), so
 * the strip is a `<nav>` of anchors with `aria-current` — middle-click, prefetch and screen readers
 * all behave as for any link. Admin chrome is EN-only by repo convention.
 */
export type SectionTab = { key: string; label: string; count?: number | null }

export function pickTab<T extends string>(raw: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  const v = Array.isArray(raw) ? raw[0] : raw
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback
}

export function AdminSectionShell({
  title,
  description,
  basePath,
  tabs,
  active,
  width = 'wide',
  children,
}: {
  title: string
  description?: React.ReactNode
  basePath?: string
  tabs?: SectionTab[]
  active?: string
  width?: 'wide' | 'narrow'
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <main
        id="main"
        tabIndex={-1}
        className={cn('mx-auto w-full flex-1 px-3 py-8 sm:px-6 lg:px-8', width === 'narrow' ? 'max-w-4xl' : 'max-w-7xl')}
      >
        <div className="mb-5">
          <h1 className="h-title text-foreground">{title}</h1>
          {description && <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div>}
        </div>
        {tabs && tabs.length > 1 && basePath && (
          <nav aria-label={`${title} sections`} className="-mx-3 mb-6 border-b border-border px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <ul className="scrollbar-none flex flex-nowrap items-center gap-1 overflow-x-auto">
              {tabs.map((t) => {
                const selected = t.key === active
                return (
                  <li key={t.key}>
                    <Link
                      href={`${basePath}?tab=${t.key}`}
                      aria-current={selected ? 'page' : undefined}
                      className={cn(
                        '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors duration-100',
                        selected ? 'border-brand text-accent-foreground' : 'border-transparent text-body hover:text-foreground',
                      )}
                    >
                      {t.label}
                      {t.count != null && t.count > 0 && (
                        <span className="rounded-full bg-tint px-1.5 py-px text-2xs font-bold text-ink-4">{t.count}</span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}
        {children}
      </main>
    </div>
  )
}
