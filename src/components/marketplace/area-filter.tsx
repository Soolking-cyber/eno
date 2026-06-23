'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, LocateFixed, Loader2, Check, ChevronDown } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { CustomSelect } from './custom-select'
import { EnoSlider } from './eno-slider'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export type Nearby = { lat: number; lng: number; radiusKm: number }
export type Geo = { code: string; name: string; nameEn: string }
type Unit = { code: string; name: string; nameEn: string }

// Text-form (monolith): no resting background, emphasis only on hover.
const FIELD = 'w-full justify-between rounded-xl py-2.5 text-body hover:bg-muted'
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
    <div className="flex w-full cursor-not-allowed items-center justify-between rounded-xl px-3.5 py-2.5 text-sm text-ink-4">
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
  open, anchorRef, onClose, province, ward, nearby, onApply, onReset,
}: {
  open: boolean
  anchorRef?: RefObject<HTMLElement | null>
  onClose: () => void
  province: Geo | null
  ward: Geo | null
  nearby: Nearby | null
  onApply: (r: { province: Geo | null; ward: Geo | null; nearby: Nearby | null }) => void
  onReset: () => void
}) {
  const { lang, tr } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 320 })

  // Anchor the panel under the trigger like CustomSelect (one design language).
  const reposition = useCallback(() => {
    const el = anchorRef?.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(360, window.innerWidth - 16)
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width })
  }, [anchorRef])

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
  const pendingWard = useRef<string | null>(null) // ward name from geolocation, applied once its wards load

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
        // Apply a ward pending from geolocation once its province's wards arrive.
        if (pendingWard.current) {
          const w = findUnit(ws, pendingWard.current)
          if (w) { setWardCode(w.code); pendingWard.current = null }
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
      // Auto-select province + ward from the geocoder's explicit fields (diacritic-insensitive).
      pendingWard.current = d.ward || null
      const prov = findUnit(provinces, d.province || '')
      if (prov && prov.code !== provCode) {
        setProvCode(prov.code); setWardCode('') // the wards effect loads them, then applies pendingWard
      } else if (pendingWard.current) {
        // same/unknown province → match the ward against the already-loaded list
        const w = findUnit(wards, pendingWard.current)
        if (w) { setWardCode(w.code); pendingWard.current = null }
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
    <div className="fixed inset-0 z-[99]" aria-hidden onClick={onClose} />
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
      className="z-[100] max-h-[72vh] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl bg-card p-4 shadow-pop scroll-thin animate-in fade-in duration-150"
    >
      <div className="space-y-4">
        {/* Province / city */}
        <div className="space-y-1.5">
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

        {/* Ward / commune */}
        <div className="space-y-1.5">
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
              activeClassName="bg-tint text-foreground"
            />
          ) : (
            <DisabledField label={tr('Select a province first', 'Hãy chọn tỉnh/thành trước')} />
          )}
        </div>

        {/* Search near you */}
        <div className="pt-1">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-accent-foreground" />
            <span className="text-sm font-bold text-foreground">{tr('Search near you', 'Tìm quanh bạn')}</span>
          </div>

          {loc ? (
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
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{tr('Search range', 'Bán kính tìm')}</span>
                  <span className="font-bold text-foreground">{radiusKm} km</span>
                </div>
                <EnoSlider min={1} max={20} step={1} value={radiusKm} onChange={setRadiusKm} aria-label={tr('Search range in km', 'Bán kính tìm theo km')} />
                <div className="flex justify-between text-[10px] text-ink-4"><span>1 km</span><span>20 km</span></div>
              </div>
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
      </div>

      <div className="mt-4 flex gap-3">
        <button onClick={reset} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-body transition-colors hover:bg-muted">{tr('Delete filter', 'Xóa lọc')}</button>
        <button onClick={apply} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182]"><Check className="h-4 w-4" /> {tr('Apply', 'Áp dụng')}</button>
      </div>
    </div>
    </>,
    document.body,
  )
}
