'use client'

import type { Dispatch, SetStateAction } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { CustomSelect } from './custom-select'
import { CategoryIcon } from './category-icons'
import { DISTRICTS } from './listings-explorer.constants'
import { cn } from '@/lib/utils'
import { useLanguage, Tr } from '@/context/language-context'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { SUBCATEGORIES } from '@/lib/subcategories'
import type { SerializedCategory } from '@/lib/types'

type Props = {
  isMobile?: boolean
  categories: SerializedCategory[]
  activeCategory: string
  handleCategorySelect: (slug: string) => void
  activeSubcategory: string
  setActiveSubcategory: Dispatch<SetStateAction<string>>
  verifiedOnly: boolean
  setVerifiedOnly: Dispatch<SetStateAction<boolean>>
  activeDistrict: string
  setActiveDistrict: Dispatch<SetStateAction<string>>
  conditionFilter: string
  setConditionFilter: Dispatch<SetStateAction<string>>
  customFilters: Record<string, string>
  setCustomFilters: Dispatch<SetStateAction<Record<string, string>>>
}

// Filters panel (mobile drawer content) — extracted verbatim from the explorer's
// renderFiltersContent + renderCategorySpecificFilters. All state stays in the
// explorer and threads through as props; i18n comes from useLanguage here.
export function ExplorerFilters({
  isMobile = false,
  categories,
  activeCategory,
  handleCategorySelect,
  activeSubcategory,
  setActiveSubcategory,
  verifiedOnly,
  setVerifiedOnly,
  activeDistrict,
  setActiveDistrict,
  conditionFilter,
  setConditionFilter,
  customFilters,
  setCustomFilters,
}: Props) {
  const { lang, t, tr } = useLanguage()

  const renderCategorySpecificFilters = () => {
    if (activeCategory === 'all') return null

    const handleSelectChange = (key: string, value: string) => {
      setCustomFilters((prev) => {
        const next = { ...prev }
        if (value === 'all') {
          delete next[key]
        } else {
          next[key] = value
        }
        return next
      })
    }

    if (activeCategory === 'motorbike-rentals') {
      return (
        <>
          {/* Transmission */}
          <div className="space-y-1.5 pt-2 border-t border-border/80">
            <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
              {tr('Transmission', 'Hộp số')}
            </label>
            <CustomSelect
              value={customFilters.transmission || 'all'}
              onChange={(val) => handleSelectChange('transmission', val)}
              options={[
                { value: 'all', label: tr('All Transmissions', 'Tất cả loại xe') },
                { value: 'automatic', label: tr('Automatic', 'Xe ga (Automatic)') },
                { value: 'manual', label: tr('Manual / Semi-Auto', 'Xe số / Côn tay') },
              ]}
              placeholder={tr('Transmission', 'Hộp số')}
              activeClassName="text-accent-foreground border-accent-foreground/35"
            />
          </div>

          {/* Engine Capacity */}
          <div className="space-y-1.5 pt-1">
            <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
              {tr('Engine Size', 'Phân khối')}
            </label>
            <CustomSelect
              value={customFilters.cc || 'all'}
              onChange={(val) => handleSelectChange('cc', val)}
              options={[
                { value: 'all', label: tr('All Capacities', 'Tất cả phân khối') },
                { value: '110-125', label: '110cc - 125cc' },
                { value: '150-up', label: '150cc+' },
              ]}
              placeholder={tr('Engine Size', 'Phân khối')}
              activeClassName="text-accent-foreground border-accent-foreground/35"
            />
          </div>
        </>
      )
    }

    if (activeCategory === 'house-rentals') {
      return (
        <>
          {/* Bedrooms */}
          <div className="space-y-1.5 pt-2 border-t border-border/80">
            <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
              {tr('Bedrooms', 'Số phòng ngủ')}
            </label>
            <CustomSelect
              value={customFilters.bedrooms || 'all'}
              onChange={(val) => handleSelectChange('bedrooms', val)}
              options={[
                { value: 'all', label: tr('All Bedrooms', 'Tất cả phòng') },
                { value: '0', label: tr('Studio Room', 'Phòng Studio') },
                { value: '1', label: tr('1 Bedroom', '1 Phòng ngủ') },
                { value: '2', label: tr('2 Bedrooms', '2 Phòng ngủ') },
                { value: '3', label: tr('3+ Bedrooms', '3+ Phòng ngủ') },
              ]}
              placeholder={tr('Bedrooms', 'Số phòng ngủ')}
              activeClassName="text-accent-foreground border-accent-foreground/35"
            />
          </div>

          {/* Furnishing */}
          <div className="space-y-1.5 pt-1">
            <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
              {tr('Furnishing', 'Nội thất')}
            </label>
            <CustomSelect
              value={customFilters.furnishing || 'all'}
              onChange={(val) => handleSelectChange('furnishing', val)}
              options={[
                { value: 'all', label: tr('All Furnishings', 'Tất cả trạng thái') },
                { value: 'fully', label: tr('Fully Furnished', 'Đầy đủ nội thất') },
                { value: 'partly', label: tr('Partially / Unfurnished', 'Đồ cơ bản / Trống') },
              ]}
              placeholder={tr('Furnishing', 'Nội thất')}
              activeClassName="text-accent-foreground border-accent-foreground/35"
            />
          </div>
        </>
      )
    }

    if (activeCategory === 'moving-sale') {
      return (
        <>
          {/* Material */}
          <div className="space-y-1.5 pt-2 border-t border-border/80">
            <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
              {tr('Material', 'Chất liệu')}
            </label>
            <CustomSelect
              value={customFilters.material || 'all'}
              onChange={(val) => handleSelectChange('material', val)}
              options={[
                { value: 'all', label: tr('All Materials', 'Tất cả chất liệu') },
                { value: 'wood', label: tr('Wood (Oak/Teak)', 'Gỗ tự nhiên (Oak/Teak)') },
                { value: 'fabric', label: tr('Fabric / Cushion', 'Vải bọc / Nệm') },
              ]}
              placeholder={tr('Material', 'Chất liệu')}
              activeClassName="text-accent-foreground border-accent-foreground/35"
            />
          </div>
        </>
      )
    }

    if (activeCategory === 'electronics') {
      return (
        <>
          {/* Brand */}
          <div className="space-y-1.5 pt-2 border-t border-border/80">
            <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
              {tr('Brand', 'Thương hiệu')}
            </label>
            <CustomSelect
              value={customFilters.brand || 'all'}
              onChange={(val) => handleSelectChange('brand', val)}
              options={[
                { value: 'all', label: tr('All Brands', 'Tất cả thương hiệu') },
                { value: 'apple', label: 'Apple (iPhone/Mac/iPad)' },
                { value: 'sony', label: 'Sony (Audio/Camera)' },
              ]}
              placeholder={tr('Brand', 'Thương hiệu')}
              activeClassName="text-accent-foreground border-accent-foreground/35"
            />
          </div>

          {/* Warranty */}
          <div className="space-y-1.5 pt-1">
            <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
              {tr('Warranty', 'Bảo hành')}
            </label>
            <CustomSelect
              value={customFilters.warranty || 'all'}
              onChange={(val) => handleSelectChange('warranty', val)}
              options={[
                { value: 'all', label: tr('All Warranty', 'Tất cả bảo hành') },
                { value: 'yes', label: tr('Under Active Warranty', 'Còn bảo hành hãng') },
              ]}
              placeholder={tr('Warranty', 'Bảo hành')}
              activeClassName="text-accent-foreground border-accent-foreground/35"
            />
          </div>
        </>
      )
    }

    if (activeCategory === 'jobs') {
      return (
        <>
          {/* English level */}
          <div className="space-y-1.5 pt-2 border-t border-border/80">
            <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
              {tr('English Requirement', 'Tiếng Anh')}
            </label>
            <CustomSelect
              value={customFilters.english || 'all'}
              onChange={(val) => handleSelectChange('english', val)}
              options={[
                { value: 'all', label: tr('Any Level', 'Bất kỳ mức độ nào') },
                { value: 'required', label: tr('English Required', 'Yêu cầu tiếng Anh') },
              ]}
              placeholder={tr('English Requirement', 'Tiếng Anh')}
              activeClassName="text-accent-foreground border-accent-foreground/35"
            />
          </div>
        </>
      )
    }

    return null
  }

  return (
    <div className="space-y-4">
      {/* Categories Selection for Mobile Drawer */}
      {isMobile && (
        <div className="space-y-1.5">
          <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
            {tr('Category', 'Danh mục')}
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="bare"
              size="none"
              onClick={() => handleCategorySelect('all')}
              className={cn(
                'flex items-center gap-2 rounded-xl p-2 text-xs font-bold transition-colors cursor-pointer justify-center',
                activeCategory === 'all'
                  ? 'text-accent-foreground'
                  : 'text-body hover:bg-muted'
              )}
            >
              <span className="text-2xs">{tr('All', 'Tất cả')}</span>
            </Button>
            {categories.map((cat) => {
              const isActive = activeCategory === cat.slug
              return (
                <Button
                   key={cat.id}
                   variant="bare"
                   size="none"
                   onClick={() => handleCategorySelect(cat.slug)}
                   className={cn(
                     'flex items-center gap-2 rounded-xl p-2 text-xs font-bold transition-colors cursor-pointer justify-center min-w-0',
                     isActive
                       ? 'text-accent-foreground'
                       : 'text-body hover:bg-muted'
                   )}
                >
                  <CategoryIcon name={cat.icon} className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-accent-foreground' : 'text-body')} />
                  <span className="text-3xs truncate"><Tr text={lang === 'vi' ? cat.nameVi : cat.name} /></span>
                </Button>
              )
            })}
          </div>
        </div>
      )}

      {/* Subcategories Selection for Mobile Drawer */}
      {isMobile && activeCategory !== 'all' && SUBCATEGORIES[activeCategory] && (
        <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-75">
          <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
            {tr('Subcategory', 'Danh mục con')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="bare"
              size="none"
              onClick={() => setActiveSubcategory('all')}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer',
                activeSubcategory === 'all'
                  ? 'text-accent-foreground'
                  : 'text-body hover:bg-muted'
              )}
            >
              {tr('All', 'Tất cả')}
            </Button>
            {SUBCATEGORIES[activeCategory].map((sub) => {
              const isSubActive = activeSubcategory === sub.slug
              return (
                <Button
                  key={sub.slug}
                  variant="bare"
                  size="none"
                  onClick={() => setActiveSubcategory(sub.slug)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer',
                    isSubActive
                      ? 'text-accent-foreground'
                      : 'text-body hover:bg-muted'
                  )}
                >
                  <CategoryIcon name={sub.icon} className="h-3.5 w-3.5 shrink-0" />
                  <Tr text={lang === 'vi' ? sub.nameVi : sub.name} />
                </Button>
              )
            })}
          </div>
        </div>
      )}
      {/* Verified Filter Switch */}
      <div className="flex items-center justify-between py-2.5 bg-card/50 border border-border/60 rounded-xl px-3 shadow-xs select-none">
        <span className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
          {tr('Verified Only', 'Chỉ tin đã xác thực')}
        </span>
        <Switch
          checked={verifiedOnly}
          onChange={(v) => setVerifiedOnly(v)}
          label={tr('Verified Only', 'Chỉ tin đã xác thực')}
          size="sm"
        />
      </div>

      {/* District Filter */}
      <div className="space-y-1.5">
        <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
          {tr('District / Commune', 'Quận / Huyện')}
        </label>
        <CustomSelect
          value={activeDistrict}
          onChange={setActiveDistrict}
          options={DISTRICTS.map(d => ({ value: d.slug, label: lang === 'vi' ? d.name : d.nameEn }))}
          placeholder={tr('Select District', 'Chọn Quận / Huyện')}
          activeClassName="text-accent-foreground border-accent-foreground/35"
        />
      </div>

      {/* Condition Filter */}
      <div className="space-y-1.5">
        <label className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">{t('filter.condition')}</label>
        <div className="flex flex-col gap-1">
          {[
            { slug: 'all', name: tr('All Conditions', 'Tất cả tình trạng') },
            { slug: 'new', name: tr('New / Like New', 'Mới / Like new') },
            { slug: 'used', name: tr('Used / Pre-owned', 'Cũ / Đã dùng') },
          ].map((cond) => (
            <Button
              key={cond.slug}
              variant="bare"
              size="none"
              onClick={() => setConditionFilter(cond.slug)}
              className={cn(
                'flex items-center justify-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors cursor-pointer',
                conditionFilter === cond.slug
                  ? 'text-accent-foreground'
                  : 'text-body hover:bg-muted',
              )}
            >
              <ChevronRight className={cn('h-3.5 w-3.5', conditionFilter === cond.slug ? 'text-accent-foreground' : 'text-ink-4')} />
              {cond.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Category Specific Detailed Filters */}
      {renderCategorySpecificFilters()}
    </div>
  )
}

// Mobile bottom drawer around <ExplorerFilters> — the shared ui/drawer shell
// (scrim + swipe-handle dismiss + rounded-t-2xl) replacing the old hand-rolled
// overlay. Header copy, the ✕ close, the Apply footer and every filter prop are
// carried over verbatim; all filter state still lives in the explorer.
export function ExplorerFiltersDrawer({
  open,
  onOpenChange,
  totalCount,
  ...filterProps
}: Omit<Props, 'isMobile'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  totalCount: number
}) {
  const { tr } = useLanguage()

  return (
    <Drawer
      open={open}
      onOpenChange={(next, details) => {
        // The hand-rolled shell never closed on Escape — that key belongs to the
        // CustomSelect menus (their own document-level listener closes just the
        // open menu). Letting the drawer react too would collapse menu + drawer
        // on a single press.
        if (!next && details.reason === 'escape-key') return
        onOpenChange(next)
      }}
      // Filter taps must never dismiss the drawer — including CustomSelect's
      // body-portaled menus, which sit OUTSIDE the popup and would otherwise
      // register as outside-presses. Like the old overlay, it closes only when
      // told to: swipe-down, the ✕, or Apply.
      disablePointerDismissal
      showSwipeHandle
    >
      <DrawerContent>
        <DrawerHeader className="flex-row items-center justify-between border-b border-border/80 pb-2.5">
          <DrawerTitle>{tr('Search Filters', 'Bộ lọc tìm kiếm')}</DrawerTitle>
          <IconButton
            size="xs"
            onClick={() => onOpenChange(false)}
            aria-label={tr('Close', 'Đóng')}
            className="bg-tint text-ink-3 hover:bg-line-strong active:scale-95"
          >
            <X className="h-4 w-4" />
          </IconButton>
        </DrawerHeader>

        {/* Scrollable Filters */}
        <div className="max-h-[50vh] overflow-y-auto p-4">
          <ExplorerFilters isMobile {...filterProps} />
        </div>

        {/* Apply Action Button */}
        <DrawerFooter>
          <Button
            variant="cta"
            size="none"
            onClick={() => onOpenChange(false)}
            className="w-full rounded-xl py-2.5 text-xs shadow-md active:scale-98 cursor-pointer"
          >
            {tr('Apply Filters', 'Áp dụng lọc')} ({totalCount} {tr('listings', 'tin')})
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
