'use client'

import { useId } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Check, X } from '@/components/ui/icons'
import { CustomSelect } from './custom-select'
import { RangeFacetControl } from './range-facet-control'
import { CategoryIcon } from './category-icons'
import { STROKE_UI } from '@/lib/icon-tokens'
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
import { facetsFor } from '@/lib/taxonomy'
import type { SerializedCategory } from '@/lib/types'

type Props = {
  isMobile?: boolean
  categories: SerializedCategory[]
  activeCategory: string
  handleCategorySelect: (slug: string) => void
  activeSubcategory: string
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
  // Unique prefix for the heading-label ids below (mirrors facet-bar): this panel
  // mounts TWICE — desktop sidebar and mobile drawer — so static ids would collide.
  const uid = useId()

  // Category facets from the CANONICAL taxonomy (audit top-5 value): this drawer used
  // to hand-code ~200 lines of per-category selects that had already drifted from the
  // facet bar (its electronics "brand" offered exactly two hardcoded brands). One
  // source now — facetsFor() — mirroring facet-bar's kind mapping in the drawer's
  // vertical layout. `condition` is excluded: the drawer renders its own chips below.
  const setFacet = (key: string, value: string) => {
    setCustomFilters((prev) => {
      const next = { ...prev }
      if (value === 'all') delete next[key]
      else next[key] = value
      return next
    })
  }
  const renderCategorySpecificFilters = () => {
    if (activeCategory === 'all') return null
    const advFacets = facetsFor(activeCategory, activeSubcategory === 'all' ? null : activeSubcategory).filter((f) => f.key !== 'condition')
    if (!advFacets.length) return null
    return (
      <>
        {advFacets.map((f, i) => {
          const value = customFilters[f.key] || 'all'
          const opts = f.options.map((o) => ({ value: o.value, label: tr(o.label, o.labelVi) }))
          return (
            <div key={f.key} className={cn('space-y-1.5', i === 0 ? 'pt-2 border-t border-border/80' : 'pt-1')}>
              <label id={`${uid}-facet-${f.key}`} className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
                {tr(f.label, f.labelVi)}
              </label>
              {f.kind === 'range' && f.range ? (
                <RangeFacetControl range={f.range} value={value} onChange={(v) => setFacet(f.key, v)} />
              ) : f.kind === 'toggle' ? (
                <div role="group" aria-labelledby={`${uid}-facet-${f.key}`} className="flex flex-wrap gap-1.5">
                  {opts.map((o) => (
                    <Button
                      key={o.value}
                      variant="bare"
                      size="none"
                      type="button"
                      aria-pressed={value === o.value}
                      onClick={() => setFacet(f.key, value === o.value ? 'all' : o.value)}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer',
                        value === o.value ? 'text-accent-foreground' : 'text-body hover:bg-muted',
                      )}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              ) : (
                <CustomSelect
                  value={value}
                  onChange={(v) => setFacet(f.key, v)}
                  options={[{ value: 'all', label: tr('All', 'Tất cả') }, ...opts]}
                  label={tr(f.label, f.labelVi)}
                  placeholder={tr(f.label, f.labelVi)}
                  activeClassName="text-accent-foreground border-accent-foreground/35"
                />
              )}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <div className="space-y-4">
      {/* Categories Selection for Mobile Drawer */}
      {isMobile && (
        <div className="space-y-1.5">
          {/* A <label> with no htmlFor/control names nothing on its own — the id +
              role="group"/aria-labelledby below is what actually names the chip run
              (same pattern as facet-bar). */}
          <label id={`${uid}-category-label`} className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
            {tr('Category', 'Danh mục')}
          </label>
          <div role="group" aria-labelledby={`${uid}-category-label`} className="grid grid-cols-2 gap-1.5">
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
                  {/* Two things ride this glyph, and both come from `isActive` — the drawer's
                      OWN existing "this category is chosen" boolean, the same one painting the
                      chip's label accent one line up. No new state.
                      · selected → the brand-100 fill INSIDE the ink line (owner, 2026-08-07:
                        "use icons filling only when selected, not as default"). Unselected chips
                        stay pure line.
                      · stroke={STROKE_UI} → the 14px re-tier. ⚠️ This used to be a `stroke-2`
                        CLASS on the mount, which is now DEAD: a category glyph is no longer one
                        svg, so the class lands on the wrapper <span> and stroke-width inheritance
                        LOSES to each layer's own presentation attribute. It silently left these
                        chips on the display tier (1.5 → ~0.9px at h-3.5). Same deletion note as
                        CHIP_CATEGORY_ICON_STROKE in shelf.tsx: the re-tier is a prop now. */}
                  <CategoryIcon name={cat.icon} stroke={STROKE_UI} selected={isActive} className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-accent-foreground' : 'text-body')} />
                  <span className="text-3xs truncate"><Tr text={lang === 'vi' ? cat.nameVi : cat.name} /></span>
                </Button>
              )
            })}
          </div>
        </div>
      )}

      {/* ⛔ NO SUBCATEGORY GROUP IN THIS DRAWER (owner, 2026-08-12: "filter shouldnt have
          subcategories as chip remove subcats from filter"). It was a second copy of the same
          picker the desktop panel carried — see the note on `hasAdvanced` in facet-bar.tsx for the
          reasoning and for what the CategoryRail now owns. Removing it in only one of the two
          would have left the control on exactly the surface the owner was looking at.
          ⚠️ `activeSubcategory` STAYS A PROP; `setActiveSubcategory` DID NOT. The value still
          gates which advanced facets this drawer offers (`facetsFor(category, subcategory)`
          above) — that was never the duplication. The SETTER had exactly one caller, this group,
          so it left with it; dropping the category's subcategory when the category changes is
          `handleCategorySelect`'s job in the explorer, not the drawer's. */}
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
        {/* Visible heading only — CustomSelect labels itself via its `label` prop
            (sr-only span + aria-labelledby), so a <label> here would name nothing. */}
        <span className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">
          {tr('District / Commune', 'Quận / Huyện')}
        </span>
        <CustomSelect
          value={activeDistrict}
          onChange={setActiveDistrict}
          options={DISTRICTS.map(d => ({ value: d.slug, label: lang === 'vi' ? d.name : d.nameEn }))}
          label={tr('District / Commune', 'Quận / Huyện')}
          placeholder={tr('Select District', 'Chọn Quận / Huyện')}
          activeClassName="text-accent-foreground border-accent-foreground/35"
        />
      </div>

      {/* Condition Filter */}
      <div className="space-y-1.5">
        <label id={`${uid}-condition-label`} className="text-2xs font-bold text-muted-foreground uppercase tracking-wider">{t('filter.condition')}</label>
        <div role="group" aria-labelledby={`${uid}-condition-label`} className="flex flex-col gap-1">
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
              {/* Selection is a CHECK, not a chevron — same vocabulary as the CustomSelect menu
                  rows one field up (a right-chevron promises navigation; these rows select).
                  opacity-0 (not conditional render) keeps the labels on one left edge. */}
              <Check className={cn('h-3.5 w-3.5 shrink-0', conditionFilter === cond.slug ? 'text-accent-foreground' : 'opacity-0')} aria-hidden="true" />
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
        // CustomSelect menus (Base UI Select dismisses the open menu on Escape).
        // Letting the drawer react too would collapse menu + drawer on one press.
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
            className="bg-tint text-ink-3 hover:bg-line-strong active:scale-[0.96]"
          >
            <X className="h-[29px] w-[29px] shrink-0" />
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
            // Massive, impossible-to-miss primary CTA: h-14 (56px), text-base, rounded-2xl. `cta`
            // already paints the solid brand fill; no shadow (flat canvas — elevation is banned).
            className="w-full h-14 rounded-2xl text-base font-semibold active:scale-[0.96] cursor-pointer"
          >
            {tr('Apply Filters', 'Áp dụng lọc')} ({totalCount} {tr('listings', 'tin')})
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
