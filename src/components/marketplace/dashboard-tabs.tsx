'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { useLanguage } from '@/context/language-context'
import { scrollBehavior } from '@/lib/reduced-motion'
import { cn } from '@/lib/utils'
import { sortTabClass } from './sort-tab-class'

/**
 * THE ONE TABBED SECTION SHELL — how the dashboard consolidates several old pages into one.
 *
 * Owner, 2026-09-01: "combine logical pages into one … clean seamless experience." The rail now
 * carries fewer, intent-named sections (Listings, Payments, Account, Services); each is one route
 * that mounts its former sibling pages as TABS. This component owns ALL the section chrome — the
 * mobile title bar, the desktop heading, the tab strip — so the mounted clients render CONTENT
 * ONLY. That is the whole reason each client takes an `embedded` prop: two headers stacked was the
 * exact bug the earlier verification hub hit, and centralising the chrome here makes it impossible.
 *
 * ⛔ ONLY THE ACTIVE TAB'S CLIENT IS MOUNTED. Every dashboard client fetches on mount, so rendering
 * all panels at once would fire three or four `/api/*` calls on one page load and pay for data
 * nobody is looking at. The inactive `TabsContent` stays in the DOM for ARIA (the panel exists,
 * announced and focusable) but its child is null until its tab is the active one — mount-on-demand
 * without losing the tablist semantics Base UI gives us.
 *
 * ⚠️ THE ACTIVE TAB IS THE URL, NOT LOCAL STATE — `?tab=` is the source of truth. That is what makes
 * an old bookmark (`/dashboard/wallet`) survive: its redirect lands on `/dashboard/payments?tab=wallet`
 * and this shell opens the right tab. `router.replace(..., { scroll: false })` keeps switching tabs
 * a client-side, no-jump operation, and Back does not accumulate a history entry per tab.
 */

export type DashboardTab = {
  /** URL token in `?tab=` — stable, lowercase, never localised. */
  value: string
  /** The tab strip label — already `tr()`'d by the caller. */
  label: React.ReactNode
  /** The section content for this tab — an existing `*Client`, rendered with `embedded`. */
  content: React.ReactNode
}

/**
 * The content a tier-gated tab shows for the ONE render between "dashboard payload still loading"
 * and "tier confirmed". A business viewer deep-linking `?tab=developers`/`?tab=bulk` (or arriving via
 * the /dev · /bulk redirects) would otherwise mount the FALLBACK tab's client — firing its fetch and
 * flashing the wrong panel — before the tier resolves and the real tab takes over. Holding the
 * requested tab present-but-skeletonised keeps the shell chrome correct and mounts no wrong client.
 */
export function DashboardTabPanelSkeleton() {
  const { tr } = useLanguage()
  return (
    <div className="w-full space-y-3" role="status" aria-label={tr('Loading…', 'Đang tải…')}>
      <Skeleton className="h-5 w-40 rounded-lg" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  )
}

