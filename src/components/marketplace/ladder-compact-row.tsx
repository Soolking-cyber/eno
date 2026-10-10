'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { useLanguage, Tr } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, LayoutGrid, Plus, UserRound } from '@/components/ui/icons'
import { CategoryIcon } from './category-icons'
import { offeredCategories, offeredIntents, offeredSubcategories } from './count-chip'
import { STROKE_UI } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'
import { teacherJoinUrl } from '@/lib/teachers/host'
import { categoryEntryLabel } from '@/lib/category-entry-label'
import { localizedHref } from '@/lib/lang-pinned'
import { keepTeacherJoinInApp } from '@/components/teachers/teacher-join-click'
import type { SerializedCategory } from '@/lib/types'
// Type only — erased at compile, so the module's Prisma/`server-only` chain never reaches the client.
import type { FacetCounts } from '@/lib/facet-counts'

/**
 * THE CATEGORY LADDER, COLLAPSED TO ONE ROW — the phone feed once the reader has asked it something.
 *
 * ⛔ OWNER DECISION (mobile audit, 2026-09-24): "Collapse to one compact row". Measured at 390×844 on
 * production: with a search or a filter applied, the first result sat at y=681 (search) and y=535
 * (home), under a two-to-three-row category tile grid (~263px) and a brand-logo rail (~112px) — about
 * 80% of the first screen was controls, and a "no results" answer sat below the fold. Once the feed
 * is DIRECTED those tiles have done their job; the answer is what the reader came for.
 *
 * WHAT THE ROW HOLDS (one line, horizontally scrollable, nothing wraps):
 *   · the SCOPE button first — the current category (or "All categories"), highlighted, with a
 *     chevron: tap it and the full ladder (tile grid + brands) opens below it, tap again and it folds
 *     back. It is a Base UI Collapsible trigger, so aria-expanded / aria-controls come from the library.
 *   · then the NEXT RUNG, as chips: the active category's subcategories when it has any, otherwise
 *     the categories themselves and the intent shortcuts (Free, Wanted, Wholesale). One tap narrows,
 *     exactly as the same chip does in the full rail.
 * ⚠️ eno's own DESK shortcuts are not offered here: the list is empty on both editions (taxonomy.ts,
 * 2026-09-13), and the expanded ladder still carries the slot if it ever fills again.
 *
 * ⚠️ NO MOTION ON THE COLLAPSE ITSELF. It happens on the tap that directs the feed — a search, a
 * category, a filter — i.e. tens of times a session, which is exactly where an animation reads as
 * the interface being slow (Emil's frequency rule). Only the chevron turns, which says "this opens".
 */
