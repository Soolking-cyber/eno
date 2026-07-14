'use client'

import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { CustomSelect } from './custom-select'
import { PriceRangeFilter } from './price-range-filter'
import { RangeFacetControl } from './range-facet-control'
import { AreaFilter, type Nearby, type Geo } from './area-filter'
import { IconButton } from '@/components/ui/icon-button'
import { useLanguage } from '@/context/language-context'
import { facetsFor, subcategoriesFor, typesFor, LISTING_TYPES, type ListingType, type FacetDef } from '@/lib/taxonomy'
import { cn } from '@/lib/utils'

type FacetBarProps = {
  activeCategory: string
  activeSubcategory: string // drives subcategory-specific facets (e.g. cc vs L engine)
  setActiveSubcategory: Dispatch<SetStateAction<string>> // picker in the panel unlocks the deeper facets
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
  trailing?: ReactNode // extra control at the end of the chip row (e.g. the mobile sort chip)
}

// Compact, category-aware facet bar (faceted-search pattern) — all facets come
// from the canonical taxonomy (src/lib/taxonomy.ts). Only the facets relevant to
// the active category show.
export function FacetBar({
  activeCategory,
  activeSubcategory,
  setActiveSubcategory,
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
  trailing,
}: FacetBarProps) {
  const { lang, tr } = useLanguage()
  const [areaOpen, setAreaOpen] = useState(false)
  const [advOpen, setAdvOpen] = useState(false) // advanced per-category filter panel
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  // The advanced-filter panel is PORTALED to <body> (like the price/area popovers) so
  // it can't be painted under later page content (the footer). Positioned under the
  // Filter button via its rect.
  const advBtnRef = useRef<HTMLButtonElement>(null)
  const [mounted, setMounted] = useState(false)
  const [advPos, setAdvPos] = useState({ top: 0, left: 0, width: 0 })
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (!advOpen) { setAdvPos({ top: 0, left: 0, width: 0 }); return } // reset so it never paints at (0,0)
    const place = () => {
      const r = advBtnRef.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.min(416, window.innerWidth - 24) // 26rem, clamped to viewport
      const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12))
      setAdvPos({ top: r.bottom + 6, left, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [advOpen])
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
    .map((t) => ({ value: t.value, label: tr(t.label, t.labelVi) }))

  const facets: ReactNode[] = []

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

  // Area / location — to the RIGHT of price (it was awkwardly leading the bar).
  facets.push(
    <button
      key="area"
      ref={areaBtnRef}
      type="button"
      onClick={() => setAreaOpen((o) => !o)}
      className={cn(
        'flex shrink-0 items-center justify-between gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-[background-color,color,transform] duration-100 active:scale-95 cursor-pointer',
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
  )

  // All category facets live in the advanced "Filter" panel — a real per-category
  // form (condition + the per-category fields). The quick bar keeps area/type/price.
  const advFacets = facetsFor(activeCategory, activeSubcategory === 'all' ? null : activeSubcategory)
  // Subcategory picker inside the panel: many facets (transmission, engine cc, bike
  // type, fuel, origin…) are gated behind a chosen subcategory, so a brand/keyword
  // search with no subcategory would otherwise only surface the generic year/mileage/
  // color. Letting the user pick the subcategory here unlocks the full, detailed set.
  const subcats = subcategoriesFor(activeCategory)
  const hasAdvanced = advFacets.length > 0 || subcats.length > 0
  const activeAdvCount =
    (conditionFilter !== 'all' ? 1 : 0) +
    (activeSubcategory !== 'all' ? 1 : 0) +
    advFacets.filter((f) => f.key !== 'condition' && customFilters[f.key]).length

  const hasActive =
    !!province || !!ward || !!nearby || conditionFilter !== 'all' || priceRange !== 'all' ||
    listingType !== 'all' || Object.keys(customFilters).length > 0 || !verifiedOnly

  // A segmented toggle button (selected = filled blue; same height either way).
  const segBtn = (selected: boolean) =>
    cn('rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors cursor-pointer',
      selected ? 'border-brand bg-primary text-white' : 'border-line-strong text-body hover:bg-muted')
  // condition maps to the dedicated column; everything else to attr_* customFilters.
  const facetValue = (f: FacetDef) => (f.key === 'condition' ? conditionFilter : customFilters[f.key] || 'all')
  const setFacetValue = (f: FacetDef, v: string) => { if (f.key === 'condition') setConditionFilter(v); else setFacet(f.key, v) }

  return (
    <div className="relative">
      {/* Mobile: one horizontally-swipable line (bleeds to screen edges); desktop: wraps. */}
      <div className="flex items-center gap-2 flex-nowrap overflow-x-auto scrollbar-none -mx-3 px-3 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-x-visible">
        {/* Advanced per-category filter form — leftmost. Only when the category has facets. */}
        {hasAdvanced && (
          <button
            ref={advBtnRef}
            type="button"
            onClick={() => setAdvOpen((o) => !o)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-[background-color,color,transform] duration-100 active:scale-95 cursor-pointer',
              advOpen || activeAdvCount > 0 ? active : 'text-body hover:bg-muted',
            )}
          >
            <SlidersHorizontal className={cn('h-3.5 w-3.5', activeAdvCount > 0 ? 'text-accent-foreground' : 'text-ink-4')} />
            <span>{tr('Filter', 'Bộ lọc')}</span>
            {activeAdvCount > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-3xs font-bold text-white">{activeAdvCount}</span>
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
              setActiveSubcategory('all')
              setCustomFilters({})
              setVerifiedOnly(true)
            }}
            className="shrink-0 px-1 text-xs font-semibold text-accent-foreground hover:underline cursor-pointer"
          >
            {tr('Clear', 'Xóa lọc')}
          </button>
        )}
        {trailing}

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

      {/* Advanced per-category filter form — segmented toggles + selects. PORTALED to
          <body> + fixed-positioned so it floats above all page content (incl. the
          footer), closing on outside click. */}
      {mounted && advOpen && hasAdvanced && advPos.top > 0 && createPortal(
        <>
          <div className="fixed inset-0 z-[1099]" aria-hidden onClick={() => setAdvOpen(false)} />
          <div
            style={{ position: 'fixed', top: advPos.top, left: advPos.left, width: advPos.width || undefined }}
            className="z-[1100] max-h-[70vh] overflow-y-auto scroll-thin rounded-2xl bg-popover p-4 shadow-pop animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">{tr('Filters', 'Bộ lọc')}</span>
              <IconButton size="xs" onClick={() => setAdvOpen(false)} aria-label={tr('Close', 'Đóng')} className="h-6 w-6 text-ink-4 hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="space-y-3.5">
              {/* Subcategory picker — unlocks the subcategory-specific facets below
                  (e.g. Motorbike → bike type / engine cc / origin). */}
              {subcats.length > 0 && (
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
                  <label className="text-2xs font-bold uppercase tracking-wider text-muted-foreground sm:w-24 sm:shrink-0 sm:pt-1.5">{tr('Type', 'Phân loại')}</label>
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    <button type="button" onClick={() => setActiveSubcategory('all')} className={segBtn(activeSubcategory === 'all')}>{tr('All', 'Tất cả')}</button>
                    {subcats.map((s) => (
                      <button key={s.slug} type="button" onClick={() => setActiveSubcategory(activeSubcategory === s.slug ? 'all' : s.slug)} className={segBtn(activeSubcategory === s.slug)}>
                        {tr(s.name, s.nameVi)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {advFacets.map((f) => {
                const value = facetValue(f)
                const opts = f.options.map((o) => ({ value: o.value, label: tr(o.label, o.labelVi) }))
                return (
                  <div key={f.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                    <label className="text-2xs font-bold uppercase tracking-wider text-muted-foreground sm:w-24 sm:shrink-0">{tr(f.label, f.labelVi)}</label>
                    {f.kind === 'range' && f.range ? (
                      <RangeFacetControl range={f.range} value={value} onChange={(v) => setFacetValue(f, v)} />
                    ) : f.kind === 'toggle' ? (
                      <div className="flex flex-1 flex-wrap gap-1.5">
                        {opts.map((o) => (
                          <button key={o.value} type="button" onClick={() => setFacetValue(f, value === o.value ? 'all' : o.value)} className={segBtn(value === o.value)}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <CustomSelect
                          value={value}
                          onChange={(v) => setFacetValue(f, v)}
                          options={[{ value: 'all', label: tr('All', 'Tất cả') }, ...opts]}
                          placeholder={tr(f.label, f.labelVi)}
                          activeClassName="text-accent-foreground border-accent-foreground/35"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {activeAdvCount > 0 && (
              <button
                onClick={() => { setConditionFilter('all'); setCustomFilters({}) }}
                className="mt-3.5 text-xs font-semibold text-accent-foreground hover:underline cursor-pointer"
              >
                {tr('Clear all', 'Xóa tất cả')}
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
