'use client'

import { useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { MapPin, ChevronDown } from 'lucide-react'
import { CustomSelect } from './custom-select'
import { PriceRangeFilter } from './price-range-filter'
import { AreaFilter, type Nearby, type Geo } from './area-filter'
import { useLanguage } from '@/context/language-context'
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
  customFilters: Record<string, string>
  setCustomFilters: Dispatch<SetStateAction<Record<string, string>>>
  verifiedOnly: boolean
  setVerifiedOnly: Dispatch<SetStateAction<boolean>>
  histogramQuery: string // active filters (sans price/pagination) for the price histogram
}

// Compact, category-aware facet bar (faceted-search pattern) — replaces the
// always-on sidebar. Only the facets relevant to the active category show.
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
  customFilters,
  setCustomFilters,
  verifiedOnly,
  setVerifiedOnly,
  histogramQuery,
}: FacetBarProps) {
  const { lang, tr } = useLanguage()
  const [areaOpen, setAreaOpen] = useState(false)
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
  const active = 'bg-accent text-accent-foreground'
  // Content-sized pills (no fixed min-width) so they pack into one swipable
  // row on mobile; widen a touch on desktop where they wrap.
  const wrap = 'w-auto shrink-0 lg:min-w-[7.5rem]'

  const Facet = (key: string, placeholder: string, options: { value: string; label: string }[]) => (
    <CustomSelect
      key={key}
      value={customFilters[key] || 'all'}
      onChange={(v) => setFacet(key, v)}
      options={[{ value: 'all', label: tr('All', 'Tất cả') }, ...options]}
      placeholder={placeholder}
      className={cls}
      activeClassName={active}
      wrapperClassName={wrap}
    />
  )

  const facets: ReactNode[] = [
    <button
      key="area"
      ref={areaBtnRef}
      type="button"
      onClick={() => setAreaOpen((o) => !o)}
      className={cn(
        'flex shrink-0 items-center justify-between gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer',
        wrap,
        areaOpen ? 'rounded-t-2xl rounded-b-none bg-card text-foreground shadow-pop' : areaActive ? active : 'text-body hover:bg-muted',
      )}
    >
      <span className="flex items-center gap-1.5 truncate">
        <MapPin className={cn('h-3.5 w-3.5', areaActive ? 'text-accent-foreground' : 'text-ink-4')} />
        <span className="truncate">{areaLabel}</span>
      </span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-4" />
    </button>,
    <PriceRangeFilter
      key="price"
      value={priceRange}
      onChange={setPriceRange}
      query={histogramQuery}
      className={cn('text-body hover:bg-muted', wrap)}
      activeClassName={cn(active, wrap)}
      wrapperClassName="shrink-0"
    />,
  ]

  if (activeCategory === 'motorbike-rentals') {
    facets.push(Facet('transmission', tr('Transmission', 'Hộp số'), [
      { value: 'automatic', label: tr('Automatic', 'Xe ga') },
      { value: 'manual', label: tr('Manual', 'Xe số') },
    ]))
    facets.push(Facet('cc', tr('Engine', 'Phân khối'), [
      { value: '110-125', label: '110–125cc' },
      { value: '150-up', label: '150cc+' },
    ]))
  } else if (activeCategory === 'house-rentals') {
    facets.push(Facet('bedrooms', tr('Bedrooms', 'Phòng ngủ'), [
      { value: '0', label: 'Studio' },
      { value: '1', label: '1 BR' },
      { value: '2', label: '2 BR' },
      { value: '3', label: '3+ BR' },
    ]))
    facets.push(Facet('furnishing', tr('Furnishing', 'Nội thất'), [
      { value: 'fully', label: tr('Furnished', 'Đầy đủ') },
      { value: 'partly', label: tr('Unfurnished', 'Cơ bản') },
    ]))
  } else if (activeCategory === 'moving-sale') {
    facets.push(Facet('material', tr('Material', 'Chất liệu'), [
      { value: 'wood', label: tr('Wood', 'Gỗ') },
      { value: 'fabric', label: tr('Fabric', 'Vải') },
    ]))
  } else if (activeCategory === 'electronics') {
    facets.push(Facet('brand', tr('Brand', 'Hãng'), [
      { value: 'apple', label: 'Apple' },
      { value: 'sony', label: 'Sony' },
    ]))
    facets.push(Facet('warranty', tr('Warranty', 'Bảo hành'), [
      { value: 'yes', label: tr('In warranty', 'Còn BH') },
    ]))
  } else if (activeCategory === 'jobs') {
    facets.push(Facet('english', tr('English', 'Tiếng Anh'), [
      { value: 'required', label: tr('Required', 'Yêu cầu') },
    ]))
  }

  // Condition is only meaningful for physical goods.
  if (activeCategory === 'electronics' || activeCategory === 'moving-sale') {
    facets.push(
      <CustomSelect
        key="condition"
        value={conditionFilter}
        onChange={setConditionFilter}
        options={[
          { value: 'all', label: tr('Condition', 'Tình trạng') },
          { value: 'new', label: tr('New', 'Mới') },
          { value: 'used', label: tr('Used', 'Đã dùng') },
        ]}
        placeholder={tr('Condition', 'Tình trạng')}
        className={cls}
        activeClassName={active}
        wrapperClassName={wrap}
      />,
    )
  }

  const hasActive =
    !!province || !!ward || !!nearby || conditionFilter !== 'all' || priceRange !== 'all' || Object.keys(customFilters).length > 0 || !verifiedOnly

  return (
    // Mobile: one horizontally-swipable line (bleeds to screen edges); desktop: wraps.
    <div className="flex items-center gap-2 flex-nowrap overflow-x-auto scrollbar-none -mx-3 px-3 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-x-visible">
      {facets}
      {hasActive && (
        <button
          onClick={() => {
            setProvince(null)
            setWard(null)
            setNearby(null)
            setConditionFilter('all')
            setPriceRange('all')
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
  )
}
