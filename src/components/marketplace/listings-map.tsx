'use client'

import { useEffect, useRef, useState } from 'react'
import type { SerializedListing } from '@/lib/types'
import { formatPrice } from '@/lib/types'
import type { Language } from '@/context/language-context'
import { useLanguage } from '@/context/language-context'
import { getListingCoordinates } from '@/lib/geo'

// Compact price for map labels (Airbnb-style price pins).
function compactPrice(l: SerializedListing): string {
  if (l.currency === '₫') {
    if (l.price >= 1_000_000_000) return `${(l.price / 1_000_000_000).toFixed(1)}tỷ`
    if (l.price >= 1_000_000) return `${Math.round(l.price / 1_000_000)}tr`
    if (l.price >= 1_000) return `${Math.round(l.price / 1_000)}k`
    return `${l.price}`
  }
  return formatPrice(l.price, l.currency, l.priceUnit)
}

type Props = {
  listings: SerializedListing[]
  activeDistrict: string
  onOpenListing: (l: SerializedListing) => void
  lang: Language
  selectedId?: string | null
  onHover?: (id: string | null) => void
  focusId?: string | null
}

const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'

function loadLeaflet(cb: () => void) {
  if (typeof window === 'undefined') return
  const w = window as unknown as { L?: unknown }
  if (w.L) { cb(); return }
  if (!document.getElementById('leaflet-css')) {
    // Warm the map origins now that the map is actually loading (these used to be
    // global preconnects but wasted early-connection slots on the homepage).
    for (const href of ['https://unpkg.com', 'https://basemaps.cartocdn.com']) {
      const pc = document.createElement('link')
      pc.rel = 'preconnect'; pc.href = href; pc.crossOrigin = ''
      document.head.appendChild(pc)
    }
    const link = document.createElement('link')
    link.id = 'leaflet-css'; link.rel = 'stylesheet'; link.href = LEAFLET_CSS
    document.head.appendChild(link)
  }
  const existing = document.getElementById('leaflet-js') as HTMLScriptElement | null
  if (existing) {
    if (w.L) cb()
    else existing.addEventListener('load', cb)
    return
  }
  const s = document.createElement('script')
  s.id = 'leaflet-js'; s.src = LEAFLET_JS; s.async = true
  s.onload = () => cb()
  document.head.appendChild(s)
}

function pinHtml(label: string, active: boolean): string {
  const bg = active ? '#0a66c2' : '#ffffff'
  const color = active ? '#ffffff' : '#1a202c'
  const border = active ? '#0a66c2' : '#d8dee6'
  const scale = active ? 1.08 : 1
  return `<div style="transform:translate(-50%,-50%) scale(${scale});display:inline-block;background:${bg};color:${color};border:1px solid ${border};border-radius:9999px;padding:4px 9px;font-size:12px;font-weight:700;line-height:1;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.22);transition:transform .12s ease, background .12s ease;">${label}</div>`
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function ListingsMap({ listings, activeDistrict, onOpenListing, selectedId, onHover, focusId }: Props) {
  const { tr } = useLanguage()
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const [ready, setReady] = useState(false)

  useEffect(() => { loadLeaflet(() => setReady(true)) }, [])

  // Init map once Leaflet is ready.
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return
    const L = (window as any).L
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true })
      .setView([10.7769, 106.7009], 12)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map)
    mapInstanceRef.current = map
    setTimeout(() => map.invalidateSize(), 80)
  }, [ready])

  // Draw / refresh markers when listings change.
  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return
    const L = (window as any).L
    const map = mapInstanceRef.current

    markersRef.current.forEach((m) => map.removeLayer(m))
    markersRef.current.clear()

    const bounds: [number, number][] = []
    listings.forEach((l) => {
      const { lat, lng } = getListingCoordinates(l)
      bounds.push([lat, lng])
      const icon = L.divIcon({ html: pinHtml(compactPrice(l), selectedId === l.id), className: 'eno-pin', iconSize: [0, 0] })
      const marker = L.marker([lat, lng], { icon, riseOnHover: true }).addTo(map)
      marker.on('click', () => onOpenListing(l))
      if (onHover) {
        marker.on('mouseover', () => onHover(l.id))
        marker.on('mouseout', () => onHover(null))
      }
      markersRef.current.set(l.id, marker)
    })

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
    }
    setTimeout(() => map.invalidateSize(), 80)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, ready, activeDistrict])

  // Update marker styling on selection / hover (no full rebuild).
  useEffect(() => {
    if (!ready) return
    const L = (window as any).L
    markersRef.current.forEach((marker, id) => {
      const l = listings.find((x) => x.id === id)
      if (!l) return
      marker.setIcon(L.divIcon({ html: pinHtml(compactPrice(l), selectedId === id), className: 'eno-pin', iconSize: [0, 0] }))
      if (selectedId === id) marker.setZIndexOffset(1000)
      else marker.setZIndexOffset(0)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready])

  // Fly to a specific listing when requested ("locate on map").
  useEffect(() => {
    if (!ready || !focusId || !mapInstanceRef.current) return
    const l = listings.find((x) => x.id === focusId)
    if (!l) return
    const { lat, lng } = getListingCoordinates(l)
    mapInstanceRef.current.flyTo([lat, lng], 15, { duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, ready])

  return (
    // `isolate` keeps Leaflet's internal z-index (panes/controls up to ~1000)
    // contained so it can never render above modals/dialogs (which sit at z-50).
    <div className="w-full h-full relative isolate bg-tint">
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted z-20 select-none">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0a66c2] border-t-transparent" />
          <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
            {tr('Loading map…', 'Đang tải bản đồ...')}
          </span>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />
    </div>
  )
}
