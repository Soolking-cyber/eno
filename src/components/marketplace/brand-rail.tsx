'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { BrandLogo } from './brand-logo'

type BrandItem = { slug: string; name: string; count: number; iconPath: string | null }

// Horizontal, scrollable brand rail for the search page. Shows the brands that
// have live listings in the current category (logo + name). Tapping a brand
// filters by it AND expands its models present in the catalogue (Carousell /
// Chợ Tốt pattern); tapping a model narrows further. Controlled by the explorer.
export function BrandRail({
  category,
  activeBrand,
  activeModel,
  onPickBrand,
  onPickModel,
}: {
  category: string
  activeBrand: string // canonical slug or 'all'
  activeModel: string // model display string or 'all'
  onPickBrand: (slug: string) => void   // 'all' to clear
  onPickModel: (model: string) => void  // 'all' to clear
}) {
  const { tr } = useLanguage()
  const [brands, setBrands] = useState<BrandItem[]>([])
  const [models, setModels] = useState<{ model: string; count: number }[]>([])

  // Brands for the active category.
  useEffect(() => {
    let off = false
    fetch(`/api/brands?category=${encodeURIComponent(category)}&limit=40`)
      .then((r) => r.json())
      .then((d) => { if (!off) setBrands(d.brands || []) })
      .catch(() => { if (!off) setBrands([]) })
    return () => { off = true }
  }, [category])

  // Models for the selected brand (lazy — only when a brand is active).
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

  return (
    <div className="space-y-2 pt-0.5">
      {/* Brand chips */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
        {brands.map((b) => {
          const isActive = activeBrand === b.slug
          return (
            <button
              key={b.slug}
              onClick={() => { onPickBrand(isActive ? 'all' : b.slug); onPickModel('all') }}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap',
                isActive ? 'bg-[#0a66c2] text-white' : 'text-body hover:bg-muted',
              )}
            >
              <BrandLogo name={b.name} iconPath={b.iconPath} size={18} className={isActive ? 'text-white' : ''} />
              <span>{b.name}</span>
              <span className={cn('text-[10px] font-semibold', isActive ? 'text-white/70' : 'text-ink-4')}>{b.count}</span>
            </button>
          )
        })}
      </div>

      {/* Model sub-row — revealed once a brand is selected (its models in catalogue) */}
      {activeBrand !== 'all' && models.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
          <button
            onClick={() => onPickModel('all')}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
              activeModel === 'all' ? 'bg-tint text-accent-foreground' : 'text-body hover:bg-muted',
            )}
          >
            {tr('All models', 'Tất cả mẫu')}
          </button>
          {models.map((m) => {
            const isActive = activeModel === m.model
            return (
              <button
                key={m.model}
                onClick={() => onPickModel(isActive ? 'all' : m.model)}
                className={cn(
                  'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap',
                  isActive ? 'bg-[#0a66c2] text-white' : 'text-body hover:bg-muted',
                )}
              >
                {m.model}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