export function DashboardTabs({
  title,
  tabs,
  fallbackHref,
  action,
}: {
  title: React.ReactNode
  tabs: DashboardTab[]
  /** Where the mobile Back affordance lands on a deep link with no in-app history. */
  fallbackHref?: string
  /** Optional right-aligned control on the mobile title bar. */
  action?: React.ReactNode
}) {
  const { tr } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // ⚠️ THE PARAM IS VALIDATED AGAINST THE REAL TABS, never trusted raw. `?tab=<anything>` from a
  // hand-edited URL falls back to the first tab rather than opening an empty panel.
  const requested = params.get('tab')
  const active = tabs.some((t) => t.value === requested) ? (requested as string) : tabs[0]?.value

  const onChange = useCallback(
    (value: unknown) => {
      const v = String(value)
      const next = new URLSearchParams(params.toString())
      next.set('tab', v)
      // ⚠️ `scroll: false` — switching a tab must not throw the reader back to the top of the page,
      // and `replace` (not push) keeps the Back button meaning "leave this section", not "cycle my
      // last four tab clicks".
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  // ⚠️ A DEEP LINK OPENS ON ITS OWN TAB (2026-11-06 audit). Settings' five tabs run past a 390px screen, so a link to
  // ?tab=preferences opened with the selected tab out of sight. The selected tab is brought into the strip — the strip's
  // own scroll, never scrollIntoView, which would move the page too (brand-rail's rule). No edge fade: the owner removed
  // the rails' "cloudy effect" on 2026-08-26, and the hard clip is the accepted cue (shelf.tsx, category-rail.tsx).
  const hasStrip = tabs.length > 1
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const reveal = () => {
      const tab = el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (!tab || el.scrollWidth <= el.clientWidth) return
      const box = el.getBoundingClientRect()
      const t = tab.getBoundingClientRect()
      // Clear of the strip's 12px phone gutter.
      const pad = 12
      const by = t.right > box.right - pad ? t.right - box.right + pad
        : t.left < box.left + pad && el.scrollLeft > 0 ? t.left - box.left - pad
        : 0
      if (by) el.scrollTo({ left: el.scrollLeft + by, behavior: scrollBehavior() })
    }
    reveal()
    // ⚠️ AND AGAIN WHENEVER THE STRIP OR ITS TABS CHANGE SIZE, not only when `active` does (2026-11-06 review): a phone
    // turned from landscape to portrait, or a machine-translated language's labels landing after the first paint (they
    // arrive from an effect in language-context.tsx), put the selected tab back out of sight. A swipe along the strip
    // resizes nothing, so the reader's own scroll is never undone. Guarded because jsdom has no ResizeObserver.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(reveal)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [active, hasStrip])

  return (
    <>
      {/* Mobile-only pushed-screen title bar (lg:hidden); the rail carries the title on desktop. */}
      <SectionHeader title={title} action={action} {...(fallbackHref ? { fallbackHref } : {})} />

      {/* ⚠️ NO WIDTH CAP HERE — the section fills the dashboard main's canonical `max-w-7xl`, exactly
          as the standalone pages did. An earlier `max-w-3xl` wrapper silently re-capped the wide
          surfaces it now hosts: the 7-column e-Visa cases table (whose own comment records dropping
          its cap on purpose, owner 2026-07-24) and the listings greeting/stats/table both scrolled
          horizontally beside empty space. Narrow forms are the callers' business — payout/wallet
          self-cap `max-w-lg`, settings caps its own fields — never the shell's. */}
      <div className="w-full">
        {/* ⚠️ `max-lg:sr-only`, NOT `hidden lg:block`. SectionHeader shows the VISIBLE title on small
            screens (and it is not an <h1>), but `display:none` would strip this <h1> from the
            ACCESSIBILITY tree there too — leaving a phone screen-reader with no page heading on the
            section. sr-only keeps the h1 in the outline on mobile (visually hidden, zero layout) and
            shows it plainly on desktop, where SectionHeader is hidden. One h1, present on every size. */}
        <PageHeader title={title} titleClassName="max-lg:sr-only" />

        <Tabs value={active} onValueChange={onChange} className="mt-3 lg:mt-4">
          {/* ⚠️ NO STRIP FOR A LONE TAB. A tier-gated section can resolve to a single tab — an
              individual's Listings is just "All" once Bulk is gated away — and a one-item tab strip is
              pointless chrome under the section title. Hide the list (the panel still renders via the
              controlled value); the strip reappears the moment a second tab does. */}
          {hasStrip && (
            /* The strip scrolls on a narrow phone rather than wrapping to two rows. UNDERLINED 44px TABS, NOT A GREY PILL
               (2026-11-07 audit): the pill looked like the status filter under it, missed the 44px floor, and ended flush at a
               phone's edge without saying it scrolls; a label cut at the edge does. No edge fade (owner, 2026-08-26). -mb-px
               lays each underline over the list's own border, so nothing overflows; the ring is inset, the scroller clips. */
            <div ref={stripRef} className="-mx-3 overflow-x-auto overflow-y-hidden px-3 sm:mx-0 sm:px-0 scroll-thin">
              <TabsList
                variant="line"
                aria-label={typeof title === 'string' ? title : tr('Section', 'Mục')}
                className="min-w-full justify-start border-b border-border p-0 group-data-horizontal/tabs:h-auto"
              >
                {tabs.map((t) => (
                  <TabsTrigger key={t.value} value={t.value} className={cn(sortTabClass(active === t.value), '-mb-px min-h-11 focus-visible:ring-inset')}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          )}

          {tabs.map((t) => (
            <TabsContent key={t.value} value={t.value} className="mt-4">
              {/* ⛔ MOUNT-ON-DEMAND: the panel exists for ARIA, its client only when this tab is
                  active — so the other tabs' clients never fetch until opened. */}
              {active === t.value ? t.content : null}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </>
  )
}
