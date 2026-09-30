import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * THE PAGE TITLE ROW (D-PAGEHEADER, 2026-09-29): the heading on the ramp, an optional one-line meta
 * under it, optional actions at the end. No hooks and no 'use client', so a server page and a client
 * screen use the same one.
 *
 * ⚠️ WHY IT EXISTS: the heading ramp was always there as classes (`.h-display` 28→40px, `.h-title`
 * 20→24px in globals.css), but nothing made an h1 use them, and the app grew eight page-title styles —
 * text-xl, text-lg, text-2xl sm:text-3xl, text-base … Two neighbours in the same dashboard shell
 * rendered 20px and 24px titles. design-lint now counts h1s off the ramp (a ratchet: it fails only
 * when the count rises), and this is the thing to reach for instead.
 *
 *   level="title"    app screens — saved, inbox, settings, dashboard sections (the default)
 *   level="display"  landing, category, SEO and /post heroes
 *   as               'h1' (default) or 'h2' when the page already has its h1 elsewhere
 *   titleClassName   for the heading itself, e.g. `max-lg:sr-only` where a mobile SectionHeader
 *                    shows the visible title and this one stays for the outline
 *
 * `text-balance` so a two-line Vietnamese title breaks evenly instead of leaving one word behind.
 */
export function PageHeader({
  title,
  meta,
  actions,
  level = 'title',
  as: Heading = 'h1',
  className,
  titleClassName,
  id,
}: {
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  level?: 'display' | 'title'
  as?: 'h1' | 'h2'
  className?: string
  titleClassName?: string
  /** On the heading, for an `aria-labelledby` elsewhere on the page. */
  id?: string
}) {
  return (
    <div data-slot="page-header" className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <Heading id={id} className={cn(level === 'display' ? 'h-display' : 'h-title', 'text-balance text-foreground', titleClassName)}>
          {title}
        </Heading>
        {meta && <p className="mt-1 text-sm text-muted-foreground">{meta}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
