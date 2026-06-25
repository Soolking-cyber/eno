'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { BrandLogo } from './brand-logo'

type BrandItem = { slug: string; name: string; count: number; iconPath: string | null }

// Line 2 of the search header. Large, flat square brand tiles (logo in a square
// field + name under, on the canvas — no fill) in one horizontally scrollable
// line. Tapping a brand filters by it and rolls its MODELS out to the right
// (pushing the brands after it); tapping again collapses. Matches the category
// rail's interaction + the home grid's flat look.
export function BrandRail({
  category,
  activeBrand,
  activeModel,
  onPickBrand,
  onPickModel,
}: {
  category: string
  activeBrand: string
  activeModel: string
  onPickBrand: (slug: string) => void
  onPickModel: (model: string) => void
}) {
  const { tr } = useLanguage()
  const railRef = useRef<HTMLDivElement>(null)
  const [brands, setBrands] = useState<BrandItem[]>([])
  const [models, setModels] = useState<{ model: string; count: number }[]>([])

  // Slide the rail so the chosen brand sits at the left edge, models rolled out beside it.
  useEffect(() => {
    // Only scroll when OPENING a brand; on close/clear keep the scroll position.
    if (activeBrand === 'all') return
    const el = railRef.current?.querySelector(`[data-brand="${activeBrand}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  }, [activeBrand])

  useEffect(() => {
    let off = false
    fetch(`/api/brands?category=${encodeURIComponent(category)}&limit=40`)
      .then((r) => r.json())
      .then((d) => { if (!off) setBrands(d.brands || []) })
      .catch(() => { if (!off) setBrands([]) })
    return () => { off = true }
  }, [category])

  useEffect(() => {
    if (activeBrand === 'all') { setModels([]); return }
    let off = false
    setModels([])
    fetch(`/api/brands/${encodeURIComponent(activeBrand)}/models?category=${encodeURIComponent(category)}`)
      .then((r) => r.json())
      .then((d) => { if (!off) setModels(d.models || []) })
      .catch(() => {})
    return () => { off = true }
  }, [activeBrand, category])

  if (brands.length === 0) return null

  const tileCls = 'group flex w-[4.75rem] shrink-0 snap-start flex-col items-center gap-1.5 py-1 text-center cursor-pointer select-none'
  const nameCls = (active: boolean) =>
    cn('line-clamp-2 text-xs font-bold leading-tight transition-colors', active ? 'text-accent-foreground' : 'text-foreground group-hover:text-accent-foreground')
  const modelChip = (active: boolean) =>
    cn('shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-sm font-semibold transition-colors cursor-pointer', active ? 'text-accent-foreground' : 'text-body hover:text-accent-foreground')

  return (
    <div ref={railRef} className="flex items-start gap-4 overflow-x-auto scrollbar-none snap-x py-1">
      {brands.map((b) => {
        const isActive = activeBrand === b.slug
        return (
          <Fragment key={b.slug}>
            <button data-brand={b.slug} onClick={() => { onPickBrand(isActive ? 'all' : b.slug); onPickModel('all') }} className={tileCls}>
              {/* Logo mirrors the category icon exactly — same 44px box, slate→blue
                  on hover/active, same scale animation — so the two rails feel as one.
                  (Brand marks read a touch bolder than the line icons by nature.) */}
              <span className="flex h-11 items-center justify-center">
                <BrandLogo
                  name={b.name}
                  iconPath={b.iconPath}
                  size={44}
                  flat
                  className={cn('transition-transform duration-200 group-hover:scale-110', isActive ? '!text-accent-foreground' : '!text-body group-hover:!text-accent-foreground')}
                />
              </span>
              <span className={nameCls(isActive)}>{b.name}</span>
            </button>

            {/* Models roll out to the right of the active brand */}
            {isActive && models.length > 0 && (
              <div className="flex shrink-0 items-start gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
                <span className="mt-1 h-12 w-px shrink-0 bg-border" />
                {/* 3 fixed rows; models flow into columns to the right (robust on mobile). */}
                <div className="grid grid-rows-3 grid-flow-col auto-cols-max gap-x-3 gap-y-1">
                  <button onClick={() => onPickModel('all')} className={modelChip(activeModel === 'all')}>{tr('All', 'Tất cả')}</button>
                  {models.map((m) => {
                    const mActive = activeModel === m.model
                    return (
                      <button key={m.model} onClick={() => onPickModel(mActive ? 'all' : m.model)} className={modelChip(mActive)}>
                        {m.model}
                        <span className="ml-1 text-[10px] font-semibold text-ink-4">{m.count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
