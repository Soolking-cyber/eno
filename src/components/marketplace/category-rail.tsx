'use client'

import { Layers } from 'lucide-react'
import { useLanguage, Tr } from '@/context/language-context'
import { CategoryIcon } from './category-icons'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { cn } from '@/lib/utils'
import type { SerializedCategory } from '@/lib/types'

// Line 1 of the search header: a horizontally scrollable rail of square-logo
// category tiles. Tapping a category selects it and expands its subcategories
// (wrapping to multiple lines); tapping the active one again collapses back to All.
export function CategoryRail({
  categories,
  activeCategory,
  activeSubcategory,
  subcategoryCounts,
  onCategory,
  onSubcategory,
}: {
  categories: SerializedCategory[]
  activeCategory: string
  activeSubcategory: string
  subcategoryCounts: Record<string, number>
  onCategory: (slug: string) => void   // 'all' to clear
  onSubcategory: (slug: string) => void // 'all' to clear
}) {
  const { lang, tr } = useLanguage()

  const tile = (active: boolean) =>
    cn(
      'flex h-12 w-12 items-center justify-center rounded-2xl transition-colors',
      active ? 'bg-[#0a66c2] text-white' : 'bg-tint text-accent-foreground group-hover:bg-muted',
    )

  const subs = activeCategory !== 'all' ? SUBCATEGORIES[activeCategory] ?? [] : []

  return (
    <div className="select-none space-y-2">
      {/* Category tiles — square logo + name, scrollable */}
      <div className="flex items-start gap-3 overflow-x-auto scrollbar-none py-1">
        {/* All */}
        <button onClick={() => onCategory('all')} className="group flex w-14 shrink-0 flex-col items-center gap-1.5">
          <span className={tile(activeCategory === 'all')}><Layers className="h-5 w-5" /></span>
          <span className={cn('line-clamp-1 text-center text-[11px] font-semibold', activeCategory === 'all' ? 'text-accent-foreground' : 'text-body')}>
            {tr('All', 'Tất cả')}
          </span>
        </button>

        {categories.map((cat) => {
          const isActive = activeCategory === cat.slug
          return (
            <button
              key={cat.id}
              onClick={() => onCategory(isActive ? 'all' : cat.slug)}
              className="group flex w-14 shrink-0 flex-col items-center gap-1.5"
            >
              <span className={tile(isActive)}><CategoryIcon name={cat.icon} className="h-5 w-5" /></span>
              <span className={cn('line-clamp-2 text-center text-[11px] font-semibold leading-tight', isActive ? 'text-accent-foreground' : 'text-body')}>
                <Tr text={lang === 'vi' ? cat.nameVi : cat.name} />
              </span>
            </button>
          )
        })}
      </div>

      {/* Subcategories — revealed for the active category, wrapping to multiple lines */}
      {subs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
          <button
            onClick={() => onSubcategory('all')}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
              activeSubcategory === 'all' ? 'bg-[#0a66c2] text-white' : 'text-body hover:bg-muted',
            )}
          >
            {tr('All', 'Tất cả')}
          </button>
          {subs.map((sub) => {
            const isActive = activeSubcategory === sub.slug
            const count = subcategoryCounts[sub.slug]
            return (
              <button
                key={sub.slug}
                onClick={() => onSubcategory(isActive ? 'all' : sub.slug)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap',
                  isActive ? 'bg-[#0a66c2] text-white' : 'text-body hover:bg-muted',
                )}
              >
                <span><Tr text={lang === 'vi' ? sub.nameVi : sub.name} /></span>
                {count != null && (
                  <span className={cn('text-[10px] font-semibold', isActive ? 'text-white/70' : 'text-ink-4')}>{count}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
