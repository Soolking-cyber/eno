'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Info, Loader2, LocateFixed, MapPin } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Combobox, ComboboxContent, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import { IconButton } from '@/components/ui/icon-button'
import { useLanguage } from '@/context/language-context'
import { basemapTileUrl } from '@/lib/basemap'
import type { PlaceSuggestion } from '@/lib/geo-suggest'
import { loadLeaflet } from '@/lib/leaflet-loader'
import { CARTO_CREDIT, OSM_CREDIT } from '@/lib/map-credit'
import { handleExternalClick } from '@/lib/native-browser'
import { cn } from '@/lib/utils'
import { AreaFilter, findUnit, type Geo } from './area-filter'

/**
 * Where an import's listings are: the city and ward the post form stores, and the pin. `district`: a district picked with
 * no ward (owner, 2026-11-12: "city ward or district") — published where the ward would be; set only by the area picker.
 */
export type ImportPlace = { province: Geo | null; ward: Geo | null; district?: Geo | null; lat: number | null; lng: number | null }

const HCMC_CENTRE: [number, number] = [10.7769, 106.7009]

/** A map point as the post form fills it (post-wizard.tsx useMyLocation): reverse-geocode, then the geocoder's names matched to /api/geo's units. */
export async function areaAt(lat: number, lng: number, lang: string): Promise<{ province: Geo | null; ward: Geo | null }> {
  const r = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}&lang=${lang}`).catch(() => null)
  const d = (r?.ok ? await r.json().catch(() => ({})) : {}) as { province?: string; ward?: string; wardCandidates?: string[] }
  if (!d.province) return { province: null, ward: null }
  const provs = await fetch('/api/geo?type=provinces').then((x) => x.json()).then((j) => j.provinces || []).catch(() => [])
  const p = findUnit(provs, d.province)
  if (!p) return { province: { code: '', name: d.province, nameEn: d.province }, ward: d.ward ? { code: '', name: d.ward, nameEn: d.ward } : null }
  const wards = await fetch(`/api/geo?type=wards&province=${p.code}`).then((x) => x.json()).then((j) => j.wards || []).catch(() => [])
  const cands = d.wardCandidates?.length ? d.wardCandidates : d.ward ? [d.ward] : []
  for (const c of cands) { const w = findUnit(wards, c); if (w) return { province: { code: p.code, name: p.name, nameEn: p.nameEn }, ward: { code: w.code, name: w.name, nameEn: w.nameEn } } }
  return { province: { code: p.code, name: p.name, nameEn: p.nameEn }, ward: d.ward ? { code: '', name: d.ward, nameEn: d.ward } : null }
}

/**
 * THE IMPORT'S LOCATION, PICKED THE WAY A RIDE OR DELIVERY APP PICKS ONE (owner, 2026-11-07: "make it a selector dropdown for city ward plus it auto finds when
 * user types address on map the place, like when you pin location on shoppee or any other app with location like grab"). Four ways in, kept in step:
 * an address search (Enter: OpenStreetMap's rules forbid search-as-you-type, api/geocode/search), the post form's own city and ward picker (AreaFilter),
 * "use my location", and a pin to drag or a tap on the map. A point fills the city and ward from the map; a hand-picked ward moves the pin there.
 */
export function ImportLocationPicker({ value, onChange }: { value: ImportPlace; onChange: (next: ImportPlace) => void }) {
  const { tr, lang } = useLanguage()
  const [query, setQuery] = useState('')
  // PLACES AS YOU TYPE (owner, 2026-11-12: "macdonalds thao dien show exact address … like grab"): eno's own OpenStreetMap
  // search (api/geocode/suggest, src/lib/geo-suggest.ts), a quarter second after the last key. `suggestOff`: that server is
  // missing or down — Enter then searches the old way (Nominatim) and the field says so.
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [suggestOff, setSuggestOff] = useState(false)
  // The text the last suggestions answered: with none for it, the field says Enter searches further.
  const [answered, setAnswered] = useState('')
  // The list opens when rows arrive for what the seller typed (they are typing: it is for them), and Escape or a click
  // away closes it until the next answer.
  const [listOpen, setListOpen] = useState(false)
  const suggestGen = useRef(0)
  // The text a pick put in the field: it is the answer, not a new search.
  const picked = useRef('')
  // The picked row is the combobox's value: with none, Base UI empties the field to match it right after the pick.
  const [chosen, setChosen] = useState<PlaceSuggestion | null>(null)
  const [results, setResults] = useState<{ label: string; lat: number; lng: number }[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  // Only the newest search shows: an older answer arriving late is dropped (commit gate, codex).
  const searchGen = useRef(0)
  const [locating, setLocating] = useState(false)
  const [areaOpen, setAreaOpen] = useState(false)
  const areaBtnRef = useRef<HTMLButtonElement>(null)
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<{ map: LeafletMap; marker: LeafletMarker | null } | null>(null)
  // The latest value and callback for Leaflet's handlers, which are bound once.
  const latest = useRef({ value, onChange })
  latest.current = { value, onChange }
  // Only the newest lookup applies: a slow reverse-geocode must not undo a later pick.
  const gen = useRef(0)

  // ⛔ A NEW PIN EMPTIES THE CITY AND WARD UNTIL THE MAP NAMES THEM (commit gate, codex + opus): the old ward under a new pin could be confirmed and published.
  // If the map can't name the spot, they stay empty and the seller picks them; Publish waits either way.
  const pinTo = async (lat: number, lng: number) => {
    const mine = ++gen.current
    latest.current.onChange({ ...latest.current.value, lat, lng, province: null, ward: null, district: null })
    const area = await areaAt(lat, lng, lang)
    if (mine !== gen.current || !area.province) return
    latest.current.onChange({ ...latest.current.value, lat, lng, province: area.province, ward: area.ward, district: null })
  }

  useEffect(() => {
    const q = query.trim()
    const mine = ++suggestGen.current
    // ⛔ ROWS ARE FOR THE TEXT THEY ANSWERED (commit gate, codex + opus): the last query's rows go the moment the text
    // changes, or Enter would pick a highlighted row for words the seller has since typed past.
    setSuggestions([])
    setListOpen(false)
    if (q === picked.current) return
    // Typed past the pick: the same words typed again later are a new search (commit gate, opus).
    picked.current = ''
    if (q.length < 3) return
    const t = setTimeout(async () => {
      const { lat, lng } = latest.current.value
      // i18n-invariant: the answer language and the bias point, not copy.
      const near = lat != null && lng != null ? `&lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}` : ''
      const r = await fetch(`/api/geocode/suggest?q=${encodeURIComponent(q)}&lang=${lang === 'vi' ? 'vi' : 'en'}${near}`).catch(() => null)
      const d = (r?.ok ? await r.json().catch(() => null) : null) as { results?: PlaceSuggestion[]; available?: boolean } | null
      if (mine !== suggestGen.current) return
      setSuggestOff(!d?.available)
      setAnswered(q)
      setSuggestions(d?.results ?? [])
      setListOpen((d?.results ?? []).length > 0)
    }, 250)
    return () => clearTimeout(t)
  }, [query, lang])

  const pickSuggestion = (s: PlaceSuggestion) => {
    const text = [s.title, s.detail].filter(Boolean).join(', ')
    picked.current = text
    // An Enter search still on its way must not bring its list back over this pick (commit gate, codex).
    searchGen.current++
    setSearching(false)
    setSearchFailed(false)
    setChosen(s)
    setQuery(text)
    setSuggestions([])
    setListOpen(false)
    setResults(null)
    void pinTo(s.lat, s.lng)
  }

  const search = async () => {
    const q = query.trim()
    if (q.length < 3) return
    // An Enter during the pause: the suggestions on their way would open over these results (commit gate, opus).
    suggestGen.current++
    const mine = ++searchGen.current
    setSearching(true)
    // i18n-invariant: the geocoder's answer language, not copy.
    const r = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}&lang=${lang === 'vi' ? 'vi' : 'en'}`).catch(() => null)
    const d = (r?.ok ? await r.json().catch(() => null) : null) as { results?: { label: string; lat: number; lng: number }[] } | null
    if (mine !== searchGen.current) return
    // A refused or failed search is not "no place": it says so (commit gate, opus).
    setSearchFailed(!d)
    setResults(d ? d.results ?? [] : null)
    setSearching(false)
  }

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) return
    setLocating(true)
    // A pick made while the phone looks for itself wins: a late fix never overwrites it (commit gate, codex).
    const asked = ++gen.current
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (asked !== gen.current) { setLocating(false); return } void pinTo(pos.coords.latitude, pos.coords.longitude).finally(() => setLocating(false)) },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  // The pin follows the latest value: run when the value moves AND when the map first exists, so a script that loads after the pick still shows it
  // (commit gate, codex + opus). No point: no pin.
  const pinTitle = tr('Drag to the exact place', 'Kéo đến đúng vị trí')
  const syncPin = () => {
    const m = map.current
    const L = (window as unknown as { L?: LeafletNS }).L
    const { lat, lng } = latest.current.value
    if (!m || !L) return
    if (lat == null || lng == null) { m.marker?.remove(); m.marker = null; return }
    if (!m.marker) {
      m.marker = L.marker([lat, lng], { draggable: true, keyboard: true, title: pinTitle }).addTo(m.map)
      m.marker.on('dragend', () => { const p = m.marker!.getLatLng(); void pinTo(p.lat, p.lng) })
    } else m.marker.setLatLng([lat, lng])
    m.map.setView([lat, lng], Math.max(m.map.getZoom(), 15))
  }

  // The map: one Leaflet instance.
  useEffect(() => {
    let gone = false
    loadLeaflet(() => {
      if (gone || !mapEl.current || map.current) return
      const L = (window as unknown as { L: LeafletNS }).L
      const m = L.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView(HCMC_CENTRE, 11)
      L.tileLayer(basemapTileUrl(L.Browser.retina ? '@2x' : ''), { maxZoom: 19 }).addTo(m)
      map.current = { map: m, marker: null }
      m.on('click', (e: { latlng: { lat: number; lng: number } }) => { void pinTo(e.latlng.lat, e.latlng.lng) })
      syncPin()
    })
    return () => { gone = true; map.current?.map.remove(); map.current = null }
    // Built once; syncPin follows the value.
  }, [])

  useEffect(syncPin, [value.lat, value.lng])

  // i18n-invariant: place names from /api/geo, each unit's own Vietnamese and English name (AreaFilter labels them the same way).
  const areaLabel = [value.ward ?? value.district, value.province].filter(Boolean).map((g) => (lang === 'vi' ? g!.name : g!.nameEn || g!.name)).join(', ')

  return (
    <div className="space-y-3">
      {/* ⛔ `sheet={false}`: the phone sheet turns the page field read-only once it has rows, and these rows arrive WHILE the
          seller types — the list stays anchored under the field instead. `filter={null}`: the server already matched. */}
      <Combobox<PlaceSuggestion>
        sheet={false}
        items={suggestions}
        filter={null}
        open={listOpen && suggestions.length > 0}
        onOpenChange={(next) => setListOpen(next && suggestions.length > 0)}
        value={chosen}
        inputValue={query}
        onInputValueChange={(v) => setQuery(v.slice(0, 160))}
        onValueChange={(s) => { if (s) pickSuggestion(s) }}
        itemToStringLabel={(s) => [s.title, s.detail].filter(Boolean).join(', ')}
        // ⛔ NO ROW IS EVER "ALREADY PICKED" (commit gate, opus): the same row picked again after the pin moved elsewhere must
        // move it back, and Base UI sends no change for an item equal to the value.
        isItemEqualToValue={() => false}
        autoHighlight
      >
        <ComboboxInputGroup className="border-0 bg-tint">
          <ComboboxInput
            aria-label={tr('Search an address', 'Tìm địa chỉ')}
            autoComplete="off"
            enterKeyHint="search"
            maxLength={160}
            placeholder={suggestOff ? tr('Type an address, then press Enter', 'Nhập địa chỉ rồi nhấn Enter') : tr('Search a place or address', 'Tìm địa điểm hoặc địa chỉ')}
            className="px-4 placeholder:text-ink-4"
            // With no open list to pick from (the server is down, nothing yet, or the list was closed), Enter searches the old way.
            // ⛔ Not while an input method is composing (Telex/VNI): that Enter commits the word (commit gate, opus).
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !(listOpen && suggestions.length > 0)) { e.preventDefault(); void search() } }}
          />
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxList>
            {(s: PlaceSuggestion) => (
              <ComboboxItem key={`${s.lat},${s.lng},${s.title},${s.detail}`} value={s}>
                <span className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{s.title}</span>
                    {s.detail && <span className="block text-xs text-ink-4">{s.detail}</span>}
                  </span>
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {/* No suggestions for this text (none found, or the server is down): the placeholder is hidden under the text, so the
          Enter way is said under the field (commit gate, opus). */}
      {answered === query.trim() && answered.length >= 3 && suggestions.length === 0 && !searching && !results && !searchFailed && <p className="text-xs text-ink-4">{tr('Press Enter to search.', 'Nhấn Enter để tìm.')}</p>}
      {searching && <p className="flex items-center gap-2 text-xs text-ink-4"><Loader2 className="size-4 animate-spin" />{tr('Searching…', 'Đang tìm…')}</p>}
      {!searching && searchFailed && <p role="alert" className="text-xs text-body">{tr('The search is busy. Press Enter again in a moment, or pick the city and ward below.', 'Tìm kiếm đang bận. Hãy nhấn Enter lại sau giây lát, hoặc chọn thành phố và phường bên dưới.')}</p>}
      {!searching && results && (results.length === 0
        ? <p className="text-xs text-body">{tr('No place found. Try a street and district, or pick the city and ward below.', 'Không tìm thấy. Hãy thử tên đường và quận, hoặc chọn thành phố và phường bên dưới.')}</p>
        : (
          <ul className="space-y-1" aria-label={tr('Places found', 'Các địa điểm tìm thấy')}>
            {results.map((p) => (
              <li key={`${p.lat},${p.lng}`}>
                <Button variant="bare" size="none" type="button" className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm text-ink hover:bg-tint" onClick={() => { setResults(null); void pinTo(p.lat, p.lng) }}>
                  <MapPin className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
                  <span className="min-w-0">{p.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        ))}

      <div className="flex items-center gap-2">
        <Button variant="bare" size="none" type="button" ref={areaBtnRef} onClick={() => setAreaOpen((o) => !o)} aria-label={tr('City and ward', 'Thành phố và phường')}
          className="flex min-w-0 flex-1 shrink items-center justify-between gap-2 rounded-xl bg-tint px-3.5 py-3 text-left text-sm font-normal transition-colors duration-150 hover:bg-muted active:scale-100">
          <span className={cn('flex min-w-0 items-center gap-2', areaLabel ? 'font-medium text-foreground' : 'text-ink-4')}>
            <MapPin className="size-5 shrink-0 text-accent-foreground" />
            <span className="truncate">{areaLabel || tr('Choose the city and ward', 'Chọn thành phố và phường')}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-ink-4" />
        </Button>
        <IconButton size="lg" onClick={useMyLocation} disabled={locating} aria-label={tr('Use my current location', 'Dùng vị trí hiện tại')} title={tr('Use my current location', 'Dùng vị trí hiện tại')}
          className="h-[46px] w-[46px] rounded-xl bg-tint text-accent-foreground transition-colors hover:bg-muted disabled:opacity-60">
          {locating ? <Loader2 className="size-5 animate-spin" /> : <LocateFixed className="size-5" />}
        </IconButton>
      </div>

      <div className="relative">
        <div ref={mapEl} className="h-48 w-full overflow-hidden rounded-xl bg-tint" aria-label={tr('Map: tap or drag the pin to the exact place', 'Bản đồ: chạm hoặc kéo ghim đến đúng vị trí')} role="application" />
        {/* The licence credit for the tiles and the map data, as on every eno map (src/lib/map-credit.ts). */}
        <p className="pointer-events-none absolute bottom-1 right-1 z-[800] flex gap-1 rounded-lg bg-card px-1 text-ink-4">
          <a className="pointer-events-auto flex size-5 items-center justify-center" href="https://www.openstreetmap.org/copyright" onClick={handleExternalClick} target="_blank" rel="noreferrer" aria-label={OSM_CREDIT}><Info className="size-5" /></a>
          <a className="pointer-events-auto flex size-5 items-center justify-center" href="https://carto.com/attributions" onClick={handleExternalClick} target="_blank" rel="noreferrer" aria-label={CARTO_CREDIT}><Info className="size-5" /></a>
        </p>
      </div>

      <AreaFilter
        mode="pick"
        hideLocate
        open={areaOpen}
        anchorRef={areaBtnRef}
        onClose={() => setAreaOpen(false)}
        province={value.province}
        ward={value.ward}
        withDistrict
        districtValue={value.ward ? null : value.district ?? null}
        // ⛔ NO PIN INTO THE POPOVER: it seeds its own from `nearby` and hands it back on Apply, so a new ward came back with the old pin (commit gate, opus).
        // This picker owns the pin; the popover's locate button is hidden.
        nearby={null}
        onApply={({ province, ward, district }) => {
          gen.current++
          // A district counts only without a ward: with one, the ward is the place (and its district is implied).
          const alone = ward ? null : district ?? null
          // ⛔ A hand-picked ward drops the old pin (commit gate, codex): the search below puts one in that ward, or none if it finds nothing.
          onChange({ ...value, province, ward, district: alone, lat: null, lng: null })
          // A hand-picked ward (or district) moves the pin there: one search for it, not a stream (Nominatim's rules).
          const spot = ward ?? alone
          if (spot && province) {
            const mine = gen.current
            void fetch(`/api/geocode/search?q=${encodeURIComponent(`${spot.name}, ${province.name}`)}&lang=vi`).then((r) => (r.ok ? r.json() : null)).then((d: { results?: { lat: number; lng: number }[] } | null) => {
              const p = d?.results?.[0]
              if (p && mine === gen.current) latest.current.onChange({ ...latest.current.value, lat: p.lat, lng: p.lng })
            }).catch(() => {})
          }
        }}
        onReset={() => { gen.current++; onChange({ province: null, ward: null, district: null, lat: null, lng: null }) }}
      />
    </div>
  )
}

// The few Leaflet shapes used here: the self-hosted script is a global, with no types in this repo.
type LeafletMarker = { addTo: (m: LeafletMap) => LeafletMarker; on: (e: string, f: () => void) => void; getLatLng: () => { lat: number; lng: number }; setLatLng: (p: [number, number]) => void; remove: () => void }
type LeafletMap = { setView: (c: [number, number], z: number) => LeafletMap; on: (e: string, f: (ev: { latlng: { lat: number; lng: number } }) => void) => void; remove: () => void; getZoom: () => number }
type LeafletNS = {
  map: (el: HTMLElement, o: object) => LeafletMap
  tileLayer: (url: string, o: object) => { addTo: (m: LeafletMap) => void }
  marker: (p: [number, number], o: object) => LeafletMarker
  Browser: { retina: boolean }
}
