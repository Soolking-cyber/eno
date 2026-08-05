'use client'

import { useId, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { MapPin, ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { CustomSelect } from './custom-select'
import { PriceRangeFilter } from './price-range-filter'
import { RangeFacetControl } from './range-facet-control'
import { AreaFilter, type Nearby, type Geo } from './area-filter'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  // Per-facet label ids so each toggle group can be NAMED — those <label>s dangle
  // otherwise, naming nothing.
  const uid = useId()
  // Load-bearing ref: <AreaFilter anchorRef> reads this node's rect to place its popover.
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
        label={tr('Listing type', 'Loại tin')}
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
    <Button
      key="area"
      variant="bare"
      size="none"
      // Load-bearing ref: <AreaFilter anchorRef> reads this node's rect to place the
      // popover. Base UI's Button forwards its ref onto the real <button>, so the
      // anchor survives the primitive — do not swap this for a render-prop child.
      ref={areaBtnRef}
      type="button"
      // This pill OPENS A POPOVER and never said so. Base UI's PopoverTrigger supplies
      // aria-expanded/haspopup/controls for free, but both popovers here are hand-portaled and
      // rect-positioned from a load-bearing ref (see the comment above), and <AreaFilter> lives in
      // another file — routing them through a real PopoverTrigger is a rewrite of two components,
      // and this bar is coupled to the page gutter (-mx-3 px-3). So the aria goes on by hand.
      // aria-controls is deliberately ABSENT: AreaFilter's panel carries no id of its own, and a
      // dangling aria-controls is worse than none. aria-expanded + aria-haspopup are the two that
      // actually carry the disclosure.
      aria-haspopup="dialog"
      aria-expanded={areaOpen}
      onClick={() => setAreaOpen((o) => !o)}
      className={cn(
        // h-12 (48px) — kid-friendly tap target; flat, borderless (bg-muted only on hover).
        'flex min-h-12 shrink-0 items-center justify-between gap-1.5 rounded-xl px-4 text-sm font-semibold transition-[background-color,color,transform] duration-100 active:scale-[0.96] cursor-pointer',
        wrap,
        areaOpen ? 'text-foreground' : areaActive ? active : 'text-body hover:bg-muted',
      )}
    >
      <span className="flex items-center gap-1.5 truncate">
        <MapPin className={cn('h-3.5 w-3.5', areaActive ? 'text-accent-foreground' : 'text-ink-4')} />
        <span className="truncate">{areaLabel}</span>
      </span>
      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform', areaOpen && 'rotate-180')} />
    </Button>,
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
  // Fed to <Button variant="bare" size="none">: `bare` paints nothing, so both
  // branches below stay fully in charge of the border/background/label colour.
  // whitespace-normal restores the plain <button> wrapping these labels had (the
  // Button base is whitespace-nowrap).
  //
  // ⚠️ SELECTION IS PAINT ONLY — the caller MUST also pass aria-pressed={selected}. This helper
  // returns a className, so it cannot put the state in the accessibility tree itself; every call
  // site below does it. These are aria-PRESSED toggle buttons and not a radio group on purpose:
  // clicking the selected chip DESELECTS it (back to 'all'), which a radio cannot express.
  const segBtn = (selected: boolean) =>
    cn('rounded-lg border px-3 py-1.5 text-sm font-semibold whitespace-normal transition-colors cursor-pointer',
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
          // Advanced per-category filter panel. Base UI Popover now supplies the whole
          // disclosure contract that used to be hand-rolled: aria-expanded/haspopup/controls on
          // the trigger, Escape, focus move-and-return on open/close, and anchoring + portaling.
          <Popover open={advOpen} onOpenChange={setAdvOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="bare"
                  size="none"
                  type="button"
                  className={cn(
                    // h-12 (48px) to match the Area pill — flat, borderless.
                    'flex min-h-12 shrink-0 items-center justify-start gap-1.5 rounded-xl px-4 text-sm font-semibold transition-[background-color,color,transform] duration-100 active:scale-[0.96] cursor-pointer',
                    advOpen || activeAdvCount > 0 ? active : 'text-body hover:bg-muted',
                  )}
                >
                  <SlidersHorizontal className={cn('h-3.5 w-3.5', activeAdvCount > 0 ? 'text-accent-foreground' : 'text-ink-4')} />
                  <span>{tr('Filter', 'Bộ lọc')}</span>
                  {activeAdvCount > 0 && (
                    <Badge variant="counter-brand" size="count" className="ml-0.5">{activeAdvCount}</Badge>
                  )}
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-ink-4 transition-transform', advOpen && 'rotate-180')} />
                </Button>
              }
            />
            {/* Base UI portals this itself, so sitting inside the swipable facet row is fine.
                `backdrop` absorbs the outside dismiss-tap so it can't fall through to a listing
                card. `block` overrides the primitive's base flex-col so the panel's own spacing
                (mb-3 header, space-y-3.5 body) is preserved. */}
            <PopoverContent
              align="start"
              side="bottom"
              sideOffset={6}
              backdrop
              aria-label={tr('Filters', 'Bộ lọc')}
              className="block w-[416px] max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto scroll-thin p-4 shadow-pop ring-0"
            >
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
                    {/* A <label> with no htmlFor and no control inside names NOTHING. It stays a
                        <label> visually, but the chips it heads are now a real role="group" that
                        points back at it — so the group is announced as "Type", not as a bare run of
                        buttons. */}
                    <label id={`${uid}-subcat-label`} className="text-2xs font-bold uppercase tracking-wider text-muted-foreground sm:w-24 sm:shrink-0 sm:pt-1.5">{tr('Type', 'Phân loại')}</label>
                    <div role="group" aria-labelledby={`${uid}-subcat-label`} className="flex flex-1 flex-wrap gap-1.5">
                      <Button variant="bare" size="none" type="button" aria-pressed={activeSubcategory === 'all'} onClick={() => setActiveSubcategory('all')} className={segBtn(activeSubcategory === 'all')}>{tr('All', 'Tất cả')}</Button>
                      {subcats.map((s) => (
                        <Button key={s.slug} variant="bare" size="none" type="button" aria-pressed={activeSubcategory === s.slug} onClick={() => setActiveSubcategory(activeSubcategory === s.slug ? 'all' : s.slug)} className={segBtn(activeSubcategory === s.slug)}>
                          {tr(s.name, s.nameVi)}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {advFacets.map((f) => {
                  const value = facetValue(f)
                  const opts = f.options.map((o) => ({ value: o.value, label: tr(o.label, o.labelVi) }))
                  return (
                    <div key={f.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                      <label id={`${uid}-${f.key}-label`} className="text-2xs font-bold uppercase tracking-wider text-muted-foreground sm:w-24 sm:shrink-0">{tr(f.label, f.labelVi)}</label>
                      {f.kind === 'range' && f.range ? (
                        <RangeFacetControl range={f.range} value={value} onChange={(v) => setFacetValue(f, v)} />
                      ) : f.kind === 'toggle' ? (
                        <div role="group" aria-labelledby={`${uid}-${f.key}-label`} className="flex flex-1 flex-wrap gap-1.5">
                          {opts.map((o) => (
                            <Button key={o.value} variant="bare" size="none" type="button" aria-pressed={value === o.value} onClick={() => setFacetValue(f, value === o.value ? 'all' : o.value)} className={segBtn(value === o.value)}>
                              {o.label}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <CustomSelect
                            value={value}
                            onChange={(v) => setFacetValue(f, v)}
                            options={[{ value: 'all', label: tr('All', 'Tất cả') }, ...opts]}
                            label={tr(f.label, f.labelVi)}
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
                <Button
                  variant="bare"
                  size="none"
                  onClick={() => { setConditionFilter('all'); setActiveSubcategory('all'); setCustomFilters({}) }}
                  className="mt-3.5 text-xs font-semibold text-accent-foreground hover:underline cursor-pointer"
                >
                  {tr('Clear all', 'Xóa tất cả')}
                </Button>
              )}
            </PopoverContent>
          </Popover>
        )}
        {facets}
        {hasActive && (
          <Button
            variant="bare"
            size="none"
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
          </Button>
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
    </div>
  )
}
