'use client'

import { useState, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { MapPin, ShieldCheck, ChevronDown } from 'lucide-react'
import { CustomSelect } from './custom-select'
import { AreaFilter, type Nearby } from './area-filter'
import { DISTRICTS } from './listings-explorer.constants'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

type FacetBarProps = {
  activeCategory: string
  activeDistrict: string
  setActiveDistrict: Dispatch<SetStateAction<string>>
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
}

// Compact, category-aware facet bar (faceted-search pattern) — replaces the
// always-on sidebar. Only the facets relevant to the active category show.
export function FacetBar({
  activeCategory,
  activeDistrict,
  setActiveDistrict,
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
}: FacetBarProps) {
  const { lang, tr } = useLanguage()
  const [areaOpen, setAreaOpen] = useState(false)
  // The area pill is "active" when a district or a near-you search is set.
  const areaActive = activeDistrict !== 'all' || !!nearby
  const areaLabel = nearby
    ? tr(`Within ${nearby.radiusKm} km`, `Trong ${nearby.radiusKm} km`)
    : activeDistrict !== 'all'
    ? (DISTRICTS.find((d) => d.slug === activeDistrict) ? (lang === 'vi' ? DISTRICTS.find((d) => d.slug === activeDistrict)!.name : DISTRICTS.find((d) => d.slug === activeDistrict)!.nameEn) : tr('Area', 'Khu vực'))
    : tr('Area', 'Khu vực')

  const setFacet = (key: string, value: string) =>
    setCustomFilters((prev) => {
      const n = { ...prev }
      if (value === 'all') delete n[key]
      else n[key] = value
      return n
    })

  const cls = ''
  const active = 'bg-[#e8f1fb] text-[#0a66c2]'
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

  // Category-aware price brackets (VND; empty max = open-ended).
  const priceOpts: { value: string; label: string }[] =
    activeCategory === 'house-rentals'
      ? [
          { value: '0-10000000', label: tr('Under ₫10M', 'Dưới 10tr') },
          { value: '10000000-20000000', label: '10–20tr' },
          { value: '20000000-40000000', label: '20–40tr' },
          { value: '40000000-', label: tr('₫40M+', 'Trên 40tr') },
        ]
      : activeCategory === 'motorbike-rentals'
      ? [
          { value: '0-2000000', label: tr('Under ₫2M', 'Dưới 2tr') },
          { value: '2000000-4000000', label: '2–4tr' },
          { value: '4000000-', label: tr('₫4M+', 'Trên 4tr') },
        ]
      : activeCategory === 'services' || activeCategory === 'jobs'
      ? [
          { value: '0-500000', label: tr('Under ₫500k', 'Dưới 500k') },
          { value: '500000-2000000', label: '500k–2tr' },
          { value: '2000000-', label: tr('₫2M+', 'Trên 2tr') },
        ]
      : activeCategory === 'electronics' || activeCategory === 'moving-sale'
      ? [
          { value: '0-5000000', label: tr('Under ₫5M', 'Dưới 5tr') },
          { value: '5000000-15000000', label: '5–15tr' },
          { value: '15000000-30000000', label: '15–30tr' },
          { value: '30000000-', label: tr('₫30M+', 'Trên 30tr') },
        ]
      : [
          { value: '0-1000000', label: tr('Under ₫1M', 'Dưới 1tr') },
          { value: '1000000-10000000', label: '1–10tr' },
          { value: '10000000-30000000', label: '10–30tr' },
          { value: '30000000-', label: tr('₫30M+', 'Trên 30tr') },
        ]

  const facets: ReactNode[] = [
    <button
      key="area"
      type="button"
      onClick={() => setAreaOpen(true)}
      className={cn(
        'flex shrink-0 items-center justify-between gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer',
        wrap,
        areaActive ? active : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2]',
      )}
    >
      <span className="flex items-center gap-1.5 truncate">
        <MapPin className={cn('h-3.5 w-3.5', areaActive ? 'text-[#0a66c2]' : 'text-[#94a3b8]')} />
        <span className="truncate">{areaLabel}</span>
      </span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-600" />
    </button>,
    <CustomSelect
      key="price"
      value={priceRange}
      onChange={setPriceRange}
      options={[{ value: 'all', label: tr('Any price', 'Mọi giá') }, ...priceOpts]}
      placeholder={tr('Price', 'Giá')}
      className={cls}
      activeClassName={active}
      wrapperClassName={wrap}
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
    activeDistrict !== 'all' || !!nearby || conditionFilter !== 'all' || priceRange !== 'all' || Object.keys(customFilters).length > 0 || !verifiedOnly

  return (
    // Mobile: one horizontally-swipable line (bleeds to screen edges); desktop: wraps.
    <div className="flex items-center gap-2 flex-nowrap overflow-x-auto scrollbar-none -mx-4 px-4 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-x-visible">
      {facets}
      {/* Static trust indicator — every listing on ENO is verified (not a toggle). */}
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#e8f1fb] px-3.5 py-2 text-sm font-semibold text-[#0a66c2]">
        <ShieldCheck className="h-3.5 w-3.5" />
        {tr('Verified only', 'Chỉ tin đã xác minh')}
      </span>
      {hasActive && (
        <button
          onClick={() => {
            setActiveDistrict('all')
            setNearby(null)
            setConditionFilter('all')
            setPriceRange('all')
            setCustomFilters({})
            setVerifiedOnly(true)
          }}
          className="shrink-0 px-1 text-xs font-semibold text-[#0a66c2] hover:underline cursor-pointer"
        >
          {tr('Clear', 'Xóa lọc')}
        </button>
      )}

      <AreaFilter
        open={areaOpen}
        onClose={() => setAreaOpen(false)}
        district={activeDistrict}
        nearby={nearby}
        onApply={({ district, nearby: nb }) => { setActiveDistrict(district); setNearby(nb) }}
        onReset={() => { setActiveDistrict('all'); setNearby(null) }}
      />
    </div>
  )
}
