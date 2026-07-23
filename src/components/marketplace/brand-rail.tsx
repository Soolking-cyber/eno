'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { BrandLogo } from './brand-logo'
import { MoreOverflow } from './more-overflow'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'

type BrandItem = { slug: string; name: string; count: number; iconPath: string | null }

// Line 2 of the search header. Large, flat square brand tiles (logo in a square
// field + name under, on the canvas — no fill) in one horizontally scrollable
// line. Tapping a brand filters by it and rolls its MODELS out to the right
// (pushing the brands after it); tapping again collapses. Matches the category
// rail's interaction + the home grid's flat look.
export function BrandRail({
  category,
  subcategory = 'all',
  activeBrand,
  activeModel,
  onPickBrand,
  onPickModel,
}: {
  category: string
  subcategory?: string
  activeBrand: string
  activeModel: string
  onPickBrand: (slug: string) => void
  onPickModel: (model: string) => void
}) {
  const { tr } = useLanguage()
  // Desktop ← / → arrows, same as the home rails (owner, 2026-07-22: "category brand reels
  // also need arrows like in home page"). The hook's ref IS the rail element, so it also
  // serves the auto-centre-the-active-brand effect below — one node, one ref.
  const [brands, setBrands] = useState<BrandItem[]>([])
  const { scrollerRef: railRef, canLeft, canRight, page, arrowTop } = useScrollArrows<HTMLDivElement>({ watch: brands.length })
  const [models, setModels] = useState<{ model: string; count: number }[]>([])
  // Read through refs inside the fetch effects so validating the CURRENT pick
  // doesn't add it to the deps (which would refetch on every brand/model tap).
  const pick = useRef({ activeBrand, activeModel, onPickBrand, onPickModel })
  pick.current = { activeBrand, activeModel, onPickBrand, onPickModel }

  // Slide the rail so the chosen brand sits at the left edge, models rolled out beside it.
  useEffect(() => {
    // Only scroll when OPENING a brand; on close/clear keep the scroll position.
    if (activeBrand === 'all') return
    const container = railRef.current
    const el = container?.querySelector(`[data-brand="${activeBrand}"]`) as HTMLElement | null
    if (!container || !el) return
    // Scroll ONLY this rail — NOT via el.scrollIntoView, which walks up and scrolls
    // every scrollable ancestor (incl. the document), shifting the whole results view
    // sideways and clipping the left edge. Move the container's own scrollLeft instead.
    const left = container.scrollLeft + (el.getBoundingClientRect().left - container.getBoundingClientRect().left)
    container.scrollTo({ left, behavior: 'smooth' })
  }, [activeBrand])

  useEffect(() => {
    let off = false
    fetch(`/api/brands?category=${encodeURIComponent(category)}&subcategory=${encodeURIComponent(subcategory)}&limit=40`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return
        const list: BrandItem[] = d.brands || []
        setBrands(list)
        // Hierarchy is category → subcategory → brand → model: a brand picked
        // under one scope may not exist in the next (Honda under Motorbike →
        // switch to Bicycle). Clear it instead of filtering the feed to zero.
        const { activeBrand: cur, onPickBrand: pb, onPickModel: pm } = pick.current
        if (cur !== 'all' && !list.some((b) => b.slug === cur)) { pb('all'); pm('all') }
      })
      .catch(() => { if (!off) setBrands([]) })
    return () => { off = true }
  }, [category, subcategory])

  useEffect(() => {
    if (activeBrand === 'all') { setModels([]); return }
    let off = false
    setModels([])
    fetch(`/api/brands/${encodeURIComponent(activeBrand)}/models?category=${encodeURIComponent(category)}&subcategory=${encodeURIComponent(subcategory)}`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return
        const list: { model: string; count: number }[] = d.models || []
        setModels(list)
        // Same healing one level down: a model picked under one scope may not
        // exist for this (brand, category, subcategory) — drop the stale pick.
        const { activeModel: cur, onPickModel: pm } = pick.current
        if (cur !== 'all' && !list.some((m) => m.model === cur)) pm('all')
      })
      .catch(() => {})
    return () => { off = true }
  }, [activeBrand, category, subcategory])

  if (brands.length === 0) return null

  // Most-used first (by listing count). Full-width swipeable rail like the category row
  // (user decision 2026-07-06): every brand rides the horizontal scroll — no More dropdown.
  const sortedBrands = [...brands].sort((a, b) => b.count - a.count)
  const sortedModels = [...models].sort((a, b) => b.count - a.count)
  // 3×3 grid (9 cells): "All" + up to 8 models fills it exactly, so only collapse into
  // a "More" cell when there are MORE than 8 — at ≤8 show them all.
  const modelsNeedMore = sortedModels.length > 8
  const visibleModels = modelsNeedMore ? sortedModels.filter((m, i) => i < 7 || m.model === activeModel) : sortedModels
  const overflowModels = modelsNeedMore ? sortedModels.filter((m, i) => i >= 7 && m.model !== activeModel) : []

  const tileCls = 'group flex w-[4.75rem] shrink-0 snap-start flex-col items-center gap-1.5 py-1 text-center cursor-pointer select-none'
  // ⚠️ w-full + break-words — same containment as category-rail. The span is a flex item
  // under `items-center`, so without w-full its width is fit-content and a long brand name
  // ("Mercedes-Benz", or anything once OS text scaling is on) spills outside the fixed
  // 4.75rem tile instead of wrapping into the line-clamp. break-words covers a single
  // unbreakable wordmark that is wider than the tile on its own.
  const nameCls = (active: boolean) =>
    cn('line-clamp-2 w-full break-words text-xs font-bold leading-tight transition-colors', active ? 'text-accent-foreground' : 'text-foreground group-hover:text-accent-foreground')
  const modelChip = (active: boolean) =>
    cn('w-full shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-sm font-semibold transition-colors cursor-pointer', active ? 'bg-card text-accent-foreground shadow-sm' : 'text-body hover:bg-card/70 hover:text-accent-foreground')

  return (
    // `relative` anchors the arrows, which sit OUTSIDE the scroller's edges (-left-8).
    <div className="relative">
    <div
      ref={railRef}
      // overscroll-x-contain: a sideways flick that hits either end must not CHAIN out to an
      // ancestor scroller / the iOS WebView's swipe-back. It does not (and cannot) stop a swipe
      // that STARTS in the system edge gutter — see the note on RAIL_SCROLLER in shelf.tsx.
      className="flex items-center gap-4 overflow-x-auto overscroll-x-contain scrollbar-none snap-x py-1"
    >
      {sortedBrands.map((b) => {
        const isActive = activeBrand === b.slug
        return (
          <Fragment key={b.slug}>
            {/* whitespace-normal: the base is whitespace-nowrap and white-space INHERITS,
                which would turn the line-clamp-2 brand name into one unwrappable line. */}
            <Button
              variant="bare"
              size="none"
              // ⚠️ iconSize={false} is REQUIRED. ui/button's base carries `[:where(&)_svg]:size-4`,
              // which out-specificities the BrandLogo svg's width/height ATTRIBUTES (presentational
              // attrs = specificity 0) and silently shrank the mark to 16px — the CategoryIcon dodged
              // it only because it sets h-11/w-11 CLASSES. Turning the rule off lets `size={48}` land.
              iconSize={false}
              data-brand={b.slug}
              onClick={() => { onPickBrand(isActive ? 'all' : b.slug); onPickModel('all') }}
              className={cn(tileCls, 'whitespace-normal')}
            >
              {/* Logo sits in the same h-11 box as the category icon, but at 48px (not 44) so a
                  brand MARK — which carries less internal ink than a full-bleed line icon, and is
                  short on wordmark brands (Samsung) — reads as visually the SAME size as the
                  category glyphs beside it. The 4px overflow is centered in the (un-clipped) box. */}
              <span className="flex h-11 items-center justify-center">
                <BrandLogo
                  name={b.name}
                  iconPath={b.iconPath}
                  size={48}
                  flat
                  className={cn('transition-transform duration-200 group-hover:scale-110', isActive ? '!text-accent-foreground' : '!text-body group-hover:!text-accent-foreground')}
                />
              </span>
              <span className={nameCls(isActive)}>{b.name}</span>
            </Button>

            {/* Models roll out to the right of the active brand */}
            {isActive && models.length > 0 && (
              <div className="flex shrink-0 items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                <span className="h-12 w-px shrink-0 bg-border" />
                {/* 3×3 grid (column-fill): All first, 7 most-used in between, More last. */}
                <div className="grid grid-rows-3 grid-flow-col auto-cols-max gap-x-1.5 gap-y-0.5 rounded-2xl bg-brand-50 p-1.5">
                  {/* justify-start: the base CENTRES, these chips are full-width text-left rows. */}
                  <Button variant="bare" size="none" onClick={() => onPickModel('all')} className={cn(modelChip(activeModel === 'all'), 'justify-start')}>{tr('All', 'Tất cả')}</Button>
                  {visibleModels.map((m) => {
                    const mActive = activeModel === m.model
                    return (
                      // gap-0 too: the count's spacing comes from its own ml-1; the base gap-2 would double it.
                      <Button
                        key={m.model}
                        variant="bare"
                        size="none"
                        onClick={() => onPickModel(mActive ? 'all' : m.model)}
                        className={cn(modelChip(mActive), 'justify-start gap-0')}
                      >
                        {m.model}
                        <span className="ml-1 text-3xs font-semibold text-ink-4">{m.count}</span>
                      </Button>
                    )
                  })}
                  {overflowModels.length > 0 && (
                    <MoreOverflow count={overflowModels.length}>
                      {overflowModels.map((m) => {
                        const mActive = activeModel === m.model
                        return (
                          // All four base-colliding classes ride the BUTTON: w-full (the base is
                          // inline-flex), justify-between (the base CENTRES), gap-3 (the base gap-2)
                          // and font-semibold (the base font-medium would inherit into the spans).
                          <Button
                            key={m.model}
                            variant="bare"
                            size="none"
                            onClick={() => onPickModel(mActive ? 'all' : m.model)}
                            className={cn('w-full justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold transition-colors active:scale-100', mActive ? 'bg-accent text-accent-foreground' : 'text-body hover:bg-muted hover:text-accent-foreground')}
                          >
                            <span className="truncate">{m.model}</span>
                            <span className="shrink-0 text-3xs font-semibold text-ink-4">{m.count}</span>
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
    </div>
      <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} tight />
    </div>
  )
}
