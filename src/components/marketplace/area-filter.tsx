'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { LocateFixed, Loader2, Check, ChevronDown } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { CustomSelect } from './custom-select'
import { EnoSlider } from './eno-slider'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { Button } from '@/components/ui/button'

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
function findUnit(list: { code: string; name: string; nameEn: string }[], raw: string) {
  const n = norm(raw)
  if (!n) return undefined
  return list.find((u) => norm(u.name) === n || norm(u.nameEn) === n) ||
    list.find((u) => { const un = norm(u.name); return un.includes(n) || n.includes(un) })
}

function DisabledField({ label }: { label: string }) {
  return (
    <div className="flex w-full cursor-not-allowed items-center justify-between rounded-xl bg-tint/60 px-3.5 py-2.5 text-sm text-ink-4">
      <span>{label}</span>
      <ChevronDown className="h-4 w-4 text-slate-300" />
    </div>
  )
}

/**
 * Area filter: Province/City → Ward/Commune (Vietnam's 2025 admin structure, live
 * from /api/geo) plus "Search near you" (geolocation + radius). Controlled — the
 * parent owns the applied province/ward/nearby and re-opens it.
 */
export function AreaFilter({
  open, anchorRef, onClose, province, ward, nearby, onApply, onReset, mode = 'search', hideLocate = false,
}: {
  open: boolean
  anchorRef?: RefObject<HTMLElement | null>
  onClose: () => void
  province: Geo | null
  ward: Geo | null
  nearby: Nearby | null
  onApply: (r: { province: Geo | null; ward: Geo | null; nearby: Nearby | null }) => void
  onReset: () => void
  // 'search' = explorer filter (radius slider). 'pick' = post wizard location
  // picker — choose/auto-fetch a place, NO search-range slider or search wording.
  mode?: 'search' | 'pick'
  // Hide the in-panel "Use my current location" action (when the parent provides its
  // own quick geolocate button — e.g. the post wizard).
  hideLocate?: boolean
}) {
  const { lang, tr } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const trapRef = useFocusTrap<HTMLDivElement>(open)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320 })

  // Anchor the panel under the trigger like CustomSelect (one design language).
  const reposition = useCallback(() => {
    const el = anchorRef?.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(360, window.innerWidth - 16)
    // Symmetry: right-align the panel under triggers on the right half of the
    // screen (e.g. the header pin) and left-align under those on the left (e.g.
    // the facet Area pill) so the panel edge lines up with the button.
    const alignRight = r.left + r.width / 2 > window.innerWidth / 2
    const rawLeft = alignRight ? r.right - width : r.left
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8))
    setPos({ top: r.bottom + 6, left, width })
  }, [anchorRef])

  // Position the panel DURING the render that opens it (React's supported
  // adjust-state-in-render pattern, guarded by a ref so it runs once per open).
  // This is the root-cause fix for the "fly-in": relying on a post-mount effect
  // let the panel paint once at (0,0) and then jump to the trigger. Computing
  // here means the very first paint is already correctly placed — same as
  // CustomSelect, which positions in its own onClick before opening.
  const wasOpen = useRef(false)
  if (open && !wasOpen.current) {
    wasOpen.current = true
    reposition()
  } else if (!open && wasOpen.current) {
    wasOpen.current = false
  }

  // Reposition + outside-click/Escape close. useLayoutEffect so position is set
  // BEFORE paint — otherwise the panel flashes at top-left (0,0) for a frame then
  // jumps, which reads as a "fly-in from the corner".
  useLayoutEffect(() => {
    if (!open) return
    reposition()
    // Outside-tap closing is handled by the portaled backdrop (so the tap is absorbed
    // and never reaches a card below); here we only keep Escape + repositioning.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onScroll = () => reposition()
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, reposition, onClose, anchorRef])
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
  const pendingWard = useRef<string[]>([]) // ward-name candidates from geolocation, applied once its wards load

  useEffect(() => { setMounted(true) }, [])

  // Provinces (once).
  useEffect(() => {
    let off = false
    fetch('/api/geo?type=provinces').then((r) => r.json()).then((d) => { if (!off) setProvinces(d.provinces || []) }).catch(() => {})
    return () => { off = true }
  }, [])

  // Re-sync the draft to the applied values each time the modal opens.
  useEffect(() => {
    if (!open) return
    setProvCode(province?.code || HCMC)
    setWardCode(ward?.code || '')
    setLoc(nearby ? { lat: nearby.lat, lng: nearby.lng } : null)
    setRadiusKm(nearby?.radiusKm ?? 5)
    setAddress(null)
  }, [open, province, ward, nearby])

  // Wards for the selected province.
  useEffect(() => {
    if (!provCode) { setWards([]); return }
    let off = false
    setLoadingWards(true)
    fetch(`/api/geo?type=wards&province=${provCode}`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return
        const ws = d.wards || []
        setWards(ws); setLoadingWards(false)
        // Apply a ward pending from geolocation once its province's wards arrive —
        // try each candidate name until one matches a real ward.
        for (const cand of pendingWard.current) {
          const w = findUnit(ws, cand)
          if (w) { setWardCode(w.code); pendingWard.current = []; break }
        }
      })
      .catch(() => { if (!off) setLoadingWards(false) })
    return () => { off = true }
  }, [provCode])

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
      const prov = findUnit(provinces, d.province || '')
      if (prov && prov.code !== provCode) {
        setProvCode(prov.code); setWardCode('') // the wards effect loads them, then applies pendingWard
      } else {
        // same/unknown province → match the candidates against the already-loaded list
        for (const cand of pendingWard.current) {
          const w = findUnit(wards, cand)
          if (w) { setWardCode(w.code); pendingWard.current = []; break }
        }
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

  if (!open || !mounted) return null

  return createPortal(
    <>
    <div className="fixed inset-0 z-[99] bg-black/25 animate-in fade-in duration-150" aria-hidden onClick={onClose} />
    <div
      ref={(node) => { panelRef.current = node; trapRef.current = node }}
      role="dialog"
      aria-modal="true"
      aria-label={tr('Choose area', 'Chọn khu vực')}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, visibility: pos.top > 0 ? 'visible' : 'hidden' }}
      className="z-[100] max-h-[72vh] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl border border-border bg-popover p-4 shadow-pop scroll-thin animate-in fade-in duration-150"
    >
      <div className="space-y-4">
        {/* Province/City + Ward side-by-side (user decision 2026-07-13): one row,
            two dropdowns. Vietnam's 2025 two-tier model has no district level —
            city → ward IS the full official hierarchy. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0 space-y-1.5">
            <label className="text-xs font-bold text-foreground">{tr('Province / City', 'Tỉnh / Thành phố')}</label>
            <CustomSelect
              value={provCode}
              onChange={(c) => { setProvCode(c); setWardCode('') }}
              options={provinces.map((p) => ({ value: p.code, label: label(p) }))}
              placeholder={tr('Select Province/City', 'Chọn Tỉnh/Thành phố')}
              className={FIELD}
              activeClassName={FIELD}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className="text-xs font-bold text-foreground">{tr('Ward / Commune', 'Phường / Xã')}</label>
            {loadingWards ? (
              <DisabledField label={tr('Loading wards…', 'Đang tải phường/xã…')} />
            ) : wards.length ? (
              <CustomSelect
                value={wardCode}
                onChange={setWardCode}
                options={wards.map((w) => ({ value: w.code, label: label(w) }))}
                placeholder={tr('Select Ward/Commune', 'Chọn Phường/Xã')}
                className={FIELD}
                activeClassName={FIELD}
              />
            ) : (
              <DisabledField label={tr('Select a province first', 'Hãy chọn tỉnh/thành trước')} />
            )}
          </div>
        </div>

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
                    <span className="text-muted-foreground">{tr('Search range', 'Bán kính tìm')}</span>
                    <span className="font-bold text-foreground">{radiusKm} km</span>
                  </div>
                  <EnoSlider min={1} max={20} step={1} value={radiusKm} onChange={setRadiusKm} aria-label={tr('Search range in km', 'Bán kính tìm theo km')} />
                  <div className="flex justify-between text-3xs text-ink-4"><span>1 km</span><span>20 km</span></div>
                </div>
                <button
                  onClick={locate}
                  disabled={locating}
                  aria-label={tr('Use my current location', 'Dùng vị trí hiện tại')}
                  title={tr('Use my current location', 'Dùng vị trí hiện tại')}
                  className={cn(
                    'mb-3.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors active:scale-95 disabled:opacity-60',
                    loc ? 'border-brand bg-tint text-accent-foreground' : 'border-line-strong text-accent-foreground hover:bg-muted',
                  )}
                >
                  {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                </button>
              </div>
              {loc && (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-body">
                    {resolving ? tr('Finding your address…', 'Đang tìm địa chỉ…') : address || tr('Using your location', 'Dùng vị trí của bạn')}
                  </span>
                  <button onClick={() => { setLoc(null); setAddress(null) }} className="shrink-0 text-xs font-semibold text-ink-4 hover:text-foreground">{tr('Remove', 'Bỏ')}</button>
                </div>
              )}
            </div>
          ) : loc ? (
            // PICK (post wizard): located → show the resolved address + remove, no radius.
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-accent-foreground"><LocateFixed className="h-4 w-4" /> {tr('Using your location', 'Dùng vị trí của bạn')}</span>
                <button onClick={() => { setLoc(null); setAddress(null) }} className="text-xs font-semibold text-ink-4 hover:text-foreground">{tr('Remove', 'Bỏ')}</button>
              </div>
              {resolving ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {tr('Finding your address…', 'Đang tìm địa chỉ…')}</p>
              ) : address ? (
                <p className="text-xs leading-relaxed text-body">{address}</p>
              ) : null}
            </div>
          ) : (
            <button
              onClick={locate}
              disabled={locating}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-accent-foreground transition-colors hover:bg-muted active:scale-[0.99] disabled:opacity-60"
            >
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
              {tr('Use my current location', 'Dùng vị trí hiện tại')}
            </button>
          )}
        </div>
        )}
      </div>

      <div className="mt-4 flex gap-3">
        <button onClick={reset} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-body transition-colors hover:bg-muted">{mode === 'pick' ? tr('Clear', 'Xóa') : tr('Delete filter', 'Xóa lọc')}</button>
        <Button variant="cta" size="none" onClick={apply} className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm transition-colors"><Check className="h-4 w-4" /> {tr('Apply', 'Áp dụng')}</Button>
      </div>
    </div>
    </>,
    document.body,
  )
}

/** Compact inline Province/City + Ward picker — the "one row, two dropdowns"
 *  location control (user decision 2026-07-13) for FORMS (business profile
 *  etc.), reusing the same /api/geo two-tier dataset as the filter above.
 *  Emits the picked pair as display names; the caller owns the string field. */
export function WardPicker({ onPick, className }: { onPick: (v: { province: Geo | null; ward: Geo | null }) => void; className?: string }) {
  const { lang, tr } = useLanguage()
  const [provinces, setProvinces] = useState<Unit[]>([])
  const [wards, setWards] = useState<Unit[]>([])
  const [loadingWards, setLoadingWards] = useState(false)
  const [provCode, setProvCode] = useState('')
  const [wardCode, setWardCode] = useState('')
  const label = (u: Unit) => (lang === 'vi' ? u.name : u.nameEn)
  const toGeo = (u?: Unit): Geo | null => (u ? { code: u.code, name: u.name, nameEn: u.nameEn } : null)

  useEffect(() => {
    let off = false
    fetch('/api/geo?type=provinces').then((r) => r.json()).then((d) => { if (!off) setProvinces(d.provinces || []) }).catch(() => {})
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
