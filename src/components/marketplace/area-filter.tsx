'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, LocateFixed, Loader2, X, Check, ChevronDown } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { CustomSelect } from './custom-select'
import { PROVINCES, DISTRICTS } from './listings-explorer.constants'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export type Nearby = { lat: number; lng: number; radiusKm: number }

const FIELD = 'w-full justify-between rounded-xl border border-slate-300 bg-white py-2.5 text-[#1a202c]'

// A not-yet-available cascading field (Ward/Commune, Street) — present for the
// detailed structure, disabled until we carry that data on listings.
function DisabledField({ label, title }: { label: string; title?: string }) {
  return (
    <div
      title={title}
      className="flex w-full cursor-not-allowed items-center justify-between rounded-xl bg-[#f1f5f9] px-3.5 py-2.5 text-sm text-[#94a3b8]"
    >
      <span>{label}</span>
      <ChevronDown className="h-4 w-4 text-slate-300" />
    </div>
  )
}

/**
 * Area filter modal: province → district (precise location), plus "Search near
 * you" (device geolocation + radius slider). Controlled — the parent owns the
 * applied district/nearby and re-opens it. On Apply it returns the chosen values.
 */
export function AreaFilter({
  open, onClose, district, nearby, onApply, onReset,
}: {
  open: boolean
  onClose: () => void
  district: string
  nearby: Nearby | null
  onApply: (result: { district: string; nearby: Nearby | null }) => void
  onReset: () => void
}) {
  const { lang, tr } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const [province, setProvince] = useState(PROVINCES[0].slug)
  const [dist, setDist] = useState(district)
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(nearby ? { lat: nearby.lat, lng: nearby.lng } : null)
  const [radiusKm, setRadiusKm] = useState(nearby?.radiusKm ?? 5)
  const [locating, setLocating] = useState(false)

  const [address, setAddress] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  // Re-sync the draft to the applied values each time the modal opens.
  useEffect(() => {
    if (!open) return
    setDist(district)
    setLoc(nearby ? { lat: nearby.lat, lng: nearby.lng } : null)
    setRadiusKm(nearby?.radiusKm ?? 5)
    setAddress(null)
  }, [open, district, nearby])

  // Reverse-geocode the device location → fill the address + auto-select the district.
  const resolveAddress = async (lat: number, lng: number) => {
    setResolving(true)
    setAddress(null)
    try {
      const r = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}&lang=${lang}`)
      const d = await r.json()
      if (d.address) setAddress(d.address)
      if (d.district) setDist(d.district) // auto-pick the matched district
    } catch { /* keep coordinates-only */ } finally {
      setResolving(false)
    }
  }

  const locate = () => {
    if (!('geolocation' in navigator)) { toast.error(tr('Location not available on this device.', 'Thiết bị không hỗ trợ định vị.')); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setLoc(p)
        setLocating(false)
        resolveAddress(p.lat, p.lng)
      },
      () => { setLocating(false); toast.error(tr('Could not get your location. Allow location access and try again.', 'Không lấy được vị trí. Hãy cho phép truy cập vị trí và thử lại.')) },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  const apply = () => {
    onApply({ district: dist, nearby: loc ? { ...loc, radiusKm } : null })
    onClose()
  }

  const reset = () => { setDist('all'); setLoc(null); setAddress(null); setRadiusKm(5); onReset(); onClose() }

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white shadow-pop sm:rounded-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-[#1a202c]">{tr('Area', 'Khu vực')}</h2>
          <button onClick={onClose} aria-label={tr('Close', 'Đóng')} className="rounded-full p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {/* Province / city */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#1a202c]">{tr('Province / City', 'Tỉnh / Thành phố')} <span className="text-red-500">*</span></label>
            <CustomSelect
              value={province}
              onChange={(p) => { setProvince(p); if (p !== 'ho-chi-minh') setDist('all') }}
              options={PROVINCES.map((p) => ({ value: p.slug, label: lang === 'vi' ? p.name : p.nameEn }))}
              className={FIELD}
              activeClassName="bg-white border-[#0a66c2] text-[#1a202c]"
            />
          </div>

          {/* District / county */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#1a202c]">{tr('District / County', 'Quận / Huyện')}</label>
            {province === 'ho-chi-minh' ? (
              <CustomSelect
                value={dist}
                onChange={setDist}
                options={DISTRICTS.map((d) => ({ value: d.slug, label: lang === 'vi' ? d.name : d.nameEn }))}
                placeholder={tr('Select District/County', 'Chọn Quận/Huyện')}
                className={FIELD}
                activeClassName="bg-white border-[#0a66c2] text-[#1a202c]"
              />
            ) : (
              <DisabledField label={tr('Listings coming soon to this province', 'Sắp có tin đăng ở tỉnh này')} />
            )}
          </div>

          {/* Ward / commune — structure shown; not data-backed yet */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#1a202c]">{tr('Ward / Commune', 'Phường / Xã')}</label>
            <DisabledField label={tr('Select Ward/Commune', 'Chọn Phường/Xã')} title={tr('Select the District/County first', 'Hãy chọn Quận/Huyện trước')} />
          </div>

          {/* Street */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#1a202c]">{tr('Street', 'Đường')}</label>
            <DisabledField label={tr('Select Street/Road', 'Chọn Đường/Phố')} title={tr('Select the District/County first', 'Hãy chọn Quận/Huyện trước')} />
          </div>

          {/* Search near you */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-[#0a66c2]" />
              <span className="text-sm font-bold text-[#1a202c]">{tr('Search near you', 'Tìm quanh bạn')}</span>
            </div>

            {loc ? (
              <div className="mt-3 space-y-3 rounded-xl bg-[#f8fafc] p-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-[#0a66c2]"><LocateFixed className="h-4 w-4" /> {tr('Using your location', 'Dùng vị trí của bạn')}</span>
                  <button onClick={() => { setLoc(null); setAddress(null) }} className="text-xs font-semibold text-slate-400 hover:text-slate-700">{tr('Remove', 'Bỏ')}</button>
                </div>
                {resolving ? (
                  <p className="flex items-center gap-1.5 text-xs text-[#64748b]"><Loader2 className="h-3 w-3 animate-spin" /> {tr('Finding your address…', 'Đang tìm địa chỉ…')}</p>
                ) : address ? (
                  <p className="text-xs leading-relaxed text-[#475569]">{address}</p>
                ) : null}
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-[#64748b]">{tr('Search range', 'Bán kính tìm')}</span>
                    <span className="font-bold text-[#1a202c]">{radiusKm} km</span>
                  </div>
                  <input
                    type="range" min={1} max={20} step={1} value={radiusKm}
                    onChange={(e) => setRadiusKm(Number(e.target.value))}
                    className="w-full accent-[#0a66c2]"
                    aria-label={tr('Search range in km', 'Bán kính tìm theo km')}
                  />
                  <div className="flex justify-between text-[10px] text-[#94a3b8]"><span>1 km</span><span>20 km</span></div>
                </div>
              </div>
            ) : (
              <button
                onClick={locate}
                disabled={locating}
                className="mt-3 flex w-full items-center justify-center gap-2.5 rounded-xl border-2 border-[#0a66c2] bg-[#e8f1fb] py-3 text-sm font-bold text-[#0a66c2] shadow-sm transition-all hover:bg-[#dbeafe] active:scale-[0.99] disabled:opacity-60"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0a66c2] text-white">
                  {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                </span>
                {tr('Use my current location', 'Dùng vị trí hiện tại')}
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
          <button onClick={reset} className="flex-1 rounded-full border border-slate-300 py-2.5 text-sm font-bold text-[#475569] transition-colors hover:bg-slate-50">
            {tr('Delete filter', 'Xóa lọc')}
          </button>
          <button onClick={apply} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#0a66c2] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182]">
            <Check className="h-4 w-4" /> {tr('Apply', 'Áp dụng')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
