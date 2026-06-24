'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Heart } from 'lucide-react'
import { TrustScore } from './trust-score'
import type { SerializedListing } from '@/lib/types'
import { formatPrice } from '@/lib/types'
import { formatMoneyFull } from '@/lib/vnd'
import { useCurrency } from '@/context/currency-context'
import type { Language } from '@/context/language-context'
import { useLanguage } from '@/context/language-context'
import { useFavorites } from '@/context/favorites-context'
import { getListingCoordinates } from '@/lib/geo'
import { cn } from '@/lib/utils'

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
    else existing.addEventListener('load', cb, { once: true })
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
export function ListingsMap({ listings, activeDistrict, onOpenListing, lang, selectedId, onHover, focusId }: Props) {
  const { tr } = useLanguage()
  const { isFavorite, toggle } = useFavorites()
  const { format: formatPrice } = useCurrency()
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<Map<string, any>>(new Map())
  const fitKeyRef = useRef<string>('') // last filter signature we auto-fit bounds for
  const [ready, setReady] = useState(false)
  // Airbnb-style: a pin tap opens a small info card (not a direct navigation). The
  // ref mirrors the open card id so marker/map click handlers (captured in effects)
  // always see the current value without stale closures.
  const [card, setCard] = useState<SerializedListing | null>(null)
  // Card pops ABOVE the tapped pin (anchored to its screen position) — `above`
  // flips it below the pin when there isn't room near the top edge.
  const [cardPos, setCardPos] = useState<{ x: number; y: number; above: boolean } | null>(null)
  const cardIdRef = useRef<string | null>(null)
  const listingsRef = useRef(listings)
  listingsRef.current = listings

  const CARD_W = 300, CARD_H = 250
  const placeCardFor = (l: SerializedListing) => {
    const map = mapInstanceRef.current, el = mapRef.current
    if (!map || !el) return
    const { lat, lng } = getListingCoordinates(l)
    const pt = map.latLngToContainerPoint([lat, lng])
    const W = el.clientWidth
    const x = Math.max(CARD_W / 2 + 8, Math.min(W - CARD_W / 2 - 8, pt.x))
    setCardPos({ x, y: pt.y, above: pt.y > CARD_H + 24 })
  }
  const openCard = (l: SerializedListing) => { cardIdRef.current = l.id; setCard(l); placeCardFor(l); onHover?.(l.id) }
  const closeCard = () => { cardIdRef.current = null; setCard(null); setCardPos(null); onHover?.(null) }
  // Desktop hover UX: keep the card open while the cursor is over the marker OR the
  // card, and close it gracefully a beat after the cursor leaves both — so it never
  // persists over the cards behind it (and the small grace period lets the cursor
  // travel from the pin onto the card without it vanishing).
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null } }
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => closeCard(), 220) }
  useEffect(() => () => cancelClose(), [])

  useEffect(() => {
    let cancelled = false
    loadLeaflet(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true } // don't setReady after unmount (stale script 'load')
  }, [])

  // Init map once Leaflet is ready.
  useEffect(() => {
    if (!ready || !mapRef.current || mapInstanceRef.current) return
    const L = (window as any).L
    // No attribution control — neutral map, no flags/branding badge.
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: true })
      .setView([10.7769, 106.7009], 12)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map)
    map.on('click', () => closeCard()) // tap the map background → close the card
    // Keep the card glued to its pin while the map pans/zooms.
    map.on('move zoom', () => {
      const id = cardIdRef.current
      if (!id) return
      const l = listingsRef.current.find((x) => x.id === id)
      if (l) placeCardFor(l)
    })
    mapInstanceRef.current = map
    const sizer = setTimeout(() => map.invalidateSize(), 80)
    // Destroy the map + its global listeners on unmount (e.g. toggling away from
    // map view) — otherwise each toggle leaks a Leaflet instance + DOM listeners.
    return () => {
      clearTimeout(sizer)
      map.off()
      map.remove()
      mapInstanceRef.current = null
      markersRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // Draw / refresh markers when listings change.
  useEffect(() => {
    if (!ready || !mapInstanceRef.current) return
    const L = (window as any).L
    const map = mapInstanceRef.current

    markersRef.current.forEach((m) => map.removeLayer(m))
    markersRef.current.clear()
    // Keep the open card UNLESS its listing is gone (e.g. filtered out). A redraw
    // alone must NOT close it — otherwise it flickers shut right after opening.
    setCard((c) => {
      const keep = c && listings.some((l) => l.id === c.id)
      if (!keep) cardIdRef.current = null
      return keep ? c : null
    })

    // On hover-capable devices (desktop), HOVER reveals the card so the user can
    // browse pins fast; clicking then opens the listing. On touch, tap reveals the
    // card and a second tap on the same pin opens it.
    const hoverable = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches

    const bounds: [number, number][] = []
    listings.forEach((l) => {
      const { lat, lng } = getListingCoordinates(l)
      bounds.push([lat, lng])
      const icon = L.divIcon({ html: pinHtml(compactPrice(l), selectedId === l.id), className: 'eno-pin', iconSize: [0, 0] })
      const marker = L.marker([lat, lng], { icon, riseOnHover: true }).addTo(map)
      marker.on('click', () => {
        if (hoverable) onOpenListing(l) // desktop: card already shown on hover → click opens
        else if (cardIdRef.current === l.id) onOpenListing(l) // touch: 2nd tap opens
        else openCard(l) // touch: 1st tap shows card
      })
      marker.on('mouseover', () => { if (hoverable) { cancelClose(); openCard(l) } else { onHover?.(l.id) } })
      marker.on('mouseout', () => { if (hoverable) { scheduleClose() } else { onHover?.(null) } })
      markersRef.current.set(l.id, marker)
    })

    // Only auto-fit when the FILTER context changes (district, or the result set
    // was replaced — first item changes), NOT when infinite-scroll appends a page.
    // Re-fitting on every append is what made the map jump repeatedly.
    if (bounds.length > 0) {
      const fitKey = `${activeDistrict}|${listings[0]?.id ?? ''}`
      if (fitKeyRef.current !== fitKey) {
        fitKeyRef.current = fitKey
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
      }
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

      {/* Airbnb-style info card — pops ON TOP of the tapped pin, magnifying out of it */}
      {card && cardPos && (
        <div
          className="absolute z-[1100] pointer-events-none"
          style={{
            left: cardPos.x,
            top: cardPos.above ? cardPos.y - 14 : cardPos.y + 14,
            transform: cardPos.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
        >
          <div
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className={cn(
              'pointer-events-auto relative overflow-hidden rounded-2xl bg-card shadow-pop duration-150 ease-out animate-in fade-in zoom-in-95',
              cardPos.above ? 'origin-bottom' : 'origin-top',
            )}
            style={{ width: CARD_W }}
          >
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); toggle(card.id) }}
                aria-label={isFavorite(card.id) ? tr('Saved', 'Đã lưu') : tr('Save', 'Lưu')}
                className="flex h-8 w-8 items-center justify-center transition-transform hover:scale-110 active:scale-90"
              >
                <Heart className={cn('h-[22px] w-[22px] transition-colors [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.5))]', isFavorite(card.id) ? 'fill-[#0a66c2] text-white' : 'fill-black/25 text-white')} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); closeCard() }}
                aria-label={tr('Close', 'Đóng')}
                className="flex h-8 w-8 items-center justify-center text-white transition-transform hover:scale-110 active:scale-90 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.5))]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <button onClick={() => onOpenListing(card)} className="block w-full text-left cursor-pointer">
              <div className="aspect-[16/10] w-full bg-tint">
                {card.images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />
                )}
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-bold text-foreground">{lang === 'vi' ? (card.titleVi || card.title) : card.title}</p>
                  <TrustScore score={card.seller.trustScore} variant="number" size="sm" className="shrink-0" />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{card.district || card.location}</p>
                <p className="mt-1 text-sm font-bold text-foreground">{card.currency === '₫' ? formatPrice(card.price) : formatMoneyFull(card.price, card.currency)}</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
