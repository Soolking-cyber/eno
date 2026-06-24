'use client'

import { useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { MapPin, ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { CustomSelect } from './custom-select'
import { PriceRangeFilter } from './price-range-filter'
import { AreaFilter, type Nearby, type Geo } from './area-filter'
import { useLanguage } from '@/context/language-context'
import { facetsFor, typesFor, LISTING_TYPES, type ListingType, type FacetDef } from '@/lib/taxonomy'
import { cn } from '@/lib/utils'

type FacetBarProps = {
  activeCategory: string
  province: Geo | null
  setProvince: Dispatch<SetStateAction<Geo | null>>
  ward: Geo | null
  setWard: Dispatch<SetStateAction<Geo | null>>
  nearby: Nearby | null
  setNearby: Dispatch<SetStateAction<Nearby | null>>
  priceRange: string
  setPriceRange: Dispatch<SetStateAction<string>>
  conditionFilter: string
  setConditionFilter: Dispatch<SetStateAction<string>>
  listingType: string
  setListingType: Dispatch<SetStateAction<string>>
  customFilters: Record<string, string>
  setCustomFilters: Dispatch<SetStateAction<Record<string, string>>>
  verifiedOnly: boolean
  setVerifiedOnly: Dispatch<SetStateAction<boolean>>
  histogramQuery: string // active filters (sans price/pagination) for the price histogram
}

// Compact, category-aware facet bar (faceted-search pattern) — all facets come
// from the canonical taxonomy (src/lib/taxonomy.ts). Only the facets relevant to
// the active category show.
export function FacetBar({
  activeCategory,
  province,
  setProvince,
  ward,
  setWard,
  nearby,
  setNearby,
  priceRange,
  setPriceRange,
  conditionFilter,
  setConditionFilter,
  listingType,
  setListingType,
  customFilters,
  setCustomFilters,
  verifiedOnly,
  setVerifiedOnly,
  histogramQuery,
}: FacetBarProps) {
  const { lang, tr } = useLanguage()
  const [areaOpen, setAreaOpen] = useState(false)
  const [advOpen, setAdvOpen] = useState(false) // advanced per-category filter panel
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  // The area pill is "active" when a ward/province or a near-you search is set.
  const areaActive = !!ward || !!province || !!nearby
  const areaLabel = ward
    ? (lang === 'vi' ? ward.name : ward.nameEn)
    : nearby
    ? tr(`Within ${nearby.radiusKm} km`, `Trong ${nearby.radiusKm} km`)
    : province
    ? (lang === 'vi' ? province.name : province.nameEn)
    : tr('Area', 'Khu vực')

  const setFacet = (key: string, value: string) =>
    setCustomFilters((prev) => {
      const n = { ...prev }
      if (value === 'all') delete n[key]
      else n[key] = value
      return n
    })

  const cls = ''
  const active = 'text-accent-foreground'
  // Content-sized pills (no fixed min-width) so they pack into one swipable
  // row on mobile; widen a touch on desktop where they wrap.
  const wrap = 'w-auto shrink-0 lg:min-w-[7.5rem]'

  // Intent (listingType) options — those valid for the active category, or the
  // full set on "all". Surfaced as the first facet so Rent/Buy/Free/etc. is one tap.
  const typeValues: ListingType[] = activeCategory === 'all'
    ? LISTING_TYPES.map((t) => t.value)
    : typesFor(activeCategory)
  const typeOptions = LISTING_TYPES
    .filter((t) => typeValues.includes(t.value))
    .map((t) => ({ value: t.value, label: lang === 'vi' ? t.labelVi : t.label }))

  const facets: ReactNode[] = [
    <button
      key="area"
      ref={areaBtnRef}
      type="button"
      onClick={() => setAreaOpen((o) => !o)}
      className={cn(
        'flex shrink-0 items-center justify-between gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer',
        wrap,
        areaOpen ? 'text-foreground' : areaActive ? active : 'text-body hover:bg-muted',
      )}
    >
      <span className="flex items-center gap-1.5 truncate">
        <MapPin className={cn('h-3.5 w-3.5', areaActive ? 'text-accent-foreground' : 'text-ink-4')} />
        <span className="truncate">{areaLabel}</span>
      </span>
      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform', areaOpen && 'rotate-180')} />
    </button>,
  ]

  // Intent filter (only meaningful when the category offers >1 intent, or on "all").
  if (typeOptions.length > 1) {
    facets.push(
      <CustomSelect
        key="listingType"
        value={listingType}
        onChange={setListingType}
        options={[{ value: 'all', label: tr('Any type', 'Mọi loại') }, ...typeOptions]}
        placeholder={tr('Type', 'Loại')}
        className={cls}
        activeClassName={active}
        wrapperClassName={wrap}
      />,
    )
  }

  facets.push(
    <PriceRangeFilter
      key="price"
      value={priceRange}
      onChange={setPriceRange}
      query={histogramQuery}
      className="text-body hover:bg-muted"
      activeClassName={active}
      wrapperClassName={wrap}
    />,
  )

  // Category-specific facets from the taxonomy. `condition` stays inline (a quick,
  // universal filter, on the dedicated `condition` column); the deeper per-category
  // attribute facets (transmission, storage, year, mileage, size…) move behind the
  // "Filter" button into an advanced panel so the bar stays uncluttered.
  const attrFacetDefs: FacetDef[] = []
  for (const f of facetsFor(activeCategory)) {
    if (f.key === 'condition') {
      const options = f.options.map((o) => ({ value: o.value, label: lang === 'vi' ? o.labelVi : o.label }))
      facets.push(
        <CustomSelect
          key="condition"
          value={conditionFilter}
          onChange={setConditionFilter}
          options={[{ value: 'all', label: lang === 'vi' ? f.labelVi : f.label }, ...options]}
          placeholder={lang === 'vi' ? f.labelVi : f.label}
          className={cls}
          activeClassName={active}
          wrapperClassName={wrap}
        />,
      )
    } else {
      attrFacetDefs.push(f)
    }
  }
  const activeAttrCount = attrFacetDefs.filter((f) => customFilters[f.key]).length

  const hasActive =
    !!province || !!ward || !!nearby || conditionFilter !== 'all' || priceRange !== 'all' ||
    listingType !== 'all' || Object.keys(customFilters).length > 0 || !verifiedOnly

  return (
    <div className="relative">
      {/* Mobile: one horizontally-swipable line (bleeds to screen edges); desktop: wraps. */}
      <div className="flex items-center gap-2 flex-nowrap overflow-x-auto scrollbar-none -mx-3 px-3 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-x-visible">
        {/* Advanced per-category filters — leftmost. Only when the category has them. */}
        {attrFacetDefs.length > 0 && (
          <button
            type="button"
            onClick={() => setAdvOpen((o) => !o)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer',
              advOpen || activeAttrCount > 0 ? active : 'text-body hover:bg-muted',
            )}
          >
            <SlidersHorizontal className={cn('h-3.5 w-3.5', activeAttrCount > 0 ? 'text-accent-foreground' : 'text-ink-4')} />
            <span>{tr('Filter', 'Bộ lọc')}</span>
            {activeAttrCount > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[10px] font-bold text-white">{activeAttrCount}</span>
            )}
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform', advOpen && 'rotate-180')} />
          </button>
        )}
        {facets}
        {hasActive && (
          <button
            onClick={() => {
              setProvince(null)
              setWard(null)
              setNearby(null)
              setConditionFilter('all')
              setPriceRange('all')
              setListingType('all')
              setCustomFilters({})
              setVerifiedOnly(true)
            }}
            className="shrink-0 px-1 text-xs font-semibold text-accent-foreground hover:underline cursor-pointer"
          >
            {tr('Clear', 'Xóa lọc')}
          </button>
        )}

        <AreaFilter
          open={areaOpen}
          anchorRef={areaBtnRef}
          onClose={() => setAreaOpen(false)}
          province={province}
          ward={ward}
          nearby={nearby}
          onApply={({ province: p, ward: w, nearby: nb }) => { setProvince(p); setWard(w); setNearby(nb) }}
          onReset={() => { setProvince(null); setWard(null); setNearby(null) }}
        />
      </div>

      {/* Advanced filter panel — a compact dropdown anchored under the Filter
          button; closes on outside click (like the other dropdowns). */}
      {advOpen && attrFacetDefs.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setAdvOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl bg-card p-4 shadow-pop animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">{tr('Filter details', 'Lọc chi tiết')}</span>
              <button onClick={() => setAdvOpen(false)} aria-label={tr('Close', 'Đóng')} className="rounded-full p-1 text-ink-4 hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              {attrFacetDefs.map((f) => (
                <div key={f.key} className="space-y-1">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{lang === 'vi' ? f.labelVi : f.label}</label>
                  <CustomSelect
                    value={customFilters[f.key] || 'all'}
                    onChange={(v) => setFacet(f.key, v)}
                    options={[{ value: 'all', label: tr('All', 'Tất cả') }, ...f.options.map((o) => ({ value: o.value, label: lang === 'vi' ? o.labelVi : o.label }))]}
                    placeholder={lang === 'vi' ? f.labelVi : f.label}
                    activeClassName="text-accent-foreground border-accent-foreground/35"
                  />
                </div>
              ))}
            </div>
            {activeAttrCount > 0 && (
              <button
                onClick={() => setCustomFilters({})}
                className="mt-3 text-xs font-semibold text-accent-foreground hover:underline cursor-pointer"
              >
                {tr('Clear details', 'Xóa lọc chi tiết')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