export function LadderCompactRow({
  categories,
  activeCategory,
  activeSubcategory,
  onCategory,
  onSubcategory,
  intents,
  activeType,
  onIntent,
  expanded,
  facets,
  subcategoryCounts = {},
  teacherProfile = false,
}: {
  categories: SerializedCategory[]
  activeCategory: string
  activeSubcategory: string
  onCategory: (slug: string) => void
  onSubcategory: (slug: string) => void
  intents?: { type: string; name: string; nameVi: string; icon: string }[]
  activeType?: string
  onIntent?: (type: string) => void
  /** Is the full ladder open below this row? The chips give way to it while it is. */
  expanded: boolean
  /** The feed's chip counts and legacy subcategory counts — the same two the full rail reads. */
  facets?: FacetCounts
  subcategoryCounts?: Record<string, number>
  /** The viewer already has a teacher profile: the teachers row's first chip opens it instead of the sign-up form. */
  teacherProfile?: boolean
}) {
  const { lang, tr } = useLanguage()
  // tr(name, nameVi): the authored Vietnamese for vi, a translation of the English for the nine others
  // (it used to hand the Vietnamese to <Tr>, which machine-translated Vietnamese into Vietnamese).
  const label = (x: { name: string; nameVi?: string | null }) => tr(x.name, x.nameVi || x.name)
  /**
   * ⛔ THE SAME OFFER AS THE FULL RAIL (E-TILES, 2026-09-29): an empty category, subcategory or intent is
   * not a chip here either. This row used to list EVERY subcategory — eleven for Rentals at 390px, most
   * of them empty, beside the four the desktop plate offers for the same feed. The rules are shared
   * with CategoryRail (count-chip.tsx), so the two ladders cannot offer different sets.
   */
  const shown = offeredCategories(categories, facets, activeCategory)
  const shownIntents = offeredIntents(intents, facets, activeType)
  // ⚠️ ONLY A CATEGORY THIS EDITION SHOWS. `?category=<slug>` can name one from the other edition;
  // the rail guards the same way (its subcategory plate lives inside `categories.map`).
  const active = categories.find((c) => c.slug === activeCategory) ?? null
  const subs = active ? offeredSubcategories(active.slug, facets, subcategoryCounts, activeSubcategory).subs : []
  // Teachers keep the SUBCATEGORY shape even with none offered — "All" and the way in — exactly as the rail's plate does
  // (category-rail.tsx `plateOpen`); otherwise the link sank to the end of every category chip, in a "Categories" group
  // (pill verification, 2026-10-09).
  const teachers = active?.slug === TEACHERS_CATEGORY_SLUG
  const subRow = subs.length > 0 || teachers

  // One chip look for every rung. 44px tall so the whole visible pill is the hit area (the facet
  // pills directly below are 48px); pressed = the same brand-50 tint the rail uses for "chosen".
  const chipCls =
    'min-h-11 shrink-0 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition-[background-color,color,scale] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.97] motion-reduce:transition-none ' +
    'bg-tint text-body data-pressed:bg-brand-50 data-pressed:text-accent-foreground'

  return (
    <div className="flex items-center gap-2" data-slot="ladder-compact-row">
      {/* The look lives on the <Button> itself, not on the trigger: a render child's className is
          concatenated, not merged, so only the primitive's own className beats its base classes
          (CLAUDE.md — the same shape custom-select.tsx uses). */}
      <CollapsibleTrigger
        render={<Button variant="bare" size="none" className="min-h-11 shrink-0 gap-1.5 rounded-full bg-brand-50 pl-3 pr-2.5 text-sm font-bold text-accent-foreground" />}
      >
        {active
          ? <CategoryIcon name={active.icon} stroke={STROKE_UI} selected className="h-4 w-4 shrink-0" />
          : <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="max-w-[10rem] truncate">
          {active ? label(active) : tr('All categories', 'Tất cả danh mục')}
        </span>
        <ChevronDown
          aria-hidden
          className={cn('h-4 w-4 shrink-0 transition-transform duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-none', expanded && 'rotate-180')}
        />
      </CollapsibleTrigger>

      {!expanded && (
        <div
          role="group"
          aria-label={subRow ? tr('Subcategories', 'Danh mục con') : tr('Categories', 'Danh mục')}
          // Bleeds to the page's right gutter so the last chip is cut by the screen edge, not by an
          // invisible box — which is what says "this row scrolls".
          className="-mr-3 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain scrollbar-none pr-3 sm:-mr-6 sm:pr-6"
        >
          {subRow ? (
            <>
              {/* ⛔ TEACHERS: THE WAY IN, FIRST in this row (owner, 2026-10-09: "add a button here as subcat that will
                  redirect to teacher.eno.vn to create their profile" — and "apply recommended": first, so a phone shows it
                  without a swipe). The rail plate's last chip in this row's pill look. A link: no pressed state; in the
                  app it stays in the app (keepTeacherJoinInApp); a teacher who already has a profile gets theirs. */}
              {teachers && (
                <Button variant="bare" size="none" asChild className={cn(chipCls, 'inline-flex items-center gap-1 text-accent-foreground')}>
                  {teacherProfile ? (
                    <a href={localizedHref('/teachers/edit', lang)} data-cross-link="teacher-profile-edit">
                      <UserRound className="size-4 shrink-0" aria-hidden />
                      {tr('Your teacher profile', 'Hồ sơ giáo viên của bạn')}
                    </a>
                  ) : (
                    <a href={teacherJoinUrl()} data-cross-link="teacher-profile" onClick={(e) => keepTeacherJoinInApp(e, lang)}>
                      <Plus className="size-4 shrink-0" aria-hidden />
                      {tr('Create a teacher profile', 'Tạo hồ sơ giáo viên')}
                    </a>
                  )}
                </Button>
              )}
              <Toggle pressed={activeSubcategory === 'all'} onPressedChange={() => onSubcategory('all')} className={chipCls}>
                {tr('All', 'Tất cả')}
              </Toggle>
              {subs.map((sub) => {
                const on = activeSubcategory === sub.slug
                return (
                  <Toggle key={sub.slug} pressed={on} onPressedChange={() => onSubcategory(on ? 'all' : sub.slug)} className={chipCls}>
                    {label(sub)}
                  </Toggle>
                )
              })}
              {/* ⚠️ AN APPLIED INTENT STAYS VISIBLE (and clearable) HERE TOO: Free + a category with
                  subcategories would otherwise filter the feed by something this row never shows. */}
              {intents?.filter((it) => it.type === activeType).map((it) => (
                <Toggle key={it.type} pressed onPressedChange={() => onIntent?.(it.type)} className={chipCls}>
                  {label(it)}
                </Toggle>
              ))}
            </>
          ) : (
            <>
              {shown.map((cat) => {
                const on = cat.slug === activeCategory
                return (
                  <Toggle key={cat.slug} pressed={on} onPressedChange={() => onCategory(on ? 'all' : cat.slug)} className={chipCls}>
                    {/* A way in, so its entry label, like the rail tile it folds from: Teachers reads "Find a
                        teacher" (category-entry-label.ts). The pill above names the ACTIVE filter, so it keeps
                        the category's own name, as the result line does. */}
                    {label(categoryEntryLabel(cat))}
                  </Toggle>
                )
              })}
              {shownIntents?.map((it) => (
                <Toggle key={it.type} pressed={activeType === it.type} onPressedChange={() => onIntent?.(it.type)} className={chipCls}>
                  {label(it)}
                </Toggle>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * THE LADDER'S SLOT: the full rails (children) as they always were, or — collapsed — the compact row
 * with the same rails behind it.
 * ⚠️ UNCOLLAPSED IT IS A FRAGMENT, so the rails stay DIRECT children of the explorer's `space-y-4`
 * stack exactly as before: home, desktop and every undirected state render byte-for-byte what they did.
 * ⚠️ COLLAPSED, THE RAILS ARE NOT MOUNTED UNTIL OPENED (the Collapsible panel unmounts when closed):
 * the brand rail fetches /api/brands on mount, and a folded ladder should cost the directed feed
 * nothing. Opening mounts them, so the category rail's own "scroll the active tile into view" runs
 * against a visible rail.
 * The panel fades in on open (150ms, opacity only; none under reduced motion) and leaves at once:
 * the chips take its place in the same commit, so a fade-out would stack the two.
 */
export function LadderSlot({
  collapsed,
  open,
  onOpenChange,
  row,
  children,
}: {
  collapsed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ReactNode
  children: ReactNode
}) {
  if (!collapsed) return <>{children}</>
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      {row}
      <CollapsiblePanel className="mt-4 space-y-4 transition-opacity duration-150 ease-[var(--ease-out-strong)] data-starting-style:opacity-0 motion-reduce:transition-none">
        {children}
      </CollapsiblePanel>
    </Collapsible>
  )
}

/**
 * Is the viewport at least `md` (768px) — the breakpoint where the category rail itself switches from
 * its phone layout to its desktop one? The compact row is a PHONE answer; desktop keeps the full rail.
 * ⚠️ "DESKTOP" ON THE SERVER AND ON THE HYDRATING RENDER, and that cannot mismatch: the explorer's
 * filters are applied from the URL in effects, so the directed state this gates never exists in the
 * server HTML or in the hydration pass. The real value arrives with the first client commit.
 * ⚠️ `addListener` fallback: Safari ≤13 has no `addEventListener` on MediaQueryList (ui/tooltip.tsx
 * records the white screen that throw would cause).
 */
const MD_UP = '(min-width: 768px)'
function subscribeMdUp(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(MD_UP)
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }
  mql.addListener(onChange)
  return () => mql.removeListener(onChange)
}
const getMdUp = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(MD_UP).matches : true)
const getMdUpServer = () => true
export function useMdUp(): boolean {
  return useSyncExternalStore(subscribeMdUp, getMdUp, getMdUpServer)
}
