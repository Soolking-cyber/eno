'use client'

import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { DISTRICTS, districtOptionLabel, districtOptionsFor, districtSlugLabel } from './listings-explorer.constants'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { LocateFixed, Loader2, Check, ChevronsUpDown } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { CustomSelect } from './custom-select'
import { EnoSlider } from './eno-slider'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Label } from '@/components/ui/label'
import { offeredKeys, railDimension } from './count-chip'
import type { DimensionCounts } from '@/lib/facet-counts'

export type Nearby = { lat: number; lng: number; radiusKm: number }
export type Geo = { code: string; name: string; nameEn: string }
type Unit = { code: string; name: string; nameEn: string }

// Text-form (monolith): no resting background, emphasis only on hover.
const FIELD = 'w-full justify-between rounded-xl bg-tint px-3.5 py-2.5 text-body hover:bg-muted'
const HCMC = '79' // Ho Chi Minh City — the live market; default selection

// Normalize a VN admin name for matching: lowercase, strip diacritics, drop the
// administrative prefix (Tỉnh/Thành phố/Quận/Huyện/Phường/Xã/Thị trấn/Thị xã).
function norm(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\b(tinh|thanh pho|tp|quan|huyen|phuong|xa|thi tran|thi xa)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
export function findUnit(list: { code: string; name: string; nameEn: string }[], raw: string) {
  const n = norm(raw)
  if (!n) return undefined
  return list.find((u) => norm(u.name) === n || norm(u.nameEn) === n) ||
    list.find((u) => { const un = norm(u.name); return un.includes(n) || n.includes(un) })
}

// Provinces list, fetched ONCE per page load and shared: AreaFilter is mounted
// unconditionally by the header AND the facet bar (and WardPicker repeats the call),
// so each instance hitting /api/geo on mount duplicated the request. Module-level
// promise cache dedupes across instances; reset on failure so a later open can retry.
let provincesPromise: Promise<Unit[]> | null = null
function fetchProvinces(): Promise<Unit[]> {
  if (!provincesPromise) {
    provincesPromise = fetch('/api/geo?type=provinces')
      .then((r) => r.json())
      .then((d) => d.provinces || [])
      .catch(() => { provincesPromise = null; return [] })
  }
  return provincesPromise
}

function DisabledField({ label }: { label: string }) {
  return (
    // The caret mirrors CustomSelect's trigger exactly (ChevronsUpDown h-3.5 text-ink-4) so a
    // disabled field reads as the same control as its live sibling, just dimmed by the bg-tint/60
    // box. Was ChevronDown text-slate-300 — a different glyph AND the icon family's one off-token
    // color (icon-language §1: color via ink tokens only, and slate is not our neutral ramp).
    <div className="flex w-full cursor-not-allowed items-center justify-between rounded-xl bg-tint/60 px-3.5 py-2.5 text-sm text-ink-4">
      <span>{label}</span>
      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-4" />
    </div>
  )
}

/**
 * Area filter: Province/City → Ward/Commune (Vietnam's 2025 admin structure, live
 * from /api/geo) plus "Search near you" (geolocation + radius). Controlled — the
 * parent owns the applied province/ward/nearby, the trigger button and its ref, and
 * the open state. The floating shell is a Base UI Popover in controlled mode anchored
 * to the parent's trigger (`anchor={anchorRef}`): the primitive brings the dialog
 * role, Escape, focus move + return and collision-aware anchoring that the old
 * hand-rolled portal omitted. Non-modal (no scroll lock, no focus trap) so the nested
 * Base UI Selects — which portal their own listbox — keep working untouched.
 */
export function AreaFilter({
  open, anchorRef, onClose, province, ward, district = 'all', onPickDistrict, nearby, onApply, onReset, mode = 'search', hideLocate = false,
  districtCounts, provinceCounts,
}: {
  open: boolean
  anchorRef?: RefObject<HTMLElement | null>
  onClose: () => void
  province: Geo | null
  ward: Geo | null
  /**
   * The applied curated HCMC district slug (`?district=`), or 'all'. Optional because the
   * post-wizard picker (`mode: 'pick'`) has no use for it — a seller states where a thing IS, in the
   * official hierarchy.
   */
  district?: string
  /**
   * Picks a district (or 'all' to drop it) — APPLIED AT ONCE, and the panel closes. Omitted, the
   * district list is not drawn: a list whose taps do nothing is worse than no list (reviewer). The
   * parent owns what a pick replaces (the ward, the radius, a province outside HCMC).
   */
  onPickDistrict?: (slug: string) => void
  nearby: Nearby | null
  onApply: (r: { province: Geo | null; ward: Geo | null; nearby: Nearby | null }) => void
  onReset: () => void
  // 'search' = explorer filter (radius slider). 'pick' = post wizard location
  // picker — choose/auto-fetch a place, NO search-range slider or search wording.
  mode?: 'search' | 'pick'
  // Hide the in-panel "Use my current location" action (when the parent provides its
  // own quick geolocate button — e.g. the post wizard).
  hideLocate?: boolean
  /**
   * Live counts (the feed's `facets.area` / `facets.province`, src/lib/facet-counts.ts), each
   * counted with every other filter applied and the place released. Given, a district or province
   * with nothing in view is NOT DRAWN (owner, 2026-09-25: "show only available filter options") —
   * measured that day, the 24 district chips returned 0 in every product category (products carry
   * no district) and 27 of 34 provinces had no public row at all. Omitted (the post wizard's
   * picker, a payload without counts), every place is drawn, as before.
   */
  districtCounts?: DimensionCounts
  provinceCounts?: DimensionCounts
}) {
  const { lang, tr } = useLanguage()
  const [provinces, setProvinces] = useState<Unit[]>([])
  const [wards, setWards] = useState<Unit[]>([])
  const [loadingWards, setLoadingWards] = useState(false)
  const [provCode, setProvCode] = useState(province?.code || HCMC)
  const [wardCode, setWardCode] = useState(ward?.code || '')
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(nearby ? { lat: nearby.lat, lng: nearby.lng } : null)
  const [radiusKm, setRadiusKm] = useState(nearby?.radiusKm ?? 5)
  const [address, setAddress] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [locating, setLocating] = useState(false)
  const districtLabelId = useId()
  const pendingWard = useRef<string[]>([]) // ward-name candidates from geolocation, applied once its wards load
  // Latest-value refs: resolveAddress runs from the async geolocation callback, which closes over
  // provinces/wards from the render where locate() was clicked. If those lists finished loading
  // AFTER the click (common — geolocation takes seconds), the stale closure would match against []
  // and silently select nothing. Reading through refs always sees the current lists. Synced in an
  // effect (NOT assigned during render — that tears under concurrent/aborted renders).
  const provincesRef = useRef(provinces)
  const wardsRef = useRef(wards)
  useEffect(() => { provincesRef.current = provinces }, [provinces])
  useEffect(() => { wardsRef.current = wards }, [wards])

  // Provinces (once, and only once the panel actually opens — this component is
  // mounted unconditionally by the header and facet bar, so a mount-time fetch
  // would fire on every page view even when the filter is never used).
  const provincesFetched = useRef(false)
  useEffect(() => {
    if (!open || provincesFetched.current) return
    provincesFetched.current = true
    let off = false
    fetchProvinces().then((ps) => { if (!off) setProvinces(ps) })
    return () => { off = true }
  }, [open])

  // Re-sync the draft to the applied values each time the modal opens.
  useEffect(() => {
    if (!open) return
    setProvCode(province?.code || HCMC)
    setWardCode(ward?.code || '')
    setLoc(nearby ? { lat: nearby.lat, lng: nearby.lng } : null)
    setRadiusKm(nearby?.radiusKm ?? 5)
    setAddress(null)
  }, [open, province, ward, nearby])

  // Wards for the selected province — ONLY while the popover is open (perf Phase 1:
  // a persisted/geolocated province made every cold load fetch that province's wards
  // for a control nobody had opened).
  useEffect(() => {
    if (!provCode) { setWards([]); return }
    if (!open) return
    let off = false
    setLoadingWards(true)
    fetch(`/api/geo?type=wards&province=${provCode}`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return
        const ws = d.wards || []
        setWards(ws); setLoadingWards(false)
        // Apply a ward pending from geolocation once its province's wards arrive — try each
        // candidate name until one matches. ONE-SHOT: clear the queue after this attempt (matched
        // or not). Leaving unmatched candidates would let a LATER manual province switch resurrect
        // them and mis-select a same-named ward (VN reuses "Phường 1" across provinces).
        for (const cand of pendingWard.current) {
          const w = findUnit(ws, cand)
          if (w) { setWardCode(w.code); break }
        }
        pendingWard.current = []
      })
      .catch(() => { if (!off) setLoadingWards(false) })
    return () => { off = true }
  }, [provCode, open])

  const label = (u: Unit) => (lang === 'vi' ? u.name : u.nameEn)
  const toGeo = (u?: Unit): Geo | null => (u ? { code: u.code, name: u.name, nameEn: u.nameEn } : null)

  const resolveAddress = async (lat: number, lng: number) => {
    setResolving(true)
    setAddress(null)
    try {
      const r = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}&lang=${lang}`)
      const d = await r.json()
      if (d.address) setAddress(d.address)
      // Auto-select province + ward from the geocoder's fields (diacritic-insensitive).
      // wardCandidates carries several name guesses (the precise top result often omits
      // the official ward) — try them in order.
      pendingWard.current = Array.isArray(d.wardCandidates) && d.wardCandidates.length ? d.wardCandidates : (d.ward ? [d.ward] : [])
      const prov = findUnit(provincesRef.current, d.province || '')
      if (prov && prov.code !== provCode) {
        setProvCode(prov.code); setWardCode('') // the wards effect loads them, then applies pendingWard
      } else {
        // Same/unknown province → no wards effect will re-fire (provCode unchanged), so consume the
        // queue HERE against the current list (via ref — the closure's `wards` may be stale). ONE-
        // SHOT: clear afterwards regardless of match so a later manual province switch can't
        // resurrect stale candidates and mis-pick a same-named ward.
        for (const cand of pendingWard.current) {
          const w = findUnit(wardsRef.current, cand)
          if (w) { setWardCode(w.code); break }
        }
        pendingWard.current = []
      }
    } catch { /* coords only */ } finally {
      setResolving(false)
    }
  }

  const locate = () => {
    if (!('geolocation' in navigator)) { toast.error(tr('Location not available on this device.', 'Thiết bị không hỗ trợ định vị.')); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setLoc(p); setLocating(false); resolveAddress(p.lat, p.lng)
      },
      () => { setLocating(false); toast.error(tr('Could not get your location. Allow location access and try again.', 'Không lấy được vị trí. Hãy cho phép truy cập vị trí và thử lại.')) },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  const apply = () => {
    onApply({
      province: toGeo(provinces.find((p) => p.code === provCode)),
      ward: toGeo(wards.find((w) => w.code === wardCode)),
      nearby: loc ? { ...loc, radiusKm } : null,
    })
    onClose()
  }

  const reset = () => { setProvCode(HCMC); setWardCode(''); setLoc(null); setAddress(null); setRadiusKm(5); onReset(); onClose() }

  /**
   * Places worth offering (offeredKeys). Provinces drop only when EMPTY — the select is also the
   * draft that scopes the ward list and defaults to HCMC, so a province holding every row in view is
   * still a real choice; the applied and the draft province always stay. Districts are chips that
   * filter, so a district holding every row in view (a no-op) goes too, and a picked one stays.
   */
  const provDim = railDimension(provinceCounts, provinces.map((p) => p.nameEn))
  const keptProvinces = new Set(offeredKeys(provDim, provinces.map((p) => p.nameEn), [province?.nameEn, provinces.find((p) => p.code === provCode)?.nameEn]))
  const shownProvinces = provinces.filter((p) => keptProvinces.has(p.nameEn))
  const districtChips = (() => {
    const all = [
      // ⚠️ A /c/<category>/<district> landing slug (`quan-7`) is a real pick that is not in
      // DISTRICTS; it leads the list, pressed, so it can be seen and dropped here (opus).
      ...(district !== 'all' && !DISTRICTS.some((d) => d.slug === district)
        ? [{ slug: district, name: districtSlugLabel(district, 'vi'), nameEn: districtSlugLabel(district, 'en') }]
        : []),
      ...districtOptionsFor({ code: provCode }, district).filter((d) => d.slug !== 'all'),
    ]
    const dim = railDimension(districtCounts, all.map((d) => d.slug))
    const kept = new Set(offeredKeys(dim, all.map((d) => d.slug), district, { hideNoOp: true }))
    return all.filter((d) => kept.has(d.slug))
  })()

  // Symmetry, preserved from the old hand-rolled placement: right-align the panel under
  // triggers on the right half of the screen (e.g. the header pin) and left-align under
  // those on the left (e.g. the facet Area pill) so the panel edge lines up with the
  // button. Base UI's collision handling then shifts it to stay on screen. Measured only
  // while open + on the client (the panel renders nowhere until then).
  const align: 'start' | 'end' =
    open && typeof window !== 'undefined' && anchorRef?.current
      ? (anchorRef.current.getBoundingClientRect().left + anchorRef.current.getBoundingClientRect().width / 2 > window.innerWidth / 2 ? 'end' : 'start')
      : 'start'

  return (
    // Controlled + non-modal. onOpenChange only ever fires with `false` here (no Base UI
    // trigger to open it) — Escape / outside-press / backdrop-tap → onClose(). The dark
    // scrim is preserved as a Popover.Backdrop; the panel stays at z-[100] over a z-[99]
    // scrim so a CustomSelect opened inside (its own backdrop at z-[1200]) still layers on top.
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <PopoverPrimitive.Portal>
        {/* ⚠️ `.overlay-scrim`, NOT A HAND-ROLLED TINT (owner, 2026-08-13: "area dropdown still doesnt
            have blur instead darkens background"). This rendered its own `bg-black/25` with no blur,
            which is exactly the inconsistency the shared scrim was introduced to end — and twice as
            dark as every other overlay. It bypasses ui/popover (it drives PopoverPrimitive directly
            for the z-layering described above), so it has to opt into the class by name. Keep the
            z-[99]: the panel sits at z-[100] and a CustomSelect opened inside it goes higher still.
            ⚠️ NO `animate-in` HERE: `.overlay-scrim` already fades BOTH ways off Base UI's
            data-starting-style / data-ending-style. A keyframe enter on top of it only animated the
            open, so the scrim faded in and then vanished on close.
            `--scrim-exit` = the popup's own 75ms exit below, so the two finish together instead of
            the popup's unmount cutting the scrim off mid-fade (see `.overlay-scrim` in globals.css). */}
        <PopoverPrimitive.Backdrop className="overlay-scrim fixed inset-0 z-[99] [--scrim-exit:75ms_var(--ease-out-strong)]" />
        <PopoverPrimitive.Positioner
          anchor={anchorRef}
          side="bottom"
          align={align}
          sideOffset={6}
          positionMethod="fixed"
          collisionPadding={8}
          className="z-[100]"
        >
          {/* ⚠️ THE ui/popover MOTION RECIPE, BOTH HALVES. This drove the primitive directly with only
              `animate-in fade-in`, so it had no exit at all (a backdrop tap hard-cut the panel at
              ~61ms) and scaled from its own centre. Now it grows from the trigger
              (`--transform-origin`, set by the Positioner) in 100ms and leaves in 75ms on the same
              strong ease-out as every other popover — exits faster than entrances. */}
          <PopoverPrimitive.Popup
            finalFocus={anchorRef}
            aria-label={tr('Choose area', 'Chọn khu vực')}
            className="w-90 max-h-[min(72vh,var(--available-height,72vh))] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl border border-border bg-popover px-4 pt-4 shadow-pop scroll-thin origin-(--transform-origin) duration-100 ease-[var(--ease-out-strong)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:data-closed:slide-out-to-top-2 data-[side=top]:data-closed:slide-out-to-bottom-2 data-closed:duration-75"
          >
            <div className="space-y-4">
              {/* Province/City + Ward side-by-side (user decision 2026-07-13): one row,
                  two dropdowns. Vietnam's 2025 two-tier model has no district level —
                  city → ward IS the full official hierarchy. */}
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-bold text-foreground leading-normal">{tr('Province / City', 'Tỉnh / Thành phố')}</Label>
                  <CustomSelect
                    value={provCode}
                    onChange={(c) => { setProvCode(c); setWardCode('') }}
                    options={shownProvinces.map((p) => ({ value: p.code, label: label(p) }))}
                    label={tr('Province / City', 'Tỉnh / Thành phố')}
                    placeholder={tr('Select Province/City', 'Chọn Tỉnh/Thành phố')}
                    className={FIELD}
                    activeClassName={FIELD}
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs font-bold text-foreground leading-normal">{tr('Ward / Commune', 'Phường / Xã')}</Label>
                  {loadingWards ? (
                    <DisabledField label={tr('Loading wards…', 'Đang tải phường/xã…')} />
                  ) : wards.length ? (
                    <CustomSelect
                      value={wardCode}
                      onChange={setWardCode}
                      options={wards.map((w) => ({ value: w.code, label: label(w) }))}
                      label={tr('Ward / Commune', 'Phường / Xã')}
                      placeholder={tr('Select Ward/Commune', 'Chọn Phường/Xã')}
                      className={FIELD}
                      activeClassName={FIELD}
                    />
                  ) : (
                    <DisabledField label={tr('Select a province first', 'Hãy chọn tỉnh/thành trước')} />
                  )}
                </div>
              </div>

              {/**
                * ⛔ DISTRICT IS AN HCMC CONVENIENCE, NOT THE OFFICIAL HIERARCHY — and the note above
                * this block is still true: Vietnam's 2025 two-tier model has no district level, so
                * city → ward IS the official path and that is why these two lead.
                *
                * But the LISTINGS still speak in districts: sellers write "Quận 1", "Bình Thạnh",
                * the curated list is matched against the stored `district`/`location` text, and the
                * outline the map draws for a district comes back from OSM as a `historic` boundary
                * under exactly those names. Owner, 2026-09-24: "still cant search by district" — the
                * only other district control, in the filters drawer, had no way to be opened.
                *
                * ⛔ ONE TAP APPLIES AND CLOSES, like a chip, not a draft value waiting for Apply. The
                * earlier select here was a draft committed together with the province/ward/radius
                * above it, so "Quận 7" + a ward in Quận 1 went out as one AND — an empty feed from a
                * single Apply. A district is its own place: picking one REPLACES the ward and the
                * radius (the parent clears them), and applying a ward or a radius replaces it.
                *
                * ⚠️ TOGGLE BUTTONS (aria-pressed), NOT A RADIO GROUP. Base UI radios select on focus
                * (RadioGroup.js marks any arrow key as touched → RadioRoot's onFocus clicks), and a
                * pick here APPLIES AND CLOSES the panel — a keyboard user arrowing through the list
                * would apply the first district they passed. Same reasoning, and the same chip, as
                * facet-bar's segmented facets: pressing the picked district again drops it.
                *
                * ⚠️ HCMC ONLY, because DISTRICTS is a hand-curated HCMC list (districtOptionsFor).
                * The draft province defaults to HCMC, so with no province applied the list shows.
                * ⚠️ NO "ALL" CHIP. It would be pressed — a filled chip — whenever nothing is picked, and
                * its label would have to name a province: the APPLIED one ("All of Ha Noi") can differ
                * from the draft one this list is drawn under (opus, agy, codex). Dropping a district is
                * pressing it again, the panel's "Delete filter", or the applied chip's ×.
                */}
              {mode === 'search' && onPickDistrict && provCode === HCMC && districtChips.length > 0 && (
                <div className="min-w-0 space-y-1.5">
                  <Label id={districtLabelId} className="text-xs font-bold text-foreground leading-normal">{tr('District (Quận/Huyện)', 'Quận / Huyện')}</Label>
                  <div role="group" aria-labelledby={districtLabelId} className="flex flex-wrap gap-1.5">
                    {districtChips.map((d) => {
                      const picked = district === d.slug
                      return (
                        <Button
                          key={d.slug}
                          variant="bare"
                          size="none"
                          type="button"
                          aria-pressed={picked}
                          onClick={() => { onPickDistrict(picked ? 'all' : d.slug); onClose() }}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-sm font-semibold whitespace-normal transition-colors cursor-pointer',
                            picked ? 'border-brand bg-primary text-white' : 'border-line-strong text-body hover:bg-muted',
                          )}
                        >
                          {districtOptionLabel(d, lang, null, tr)}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Near you / use your location — the action button below is self-explanatory,
                  so no heading. Hidden when the parent provides its own geolocate button. */}
              {!hideLocate && (
              <div className="pt-1">
                {mode === 'search' ? (
                  // SEARCH: the radius is ALWAYS visible + adjustable; "use my location" is a
                  // compact icon to its right — set the range any time, geolocate on demand
                  // (no need to commit to the geolocation prompt before seeing the radius).
                  <div className="mt-2 space-y-2">
                    <div className="flex items-end gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          {/* ⚠️ NOT "bán kính" — that word means RADIUS, and the search is a BOX of
                              this half-width (the map draws it). Only the aria-label was corrected
                              at first, which left a sighted Vietnamese reader promised a shape the
                              query does not apply. */}
                          <span className="text-muted-foreground">{tr('Search area', 'Vùng tìm kiếm')}</span>
                          <span className="font-bold text-foreground">{radiusKm} km</span>
                        </div>
                        {/* ⚠️ "AREA", NOT "RADIUS". The database filters a lat/lng BOX of this
                            half-width (src/lib/geo-radius.ts explains why a circle does not scale),
                            and the map draws that box — so a control promising a radius would be
                            promising a shape the search does not apply. The number still means
                            kilometres; it is the half-width rather than a radius. */}
                        <EnoSlider min={1} max={20} step={1} value={radiusKm} onChange={setRadiusKm} aria-label={tr('Search area size in km', 'Kích thước vùng tìm theo km')} />
                        <div className="flex justify-between text-3xs text-ink-4"><span>1 km</span><span>20 km</span></div>
                      </div>
                      <IconButton
                        size="lg"
                        onClick={locate}
                        disabled={locating}
                        aria-label={tr('Use my current location', 'Dùng vị trí hiện tại')}
                        title={tr('Use my current location', 'Dùng vị trí hiện tại')}
                        className={cn(
                          'mb-3.5 rounded-xl border transition-colors active:scale-[0.96] disabled:opacity-60',
                          loc ? 'border-brand bg-tint text-accent-foreground' : 'border-line-strong text-accent-foreground hover:bg-muted',
                        )}
                      >
                        {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                      </IconButton>
                    </div>
                    {loc && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs text-body">
                          {resolving ? tr('Finding your address…', 'Đang tìm địa chỉ…') : address || tr('Using your location', 'Dùng vị trí của bạn')}
                        </span>
                        <Button variant="bare" size="none" onClick={() => { setLoc(null); setAddress(null) }} className="shrink-0 text-xs font-semibold text-ink-4 hover:text-foreground">{tr('Remove', 'Bỏ')}</Button>
                      </div>
                    )}
                  </div>
                ) : loc ? (
                  // PICK (post wizard): located → show the resolved address + remove, no radius.
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-accent-foreground"><LocateFixed className="h-4 w-4" /> {tr('Using your location', 'Dùng vị trí của bạn')}</span>
                      <Button variant="bare" size="none" onClick={() => { setLoc(null); setAddress(null) }} className="text-xs font-semibold text-ink-4 hover:text-foreground">{tr('Remove', 'Bỏ')}</Button>
                    </div>
                    {resolving ? (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {tr('Finding your address…', 'Đang tìm địa chỉ…')}</p>
                    ) : address ? (
                      <p className="text-xs leading-relaxed text-body">{address}</p>
                    ) : null}
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="none"
                    onClick={locate}
                    disabled={locating}
                    className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-accent-foreground transition-colors hover:bg-muted hover:text-accent-foreground active:scale-[0.99] disabled:opacity-60"
                  >
                    {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                    {tr('Use my current location', 'Dùng vị trí hiện tại')}
                  </Button>
                )}
              </div>
              )}
            </div>

            {/* ⚠️ THE PANEL'S MAIN ACTION STAYS ON SCREEN. The panel scrolls inside its own
                `--available-height` cap, and this row sat at the END of that scroll: opened from the
                home header, Apply measured 274px below the panel's visible bottom, and in Vietnamese
                it was cut by the panel edge. Sticky to the scrollport's bottom, bleeding over the
                popup's side padding (-mx-4) on its own opaque plate so the content scrolls UNDER it.
                ⚠️ THE POPUP HAS NO BOTTOM PADDING — this row carries it (`pb-…`). A sticky box stops
                at the scroll container's PADDING edge, not its border: with the popup's p-4 the row
                parked 16px above the panel's bottom and the district chips scrolled visibly through
                that strip beneath it (measured and screenshotted). No bottom padding, no strip. */}
            <div className="sticky bottom-0 -mx-4 mt-4 flex gap-3 border-t border-border bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button variant="ghost" size="none" onClick={reset} className="flex-1 cursor-pointer rounded-xl py-2.5 text-sm font-bold text-body transition-colors hover:bg-muted hover:text-body">{mode === 'pick' ? tr('Clear', 'Xóa') : tr('Delete filter', 'Xóa lọc')}</Button>
              <Button variant="cta" size="none" onClick={apply} className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm transition-colors"><Check className="h-4 w-4" /> {tr('Apply', 'Áp dụng')}</Button>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** Compact inline Province/City + Ward picker — the "one row, two dropdowns"
 *  location control (user decision 2026-07-13) for FORMS (business profile
 *  etc.), reusing the same /api/geo two-tier dataset as the filter above.
 *  Emits the picked pair as display names; the caller owns the string field.
 *
 *  `value` is an ADOPTION prop, not full control: when the caller hands in a new
 *  resolved pair (the editor's "Use my location" geolocate), the dropdowns sync to
 *  it once; hand-picks stay fully internal and are never reverted by a re-render
 *  with the same stale value (the ref guard below). onPick is NOT fired for an
 *  adopted value — the caller already knows what it passed. */
export function WardPicker({ onPick, value, className }: {
  onPick: (v: { province: Geo | null; ward: Geo | null }) => void
  value?: { province: Geo | null; ward: Geo | null } | null
  className?: string
}) {
  const { lang, tr } = useLanguage()
  const [provinces, setProvinces] = useState<Unit[]>([])
  const [wards, setWards] = useState<Unit[]>([])
  const [loadingWards, setLoadingWards] = useState(false)
  const [provCode, setProvCode] = useState('')
  const [wardCode, setWardCode] = useState('')
  // Last ADOPTED value key — a same-value re-render must not clobber a newer hand-pick.
  const adopted = useRef('')
  useEffect(() => {
    if (!value) {
      // null = "nothing adopted": forget the key so a LATER locate that resolves to
      // the very same place re-adopts (the caller nulls this on a hand-pick; without
      // the reset, a same-key repeat locate would be silently ignored — review catch).
      adopted.current = ''
      return
    }
    const key = `${value.province?.code || ''}|${value.ward?.code || ''}`
    if (key === adopted.current) return
    adopted.current = key
    setProvCode(value.province?.code || '')
    setWardCode(value.ward?.code || '')
  }, [value])
  const label = (u: Unit) => (lang === 'vi' ? u.name : u.nameEn)
  const toGeo = (u?: Unit): Geo | null => (u ? { code: u.code, name: u.name, nameEn: u.nameEn } : null)

  useEffect(() => {
    let off = false
    fetchProvinces().then((ps) => { if (!off) setProvinces(ps) })
    return () => { off = true }
  }, [])
  useEffect(() => {
    if (!provCode) { setWards([]); return }
    let off = false
    setLoadingWards(true)
    fetch(`/api/geo?type=wards&province=${provCode}`)
      .then((r) => r.json())
      .then((d) => { if (!off) setWards(d.wards || []) })
      .catch(() => {})
      .finally(() => { if (!off) setLoadingWards(false) })
    return () => { off = true }
  }, [provCode])

  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      <div className="min-w-0">
        <CustomSelect
          value={provCode}
          onChange={(c) => {
            setProvCode(c); setWardCode('')
            onPick({ province: toGeo(provinces.find((p) => p.code === c)), ward: null })
          }}
          options={provinces.map((p) => ({ value: p.code, label: label(p) }))}
          label={tr('Province / City', 'Tỉnh / Thành phố')}
          placeholder={tr('Province/City', 'Tỉnh/Thành phố')}
          className={FIELD}
          activeClassName={FIELD}
        />
      </div>
      <div className="min-w-0">
        {loadingWards ? (
          <DisabledField label={tr('Loading…', 'Đang tải…')} />
        ) : wards.length ? (
          <CustomSelect
            value={wardCode}
            onChange={(c) => {
              setWardCode(c)
              onPick({ province: toGeo(provinces.find((p) => p.code === provCode)), ward: toGeo(wards.find((w) => w.code === c)) })
            }}
            options={wards.map((w) => ({ value: w.code, label: label(w) }))}
            label={tr('Ward / Commune', 'Phường / Xã')}
            placeholder={tr('Ward/Commune', 'Phường/Xã')}
            className={FIELD}
            activeClassName={FIELD}
          />
        ) : (
          <DisabledField label={tr('Ward/Commune', 'Phường/Xã')} />
        )}
      </div>
    </div>
  )
}
