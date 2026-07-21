'use client'

import { Fragment, useEffect, useRef } from 'react'
import { Layers } from 'lucide-react'
import { useLanguage, Tr } from '@/context/language-context'
import { CategoryIcon } from './category-icons'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { MoreOverflow } from './more-overflow'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { SerializedCategory } from '@/lib/types'

// Line 1 of the search header. Large, flat category tiles (icon + name, on the
// canvas — no background fill, matching the home grid) in one horizontally
// scrollable line. Tapping a category rolls its subcategories OUT to the right
// (pushing the categories after it further along); tapping it again collapses.
export function CategoryRail({
  categories,
  activeCategory,
  activeSubcategory,
  subcategoryCounts,
  onCategory,
  onSubcategory,
  intents,
  activeType,
  onIntent,
}: {
  categories: SerializedCategory[]
  activeCategory: string
  activeSubcategory: string
  subcategoryCounts: Record<string, number>
  onCategory: (slug: string) => void
  onSubcategory: (slug: string) => void
  // Intent shortcuts (Free / Wanted) — appended after the categories so the results
  // rail matches the home grid, which shows these tiles alongside the categories.
  // They filter the listingType axis (not the category), highlighting when active.
  intents?: { type: string; name: string; nameVi: string; icon: string }[]
  activeType?: string
  onIntent?: (type: string) => void
}) {
  const { lang, tr } = useLanguage()
  const railRef = useRef<HTMLDivElement>(null)

  // When a category is chosen, slide the rail so that category sits at the left edge
  // — the user immediately sees their pick with its subcategories rolled out beside it.
  useEffect(() => {
    // Only scroll when OPENING a category (bring it to the left). On close/clear
    // ('all') leave the scroll position untouched so the user keeps their place.
    if (activeCategory === 'all') return
    const container = railRef.current
    const el = container?.querySelector(`[data-cat="${activeCategory}"]`) as HTMLElement | null
    if (!container || !el) return
    // Scroll ONLY this rail (see brand-rail): el.scrollIntoView would also scroll the
    // document horizontally and clip the whole results view. Move scrollLeft instead.
    const left = container.scrollLeft + (el.getBoundingClientRect().left - container.getBoundingClientRect().left)
    container.scrollTo({ left, behavior: 'smooth' })
  }, [activeCategory])

  const tileCls = 'group flex w-[4.75rem] shrink-0 snap-start flex-col items-center gap-1.5 py-1 text-center cursor-pointer select-none'
  const iconCls = (active: boolean) =>
    cn('h-11 w-11 transition-transform duration-200 group-hover:scale-110', active ? 'text-accent-foreground' : 'text-body group-hover:text-accent-foreground')
  // ⚠️ w-full + break-words. The tile is a FIXED 4.75rem column, but this span is a flex
  // item under `items-center`, so its width is fit-content — a long label (or any label
  // once OS text scaling is on) grew WIDER than the tile and spilled over its neighbours;
  // line-clamp's overflow:hidden can't help, because it's the element, not its content,
  // that overflows. w-full pins it to the tile so the clamp wraps + truncates inside it,
  // and break-words handles a single unbreakable token (a long brand/category word).
  const nameCls = (active: boolean) =>
    cn('line-clamp-2 w-full break-words text-xs font-bold leading-tight transition-colors', active ? 'text-accent-foreground' : 'text-foreground group-hover:text-accent-foreground')

  const subChip = (active: boolean) =>
    cn('w-full shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-sm font-semibold transition-colors cursor-pointer', active ? 'bg-card text-accent-foreground shadow-sm' : 'text-body hover:bg-card/70 hover:text-accent-foreground')

  return (
    <div ref={railRef} className="flex items-center gap-4 overflow-x-auto scrollbar-none snap-x py-1">
      {/* All */}
      <Button variant="bare" size="none" data-cat="all" onClick={() => onCategory('all')} className={cn('whitespace-normal', tileCls)}>
        <span className="flex h-11 items-center justify-center">
          <Layers className={iconCls(activeCategory === 'all')} />
        </span>
        <span className={nameCls(activeCategory === 'all')}>{tr('All', 'Tất cả')}</span>
      </Button>

      {categories.map((cat) => {
        const isActive = activeCategory === cat.slug
        // Order subcategories by how many listings they hold (most first); ties keep
        // taxonomy order. Empty counts (pre-load) leave the canonical order.
        const subs = isActive
          ? [...(SUBCATEGORIES[cat.slug] ?? [])].sort((a, b) => (subcategoryCounts[b.slug] ?? 0) - (subcategoryCounts[a.slug] ?? 0))
          : []
        // 3×3 grid (9 cells): "All" + up to 8 subcats. All+8 fills it exactly, so only
        // collapse into a "More" cell when there are MORE than 8 — at ≤8 show them all.
        // (auto-adjusts as the listing counts above re-rank them.)
        const subsNeedMore = subs.length > 8
        const visibleSubs = subsNeedMore ? subs.slice(0, 7) : subs
        const overflowSubs = subsNeedMore ? subs.slice(7) : []
        return (
          <Fragment key={cat.id}>
            <Button variant="bare" size="none" data-cat={cat.slug} onClick={() => onCategory(isActive ? 'all' : cat.slug)} className={cn('whitespace-normal', tileCls)}>
              <span className="flex h-11 items-center justify-center">
                <CategoryIcon name={cat.icon} className={iconCls(isActive)} />
              </span>
              <span className={nameCls(isActive)}><Tr text={lang === 'vi' ? cat.nameVi : cat.name} /></span>
            </Button>

            {/* Subcategories roll out to the right of the active category */}
            {subs.length > 0 && (
              <div className="flex shrink-0 items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                <Separator orientation="vertical" className="h-12 shrink-0" />
                {/* 3×3 grid (column-fill): All first, 7 most-used in between, More last. */}
                <div className="grid grid-rows-3 grid-flow-col auto-cols-max gap-x-1.5 gap-y-0.5 rounded-2xl bg-brand-50 p-1.5">
                  <Button variant="bare" size="none" onClick={() => onSubcategory('all')} className={cn('block', subChip(activeSubcategory === 'all'))}>{tr('All', 'Tất cả')}</Button>
                  {visibleSubs.map((sub) => {
                    const subActive = activeSubcategory === sub.slug
                    const count = subcategoryCounts[sub.slug]
                    return (
                      <Button key={sub.slug} variant="bare" size="none" onClick={() => onSubcategory(subActive ? 'all' : sub.slug)} className={cn('block', subChip(subActive))}>
                        <CategoryIcon name={sub.icon} className="mr-1 inline h-3.5 w-3.5 shrink-0 align-[-2px]" />
                        <Tr text={lang === 'vi' ? sub.nameVi : sub.name} />
                        {count != null && <span className="ml-1 text-3xs font-semibold text-ink-4">{count}</span>}
                      </Button>
                    )
                  })}
                  {overflowSubs.length > 0 && (
                    <MoreOverflow count={overflowSubs.length}>
                      {overflowSubs.map((sub) => {
                        const subActive = activeSubcategory === sub.slug
                        const count = subcategoryCounts[sub.slug]
                        return (
                          <Button
                            key={sub.slug}
                            variant="bare"
                            size="none"
                            onClick={() => onSubcategory(subActive ? 'all' : sub.slug)}
                            className={cn('flex w-full justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left font-semibold transition-colors active:scale-100', subActive ? 'bg-accent text-accent-foreground' : 'text-body hover:bg-muted hover:text-accent-foreground')}
                          >
                            <span className="flex min-w-0 items-center gap-2"><CategoryIcon name={sub.icon} className="h-4 w-4 shrink-0 text-ink-4" /><span className="truncate"><Tr text={lang === 'vi' ? sub.nameVi : sub.name} /></span></span>
                            {count != null && <span className="shrink-0 text-3xs font-semibold text-ink-4">{count}</span>}
                          </Button>
                        )
                      })}
                    </MoreOverflow>
                  )}
                </div>
              </div>
            )}
          </Fragment>
        )
      })}

      {/* Free / Wanted intent tiles — mirror the home grid so no shortcut goes missing
          in the results view. Separated from the categories by a hairline so it reads as
          a distinct "intent" group; each toggles the listingType filter. */}
      {intents && intents.length > 0 && (
        <>
          <Separator orientation="vertical" className="h-11 shrink-0" />
          {intents.map((s) => {
            const active = activeType === s.type
            return (
              <Button key={s.type} variant="bare" size="none" data-intent={s.type} onClick={() => onIntent?.(s.type)} className={cn('whitespace-normal', tileCls)}>
                <span className="flex h-11 items-center justify-center">
                  <CategoryIcon name={s.icon} className={iconCls(active)} />
                </span>
                <span className={nameCls(active)}><Tr text={lang === 'vi' ? s.nameVi : s.name} /></span>
              </Button>
            )
          })}
        </>
      )}
    </div>
  )
}
